// siteForDomain must survive a stale/failing fullnode: a domain that is linked +
// PAID must not 404 just because ONE gRPC replica is stale (live incident: the
// mainnet fullnode served reads up to an hour stale for days, intermittently
// 404ing suize.io). The resolution ladder is: primary gRPC read → independent
// JSON-RPC fallback → last-known-good (Workers Cache). A TRUE miss (never linked)
// must still return null so an unlinked domain keeps 404ing.
//
// Drives the REAL `siteForDomain` with:
//   - `../src/chain` module-mocked (snapshot spread) so only `suiClient` (the gRPC
//     dynamic-field read) is steerable per test; every other export stays real.
//   - `globalThis.fetch` stubbed for the DomainRegistry table-UID GraphQL read AND
//     the JSON-RPC fallback (publicnode) read.
//   - an in-memory `caches.default` shim (the test env provides none) — proving the
//     production code also tolerates `caches` being absent (see the last case).
import { test, expect, afterEach, beforeEach, mock } from "bun:test";
import { bcs } from "@mysten/sui/bcs";
import type { Env } from "../src/env";

const DOMAIN = "suize.io";
const SITE_A = "0x" + "a1".repeat(32);
const SITE_B = "0x" + "b2".repeat(32);
const TABLE_UID = "0x" + "db".repeat(32);
const GRAPHQL_URL = "https://graphql.fallback.example/graphql";
const JSON_RPC_URL = "https://sui-rpc.publicnode.com";

// ── steered-by-test state the mocks read at CALL time ─────────────────────────
type GrpcResult = { kind: "value"; siteId: string } | { kind: "empty" } | { kind: "throw" };
type RpcResult = { kind: "value"; siteId: string } | { kind: "empty" };
let grpcResult: GrpcResult = { kind: "empty" };
let rpcResult: RpcResult = { kind: "empty" };
let rpcCalls = 0;

const fakeClient = {
  getDynamicField: async () => {
    if (grpcResult.kind === "throw") throw new Error("gRPC replica unavailable");
    if (grpcResult.kind === "value") {
      return { dynamicField: { value: { bcs: bcs.Address.serialize(grpcResult.siteId).toBytes() } } };
    }
    return { dynamicField: { value: { bcs: new Uint8Array(0) } } }; // empty → genuine miss
  },
};

import * as chainNS from "../src/chain";
const realChain = { ...chainNS };
mock.module("../src/chain", () => ({
  ...realChain,
  suiClient: () => fakeClient,
}));

const env = { SUI_GRAPHQL_URL: GRAPHQL_URL, SUI_NETWORK: "testnet" } as Env;

// ── in-memory Workers `caches.default` (retains stored Responses) ─────────────
class MemCache {
  store = new Map<string, Response>();
  async match(req: Request | string): Promise<Response | undefined> {
    const k = typeof req === "string" ? req : req.url;
    const r = this.store.get(k);
    return r ? r.clone() : undefined;
  }
  async put(req: Request | string, res: Response): Promise<void> {
    const k = typeof req === "string" ? req : req.url;
    this.store.set(k, res.clone());
  }
}
let mem: MemCache;

const realFetch = globalThis.fetch;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const realCaches = (globalThis as any).caches;

beforeEach(() => {
  mem = new MemCache();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).caches = { default: mem };
  grpcResult = { kind: "empty" };
  rpcResult = { kind: "empty" };
  rpcCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === GRAPHQL_URL) {
      return new Response(
        JSON.stringify({ data: { object: { asMoveObject: { contents: { json: { domains: { id: TABLE_UID } } } } } } }),
        { status: 200 },
      );
    }
    if (url === JSON_RPC_URL) {
      rpcCalls++;
      const result =
        rpcResult.kind === "value"
          ? { data: { content: { fields: { value: rpcResult.siteId } } } }
          : { data: null };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).caches = realCaches;
});

// The persisted last-known-good, read straight from the shim (siteId or undefined).
const persisted = async (domain: string): Promise<string | undefined> => {
  const hit = await mem.match(new Request(`https://suize-domain-cache.internal/${encodeURIComponent(domain)}`));
  return hit ? ((await hit.json()) as { siteId?: string }).siteId : undefined;
};

// ── (e) existing direct-hit path unchanged: gRPC resolves → return + persist ──
test("gRPC hit resolves the domain, no fallback, and persists last-known-good", async () => {
  const { siteForDomain } = await import("../src/domains");
  grpcResult = { kind: "value", siteId: SITE_A };

  const got = await siteForDomain(env, DOMAIN);
  expect(got).toBe(SITE_A);
  expect(rpcCalls).toBe(0); // primary hit → the JSON-RPC fallback was never touched
  expect(await persisted(DOMAIN)).toBe(SITE_A);
});

// ── (a) gRPC null + JSON-RPC returns the mapping → resolved + persisted ────────
test("gRPC empty falls back to JSON-RPC, resolves, and persists", async () => {
  const { siteForDomain } = await import("../src/domains");
  grpcResult = { kind: "empty" };
  rpcResult = { kind: "value", siteId: SITE_A };

  const got = await siteForDomain(env, DOMAIN);
  expect(got).toBe(SITE_A);
  expect(rpcCalls).toBe(1);
  expect(await persisted(DOMAIN)).toBe(SITE_A);
});

test("gRPC THROW falls back to JSON-RPC (a failing replica is not a miss)", async () => {
  const { siteForDomain } = await import("../src/domains");
  grpcResult = { kind: "throw" };
  rpcResult = { kind: "value", siteId: SITE_A };

  const got = await siteForDomain(env, DOMAIN);
  expect(got).toBe(SITE_A);
  expect(await persisted(DOMAIN)).toBe(SITE_A);
});

// ── (b) both null + persisted entry exists → serves the persisted mapping ─────
test("both live sources null but a prior mapping is persisted → serves stale (no 404)", async () => {
  const { siteForDomain } = await import("../src/domains");

  // First, a healthy resolution persists the mapping.
  grpcResult = { kind: "value", siteId: SITE_A };
  expect(await siteForDomain(env, DOMAIN)).toBe(SITE_A);

  // Now BOTH live sources go dark (stale/failing) — the domain is still paid.
  grpcResult = { kind: "throw" };
  rpcResult = { kind: "empty" };
  const got = await siteForDomain(env, DOMAIN);
  expect(got).toBe(SITE_A); // rescued by last-known-good, not a 404
});

// ── (c) both null + nothing persisted → null (a genuine unlinked domain 404s) ─
test("both live sources null with no persisted entry → null (true miss stays a miss)", async () => {
  const { siteForDomain } = await import("../src/domains");
  grpcResult = { kind: "empty" };
  rpcResult = { kind: "empty" };

  const got = await siteForDomain(env, "never-linked.example.com");
  expect(got).toBeNull();
  // A true miss must NOT be immortalised as last-known-good.
  expect(await persisted("never-linked.example.com")).toBeUndefined();
});

// ── (d) gRPC returns a NEW siteId after a persisted OLD one → new one wins ─────
test("a newer live siteId supersedes the persisted old one (no backward move)", async () => {
  const { siteForDomain } = await import("../src/domains");

  // Persist OLD.
  grpcResult = { kind: "value", siteId: SITE_A };
  expect(await siteForDomain(env, DOMAIN)).toBe(SITE_A);
  expect(await persisted(DOMAIN)).toBe(SITE_A);

  // A repoint makes the live read return NEW → returned AND re-persisted.
  grpcResult = { kind: "value", siteId: SITE_B };
  const got = await siteForDomain(env, DOMAIN);
  expect(got).toBe(SITE_B);
  expect(await persisted(DOMAIN)).toBe(SITE_B); // newest write wins
});

// ── production code tolerates NO Cache API (persistence skipped, never throws) ─
test("no caches global: still resolves live, just without last-known-good", async () => {
  const { siteForDomain } = await import("../src/domains");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).caches = undefined;

  grpcResult = { kind: "value", siteId: SITE_A };
  const got = await siteForDomain(env, DOMAIN);
  expect(got).toBe(SITE_A); // resolution unaffected by the missing Cache API

  // And with both live sources dark + no persistence, it degrades to null (no throw).
  grpcResult = { kind: "throw" };
  rpcResult = { kind: "empty" };
  expect(await siteForDomain(env, DOMAIN)).toBeNull();
});
