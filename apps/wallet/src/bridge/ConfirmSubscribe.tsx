/**
 * /confirm-subscribe — the suite's RECURRING money gate: a visible, top-level
 * wallet-origin popup other *.suize.io products open to set up (or cancel) a
 * subscription against the signed-in Suize session. Mirrors `ConfirmPay` exactly:
 * same BRIDGE_V, same origin-pinning + `ready` beacon — for the `SubscribeTerms`
 * pair (defined in `@suize/shared/bridge`). Signed-out sign-in opens the Enoki
 * OAuth popup; this window stays open and its session updates reactively.
 *
 * THE INTEGRITY RULE — display = build: this window receives the subscription
 * TERMS (merchant / amount / periodMs / ref), renders them, and on approval builds
 * the `subs::subscription::create` PTB ITSELF from those same terms (push-not-pull:
 * period 1 is paid inline). A malicious parent cannot show one cap and sign another.
 *
 * WHY SPONSORED (not vanilla-x402): `create` mints a persistent Party object →
 * not fully gas-rebatable → it needs the Enoki sponsor. So this window runs the WS
 * lifecycle (sign-once-at-connect) and rides the sponsor path (`sponsored.ts`),
 * exactly like the wallet's own subscription writes — the key still never leaves
 * the machine; the backend only pays gas.
 *
 * On success it records the APPROVED terms in `payStore` (the silent-renew leash —
 * the in-app loop only auto-renews terms the user approved) and posts the new
 * subscription's `subKey` back to the pinned opener.
 *
 *   mode 'create' (default): set up the subscription.
 *   mode 'cancel'          : read the live object + build `cancel` (reuses the same
 *                            popup; the opener sends a cancel-shaped terms object).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSignTransaction, useSuiClient } from '@mysten/dapp-kit';
import { MAX_MEMO_LEN, SUI_ADDRESS_RE, USDC_DECIMAL_RE } from '@suize/shared';
import {
  BRIDGE_V,
  type ConfirmReady,
  type SubscribeResultMsg,
  type SubscribeTerms,
} from '@suize/shared/bridge';
import { useAuth } from '../data/useAuth';
import { useWsLifecycle } from '../data/useWsLifecycle';
import { CONFIRM, CUSTODY_LINE } from '../ui/copy';
import { Loader } from '../system';
import { runSponsored, type SignTransaction } from '../data/sponsored';
import { buildCreate, subIdFromEvents } from '../data/subs';
import { setApprovedTerms } from '../data/payStore';
import { isAllowedBridgeOrigin } from './origins';
import '../ui/rd.css';

const validTerms = (t: SubscribeTerms | undefined | null): t is SubscribeTerms =>
  Boolean(
    t &&
      SUI_ADDRESS_RE.test(t.merchant) &&
      USDC_DECIMAL_RE.test(t.amount) &&
      Number(t.amount) > 0 &&
      typeof t.periodMs === 'number' &&
      t.periodMs > 0 &&
      typeof t.ref === 'string' &&
      t.ref.length <= MAX_MEMO_LEN &&
      (t.label === undefined || (typeof t.label === 'string' && t.label.length <= 64)),
  );

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** UI: "$X every N days" from the period ms. */
const everyN = (periodMs: number): string => {
  const days = Math.round(periodMs / 86_400_000);
  if (days <= 0) return 'each period';
  if (days === 1) return 'every day';
  if (days % 30 === 0 && days >= 30) {
    const months = days / 30;
    return months === 1 ? 'every month' : `every ${months} months`;
  }
  return `every ${days} days`;
};
/** ui base units for the period price (decimal → bigint, 6 dp). */
const toUnits = (amount: string): bigint => {
  const m = USDC_DECIMAL_RE.exec(amount);
  if (!m) return 0n;
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
};

type Stage =
  | { step: 'waiting' }
  | { step: 'review'; busy?: string }
  | { step: 'done' }
  | { step: 'closedout' }
  | { step: 'error'; message: string }
  | { step: 'no-opener' };

export function ConfirmSubscribe() {
  const auth = useAuth();
  // The sponsor path is WS-only — connect the socket the moment we're signed in.
  useWsLifecycle(auth.ownerAddress);
  const client = useSuiClient();
  const { mutateAsync: signTransactionRaw } = useSignTransaction();
  const signTransaction = signTransactionRaw as unknown as SignTransaction;

  const [stage, setStage] = useState<Stage>({ step: 'waiting' });
  const [terms, setTerms] = useState<SubscribeTerms | null>(null);
  const openerOriginRef = useRef<string | null>(null);

  // ── 1. Acquire terms: beacon the opener until it sends them. ──
  useEffect(() => {
    if (!window.opener) {
      setStage({ step: 'no-opener' });
      return;
    }

    let accepted = false;
    const onMessage = (event: MessageEvent) => {
      if (accepted) return;
      const msg = event.data as { type?: string; v?: number; terms?: SubscribeTerms } | null;
      if (!msg || msg.type !== 'suize-subscribe-terms' || msg.v !== BRIDGE_V) return;
      if (!isAllowedBridgeOrigin(event.origin)) return;
      if (event.source !== window.opener) return;
      if (!validTerms(msg.terms)) return;
      accepted = true;
      openerOriginRef.current = event.origin;
      setTerms(msg.terms);
      setStage({ step: 'review' });
      window.clearInterval(beacon);
    };
    window.addEventListener('message', onMessage);

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
        /* opener gone */
      }
    }, 250);

    return () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(beacon);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const postResult = useCallback((result: SubscribeResultMsg) => {
    const origin = openerOriginRef.current;
    try {
      if (origin && window.opener) (window.opener as Window).postMessage(result, origin);
    } catch {
      /* opener gone */
    }
  }, []);

  const cancel = useCallback(() => {
    postResult({ type: 'suize-subscribe-result', v: BRIDGE_V, ok: false, cancelled: true });
    setStage({ step: 'closedout' });
    window.setTimeout(() => window.close(), 400);
  }, [postResult]);

  const approve = useCallback(async () => {
    if (!terms || !auth.ownerAddress) return;
    try {
      setStage({ step: 'review', busy: CONFIRM.working.build });
      const amountRaw = toUnits(terms.amount);
      // Build the create PTB from the DISPLAYED terms (display=build), then sponsor
      // + sign locally and read the new subscription id from the receipt events.
      const tx = buildCreate({
        merchant: terms.merchant,
        amountRaw,
        periodMs: terms.periodMs,
        refHex: terms.ref,
      });
      setStage({ step: 'review', busy: CONFIRM.working.submit });
      const digest = await runSponsored({
        tx,
        owner: auth.ownerAddress,
        client: client as unknown as Parameters<typeof runSponsored>[0]['client'],
        signTransaction,
      });
      const res = await client.waitForTransaction({ digest, options: { showEvents: true } });
      const subId = subIdFromEvents(res.events ?? []);
      if (subId) {
        // Record the leash: the silent-renew loop only auto-renews THESE terms.
        setApprovedTerms(auth.ownerAddress, subId, {
          merchant: terms.merchant,
          amountRaw: amountRaw.toString(),
          periodMs: terms.periodMs,
        });
      }
      postResult({
        type: 'suize-subscribe-result',
        v: BRIDGE_V,
        ok: true,
        digest,
        // SubscribeResultMsg carries a numeric subKey for forward-compat; the new
        // model's id is an object id (string). We pass 0 when none was parsed — the
        // opener uses the digest as the durable receipt either way.
        subKey: 0,
      });
      setStage({ step: 'done' });
      window.setTimeout(() => window.close(), 1500);
    } catch (e) {
      setStage({ step: 'error', message: (e as Error).message || 'Could not set up the subscription.' });
    }
  }, [terms, auth.ownerAddress, client, signTransaction, postResult]);

  // ── Sign-in: opens the Enoki OAuth popup; this window stays open and its
  //    session updates reactively on return (no redirect, nothing to stash). ──
  const signIn = useCallback(() => {
    if (!terms || !openerOriginRef.current) return;
    void auth.signInWithGoogle();
  }, [terms, auth]);

  // ── Render (the rd-confirm card, recurring framing) ──
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
            <div className="rd-confirm__head">Set up subscription</div>
            <div className="rd-confirm__body">
              {terms.label ? <span className="rd-confirm__merchant">{terms.label}</span> : null}
              <span className="rd-confirm__detail rd-confirm__detail--mono">{shortAddr(terms.merchant)}</span>
              <span className="rd-confirm__amount">${terms.amount}</span>
              <span className="rd-confirm__source">{everyN(terms.periodMs)} · first charge now</span>
              <span className="rd-confirm__source">Cancel anytime in your wallet</span>
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
                  Subscribe · ${terms.amount}
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

            {stage.step === 'done' ? <div className="rd-confirm__done">Subscribed — you can close this window.</div> : null}
            {stage.step === 'closedout' ? <div className="rd-confirm__done">{CONFIRM.cancelled}</div> : null}

            {stage.step === 'review' ? <p className="rd-confirm__custody">{capitalize(CUSTODY_LINE)}</p> : null}
          </article>
        ) : null}
      </div>
    </div>
  );
}
