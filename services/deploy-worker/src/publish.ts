// POST /deploy — the paid publish flow, AUTHENTICATED BY THE PAYMENT ITSELF.
//
// A bare POST answers 402 with the x402 PaymentRequired terms for the REQUESTED
// months/sealed (price discovery is zero-shot: the same URL + params quote and
// charge). The paid retry is multipart/form-data with `name`, `site.tar`, and
// the X-PAYMENT header; the RECOVERED PAYER becomes the on-chain owner — no
// account, no API key, whoever pays owns.
//
// Order of operations (each step's failure mode is priced):
//   1. validate inputs + caps (free rejects BEFORE the payment wall),
//   2. verify the payment (simulate-only, facilitator /verify),
//   3. SETTLE (facilitator /settle) — idempotent by digest, before any spend,
//   4. REPLAY GUARD: if the settled digest already minted a Site, return it — no
//      Walrus store, no allowlist mint (a replayed/retried X-PAYMENT never re-burns
//      unrecoverable `permanent=true` WAL),
//   5. sealed only: mint the on-chain allowlist + Seal-encrypt every file,
//   6. store quilt + manifest on Walrus for the full purchased epochs (months are
//      capped so a purchase always fits the Walrus one-shot ceiling; no cron),
//   7. mint the Site (create_site consumes the settled digest — one site per
//      payment, enforced on-chain).
// A death between 3 and 7 strands nothing: settle is idempotent by digest and the
// digest is only consumed at the mint, so the SAME X-PAYMENT retries — and step 4
// makes that retry recover the existing site instead of re-storing.

import { parseTar, type ParsedTarFileItem } from "nanotar";
import {
  DEPLOY_MONTH_MS,
  deployEpochsForMonths,
  deployPriceUsdc,
  maxDeployMonths,
  MAX_SITE_WALRUS_USD_PER_MONTH,
  SEAL_KEY_SERVERS,
  WALRUS_MAX_EPOCHS_AHEAD,
  walrusMonthlyCostUsd,
  walrusEpochToMs,
  withinUploadCap,
} from "@suize/shared";
import { chargeConfigured, network, type Env } from "./env";
import { json, b64json } from "./http";
import { sha256Hex, encodeObjectIdToBase36 } from "./util";
import { contentTypeFor } from "./content-type";
import { buildManifest, type ManifestInput } from "./manifest";
import { storeQuilt, storeBlob, WalrusError, type QuiltInputFile } from "./walrus";
import { fetchPolicy, gatePayment, settlePayment, quoteRequirements, mint402, PaymentError } from "./payment";
import {
  createAllowlistOnChain,
  createSiteOnChain,
  serviceAddress,
  deployIds,
  readSite,
  siteIdByDigest,
  ChainError,
  EDIGEST_USED_STATUS,
} from "./chain";
import { sealEncrypt, SealUnavailableError } from "./seal";

// ── caps ──────────────────────────────────────────────────────────────────────

const MAX_BUNDLE_BYTES = 100 * 1024 * 1024; // CF ingress practical ceiling
const MAX_FILE_COUNT = 2000;
const MAX_NAME_LEN = 64;

/** The per-deploy receipt file injected into every bundle (unique bytes → the
 * Walrus quilt can never dedup). RESERVED: a user file at this path is dropped. */
const DEPLOY_RECEIPT_PATH = "/.suize/deploy.json";

// ── tar normalisation (ported from the retired backend) ───────────────────────

interface NormalizedFile {
  servedPath: string;
  identifier: string;
  data: Uint8Array;
}

class PublishError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

const identifierFor = (servedPath: string): string =>
  servedPath.replace(/^\//, "").replace(/\//g, "__") || "index.html";

const normalizeEntries = (entries: ParsedTarFileItem[]): NormalizedFile[] => {
  const out: NormalizedFile[] = [];
  const seenIds = new Set<string>();

  for (const e of entries) {
    if (e.type && e.type !== "file" && e.type !== "contiguousFile") continue;
    if (!e.data || (e.data.length === 0 && e.name.endsWith("/"))) continue;

    let name = e.name.replace(/\\/g, "/").trim();
    if (!name || name.endsWith("/")) continue;
    name = name.replace(/^\.\//, "").replace(/^\/+/, "");
    if (name.split("/").some((seg) => seg === "..")) {
      throw new PublishError(`unsafe path in bundle: ${e.name}`, 400);
    }
    const servedPath = `/${name}`;

    const data = e.data ?? new Uint8Array(0);
    let identifier = identifierFor(servedPath);
    let n = 1;
    while (seenIds.has(identifier)) identifier = `${identifierFor(servedPath)}.${n++}`;
    seenIds.add(identifier);

    out.push({ servedPath, identifier, data });
  }
  return out;
};

// ── request-param parsing (query and/or form fields; form wins) ───────────────

interface DeployParams {
  months: number;
  sealed: boolean;
}

const parseParams = (url: URL, maxMonths: number, form?: FormData): DeployParams => {
  const raw = (key: string): string | null => {
    const f = form?.get(key);
    if (typeof f === "string" && f.trim() !== "") return f.trim();
    return url.searchParams.get(key);
  };
  const monthsRaw = raw("months") ?? "1";
  const months = Number(monthsRaw);
  // The one-shot Walrus ceiling: months may never exceed what a single store can
  // fund on THIS network (there is no cron backstop). Rejected here as a 400,
  // BEFORE any 402 is quoted, so an agent is never walked into paying for time
  // Walrus cannot store.
  if (!Number.isInteger(months) || months < 1 || months > maxMonths) {
    throw new PublishError(`months must be an integer in [1, ${maxMonths}]`, 400);
  }
  const sealedRaw = (raw("sealed") ?? raw("private") ?? "").toLowerCase();
  const sealed = sealedRaw === "1" || sealedRaw === "true";
  return { months, sealed };
};

const riderFor = (p: DeployParams, maxMonths: number): string =>
  `Suize: the payment IS the authorization — whoever pays owns the site. ` +
  `This quote is ${p.months} month${p.months === 1 ? "" : "s"} of hosting` +
  `${p.sealed ? " (private site, 2x rate)" : ""} at a flat monthly rate, up to ${maxMonths} months per payment, ` +
  `extend anytime by paying the same URL's /extend with your site id. Sign the gasless ` +
  `payment yourself and retry as multipart/form-data with fields name + site.tar plus ` +
  `the X-PAYMENT header carrying the b64 PaymentPayload. One payment mints one site.`;

/** The success body for a Site a settled payment ALREADY minted — the idempotent
 * recovery shape shared by the pre-store replay guard and the post-mint
 * EDigestUsed backstop. Reads the site's current on-chain paid-through / sealed
 * flag (best-effort; the digest→site mapping proves the site exists). */
const recoveredSiteResponse = async (
  env: Env,
  params: DeployParams,
  siteId: string,
  digest: string,
): Promise<Response> => {
  const sub = encodeObjectIdToBase36(siteId);
  const st = await readSite(env, siteId);
  return json({
    siteId,
    subdomain: sub,
    url: `https://${sub}.${(env.BASE_DOMAIN || "suize.site").toLowerCase()}`,
    version: 1,
    digest,
    recovered: true,
    paidUntilMs: st?.paidUntilMs ?? Date.now() + params.months * DEPLOY_MONTH_MS,
    sealed: st?.sealed ?? params.sealed,
  });
};

// ── durable per-digest concurrency claim (F3) ─────────────────────────────────
// The on-chain SiteDigestRegistry stops a double-MINT; this stops the double
// permanent=true WAL STORE two CONCURRENT requests with the SAME settled digest
// would otherwise both incur (both pass the pre-store recovery check before either
// mints). Before storing we atomically claim the digest in the durable R2 blob
// cache (put-if-absent); only the winner stores. A claim carries a timestamp so a
// crashed attempt's orphan self-heals after CLAIM_TTL_MS (a bounded retry window,
// never a permanent strand) — and the winner releases it on any error so its own
// retry isn't locked out. Best-effort when no bucket is bound (dev).
const CLAIM_TTL_MS = 120_000;
const claimKey = (digest: string): string => `deploy-claim/${digest}`;

/** Atomically claim `digest` before storing. Returns true iff THIS request won. */
const claimDigest = async (env: Env, digest: string): Promise<boolean> => {
  const bucket = env.BLOB_CACHE;
  if (!bucket) return true; // no durable store (dev) — proceed best-effort
  const key = claimKey(digest);
  const won = await bucket.put(key, JSON.stringify({ ts: Date.now() }), {
    onlyIf: { etagDoesNotMatch: "*" },
  });
  if (won !== null) return true; // put-if-absent succeeded → fresh claim
  // A claim exists: an ACTIVE concurrent attempt (fresh ts) → lose; a stale orphan
  // (a crashed attempt past the TTL) → reclaim and proceed (never a permanent strand).
  const existing = await bucket.get(key);
  const prev = existing ? ((await existing.json().catch(() => null)) as { ts?: number } | null) : null;
  if (prev && typeof prev.ts === "number" && Date.now() - prev.ts < CLAIM_TTL_MS) return false;
  await bucket.put(key, JSON.stringify({ ts: Date.now() })); // reclaim the orphan
  return true;
};

/** Release a claim so a FAILED attempt's own retry isn't locked out (settle is
 * idempotent by digest; a kept claim would 409 the retry until the TTL). */
const releaseClaim = async (env: Env, digest: string): Promise<void> => {
  try {
    await env.BLOB_CACHE?.delete(claimKey(digest));
  } catch {
    /* best-effort */
  }
};

// ── the route ─────────────────────────────────────────────────────────────────

export const handleDeploy = async (req: Request, env: Env): Promise<Response> => {
  if (!chargeConfigured(env)) return json({ error: "deploy not configured" }, 503);

  const url = new URL(req.url);
  const net = network(env);
  const maxMonths = maxDeployMonths(net);

  // FIX 1 (money-safety): a sealed (private) deploy needs Seal key servers to
  // encrypt. Where none are configured for this network (an empty
  // SEAL_KEY_SERVERS list), reject BEFORE any quote/settle: otherwise the payment
  // settles and sealEncrypt fails, taking money for a site that can't be produced.
  const assertSealAvailable = (p: DeployParams): void => {
    if (p.sealed && SEAL_KEY_SERVERS[net].length === 0) {
      throw new PublishError("private sites are not available on this network yet", 400);
    }
  };

  // Oversized bodies are rejected up front via Content-Length (multipart parse
  // would otherwise buffer the whole tar first).
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BUNDLE_BYTES) return json({ error: "bundle too large (max 100 MB)" }, 413);

  const payHeader = (req.headers.get("X-PAYMENT") ?? req.headers.get("PAYMENT-SIGNATURE") ?? "").trim();

  // The last successfully-parsed params — a failure-path 402 must re-quote the
  // REQUESTED months/sealed (a default-months challenge after a 6-month attempt
  // would walk the agent into paying the wrong quote).
  let lastParams: DeployParams | null = null;

  // Set once THIS request wins the durable store-claim (F3); released on any error
  // exit so a failed attempt's own idempotent retry isn't locked out.
  let claimedDigest: string | null = null;

  // One challenge minter for every 402 exit (discovery + definitive failures).
  const challenge402 = async (p: DeployParams, errorOverride?: string): Promise<Response> => {
    const policy = await fetchPolicy(env);
    const body = mint402(env, policy, BigInt(deployPriceUsdc(p.months, p.sealed)), req.url, riderFor(p, maxMonths));
    if (errorOverride) body.error = errorOverride;
    return json(body, 402, { "PAYMENT-REQUIRED": b64json(body) });
  };

  try {
    // ── discovery shot: no payment, maybe no body — answer the quote ─────────
    if (!payHeader) {
      let form: FormData | undefined;
      try {
        form = await req.formData();
      } catch {
        form = undefined; // a bare POST with no body is a price probe
      }
      lastParams = parseParams(url, maxMonths, form);
      assertSealAvailable(lastParams);
      return await challenge402(lastParams);
    }

    // ── paid retry: parse the bundle ──────────────────────────────────────────
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json({ error: "invalid multipart body" }, 400);
    }
    const params = parseParams(url, maxMonths, form);
    lastParams = params;
    assertSealAvailable(params);

    const name = String(form.get("name") ?? "").trim();
    if (!name || name.length > MAX_NAME_LEN) {
      return json({ error: "missing or oversized 'name' field" }, 400);
    }
    const file = form.get("site.tar");
    if (!(file instanceof File)) return json({ error: "missing 'site.tar' file" }, 400);

    const tarBytes = new Uint8Array(await file.arrayBuffer());
    if (tarBytes.byteLength === 0) return json({ error: "empty 'site.tar'" }, 400);
    if (tarBytes.byteLength > MAX_BUNDLE_BYTES) return json({ error: "bundle too large (max 100 MB)" }, 413);

    let files = normalizeEntries(parseTar(tarBytes));
    if (files.length === 0) return json({ error: "no files in bundle" }, 400);
    if (files.length > MAX_FILE_COUNT) return json({ error: `too many files (max ${MAX_FILE_COUNT})` }, 400);

    const totalBytes = files.reduce((n, f) => n + f.data.byteLength, 0);
    // The storage-cost wall (owner law): a site may not cost more than
    // $0.05/month of Walrus storage — checked BEFORE the payment wall so an
    // over-cap bundle never charges.
    if (!withinUploadCap(totalBytes)) {
      return json(
        {
          error:
            `site too large: its storage would cost ` +
            `$${walrusMonthlyCostUsd(totalBytes).toFixed(3)}/month ` +
            `(cap $${MAX_SITE_WALRUS_USD_PER_MONTH.toFixed(2)}/month)`,
        },
        413,
      );
    }

    // ── verify the payment against OUR quote for THESE params ────────────────
    const policy = await fetchPolicy(env);
    const amount = BigInt(deployPriceUsdc(params.months, params.sealed));
    const { requirements } = quoteRequirements(env, policy, amount, req.url);
    const verified = await gatePayment(env, payHeader, requirements);
    const owner = verified.payer;

    // ── SETTLE FIRST (idempotent by digest) ───────────────────────────────────
    // Settle is idempotent — a replay/retry of a settled payment re-settles to the
    // SAME digest and spends nothing extra — so we settle BEFORE any WAL spend or
    // allowlist mint and use the digest to short-circuit a replay. This keeps the
    // "settle before any Walrus spend" invariant AND closes the replay WAL burn: a
    // settled X-PAYMENT re-driven with a fresh tar (fresh salt → fresh bytes) can no
    // longer re-store at full, unrecoverable `permanent=true` cost. Mirrors /extend,
    // which consumes the digest before its convergent WAL spend.
    const tStart = Date.now();
    const paymentDigest = await settlePayment(env, verified);
    const tSettle = Date.now();

    // ── REPLAY/RETRY RECOVERY — before any spend ──────────────────────────────
    // If this settled payment already minted a Site, return THAT — never re-store
    // Walrus bytes and never mint a fresh allowlist. A genuinely-stranded deploy
    // (settled, but WAL never spent / Site never minted) finds nothing here and
    // completes normally below; the post-mint EDigestUsed catch is the backstop.
    const recovered = await siteIdByDigest(env, paymentDigest);
    if (recovered) return await recoveredSiteResponse(env, params, recovered, paymentDigest);

    // ── DURABLE CONCURRENCY CLAIM — before any WAL store (F3) ─────────────────
    // Two CONCURRENT requests with this same settled digest could both pass the
    // recovery check above before either mints. Claim the digest durably so only
    // one stores; a loser recovers the concurrently-minted site or 409-retries.
    if (!(await claimDigest(env, paymentDigest))) {
      const existing = await siteIdByDigest(env, paymentDigest);
      if (existing) return await recoveredSiteResponse(env, params, existing, paymentDigest);
      return json({ error: "this payment is already being processed; retry in a moment" }, 409);
    }
    claimedDigest = paymentDigest;

    // ── receipt salt (Walrus dedup guard; unique bytes per deploy) ────────────
    files = files.filter((f) => f.servedPath !== DEPLOY_RECEIPT_PATH);
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const receiptBytes = new TextEncoder().encode(
      JSON.stringify({
        deployedAt: Date.now(),
        owner,
        months: params.months,
        sealed: params.sealed,
        salt: Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join(""),
      }),
    );
    let receiptId = identifierFor(DEPLOY_RECEIPT_PATH);
    const takenIds = new Set(files.map((f) => f.identifier));
    let rn = 1;
    while (takenIds.has(receiptId)) receiptId = `${identifierFor(DEPLOY_RECEIPT_PATH)}.${rn++}`;
    files.push({ servedPath: DEPLOY_RECEIPT_PATH, identifier: receiptId, data: receiptBytes });

    // ── sealed: mint the allowlist, then encrypt EVERY stored byte ────────────
    let allowlistId: string | null = null;
    if (params.sealed) {
      const created = await createAllowlistOnChain(env, owner);
      allowlistId = created.allowlistId;
      const pkg = deployIds(env).PACKAGE;
      for (const f of files) {
        f.data = await sealEncrypt(env, pkg, allowlistId, f.data);
      }
    }

    // ── store: one quilt + the manifest ───────────────────────────────────────
    const epochs = Math.max(1, Math.min(deployEpochsForMonths(params.months, net), WALRUS_MAX_EPOCHS_AHEAD));
    const quiltInputs: QuiltInputFile[] = [];
    const manifestInputs: ManifestInput[] = [];
    for (const f of files) {
      const ct = contentTypeFor(f.servedPath);
      quiltInputs.push({ servedPath: f.servedPath, identifier: f.identifier, data: f.data, contentType: ct });
      manifestInputs.push({
        servedPath: f.servedPath,
        storedSha256: await sha256Hex(f.data),
        ct,
        storedSize: f.data.byteLength,
        patch: "", // filled after the quilt store
      });
    }

    const publisher = (env.WALRUS_PUBLISHER ?? "").replace(/\/$/, "");
    const svc = serviceAddress(env);
    const pubJwt = env.WALRUS_PUBLISHER_JWT_SECRET;
    const quilt = await storeQuilt(publisher, quiltInputs, epochs, svc, pubJwt);
    const tQuilt = Date.now();

    for (const m of manifestInputs) m.patch = quilt.patchIds[m.servedPath]!;
    const manifest = buildManifest(manifestInputs, allowlistId ? { allowlistId } : null);
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const manifestHashHex = await sha256Hex(manifestBytes);
    const stored = await storeBlob(publisher, manifestBytes, epochs, svc, pubJwt);
    const tManifest = Date.now();

    // ── mint the Site (consumes the payment digest on-chain) ──────────────────
    // EDigestUsed here = a RETRY whose FIRST attempt already minted (a death after
    // the mint but before this response): the payer's money already bought a site,
    // so recover its id from the on-chain digest→site trail and return THAT, never
    // a 409 (money-hat HIGH: settle-then-strand). The re-uploaded blobs from this
    // attempt are orphaned-harmless (they expire unpaid).
    const paidUntilMs = Date.now() + params.months * DEPLOY_MONTH_MS;
    let siteId: string;
    let digest: string;
    try {
      ({ siteId, digest } = await createSiteOnChain(env, {
        name,
        owner,
        quiltId: quilt.quiltId,
        manifestBlobId: stored.blobId,
        manifestHashHex,
        quiltBlobObject: quilt.quiltBlobObject,
        manifestBlobObject: stored.blobObject,
        sizeBytes: totalBytes,
        fileCount: files.length,
        paidUntilMs,
        sealed: params.sealed,
        paymentDigest,
      }));
    } catch (err) {
      if (err instanceof ChainError && err.status === EDIGEST_USED_STATUS) {
        const existing = await siteIdByDigest(env, paymentDigest);
        if (existing) return await recoveredSiteResponse(env, params, existing, paymentDigest);
      }
      throw err;
    }

    const t = (a: number, b: number) => `${((b - a) / 1000).toFixed(1)}s`;
    console.log(
      `[deploy] ${siteId} — settle ${t(tStart, tSettle)} · quilt ${t(tSettle, tQuilt)} · manifest ${t(tQuilt, tManifest)} · mint ${t(tManifest, Date.now())} · total ${t(tStart, Date.now())}`,
    );

    const subdomain = encodeObjectIdToBase36(siteId);
    const siteUrl = `https://${subdomain}.${(env.BASE_DOMAIN || "suize.site").toLowerCase()}`;
    const body = {
      siteId,
      subdomain,
      url: siteUrl,
      version: 1,
      digest,
      months: params.months,
      paidUntilMs,
      storageEndEpoch: Math.min(quilt.endEpoch, stored.endEpoch),
      expiresAtMs: walrusEpochToMs(Math.min(quilt.endEpoch, stored.endEpoch), net),
      sealed: params.sealed,
      ...(allowlistId ? { allowlistId } : {}),
    };

    // Warm the serving path (public sites only; a sealed URL serves the viewer
    // bootstrap, nothing to warm).
    if (!params.sealed) void fetch(siteUrl, { signal: AbortSignal.timeout(30_000) }).catch(() => {});

    return json(body, 200);
  } catch (err) {
    // A failed attempt must free its durable store-claim so the SAME settled
    // X-PAYMENT can be retried (settle is idempotent by digest); a kept claim
    // would 409 the retry until the TTL. Success/recovery paths return above and
    // keep the claim (the on-chain mint + siteIdByDigest then cover replays).
    if (claimedDigest) await releaseClaim(env, claimedDigest);
    if (err instanceof PaymentError) {
      if (err.challenge) {
        try {
          return await challenge402(lastParams ?? parseParams(url, maxMonths), err.message);
        } catch {
          /* the challenge itself failed (policy fetch) — fall through */
        }
      }
      return json({ error: err.message }, err.status);
    }
    if (err instanceof SealUnavailableError) return json({ error: err.message }, 503);
    if (err instanceof WalrusError) return json({ error: err.message }, err.status);
    if (err instanceof ChainError) return json({ error: err.message }, err.status);
    if (err instanceof PublishError) return json({ error: err.message }, err.status);
    console.error("[deploy]", (err as Error).message);
    return json({ error: "deploy failed" }, 500);
  }
};
