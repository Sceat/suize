/**
 * The wallet `/confirm-subscribe` popup opener (the deploy app's client side of the
 * SSO confirm dance). The wallet origin (wallet.suize.io) is the suite's ONE money
 * gate: this app opens its visible `/confirm-subscribe` popup, sends the subscription
 * TERMS, and the popup builds + signs + submits the `subs::subscription::create` tx
 * ITSELF (display = build — a malicious parent can't show one cap and sign another),
 * returning only the digest. The key never leaves the wallet origin.
 *
 * Protocol + security model: `@suize/shared/bridge`. Transport: the popup beacons
 * `suize-confirm-ready`, this opener answers `suize-subscribe-terms` (the popup
 * origin-checks it), the popup posts `suize-subscribe-result` back to THIS pinned
 * origin. Mirrors `apps/wallet/src/bridge/ConfirmSubscribe.tsx`.
 *
 * NOTE: intentionally duplicated DOM client code (like bridge-sso.ts) — it can't
 * live in the isomorphic `@suize/shared`. Extract to a shared bridge-client package
 * if a 4th consumer appears.
 */

import {
  BRIDGE_V,
  type SubscribeTerms,
  type SubscribeResultMsg,
} from '@suize/shared/bridge'

// The wallet origin that hosts /confirm-subscribe. Env-tunable (shared with the
// bridge iframe origin); dev → the wallet dev server (5180), prod → wallet.suize.io.
const WALLET_ORIGIN: string = (
  import.meta.env.VITE_BRIDGE_ORIGIN?.trim() ||
  (import.meta.env.DEV ? 'http://localhost:5180' : 'https://wallet.suize.io')
).replace(/\/+$/, '')

const SUBSCRIBE_PATH = '/confirm-subscribe' // sibling of CONFIRM_PATH on the wallet

export interface SubscribeResult {
  ok: boolean
  cancelled?: boolean
  digest?: string
  error?: string
}

/**
 * Open the wallet's `/confirm-subscribe` popup, hand it `terms`, and resolve with
 * the result (the create-subscription digest on approve, or a cancel/error). The
 * popup is a visible top-level window the user approves in. Rejects only if the
 * popup is blocked.
 */
export function openSubscribePopup(terms: SubscribeTerms): Promise<SubscribeResult> {
  // A centered popup (visible — the suite's money gate is never silent).
  const w = 440
  const h = 720
  const left = Math.max(0, Math.round((window.screen.width - w) / 2))
  const top = Math.max(0, Math.round((window.screen.height - h) / 2))
  const popup = window.open(
    `${WALLET_ORIGIN}${SUBSCRIBE_PATH}`,
    'suize-subscribe',
    `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`,
  )
  if (!popup) {
    return Promise.reject(
      new Error('Popup blocked — allow popups for this site, then try again.'),
    )
  }

  return new Promise<SubscribeResult>(resolve => {
    let settled = false
    const finish = (r: SubscribeResult): void => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      window.clearInterval(closedTimer)
      resolve(r)
    }

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== WALLET_ORIGIN) return
      const msg = event.data as { type?: string; v?: number } | null
      // The popup beacons `suize-confirm-ready` when it's listening → send the terms.
      if (msg?.type === 'suize-confirm-ready' && msg.v === BRIDGE_V) {
        popup.postMessage(
          { type: 'suize-subscribe-terms', v: BRIDGE_V, terms },
          WALLET_ORIGIN,
        )
        return
      }
      if (msg?.type === 'suize-subscribe-result' && msg.v === BRIDGE_V) {
        const r = msg as SubscribeResultMsg
        finish(
          r.ok
            ? { ok: true, digest: r.digest }
            : { ok: false, cancelled: r.cancelled, error: r.error },
        )
      }
    }
    window.addEventListener('message', onMessage)

    // If the user closes the popup without a result, treat it as a cancel.
    const closedTimer = window.setInterval(() => {
      if (popup.closed) finish({ ok: false, cancelled: true })
    }, 500)
  })
}

/** The wallet manage-subscriptions URL (the cancel destination — see the STUB in
 * SiteDetail). Cancel-on-chain (`subs::subscription::cancel`) is NOT a popup mode
 * yet; the user cancels in the wallet's own subscriptions surface. */
export const walletManageUrl = (): string => `${WALLET_ORIGIN}/` // STUB(deploy): no deep-link to a manage-subs route yet
