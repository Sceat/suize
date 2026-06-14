/**
 * The subscriptions hook — the LIST + the SILENT-RENEW loop (the client-side half
 * of the push-not-pull subscription rail).
 *
 * THE MODEL (CLAUDE.md two-control-layers): on-chain physics fix the payee + the
 * per-period price + the 24h renewal window; the SILENT auto-renew is a CLIENT-SIDE
 * policy dial. We only ever auto-renew a subscription whose LIVE on-chain terms
 * (merchant + amount + period) still equal the terms the user APPROVED at create
 * (the `payStore` approved-terms leash) — so a (hypothetical) terms change can never
 * trigger an unapproved auto-charge.
 *
 * THE LOOP: on mount + every visibilitychange→visible (throttled to once an hour),
 * for each live subscription where `now >= paidUntilMs − 24h` (the on-chain renewal
 * window is open) AND the live terms === the approved entry:
 *   buildRenew → sponsor over the WS → sign silently with the session → quiet toast.
 * `ETooEarly` (abort code 0) is a no-op skip (the window isn't actually open yet —
 * a clock-skew race); any OTHER abort surfaces. A subscription past its paid-through
 * with no successful renew is LAPSED — flagged in the list (the deck shows it).
 *
 * RENEWALS ARE SPONSORED, NOT VANILLA-X402: a renew is a Party-object owner tx the
 * relayer can only SPONSOR (never sign), so it rides the existing WS sponsor path
 * (`sponsored.ts`), exactly like cancel. (A live backend relayer triggers the same
 * renew server-side when the app is closed; this hook is the in-app fast path.)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSignTransaction, useSuiClient } from '@mysten/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { SUBS_PUBLISHED } from '@suize/shared';
import { runSponsored, type SignTransaction } from './sponsored';
import { buildRenew, listSubscriptions, type OwnedObjectsClient } from './subs';
import { getApprovedTermsFor, type ApprovedTerms } from './payStore';
import type { Subscription } from './payTypes';

/** A subscription enriched with its derived UI state (active / due-soon / lapsed). */
export interface SubRowState extends Subscription {
  /** the subscription is paid past `now` (still active). */
  active: boolean;
  /** the subscription has lapsed: `now >= paidUntilMs` and no auto-renew covered it. */
  lapsed: boolean;
  /** the 24h renewal window is open (`now >= paidUntilMs − 24h`). */
  dueSoon: boolean;
}

/** A transient toast the deck shows after a silent renew. */
export interface RenewToast {
  id: string;
  message: string;
}

/** ETooEarly — the subs module's abort code 0 (renewal window not yet open). */
const E_TOO_EARLY = 0;
/** The on-chain renewal window: a sub renews once within 24h of its paid-through. */
const RENEW_WINDOW_MS = 86_400_000;
/** Throttle the silent-renew sweep to at most once an hour (per tab). */
const SWEEP_THROTTLE_MS = 60 * 60 * 1000;

function shortAmount(raw: string): string {
  return `$${(Number(raw) / 1_000_000).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** True when the LIVE on-chain terms equal the terms the user approved at create. */
function termsMatch(sub: Subscription, approved: ApprovedTerms | null): boolean {
  if (!approved) return false;
  return (
    sub.merchant.toLowerCase() === approved.merchant.toLowerCase() &&
    sub.amountRaw === approved.amountRaw &&
    sub.periodMs === approved.periodMs
  );
}

/** Parse a Move abort code out of a thrown execution error message (best-effort). */
function abortCode(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  // Sui surfaces "MoveAbort(..., <code>)" or "abort code: <code>".
  const m = /MoveAbort\([^)]*?,\s*(\d+)\)|abort(?:ed)?\s*(?:code)?[:\s]+(\d+)/i.exec(msg);
  if (!m) return null;
  const code = m[1] ?? m[2];
  return code != null ? Number(code) : null;
}

export interface UseSubscriptions {
  /** the live subscriptions enriched with active/lapsed/due state, newest first. */
  rows: SubRowState[];
  /** true while the first list read is settling. */
  loading: boolean;
  /** transient renew toasts (the deck renders + auto-dismisses these). */
  toasts: RenewToast[];
  /** force a re-read (after a create/cancel lands elsewhere). */
  refresh(): void;
}

/**
 * `useSubscriptions(owner)` — the list + the silent-renew loop. `enabled` lets the
 * caller suppress the loop (e.g. the DEV demo seam) while still typing cleanly.
 */
export function useSubscriptions(owner: string | null | undefined, enabled = true): UseSubscriptions {
  const client = useSuiClient();
  const { mutateAsync: signTransactionRaw } = useSignTransaction();
  const signTransaction = signTransactionRaw as unknown as SignTransaction;
  const addr = owner ?? '';

  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const [toasts, setToasts] = useState<RenewToast[]>([]);
  const sweepingRef = useRef(false);
  const lastSweepRef = useRef(0);

  const listQuery = useQuery({
    queryKey: ['subs-list', addr, version],
    enabled: addr.length > 0 && SUBS_PUBLISHED && enabled,
    staleTime: 8_000,
    queryFn: (): Promise<Subscription[]> =>
      listSubscriptions(client as unknown as OwnedObjectsClient, addr),
  });

  const pushToast = useCallback((message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((t) => [...t, { id, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6_000);
  }, []);

  // ── The silent-renew sweep. ──
  const sweep = useCallback(async () => {
    if (!addr || !SUBS_PUBLISHED || !enabled) return;
    if (sweepingRef.current) return;
    if (Date.now() - lastSweepRef.current < SWEEP_THROTTLE_MS) return;
    sweepingRef.current = true;
    lastSweepRef.current = Date.now();
    try {
      // Read the freshest list (not the cached query) so we never renew a sub that
      // was just cancelled in another tab.
      const subs = await listSubscriptions(client as unknown as OwnedObjectsClient, addr);
      const now = Date.now();
      let renewedAny = false;
      for (const sub of subs) {
        const windowOpen = now >= sub.paidUntilMs - RENEW_WINDOW_MS;
        if (!windowOpen) continue;
        const approved = getApprovedTermsFor(addr, sub.id);
        if (!termsMatch(sub, approved)) continue; // never auto-charge un-approved terms
        try {
          await runSponsored({
            tx: buildRenew({ subId: sub.id, amountRaw: BigInt(sub.amountRaw) }),
            owner: addr,
            client: client as unknown as Parameters<typeof runSponsored>[0]['client'],
            signTransaction,
          });
          renewedAny = true;
          pushToast(`Renewed ${sub.label} · ${shortAmount(sub.amountRaw)}`);
        } catch (e) {
          // ETooEarly (window not yet open under clock skew) → quiet skip.
          if (abortCode(e) === E_TOO_EARLY) continue;
          // Any other failure surfaces (insufficient funds, network) — but never
          // blocks the rest of the sweep.
          pushToast(`Couldn’t renew ${sub.label} — ${e instanceof Error ? e.message : 'try again'}`);
        }
      }
      if (renewedAny) refresh();
    } catch {
      // A transient list-read failure — the next sweep retries (no toast for a read blip).
    } finally {
      sweepingRef.current = false;
    }
  }, [addr, enabled, client, signTransaction, pushToast, refresh]);

  // Run on mount (once a list exists) + every visibilitychange→visible (throttled).
  useEffect(() => {
    if (!addr || !enabled) return;
    void sweep();
    const onVisible = () => {
      if (!document.hidden) void sweep();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [addr, enabled, sweep]);

  const now = Date.now();
  const rows: SubRowState[] = (listQuery.data ?? []).map((sub) => {
    const active = now < sub.paidUntilMs;
    return {
      ...sub,
      active,
      lapsed: !active,
      dueSoon: now >= sub.paidUntilMs - RENEW_WINDOW_MS,
    };
  });

  return { rows, loading: listQuery.isLoading, toasts, refresh };
}
