/**
 * /confirm — the suite's MONEY GATE: a visible, top-level wallet-origin popup
 * other *.suize.io products open to charge the signed-in Suize session.
 * Protocol: `@suize/shared/bridge`; policy: `origins.ts`.
 *
 * THE INTEGRITY RULE — display = build: this window receives the payment TERMS
 * (payTo / amount / memo), renders them, and on approval builds the gasless
 * `send_funds` PTB ITSELF from those same terms (vanilla x402: GET /terms for the
 * fee split → @suize/x402 buildGaslessOutputs → assertUnsignedBytesSafe →
 * dapp-kit signTransaction → POST /settle). The OPENER never supplies tx bytes,
 * AND this window builds the outputs it just displayed, so the guarantee is
 * END-TO-END here: a malicious parent cannot show one amount and have another
 * signed, and the backend only re-verifies + broadcasts the payer's OWN signed
 * gasless tx (it never signs the payer leg). Only the digest goes back.
 * `toHandle` is a display label — the payTo hex is always printed too.
 *
 * Flow:
 *   1. Beacon `ready` to the opener (no payload) until `terms` arrive; accept
 *      terms ONLY from an allowlisted origin that IS the opener; pin it.
 *   2. Signed out → "Continue with Google" opens the Enoki OAuth popup. THIS
 *      window stays open throughout (the popup is a separate window), so its
 *      session just updates reactively on return — nothing to stash.
 *   3. Approve → build/sign/submit → post the result to the pinned origin.
 *      Cancel (or closing the window — the opener polls) → cancelled result.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSignTransaction } from '@mysten/dapp-kit';
import { MAX_MEMO_LEN, SUI_ADDRESS_RE, USDC_DECIMAL_RE } from '@suize/shared';
import {
  BRIDGE_V,
  type ConfirmReady,
  type ConfirmResultMsg,
  type ConfirmTerms,
} from '@suize/shared/bridge';
import { useAuth } from '../data/useAuth';
import { CONFIRM, CUSTODY_LINE } from '../ui/copy';
import { Loader } from '../system';
import { isAllowedBridgeOrigin } from './origins';
import { payViaX402 } from './facilitator';
import '../ui/rd.css';

const validTerms = (t: ConfirmTerms | undefined | null): t is ConfirmTerms =>
  Boolean(
    t &&
      SUI_ADDRESS_RE.test(t.payTo) &&
      USDC_DECIMAL_RE.test(t.amount) &&
      Number(t.amount) > 0 &&
      typeof t.memo === 'string' &&
      t.memo.length <= MAX_MEMO_LEN &&
      (t.toHandle === undefined || (typeof t.toHandle === 'string' && t.toHandle.length <= 64)),
  );

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Stage =
  | { step: 'waiting' } // beaconing for terms (or adopting the stash)
  | { step: 'review'; busy?: string } // terms on screen; busy while paying
  | { step: 'done' }
  | { step: 'closedout' } // cancelled
  | { step: 'error'; message: string }
  | { step: 'no-opener' };

export function ConfirmPay() {
  const auth = useAuth();
  const { mutateAsync: signTransaction } = useSignTransaction();

  const [stage, setStage] = useState<Stage>({ step: 'waiting' });
  const [terms, setTerms] = useState<ConfirmTerms | null>(null);
  const openerOriginRef = useRef<string | null>(null);

  // ── 1. Acquire terms: beacon the opener until it sends them. ──
  useEffect(() => {
    if (!window.opener) {
      setStage({ step: 'no-opener' });
      return;
    }

    let accepted = false; // first valid terms win — ignore any later message
    const onMessage = (event: MessageEvent) => {
      if (accepted) return;
      const msg = event.data as { type?: string; v?: number; terms?: ConfirmTerms } | null;
      if (!msg || msg.type !== 'suize-confirm-terms' || msg.v !== BRIDGE_V) return;
      // THE gate: allowlisted origin AND it must actually be our opener.
      if (!isAllowedBridgeOrigin(event.origin)) return;
      if (event.source !== window.opener) return;
      if (!validTerms(msg.terms)) return;
      accepted = true;
      openerOriginRef.current = event.origin;
      setTerms(msg.terms);
      setStage({ step: 'review' });
      window.clearInterval(beacon); // stop beaconing — we have our terms
    };
    window.addEventListener('message', onMessage);

    // Beacon until the opener answers (it may still be attaching its listener),
    // then give up after a deadline (a stuck-waiting popup must not beacon
    // forever). Payload-free, so the '*' target is safe — terms come back
    // origin-checked.
    const ready: ConfirmReady = { type: 'suize-confirm-ready', v: BRIDGE_V };
    const beaconDeadline = Date.now() + 30_000;
    const beacon = window.setInterval(() => {
      if (Date.now() > beaconDeadline) {
        window.clearInterval(beacon);
        return;
      }
      try {
        (window.opener as Window | null)?.postMessage(ready, '*');
      } catch {
        /* opener gone — the no-result path is the opener's closed-poll */
      }
    }, 250);

    return () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(beacon);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const postResult = useCallback((result: ConfirmResultMsg) => {
    const origin = openerOriginRef.current;
    try {
      if (origin && window.opener) (window.opener as Window).postMessage(result, origin);
    } catch {
      /* opener gone — nothing to tell */
    }
  }, []);

  const cancel = useCallback(() => {
    postResult({ type: 'suize-pay-result', v: BRIDGE_V, ok: false, cancelled: true });
    setStage({ step: 'closedout' });
    window.setTimeout(() => window.close(), 400);
  }, [postResult]);

  const approve = useCallback(async () => {
    if (!terms || !auth.ownerAddress) return;
    try {
      setStage({ step: 'review', busy: CONFIRM.working.build });
      // AUTHORIZE mode (the Deploy no-Sui-key door): build + sign but DON'T settle —
      // hand back the signed payload for an agent to submit as X-PAYMENT (the merchant
      // settles it during the deploy, so nothing is on-chain before then). Default mode
      // settles on-chain and returns the digest.
      const authorize = terms.mode === 'authorize';
      const result = await payViaX402({
        sender: auth.ownerAddress,
        payTo: terms.payTo,
        amount: terms.amount,
        memo: terms.memo,
        settle: !authorize,
        // Enoki signs silently with the local session — no narration needed. The
        // facilitator only re-verifies + broadcasts these bytes; the key stays here.
        sign: async (bytes) => {
          setStage({ step: 'review', busy: CONFIRM.working.submit });
          const { signature } = await signTransaction({ transaction: bytes });
          return signature;
        },
      });
      postResult(
        'payment' in result
          ? { type: 'suize-pay-result', v: BRIDGE_V, ok: true, payment: result.payment }
          : { type: 'suize-pay-result', v: BRIDGE_V, ok: true, digest: result.digest },
      );
      setStage({ step: 'done' });
      window.setTimeout(() => window.close(), 1500);
    } catch (e) {
      const message = (e as Error).message || 'Payment failed.';
      setStage({ step: 'error', message });
    }
  }, [terms, auth.ownerAddress, signTransaction, postResult]);

  // ── Sign-in: opens the Enoki OAuth popup; this window stays open and its
  //    session updates reactively on return (no redirect, nothing to stash). ──
  const signIn = useCallback(() => {
    if (!terms || !openerOriginRef.current) return;
    void auth.signInWithGoogle();
  }, [terms, auth]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="rd">
      <div className="rd-amb" aria-hidden="true">
        <i />
      </div>
      <div className="rd-stage" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        {stage.step === 'no-opener' ? (
          <p style={{ maxWidth: 320, textAlign: 'center', color: 'var(--rd-fg-3)', font: '13px/1.5 inherit' }}>
            {CONFIRM.noOpener}
          </p>
        ) : stage.step === 'waiting' ? (
          <Loader eyebrow="Suize" label={CONFIRM.waiting} />
        ) : terms ? (
          <article
            className={`rd-confirm rd-glass rd-confirm--sso${
              stage.step === 'done' ? ' is-done' : stage.step === 'closedout' ? ' is-cancelled' : ''
            }`}
          >
            <div className="rd-confirm__head">{CONFIRM.label}</div>
            <div className="rd-confirm__body">
              {terms.toHandle ? <span className="rd-confirm__merchant">{terms.toHandle}</span> : null}
              <span className="rd-confirm__detail rd-confirm__detail--mono">
                {shortAddr(terms.payTo)}
              </span>
              <span className="rd-confirm__amount">${terms.amount}</span>
              <span className="rd-confirm__source">{CONFIRM.unitsDetail}</span>
              {auth.ownerAddress ? (
                <span className="rd-confirm__source">
                  {CONFIRM.fromLead} {shortAddr(auth.ownerAddress)}
                </span>
              ) : null}
            </div>

            {stage.step === 'review' && stage.busy ? (
              <div className="rd-confirm__acts">
                <span className="rd-confirm__source">{stage.busy}</span>
              </div>
            ) : stage.step === 'review' && auth.ownerAddress ? (
              <div className="rd-confirm__acts">
                <button type="button" className="rd-cta" onClick={() => void approve()}>
                  {CONFIRM.approve} ${terms.amount}
                </button>
                <button type="button" className="rd-btn" onClick={cancel}>
                  {CONFIRM.decline}
                </button>
              </div>
            ) : stage.step === 'review' ? (
              <div className="rd-confirm__acts rd-confirm__acts--col">
                <span className="rd-confirm__source">{CONFIRM.signInLead}</span>
                <button type="button" className="rd-cta" disabled={!auth.canSignIn} onClick={signIn}>
                  {CONFIRM.signInCta}
                </button>
                <button type="button" className="rd-btn" onClick={cancel}>
                  {CONFIRM.decline}
                </button>
              </div>
            ) : stage.step === 'error' ? (
              <div className="rd-confirm__acts rd-confirm__acts--col">
                <span className="rd-confirm__source rd-confirm__msg--bear">{stage.message}</span>
                <button type="button" className="rd-cta" onClick={() => void approve()}>
                  {CONFIRM.retry}
                </button>
                <button type="button" className="rd-btn" onClick={cancel}>
                  {CONFIRM.decline}
                </button>
              </div>
            ) : null}

            {stage.step === 'done' ? (
              <div className="rd-confirm__done">{CONFIRM.paid}</div>
            ) : null}
            {stage.step === 'closedout' ? (
              <div className="rd-confirm__done">{CONFIRM.cancelled}</div>
            ) : null}

            {/* The custody reassurance at the money moment (verbatim law). */}
            {stage.step === 'review' ? (
              <p className="rd-confirm__custody">{capitalize(CUSTODY_LINE)}</p>
            ) : null}
          </article>
        ) : null}
      </div>
    </div>
  );
}
