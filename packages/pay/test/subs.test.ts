// Unit tests — NO network. Sui JSON-RPC (sui_getObject / suix_queryEvents) is
// driven from recorded fixtures by stubbing globalThis.fetch on the method name.
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

// ─── JSON-RPC fixtures ─────────────────────────────────────────────────────────
const subObject = (over: Partial<{ paidUntil: number; merchant: string; type: string }> = {}) => ({
  data: {
    objectId: SUB_ID,
    type: over.type ?? SUBSCRIPTION_TYPE,
    content: {
      fields: {
        merchant: over.merchant ?? MERCHANT,
        amount: "500000",
        period_ms: "2592000000",
        paid_until_ms: String(over.paidUntil ?? FAR_FUTURE),
        ref: "0xdeadbeef",
      },
    },
  },
});

const createdEvent = (over: Partial<{ owner: string; merchant: string; ref: string; subId: string }> = {}) => ({
  id: { txDigest: "DIG_" + Math.random().toString(36).slice(2), eventSeq: "0" },
  type: `${PKG}::subscription::SubscriptionCreated`,
  parsedJson: {
    subscription_id: over.subId ?? SUB_ID,
    owner: over.owner ?? OWNER,
    merchant: over.merchant ?? MERCHANT,
    amount: "500000",
    period_ms: "2592000000",
    paid_until_ms: String(FAR_FUTURE),
    fee: "10000",
    ref: over.ref ?? "0xdeadbeef",
  },
  timestampMs: String(NOW),
});

// ─── fetch stub: route by the JSON-RPC `method` in the POST body ───────────────
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const stubRpc = (handlers: Record<string, (params: unknown[]) => unknown>) => {
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body ?? "{}")) as { method: string; params: unknown[] };
    const h = handlers[req.method];
    if (!h) throw new Error(`unstubbed rpc method: ${req.method}`);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: h(req.params) }), { status: 200 });
  }) as typeof fetch;
};

// ─────────────────────────────────────────────────────────────────────────────
describe("suizeSubs.isActive", () => {
  test("a paid-up subscription of THIS merchant → true", async () => {
    stubRpc({ sui_getObject: () => subObject({ paidUntil: FAR_FUTURE }) });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    expect(await subs.isActive(SUB_ID)).toBe(true);
  });

  test("an EXPIRED subscription → false", async () => {
    stubRpc({ sui_getObject: () => subObject({ paidUntil: PAST }) });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    expect(await subs.isActive(SUB_ID)).toBe(false);
  });

  test("graceMs keeps a just-expired sub active", async () => {
    stubRpc({ sui_getObject: () => subObject({ paidUntil: NOW - 1000 }) });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG, graceMs: 5000 });
    expect(await subs.isActive(SUB_ID)).toBe(true);
  });

  test("a STRANGER-merchant subscription is never honored", async () => {
    stubRpc({ sui_getObject: () => subObject({ merchant: STRANGER }) });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    expect(await subs.isActive(SUB_ID)).toBe(false);
  });

  test("the wrong object TYPE → false", async () => {
    stubRpc({ sui_getObject: () => subObject({ type: "0x2::coin::Coin<0x2::sui::SUI>" }) });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    expect(await subs.isActive(SUB_ID)).toBe(false);
  });

  test("a deleted / not-found object → false", async () => {
    stubRpc({ sui_getObject: () => ({ data: null, error: { code: "notExists" } }) });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    expect(await subs.isActive(SUB_ID)).toBe(false);
  });

  test("the 0x0 placeholder package FAILS CLOSED (no type can match)", async () => {
    stubRpc({ sui_getObject: () => subObject() });
    const subs = suizeSubs({ merchant: MERCHANT }); // default subsPackage = 0x0
    expect(await subs.isActive(SUB_ID)).toBe(false);
  });

  test("isActive caches within the TTL (one RPC read for two calls)", async () => {
    let hits = 0;
    stubRpc({
      sui_getObject: () => {
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
    stubRpc({
      suix_queryEvents: () => ({
        data: [
          createdEvent({ owner: OWNER, subId: SUB_ID }),
          createdEvent({ owner: STRANGER, subId: "0x" + "7".repeat(64) }),
        ],
        hasNextPage: false,
        nextCursor: null,
      }),
      sui_getObject: () => subObject({ paidUntil: FAR_FUTURE }),
    });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    const active = await subs.activeFor(OWNER);
    expect(active).toHaveLength(1);
    expect(active[0].subscriptionId).toBe(SUB_ID);
  });

  test("an expired object is dropped from activeFor", async () => {
    stubRpc({
      suix_queryEvents: () => ({ data: [createdEvent({ owner: OWNER })], hasNextPage: false, nextCursor: null }),
      sui_getObject: () => subObject({ paidUntil: PAST }),
    });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    expect(await subs.activeFor(OWNER)).toHaveLength(0);
  });
});

describe("suizeSubs.findByRef", () => {
  test("finds an active subscription by its on-chain ref", async () => {
    stubRpc({
      suix_queryEvents: () => ({
        data: [createdEvent({ ref: "0xcafe" }), createdEvent({ ref: "0xdeadbeef", subId: SUB_ID })],
        hasNextPage: false,
        nextCursor: null,
      }),
      sui_getObject: () => subObject({ paidUntil: FAR_FUTURE }),
    });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    const found = await subs.findByRef("0xdeadbeef");
    expect(found?.subscriptionId).toBe(SUB_ID);
  });

  test("no match → null", async () => {
    stubRpc({
      suix_queryEvents: () => ({ data: [createdEvent({ ref: "0xcafe" })], hasNextPage: false, nextCursor: null }),
      sui_getObject: () => subObject(),
    });
    const subs = suizeSubs({ merchant: MERCHANT, subsPackage: PKG });
    expect(await subs.findByRef("0xnotthere")).toBeNull();
  });
});

describe("suizeSubs.watch", () => {
  test("delivers new merchant events once, advances past seen, stops cleanly", async () => {
    const created = createdEvent({ owner: OWNER });
    stubRpc({
      suix_queryEvents: (params) => {
        const filter = (params[0] as { MoveEventType: string }).MoveEventType;
        // only the Created feed has an event; renewed/cancelled are empty
        if (filter.endsWith("SubscriptionCreated")) {
          return { data: [created], hasNextPage: false, nextCursor: null };
        }
        return { data: [], hasNextPage: false, nextCursor: null };
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
    stubRpc({
      suix_queryEvents: (params) => {
        const filter = (params[0] as { MoveEventType: string }).MoveEventType;
        if (filter.endsWith("SubscriptionCreated")) {
          return { data: [createdEvent({ owner: STRANGER, merchant: STRANGER })], hasNextPage: false, nextCursor: null };
        }
        return { data: [], hasNextPage: false, nextCursor: null };
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
