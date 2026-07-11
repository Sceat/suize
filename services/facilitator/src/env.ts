// Operator configuration — the whole fee policy, parsed from the Worker `env`.
//
// A Cloudflare Worker gets its config as the `env` argument to `fetch`, NOT from
// `process.env`, so we cannot parse at module load the way a Node service would.
// Instead we build a `FeePolicy` from `env` on the first request and memoize it
// per-isolate (env is fixed for the life of a deployment). Everything an operator
// tunes lives here:
//
//   FEE_BPS        default 200   (2%)          — the default rake, basis points.
//   FEE_FLOOR      default 10000 ($0.01, 6dp)  — the minimum fee, atomic units.
//   FEE_TREASURY   REQUIRED                     — where the fee lands. Either a plain
//                  0x… Sui address (used AS-IS) or a SuiNS name (resolved live over
//                  gRPC, hourly-cached, fail-closed — see fees.ts).
//   MERCHANT_RATES optional JSON  {"0x…":{"feeBps":N}} — per-merchant rate overrides.
//                  NO free tier: an absent entry pays FEE_BPS; the fee is never waived.
//   SUI_NETWORK    testnet | mainnet (default testnet).
//   SUI_GRPC_URL   optional override; defaults to the public fullnode gRPC base.

import {
  resolveNetwork,
  grpcUrl,
  caip2,
  USDC_TYPES,
  SUI_ADDRESS_RE,
  type SuiNetwork,
} from "@suize/shared";

/** The Worker environment — wrangler [vars] + secrets. Strings only (that is all a
 * Worker binding can be); typed optional so a missing REQUIRED one is a clear runtime
 * fail-closed rather than a type error. */
export interface Env {
  FEE_BPS?: string;
  FEE_FLOOR?: string;
  /** REQUIRED — a plain 0x… address (used as-is) OR a SuiNS name (resolved live). */
  FEE_TREASURY?: string;
  /** Optional JSON map { "0x<addr>": { "feeBps": N } } of per-merchant overrides. */
  MERCHANT_RATES?: string;
  SUI_NETWORK?: string;
  SUI_GRPC_URL?: string;
}

/** A per-merchant rate override parsed from MERCHANT_RATES. */
export interface MerchantRate {
  feeBps: bigint;
}

/** The resolved operator policy — everything verify/settle/supported need. Built
 * once per isolate from `Env`. `treasury` is the RAW FEE_TREASURY value; whether it
 * is an address or a name to resolve is `treasuryIsAddress`. */
export interface FeePolicy {
  feeBps: bigint;
  feeFloor: bigint;
  treasury: string;
  treasuryIsAddress: boolean;
  merchants: Map<string, MerchantRate>;
  network: SuiNetwork;
  grpcUrl: string;
  caip2: `sui:${SuiNetwork}`;
  /** The settlement coin type (USDC) for the network. */
  asset: string;
}

const DEFAULT_FEE_BPS = 200n; // 2%
const DEFAULT_FEE_FLOOR = 10_000n; // $0.01 at 6 decimals
const BPS_MAX = 10_000n;

/** Parse an integer-string env into a bigint in [0, max], falling back loudly. */
const parseIntEnv = (
  raw: string | undefined,
  fallback: bigint,
  label: string,
  max?: bigint,
): bigint => {
  if (raw == null || !raw.trim()) return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    console.error(`[facilitator/env] ${label} must be a non-negative integer — using default ${fallback}`);
    return fallback;
  }
  const v = BigInt(raw.trim());
  if (max != null && v > max) {
    console.error(`[facilitator/env] ${label} ${v} exceeds max ${max} — using default ${fallback}`);
    return fallback;
  }
  return v;
};

/**
 * Parse MERCHANT_RATES — a JSON map of CUSTOM per-merchant rate overrides. A payTo
 * NOT in the map pays FEE_BPS; there is NO free tier (the fee is never waived — this
 * only customizes the rate). A malformed entry is skipped LOUDLY (logged), never
 * fatal — one bad line must not take the facilitator down.
 */
const parseMerchants = (raw: string | undefined): Map<string, MerchantRate> => {
  const map = new Map<string, MerchantRate>();
  if (!raw || !raw.trim()) return map;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    console.error("[facilitator/env] MERCHANT_RATES is not valid JSON — ignoring:", (e as Error).message);
    return map;
  }
  if (typeof obj !== "object" || obj === null) {
    console.error("[facilitator/env] MERCHANT_RATES must be a JSON object of { addr: { feeBps } } — ignoring");
    return map;
  }
  for (const [addr, terms] of Object.entries(obj as Record<string, unknown>)) {
    const key = addr.trim().toLowerCase();
    if (!SUI_ADDRESS_RE.test(key)) {
      console.error(`[facilitator/env] MERCHANT_RATES: bad address ${addr} — skipped`);
      continue;
    }
    const feeBpsRaw = (terms as { feeBps?: unknown })?.feeBps;
    const valid =
      typeof feeBpsRaw === "number" &&
      Number.isInteger(feeBpsRaw) &&
      feeBpsRaw >= 0 &&
      feeBpsRaw <= 10_000;
    if (!valid) {
      console.error(`[facilitator/env] MERCHANT_RATES: ${addr} has no valid feeBps (0..10000) — skipped`);
      continue;
    }
    map.set(key, { feeBps: BigInt(feeBpsRaw) });
  }
  return map;
};

// Memoize per-isolate: env is one stable object for the life of a deployment, so a
// WeakMap keyed on it rebuilds only if the runtime ever hands us a different env.
const _cache = new WeakMap<Env, FeePolicy>();

/** Build (or return the cached) operator policy for this Worker `env`. */
export const policyFor = (env: Env): FeePolicy => {
  const hit = _cache.get(env);
  if (hit) return hit;

  const network = resolveNetwork(env.SUI_NETWORK);
  const treasury = (env.FEE_TREASURY ?? "").trim();
  const treasuryIsAddress = SUI_ADDRESS_RE.test(treasury);

  const policy: FeePolicy = {
    feeBps: parseIntEnv(env.FEE_BPS, DEFAULT_FEE_BPS, "FEE_BPS", BPS_MAX),
    feeFloor: parseIntEnv(env.FEE_FLOOR, DEFAULT_FEE_FLOOR, "FEE_FLOOR"),
    treasury,
    treasuryIsAddress,
    merchants: parseMerchants(env.MERCHANT_RATES),
    network,
    grpcUrl: env.SUI_GRPC_URL?.trim() || grpcUrl(network),
    caip2: caip2(network),
    asset: USDC_TYPES[network],
  };

  if (!treasury) {
    console.error(
      "[facilitator/env] FEE_TREASURY is UNSET — the facilitator is fail-closed " +
        "(no payment will verify, /supported reports ready:false). Set a 0x address or a SuiNS name.",
    );
  }
  console.log(
    `[facilitator] policy: network=${network} feeBps=${policy.feeBps} feeFloor=${policy.feeFloor} ` +
      `treasury=${treasury ? (treasuryIsAddress ? "address" : "suins:" + treasury) : "UNSET"} ` +
      `merchantOverrides=${policy.merchants.size}`,
  );

  _cache.set(env, policy);
  return policy;
};
