// Facilitator module — the open merchant-side door of the rail, x402 V2 'exact'.
//
// VANILLA x402, KEYLESS, account.move DEAD. The payer signs a gasless
// Address-Balance `send_funds` PTB whose outputs are the declared fee split; the
// facilitator VERIFIES the signed-but-not-executed tx pays that split EXACTLY
// (simulate + assertOutputsExact), then SETTLES by broadcasting it over gRPC — no
// Enoki, no sponsor, no owner-tx signing. The 2% (+ $0.01 floor) lives in
// extra.outputs (merchant-absorbed), facilitator-enforced; a single-output payment
// (merchant not in the registry) is the FREE tier.
//
//   POST /verify  { x402Version, paymentPayload, paymentRequirements }
//     → 200 VerifyResponse { isValid, payer } | { isValid:false, invalidReason, invalidMessage }
//   POST /settle  { x402Version, paymentPayload, paymentRequirements }
//     → 200 SettleResponse { success, transaction:<digest>, network, payer, amount }
//       idempotent by digest (a replay returns the same cached response).
//   GET  /supported → { kinds:[{x402Version:2, scheme:'exact', network}],
//                       extensions:['payment-identifier'], signers:{'sui:*':[]} }
//   POST /build   { sender, outputs? | requirements? } → { bytes } (unsigned gasless,
//       THE PROBE RECIPE — the payer signs LOCALLY + runs assertUnsignedBytesSafe).
//   GET  /terms?payTo&amount → { outputs|null, feeBps } — the declared split a
//       merchant puts in its 402 (null = free tier, a single full-amount output).
//   GET  /tx?digest → a DESCRIPTIVE audit: { success, payer, transfers, coinType }
//       from ONE getTransaction read of balanceChanges — never trusted, checkable.
//   POST /checkout — KEPT VERBATIM from the prior build (the no-auth pay-link
//       URL formatter, SPEC §7.3; pure string assembly, no store, no chain).
//
// HOSTING SHELL kept exactly: two per-IP token buckets (WRITE vs VERIFY), validate
// BEFORE taking a token, json/getIp from http.ts, Retry-After on 429, boot log.
// The 503 gates are now treasury-resolution readiness for FEE-TIER paths only —
// free-tier verify/settle/build must work regardless of treasury state.
import type { Server } from "bun";
import { randomBytes } from "node:crypto";
import {
  caip2,
  SUI_ADDRESS_RE,
  USDC_DECIMAL_RE,
  MAX_MEMO_LEN,
  type FacilitatorCheckoutRequest,
  type FacilitatorCheckoutResponse,
} from "@suize/shared";
import {
  usdcAtomic,
  formatUsdc,
  assertUnsignedBytesSafe,
  type Output,
  type PaymentPayload,
  type PaymentRequirements,
} from "@suize/x402";
import { config } from "../config";
import { json, getIp } from "../http";
import { doVerify, doSettle, buildDoor, client, FACILITATOR_NETWORK, ASSET } from "./x402";
import { outputsFor, feeBpsFor, isFeeTierMerchant, treasuryReady, feesInfo } from "./fees";

// ---------------------------------------------------------------------------
// 6-dp USDC decimal conversion — the wire speaks decimal strings ("0.50"), the
// chain speaks atomic units. Imported from @suize/x402 (usdcAtomic throws on a
// bad shape; we pre-validate with USDC_DECIMAL_RE so a malformed amount → 400).
// ---------------------------------------------------------------------------

/** "0.50" → 500000n, or null on anything that isn't a positive ≤6-dp decimal. */
const parseAmount = (s: string): bigint | null => {
  if (!USDC_DECIMAL_RE.test(s.trim())) return null;
  try {
    return usdcAtomic(s);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Per-IP token buckets — the facilitator's OWN limiter. TWO buckets by cost.
// A null IP FAILS CLOSED on both (per http.ts getIp). Kept exactly as before.
//   WRITE bucket (/settle + /build + /checkout): each is real work (a broadcast,
//   a build, a link mint) — TIGHT.
//   READ bucket (/verify + /terms + /tx + /supported): cheaper, higher-volume
//   simulate/read amplifiers — SEPARATE + LOOSER so legit polling never trips.
// ---------------------------------------------------------------------------

type Bucket = { tokens: number; last: number };

const makeBucket = (capacity: number, refillPerSec: number) => {
  const buckets = new Map<string, Bucket>();
  const take = (key: string | null): boolean => {
    if (!key) return false; // untrusted origin — fail closed (see http.ts getIp)
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: capacity, last: now };
    const elapsed = (now - b.last) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
    b.last = now;
    if (b.tokens < 1) {
      buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    buckets.set(key, b);
    return true;
  };
  setInterval(() => {
    const cutoff = Date.now() - 120_000;
    for (const [k, b] of buckets) if (b.last < cutoff) buckets.delete(k);
  }, 120_000).unref?.();
  return take;
};

// WRITE door — each token is a broadcast/build. refill 0.5/s = ~1 op / 2s.
const WRITE_REFILL_PER_SEC = 0.5;
const takeWriteToken = makeBucket(6, WRITE_REFILL_PER_SEC);

// READ door — each token is one cheap simulate/read. Bigger burst, faster refill.
const READ_REFILL_PER_SEC = 5;
const takeReadToken = makeBucket(30, READ_REFILL_PER_SEC);

/** `Retry-After` (whole seconds) for a 429 — the bucket's one-token refill. */
const retryAfter = (refillPerSec: number): Record<string, string> => ({
  "Retry-After": String(Math.max(1, Math.ceil(1 / refillPerSec))),
});

const rateLimited = (origin: string | null, refillPerSec: number): Response =>
  json({ error: "rate limited — slow down and retry" }, 429, origin, retryAfter(refillPerSec));

const err = (error: string, status: number, origin: string | null): Response =>
  json({ error }, status, origin);

const readBody = async (req: Request): Promise<unknown | null> => {
  try {
    return await req.json();
  } catch {
    return null;
  }
};

/** Pull the {paymentPayload, paymentRequirements} pair off a /verify|/settle body,
 * tolerating the two common envelope spellings. Returns null when either is absent. */
const readVerifyBody = (
  body: unknown,
): { payload: PaymentPayload; requirements: PaymentRequirements } | null => {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const payload = (b.paymentPayload ?? b.payload) as PaymentPayload | undefined;
  const requirements = (b.paymentRequirements ?? b.requirements ?? b.accepted) as
    | PaymentRequirements
    | undefined;
  if (!payload || !requirements) return null;
  return { payload, requirements };
};

// ---------------------------------------------------------------------------
// GET /supported — the facilitator capability descriptor (x402 V2 §discovery).
// ---------------------------------------------------------------------------

const handleSupported = (origin: string | null): Response =>
  json(
    {
      kinds: [{ x402Version: 2, scheme: "exact", network: FACILITATOR_NETWORK }],
      extensions: ["payment-identifier"],
      signers: { "sui:*": [] },
    },
    200,
    origin,
  );

// ---------------------------------------------------------------------------
// POST /verify + POST /settle — the x402 V2 core. Shape-validate the envelope
// BEFORE taking a token (a malformed body must not burn a slot).
// ---------------------------------------------------------------------------

const handleVerify = async (
  req: Request,
  origin: string | null,
  server?: Server<unknown>,
): Promise<Response> => {
  const parsed = readVerifyBody(await readBody(req));
  if (!parsed) return err("invalid body: need { paymentPayload, paymentRequirements }", 400, origin);

  if (!takeReadToken(getIp(req, server))) return rateLimited(origin, READ_REFILL_PER_SEC);

  const result = await doVerify(parsed.payload, parsed.requirements);
  return json(result, 200, origin); // a definitive invalid is a 200 with isValid:false
};

const handleSettle = async (
  req: Request,
  origin: string | null,
  server?: Server<unknown>,
): Promise<Response> => {
  const parsed = readVerifyBody(await readBody(req));
  if (!parsed) return err("invalid body: need { paymentPayload, paymentRequirements }", 400, origin);

  if (!takeWriteToken(getIp(req, server))) return rateLimited(origin, WRITE_REFILL_PER_SEC);

  const result = await doSettle(parsed.payload, parsed.requirements);
  // A settle failure is a 200 with success:false (the protocol carries the reason
  // in the body); only a malformed request is a 4xx (handled above).
  return json(result, 200, origin);
};

// ---------------------------------------------------------------------------
// GET /terms?payTo&amount — the declared split a merchant drops into its 402.
// READ-tier. Returns { outputs: Output[] | null, feeBps } — null = free tier
// (the merchant declares a single full-amount output to payTo).
// ---------------------------------------------------------------------------

const handleTerms = async (
  req: Request,
  url: URL,
  origin: string | null,
  server?: Server<unknown>,
): Promise<Response> => {
  const payTo = (url.searchParams.get("payTo") ?? "").trim();
  const amountRaw = (url.searchParams.get("amount") ?? "").trim();

  if (!SUI_ADDRESS_RE.test(payTo)) {
    return err("missing or malformed payTo (0x…64-hex Sui address)", 400, origin);
  }
  const amount = parseAmount(amountRaw);
  if (amount === null) {
    return err("missing or malformed amount (positive decimal USDC, ≤ 6 dp)", 400, origin);
  }

  if (!takeReadToken(getIp(req, server))) return rateLimited(origin, READ_REFILL_PER_SEC);

  // FAIL-CLOSED on a fee-tier merchant when the treasury is unresolved (mainnet
  // pre-pin) — refusing terms beats minting a split that burns the rake.
  let outputs: Output[] | null;
  try {
    outputs = await outputsFor(payTo, amount);
  } catch (e) {
    console.error("[facilitator/terms]", (e as Error).message);
    return err("fee-tier terms unavailable: treasury unresolved", 503, origin);
  }
  return json({ outputs, feeBps: feeBpsFor(payTo) }, 200, origin);
};

// ---------------------------------------------------------------------------
// POST /build { sender, outputs? | requirements? } — the optional facilitator-
// built unsigned gasless bytes (THE PROBE RECIPE). The payer signs LOCALLY and
// MUST run assertUnsignedBytesSafe before signing; we run it here too as a
// belt-and-braces gate so we never hand back unsafe bytes.
// ---------------------------------------------------------------------------

const MAX_OUTPUTS = 8;

/** Coerce the request body into { sender, outputs }. Accepts an explicit
 * `outputs` array OR a `requirements` object (we build from payTo+amount via the
 * fee policy, or the requirements' own extra.outputs). Returns a 400 string on a
 * bad shape, else { sender, outputs }. */
const resolveBuildInputs = async (
  body: Record<string, unknown>,
): Promise<{ sender: string; outputs: Output[] } | { error: string; status: number }> => {
  const sender = typeof body.sender === "string" ? body.sender.trim() : "";
  if (!SUI_ADDRESS_RE.test(sender)) {
    return { error: "missing or malformed sender (0x…64-hex Sui address)", status: 400 };
  }

  // Explicit outputs win — validate each leg's shape.
  const explicit = body.outputs;
  if (Array.isArray(explicit)) {
    if (explicit.length === 0 || explicit.length > MAX_OUTPUTS) {
      return { error: `outputs must be 1..${MAX_OUTPUTS} legs`, status: 400 };
    }
    const outputs: Output[] = [];
    for (const o of explicit) {
      const to = typeof (o as Output)?.to === "string" ? (o as Output).to.trim() : "";
      const amount = typeof (o as Output)?.amount === "string" ? (o as Output).amount.trim() : "";
      if (!SUI_ADDRESS_RE.test(to) || !/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
        return { error: "each output needs a 0x address + positive atomic-unit amount string", status: 400 };
      }
      outputs.push({ to, amount });
    }
    return { sender, outputs };
  }

  // Else derive from { payTo, amount } via the fee policy (decimal amount in).
  const req = (body.requirements ?? body) as { payTo?: unknown; amount?: unknown };
  const payTo = typeof req.payTo === "string" ? req.payTo.trim() : "";
  const amountRaw = typeof req.amount === "string" ? req.amount.trim() : "";
  if (!SUI_ADDRESS_RE.test(payTo)) {
    return { error: "missing or malformed payTo (0x…64-hex Sui address)", status: 400 };
  }
  const amount = parseAmount(amountRaw);
  if (amount === null) {
    return { error: "missing or malformed amount (positive decimal USDC, ≤ 6 dp)", status: 400 };
  }
  let split: Output[] | null;
  try {
    split = await outputsFor(payTo, amount);
  } catch (e) {
    console.error("[facilitator/build]", (e as Error).message);
    return { error: "fee-tier terms unavailable: treasury unresolved", status: 503 };
  }
  return { sender, outputs: split ?? [{ to: payTo, amount: amount.toString() }] };
};

const handleBuild = async (
  req: Request,
  origin: string | null,
  server?: Server<unknown>,
): Promise<Response> => {
  const body = (await readBody(req)) as Record<string, unknown> | null;
  if (!body) return err("invalid JSON body", 400, origin);

  const resolved = await resolveBuildInputs(body);
  if ("error" in resolved) return err(resolved.error, resolved.status, origin);

  if (!takeWriteToken(getIp(req, server))) return rateLimited(origin, WRITE_REFILL_PER_SEC);

  try {
    const { bytes } = await buildDoor({ sender: resolved.sender, outputs: resolved.outputs });
    // Belt-and-braces: prove the bytes WE built are gasless + pay exactly the split
    // before handing them to a payer to sign (the same gate the payer must run).
    await assertUnsignedBytesSafe({
      client: client(),
      bytesB64: bytes,
      sender: resolved.sender,
      asset: ASSET,
      outputs: resolved.outputs,
    });
    return json({ bytes }, 200, origin);
  } catch (e) {
    console.error("[facilitator/build]", (e as Error).message);
    // A build failure is most often "sender holds no USDC for this amount" — 402.
    return err(`build failed: ${(e as Error).message}`.slice(0, 200), 502, origin);
  }
};

// ---------------------------------------------------------------------------
// GET /tx?digest — a DESCRIPTIVE audit (never trusted, always checkable). ONE
// getTransaction read of balanceChanges → who received what of the settlement
// coin. A merchant verifies its own terms against this; the facilitator just
// surfaces the on-chain facts.
// ---------------------------------------------------------------------------

const TX_DIGEST_RE = /^[A-Za-z0-9]{40,50}$/;

const handleTx = async (
  req: Request,
  url: URL,
  origin: string | null,
  server?: Server<unknown>,
): Promise<Response> => {
  const digest = (url.searchParams.get("digest") ?? "").trim();
  if (!TX_DIGEST_RE.test(digest)) {
    return err("missing or malformed digest (base58 Sui tx digest)", 400, origin);
  }

  if (!takeReadToken(getIp(req, server))) return rateLimited(origin, READ_REFILL_PER_SEC);

  try {
    const read = await client().getTransaction({
      digest,
      include: { effects: true, balanceChanges: true, transaction: true },
    });
    const tx = read.$kind === "Transaction" ? read.Transaction : read.FailedTransaction;
    const success = tx?.effects?.status?.success === true || tx?.status?.success === true;
    const sender = (tx?.transaction as { sender?: string } | undefined)?.sender ?? "";

    // The settlement transfers of the asset: every positive credit of the coin.
    const changes = (tx?.balanceChanges ?? []) as Array<{ coinType: string; address: string; amount: string }>;
    const transfers = changes
      .filter((c) => c.coinType === ASSET && BigInt(c.amount) > 0n)
      .map((c) => ({ to: c.address, amount: c.amount }));

    return json(
      { success, payer: sender, transfers, coinType: ASSET, network: FACILITATOR_NETWORK },
      200,
      origin,
    );
  } catch (e) {
    return err(`tx unreadable: ${(e as Error).message}`.slice(0, 160), 502, origin);
  }
};

// ---------------------------------------------------------------------------
// POST /checkout — the OPTIONAL no-auth URL FORMATTER (SPEC §7.3). KEPT VERBATIM
// from the prior build: pure string assembly of the hosted pay-page URL, no
// store, no session, no chain. Validation runs BEFORE the rate token.
// ---------------------------------------------------------------------------

const MAX_RETURN_URL_LEN = 2048;
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9](@suize|\.suize\.sui)?$/;
const mintPaymentId = (): string => `pay_${randomBytes(16).toString("hex")}`;

const handleCheckout = async (
  req: Request,
  origin: string | null,
  server?: Server<unknown>,
): Promise<Response> => {
  const body = (await readBody(req)) as Partial<FacilitatorCheckoutRequest> | null;
  if (!body) return err("invalid JSON body", 400, origin);

  const payTo = typeof body.payTo === "string" ? body.payTo.trim() : "";
  const amountRaw = typeof body.amount === "string" ? body.amount.trim() : "";
  const memo = typeof body.memo === "string" ? body.memo : "";
  const returnUrlRaw = typeof body.returnUrl === "string" ? body.returnUrl.trim() : "";
  const handle = typeof body.handle === "string" ? body.handle.trim() : "";

  if (!SUI_ADDRESS_RE.test(payTo)) {
    return err("missing or malformed payTo (0x…64-hex Sui address)", 400, origin);
  }
  if (handle && !HANDLE_RE.test(handle)) {
    return err("malformed handle (a Suize handle like name@suize)", 400, origin);
  }
  if (parseAmount(amountRaw) === null) {
    return err("missing or malformed amount (positive decimal USDC, ≤ 6 dp)", 400, origin);
  }
  if (memo.length > MAX_MEMO_LEN) {
    return err(`oversized memo (max ${MAX_MEMO_LEN} chars)`, 400, origin);
  }
  let returnUrl = "";
  if (returnUrlRaw) {
    if (returnUrlRaw.length > MAX_RETURN_URL_LEN) {
      return err(`oversized returnUrl (max ${MAX_RETURN_URL_LEN} chars)`, 400, origin);
    }
    try {
      const u = new URL(returnUrlRaw);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
      returnUrl = u.toString();
    } catch {
      return err("malformed returnUrl (absolute http/https URL)", 400, origin);
    }
  }

  if (!takeWriteToken(getIp(req, server))) return rateLimited(origin, WRITE_REFILL_PER_SEC);

  const paymentId = memo || mintPaymentId();
  const params = new URLSearchParams({ payTo, amount: amountRaw, memo: paymentId });
  if (handle) params.set("to", handle);
  if (returnUrl) params.set("returnUrl", returnUrl);

  const responseBody: FacilitatorCheckoutResponse = {
    sessionUrl: `${config.payPageUrl}?${params.toString()}`,
    paymentId,
  };
  return json(responseBody, 200, origin);
};

// ---------------------------------------------------------------------------
// Route matcher — same shape as the mcp/deploy modules: first non-null wins.
// ---------------------------------------------------------------------------

export const handleFacilitatorRoute = (
  req: Request,
  url: URL,
  origin: string | null,
  server?: Server<unknown>,
): Promise<Response> | Response | null => {
  if (req.method === "GET" && url.pathname === "/supported") return handleSupported(origin);
  if (req.method === "POST" && url.pathname === "/verify") return handleVerify(req, origin, server);
  if (req.method === "POST" && url.pathname === "/settle") return handleSettle(req, origin, server);
  if (req.method === "GET" && url.pathname === "/terms") return handleTerms(req, url, origin, server);
  if (req.method === "POST" && url.pathname === "/build") return handleBuild(req, origin, server);
  if (req.method === "GET" && url.pathname === "/tx") return handleTx(req, url, origin, server);
  if (req.method === "POST" && url.pathname === "/checkout") return handleCheckout(req, origin, server);
  return null;
};

/** Boot-log surface (mirrors mcpInfo/deployInfo). */
export const facilitatorInfo = {
  network: FACILITATOR_NETWORK,
  routes: ["POST /verify", "POST /settle", "GET /supported", "POST /build", "GET /terms", "GET /tx", "POST /checkout"],
  scheme: "exact",
  merchantCount: feesInfo.merchantCount,
  treasuryName: feesInfo.treasuryName,
  payPageUrl: config.payPageUrl,
} as const;

// Re-exported so the /ready probe + boot log can report fee-tier readiness without
// reaching into ./fees directly.
export { treasuryReady, isFeeTierMerchant };
