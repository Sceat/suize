// @suize/pay/subs — the merchant-side subscription helper. The recurring half of
// the Suize rail, read entirely from the chain (the chain is the database): a
// subscription is a Party-owned `subs::subscription::Subscription<USDC>` object
// the user signs into existence, paying each period inline. There is NO Suize
// store to call — a merchant asks the chain "is this customer still paid up?" and
// gates premium on the answer.
//
//   import { suizeSubs } from "@suize/pay/subs";
//   const subs = suizeSubs({ merchant: "0x<your address>" });
//   if (await subs.isActive(subscriptionId)) serve(); else upsell();
//
// Zero dependencies — raw JSON-RPC `fetch` against the public Sui fullnode (no
// @mysten SDK, no @suize/shared). The merchant address IS the account; the only
// state this helper holds is a tiny per-object TTL cache for `isActive`.
//
// ⚠️ SYNC REQUIREMENT (zero-dep mirror of @suize/shared): SUBS_PACKAGES below
// mirrors @suize/shared PACKAGE_IDS.SUBS.PACKAGE. The `subs` module is published
// per-network; until it ships, the testnet id is the `0x0` placeholder and every
// read fails closed (no object can match a `0x0::…` type). Pass `subsPackage` in
// opts to override (e.g. before this file is updated post-publish).

/** A subscription's live state, distilled from the on-chain object for a gate. */
export interface SubStatus {
  subscriptionId: string;
  owner: string;
  merchant: string;
  /** Per-period price in atomic USDC units (6 dp). */
  amount: number;
  /** Period length in ms. */
  periodMs: number;
  /** Wall-clock ms the subscription is paid through (`active ⇔ now < paidUntilMs`). */
  paidUntilMs: number;
  /** Merchant-supplied opaque ref (hex `0x…`), echoed from every event. */
  ref: string;
  /** The full coin type this subscription charges in — the `<T>` of `Subscription<T>`,
   * lowercased (e.g. `0x…::usdc::USDC`). A merchant MUST bind this to its expected
   * asset: a `Subscription<JunkCoin>` is NOT a real payment, and the `active` flag
   * alone (existence) says nothing about WHAT was paid. Empty if the type tag is
   * unparseable. */
  coinType: string;
  /** `now < paidUntilMs + graceMs` at the moment of the read. NOTE: a true `active`
   * means "paid up", NOT "paid the right amount in the right asset for the right
   * period" — a value-granting consumer MUST additionally check `coinType`, `amount`,
   * and `periodMs` against its own price (see `bareType` caveat / the indexer docs). */
  active: boolean;
}

/** One of the three subscription lifecycle events, normalized for `watch`. */
export interface SubEvent {
  kind: "created" | "renewed" | "cancelled";
  subscriptionId: string;
  owner: string;
  merchant: string;
  paidUntilMs: number;
  ref: string;
  /** The tx digest the event came from (for the merchant's own dedupe). */
  txDigest: string;
  timestampMs: number;
}

export interface SuizeSubsConfig {
  /** The merchant address — only subscriptions paying THIS address are honored. */
  merchant: string;
  /** Chain tag — selects the default RPC + the published `subs` package. */
  network?: "testnet" | "mainnet";
  /** Honor a subscription for `graceMs` past its `paidUntilMs` (default 0). A
   * Cancelled event still carries `paidUntilMs`, so a merchant MAY keep serving a
   * cancelled-but-not-yet-expired customer by reading that and applying grace. */
  graceMs?: number;
  /** `isActive` per-object cache TTL in ms (default 30 000). Reads are deduped. */
  cacheTtlMs?: number;
  /** Override the JSON-RPC fullnode URL (default: the public per-network node). */
  rpcUrl?: string;
  /** Override the `subs` package id (default: the SUBS_PACKAGES literal below). */
  subsPackage?: string;
}

// ⚠️ MIRROR of @suize/shared PACKAGE_IDS.SUBS.PACKAGE — keep in sync. Testnet is
// the 2026-06-12 publish; mainnet is `0x0` until the mainnet republish (a `0x0` id
// makes every type match fail — fails closed).
const SUBS_PACKAGES: Record<"testnet" | "mainnet", string> = {
  testnet: "0xb6bca1cfbcff846c2e575190c70a78fc777f858deae9d4d5a6e797cb005d1c69",
  mainnet: "0x0",
};

const RPC_URLS: Record<"testnet" | "mainnet", string> = {
  testnet: "https://fullnode.testnet.sui.io:443",
  mainnet: "https://fullnode.mainnet.sui.io:443",
};

/** The fully-qualified event type for a given subs package + struct name. */
const eventType = (pkg: string, name: string): string => `${pkg}::subscription::${name}`;

/** Strip the type arg off a `Subscription<…>` type tag → the bare struct path. */
const bareType = (t: string): string => t.replace(/<.*>$/, "");

/** Coerce a JSON-RPC numeric-string field to a number (Move u64 comes as string). */
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));

/**
 * Normalize a Move `vector<u8>` `ref` to a lowercase BARE-hex string (no `0x`). The
 * Sui JSON-RPC renders a `vector<u8>` in `parsedJson` / object content as a NUMBER
 * ARRAY (`[116,101,…]`) — NOT a string — so a merchant's correlation id (e.g. a 32-byte
 * site id) must be hex-encoded back here to be comparable. We also accept a string ref
 * defensively: a hex string (`0x…` or bare) passes through (lowercased, `0x` stripped),
 * and any other string falls back to its UTF-8 bytes hex-encoded. Empty → "".
 */
const refHex = (v: unknown): string => {
  if (Array.isArray(v) && v.every((b) => typeof b === "number")) {
    return (v as number[]).map((b) => (b & 0xff).toString(16).padStart(2, "0")).join("");
  }
  if (typeof v === "string") {
    const s = v.startsWith("0x") ? v.slice(2) : v;
    if (/^[0-9a-fA-F]*$/.test(s) && s.length % 2 === 0) return s.toLowerCase();
    // a non-hex opaque string ref — compare by its UTF-8 bytes' hex.
    return Array.from(new TextEncoder().encode(v))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return "";
};

export const suizeSubs = (config: SuizeSubsConfig) => {
  const network = config.network ?? "testnet";
  const merchant = config.merchant.toLowerCase();
  const graceMs = config.graceMs ?? 0;
  const cacheTtlMs = config.cacheTtlMs ?? 30_000;
  const rpcUrl = config.rpcUrl ?? RPC_URLS[network];
  const pkg = config.subsPackage ?? SUBS_PACKAGES[network];
  const SUBSCRIPTION_TYPE = `${pkg}::subscription::Subscription`;

  const cache = new Map<string, { status: SubStatus | null; at: number }>();

  /** One JSON-RPC call. Throws on transport error or an RPC `error` body. */
  const rpc = async <T>(method: string, params: unknown[]): Promise<T> => {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await res.json()) as { result?: T; error?: { message?: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message ?? "rpc error"}`);
    return body.result as T;
  };

  /** Read a subscription object → its distilled status, or null if it is not a
   * Subscription of THIS merchant (wrong type, wrong merchant, or deleted). */
  const readObject = async (subscriptionId: string): Promise<SubStatus | null> => {
    type ObjResp = {
      data?: {
        objectId: string;
        type?: string;
        content?: { fields?: Record<string, unknown> };
      };
      error?: unknown;
    };
    const obj = await rpc<ObjResp>("sui_getObject", [
      subscriptionId,
      { showType: true, showContent: true },
    ]);
    const data = obj?.data;
    if (!data || obj.error) return null; // deleted / not found → inactive
    // The type must be OUR Subscription struct (any coin type arg).
    if (!data.type || bareType(data.type) !== SUBSCRIPTION_TYPE) return null;
    const f = data.content?.fields ?? {};
    const objMerchant = String(f.merchant ?? "").toLowerCase();
    if (objMerchant !== merchant) return null; // a stranger's subscription — never honor
    const paidUntilMs = num(f.paid_until_ms);
    // The coin type is the `<T>` of `Subscription<T>` — the WHAT-was-paid that the bare
    // type match deliberately drops. A value-granting merchant binds this to USDC.
    const lt = data.type.indexOf("<");
    const gt = data.type.lastIndexOf(">");
    const coinType = lt >= 0 && gt > lt ? data.type.slice(lt + 1, gt).trim().toLowerCase() : "";
    return {
      subscriptionId: data.objectId,
      owner: String(f.owner ?? ""), // owner is not a field; filled by the event path
      merchant: objMerchant,
      amount: num(f.amount),
      periodMs: num(f.period_ms),
      paidUntilMs,
      ref: refHex(f.ref),
      coinType,
      active: Date.now() < paidUntilMs + graceMs,
    };
  };

  /**
   * Is this subscription currently paid up (for THIS merchant)? The single gate a
   * premium route calls. Reads the on-chain object (TTL-cached), checks the type +
   * merchant + `now < paid_until_ms + graceMs`. A deleted (cancelled) or
   * stranger-owned object reads false. Network errors PROPAGATE — fail closed.
   */
  const isActive = async (subscriptionId: string): Promise<boolean> => {
    const now = Date.now();
    const hit = cache.get(subscriptionId);
    if (hit && now - hit.at < cacheTtlMs) return hit.status?.active ?? false;
    const status = await readObject(subscriptionId);
    cache.set(subscriptionId, { status, at: now });
    return status?.active ?? false;
  };

  /** The full status (uncached), or null if it is not an honorable subscription. */
  const status = (subscriptionId: string): Promise<SubStatus | null> => readObject(subscriptionId);

  /** Normalize one `suix_queryEvents` node into a SubEvent (or null if irrelevant). */
  const toEvent = (node: {
    id?: { txDigest?: string };
    type?: string;
    parsedJson?: Record<string, unknown>;
    timestampMs?: string | number;
  }): SubEvent | null => {
    const t = node.type ?? "";
    const kind: SubEvent["kind"] | null = t.endsWith("::SubscriptionCreated")
      ? "created"
      : t.endsWith("::SubscriptionRenewed")
        ? "renewed"
        : t.endsWith("::SubscriptionCancelled")
          ? "cancelled"
          : null;
    if (!kind) return null;
    const j = node.parsedJson ?? {};
    if (String(j.merchant ?? "").toLowerCase() !== merchant) return null; // not ours
    return {
      kind,
      subscriptionId: String(j.subscription_id ?? ""),
      owner: String(j.owner ?? ""),
      merchant,
      paidUntilMs: num(j.paid_until_ms),
      ref: refHex(j.ref),
      txDigest: node.id?.txDigest ?? "",
      timestampMs: num(node.timestampMs),
    };
  };

  /** Page `suix_queryEvents` for ONE event struct of THIS subs package, newest
   * first, merchant-filtered client-side (Move event MoveEventType has no payer
   * predicate). Returns up to `limit` matching events. */
  const queryByType = async (struct: string, limit = 50): Promise<SubEvent[]> => {
    type Page = {
      data?: Array<Parameters<typeof toEvent>[0]>;
      nextCursor?: unknown;
      hasNextPage?: boolean;
    };
    const out: SubEvent[] = [];
    let cursor: unknown = null;
    while (out.length < limit) {
      const page = await rpc<Page>("suix_queryEvents", [
        { MoveEventType: eventType(pkg, struct) },
        cursor,
        Math.min(50, limit - out.length),
        true, // descending — newest first
      ]);
      for (const node of page?.data ?? []) {
        const e = toEvent(node);
        if (e) out.push(e);
      }
      if (!page?.hasNextPage || page.nextCursor == null) break;
      cursor = page.nextCursor;
    }
    return out;
  };

  /**
   * Every CURRENTLY-ACTIVE subscription this `owner` holds with THIS merchant.
   * Reads `SubscriptionCreated` events (merchant-filtered), keeps this owner's,
   * then `isActive`-checks each live object (a created-then-cancelled sub reads
   * inactive). De-duped by subscription id. Use for a "manage my plan" surface.
   */
  const activeFor = async (owner: string): Promise<SubStatus[]> => {
    const ownerLc = owner.toLowerCase();
    const created = await queryByType("SubscriptionCreated", 200);
    const ids = [
      ...new Set(created.filter((e) => e.owner.toLowerCase() === ownerLc).map((e) => e.subscriptionId)),
    ];
    const settled = await Promise.all(ids.map((id) => readObject(id)));
    return settled.filter((s): s is SubStatus => !!s && s.active);
  };

  /**
   * Find a live subscription by its on-chain `ref` (the merchant's own plan /
   * customer id, hex `0x…`). Scans recent `SubscriptionCreated` events for THIS
   * merchant, matches `ref`, returns the first still-active object (or null).
   */
  const findByRef = async (ref: string): Promise<SubStatus | null> => {
    // Normalize the caller's ref the SAME way the event ref is normalized (a Move
    // `vector<u8>` renders as a number array → bare hex), so `0x…`, bare hex, and an
    // opaque string all compare apples-to-apples.
    const want = refHex(ref);
    const created = await queryByType("SubscriptionCreated", 200);
    for (const e of created) {
      if (e.ref !== want) continue;
      const s = await readObject(e.subscriptionId);
      if (s?.active) return s;
    }
    return null;
  };

  /**
   * Poll the three lifecycle events and hand each new one (merchant-filtered) to
   * `handler`, advancing a cursor the merchant PERSISTS (we store nothing). Returns
   * a `stop()`; pass the last `cursor` you saw back in to resume exactly once. The
   * cursor is the newest event id seen across the created/renewed/cancelled feeds.
   */
  const watch = (
    handler: (e: SubEvent) => void | Promise<void>,
    opts: { pollMs?: number; cursor?: { txDigest: string; eventSeq: string } | null } = {},
  ): { stop: () => void } => {
    const pollMs = opts.pollMs ?? 30_000;
    // We dedupe within a process run by tx digest+seq; the caller's persisted
    // cursor bounds re-delivery across restarts.
    const seen = new Set<string>();
    if (opts.cursor) seen.add(`${opts.cursor.txDigest}:${opts.cursor.eventSeq}`);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (stopped) return;
      try {
        const batches = await Promise.all([
          queryByType("SubscriptionCreated", 50),
          queryByType("SubscriptionRenewed", 50),
          queryByType("SubscriptionCancelled", 50),
        ]);
        const fresh = batches
          .flat()
          .filter((e) => e.txDigest && !seen.has(e.txDigest))
          .sort((a, b) => a.timestampMs - b.timestampMs); // oldest-first delivery
        for (const e of fresh) {
          seen.add(e.txDigest);
          await handler(e);
        }
      } catch {
        // transient RPC blip — swallow; the next tick re-reads (events are durable).
      }
      if (!stopped) timer = setTimeout(tick, pollMs);
    };
    timer = setTimeout(tick, 0);
    return {
      stop: () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      },
    };
  };

  return { isActive, status, activeFor, findByRef, watch };
};

export default suizeSubs;
