// F1 (HIGH) — the paid hosting gate is enforced on the SERVE path. A site whose
// on-chain `paid_until_ms` is in the past (beyond a small clock-skew grace) must
// stop serving (410 Gone) BEFORE any blob bytes stream; a site paid through the
// future serves normally (200). And the Site-fields edge-cache entry — which now
// carries the MUTABLE `paid_until_ms` — must use a SHORT ttl (not the 1-year
// immutable tier), so a paid /extend un-lapses a site within the minute.
//
// Drives the REAL worker.fetch with an in-memory `caches` polyfill (retaining the
// stored Responses so the ttl a `put` chose is inspectable) and a fetch stub for
// the GraphQL Site read + the Walrus aggregator manifest/blob reads.
import { test, expect, afterEach, beforeEach } from "bun:test";
import { packageIds, resolveNetwork } from "@suize/shared";
import { encodeObjectIdToBase36, decodeBase36ToObjectId, sha256Hex } from "../src/util";
import type { Env } from "../src/env";

const SITE_ID = "0x" + "cc".repeat(32);
const SUB = encodeObjectIdToBase36(SITE_ID);
const HOST = `${SUB}.suize.site`;
const DECODED = decodeBase36ToObjectId(SUB); // what the worker keys the cache by
const SITE_CACHE_KEY = `https://suize-deploy-cache/site/${DECODED}`;
const PKG = packageIds(resolveNetwork("testnet")).DEPLOY.PACKAGE;
const AGG = "https://agg.example";
const GRAPHQL = "https://graphql.example/graphql";

const env = { SUI_GRAPHQL_URL: GRAPHQL, WALRUS_AGGREGATOR: AGG, SUI_NETWORK: "testnet" } as Env;

// In-memory Workers `caches.default`; retains stored Responses so a test can read
// the Cache-Control ttl a `put` used.
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
});
afterEach(() => {
  globalThis.fetch = realFetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).caches = realCaches;
});

const ctx = { waitUntil: (_p: Promise<unknown>) => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

const graphqlSite = (paidUntilMs: number, manifestHash: string) => ({
  data: {
    object: {
      asMoveObject: {
        contents: {
          type: { repr: `${PKG}::site::Site` },
          json: {
            quilt_id: "quilt1",
            manifest_blob_id: "manifest1",
            manifest_hash: manifestHash, // hex — accepted by manifestHashToHex
            paid_until_ms: String(paidUntilMs), // u64 → GraphQL renders a decimal STRING
          },
        },
      },
    },
  },
});

const importWorker = async () =>
  (await import("../src/index")).default as {
    fetch: (r: Request, e: Env, c: ExecutionContext) => Promise<Response>;
  };

test("a LAPSED site (paid_until_ms in the past) returns 410 Gone before any blob fetch", async () => {
  let aggCalled = false;
  const past = Date.now() - 10 * 60_000; // 10 min ago — beyond the 5-min grace
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("graphql")) return new Response(JSON.stringify(graphqlSite(past, "00")), { status: 200 });
    if (url.includes(AGG)) {
      aggCalled = true; // MUST NOT happen — the gate precedes any Walrus read
      return new Response(new Uint8Array(), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;

  const worker = await importWorker();
  const res = await worker.fetch(new Request(`https://${HOST}/`), env, ctx);

  expect(res.status).toBe(410);
  expect(await res.text()).toContain("lapsed");
  expect(aggCalled).toBe(false); // no bytes streamed for a lapsed site

  // The Site-fields cache entry carries the mutable field → SHORT ttl (60s),
  // never the 1-year immutable tier (else an extend can't un-lapse for a year).
  const cached = mem.store.get(SITE_CACHE_KEY);
  expect(cached).toBeDefined();
  expect(cached!.headers.get("Cache-Control")).toBe("max-age=60");
});

test("a PAID site (paid_until_ms in the future) serves its bytes with 200", async () => {
  const fileBytes = new TextEncoder().encode("<h1>ok</h1>");
  const fileSha = await sha256Hex(fileBytes);
  const manifest = {
    v: 1,
    spaFallback: "/index.html",
    files: { "/index.html": { patch: "patchX", sha256: fileSha, ct: "text/html", size: fileBytes.length } },
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const manifestHash = await sha256Hex(manifestBytes);
  const future = Date.now() + 60 * 60_000; // paid an hour out

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("graphql"))
      return new Response(JSON.stringify(graphqlSite(future, manifestHash)), { status: 200 });
    if (url.includes("by-quilt-patch-id")) return new Response(fileBytes, { status: 200 });
    if (url.includes(AGG)) return new Response(manifestBytes, { status: 200 }); // the manifest blob
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;

  const worker = await importWorker();
  const res = await worker.fetch(new Request(`https://${HOST}/`), env, ctx);

  expect(res.status).toBe(200);
  expect(await res.text()).toBe("<h1>ok</h1>");
});
