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
// Zero dependencies — raw GraphQL `fetch` against the public Sui GraphQL RPC (no
// @mysten SDK, no @suize/shared). Mysten retired the public JSON-RPC fullnode, and
// the node's gRPC replacement exposes no event-query surface this merchant helper
// needs, so the reads run over Sui's GraphQL RPC — still one plain `fetch` of JSON,
// still zero deps. The merchant address IS the account; the only state this helper
// holds is a tiny per-object TTL cache for `isActive`.
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
  /** Override the Sui GraphQL RPC endpoint URL (default: the public per-network
   * `https://graphql.<network>.sui.io/graphql`). */
  rpcUrl?: string;
  /** Override the `subs` package id (default: the SUBS_PACKAGES literal below). */
  subsPackage?: string;
}

// ⚠️ MIRROR of @suize/shared PACKAGE_IDS.SUBS.PACKAGE — keep in sync. Testnet is
// the 2026-06-15 version-gated republish; mainnet is `0x0` until the mainnet republish
// (a `0x0` id makes every type match fail — fails closed). Read-only here (event/type
// filters), so no `Version` arg — only the package id moves.
const SUBS_PACKAGES: Record<"testnet" | "mainnet", string> = {
  testnet: "0x759105b5f7382cb22533e8a5282e90c92c558edb1bc2eaa0904247914082d821",
  mainnet: "0x0",
};

// The public Sui GraphQL RPC endpoint per network (JSON over HTTP POST — the
// zero-dep read transport now that the public JSON-RPC fullnode is retired).
const GRAPHQL_URLS: Record<"testnet" | "mainnet", string> = {
  testnet: "https://graphql.testnet.sui.io/graphql",
  mainnet: "https://graphql.mainnet.sui.io/graphql",
};

/** The fully-qualified event type for a given subs package + struct name. */
const eventType = (pkg: string, name: string): string => `${pkg}::subscription::${name}`;

/** Strip the type arg off a `Subscription<…>` type tag → the bare struct path. */
const bareType = (t: string): string => t.replace(/<.*>$/, "");

/** Coerce a Move u64 field to a number (GraphQL renders u64 as a decimal string). */
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));

/**
 * Normalize a Move `vector<u8>` `ref` to a lowercase BARE-hex string (no `0x`), so a
 * merchant's correlation id (e.g. a 32-byte site id) is comparable however it arrives.
 * Sui GraphQL renders a `vector<u8>` in `MoveValue.json` as a BASE64 string, so that
 * is the primary case; we also accept, in order: a `0x…`/bare-hex string (a caller's
 * own ref in `findByRef`), a number array (defensive), a base64 string (the GraphQL
 * rendering), else the UTF-8 bytes of an opaque string. Empty → "". Both the on-chain
 * ref and the caller's ref pass through this, so they compare apples-to-apples.
 */
const bytesToHex = (bytes: Iterable<number>): string =>
  Array.from(bytes, (b) => (b & 0xff).toString(16).padStart(2, "0")).join("");

const refHex = (v: unknown): string => {
  if (Array.isArray(v) && v.every((b) => typeof b === "number")) return bytesToHex(v as number[]);
  if (typeof v === "string") {
    if (v === "") return "";
    // A pure-hex, even-length string is a caller-supplied hex ref (`0x…` or bare).
    const body = v.startsWith("0x") ? v.slice(2) : v;
    if (/^[0-9a-fA-F]+$/.test(body) && body.length % 2 === 0) return body.toLowerCase();
    // Otherwise it is the GraphQL base64 rendering of the bytes — decode → hex.
    try {
      const bin = atob(v);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
      return bytesToHex(bytes);
    } catch {
      // not base64 either — an opaque string ref; compare by its UTF-8 bytes' hex.
      return bytesToHex(new TextEncoder().encode(v));
    }
  }
  return "";
};

export const suizeSubs = (config: SuizeSubsConfig) => {
  const network = config.network ?? "testnet";
  const merchant = config.merchant.toLowerCase();
  const graceMs = config.graceMs ?? 0;
  const cacheTtlMs = config.cacheTtlMs ?? 30_000;
  const graphqlUrl = config.rpcUrl ?? GRAPHQL_URLS[network];
  const pkg = config.subsPackage ?? SUBS_PACKAGES[network];
  const SUBSCRIPTION_TYPE = `${pkg}::subscription::Subscription`;

  const cache = new Map<string, { status: SubStatus | null; at: number }>();

  /** One GraphQL query. Throws on transport error or a GraphQL `errors` body — every
   * read here is a gate, so a failed read PROPAGATES (fail closed). */
  const gql = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    const res = await fetch(graphqlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
    if (body.errors?.length) throw new Error(`graphql: ${body.errors[0]?.message ?? "query error"}`);
    return body.data as T;
  };

  // GraphQL: the object's Move struct type (`contents.type.repr` — the full type incl.
  // its `<coinType>`) plus its fields (`contents.json`). A missing / deleted / non-Move
  // object resolves `object` or `asMoveObject` to null → inactive.
  const OBJECT_QUERY = `query($id: SuiAddress!) {
    object(address: $id) { address asMoveObject { contents { type { repr } json } } }
  }`;

  /** Read a subscription object → its distilled status, or null if it is not a
   * Subscription of THIS merchant (wrong type, wrong merchant, or deleted). */
  const readObject = async (subscriptionId: string): Promise<SubStatus | null> => {
    type ObjResp = {
      object: {
        address: string;
        asMoveObject: {
          contents: { type: { repr: string }; json: Record<string, unknown> } | null;
        } | null;
      } | null;
    };
    const data = await gql<ObjResp>(OBJECT_QUERY, { id: subscriptionId });
    const obj = data.object;
    const contents = obj?.asMoveObject?.contents;
    if (!obj || !contents) return null; // deleted / not found / not a Move object → inactive
    // The type must be OUR Subscription struct (any coin type arg).
    const type = contents.type?.repr ?? "";
    if (bareType(type) !== SUBSCRIPTION_TYPE) return null;
    const f = contents.json ?? {};
    const objMerchant = String(f.merchant ?? "").toLowerCase();
    if (objMerchant !== merchant) return null; // a stranger's subscription — never honor
    const paidUntilMs = num(f.paid_until_ms);
    // The coin type is the `<T>` of `Subscription<T>` — the WHAT-was-paid that the bare
    // type match deliberately drops. A value-granting merchant binds this to USDC.
    const lt = type.indexOf("<");
    const gt = type.lastIndexOf(">");
    const coinType = lt >= 0 && gt > lt ? type.slice(lt + 1, gt).trim().toLowerCase() : "";
    return {
      subscriptionId: obj.address,
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

  const EVENTS_QUERY = `query($type: String!, $last: Int!, $before: String) {
    events(filter: { type: $type }, last: $last, before: $before) {
      pageInfo { hasPreviousPage startCursor }
      nodes { transaction { digest } timestamp contents { json } }
    }
  }`;

  type EventNode = {
    transaction: { digest: string } | null;
    timestamp: string | null;
    contents: { json: Record<string, unknown> } | null;
  };

  const EVENT_KIND: Record<string, SubEvent["kind"]> = {
    SubscriptionCreated: "created",
    SubscriptionRenewed: "renewed",
    SubscriptionCancelled: "cancelled",
  };

  /** Normalize one GraphQL event node (of a KNOWN kind — we query one struct at a
   * time) into a SubEvent, or null when it is not THIS merchant's (a Move event type
   * filter carries no payer predicate, so merchant is matched client-side). */
  const toEvent = (kind: SubEvent["kind"], node: EventNode): SubEvent | null => {
    const j = node.contents?.json ?? {};
    if (String(j.merchant ?? "").toLowerCase() !== merchant) return null; // not ours
    return {
      kind,
      subscriptionId: String(j.subscription_id ?? ""),
      owner: String(j.owner ?? ""),
      merchant,
      paidUntilMs: num(j.paid_until_ms),
      ref: refHex(j.ref),
      txDigest: node.transaction?.digest ?? "",
      timestampMs: node.timestamp ? Date.parse(node.timestamp) : 0,
    };
  };

  /** Page ONE event struct of THIS subs package, newest first, merchant-filtered
   * client-side. GraphQL connections page oldest→newest, so we pull the newest slice
   * with `last`/`before` and reverse each page. Returns up to `limit` matching events. */
  const queryByType = async (struct: keyof typeof EVENT_KIND, limit = 50): Promise<SubEvent[]> => {
    type Page = {
      events: {
        pageInfo: { hasPreviousPage: boolean; startCursor: string | null };
        nodes: EventNode[];
      };
    };
    const kind = EVENT_KIND[struct];
    const type = eventType(pkg, struct);
    const out: SubEvent[] = [];
    let before: string | null = null;
    while (out.length < limit) {
      const page: Page = await gql<Page>(EVENTS_QUERY, {
        type,
        last: Math.min(50, limit - out.length),
        before,
      });
      const conn = page.events;
      // A page arrives oldest→newest; reverse it so delivery stays newest-first.
      for (const node of [...(conn?.nodes ?? [])].reverse()) {
        const e = toEvent(kind, node);
        if (e) out.push(e);
      }
      if (!conn?.pageInfo?.hasPreviousPage || !conn.pageInfo.startCursor) break;
      before = conn.pageInfo.startCursor;
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
