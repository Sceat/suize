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
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import {
  CRASH_MOVE_TARGETS,
  SUBS_MOVE_TARGETS,
  SUBS_PUBLISHED,
} from "@suize/shared";
import type { SponsorRequest, SponsorResponse, ExecuteRequest, ExecuteResponse } from "@suize/shared";
import { config } from "../config";
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
// Enoki-sponsored). A `0x0::subs::*` target would poison the list, so the
// SUBS_PUBLISHED guard fences it.
const ALLOWED_MOVE_TARGETS: string[] = [
  ...CRASH_MOVE_TARGETS,
  ...(SUBS_PUBLISHED ? SUBS_MOVE_TARGETS : []),
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
// Exported so the WS server (src/ws/balance) reuses the SAME RPC client for the
// initial getBalance push — one client, one place, no second config.
export const suiClient = new SuiJsonRpcClient({ url: config.suiRpcUrl, network: config.suiNetwork });

export const sponsorReady = async (): Promise<boolean> => {
  if (!ENOKI_PRIVATE_API_KEY) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    try {
      const seq = await suiClient.getLatestCheckpointSequenceNumber({ signal: controller.signal });
      return typeof seq === "string" && seq.length > 0;
    } finally {
      clearTimeout(timer);
    }
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

/** A validation/Enoki failure with the client-safe message + HTTP-equivalent status. */
export class SponsorError extends Error {
  constructor(message: string, readonly status: number) {
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
  // Client gets the category only. No Enoki/Move-abort detail leaks off-box.
  return new SponsorError(fallback, 502);
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
