// Deploy storage SUBSCRIPTION — the raw-agent buyer-build helper (the recurring half
// of Deploy billing). Deploy is a FIRST-PARTY MERCHANT onboarded on the Suize rail:
// it consumes subscriptions the SAME way any external merchant does — the buyer mints
// a standalone `subs::subscription::Subscription<USDC>` (the merchant = the Deploy
// treasury, the `ref` = the site id), and Deploy READS that state through the merchant
// SDK (`@suize/pay/subs` — see deploySubs() / the /domains gate / extend.ts). There is
// NO Deploy-specific subscription store or registry; the chain is the database.
//
// WHY THIS IS A SPONSORED OWNER TX, NOT THE x402 SPINE (the one non-obvious constraint):
// `subs::create` PUSHES one period's `Balance<USDC>` via the SDK `tx.balance({type,
// balance})` intent, which injects the framework helpers `balance::redeem_funds` /
// `coin::into_balance`. That is NOT a vanilla `0x2::balance::send_funds`, so it CANNOT
// ride the keyless gRPC /verify+/settle spine the $0.50 deploy charge uses. It is a
// user-signed OWNER tx that must be ENOKI-SPONSORED — the framework helpers are on the
// sponsor allow-list (SUBS_MOVE_TARGETS, gated on SUBS_PUBLISHED). A fresh zkLogin
// payer also holds no SUI for self-gas, so sponsorship keeps the create gasless.
//
// TWO BUYERS, ONE CREATE PTB SHAPE:
//   - the WALLET signs create LOCALLY over its own WS Enoki-sponsor path (apps/wallet
//     src/data/subs.ts buildCreate → runSponsored) — unchanged by this module.
//   - a RAW HTTP AGENT uses THIS helper: POST /deploy/subscribe/build returns sponsored
//     signable bytes, the agent signs locally, POST /deploy/subscribe/submit executes.
//   Both produce the IDENTICAL create<USDC>(config, merchant, amount, period, ref,
//   payment, clock) call — this file mirrors buildCreate verbatim (the single source of
//   the create PTB shape) so the two buyers are wire-identical.
//
// PAYER == OWNER: the build step asserts `sender` owns the Site whose id becomes the
// sub's `ref`, and `sponsorKindBytes` pins the sponsored tx's sender to that verified
// owner. The submit step re-recovers the signer from the sponsored bytes and re-asserts
// it equals that same owner before executing — the integrity bind (the create carries no
// x402 terms-match to lean on). NOTE: the per-ADDRESS renewer no longer trusts `ref` (it
// enumerates the owner's OWN sites — extend.ts), so this is NOT a renewer security gate;
// it keeps the buyer a real deployer and `ref` = siteId a meaningful post-submit read-back.
import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import {
  PACKAGE_IDS,
  USDC_TYPES,
  type SuiNetwork,
} from "@suize/shared";
import { recoverPayer } from "@suize/x402";
import { config } from "../config";
import { json } from "../http";
import { sponsorKindBytes, executeSponsor, SponsorError, suiClient as sponsorSuiClient } from "../sponsor";
import { deployMerchant } from "./payment";
import { deploySubs, refToSiteIdHex } from "./subs-state";
import { deploySuiClient } from "./index";
import type { Server } from "bun";

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;
const USDC_TYPE = USDC_TYPES[config.suiNetwork as SuiNetwork];

const SUBS_PUBLISHED = PACKAGE_IDS.SUBS.PACKAGE !== "0x0";
const SUBS_CONFIG = PACKAGE_IDS.SUBS.CONFIG_OBJECT;
const SUBS_CREATE = PACKAGE_IDS.SUBS.TARGETS.CREATE;
const CLOCK_ID = "0x6";

// ---------------------------------------------------------------------------
// The on-chain `owner` recorded on a v2 Site — the ownership bind. A subscription
// for a site you don't own is pointless (the extender refuses it), so we gate the
// build on `sender === Site.owner`. Mirrors the deploy module's own siteOwner read.
// ---------------------------------------------------------------------------

const siteOwner = async (siteId: string): Promise<string | null> => {
  try {
    const res = await deploySuiClient().getObject({ id: siteId, options: { showContent: true } });
    const content = res.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    if (content.type !== `${PACKAGE_IDS.DEPLOY.PACKAGE}::site::Site`) return null;
    const owner = (content.fields as Record<string, unknown>).owner;
    return typeof owner === "string" && SUI_ADDRESS_RE.test(owner) ? owner.toLowerCase() : null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// The create<USDC> kind-tx — mirrors apps/wallet/src/data/subs.ts buildCreate
// EXACTLY (arg order: config, merchant, amount, period_ms, ref, payment, clock;
// the payment is tx.balance, NOT a coin split; ref = the siteId's 32 bytes). The
// amount/period are the deterministic shared consts (the number wall) read through
// config (config.deploySubPriceUsdc / deploySubPeriodMs — the env override exists
// only to run a reduced TESTNET price; prod is the $19.99 / 30-day constants).
// ---------------------------------------------------------------------------

/** Decode a hex site id (`0x…64`) to the 32-byte `vector<u8>` ref (the sub↔site join,
 * read back post-submit via suizeSubs.findByRef). Mirrors the wallet's toRefBytes. */
const toRefBytes = (siteId: string): number[] => {
  const clean = siteId.startsWith("0x") ? siteId.slice(2) : siteId;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
};

const buildSubscribeKind = (siteId: string, merchant: string, sender: string): Transaction => {
  const tx = new Transaction();
  // The `tx.balance({type,balance})` CoinWithBalance intent resolves the sender's funds
  // at build time, so the sender MUST be set before build({onlyTransactionKind:true})
  // (Enoki re-pins it on sponsor; setting it here is required for the kind-bytes build).
  tx.setSender(sender);
  const amount = BigInt(config.deploySubPriceUsdc);
  const payment = tx.balance({ type: USDC_TYPE, balance: amount });
  tx.moveCall({
    target: SUBS_CREATE,
    arguments: [
      tx.object(SUBS_CONFIG),
      tx.pure.address(merchant),
      tx.pure.u64(amount),
      tx.pure.u64(BigInt(config.deploySubPeriodMs)),
      tx.pure.vector("u8", toRefBytes(siteId)),
      payment,
      tx.object(CLOCK_ID),
    ],
    typeArguments: [USDC_TYPE],
  });
  return tx;
};

// ---------------------------------------------------------------------------
// Build → sign → submit state. A short-TTL in-process map binds a sponsored
// `digest` to its build context: the sponsored `bytes` (so submit can re-recover
// the signer and re-assert payer == owner), the `siteId` (so submit can read the
// new sub back via suizeSubs.findByRef), and the `sender`. Per-replica, single-use:
// it stops a stale/foreign signature from executing a build it didn't originate, and
// makes a re-submit of the SAME digest idempotent (Enoki's executeSponsoredTransaction
// is itself idempotent on a digest — a second execute returns the same digest). The
// chain is the durable fact; this map is only the in-process integrity bind.
// ---------------------------------------------------------------------------

interface PendingSub {
  bytes: string;
  siteId: string;
  sender: string; // lowercased
  at: number;
}
const pendingSubs = new Map<string, PendingSub>();
const PENDING_TTL_MS = 5 * 60 * 1000;

const sweepPending = (): void => {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [d, p] of pendingSubs) if (p.at < cutoff) pendingSubs.delete(d);
};
setInterval(sweepPending, PENDING_TTL_MS).unref?.();

const subscribeEnabled = (): boolean =>
  Boolean(config.deployWalletKey) && SUBS_PUBLISHED && PACKAGE_IDS.DEPLOY.PACKAGE !== "0x0";

// ---------------------------------------------------------------------------
// POST /deploy/subscribe/build { siteId, sender } → { bytes, digest, amount,
// periodMs, merchant }. Verifies the Site exists AND `sender` owns it, builds the
// sponsored create kind-tx, returns the signable sponsored bytes + digest. The buyer
// signs `bytes` LOCALLY (zkLogin / Ed25519) and calls /submit.
// ---------------------------------------------------------------------------

export const handleSubscribeBuild = async (
  req: Request,
  origin: string | null,
  server?: Server<unknown>,
): Promise<Response> => {
  if (!subscribeEnabled()) {
    return json({ error: "subscriptions not configured (subs module unpublished or deploy wallet unset)" }, 503, origin);
  }

  let body: { siteId?: unknown; sender?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, 400, origin);
  }
  const siteId = String(body?.siteId ?? "").trim().toLowerCase();
  const sender = String(body?.sender ?? "").trim().toLowerCase();
  if (!SUI_ADDRESS_RE.test(siteId)) return json({ error: "invalid siteId" }, 400, origin);
  if (!SUI_ADDRESS_RE.test(sender)) return json({ error: "invalid sender address" }, 400, origin);

  const merchant = await deployMerchant();
  if (!merchant) return json({ error: "rail not configured: Deploy treasury unresolved" }, 503, origin);

  // OWNERSHIP BIND — a sub for a site you don't own is pointless (the extender's F5
  // gate refuses it). Reject up front with a clear message.
  const owner = await siteOwner(siteId);
  if (!owner) return json({ error: "site not found" }, 404, origin);
  if (owner !== sender) return json({ error: "sender is not the site owner" }, 403, origin);

  const kind = buildSubscribeKind(siteId, merchant, sender);
  let kindBytes: string;
  try {
    kindBytes = toBase64(await kind.build({ client: sponsorSuiClient, onlyTransactionKind: true }));
  } catch (err) {
    return json({ error: `failed to build subscription tx: ${(err as Error).message}` }, 500, origin);
  }

  try {
    const sponsored = await sponsorKindBytes(sender, kindBytes);
    pendingSubs.set(sponsored.digest, { bytes: sponsored.bytes, siteId, sender, at: Date.now() });
    return json(
      {
        bytes: sponsored.bytes,
        digest: sponsored.digest,
        siteId,
        merchant,
        amount: String(config.deploySubPriceUsdc),
        periodMs: config.deploySubPeriodMs,
      },
      200,
      origin,
    );
  } catch (err) {
    if (err instanceof SponsorError) return json({ error: err.message }, err.status, origin);
    return json({ error: `sponsorship failed: ${(err as Error).message}` }, 502, origin);
  }
};

// ---------------------------------------------------------------------------
// POST /deploy/subscribe/submit { digest, signature } → { digest, subscriptionId,
// siteId, active }. Re-recovers the signer from the sponsored bytes and re-asserts
// payer == owner (the integrity bind — the create has no x402 terms to lean on),
// then executeSponsor broadcasts. `notifySettled` (fired inside executeSponsor)
// auto-extends the site's storage in the same beat. The new sub is read back via the
// merchant SDK — suizeSubs.findByRef(siteId) — proving Deploy reads sub STATE through
// @suize/pay, not a bespoke chain read.
// ---------------------------------------------------------------------------

export const handleSubscribeSubmit = async (
  req: Request,
  origin: string | null,
  _server?: Server<unknown>,
): Promise<Response> => {
  if (!subscribeEnabled()) {
    return json({ error: "subscriptions not configured" }, 503, origin);
  }

  let body: { digest?: unknown; signature?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, 400, origin);
  }
  const digest = String(body?.digest ?? "").trim();
  const signature = String(body?.signature ?? "").trim();
  if (!digest) return json({ error: "missing digest" }, 400, origin);
  if (!signature) return json({ error: "missing signature" }, 400, origin);

  const pending = pendingSubs.get(digest);
  if (!pending) {
    // Unknown / expired digest — never executed here, or already swept. Fail closed:
    // we cannot re-assert payer == owner without the build context.
    return json({ error: "unknown or expired digest — call /deploy/subscribe/build first" }, 409, origin);
  }

  // RE-ASSERT payer == owner — recover the signer from the SPONSORED bytes + the
  // submitted signature; it MUST equal the verified owner the build pinned. A foreign
  // signature (a different key signing the same digest) is rejected before execute.
  let payer: string;
  try {
    payer = (await recoverPayer(pending.bytes, signature)).toLowerCase();
  } catch {
    return json({ error: "unrecoverable subscription signature" }, 403, origin);
  }
  if (payer !== pending.sender) {
    return json({ error: "subscription was not signed by the site owner" }, 403, origin);
  }

  // EXECUTE — Enoki broadcasts (idempotent on the digest); notifySettled auto-extends
  // the site's storage in the same beat (no extra wiring).
  let executedDigest: string;
  try {
    const res = await executeSponsor({ digest, signature });
    executedDigest = res.digest;
  } catch (err) {
    if (err instanceof SponsorError) return json({ error: err.message }, err.status, origin);
    return json({ error: `execution failed: ${(err as Error).message}` }, 502, origin);
  }

  // Read the new subscription back through the MERCHANT SDK (suizeSubs.findByRef) —
  // single source of sub state. Best-effort + bounded retry for node lag; the digest
  // is the hard proof regardless.
  let subscriptionId: string | null = null;
  let active = false;
  const subs = await deploySubs();
  if (subs) {
    const deadline = Date.now() + 8_000;
    for (;;) {
      try {
        const status = await subs.findByRef(refToSiteIdHex(pending.siteId));
        if (status) {
          subscriptionId = status.subscriptionId;
          active = status.active;
          break;
        }
      } catch {
        /* node lag — retry */
      }
      if (Date.now() > deadline) break;
      await sleep(500);
    }
  }
  pendingSubs.delete(digest);

  return json({ digest: executedDigest, subscriptionId, siteId: pending.siteId, active }, 200, origin);
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const subscribeInfo = {
  enabled: subscribeEnabled(),
  amount: config.deploySubPriceUsdc,
  periodMs: config.deploySubPeriodMs,
};
