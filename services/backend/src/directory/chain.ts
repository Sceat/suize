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
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { SuiGraphQLClient } from "@mysten/sui/graphql";
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
import { grpcClient, graphqlClient, reverseName, treasuryResolver } from "../sui";

// ── ONE gRPC client for object/owned/name reads (same construction as the other
// modules) + ONE GraphQL client for the indexer-shaped transaction-by-address scan
// the feed/rankings need (gRPC core has no queryTransactionBlocks). The old per-RPC
// JSON-RPC fallback (some providers dropped the `ToAddress` filter) is gone — the
// GraphQL indexer is the single, filter-complete source. ─────────────────────────
let _client: SuiGrpcClient | null = null;
export const suiClient = (): SuiGrpcClient => (_client ??= grpcClient());

let _gql: SuiGraphQLClient | null = null;
const gqlClient = (): SuiGraphQLClient => (_gql ??= graphqlClient());

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
    const addr = await resolveTreasury(treasuryResolver(suiClient()));
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
 * spends / non-USDC are skipped) up to `maxScan` to fill the page. Runs over the
 * GraphQL indexer (gRPC core has no transaction-by-address query): ONE
 * `transactions(filter:{affectedAddress})` page (~50 txs) per round, newest-first,
 * with balance changes returned INLINE (the indexer retains effects the fullnode
 * prunes — so no per-tx re-fetch). Throws on a GraphQL outage (the caller 502s);
 * returns [] only when the chain genuinely has none.
 */
export const readPayments = async (
  treasury: string,
  want: number,
  maxScan = 400,
): Promise<DirectoryPayment[]> => scanPaymentsGql(treasury, want, maxScan);

// A global wall-clock deadline so a deep/near-empty history can never blow past the
// ingress timeout (→ a 504): return what we have so far.
const SCAN_DEADLINE_MS = 8_000;

// The indexer transaction scan. `affectedAddress: treasury` captures every tx whose
// treasury balance changed (the fee-leg recipient) — a superset of the qualifying
// payments (parsePayment discards treasury-spends / non-USDC). GraphQL returns the
// `last: N` window oldest→newest, so we reverse each page for newest-first; `before`
// pages further back. Balance changes ride inline (amount signed, coinType repr,
// owner address) — adapted to parsePayment's `BalanceChange` shape.
const TX_BY_AFFECTED = `query($addr: SuiAddress!, $before: String) {
  transactions(last: 50, before: $before, filter: { affectedAddress: $addr }) {
    pageInfo { hasPreviousPage startCursor }
    nodes {
      digest
      effects { timestamp balanceChanges { nodes { amount coinType { repr } owner { address } } } }
    }
  }
}`;

// The newest tx a given address SENT, with its signatures (base64) — for the
// sub-account committee read (see subaccountCommittee).
const TX_BY_SENT = `query($addr: SuiAddress!) {
  transactions(last: 1, filter: { sentAddress: $addr }) {
    nodes { signatures { signatureBytes } }
  }
}`;

type GqlTxNode = {
  digest: string;
  effects?: {
    timestamp?: string | null;
    balanceChanges?: {
      nodes?: { amount?: string | null; coinType?: { repr?: string | null } | null; owner?: { address?: string | null } | null }[];
    } | null;
  } | null;
};

const scanPaymentsGql = async (
  treasury: string,
  want: number,
  maxScan: number,
): Promise<DirectoryPayment[]> => {
  const gql = gqlClient();
  const out: DirectoryPayment[] = [];
  const deadline = Date.now() + SCAN_DEADLINE_MS;
  let before: string | null = null;
  let scanned = 0;

  while (out.length < want && scanned < maxScan && Date.now() < deadline) {
    const res = (await gql.query({
      query: TX_BY_AFFECTED as never,
      variables: { addr: treasury, before },
    })) as {
      errors?: { message: string }[];
      data?: {
        transactions?: {
          pageInfo?: { hasPreviousPage?: boolean; startCursor?: string | null };
          nodes?: GqlTxNode[];
        } | null;
      };
    };
    if (res.errors?.length) throw new Error(`graphql tx scan: ${res.errors[0].message}`);
    const conn = res.data?.transactions;
    const nodes = (conn?.nodes ?? []).slice().reverse(); // newest-first

    for (const n of nodes) {
      scanned++;
      // Adapt GraphQL legs → the JSON-RPC BalanceChange shape parsePayment expects.
      // A leg with no address owner (object/shared) maps to "Immutable" so it counts
      // toward gross but is never picked as payer/merchant/treasury.
      const changes: BalanceChange[] = (n.effects?.balanceChanges?.nodes ?? []).map((bc) => ({
        amount: bc.amount ?? "0",
        coinType: bc.coinType?.repr ?? "",
        owner: bc.owner?.address ? { AddressOwner: bc.owner.address } : "Immutable",
      }));
      const tsMs = n.effects?.timestamp ? String(Date.parse(n.effects.timestamp)) : null;
      try {
        const p = parsePayment(n.digest, tsMs, changes, treasury);
        if (p) out.push(p);
      } catch (e) {
        console.error(`[directory/parse] ${n.digest}:`, (e as Error).message);
      }
      if (out.length >= want) break;
    }

    if (!conn?.pageInfo?.hasPreviousPage || !conn?.pageInfo?.startCursor) break;
    before = conn.pageInfo.startCursor;
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
    // gRPC reverse resolution → the address's DEFAULT SuiNS name (dotted), or null.
    const name = (await reverseName(suiClient(), key))?.trim();
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
    // Indexer read (gRPC core has no by-sender tx query): the newest tx this address
    // SENT, with its signatures (base64) — the multisig-signed gasless payment/bid
    // embeds the committee.
    const res = (await gqlClient().query({
      query: TX_BY_SENT as never,
      variables: { addr: key },
    })) as { data?: { transactions?: { nodes?: { signatures?: { signatureBytes?: string | null }[] }[] } } };
    const nodes = res.data?.transactions?.nodes ?? [];
    for (const tx of nodes) {
      for (const sig of tx.signatures ?? []) {
        if (!sig.signatureBytes) continue;
        const parsed = parseSerializedSignature(sig.signatureBytes);
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
    // gRPC owned-objects (type-filtered); `.json` is the Move struct's fields.
    const owned = await suiClient().listOwnedObjects({
      owner: key,
      type: PROFILE_STRUCT,
      include: { json: true },
      limit: 1,
    });
    const f = owned.objects[0]?.json as Record<string, unknown> | null | undefined;
    if (f) {
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
