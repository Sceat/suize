import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConnectModal, useSignTransaction, useSuiClient } from '@mysten/dapp-kit'
import { is_standard_wallet, useAuth } from '../auth'
import { ApiError, formatUsdc, payViaX402, readUsdcBalance, type BalanceClient } from '../api'
import { parseHandle, resolveHandle, type NameClient, type ParsedHandle } from '../suins'
import {
  MAX_MEMO_LEN,
  NETWORK,
  SUI_ADDRESS_RE,
  SUIVISION_TX,
  USDC_DECIMAL_RE,
} from '../config'
import { Busy, shortAddr, useReverseName } from '../ui'

// ============================================================================
// "/pay" — THE PAY PAGE (the human door). Terms live ENTIRELY in the URL:
//   /pay?to=<handle>&amount=0.10&memo=pay_…&returnUrl=…     (preferred)
//   /pay?payTo=0x…&amount=0.10&memo=pay_…&returnUrl=…       (protocol fallback)
// `to` is a Suize handle (`name@suize` — see ../suins.ts) the page resolves
// on-chain CLIENT-SIDE; when both params are present `to` WINS. An
// unresolvable handle is a HARD error — never a silent fallback to payTo.
// Display law (owner 2026-06-11, supersedes the old both-visible rendering):
// NO hex anywhere a name resolves — a handle destination renders the handle
// ALONE (the fineprint's "check the handle" is the verification step); a raw
// payTo is reverse-resolved and shows ITS handle when one exists, else the
// short hex; the signed-in payer shows as their handle too. Handles wear the
// red/orange gradient, money figures the blue one (styles.css). Unchanged
// laws: memo is inert text (React escaping — never merchant HTML); the only
// merchant-controlled navigation is returnUrl, followed AFTER settlement with
// ?digest= appended — never before.
//
// THREE auth states (owner-locked), all SELF-CONTAINED on this origin — NO SSO
// popup, NO /confirm money window (owner 2026-06-14):
//   1. already signed in (Enoki OR a standard wallet auto-connected by
//      dapp-kit's autoConnect) → the page opens DIRECTLY ready to pay.
//   2. signed out → primary "Pay with Suize" → pay.suize.io's OWN Enoki Google
//      zkLogin (an Enoki popup); the session lands ON THIS ORIGIN.
//   3. signed out → secondary "Connect a wallet" (standard dapp-kit modal).
// Flow (IDENTICAL for both kinds of wallet, vanilla x402 'exact'): address +
// USDC balance → GET /terms → build the gasless `send_funds` PTB → sign the
// EXACT bytes with the connected wallet via dapp-kit useSignTransaction
// (string-in/string-out, never rebuilt) → POST /settle → receipt. The backend
// never signs the payer leg; still gasless for the payer either way. A Suize
// (Enoki) session signs SILENTLY here — there is no off-origin confirm window.
// ============================================================================

type Dest =
  | { kind: 'address'; payTo: string }
  | { kind: 'handle'; handle: ParsedHandle }

type Terms =
  | {
      ok: true
      dest: Dest
      amount: string
      memo: string
      returnUrl: string | null
      /** 'authorize' (Deploy no-Sui-key door): sign but DON'T settle — hand back the
       *  signed payload (?payment=) instead of settling (?digest=). Default 'settle'. */
      mode: 'settle' | 'authorize'
    }
  | { ok: false; empty: boolean; problem: string }

const randomPaymentId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return `pay_${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`
}

const parseTerms = (search: string, generatedMemo: string): Terms => {
  const q = new URLSearchParams(search)
  const to = (q.get('to') ?? '').trim() // preferred: a Suize handle
  const payTo = (q.get('payTo') ?? '').trim() // protocol fallback: a raw address
  const amount = (q.get('amount') ?? '').trim()
  const memoRaw = (q.get('memo') ?? '').trim()
  const returnRaw = (q.get('returnUrl') ?? '').trim()
  // mode=authorize (or settle=0) = the Deploy no-Sui-key door: SIGN-but-don't-settle,
  // hand the signed payload back. Anything else = the default settle flow.
  const mode: 'settle' | 'authorize' =
    q.get('mode') === 'authorize' || q.get('settle') === '0' ? 'authorize' : 'settle'

  if (!to && !payTo && !amount) {
    return { ok: false, empty: true, problem: 'This page expects a payment link.' }
  }

  // `to` wins over `payTo` — and an invalid handle is an ERROR, never a
  // silent fallback to the raw address.
  let dest: Dest
  if (to) {
    const handle = parseHandle(to)
    if (!handle) {
      return {
        ok: false,
        empty: false,
        problem: 'The handle in this link is not a valid Suize handle (it looks like name@suize).',
      }
    }
    dest = { kind: 'handle', handle }
  } else {
    if (!SUI_ADDRESS_RE.test(payTo)) {
      return { ok: false, empty: false, problem: 'The pay-to address in this link is not a valid Sui address.' }
    }
    dest = { kind: 'address', payTo }
  }

  const m = USDC_DECIMAL_RE.exec(amount)
  if (!m || Number(amount) <= 0) {
    return { ok: false, empty: false, problem: 'The amount in this link is not a valid USDC amount.' }
  }
  if (memoRaw.length > MAX_MEMO_LEN) {
    return { ok: false, empty: false, problem: 'The reference in this link is too long.' }
  }
  // Only http(s) return destinations are ever followed (and only post-payment).
  let returnUrl: string | null = null
  if (returnRaw) {
    try {
      const u = new URL(returnRaw)
      if (u.protocol === 'https:' || u.protocol === 'http:') returnUrl = u.toString()
    } catch {
      returnUrl = null
    }
  }
  return { ok: true, dest, amount, memo: memoRaw || generatedMemo, returnUrl, mode }
}

const toUnits = (amount: string): bigint => {
  const m = USDC_DECIMAL_RE.exec(amount)
  if (!m) return 0n
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0') || '0')
}

type Phase =
  | { step: 'idle' }
  | { step: 'paying'; doing: string }
  // Settled: a digest. Authorized (Deploy no-Sui-key door): a signed payload (no
  // on-chain tx yet — the agent submits it as X-PAYMENT and the merchant settles it).
  | { step: 'done'; digest: string }
  | { step: 'authorized'; payment: string }
  | { step: 'error'; message: string }

/** The handle→address lookup state. 'none' is a DEFINITIVE on-chain no;
 * 'rpc-error' means the chain was unreadable (retry). */
type Resolution =
  | { step: 'resolving' }
  | { step: 'resolved'; address: string }
  | { step: 'none' }
  | { step: 'rpc-error' }

export function PayPage() {
  const generatedMemo = useMemo(randomPaymentId, [])
  const terms = useMemo(() => parseTerms(window.location.search, generatedMemo), [generatedMemo])
  const { address, is_suize, wallet_label, can_sign_in, sign_in_with_google, sign_out } = useAuth()
  const client = useSuiClient()
  const { mutateAsync: signTransaction } = useSignTransaction()

  const [balance, setBalance] = useState<bigint | null>(null)
  const [phase, setPhase] = useState<Phase>({ step: 'idle' })
  const [copied, setCopied] = useState(false)

  // The payer is the session ON THIS ORIGIN — the Enoki zkLogin session
  // (restored by autoConnect, or set after sign-in) OR a standard wallet. There
  // is no off-origin bridge session anymore: this app signs in for itself.
  const payerAddress = address

  // Handle links resolve CLIENT-SIDE on-chain before anything is payable.
  const dest = terms.ok ? terms.dest : null
  // No-hex display law: reverse-resolve the signed-in payer and (for raw
  // ?payTo links) the merchant — show handles wherever a name exists.
  const payerName = useReverseName(payerAddress)
  const merchantName = useReverseName(dest?.kind === 'address' ? dest.payTo : null)
  const [resolution, setResolution] = useState<Resolution>({ step: 'resolving' })
  useEffect(() => {
    if (!dest || dest.kind !== 'handle') return
    let alive = true
    setResolution({ step: 'resolving' })
    resolveHandle(client as unknown as NameClient, dest.handle)
      .then(resolved => {
        if (alive) setResolution(resolved ? { step: 'resolved', address: resolved } : { step: 'none' })
      })
      .catch(() => {
        if (alive) setResolution({ step: 'rpc-error' })
      })
    return () => {
      alive = false
    }
  }, [dest, client])

  // USDC balance for the paying address — local wallet OR the bridge session
  // (read-only, straight from chain; refreshed after payment).
  const refreshBalance = useCallback(() => {
    if (!payerAddress) {
      setBalance(null)
      return
    }
    readUsdcBalance(client as unknown as BalanceClient, payerAddress)
      .then(setBalance)
      .catch(() => setBalance(null))
  }, [payerAddress, client])
  useEffect(refreshBalance, [refreshBalance])

  if (!terms.ok) {
    if (terms.empty) {
      return (
        <div className="card">
          <h1>Suize Pay</h1>
          <p className="lede">
            Pay any Sui merchant in USDC with one tap — login with Google (no wallet setup) or
            connect a wallet you already use; gas-free either way. If a merchant sent you here, use
            their full payment link.
          </p>
        </div>
      )
    }
    return (
      <div className="card">
        <h1>This payment link is broken</h1>
        <p className="lede">{terms.problem}</p>
        <p className="fineprint">Ask whoever sent it for a fresh link.</p>
      </div>
    )
  }

  const { amount, memo, returnUrl, mode } = terms
  const destination = terms.dest

  // An unresolvable handle is a HARD stop — nothing on this page is payable.
  if (destination.kind === 'handle' && resolution.step === 'none') {
    return (
      <div className="card">
        <h1>This handle doesn't resolve</h1>
        <p className="lede">
          <span className="handle">{destination.handle.display}</span> is not a registered Suize
          handle on {NETWORK} (or it has no address attached). Nothing was paid.
        </p>
        <p className="fineprint">
          Ask whoever sent the link to check the handle, or to send a raw-address link
          (?payTo=0x…) instead.
        </p>
      </div>
    )
  }
  if (destination.kind === 'handle' && resolution.step === 'rpc-error') {
    return (
      <div className="card">
        <h1>Could not look up the handle</h1>
        <p className="lede">
          The chain could not be read to resolve{' '}
          <span className="handle">{destination.handle.display}</span> right now. Nothing was paid —
          refresh to retry.
        </p>
      </div>
    )
  }

  // The address every on-chain leg targets: the raw payTo, or the handle's
  // RESOLVED address (null while the lookup is still in flight).
  const payTo =
    destination.kind === 'address'
      ? destination.payTo
      : resolution.step === 'resolved'
        ? resolution.address
        : null
  const amountUnits = toUnits(amount)
  const insufficient = balance !== null && balance < amountUnits
  // SELF-PAY GUARD: signing in as the SAME account this link pays nets a 0
  // on-chain balance change (the facilitator then 402s with the cryptic
  // "expected +500000 got 0"). Pre-empt it — disable Pay, explain inline.
  const selfPay = Boolean(
    address && payTo && address.toLowerCase() === payTo.toLowerCase(),
  )

  const pay = async () => {
    if (!address || !payTo) return
    try {
      // The vanilla-x402 'exact' flow: GET /terms → build the gasless `send_funds`
      // PTB for that split → sign the EXACT bytes with the connected wallet (Enoki
      // zkLogin or a standard wallet, the SAME dapp-kit call) → POST /settle. The
      // backend never signs the payer leg; the payer pays ZERO gas either way. A
      // Suize session signs SILENTLY (no window) — only a standard wallet prompts.
      setPhase({ step: 'paying', doing: 'Preparing your payment…' })
      const result = await payViaX402({
        sender: address,
        payTo,
        amount,
        memo,
        settle: mode !== 'authorize',
        onBuilt: () =>
          setPhase({
            step: 'paying',
            doing:
              mode === 'authorize'
                ? 'Authorizing…'
                : is_suize
                  ? 'Settling on-chain…'
                  : 'Approve in your wallet…',
          }),
        sign: async (bytes) => {
          const { signature } = await signTransaction({ transaction: bytes })
          setPhase({ step: 'paying', doing: mode === 'authorize' ? 'Authorizing…' : 'Settling on-chain…' })
          return signature
        },
      })
      if ('payment' in result) setPhase({ step: 'authorized', payment: result.payment })
      else setPhase({ step: 'done', digest: result.digest })
      refreshBalance()
    } catch (e) {
      const err = e as ApiError
      let message = err.message || 'Payment failed.'
      if (err instanceof ApiError && err.status === 402) {
        message =
          NETWORK === 'testnet'
            ? `You don't have enough USDC at this address. This is Sui testnet — get free testnet USDC at faucet.circle.com (select Sui Testnet), then retry.`
            : `You don't have enough USDC at this address. Top it up, then retry.`
      } else if (err instanceof ApiError && err.status === 429) {
        message = 'Too many attempts in a row — wait a few seconds and retry.'
      } else if (err instanceof ApiError && err.status === 503) {
        message = 'The payment rail is not available right now. Try again later.'
      } else if (/reject|denied|cancel/i.test(message)) {
        message = 'You declined the signature — nothing was paid.'
      }
      setPhase({ step: 'error', message })
    }
  }

  if (phase.step === 'authorized') {
    // AUTHORIZE mode (Deploy no-Sui-key door): the payment is SIGNED but not yet
    // settled. PREFERRED: the agent passed a returnUrl → we hand the payload straight
    // back (one tap, no copy-paste). FALLBACK (no returnUrl — a chat agent that can't
    // receive a callback): a "Copy authorization" button, never the raw blob on screen.
    return (
      <div className="card">
        <h1>
          <span className="success-mark">✓</span> Authorized
        </h1>
        <p className="lede">
          You authorized {amount} USDC — nothing has left your wallet yet. It completes
          when the app you came from submits it.
        </p>
        {returnUrl ? (
          <button
            className="btn btn-primary btn-block"
            onClick={() => {
              const u = new URL(returnUrl)
              u.searchParams.set('payment', phase.payment)
              window.location.href = u.toString()
            }}
          >
            Return to {new URL(returnUrl).host}
          </button>
        ) : (
          <>
            <button
              className="btn btn-primary btn-block"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(phase.payment)
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 2000)
                } catch {
                  setCopied(false)
                }
              }}
            >
              {copied ? 'Copied ✓' : 'Copy authorization'}
            </button>
            <p className="fineprint">
              Paste this back to the agent or app that sent you here to finish the deploy.
            </p>
          </>
        )}
      </div>
    )
  }

  if (phase.step === 'done') {
    return (
      <div className="card">
        <h1>
          <span className="success-mark">✓</span> Paid
        </h1>
        <p className="lede">Your payment settled on-chain.</p>
        <div className="receipt">
          <div className="receipt-row">
            <span className="k">Amount</span>
            {/* The amount the user approved, verbatim — the only money figure
                shown payer-side (no fee/net breakdown; owner law 2026-06-11). */}
            <span className="v num">{amount} USDC</span>
          </div>
          {payerAddress && (
            <div className="receipt-row">
              <span className="k">Paid from</span>
              {/* The payer is the signed-in payer (it signed the tx) — the
                  resolved handle applies; hex only when nameless. */}
              {payerName ? (
                <span className="v handle">{payerName}</span>
              ) : (
                <span className="v mono">{shortAddr(payerAddress)}</span>
              )}
            </div>
          )}
          <div className="receipt-row">
            <span className="k">Transaction</span>
            <span className="v mono">
              <a className="quiet" href={SUIVISION_TX(phase.digest)} target="_blank" rel="noreferrer">
                {shortAddr(phase.digest)}
              </a>
            </span>
          </div>
          <div className="receipt-row">
            <span className="k">Reference</span>
            <span className="v mono">{memo}</span>
          </div>
        </div>
        {returnUrl && (
          <button
            className="btn btn-primary btn-block"
            onClick={() => {
              const u = new URL(returnUrl)
              u.searchParams.set('digest', phase.digest)
              window.location.href = u.toString()
            }}
          >
            Return to {new URL(returnUrl).host}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="card">
      <h2>Payment request</h2>
      <div className="amount">
        {amount}
        <small>USDC</small>
      </div>

      {destination.kind === 'handle' ? (
        <div className="field">
          <div className="label">Paying</div>
          {/* The handle ALONE is the merchant's identity (no-hex law) — the
              fineprint's "check the handle" is the verification step. */}
          <div className="handle-big handle">{destination.handle.display}</div>
          {!payTo && (
            <div className="handle-addr">
              <Busy>Looking up {destination.handle.display} on-chain…</Busy>
            </div>
          )}
        </div>
      ) : merchantName ? (
        <div className="field">
          <div className="label">Paying</div>
          <div className="handle-big handle">{merchantName}</div>
        </div>
      ) : (
        <div className="field">
          <div className="label">Pay to (the merchant's Sui address)</div>
          <div className="mono">{shortAddr(destination.payTo)}</div>
        </div>
      )}

      {memo !== generatedMemo && (
        <div className="field">
          <div className="label">Reference</div>
          <div className="memo-text">{memo}</div>
        </div>
      )}

      {payerAddress ? (
        <>
          <div className="field">
            <div className="label-row">
              <div className="label">Paying from · {wallet_label}</div>
              {/* Switch the signed-in account (the session lives on this origin). */}
              <button className="linklike" onClick={sign_out}>
                switch account
              </button>
            </div>
            <div className="row">
              {payerName ? (
                <span className="handle grow">{payerName}</span>
              ) : (
                <span className="mono grow">{shortAddr(payerAddress)}</span>
              )}
              <span className="num" style={{ fontWeight: 600 }}>
                {balance === null ? '…' : `${formatUsdc(balance)} USDC`}
              </span>
            </div>
          </div>
          {selfPay && (
            <div className="error">
              You're signed in as the same account this link pays. Sign in with a different
              account, or pay from another wallet.
            </div>
          )}
          {!selfPay && insufficient && (
            <div className="error">
              Not enough USDC at this address to cover {amount} USDC.
              {NETWORK === 'testnet' &&
                ' This is Sui testnet — get free testnet USDC at faucet.circle.com (select Sui Testnet).'}
            </div>
          )}
          {/* The balance read is display-only — when it fails (null) the button
              stays usable; the gasless build is the authority and 402s honestly. The
              button stays disabled until a handle destination has RESOLVED. Both an
              Enoki (Suize) session and a standard wallet sign HERE — no popup. */}
          {phase.step === 'paying' ? (
            <Busy>{phase.doing}</Busy>
          ) : (
            <button
              className="btn btn-primary btn-block"
              disabled={insufficient || selfPay || !payTo}
              onClick={pay}
            >
              Pay {amount} USDC
            </button>
          )}
        </>
      ) : (
        <>
          {/* Signed out: the primary path is pay.suize.io's OWN Google sign-in
              (an Enoki popup — NOT a money window). After the session arrives the
              normal inline Pay button shows. Standard wallets connect locally too. */}
          {phase.step === 'paying' ? (
            <Busy>{phase.doing}</Busy>
          ) : (
            <button
              className="btn btn-primary btn-block"
              disabled={!can_sign_in}
              onClick={sign_in_with_google}
            >
              Pay with Suize
            </button>
          )}
          <ConnectModal
            trigger={
              <button type="button" className="btn btn-block auth-secondary">
                Connect a wallet
              </button>
            }
            walletFilter={is_standard_wallet}
          />
        </>
      )}

      {phase.step === 'error' && <div className="error">{phase.message}</div>}

      <p className="fineprint">
        Suize does not vet merchants — check the{' '}
        {destination.kind === 'handle' || merchantName ? 'handle' : 'address'} above is who you
        mean to pay. Payment is gas-free;{' '}
        {address
          ? is_suize
            ? 'you sign with your Google account and your keys never leave your machine.'
            : `you approve the transaction in ${wallet_label} — your keys stay in your wallet.`
          : 'sign in with Google right here — your keys never leave your machine. Or connect any Sui wallet; both sign locally on this page.'}
      </p>
    </div>
  )
}
