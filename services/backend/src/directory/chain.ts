// Directory CHAIN reads — the merchant-agnostic enumeration of live Suize x402
// payments that CREDIT THE TREASURY, read LIVE from chain (the chain is the
// database; we store NO payment state). A fee-bearing payment (a registered
// merchant, or any tier above the $0.01-floor split) carries a positive treasury
// leg, so a single `queryTransactionBlocks({ ToAddress: treasury })` enumerates
// every such payment with ZERO per-merchant config. Free-tier single-output
// payments (a non-registered payTo — see facilitator/fees.ts) have no treasury
// anchor and are intentionally absent. The treasury resolves LIVE from
// `treasury@suize` (never hardcoded); we fail-closed (the caller 503s) when it
// can't resolve.
//
// Per-tx parse (USDC balance-changes only):
//   • treasuryFee = the USDC leg whose owner == treasury — QUALIFY a tx as a payment
//     ONLY when this leg is POSITIVE (treasury received). A negative/absent treasury
//     leg is treasury SPENDING (test noise) → skip.
//   • payer = the most-NEGATIVE USDC leg's address.
//   • merchant = the largest POSITIVE non-treasury USDC leg's address; when there is
//     NO positive non-treasury leg (a deploy charge: the whole amount → treasury),
//     merchant = treasury (the directory / Suize itself).
//   • gross = sum of all positive USDC legs; fee = treasuryFee; feeBps = fee/gross.
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { parseSerializedSignature } from "@mysten/sui/cryptography";
import { MultiSigPublicKey } from "@mysten/sui/multisig";
import {
  resolveTreasury,
  SUI_ADDRESS_RE,
  USDC_TYPES,
  BUSINESS_PROFILE_TYPE,
  type SuiNetwork,
} from "@suize/shared";
import { config } from "../config";

// ── ONE Sui JSON-RPC client (same construction as the facilitator/handle modules) ─
let _client: SuiJsonRpcClient | null = null;
export const suiClient = (): SuiJsonRpcClient =>
  (_client ??= new SuiJsonRpcClient({ url: config.suiRpcUrl, network: config.suiNetwork }));

// Per-RPC client cache for the FEED FALLBACK. The `ToAddress` transaction filter that
// /feed + /rankings depend on is supported by Sui full nodes but DROPPED by some
// commercial RPC providers (→ the scan throws → the directory 502s). So readPayments
// tries each RPC in config.suiRpcUrls in order and uses the first that answers. Display
// sugar (handles/profiles) keeps using the primary suiClient() — a miss there is benign.
const _fallbackClients = new Map<string, SuiJsonRpcClient>();
const clientFor = (url: string): SuiJsonRpcClient => {
  let c = _fallbackClients.get(url);
  if (!c) {
    c = new SuiJsonRpcClient({ url, network: config.suiNetwork });
    _fallbackClients.set(url, c);
  }
  return c;
};

/** The native USDC type for the configured network — the only coin a payment leg
 * counts as. Matched case-insensitively on the `::usdc::usdc` suffix so a `0x0…2`
 * vs `0x2`-normalised address never causes a miss. */
const USDC_TYPE = USDC_TYPES[config.suiNetwork as SuiNetwork];
const isUsdc = (coinType: string): boolean =>
  coinType.toLowerCase().includes("::usdc::usdc");
void USDC_TYPE; // the suffix match IS the network-agnostic test; kept for reference.

// ── treasury resolution — LIVE from `treasury@suize`, cached + fail-closed ────────
// Mirrors the facilitator's fee-policy treasury cache (resolve ≤ hourly, keep the
// last good value across a transient miss, "" when it has never resolved).
const TREASURY_TTL_MS = 60 * 60_000;
let _treasury: { addr: string; at: number } | null = null;

/** The Suize treasury (lower-cased), resolved from `treasury@suize` and cached (≤1h).
 * "" when it has never resolved — the caller MUST fail-closed (503), never guess. */
export const treasuryAddress = async (): Promise<string> => {
  const now = Date.now();
  if (_treasury && now - _treasury.at < TREASURY_TTL_MS) return _treasury.addr;
  try {
    const addr = await resolveTreasury(suiClient());
    if (addr && SUI_ADDRESS_RE.test(addr)) {
      _treasury = { addr, at: now };
      return addr;
    }
    console.error("[directory] treasury@suize did not resolve — directory reads fail-closed");
  } catch (e) {
    console.error("[directory] treasury resolution failed:", (e as Error).message);
  }
  return _treasury?.addr ?? "";
};

// ── balance-change shapes (the JSON-RPC `BalanceChange`) ──────────────────────────
type ObjectOwner =
  | { AddressOwner: string }
  | { ObjectOwner: string }
  | { Shared: { initial_shared_version: string } }
  | "Immutable"
  | { ConsensusAddressOwner: { owner: string; start_version: string } };

type BalanceChange = { amount: string; coinType: string; owner: ObjectOwner };

/** The address-owner of a balance-change leg, or null for non-address ownership
 * (shared / immutable / object-owned — never a payment counterparty). */
const ownerAddress = (owner: ObjectOwner): string | null =>
  typeof owner === "object" && owner !== null && "AddressOwner" in owner
    ? owner.AddressOwner.toLowerCase()
    : null;

// ── the parsed payment record (atomic-unit string amounts, like the rest of the rail) ─
export type DirectoryPayment = {
  digest: string;
  payer: string;
  merchant: string;
  /** sum of all positive USDC legs (merchant net + fee). */
  gross: string;
  /** the treasury fee leg (always positive — the qualifying condition). */
  fee: string;
  /** round(fee / gross * 10000). */
  feeBps: number;
  timestampMs: number;
};

/**
 * Parse ONE transaction's USDC balance-changes into a DirectoryPayment, or null when
 * it is NOT a qualifying x402 payment (no positive treasury USDC leg → treasury
 * spending / unrelated). `treasury` is the lower-cased resolved address.
 */
export const parsePayment = (
  digest: string,
  timestampMsRaw: string | null | undefined,
  changes: BalanceChange[] | null | undefined,
  treasury: string,
): DirectoryPayment | null => {
  const usdc = (changes ?? []).filter((c) => isUsdc(c.coinType));
  if (usdc.length === 0) return null;

  // The treasury leg MUST exist AND be positive (treasury received) to qualify.
  let treasuryFee = 0n;
  let hasTreasuryLeg = false;
  for (const c of usdc) {
    if (ownerAddress(c.owner) === treasury) {
      treasuryFee += BigInt(c.amount); // merge if the chain splits it (it won't, but safe)
      hasTreasuryLeg = true;
    }
  }
  if (!hasTreasuryLeg || treasuryFee <= 0n) return null;

  // payer = the most-NEGATIVE USDC leg's address.
  let payer = "";
  let mostNegative = 0n;
  // merchant = the largest POSITIVE non-treasury USDC leg's address.
  let merchant = "";
  let largestPositive = 0n;
  // gross = sum of all positive USDC legs.
  let gross = 0n;

  for (const c of usdc) {
    const addr = ownerAddress(c.owner);
    const amt = BigInt(c.amount);
    if (amt > 0n) gross += amt;
    if (addr === null) continue;
    if (amt < mostNegative) {
      mostNegative = amt;
      payer = addr;
    }
    if (amt > largestPositive && addr !== treasury) {
      largestPositive = amt;
      merchant = addr;
    }
  }

  // No positive non-treasury leg (e.g. a deploy charge: the full amount → treasury) →
  // the directory / Suize itself IS the merchant.
  if (!merchant) merchant = treasury;

  const feeBps = gross > 0n ? Number((treasuryFee * 10_000n) / gross) : 0;
  const timestampMs = timestampMsRaw ? Number(timestampMsRaw) : 0;

  return {
    digest,
    payer,
    merchant,
    gross: gross.toString(),
    fee: treasuryFee.toString(),
    feeBps,
    timestampMs,
  };
};

/**
 * Read the most recent qualifying payments to the treasury, newest-first. `want` is
 * the number of QUALIFYING payments to return; we may scan more raw txs (treasury
 * spends / non-USDC are skipped) up to `maxScan` to fill the page. ONE
 * queryTransactionBlocks call per ~50-tx page (descending). Throws on an RPC outage
 * (the caller surfaces a 502); returns [] only when the chain genuinely has none.
 */
export const readPayments = async (
  treasury: string,
  want: number,
  maxScan = 400,
): Promise<DirectoryPayment[]> => {
  // Try each configured RPC in order; the first that answers the ToAddress scan wins.
  // (A provider that dropped the filter throws → we fall through to the next URL rather
  // than 502 the whole directory. ALL failing still throws → the caller 502s, the
  // honest signal to add a filter-supporting full node to SUI_RPC_URLS.)
  const urls = config.suiRpcUrls?.length ? config.suiRpcUrls : [config.suiRpcUrl];
  let lastErr: unknown;
  for (const url of urls) {
    try {
      return await scanPaymentsVia(clientFor(url), treasury, want, maxScan);
    } catch (e) {
      lastErr = e;
      console.error(
        `[directory/readPayments] RPC ${url} unusable for the ToAddress scan:`,
        (e as Error).message,
      );
    }
  }
  throw lastErr ?? new Error("no RPC configured for the directory scan");
};

// Phase-2 bounds. The public testnet fullnode prunes effects aggressively — most
// treasury txs (even recent ones) can't yield balance changes — so a batch
// `multiGetTransactionBlocks({showBalanceChanges})` fails for the WHOLE batch with
// `InvalidParams: "...effect is empty"`. There is therefore no batch fast-path to be had;
// we read PER-TX and skip the pruned ones. We bound that three ways so a growing /
// pruned-heavy history can never blow past the ingress timeout (→ a 504): a per-call
// timeout (a hung node never stalls the scan), bounded concurrency (no burst of N
// parallel RPCs), and a global wall-clock deadline (return what we have so far).
const PHASE2_CONCURRENCY = 12;
const PER_CALL_TIMEOUT_MS = 4_000;
const SCAN_DEADLINE_MS = 8_000;

type TxChanges = { digest: string; timestampMs?: string | null; balanceChanges?: BalanceChange[] | null };

/** ONE tx's balance changes, never throwing, bounded by a timeout — effect-pruned /
 *  slow / unreadable all resolve to null and the caller skips them. */
const oneTxChanges = (client: SuiJsonRpcClient, digest: string): Promise<TxChanges | null> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), PER_CALL_TIMEOUT_MS);
  });
  return Promise.race([
    client.getTransactionBlock({ digest, options: { showBalanceChanges: true } }).catch(() => null),
    timeout,
  ]).finally(() => clearTimeout(timer));
};

/**
 * The actual descending ToAddress scan against ONE client (see readPayments).
 *
 * TWO-PHASE (the fix for the directory 502): (1) page DIGESTS ONLY — NO `showBalanceChanges`,
 * so the fullnode never derives effects and never hits the "effect is empty" page error that
 * took the directory down; (2) resolve balance changes PER-TX (bounded concurrency + per-call
 * timeout + a global deadline), skipping effect-pruned txs. Only a genuine page-listing failure
 * throws (caught by readPayments' per-URL fallback). Newest-first order is preserved.
 */
const scanPaymentsVia = async (
  client: SuiJsonRpcClient,
  treasury: string,
  want: number,
  maxScan: number,
): Promise<DirectoryPayment[]> => {
  // Phase 1 — collect candidate digests, newest-first, WITHOUT effects (pruning-safe).
  const digests: string[] = [];
  let cursor: string | null | undefined = undefined;
  while (digests.length < maxScan) {
    const page = await client.queryTransactionBlocks({
      filter: { ToAddress: treasury },
      options: {},
      order: "descending",
      cursor: cursor ?? undefined,
      limit: 50,
    });
    for (const tx of page.data) digests.push(tx.digest);
    if (!page.hasNextPage || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  // Phase 2 — resolve per-tx (bounded), parse + qualify until `want` OR the scan deadline.
  const out: DirectoryPayment[] = [];
  const deadline = Date.now() + SCAN_DEADLINE_MS;
  for (let i = 0; i < digests.length && out.length < want && Date.now() < deadline; i += PHASE2_CONCURRENCY) {
    const txs = await Promise.all(digests.slice(i, i + PHASE2_CONCURRENCY).map((d) => oneTxChanges(client, d)));
    for (const tx of txs) {
      if (!tx) continue; // effect-pruned / timed-out → skip, never fatal
      // A malformed balance-change amount (a bad BigInt) also degrades gracefully.
      try {
        const p = parsePayment(tx.digest, tx.timestampMs, tx.balanceChanges, treasury);
        if (p) out.push(p);
      } catch (e) {
        console.error(`[directory/parse] ${tx.digest}:`, (e as Error).message);
      }
      if (out.length >= want) break;
    }
  }
  return out;
};

// ── reverse-handle resolution — cached + resilient (a miss → null, never throws) ──
// Address → `<label>@suize` (or the raw SuiNS name if not a Suize handle). Cached with
// a TTL; a failed resolve caches null so a feed render never re-hammers the RPC. NEVER
// throws into the feed (display sugar only).
const HANDLE_TTL_MS = 5 * 60_000;
const handleCache = new Map<string, { handle: string | null; at: number }>();

/** Canonicalize a SuiNS name to the Suize DISPLAY form: `<label>.suize.sui` →
 * `<label>@suize`; any other SuiNS name as-is. (Restated from apps/pay/src/suins.ts
 * parseHandle — an app, not importable here.) */
const toDisplayHandle = (name: string): string => {
  const v = name.trim().toLowerCase();
  return v.endsWith(".suize.sui") ? `${v.slice(0, -".suize.sui".length)}@suize` : v;
};

/** Reverse-resolve ONE address to its `@suize` handle (cached, resilient). */
export const resolveHandle = async (address: string): Promise<string | null> => {
  const key = address.toLowerCase();
  const hit = handleCache.get(key);
  if (hit && Date.now() - hit.at < HANDLE_TTL_MS) return hit.handle;
  let handle: string | null = null;
  try {
    const { data } = await suiClient().resolveNameServiceNames({ address: key, format: "dot" });
    const name = data?.[0]?.trim();
    handle = name ? toDisplayHandle(name) : null;
  } catch (e) {
    // Display-only sugar — a reverse-resolve outage must NEVER throw the whole feed.
    console.error("[directory/handle]", (e as Error).message);
    handle = null;
  }
  handleCache.set(key, { handle, at: Date.now() });
  return handle;
};

/** Resolve a SET of addresses to handles in parallel (deduped). Returns a map; a
 * failed leg is simply absent → the caller renders null. Never throws. */
export const resolveHandles = async (
  addresses: Iterable<string>,
): Promise<Map<string, string | null>> => {
  const unique = [...new Set([...addresses].map((a) => a.toLowerCase()))];
  const entries = await Promise.all(
    unique.map(async (a) => [a, await resolveHandle(a)] as const),
  );
  return new Map(entries);
};

// ── Owner-handle resolution — show the HUMAN behind an agent ──────────────────────
// An ad slot's `holder` is whoever PAID for it. When an AGENT claims the slot, that's
// its Suize SUB-ACCOUNT (a 1-of-2 threshold-1 zkLogin multisig { main, agent }), which
// has no SuiNS name of its own — so a plain reverse-resolve yields the bare hex and the
// card reads "Held by 0x0ab0…", a stranger. But the sub-account's committee (embedded in
// its own payment signature) names the human MAIN member, who DOES carry a `@suize`
// handle. So we recognize the sub-account and resolve the main member's handle — exactly
// like the Deploy dashboard's owner identity (apps/deploy/src/chain.ts:resolveOwnerIdentity).
// Fully chain-derived (the signature IS the link — no stored state); display-only,
// degrading to the address's own handle (then hex upstream) at every step.

const SUBACCT_TTL_MS = 30 * 60_000; // a sub-account's committee is immutable — cache long
const subacctCache = new Map<string, { committee: string[] | null; at: number }>();

/** The committee of a Suize agent sub-account — the EXACT shape `formAgentSubaccount`
 * mints: a 1-of-2, threshold-1 multisig of two zkLogin members (flag 5) whose derived
 * address == `address`. Null when `address` isn't one. Reads ONE tx it SENT (its
 * gasless payment / bid is multisig-signed, embedding the committee) and parses it.
 * Cached + resilient (any miss/outage → null, never throws). */
const subaccountCommittee = async (address: string): Promise<string[] | null> => {
  const key = address.toLowerCase();
  const hit = subacctCache.get(key);
  if (hit && Date.now() - hit.at < SUBACCT_TTL_MS) return hit.committee;
  let committee: string[] | null = null;
  try {
    const page = await suiClient().queryTransactionBlocks({
      filter: { FromAddress: key },
      options: { showInput: true },
      order: "descending",
      limit: 1,
    });
    for (const tx of page.data) {
      for (const sig of tx.transaction?.txSignatures ?? []) {
        const parsed = parseSerializedSignature(sig);
        if (parsed.signatureScheme !== "MultiSig") continue;
        const mpk = new MultiSigPublicKey(parsed.multisig.multisig_pk);
        const members = mpk.getPublicKeys();
        if (members.length !== 2 || mpk.getThreshold() !== 1) continue;
        if (!members.every((m) => m.publicKey.flag() === 5)) continue;
        if (mpk.toSuiAddress().toLowerCase() !== key) continue;
        committee = members.map((m) => m.publicKey.toSuiAddress());
        break;
      }
      if (committee) break;
    }
  } catch (e) {
    console.error("[directory/subaccount]", (e as Error).message);
    committee = null;
  }
  subacctCache.set(key, { committee, at: Date.now() });
  return committee;
};

/** An address's DISPLAY handle for an ownership cell ("Held by …"): its OWN `@suize`
 * handle, or — when it's a Suize agent sub-account — the handle of its MAIN (human)
 * member. Null when neither resolves (the caller falls back to the short hex). Never
 * throws (display sugar only). */
export const resolveOwnerHandle = async (address: string): Promise<string | null> => {
  const direct = await resolveHandle(address);
  if (direct) return direct;
  const committee = await subaccountCommittee(address);
  if (!committee) return null;
  const handles = await Promise.all(committee.map((a) => resolveHandle(a)));
  return handles.find((h) => h != null) ?? null;
};

// ── Business Profile resolution — address → its owned BusinessProfile (cached) ────
// A business mints ONE BusinessProfile by convention; we take the FIRST owned profile.
// Display-only: a miss / outage caches null so the directory never re-hammers the RPC and
// never throws into a render. The DIRECTORY uses name+image; the ADS use the full set.
export type ProfileView = {
  name: string;
  image: string;
  banner: string;
  description: string;
  website: string;
};

const PROFILE_TTL_MS = 5 * 60_000;
const profileCache = new Map<string, { profile: ProfileView | null; at: number }>();
const PROFILE_STRUCT = BUSINESS_PROFILE_TYPE(config.suiNetwork as SuiNetwork);

const fieldStr = (v: unknown): string => (typeof v === "string" ? v : "");

/** Resolve ONE address to its BusinessProfile view (cached, resilient). Null when the
 * address owns no profile, the type is unpublished (0x0), or the chain is unreadable. */
export const resolveProfile = async (address: string): Promise<ProfileView | null> => {
  if (PROFILE_STRUCT.startsWith("0x0::")) return null; // profile unpublished on this network
  const key = address.toLowerCase();
  const hit = profileCache.get(key);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.profile;
  let profile: ProfileView | null = null;
  try {
    const owned = await suiClient().getOwnedObjects({
      owner: key,
      filter: { StructType: PROFILE_STRUCT },
      options: { showContent: true },
      limit: 1,
    });
    const content = owned.data[0]?.data?.content;
    if (content && content.dataType === "moveObject") {
      const f = (content.fields ?? {}) as Record<string, unknown>;
      const name = fieldStr(f.name);
      if (name) {
        profile = {
          name,
          image: fieldStr(f.image_url),
          banner: fieldStr(f.banner_url),
          description: fieldStr(f.description),
          website: fieldStr(f.website),
        };
      }
    }
  } catch (e) {
    console.error("[directory/profile]", (e as Error).message);
    profile = null;
  }
  profileCache.set(key, { profile, at: Date.now() });
  return profile;
};

/** Resolve a SET of addresses to profiles in parallel (deduped). Never throws; a miss → null. */
export const resolveProfiles = async (
  addresses: Iterable<string>,
): Promise<Map<string, ProfileView | null>> => {
  const unique = [...new Set([...addresses].map((a) => a.toLowerCase()))];
  const entries = await Promise.all(unique.map(async (a) => [a, await resolveProfile(a)] as const));
  return new Map(entries);
};
