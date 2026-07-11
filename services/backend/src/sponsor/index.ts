// Sponsor module — Enoki sponsored-transaction backend.
// Folded from the standalone `suize-sponsor` service. Sponsorship is now
// WS-ONLY: the authenticated WebSocket (src/ws) calls createSponsor /
// executeSponsor DIRECTLY, pinning `sender` to the verified ws.data.address.
// The former public HTTP POST /sponsor + POST /execute routes have been REMOVED
// (no body-trusted `sender`, no per-IP limiter — the WS path's per-address token
// bucket + the global daily quota are the gas-drain backstops). This module now
// exposes only the transport-agnostic CORE (createSponsor / executeSponsor /
// SponsorError), the shared suiClient, and a readiness probe (`sponsorReady`)
// used by the shared /ready endpoint.
import { EnokiClient } from "@mysten/enoki";
import {
  CRASH_MOVE_TARGETS,
  SUBS_MOVE_TARGETS,
  SUBS_PUBLISHED,
  AUCTION_MOVE_TARGETS,
  AUCTION_PUBLISHED,
  PROFILE_MOVE_TARGETS,
  PROFILE_PUBLISHED,
  TRACE_MOVE_TARGETS,
  TRACE_PUBLISHED,
} from "@suize/shared";
import type { SponsorRequest, SponsorResponse, ExecuteRequest, ExecuteResponse } from "@suize/shared";
import { config } from "../config";
import { grpcClient } from "../sui";
import { sponsorDailyCeiling } from "../quota";

const ENOKI_PRIVATE_API_KEY = config.enokiPrivateApiKey;

// Only the SUFFIX is shown; the secret never hits the logs.
export const maskKey = (key: string) => (key.length <= 6 ? "***" : `***${key.slice(-4)}`);

// ---------------------------------------------------------------------------
// Server-side move-call allow-list. Enoki refuses to sponsor any transaction
// that calls a target outside this set — the abuse guard against draining the
// gas pool with arbitrary move calls. These are public on-chain ids.
//
// The target lists are the SINGLE SOURCE OF TRUTH in @suize/shared:
//   - CRASH_MOVE_TARGETS   : the live `…::router::*` Crash targets (testnet).
//   - SUBS_MOVE_TARGETS    : the standalone `subs::subscription` create/renew/cancel
//     (+ the framework helpers the CoinWithBalance intent injects). User-signed +
//     Enoki-sponsored; unioned in only once published.
//
// RETIRED — WALLET_MOVE_TARGETS (the legacy mandate/vault/swap/navi package) is NO
// LONGER sponsored. move-wallet is retired-in-place and called by NO first-party code;
// leaving its 28 targets in this list was a live path (a free zkLogin session could get
// gas sponsored for dead-module constructor calls — bounded griefing) and contradicted
// the "in NO live path" law. Removed 2026-06-14 (Move audit). If a legacy demo ever
// needs it, re-add behind a default-OFF env flag (mirror the SUBS_PUBLISHED fence).
// ---------------------------------------------------------------------------

// x402 V2 settles KEYLESS over gRPC, NOT via the sponsor — so the rail's payment
// verbs are never Enoki-sponsored. CRASH stays (its gasless router writes); SUBS is
// unioned in only once published (the renewal/create PTBs are user-signed +
// Enoki-sponsored). AUCTION (the directory's ad-slot `bid`) is the SAME shape —
// user-signed + Enoki-sponsored — unioned in only once published. A `0x0::subs::*`
// or `0x0::auction::*` target would poison the list, so the *_PUBLISHED guards fence them.
// MEMWAL (the wallet memory onboarding): the user's zkLogin wallet signs ONE
// sponsored createAccount + addDelegateKey to authorize the backend's derived
// MEMORY delegate key (NOT a money key — see src/memory). Built from the env
// package id, gated so an unset MEMWAL_PACKAGE_ID never poisons the list.
const MEMWAL_MOVE_TARGETS: string[] = config.memwalPackageId
  ? [
      `${config.memwalPackageId}::account::create_account`,
      `${config.memwalPackageId}::account::add_delegate_key`,
    ]
  : [];

const ALLOWED_MOVE_TARGETS: string[] = [
  ...CRASH_MOVE_TARGETS,
  ...(SUBS_PUBLISHED ? SUBS_MOVE_TARGETS : []),
  ...(AUCTION_PUBLISHED ? AUCTION_MOVE_TARGETS : []),
  // PROFILE (the BusinessProfile mint/edit): create_profile/edit_profile each push a
  // $0.10 Balance<USDC> → treasury, USER-SIGNED + Enoki-sponsored — same shape as subs.
  // Unioned in only once published (a `0x0::profile::*` target would poison the list).
  ...(PROFILE_PUBLISHED ? PROFILE_MOVE_TARGETS : []),
  // TRACE (the wallet's encrypted-history anchor): `trace::anchor` is USER-SIGNED +
  // Enoki-sponsored (it moves no coins). `seal_approve` is dry-run, never sponsored.
  // Unioned in only once published (a `0x0::trace::anchor` target would poison the list).
  ...(TRACE_PUBLISHED ? TRACE_MOVE_TARGETS : []),
  ...MEMWAL_MOVE_TARGETS,
];

// ---------------------------------------------------------------------------

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
// Gas-budget bound: Enoki sets the gas budget from the tx it sponsors, and it
// scales with PTB complexity. `onlyTransactionKind` BCS carries no gas field we
// can read, so we cap the EFFECTIVE budget by bounding the decoded kind size.
// A legitimate crash/wallet PTB (a few move calls) is at most a couple KiB;
// 16 KiB is generous headroom yet rejects a pathological many-command PTB built
// purely to inflate Enoki's gas estimate and drain the pool. base64 inflates by
// ~4/3, so the encoded string cap is derived from this decoded cap.
const MAX_TX_KIND_BYTES = 16 * 1024;
const MAX_TX_KIND_B64_LEN = Math.ceil((MAX_TX_KIND_BYTES * 4) / 3) + 4;

// NOTE: there is NO per-IP token bucket here anymore. It only ever guarded the
// (now-removed) public HTTP /sponsor + /execute routes. Over the WS-only path the
// per-AUTHENTICATED-address token bucket (src/ws/index.ts) plus the process-global
// daily quota (createSponsor → sponsorDailyCeiling, below) are the gas-drain caps.

// Enoki client + Sui RPC client. If the key is missing the app refuses to boot
// (see src/index.ts), so by the time these run the key is present.
const enokiClient = new EnokiClient({ apiKey: ENOKI_PRIVATE_API_KEY ?? "" });
// Exported so the WS server (src/ws/balance) reuses the SAME gRPC client for the
// initial getBalance push — one client, one place, no second config.
export const suiClient = grpcClient();

export const sponsorReady = async (): Promise<boolean> => {
  if (!ENOKI_PRIVATE_API_KEY) return false;
  try {
    // Cheapest gRPC liveness read — LedgerService.GetServiceInfo returns the node's
    // latest checkpoint height (the gRPC equivalent of getLatestCheckpointSequenceNumber),
    // proving the endpoint answers. Keep the 1s abort budget.
    const info = await Promise.race([
      suiClient.ledgerService.getServiceInfo({}),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 1000)),
    ]);
    return typeof info.response.checkpointHeight === "bigint";
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// CORE — the Enoki calls, transport-agnostic. The WebSocket server (src/ws) is
// now the ONLY caller; sponsorship logic lives in EXACTLY one place. They
// validate the wire contract and either return the shared response type or throw
// `SponsorError` (a tagged, client-safe error the WS route maps onto an
// errorResponse frame; the `.status` field is the HTTP-equivalent code).
// ---------------------------------------------------------------------------

/** A validation/Enoki failure with the client-safe message + HTTP-equivalent status.
 *  `reason` is a machine-readable category (never abort-code detail) the client keys
 *  on: `'tx-would-revert'` = the tx is deterministically doomed (terminal, don't retry);
 *  `'sponsor-unavailable'` = a transient sponsor/Enoki failure (safe to retry). */
export class SponsorError extends Error {
  constructor(message: string, readonly status: number, readonly reason?: string) {
    super(message);
    this.name = "SponsorError";
  }
}

// EnokiClientError carries the ACTUAL failure reason in `code` + `errors[]` (and
// sometimes a nested `cause`), NOT in `.message` (which is just "Bad Request").
// That detail — a server-side dry-run MoveAbort (e.g. a cash_out/redeem against a
// stale/wrong reconstructed position), an Enoki policy/allow-list rejection, or an
// internal address/object id — is INFORMATION DISCLOSURE if echoed to the client:
// it leaks our Move abort codes, allow-list shape, and dry-run internals to an
// external attacker probing the surface. So we log the full detail SERVER-SIDE
// and return a CATEGORY-ONLY message to the client (e.g. "sponsorship failed").
type EnokiErrorShape = {
  code?: unknown;
  errors?: Array<{ message?: unknown }> | undefined;
  cause?: unknown;
};

const enokiFailure = (tag: string, err: unknown, fallback: string): SponsorError => {
  const e = err as Error & EnokiErrorShape;
  const detail =
    e?.errors?.[0]?.message != null ? String(e.errors[0].message) : undefined;
  // Full diagnostics stay in the server log ONLY — never on the wire.
  console.error(`[${tag}]`, {
    message: e?.message,
    code: e?.code,
    detail,
    cause: e?.cause,
  });
  // A dry-run MoveAbort means the tx would REVERT on-chain (e.g. a claim/cash_out
  // against an already-redeemed or stale position) — a DETERMINISTIC client error,
  // not a transient sponsor outage. Tag it `tx-would-revert` (a 422) so the caller
  // resolves it terminally and never retries a doomed tx. We still echo NO abort
  // code/module/function — only the safe category. Everything else is treated as a
  // transient sponsor/Enoki failure (`sponsor-unavailable`, 502) the caller may retry.
  if (detail && /dry run failed|moveabort/i.test(detail)) {
    return new SponsorError("the transaction would not succeed on-chain", 422, "tx-would-revert");
  }
  return new SponsorError(fallback, 502, "sponsor-unavailable");
};

/**
 * Validate + create an Enoki-sponsored transaction. Throws {@link SponsorError}
 * on bad input (400) or an Enoki failure (502). The `sender` is the trusted
 * subject — over WS it MUST be `ws.data.address` (never a client-supplied field).
 */
export const createSponsor = async (input: Partial<SponsorRequest>): Promise<SponsorResponse> => {
  const network = typeof input?.network === "string" ? input.network : "";
  const transactionKindBytes = typeof input?.transactionKindBytes === "string" ? input.transactionKindBytes : "";
  const sender = typeof input?.sender === "string" ? input.sender : "";

  // Accept the CONFIGURED network, with 'testnet' ADDITIONALLY allowed always:
  // Crash is network-pinned to testnet (LOCKED #11), so its sponsorship must
  // survive a future mainnet flip of the rest of the stack (Enoki sponsors
  // per-network — the `network` field rides through to createSponsoredTransaction).
  if (network !== config.suiNetwork && network !== "testnet") {
    throw new SponsorError("unsupported network", 400);
  }
  if (!SUI_ADDRESS_RE.test(sender)) throw new SponsorError("invalid sender address", 400);
  if (!transactionKindBytes || !BASE64_RE.test(transactionKindBytes)) {
    throw new SponsorError("invalid transactionKindBytes", 400);
  }
  // Gas-budget bound: reject an oversized PTB before it reaches Enoki, so a
  // jailbroken client cannot inflate the sponsored gas budget by submitting a
  // pathologically large transaction kind (see MAX_TX_KIND_BYTES). The base64
  // length cap is a cheap upper bound on the decoded byte size.
  if (transactionKindBytes.length > MAX_TX_KIND_B64_LEN) {
    throw new SponsorError("transaction too large", 400);
  }

  // GAS-DRAIN CEILING — enforced for BOTH transports (HTTP /sponsor + WS
  // sponsorRequest both land here). A process-global daily cap on total
  // sponsored txs, plus a per-address sub-cap, both keyed by the validated
  // `sender`. Hit either and we 429 BEFORE spending a cent of the Enoki pool.
  // Status 429 is mapped client-side to a "slow down / try later" toast.
  const quota = sponsorDailyCeiling.consume(sender);
  if (!quota.ok) {
    throw new SponsorError(
      quota.scope === "global"
        ? "sponsor capacity reached, try again later"
        : "daily sponsor limit reached for this account",
      429,
    );
  }

  // Restrict the address allow-list to the sender so the sponsored tx cannot
  // move funds to a third party.
  const allowedAddresses = [sender];

  try {
    const result = await enokiClient.createSponsoredTransaction({
      network: network as SponsorRequest["network"],
      transactionKindBytes,
      sender,
      allowedAddresses,
      allowedMoveCallTargets: ALLOWED_MOVE_TARGETS,
    });
    return { bytes: result.bytes, digest: result.digest };
  } catch (err) {
    throw enokiFailure("sponsor", err, "sponsorship failed");
  }
};

/**
 * Validate + execute a previously sponsored transaction. Throws
 * {@link SponsorError} on bad input (400) or an Enoki failure (502).
 */
export const executeSponsor = async (input: Partial<ExecuteRequest>): Promise<ExecuteResponse> => {
  const digest = typeof input?.digest === "string" ? input.digest.trim() : "";
  const signature = typeof input?.signature === "string" ? input.signature.trim() : "";

  if (!digest) throw new SponsorError("missing digest", 400);
  if (!signature) throw new SponsorError("missing signature", 400);

  try {
    const result = await enokiClient.executeSponsoredTransaction({ digest, signature });
    // FIRE-AND-FORGET storage hook: a sponsored tx just executed. If it was a Deploy
    // storage subscription create/renew, the extender reads its events and extends the
    // site's Walrus storage now (the safety cron is the backstop). Never blocks the
    // execute response, never throws — a best-effort side-effect on the ONE call site
    // every sponsored tx passes through. The dynamic import avoids a module-init cycle
    // (deploy/extend imports the deploy module which imports back).
    void import("../deploy/extend")
      .then((m) => m.notifySettled(result.digest))
      .catch(() => {});
    return { digest: result.digest };
  } catch (err) {
    throw enokiFailure("execute", err, "execution failed");
  }
};

export const sponsorInfo = {
  allowedMoveTargetCount: ALLOWED_MOVE_TARGETS.length,
  crashTargetCount: CRASH_MOVE_TARGETS.length,
  // move-wallet (the retired mandate/vault/swap/navi package) is NO LONGER sponsored
  // (2026-06-14 audit) — it is called by no first-party code and is out of every live
  // path, including this allow-list.
  // SUBS (the recurring half) is in the effective list only once published — the
  // renewal/create PTBs are user-signed + Enoki-sponsored. Report the gate state.
  subsPublished: SUBS_PUBLISHED,
  subsTargetCount: SUBS_PUBLISHED ? SUBS_MOVE_TARGETS.length : 0,
  // AUCTION (the directory ad-slot `bid`) — same user-signed + Enoki-sponsored shape;
  // in the effective list only once published. Report the gate state.
  auctionPublished: AUCTION_PUBLISHED,
  auctionTargetCount: AUCTION_PUBLISHED ? AUCTION_MOVE_TARGETS.length : 0,
};

/**
 * Build + Enoki-SPONSOR an arbitrary transaction-kind for a caller, returning the
 * sponsored bytes + digest. Thin wrapper over {@link createSponsor} that the
 * deploy-charge join (and any future in-process builder) calls directly with bytes
 * it already built `onlyTransactionKind`. The `sender` is the trusted subject — the
 * caller MUST pass the VERIFIED owner address (never a raw body field). Throws
 * {@link SponsorError} on bad input / Enoki failure / quota, exactly like the wire path.
 */
export const sponsorKindBytes = async (
  sender: string,
  transactionKindBytes: string,
): Promise<SponsorResponse> =>
  createSponsor({ network: config.suiNetwork, sender, transactionKindBytes });
