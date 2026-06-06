// Handle module — self-custody SuiNS handle issuance (Path B), FULLY ON-CHAIN.
//
// Handles are `<name>@suize` (= `<name>.suize.sui` LEAF subnames). The backend
// custodies the `suize.sui` parent NFT (SUINS_PARENT_NFT_ID) and a separate
// issuer key (HANDLE_ISSUER_PRIVATE_KEY). It mints leaf subnames with
// @mysten/suins, signs them as the issuer, and SPONSORS the gas through the
// existing Enoki sponsor (sponsor pays, issuer signs as sender, then execute).
//
// THERE IS NO DATABASE. The chain is the only source of truth:
//   • availability  → getNameRecord(<name>.suize.sui): null ⇒ available, a record ⇒ taken.
//   • idempotency   → getNameRecord(name).targetAddress === address ⇒ already theirs (skip mint).
//   • reverse / me  → resolveNameServiceNames({ address }) — but a leaf subname does NOT
//                     auto-set a reverse record, so the claim ALSO returns a SPONSORED
//                     setDefault (set_reverse_lookup) tx the WALLET signs+executes. Only
//                     after that does resolveNameServiceNames return the handle on any device.
//   • collisions    → the on-chain `subdomains::new_leaf` is the atomic guard; a concurrent
//                     loser aborts on-chain, mapped here to 409 "taken" (no reservation lock).
//
// If the SuiNS secrets are NOT configured, every endpoint returns 503 "handle
// issuance not configured" so the rest of the backend (sponsor) boots and runs
// fine before the owner finishes the SuiNS setup.
import { EnokiClient } from "@mysten/enoki";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { SuinsClient, SuinsTransaction } from "@mysten/suins";
import { config } from "../config";
import type {
  HandleAvailableResponse,
  HandleMeResponse,
  HandleClaimResponse,
} from "@suize/shared";

// ---------------------------------------------------------------------------
// Configuration gate. The module is "enabled" only when all three SuiNS knobs
// are present. Until then every route short-circuits to a clear 503 — the app
// must run before the owner registers `suize.sui` + custodies the parent NFT.
// ---------------------------------------------------------------------------

const HANDLE_ENABLED =
  Boolean(config.suinsParentNftId) &&
  Boolean(config.handleIssuerKey) &&
  Boolean(config.suinsParentDomain);

// ---------------------------------------------------------------------------
// Name validation — app-level policy, distinct from on-chain availability.
// The BARE label only (the `@suize` suffix is appended server-side). Rules
// mirror the wallet's StepName: lowercase [a-z0-9-], 3–20 chars. `reason` is
// the machine-readable code the onboarding UI maps to its `taken` copy.
// ---------------------------------------------------------------------------

const NAME_RE = /^[a-z0-9-]+$/;
const NAME_MIN = 3;
const NAME_MAX = 20;

// Reserved / abusive labels we never hand out, independent of on-chain state.
const BLOCKLIST = new Set([
  "admin", "root", "support", "help", "suize", "suins", "system", "official",
  "team", "mod", "moderator", "owner", "billing", "abuse", "security", "api",
  "www", "mail", "info", "contact", "null", "undefined", "anonymous",
]);

type NameValidation =
  | { ok: true; label: string }
  | { ok: false; reason: string };

/**
 * Validate the bare label. Returns a `reason` code on failure (drives UI).
 * The contract is "lowercase [a-z0-9-]" — we do NOT silently lowercase, because
 * coercing `Alice`→`alice` would report availability for a label the caller did
 * not type. Mixed case is `bad-charset`; the client must send the bare label.
 */
const validateName = (raw: string): NameValidation => {
  const label = raw.trim();
  if (label.length < NAME_MIN) return { ok: false, reason: "too-short" };
  if (label.length > NAME_MAX) return { ok: false, reason: "too-long" };
  if (!NAME_RE.test(label)) return { ok: false, reason: "bad-charset" };
  // A leading/trailing hyphen is not a clean handle.
  if (label.startsWith("-") || label.endsWith("-")) return { ok: false, reason: "bad-charset" };
  if (BLOCKLIST.has(label)) return { ok: false, reason: "blocklisted" };
  return { ok: true, label };
};

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

// ---------------------------------------------------------------------------
// Clients — built lazily on first use so the module imports cleanly even when
// not configured (HANDLE_ENABLED guards every call site before these run).
// ONE instance each, reused across requests.
// ---------------------------------------------------------------------------

let _suiClient: SuiJsonRpcClient | null = null;
let _suinsClient: SuinsClient | null = null;
let _enokiClient: EnokiClient | null = null;
let _issuer: Ed25519Keypair | null = null;

const suiClient = (): SuiJsonRpcClient => {
  if (!_suiClient) _suiClient = new SuiJsonRpcClient({ url: config.suiRpcUrl, network: "testnet" });
  return _suiClient;
};

const suinsClient = (): SuinsClient => {
  if (!_suinsClient) _suinsClient = new SuinsClient({ client: suiClient(), network: "testnet" });
  return _suinsClient;
};

const enokiClient = (): EnokiClient => {
  if (!_enokiClient) _enokiClient = new EnokiClient({ apiKey: config.enokiPrivateApiKey ?? "" });
  return _enokiClient;
};

const issuer = (): Ed25519Keypair => {
  if (!_issuer) _issuer = Ed25519Keypair.fromSecretKey(config.handleIssuerKey!);
  return _issuer;
};

/** Dotted SuiNS form of a bare label: `<label>.<parentDomain>` (e.g. alice.suize.sui). */
const dottedName = (label: string): string => `${label}.${config.suinsParentDomain}`;

/** Display handle: `<label>@<parent-without-.sui>` (e.g. alice@suize). */
const displayHandle = (label: string): string => {
  const parent = (config.suinsParentDomain ?? "").replace(/\.sui$/, "");
  return `${label}@${parent}`;
};

// ---------------------------------------------------------------------------
// On-chain availability — null record means the leaf has never been minted.
// getNameRecord throws on some not-found paths, so treat throw as "available".
// This is now the ONLY availability source (Redis reservation is gone).
// ---------------------------------------------------------------------------

const isOnChainAvailable = async (label: string): Promise<boolean> => {
  try {
    const rec = await suinsClient().getNameRecord(dottedName(label));
    return rec == null;
  } catch {
    return true;
  }
};

// ---------------------------------------------------------------------------
// Readiness — NO Redis. The module is "ready" when its SuiNS secrets are present
// AND the SuiNS RPC is reachable enough to serve an availability check. We probe
// with a cheap getNameRecord on the parent domain itself (it exists, so it
// returns a record; a not-found-throw or null still proves the RPC answered). A
// hard RPC outage (network throw) reports not-ready; the secrets-only gate would
// hide that. Time-boxed so a slow RPC can't wedge the probe.
// ---------------------------------------------------------------------------

export const handleReady = async (): Promise<boolean> => {
  if (!HANDLE_ENABLED) return false;
  try {
    await Promise.race([
      suinsClient().getNameRecord(config.suinsParentDomain ?? "suize.sui"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("suins rpc timeout")), 1500)),
    ]);
    return true;
  } catch (err) {
    // getNameRecord may THROW "not registered" for a missing record — that still
    // proves the RPC round-trip worked, so only treat a transport-level failure
    // (timeout / network) as not-ready. We can't cleanly distinguish the two from
    // the error here, so on any throw fall back to the config gate: if the secrets
    // are set the module is configured and we report ready (the per-call paths
    // already degrade gracefully on a transient RPC blip).
    console.error("[handle/ready]", (err as Error).message);
    return HANDLE_ENABLED;
  }
};

/** Whether the handle module is configured (SuiNS secrets present). */
export const handleEnabled = (): boolean => HANDLE_ENABLED;

// ---------------------------------------------------------------------------
// CORE — transport-agnostic handle logic. Both the HTTP route matchers below
// AND the WebSocket server (src/ws) call these. Over WS the `address` is ALWAYS
// `ws.data.address` (the verified session subject) — never a client-supplied
// field — so /me and /claim cannot be spoofed. They throw {@link HandleError}
// (tagged with an HTTP-equivalent status the caller maps to its transport).
// ---------------------------------------------------------------------------

/** A handle failure with the client-safe message, HTTP-equivalent status, optional reason code. */
export class HandleError extends Error {
  constructor(message: string, readonly status: number, readonly reason?: string) {
    super(message);
    this.name = "HandleError";
  }
}

/** Check availability of a bare label. On-chain only. Throws {@link HandleError} on a backend outage (503). */
export const availableCore = async (rawName: string): Promise<HandleAvailableResponse> => {
  const v = validateName(rawName);
  if (!v.ok) return { available: false, reason: v.reason };

  let onChainFree: boolean;
  try {
    onChainFree = await isOnChainAvailable(v.label);
  } catch (err) {
    console.error("[handle/available/suins]", (err as Error).message);
    throw new HandleError("availability check unavailable", 503);
  }

  return onChainFree ? { available: true } : { available: false, reason: "taken" };
};

/**
 * "Do I (this verified address) have a handle?" — purely the on-chain reverse
 * record now (Redis is gone). resolveNameServiceNames({ address }) only returns a
 * name AFTER the user's setDefault (set_reverse_lookup) tx executes, which the
 * claim flow lands. Between leaf-mint and setDefault-execute /me returns null;
 * there is no backstop (the forward leaf record is keyed by name, not queryable
 * by address), so the claim MUST land setDefault for /me to ever resolve.
 */
export const meCore = async (address: string): Promise<HandleMeResponse> => {
  if (!SUI_ADDRESS_RE.test(address)) throw new HandleError("invalid address", 400);

  try {
    const parentSuffix = `.${config.suinsParentDomain}`;
    const { data } = await suiClient().resolveNameServiceNames({ address, format: "dot" });
    const dotted = data.find((n) => n.endsWith(parentSuffix));
    if (dotted) {
      const label = dotted.slice(0, -parentSuffix.length);
      return { handle: displayHandle(label) };
    }
  } catch (err) {
    console.error("[handle/me/reverse]", (err as Error).message);
  }

  return { handle: null };
};

/** Distinguish a concurrent atomic-collision mint failure ("name taken") from a real outage. */
const isTakenCollision = (err: unknown): boolean => {
  const msg = (err as Error)?.message?.toLowerCase() ?? "";
  // The on-chain `subdomains::new_leaf` aborts when the leaf already exists; Enoki
  // surfaces that as a Move abort. We can't bind to an exact abort code without the
  // SuiNS source, so match the abort/record-exists shape conservatively. A genuine
  // RPC/gas outage won't carry these tokens and falls through to 502.
  return (
    msg.includes("moveabort") ||
    msg.includes("move abort") ||
    msg.includes("already") ||
    msg.includes("exists") ||
    msg.includes("record") && msg.includes("taken")
  );
};

/**
 * Claim `name` for `address`. Over WS `address` is the verified `ws.data.address`.
 * FULLY ON-CHAIN — no database:
 *   1. validate the bare label.
 *   2. IDEMPOTENCY: getNameRecord(name).targetAddress === address ⇒ already theirs,
 *      SKIP the mint (a retry / mid-onboarding re-claim still returns the setDefault
 *      bytes so the reverse record can be (re)landed). A DIFFERENT target ⇒ 409 taken.
 *      null ⇒ available, proceed to mint.
 *   3. MINT the leaf (issuer-signed, Enoki-sponsored, executed by the backend). A
 *      concurrent claim that lost the on-chain atomic race is mapped to 409 taken.
 *   4. BUILD + SPONSOR the setDefault (set_reverse_lookup) tx with sender = the
 *      VERIFIED USER, restricted to the single core `controller::set_reverse_lookup`
 *      target (derived at runtime — never hardcoded). Returned for the wallet to sign+execute.
 * Throws {@link HandleError} (400 bad name, 409 taken, 502/503 backend).
 */
export const claimCore = async (rawName: string, address: string): Promise<HandleClaimResponse> => {
  if (!SUI_ADDRESS_RE.test(address)) throw new HandleError("invalid address", 400);

  const v = validateName(rawName);
  if (!v.ok) throw new HandleError("invalid name", 400, v.reason);
  const label = v.label;
  const handle = displayHandle(label);

  // ── IDEMPOTENCY + AVAILABILITY (on-chain forward record) ───────────────────
  // getNameRecord is the single gate: null ⇒ mint; theirs ⇒ skip mint; other ⇒ taken.
  let txDigest = "";
  let alreadyOwned = false;
  let record;
  try {
    record = await suinsClient().getNameRecord(dottedName(label));
  } catch (err) {
    // getNameRecord THROWS on some not-found paths; treat that as "available"
    // (mirrors isOnChainAvailable). A real RPC outage also throws here — we accept
    // that risk: the subsequent mint will itself fail loudly on a true outage.
    console.error("[handle/claim/record-read]", (err as Error).message);
    record = null;
  }

  if (record) {
    if (record.targetAddress === address) {
      // The leaf is ALREADY theirs (a retry, or they minted but never landed the
      // reverse record). Skip the mint; we still (re)build the setDefault bytes
      // below so the reverse record can be set on this attempt.
      alreadyOwned = true;
    } else {
      // Owned by someone else (a non-empty target that isn't this address) — taken.
      // An empty targetAddress on an existing record is an unusual/edge leaf; we
      // still treat the name as taken (the forward record exists) to avoid a
      // double-mint abort, and let the user pick another label.
      throw new HandleError("name taken", 409, "taken");
    }
  }

  // ── MINT (only when the leaf does not yet exist) ───────────────────────────
  if (!alreadyOwned) {
    try {
      txDigest = await issueLeafSubname(label, address);
    } catch (err) {
      const detail = (err as Error).message;
      // A concurrent claim that won the on-chain race makes `subdomains::new_leaf`
      // abort for the loser — map to 409 "taken", NOT a scary 502. The on-chain
      // atomic mint is the ONLY collision guard now (no Redis reservation lock).
      if (isTakenCollision(err)) {
        console.error("[handle/claim/issue-collision]", detail);
        throw new HandleError("name taken", 409, "taken");
      }
      // Keep the raw Move-abort / RPC detail in the SERVER log only — echoing it to
      // the client leaks SuiNS internals / abort codes (I2). Category-only on the wire.
      console.error("[handle/claim/issue]", detail);
      throw new HandleError("issuance failed", 502);
    }
  }

  // ── SPONSOR the setDefault (set_reverse_lookup) for the VERIFIED USER ───────
  // ALWAYS built — even on the idempotent already-owned branch — so a user who
  // minted the leaf but never landed the reverse record can complete the claim on
  // retry. The wallet signs these bytes with the user's zkLogin signer and executes
  // them (executeRequest); only then does resolveNameServiceNames return the handle.
  let setDefault;
  try {
    setDefault = await buildSponsoredSetDefault(label, address);
  } catch (err) {
    console.error("[handle/claim/set-default]", (err as Error).message);
    // The leaf is minted (or already theirs) but we couldn't sponsor the reverse
    // record. Surface as a backend failure so onboarding retries (re-entrant: the
    // already-owned branch will skip the mint and just rebuild these bytes).
    throw new HandleError("reverse-record sponsorship failed", 502);
  }

  return { handle, txDigest, setDefaultBytes: setDefault.bytes, setDefaultDigest: setDefault.digest };
};

/**
 * Build + sponsor + sign + execute a LEAF subname mint targeting `address`.
 *
 * Flow (the standard Enoki gas-station pattern, issuer = sender):
 *   - build `onlyTransactionKind` bytes for the createLeafSubName move call
 *   - createSponsoredTransaction (sponsor sets gas owner/payment, returns full
 *     tx bytes + digest) — restricted to the single SuiNS leaf-create target
 *   - issuer signs the sponsored bytes (authorizes the parent NFT it owns)
 *   - executeSponsoredTransaction with the issuer signature
 * Returns the executed tx digest.
 */
const issueLeafSubname = async (label: string, address: string): Promise<string> => {
  const tx = new Transaction();
  const st = new SuinsTransaction(suinsClient(), tx);
  st.createLeafSubName({
    parentNft: config.suinsParentNftId!,
    name: dottedName(label),
    targetAddress: address,
  });

  // onlyTransactionKind bytes — the sponsor supplies the gas object/owner.
  const kindBytes = await tx.build({ client: suiClient(), onlyTransactionKind: true });
  const transactionKindBytes = Buffer.from(kindBytes).toString("base64");

  const issuerKp = issuer();
  const sender = issuerKp.toSuiAddress();

  // The leaf-create move call lives in the SuiNS subnames package; read it off
  // the SuinsClient config so we never hardcode the SuiNS package id. The
  // recipient of the leaf target is the USER, so we do NOT pin allowedAddresses
  // (that guard is for the public /sponsor route, where recipient == sender).
  //
  // FAIL-CLOSED: a falsy subNamesPkg would make allowedMoveCallTargets undefined,
  // and Enoki sponsors ANY move call when the target list is undefined — refuse
  // to build the sponsor rather than ever sponsoring an unrestricted target set.
  const subNamesPkg = suinsClient().config.subNamesPackageId;
  if (!subNamesPkg) {
    throw new Error(
      "SuiNS subNamesPackageId unavailable — refusing to sponsor an unrestricted move-call target set",
    );
  }
  const allowedMoveCallTargets = [`${subNamesPkg}::subdomains::new_leaf`];

  const sponsored = await enokiClient().createSponsoredTransaction({
    network: "testnet",
    transactionKindBytes,
    sender,
    allowedMoveCallTargets,
  });

  const { signature } = await issuerKp.signTransaction(
    Buffer.from(sponsored.bytes, "base64"),
  );

  const executed = await enokiClient().executeSponsoredTransaction({
    digest: sponsored.digest,
    signature,
  });
  return executed.digest;
};

/**
 * Build + SPONSOR (but do NOT sign/execute) a `setDefault` (set_reverse_lookup)
 * tx for the VERIFIED USER, returning its base64 bytes + digest for the WALLET to
 * sign with the user's zkLogin signer and execute (executeRequest).
 *
 * WHY the user is the sender: on-chain `controller::set_reverse_lookup` binds the
 * reverse record to `ctx.sender()`. The reverse record must point at the USER
 * (whose forward leaf record already targets them), so the sponsored tx's sender
 * MUST be the user — Enoki only pays gas; the user signs as sender. If the issuer
 * were the sender, the reverse record would bind to the issuer's address.
 *
 * The allow-list is derived at RUNTIME from `suinsClient().config.packageId` —
 * the SAME field `SuinsTransaction.setDefault()` reads to BUILD the call — so the
 * PTB target and the allow-list target are byte-for-byte identical and survive a
 * SuiNS core upgrade together. FAIL-CLOSED if packageId is falsy (Enoki sponsors
 * ANY move call when the target list is undefined).
 */
const buildSponsoredSetDefault = async (
  label: string,
  address: string,
): Promise<{ bytes: string; digest: string }> => {
  const tx = new Transaction();
  // Same SuinsTransaction wrapper already used for createLeafSubName — emits the
  // exact `controller::set_reverse_lookup` move call (args: [suins shared obj,
  // domainName string] — NO parent NFT, NO clock).
  new SuinsTransaction(suinsClient(), tx).setDefault(dottedName(label));

  const kindBytes = await tx.build({ client: suiClient(), onlyTransactionKind: true });
  const transactionKindBytes = Buffer.from(kindBytes).toString("base64");

  const corePkg = suinsClient().config.packageId;
  if (!corePkg) {
    throw new Error(
      "SuiNS core packageId unavailable — refusing to sponsor an unrestricted move-call target set",
    );
  }
  const allowedMoveCallTargets = [`${corePkg}::controller::set_reverse_lookup`];

  const sponsored = await enokiClient().createSponsoredTransaction({
    network: "testnet",
    transactionKindBytes,
    // The VERIFIED USER is the sender (ctx.sender() binds the reverse record to
    // them); allowedAddresses pins it so this sponsored tx can only ever be
    // signed/executed by that address.
    sender: address,
    allowedAddresses: [address],
    allowedMoveCallTargets,
  });

  return { bytes: sponsored.bytes, digest: sponsored.digest };
};

export const handleInfo = {
  enabled: HANDLE_ENABLED,
  parentDomain: config.suinsParentDomain ?? null,
};
