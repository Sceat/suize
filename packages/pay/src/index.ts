// @suize/pay — the WHOLE Suize merchant integration as one middleware.
//
//   import { suize } from "@suize/pay";
//   const paywall = suize({ to: "0x<your Sui address>", price: "0.10" });
//
//   Bun.serve({ fetch: paywall.wrap(handler) });   // fetch-style (Bun / Hono / Next)
//   app.use(paywall.express);                       // Express-style
//
// It speaks vanilla x402 V2 'exact' on Sui — the SAME protocol Stripe, Coinbase,
// and Google AP2 build for. It does exactly three HTTP things (no Suize-specific
// shape on the wire):
//   1. A request WITHOUT a valid payment → answer 402 with the x402 V2
//      `PaymentRequired` body (`accepts:[{ scheme:"exact", network, asset, amount,
//      payTo, … }]`) AND the same JSON, base64'd, in the `PAYMENT-REQUIRED`
//      header. The single accepted requirement declares the fee split in
//      `extra.outputs` (merchant-absorbed 2% with a $0.01 floor — computed from the
//      facilitator's GET /supported fee policy) and the idempotency id in the `payment-identifier`
//      extension. A single-output requirement is STRUCTURAL (merchant == treasury,
//      e.g. the deploy charge) — NOT a free tier: the facilitator recomputes + enforces
//      the fee at verify, so a fee-free payment is rejected on settle.
//   2. A retry carrying the payer's signed tx in `PAYMENT-SIGNATURE` (or the spec
//      alias `X-PAYMENT`) → SYNCHRONOUS denies (the presented `accepted` must
//      deep-equal OUR minted terms incl. outputs; its payment-identifier id must
//      be one we issued and not expired; its `transaction` must not be a digest we
//      already served) → POST {facilitator}/verify → run the handler buffered →
//      POST {facilitator}/settle → on success: mark the tx seen and append the
//      `PAYMENT-RESPONSE` (+ `X-PAYMENT-RESPONSE`) receipt header.
//
// Zero dependencies, zero keys, zero signup — the address IS the account.
//
// STATE & THE RESTART CAVEAT (stateless-ish by design): the only state is two
// in-memory maps — the issued-id TTL map (any unexpired id this instance minted
// verifies; ids expire after 15 min) and the seen-tx map (the replay guard, tx →
// drop-after timestamp). A process restart forgets both: an agent mid-flight just
// gets a fresh 402 and re-quotes, and the replay guard resets (the facilitator's
// 24h verify window bounds that exposure). Ground truth never moves off the chain.
//
// FAIL-CLOSED, IDEMPOTENT (the money-safety contract): a /verify or /settle call
// that THROWS (network blip / facilitator down / non-JSON) is NOT a "not paid".
// We answer 503 (retry the SAME PAYMENT-SIGNATURE header) — never a fresh 402 — so
// a payer that already settled does NOT re-pay during a transient outage. Only a
// DEFINITIVE !isValid / settle failure mints a new challenge (with the reason).

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL TYPE MIRROR — zero-dep law (CLAUDE.md): @suize/pay must publish to npm
// with NO workspace/runtime deps, so the x402 V2 wire shapes are hand-mirrored
// here, NOT imported from @suize/x402 / @suize/shared.
// ⚠️ SYNC REQUIREMENT: these MUST stay structurally identical to
//   packages/x402/src/types.ts (Output / PaymentRequirements / PaymentRequired /
//   ExactSuiPayload / PaymentPayload / VerifyResponse / SettleResponse) and
//   packages/shared/src/index.ts (USDC_TYPES, caip2). A drift here is a silent
//   protocol break — change both or neither.
// ─────────────────────────────────────────────────────────────────────────────

/** CAIP-2 network id, `namespace:reference` (e.g. `sui:testnet`). */
export type Network = `${string}:${string}`;

/** A single settlement leg of the fee split. `amount` = atomic units (6-dp USDC),
 * decimal string. The payer's tx MUST credit each declared `to` EXACTLY this. */
export type Output = { to: string; amount: string };

/** The one x402 V2 'exact' requirement we mint. Mirror of x402 PaymentRequirements. */
export type PaymentRequirements = {
  scheme: "exact";
  network: Network;
  /** TOTAL atomic units (the sum of `extra.outputs`). */
  amount: string;
  asset: string;
  /** Primary recipient — the merchant. */
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    /** The declared fee split — the payer's tx must match these EXACTLY. */
    outputs: Output[];
    /** Facilitator door: POST { sender, requirements } → unsigned gasless bytes. */
    buildUrl: string;
    [k: string]: unknown;
  };
};

export type ResourceInfo = {
  url: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
};

/** The x402 V2 402-body. `accepts` is the one requirement; the idempotency id
 * lives under `extensions["payment-identifier"].info.id`. */
export type PaymentRequired = {
  x402Version: 2;
  error?: string;
  resource?: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions: Record<string, unknown>;
};

/** The Sui-scheme payload: a signed-but-not-executed tx. Both fields base64. */
export type ExactSuiPayload = { signature: string; transaction: string };

/** The inbound payment payload (PAYMENT-SIGNATURE / X-PAYMENT, base64'd). */
export type PaymentPayload = {
  x402Version: number;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: ExactSuiPayload;
  extensions?: Record<string, unknown>;
};

/** POST /verify response. */
export type VerifyResponse = {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
};

/** POST /settle response. `transaction` is the executed digest, or "" on failure. */
export type SettleResponse = {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction: string;
  network: Network;
  amount?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants — all literals (zero-dep). Mirror @suize/shared.
// ─────────────────────────────────────────────────────────────────────────────

/** The payment-identifier extension key (specs/extensions/payment_identifier.md).
 * The idempotency id lives at extensions["payment-identifier"].info.id — NEVER as
 * an ad-hoc extra/top-level field. */
const PAYMENT_ID_EXT = "payment-identifier";
/** Spec id charset/length: 16-128 of [A-Za-z0-9_-]. */
const PAYMENT_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** The 402 challenge header (server → client). Carries base64(PaymentRequired). */
const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
/** Inbound payment-payload header names, in preference order (client → server). */
const PAYMENT_SIG_HEADERS = ["PAYMENT-SIGNATURE", "X-PAYMENT"] as const;
/** Outbound settlement-receipt header names — emit ALL (server → client). */
const PAYMENT_RESPONSE_HEADERS = ["PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"] as const;

/** Native USDC per network (6 decimals). Mirror of @suize/shared USDC_TYPES. */
const USDC_TYPES: Record<"testnet" | "mainnet", string> = {
  testnet: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
  mainnet: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
};

/** A challenge (and the id it minted) is honorable for 15 min. */
const CHALLENGE_TTL_MS = 15 * 60 * 1000;
/** The facilitator's /verify window: a settlement older than this can never be
 * certified again, so a served tx is safe to forget past it. */
const VERIFY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** How long the fetched fee outputs are cached before a re-fetch (per terms). */
const TERMS_TTL_MS = 5 * 60 * 1000;
/** The payer's window to sign + settle, stamped into every requirement. */
const MAX_TIMEOUT_SECONDS = 120;

const DEFAULT_FACILITATOR = "https://facilitator.suize.io";
const DEFAULT_NETWORK: Network = "sui:testnet";

const USDC_DECIMALS = 6;
const USDC_UNIT = 10n ** BigInt(USDC_DECIMALS);

/** A 0x…64-hex Sui address (a resolved treasury must match this). */
const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;
/** Basis-points denominator for the fee math. */
const BPS_DENOMINATOR = 10_000n;

/**
 * The fee split — a ZERO-DEP mirror of `splitOutputs` from `@suize/x402`
 * (packages/x402/src/split.ts). BOTH sides of the rail compute the SAME split from
 * the same inputs, so this MUST stay structurally identical: a drift here is a silent
 * protocol break (the facilitator recomputes + enforces the split at verify/settle,
 * so a merchant that declares a different split has every payment rejected).
 *
 * fee = min(max(amount·bps/10_000, floor), amount − 1), merchant-absorbed. Outputs are
 * [{merchant, net}, {treasury, fee}] UNLESS merchant === treasury (or no fee can be
 * carved), in which case the legs collapse to ONE full-amount output.
 */
const splitOutputs = (
  payTo: string,
  treasury: string,
  amountAtomic: bigint,
  feeBps: bigint,
  feeFloor: bigint,
): Output[] => {
  const pct = (amountAtomic * feeBps) / BPS_DENOMINATOR;
  let fee = pct > feeFloor ? pct : feeFloor; // floor
  if (fee >= amountAtomic) fee = amountAtomic - 1n; // clamp strictly below gross
  const net = amountAtomic - fee;
  if (fee <= 0n || net <= 0n) return [{ to: payTo, amount: amountAtomic.toString() }];
  if (treasury.toLowerCase() === payTo.toLowerCase()) {
    return [{ to: payTo, amount: amountAtomic.toString() }];
  }
  return [
    { to: payTo, amount: net.toString() },
    { to: treasury, amount: fee.toString() },
  ];
};

// ─────────────────────────────────────────────────────────────────────────────
// Config + public types
// ─────────────────────────────────────────────────────────────────────────────

export interface SuizeConfig {
  /** The merchant Sui address — settlements land here. The address IS the account. */
  to: string;
  /** The price per request — a decimal USDC string, e.g. "0.10" (≤ 6 dp, > 0). */
  price: string;
  /** The facilitator base URL (/supported, /verify, /settle, /build live there). */
  facilitator?: string;
  /** The chain tag stamped into the requirement ("sui:testnet" / "sui:mainnet"). */
  network?: Network;
}

/** A fetch-style handler: (Request, ...anything) → Response. The extra args are
 * passed through untouched (Bun's `server`, Hono's `env`, …). */
export type FetchHandler<A extends unknown[] = unknown[]> = (
  req: Request,
  ...rest: A
) => Response | Promise<Response>;

// Minimal STRUCTURAL Express types — no @types/express dependency; anything
// req/res-shaped (Express 4/5, Connect) satisfies these.
interface ExpressishRequest {
  headers: Record<string, string | string[] | undefined>;
  protocol?: string;
  originalUrl?: string;
  url?: string;
  get?: (header: string) => string | undefined;
}
interface ExpressishResponse {
  status: (code: number) => ExpressishResponse;
  set: (headers: Record<string, string>) => ExpressishResponse;
  json: (body: unknown) => unknown;
}
export type ExpressMiddleware = (
  req: ExpressishRequest,
  res: ExpressishResponse,
  next: (err?: unknown) => void,
) => Promise<void>;

// ─────────────────────────────────────────────────────────────────────────────
// Small pure helpers (zero-dep)
// ─────────────────────────────────────────────────────────────────────────────

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/** base64(JSON) — what every x402 header carries. */
const b64json = (o: unknown): string =>
  // btoa is in every modern runtime (Bun / Node ≥16 / browsers / workers).
  btoa(unescape(encodeURIComponent(JSON.stringify(o))));

/** base64(JSON) → T, or null on malformed base64 / JSON (a bad header is a deny). */
const unb64json = <T>(s: string): T | null => {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(s)))) as T;
  } catch {
    return null;
  }
};

/** "0.50" → 500000n. Throws on anything that isn't a positive ≤6-dp decimal. */
const usdcAtomic = (decimal: string): bigint => {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(decimal.trim());
  if (!m) throw new Error(`invalid USDC amount: ${decimal}`);
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? "").padEnd(USDC_DECIMALS, "0") || "0");
  const units = whole * USDC_UNIT + frac;
  if (units <= 0n) throw new Error(`USDC amount must be positive: ${decimal}`);
  return units;
};

/** CSPRNG payment-identifier id — `pay_` + 32 hex chars (36 chars, in-spec). */
const mintPaymentId = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return "pay_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/** Read the payment-identifier id off any `{ extensions }` object (or undefined). */
const paymentIdOf = (src: { extensions?: Record<string, unknown> } | null | undefined): string | undefined => {
  const ext = src?.extensions?.[PAYMENT_ID_EXT] as { info?: { id?: unknown } } | undefined;
  const id = ext?.info?.id;
  return typeof id === "string" && PAYMENT_ID_RE.test(id) ? id : undefined;
};

/** Read the first present payment-payload header (PAYMENT-SIGNATURE, then X-PAYMENT). */
const readPaymentHeader = (get: (name: string) => string | null | undefined): string | undefined => {
  for (const name of PAYMENT_SIG_HEADERS) {
    const v = get(name);
    if (v) return v;
  }
  return undefined;
};

/** Order-insensitive structural equality (the presented `accepted` must match our
 * minted requirement — incl. the outputs array, in any order). Plain JSON shapes
 * only (no Dates/Maps), which is all the x402 wire carries. */
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    // Order-insensitive: each element of `a` must have a UNIQUE match in `b`.
    const used = new Array(b.length).fill(false);
    return a.every((x) => {
      const i = b.findIndex((y, j) => !used[j] && deepEqual(x, y));
      if (i < 0) return false;
      used[i] = true;
      return true;
    });
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
};

/** Validate merchant terms — shared by `suize()` (at boot) and `mintPaymentRequired`. */
const assertTerms = (to: string, price: string): void => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(to)) {
    throw new Error(`@suize/pay: \`to\` must be a 0x…64-hex Sui address (got "${to}")`);
  }
  if (!/^\d+(\.\d{1,6})?$/.test(price) || Number(price) <= 0) {
    throw new Error(`@suize/pay: \`price\` must be a positive decimal USDC string, ≤ 6 dp (got "${price}")`);
  }
};

/** Merge same-address legs (the §brief landmine: a /terms split with two legs to
 * the SAME address would otherwise double-declare it and never deep-equal a single
 * on-chain credit). Sums atomic amounts per address, preserving first-seen order. */
const mergeOutputs = (outputs: Output[]): Output[] => {
  const order: string[] = [];
  const sum = new Map<string, bigint>();
  for (const o of outputs) {
    const key = o.to;
    if (!sum.has(key)) order.push(key);
    sum.set(key, (sum.get(key) ?? 0n) + BigInt(o.amount));
  }
  return order.map((to) => ({ to, amount: sum.get(to)!.toString() }));
};

/** Thrown by suize()'s resolveOutputs when the canonical fee split can't be obtained
 * (a cold-start /supported miss with no cached split). FAIL-CLOSED: the serve path turns it
 * into a transient 503 — Suize is NOT a free facilitator, so we refuse to mint a
 * fee-free challenge rather than serve a sale the facilitator would reject anyway. */
class TermsUnavailable extends Error {
  constructor(detail: string) {
    super(`fee terms unavailable: ${detail}`);
    this.name = "TermsUnavailable";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// mintPaymentRequired — PURE + exported. The ONE x402 V2 402-body home.
// `outputs` is the resolved fee split (caller passes the /terms result, or omits
// it for a STRUCTURAL single-output requirement — merchant == treasury, e.g. the deploy
// charge). `paymentId` lets a
// stateful caller (suize()) pin the id it will track; omit it and one is minted.
// ─────────────────────────────────────────────────────────────────────────────

export interface MintOptions {
  /** The resolved fee split (from {facilitator}/terms). Omitted/empty → a STRUCTURAL
   * single output (the whole `price` to the merchant) — used ONLY when merchant ==
   * treasury, e.g. the deploy charge. NOT a free tier: the facilitator enforces the fee. */
  outputs?: Output[];
  /** The payment-identifier id to stamp (a tracking caller pins it). Defaults to a
   * fresh `pay_…` id. */
  paymentId?: string;
  /** The resource URL to echo into `resource.url` (the request URL). */
  resourceUrl?: string;
}

/** Mint one x402 V2 `PaymentRequired` for these terms — PURE and STATELESS. */
export const mintPaymentRequired = (config: SuizeConfig, opts: MintOptions = {}): PaymentRequired => {
  const { to, price } = config;
  assertTerms(to, price);
  const facilitator = (config.facilitator ?? DEFAULT_FACILITATOR).replace(/\/+$/, "");
  const network = config.network ?? DEFAULT_NETWORK;
  const ref = network.split(":")[1] as "testnet" | "mainnet";
  const asset = USDC_TYPES[ref] ?? USDC_TYPES.testnet;
  const total = usdcAtomic(price); // atomic-unit total (and validates the price)
  const id = opts.paymentId ?? mintPaymentId();

  // The fee split: the resolved /terms outputs (same-address legs merged), or a
  // STRUCTURAL single output (the whole price to the merchant — used when merchant ==
  // treasury, e.g. the deploy charge; the facilitator enforces the fee at verify).
  const declared = opts.outputs && opts.outputs.length ? mergeOutputs(opts.outputs) : [{ to, amount: total.toString() }];

  const requirement: PaymentRequirements = {
    scheme: "exact",
    network,
    amount: total.toString(),
    asset,
    payTo: to,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    extra: {
      outputs: declared,
      buildUrl: `${facilitator}/build`,
    },
  };

  return {
    x402Version: 2,
    error: "payment required",
    ...(opts.resourceUrl ? { resource: { url: opts.resourceUrl } } : {}),
    accepts: [requirement],
    extensions: {
      [PAYMENT_ID_EXT]: { info: { required: true, id } },
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// suize() — the configured paywall.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configure the paywall. Returns `{ wrap, express, challenge }`:
 *   wrap      — wrap a fetch-style handler (Bun.serve / Hono / Next route).
 *   express   — the Express-style middleware (settles BEFORE next()).
 *   challenge — mint a fresh tracked `PaymentRequired` for custom transports.
 * Throws IMMEDIATELY on malformed config — a merchant typo should fail at boot.
 */
export const suize = (config: SuizeConfig) => {
  const { to, price } = config;
  const facilitator = (config.facilitator ?? DEFAULT_FACILITATOR).replace(/\/+$/, "");

  // Re-inlined shape checks (zero-dep — a merchant drops this in with nothing else).
  assertTerms(to, price);

  const issued = new Map<string, number>(); // paymentId → expiresAt (ms)
  const seen = new Map<string, number>(); // tx (base64) → drop-after (ms) — one SETTLED tx = one serve
  // F4: the IN-FLIGHT set — a tx claimed synchronously at inspect time (BEFORE the
  // handler runs), so two concurrent requests carrying the SAME payment can't both
  // pass the inspect gate, run the handler, and deliver work twice. Released on a
  // transient/definitive failure (so a genuine retry can re-claim); promoted into
  // `seen` on a successful settlement. A second request that finds the tx already
  // in-flight is told to retry (409) rather than double-serving.
  const inflight = new Set<string>(); // tx (base64) currently being verified/settled
  let terms: { outputs: Output[]; at: number } | null = null; // cached fee split

  /** Resolve the canonical fee split by reading the facilitator's fee policy from
   * `GET /supported?payTo=<merchant>` and computing the split LOCALLY (5-min TTL).
   * The facilitator publishes `kinds[0].extra = { feeBps, feeFloor, treasury }` (the
   * EFFECTIVE rate for this merchant) and `ready`; we feed those into `splitOutputs`,
   * the same kernel the facilitator recomputes + ENFORCES at verify/settle. FAIL-CLOSED:
   * Suize is NOT a free facilitator, so if the policy isn't READY (no resolved treasury)
   * we REFUSE to mint a challenge (throw → the serve path answers a transient 503) rather
   * than serve fee-free. A transient miss keeps the last-good split; a cold-start miss throws. */
  const resolveOutputs = async (): Promise<Output[]> => {
    const now = Date.now();
    if (terms && now - terms.at < TERMS_TTL_MS) return terms.outputs;
    try {
      const res = await fetch(`${facilitator}/supported?` + new URLSearchParams({ payTo: to }));
      if (res.ok) {
        const body = (await res.json()) as {
          ready?: boolean;
          kinds?: Array<{ extra?: { feeBps?: unknown; feeFloor?: unknown; treasury?: unknown } }>;
        };
        const extra = body.kinds?.[0]?.extra;
        const treasury = typeof extra?.treasury === "string" ? extra.treasury : "";
        const feeBps = Number(extra?.feeBps);
        const feeFloor = Number(extra?.feeFloor);
        // Only trust a READY policy with a resolved treasury + finite fee numbers.
        if (
          body.ready &&
          SUI_ADDRESS_RE.test(treasury) &&
          Number.isFinite(feeBps) &&
          Number.isFinite(feeFloor)
        ) {
          const split = splitOutputs(
            to,
            treasury,
            usdcAtomic(price),
            BigInt(Math.trunc(feeBps)),
            BigInt(Math.trunc(feeFloor)),
          );
          // ⚠️ merge same-address legs (a colliding split would never deep-equal a
          // single on-chain credit) — also done in mintPaymentRequired, belt+braces.
          const merged = mergeOutputs(split);
          if (merged.length) {
            terms = { outputs: merged, at: now };
            return merged;
          }
        }
      }
    } catch {
      // network error — fall through to the fail-closed path below.
    }
    // FAIL-CLOSED: a last-good split survives a transient miss; otherwise refuse to mint
    // a fee-free challenge (the serve path turns this into a transient 503).
    if (terms) return terms.outputs;
    throw new TermsUnavailable(`${facilitator}/supported for ${to} @ ${price}`);
  };

  /** Mint a fresh tracked `PaymentRequired` for this route (and remember its id). */
  const challenge = async (resourceUrl: string): Promise<PaymentRequired> => {
    const now = Date.now();
    for (const [id, exp] of issued) if (now > exp) issued.delete(id); // lazy prune
    for (const [tx, drop] of seen) if (now > drop) seen.delete(tx);
    const outputs = await resolveOutputs();
    const paymentId = mintPaymentId();
    const body = mintPaymentRequired(config, { outputs, paymentId, resourceUrl });
    issued.set(paymentId, now + CHALLENGE_TTL_MS);
    return body;
  };

  // The inspect/settle steps return distinct inline verdicts so a transient
  // verify/settle failure can NEVER collapse to the 402 path (the double-pay bug):
  // only "deny" mints a fresh challenge; "transient" tells the SAME header to retry;
  // "pass"/"verified" carries the payload/receipt forward.

  /** Run the handler buffered so we can settle AFTER it succeeds but still emit
   * the receipt headers on the SAME response (the x402 settle-then-serve flow). */

  /** Inspect + verify (NOT settle) the header; the settle runs after the handler.
   * Returns a verdict + (on pass) the parsed payload to settle. On a "verified"
   * verdict the tx is CLAIMED in `inflight` — the caller MUST eventually settle()
   * (which releases/promotes it) so the claim never leaks. */
  const inspect = async (raw: string | undefined): Promise<
    | { kind: "deny"; reason: string }
    | { kind: "transient" }
    | { kind: "inflight" }
    | { kind: "verified"; payload: PaymentPayload }
  > => {
    if (!raw) return { kind: "deny", reason: "no payment presented" };
    const payload = unb64json<PaymentPayload>(raw);
    if (!payload || typeof payload !== "object") {
      return { kind: "deny", reason: "malformed payment payload" };
    }

    // SYNCHRONOUS deny #1 — the payment-identifier id must be one WE issued and
    // not expired (a tracking caller only honors its own quotes).
    const id = paymentIdOf(payload);
    const expiresAt = id ? issued.get(id) : undefined;
    if (!id || expiresAt === undefined || Date.now() > expiresAt) {
      return { kind: "deny", reason: "unknown or expired payment-identifier" };
    }

    // SYNCHRONOUS deny #2 — the presented `accepted` must deep-equal what WE
    // minted for this id (same scheme/network/asset/payTo/amount/outputs). Re-mint
    // the requirement for THIS id and compare; a tampered split is rejected before
    // any network call.
    const expected = mintPaymentRequired(config, {
      outputs: terms?.outputs,
      paymentId: id,
    }).accepts[0];
    if (!payload.accepted || !deepEqual(payload.accepted, expected)) {
      return { kind: "deny", reason: "presented terms do not match the issued quote" };
    }

    // SYNCHRONOUS deny #3 — the replay guard: this exact signed tx must not have
    // been settled+served already (one SETTLED tx = one serve).
    const tx = payload.payload?.transaction;
    if (typeof tx !== "string" || !tx) return { kind: "deny", reason: "missing transaction" };
    if (seen.has(tx)) return { kind: "deny", reason: "payment already used" };

    // SYNCHRONOUS deny #4 (F4 — the TOCTOU close): if this exact tx is ALREADY being
    // verified/settled by a concurrent request, do NOT run the handler a second time.
    // Tell the caller to retry; the in-flight request will settle it once. We CLAIM
    // the tx here (before the async /verify and before the handler runs) so a second
    // request can never slip past this gate — the claim is released on any failure
    // below (and on a transient/deny settle) so a genuine retry can re-claim.
    if (inflight.has(tx)) return { kind: "inflight" };
    inflight.add(tx);

    // POST /verify — the facilitator simulates + exact-fee-checks the signed tx.
    let verify: VerifyResponse;
    try {
      const res = await fetch(`${facilitator}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, paymentRequirements: expected }),
      });
      if (!res.ok) {
        inflight.delete(tx); // release — not a definitive no → retry same header
        return { kind: "transient" };
      }
      verify = (await res.json()) as VerifyResponse;
    } catch {
      inflight.delete(tx); // facilitator unreachable → release, retry, never re-pay
      return { kind: "transient" };
    }
    if (!verify.isValid) {
      inflight.delete(tx); // definitive no → release (a fresh challenge follows)
      return { kind: "deny", reason: verify.invalidReason ?? "payment did not verify" };
    }
    return { kind: "verified", payload }; // tx stays CLAIMED until settle() resolves it
  };

  /** POST /settle — execute the verified tx. Returns the receipt or a verdict.
   * RESOLVES the F4 in-flight claim: promotes the tx into `seen` on success, releases
   * it on any failure (so a genuine transient can legitimately retry the same header). */
  const settle = async (payload: PaymentPayload): Promise<
    { kind: "pass"; receipt: SettleResponse } | { kind: "deny"; reason: string } | { kind: "transient" }
  > => {
    const tx = payload.payload.transaction;
    const expected = mintPaymentRequired(config, {
      outputs: terms?.outputs,
      paymentId: paymentIdOf(payload),
    }).accepts[0];
    let receipt: SettleResponse;
    try {
      const res = await fetch(`${facilitator}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload, paymentRequirements: expected }),
      });
      if (!res.ok) {
        inflight.delete(tx); // release — transient settle hiccup, the same header may retry
        return { kind: "transient" };
      }
      receipt = (await res.json()) as SettleResponse;
    } catch {
      inflight.delete(tx); // settle unreachable → release, retry same header
      return { kind: "transient" };
    }
    if (!receipt.success) {
      inflight.delete(tx); // definitive settle failure → release
      return { kind: "deny", reason: receipt.errorReason ?? "settlement failed" };
    }
    // Successful settlement: promote the in-flight claim into the permanent replay
    // guard (one settled tx = one serve), then release the in-flight claim. Both are
    // synchronous = atomic against a concurrent inspect.
    if (seen.has(tx)) {
      inflight.delete(tx);
      return { kind: "deny", reason: "payment already used" };
    }
    seen.set(tx, Date.now() + VERIFY_WINDOW_MS);
    inflight.delete(tx);
    return { kind: "pass", receipt };
  };

  // ── Response builders ──────────────────────────────────────────────────────

  // Suize is NOT a free facilitator: when the fee split can't be resolved we REFUSE to
  // mint a challenge and answer a transient 503 (retry) — never a fee-free sale.
  const TERMS_UNAVAILABLE_BODY = {
    error: "payment terms temporarily unavailable",
    retry: "retry shortly",
  };
  const termsUnavailable = (): Response =>
    new Response(JSON.stringify(TERMS_UNAVAILABLE_BODY, null, 2), {
      status: 503,
      headers: { "Content-Type": "application/json", "Retry-After": "2" },
    });

  const challengeResponse = async (resourceUrl: string, error?: string): Promise<Response> => {
    let body: PaymentRequired;
    try {
      body = await challenge(resourceUrl);
    } catch (e) {
      if (e instanceof TermsUnavailable) return termsUnavailable();
      throw e;
    }
    if (error) body.error = error;
    return new Response(JSON.stringify(body, null, 2), {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        [PAYMENT_REQUIRED_HEADER]: b64json(body),
      },
    });
  };

  const TRANSIENT_BODY = {
    error: "verification temporarily unavailable",
    retry: "resend the same PAYMENT-SIGNATURE header shortly",
  };
  const unavailable = (): Response =>
    new Response(JSON.stringify(TRANSIENT_BODY, null, 2), {
      status: 503,
      headers: { "Content-Type": "application/json", "Retry-After": "2" },
    });

  // F4: a concurrent request carrying the SAME in-flight payment. The first request
  // is settling it; this one must NOT re-run the handler. 409 + Retry-After (the
  // in-flight request promotes the tx into `seen`, so the retry then reads it as
  // either served-or-replayed — never a double serve).
  const CONFLICT_BODY = {
    error: "this payment is already being processed",
    retry: "resend the same PAYMENT-SIGNATURE header shortly",
  };
  const conflict = (): Response =>
    new Response(JSON.stringify(CONFLICT_BODY, null, 2), {
      status: 409,
      headers: { "Content-Type": "application/json", "Retry-After": "1" },
    });

  /** Append both receipt headers to a handler's Response (settle-then-serve). */
  const withReceipt = (res: Response, receipt: SettleResponse): Response => {
    const headers = new Headers(res.headers);
    const value = b64json(receipt);
    for (const name of PAYMENT_RESPONSE_HEADERS) headers.set(name, value);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };

  // ── (a) The fetch-style wrapper ────────────────────────────────────────────
  const wrap =
    <A extends unknown[]>(handler: FetchHandler<A>) =>
    async (req: Request, ...rest: A): Promise<Response> => {
      const inspected = await inspect(readPaymentHeader((n) => req.headers.get(n)));
      if (inspected.kind === "transient") return unavailable();
      if (inspected.kind === "inflight") return conflict();
      if (inspected.kind === "deny") return challengeResponse(req.url, inspected.reason);

      // Verified — the tx is CLAIMED in `inflight`. Run the handler BUFFERED, then
      // settle (which releases/promotes the claim), then attach the receipt. If the
      // handler THROWS, release the claim so the leak doesn't strand the payment.
      let out: Response;
      try {
        out = await handler(req, ...rest);
      } catch (e) {
        inflight.delete(inspected.payload.payload.transaction);
        throw e;
      }
      const settled = await settle(inspected.payload);
      if (settled.kind === "transient") return unavailable();
      if (settled.kind === "deny") return challengeResponse(req.url, settled.reason);
      return withReceipt(out, settled.receipt);
    };

  // ── (b) The Express-style middleware (settles BEFORE next()) ───────────────
  // Express can't buffer next()'s eventual response cleanly, so the payment is
  // VERIFIED + SETTLED before the route runs; on success the receipt headers are
  // set and next() proceeds. (A handler that itself fails after a settled payment
  // is the merchant's concern — the on-chain receipt is the ground truth.)
  const express: ExpressMiddleware = async (req, res, next) => {
    const raw = readPaymentHeader((n) => first(req.headers[n.toLowerCase()]));
    const host = req.get?.("host") ?? first(req.headers.host) ?? "localhost";
    const url = `${req.protocol ?? "http"}://${host}${req.originalUrl ?? req.url ?? "/"}`;

    // Mint a 402 challenge, or a transient 503 if the fee split can't be resolved
    // (fail-closed — never a fee-free challenge).
    const denyOrTerms = async (reason: string): Promise<void> => {
      let body: PaymentRequired;
      try {
        body = await challenge(url);
      } catch (e) {
        if (e instanceof TermsUnavailable) {
          res.status(503).set({ "Retry-After": "2" }).json(TERMS_UNAVAILABLE_BODY);
          return;
        }
        throw e;
      }
      body.error = reason;
      res.status(402).set({ [PAYMENT_REQUIRED_HEADER]: b64json(body) }).json(body);
    };

    const inspected = await inspect(raw);
    if (inspected.kind === "transient") {
      res.status(503).set({ "Retry-After": "2" }).json(TRANSIENT_BODY);
      return;
    }
    if (inspected.kind === "inflight") {
      res.status(409).set({ "Retry-After": "1" }).json(CONFLICT_BODY);
      return;
    }
    if (inspected.kind === "deny") {
      await denyOrTerms(inspected.reason);
      return;
    }
    const settled = await settle(inspected.payload);
    if (settled.kind === "transient") {
      res.status(503).set({ "Retry-After": "2" }).json(TRANSIENT_BODY);
      return;
    }
    if (settled.kind === "deny") {
      await denyOrTerms(settled.reason);
      return;
    }
    const value = b64json(settled.receipt);
    const receiptHeaders: Record<string, string> = {};
    for (const name of PAYMENT_RESPONSE_HEADERS) receiptHeaders[name] = value;
    res.set(receiptHeaders);
    next();
  };

  return { wrap, express, challenge };
};

export default suize;
