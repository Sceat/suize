// Process-global daily spend ceilings — the gas-drain backstop.
//
// The Enoki sponsor pool and the deploy service wallet are spent on EVERY
// sponsored / on-chain tx. A jailbroken client cannot STEAL funds (the sponsor
// pins allowedAddresses=[sender]), but it CAN burn our gas by looping cheap,
// individually-valid txs faster than the per-IP/per-address token bucket alone
// can stop (IPs and zkLogin addresses are cheap to mint). These counters are a
// HARD daily cap on the total number of sponsored txs this replica will fund,
// plus a per-key sub-cap so one identity can't eat the whole day's budget.
//
// In-memory only (no Redis): not cross-replica, which is acceptable — a single
// replica's ceiling already blunts a drain loop, and Enoki's own pool budget is
// the ultimate hard cap. The window resets 24h after first use.
//
// `consume()` is the gate: call it AFTER cheap validation but BEFORE the Enoki /
// on-chain call. It increments only when it ALLOWS (so a rejected request never
// burns budget); on `deny` the caller returns 429.
import { config } from "./config";

export interface DailyCeiling {
  /** Try to reserve one unit for `key`. Increments counters only when allowed. */
  consume(key: string): { ok: true } | { ok: false; scope: "global" | "address" };
  /** Current global count in the active window (diagnostics/tests). */
  count(): number;
}

interface CeilingOpts {
  /** Max units across ALL keys per 24h window. */
  globalMax: number;
  /** Max units for any single key per 24h window. */
  perKeyMax: number;
  /** Window length in ms (default 24h). */
  windowMs?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const createDailyCeiling = (opts: CeilingOpts): DailyCeiling => {
  const windowMs = opts.windowMs ?? DAY_MS;
  let windowStart = Date.now();
  let globalCount = 0;
  const perKey = new Map<string, number>();

  const rollIfExpired = (now: number): void => {
    if (now - windowStart >= windowMs) {
      windowStart = now;
      globalCount = 0;
      perKey.clear();
    }
  };

  return {
    consume(key: string) {
      const now = Date.now();
      rollIfExpired(now);
      if (globalCount >= opts.globalMax) return { ok: false, scope: "global" };
      const used = perKey.get(key) ?? 0;
      if (used >= opts.perKeyMax) return { ok: false, scope: "address" };
      globalCount += 1;
      perKey.set(key, used + 1);
      return { ok: true };
    },
    count() {
      rollIfExpired(Date.now());
      return globalCount;
    },
  };
};

// ── Token budget (sum-of-tokens per key per day) ────────────────────────────
// The COUNT ceiling above caps the NUMBER of units; the brain instead caps the
// SUM of tokens a user spends on inference per day. `over()` is the PRE-GATE
// (checked BEFORE a model call — a user already past the cap is refused with the
// work-in-progress notice, no call made); `record()` adds the actual usage AFTER
// the call returns. In-memory, per-replica, 24h window — same trade-off as the
// ceiling above (a single replica's cap blunts abuse; the model API's own org
// limits are the ultimate backstop).
export interface DailyTokenBudget {
  /** True when `key` has already met/exceeded the daily token cap. */
  over(key: string): boolean;
  /** Add `tokens` spent by `key` in the active window. */
  record(key: string, tokens: number): void;
}

export const createDailyTokenBudget = (
  perKeyMax: number,
  windowMs: number = DAY_MS,
): DailyTokenBudget => {
  let windowStart = Date.now();
  const perKey = new Map<string, number>();
  const roll = (now: number): void => {
    if (now - windowStart >= windowMs) {
      windowStart = now;
      perKey.clear();
    }
  };
  return {
    over(key) {
      roll(Date.now());
      return (perKey.get(key) ?? 0) >= perKeyMax;
    },
    record(key, tokens) {
      roll(Date.now());
      if (tokens > 0) perKey.set(key, (perKey.get(key) ?? 0) + tokens);
    },
  };
};

// ── Shared singletons (one per spending surface) ────────────────────────────
// Sponsor: every /sponsor + WS sponsorRequest funds an Enoki-sponsored tx.
export const sponsorDailyCeiling = createDailyCeiling({
  globalMax: config.sponsorDailyMax,
  perKeyMax: config.sponsorDailyPerAddressMax,
});

// Deploy: every /deploy mints an on-chain Site paid by the deploy wallet's SUI.
// Per-key cap == global (one IP shouldn't be sub-capped below the daily total for
// the demo); the global ceiling is the real backstop here.
export const deployDailyCeiling = createDailyCeiling({
  globalMax: config.deployDailyMax,
  perKeyMax: config.deployDailyMax,
});
