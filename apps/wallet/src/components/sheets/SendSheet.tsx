/**
 * SendSheet — send to a name OR an address (SPEC §3 Group E · §4 SEND).
 *
 * REAL manual transfer now. On confirm the sheet calls `onSend` (wired to
 * `home.send` in WalletShell), which builds the transfer PTB (buildTransfer /
 * buildTransferSuiSponsored) -> wsSponsor -> sign -> wsExecute and returns the
 * executed tx digest. The amount the user types is in COIN units (e.g. "5" SUI);
 * the sheet converts it to the coin's smallest unit (bigint, no float drift) using
 * the selected currency's decimals before handing it to `onSend`.
 *
 * Props: { currencies, onClose, onSend? }.
 *
 * Contents:
 *   - a CurrencySelect (which coin to send)
 *   - ONE multi-format recipient field: paste a hex 0x… address OR a name@suize.
 *     Typing is debounced, then verified via resolveRecipient(input) ->
 *     { kind:'hex'|'name', address|null }. State surfaces as verifying / verified / not found.
 *   - an amount field
 *   - a gas line: "Free" when the chosen coin is in SPONSORED_COINS (gasless, the
 *     SAME set that drives the real sponsor routing), else "≈ <n> SUI gas".
 *   - NO advanced toggle.
 *
 * Three terminal states after the user hits Send:
 *   - sending  — the button shows `busy`, controls locked
 *   - sent     — "Sent <amt> <SYM> to <name/addr>" + a tappable digest link; on a
 *                sponsored stablecoin the fee line reads Free
 *   - error    — a calm inline line (no alarm); the user can retry
 *
 * "Weird highlight" fix: inputs use the system <Field/> (border-only emphasis, no
 * bubble/box-shadow) and the recipient field's status is shown as a quiet suffix.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { Sheet } from './Sheet';
import { CurrencySelect } from './CurrencySelect';
import { Button, Field, Check, X, ExternalLink, ICON_STROKE } from '../../system';
import type { Currency } from '../../data/types';
import { SPONSORED_COINS } from '../../data/coins';
import { resolveRecipient, type SuiClient } from '../../data/suins';
import { EXPLORER_TX } from '../../lib/env';

/**
 * The real send executor. Mirrors `HomeApi.send` exactly so WalletShell can wire
 * it as `onSend={home.send}` with no adapter: build the transfer PTB, sponsor it
 * over the WS (iff the coin is sponsored, else self-pay), and resolve the digest.
 */
export interface SendExecArgs {
  /** the coin type being sent. */
  coinType: string;
  /** the resolved recipient address (0x…). */
  recipient: string;
  /** amount in the coin's smallest unit (Mist for SUI, 1e-6 for USDC). */
  amountRaw: bigint;
}

export interface SendSheetProps {
  currencies: Currency[];
  onClose: () => void;
  /**
   * The real submit hook (wired to `home.send`). Returns the executed tx digest.
   * Optional so the sheet renders standalone in previews; when absent the confirm
   * button stays inert (no fake success).
   */
  onSend?: (args: SendExecArgs) => Promise<string>;
}

type RecipientState = 'idle' | 'verifying' | 'verified' | 'notfound';
type SendPhase = 'idle' | 'sending' | 'sent' | 'error';

/** Flat SUI gas estimate for non-sponsored coins (display-only, deterministic). */
const SUI_GAS_EST = '0.002';

/**
 * Parse a human decimal string into the coin's smallest unit (bigint), WITHOUT
 * floating point — float math drops precision on large balances. Returns null when
 * the input is not a clean non-negative decimal or resolves to zero. Excess
 * fractional digits beyond `decimals` are truncated (never rounded up past intent).
 */
function toBaseUnits(amount: string, decimals: number): bigint | null {
  const trimmed = amount.trim();
  // one optional decimal point, digits either side; reject signs / exponents / junk.
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') return null;
  const [whole = '', frac = ''] = trimmed.split('.');
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, '0');
  const digits = `${whole}${fracPadded}`.replace(/^0+/, '') || '0';
  let raw: bigint;
  try {
    raw = BigInt(digits);
  } catch {
    return null;
  }
  return raw > 0n ? raw : null;
}

export function SendSheet({ currencies, onClose, onSend }: SendSheetProps) {
  const [coinType, setCoinType] = useState<string>(currencies[0]?.type ?? '');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [recipientState, setRecipientState] = useState<RecipientState>('idle');
  const [resolvedAddr, setResolvedAddr] = useState<string | null>(null);

  const [phase, setPhase] = useState<SendPhase>('idle');
  const [digest, setDigest] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const recipientRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  // dapp-kit's live SuiClient — threaded into resolveRecipient for the on-chain
  // SuiNS lookup (hex passthrough needs no RPC; a name resolves via this client).
  const client = useSuiClient() as SuiClient;

  // autofocus the recipient field on open (the first field).
  useEffect(() => {
    const t = window.setTimeout(() => recipientRef.current?.focus(), 360);
    return () => window.clearTimeout(t);
  }, []);

  const selected = useMemo(
    () => currencies.find((c) => c.type === coinType),
    [currencies, coinType],
  );

  const gasless = SPONSORED_COINS.has(coinType);

  // debounced recipient verification (hex passthrough OR SuiNS resolve).
  useEffect(() => {
    const input = to.trim();
    if (input.length < 2) {
      setRecipientState('idle');
      setResolvedAddr(null);
      return;
    }
    setRecipientState('verifying');
    const id = ++reqId.current;
    const t = window.setTimeout(() => {
      void resolveRecipient(input, client).then(
        (res) => {
          if (id !== reqId.current) return; // a newer keystroke superseded this
          if (res && res.address) {
            setResolvedAddr(res.address);
            setRecipientState('verified');
          } else {
            setResolvedAddr(null);
            setRecipientState('notfound');
          }
        },
        () => {
          if (id !== reqId.current) return;
          setResolvedAddr(null);
          setRecipientState('notfound');
        },
      );
    }, 600);
    return () => window.clearTimeout(t);
  }, [to, client]);

  const recipientSuffix = (() => {
    if (recipientState === 'verifying')
      return <span style={{ color: 'var(--ink-3)' }}>verifying…</span>;
    if (recipientState === 'verified')
      return (
        <span style={{ color: 'var(--good)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Check size={13} strokeWidth={ICON_STROKE} aria-hidden /> verified
        </span>
      );
    if (recipientState === 'notfound')
      return (
        <span style={{ color: 'var(--warn)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <X size={13} strokeWidth={ICON_STROKE} aria-hidden /> not found
        </span>
      );
    return null;
  })();

  const fieldState =
    recipientState === 'verified' ? 'ok' : recipientState === 'notfound' ? 'bad' : 'idle';

  // The real base-unit amount, or null when the typed amount isn't a valid >0 number.
  const amountRaw = useMemo(
    () => (selected ? toBaseUnits(amount, selected.decimals) : null),
    [amount, selected],
  );

  const sending = phase === 'sending';
  const sent = phase === 'sent';
  const canSend =
    recipientState === 'verified' &&
    !!resolvedAddr &&
    amountRaw != null &&
    !!onSend &&
    !sending &&
    !sent;

  const onSubmit = useCallback(() => {
    if (!resolvedAddr || amountRaw == null || !onSend || sending || sent) return;
    setPhase('sending');
    setErrMsg(null);
    void onSend({ coinType, recipient: resolvedAddr, amountRaw }).then(
      (txDigest) => {
        setDigest(txDigest);
        setPhase('sent');
      },
      (e: unknown) => {
        // Calm, human error — never a raw stack. Surface the message if it's a
        // clean Error, otherwise a quiet fallback. The user can retry.
        const msg =
          e instanceof Error && e.message ? e.message : 'Could not send. Please try again.';
        setErrMsg(msg);
        setPhase('error');
      },
    );
  }, [resolvedAddr, amountRaw, onSend, sending, sent, coinType]);

  // success label: "Sent <amt> <SYM> to <to>"
  const sentTo = to.trim() || (resolvedAddr ? `${resolvedAddr.slice(0, 8)}…` : '');
  const buttonLabel = sent
    ? `Sent ${amount || '0'} ${selected?.sym ?? ''} to ${sentTo}`
    : sending
      ? 'Sending…'
      : 'Send';

  return (
    <Sheet title="Send money" sub="Send to a name or address." onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* currency */}
        <CurrencySelect
          label="Currency"
          value={coinType}
          onChange={setCoinType}
          currencies={currencies}
        />

        {/* recipient — ONE multi-format field */}
        <div>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 10.5,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              marginBottom: 8,
            }}
          >
            To
          </div>
          <Field
            ref={recipientRef}
            value={to}
            onChange={(e) => setTo(e.currentTarget.value)}
            placeholder="name@suize  or  0x…"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            state={fieldState}
            suffix={recipientSuffix}
            disabled={sending || sent}
          />
        </div>

        {/* amount */}
        <div>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 10.5,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              marginBottom: 8,
            }}
          >
            Amount
          </div>
          <Field
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
            placeholder="0.00"
            inputMode="decimal"
            prefix="$"
            suffix={selected?.sym ?? ''}
            disabled={sending || sent}
          />
        </div>

        {/* gas line */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontFamily: 'var(--mono)',
            fontSize: 12,
          }}
        >
          <span style={{ color: 'var(--ink-3)' }}>Network fee</span>
          {gasless ? (
            <span style={{ color: 'var(--good)', letterSpacing: '0.02em' }}>Free</span>
          ) : (
            <span className="tnum" style={{ color: 'var(--ink-2)' }}>
              ≈ {SUI_GAS_EST} SUI gas
            </span>
          )}
        </div>

        {/* calm error line — no alarm; the 'Send' action stays available to retry */}
        {phase === 'error' && errMsg ? (
          <p
            role="alert"
            style={{
              margin: 0,
              fontFamily: 'var(--mono)',
              fontSize: 11.5,
              lineHeight: 1.6,
              letterSpacing: '0.02em',
              color: 'var(--warn)',
            }}
          >
            {errMsg}
          </p>
        ) : null}

        <Button
          variant="primary"
          size="lg"
          onClick={onSubmit}
          disabled={!canSend}
          busy={sending}
          style={
            sent
              ? {
                  color: '#fff',
                  borderColor: 'var(--good)',
                  background: 'var(--good)',
                  boxShadow: 'none',
                }
              : undefined
          }
        >
          {buttonLabel}
        </Button>

        {/* success: a quiet, tappable link to the real tx on the explorer */}
        {sent && digest ? (
          <a
            href={EXPLORER_TX(digest)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              fontFamily: 'var(--mono)',
              fontSize: 11.5,
              letterSpacing: '0.04em',
              color: 'var(--ink-3)',
              textDecoration: 'none',
            }}
          >
            View transaction
            <ExternalLink size={12} strokeWidth={ICON_STROKE} aria-hidden />
          </a>
        ) : null}
      </div>
    </Sheet>
  );
}

export default SendSheet;
