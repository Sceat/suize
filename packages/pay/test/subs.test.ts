// Unit tests — NO network. Sui GraphQL RPC (the `object` + `events` queries) is
// driven from recorded fixtures by stubbing globalThis.fetch on the query shape.
import { afterEach, describe, expect, test } from "bun:test";
import { suizeSubs } from "../src/subs";

const PKG = "0x" + "9".repeat(64); // a fake-but-shaped published subs package
const MERCHANT = "0x" + "1".repeat(64);
const OWNER = "0x" + "a".repeat(64);
const STRANGER = "0x" + "b".repeat(64);
const SUB_ID = "0x" + "5".repeat(64);
const USDC = "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";
const SUBSCRIPTION_TYPE = `${PKG}::subscription::Subscription<${USDC}>`;

const NOW = Date.now();
const FAR_FUTURE = NOW + 30 * 24 * 3600 * 1000;
const PAST = NOW - 60_000;

// Sui GraphQL renders a Move `vector<u8>` in `MoveValue.json` as a BASE64 string —
// model that faithfully so the ref-normalization path is exercised as in production.
const b64 = (hex: string): string => Buffer.from(hex.replace(/^0x/, ""), "hex").toString("base64");

// ─── GraphQL fixtures ──────────────────────────────────────────────────────────
// A `{ object }` query result: `object.asMoveObject.contents.{ type.repr, json }`.
const subObject = (over: Partial<{ paidUntil: number; merchant: string; type: string }> = {}) => ({
  object: {
    address: SUB_ID,
    asMoveObject: {
      contents: {
        type: { repr: over.type ?? SUBSCRIPTION_TYPE },
        json: {
          merchant: over.merchant ?? MERCHANT,
          amount: "500000",
          period_ms: "2592000000",
          paid_until_ms: String(over.paidUntil ?? FAR_FUTURE),
          ref: b64("deadbeef"),
        },
      },
    },
  },
});

// One `events` connection node: `{ transaction.digest, timestamp, contents.json }`.
const createdEventNode = (
  over: Partial<{ owner: string; merchant: string; ref: string; subId: string }> = {},
) => ({
  transaction: { digest: "DIG_" + Math.random().toString(36).slice(2) },
  timestamp: new Date(NOW).toISOString(),
  contents: {
    json: {
      subscription_id: over.subId ?? SUB_ID,
      owner: over.owner ?? OWNER,
      merchant: over.merchant ?? MERCHANT,
      amount: "500000",
      period_ms: "2592000000",
      paid_until_ms: String(FAR_FUTURE),
      fee: "10000",
      ref: b64(over.ref ?? "deadbeef"),
    },
  },
});

// A one-page `events` connection (no older pages) wrapping the given nodes.
const eventsPage = (nodes: unknown[]) => ({
  events: { pageInfo: { hasPreviousPage: false, startCursor: null }, nodes },
});

// ─── fetch stub: route by the GraphQL query shape (object vs events) ────────────
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const stubGraphql = (handlers: {
  object?: (vars: Record<string, unknown>) => unknown;
  events?: (vars: Record<string, unknown>) => unknown;
}) => {
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body ?? "{}")) as {
      query: string;
      variables: Record<string, unknown>;
    };
    let data: unknown;
    if (query.includes("object(address:")) {
      if (!handlers.object) throw new Error("unstubbed object query");
      data = handlers.object(variables);
    } else if (query.includes("events(filter:")) {
      if (!handlers.events) throw new Error("unstubbed events query");
      data = handlers.events(variables);
    } else {
      throw new Error(`unstubbed graphql query: ${query.slice(0, 40)}`);
    }
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as typeof fetch;
};

// ─────────────────────────────────────────────────────────────────────────────
describe("suizeSubs.isActive", () => {
  test("a paid-up subscription of THIS merchant → true", async () => {
    stubGraphql({ object: () => subObject({ paidUntil: FAR_FUTURE }) });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    expect(await subs.isActive(SUB_ID)).toBe(true);
  });

  test("an EXPIRED subscription → false", async () => {
    stubGraphql({ object: () => subObject({ paidUntil: PAST }) });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    expect(await subs.isActive(SUB_ID)).toBe(false);
  });

  test("graceMs keeps a just-expired sub active", async () => {
    stubGraphql({ object: () => subObject({ paidUntil: NOW - 1000 }) });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG, graceMs: 5000 });
    expect(await subs.isActive(SUB_ID)).toBe(true);
  });

  test("a STRANGER-merchant subscription is never honored", async () => {
    stubGraphql({ object: () => subObject({ merchant: STRANGER }) });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    expect(await subs.isActive(SUB_ID)).toBe(false);
  });

  test("the wrong object TYPE → false", async () => {
    stubGraphql({ object: () => subObject({ type: "0x2::coin::Coin<0x2::sui::SUI>" }) });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    expect(await subs.isActive(SUB_ID)).toBe(false);
  });

  test("a deleted / not-found object → false", async () => {
    stubGraphql({ object: () => ({ object: null }) });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    expect(await subs.isActive(SUB_ID)).toBe(false);
  });

  test("the 0x0 placeholder package FAILS CLOSED (no type can match)", async () => {
    stubGraphql({ object: () => subObject() });
    const subs = suizeSubs({ merchant: MERCHANT }); // default subsPackage = 0x0
    expect(await subs.isActive(SUB_ID)).toBe(false);
  });

  test("isActive caches within the TTL (one read for two calls)", async () => {
    let hits = 0;
    stubGraphql({
      object: () => {
        hits++;
        return subObject({ paidUntil: FAR_FUTURE });
      },
    });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG, cacheTtlMs: 60_000 });
    await subs.isActive(SUB_ID);
    await subs.isActive(SUB_ID);
    expect(hits).toBe(1);
  });
});

describe("suizeSubs.activeFor", () => {
  test("returns this owner's active subscriptions, filters out a stranger's", async () => {
    stubGraphql({
      events: () =>
        eventsPage([
          createdEventNode({ owner: OWNER, subId: SUB_ID }),
          createdEventNode({ owner: STRANGER, subId: "0x" + "7".repeat(64) }),
        ]),
      object: () => subObject({ paidUntil: FAR_FUTURE }),
    });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    const active = await subs.activeFor(OWNER);
    expect(active).toHaveLength(1);
    expect(active[0].subscriptionId).toBe(SUB_ID);
  });

  test("an expired object is dropped from activeFor", async () => {
    stubGraphql({
      events: () => eventsPage([createdEventNode({ owner: OWNER })]),
      object: () => subObject({ paidUntil: PAST }),
    });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    expect(await subs.activeFor(OWNER)).toHaveLength(0);
  });
});

describe("suizeSubs.findByRef", () => {
  test("finds an active subscription by its on-chain ref", async () => {
    stubGraphql({
      events: () =>
        eventsPage([
          createdEventNode({ ref: "cafe" }),
          createdEventNode({ ref: "deadbeef", subId: SUB_ID }),
        ]),
      object: () => subObject({ paidUntil: FAR_FUTURE }),
    });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    const found = await subs.findByRef("0xdeadbeef");
    expect(found?.subscriptionId).toBe(SUB_ID);
  });

  test("no match → null", async () => {
    stubGraphql({
      events: () => eventsPage([createdEventNode({ ref: "cafe" })]),
      object: () => subObject(),
    });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    expect(await subs.findByRef("0xabcdef")).toBeNull();
  });
});

describe("suizeSubs.watch", () => {
  test("delivers new merchant events once, advances past seen, stops cleanly", async () => {
    const created = createdEventNode({ owner: OWNER });
    stubGraphql({
      events: (vars) => {
        // only the Created feed has an event; renewed/cancelled are empty
        return String(vars.type).endsWith("SubscriptionCreated")
          ? eventsPage([created])
          : eventsPage([]);
      },
    });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    const seen: string[] = [];
    const handle = subs.watch((e) => void seen.push(e.kind), { pollMs: 10_000 });
    // let the immediate first tick run
    await new Promise((r) => setTimeout(r, 20));
    handle.stop();
    expect(seen).toEqual(["created"]);
  });

  test("a stranger's event is filtered out", async () => {
    stubGraphql({
      events: (vars) => {
        return String(vars.type).endsWith("SubscriptionCreated")
          ? eventsPage([createdEventNode({ owner: STRANGER, merchant: STRANGER })])
          : eventsPage([]);
      },
    });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    const seen: string[] = [];
    const handle = subs.watch((e) => void seen.push(e.kind), { pollMs: 10_000 });
    await new Promise((r) => setTimeout(r, 20));
    handle.stop();
    expect(seen).toHaveLength(0);
  });
});
