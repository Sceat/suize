// The DNS routing check (probeDns → cnameRoutesToUs). The bug this covers:
// a zone-APEX domain cannot hold a CNAME, so providers flatten it to synthesized
// A records; when the target is itself Cloudflare-proxied (our *.suize.site
// wildcard is), the flattened answer is only edge A records with NO type-5 chain,
// so the direct-CNAME and chain paths both miss and verify was stuck forever.
// The third path accepts a non-empty IP overlap between domain and target.
// All offline: global fetch is a DoH-route-shaped stub per test (the real
// Cloudflare resolver is never called).
import { test, expect, afterEach } from "bun:test";
import { probeDns } from "../src/domains";

const DOMAIN = "suize.io";
const TARGET = "42pt2739pm5nt4b05g1k74ynkxr19jci3l6gnrpsq18mn0zug6.suize.site";
const TXT_NAME = `_suize-verify.${DOMAIN}`;
const TOKEN = "deadbeef".repeat(8);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Ans {
  name?: string;
  type?: number;
  data?: string;
}

// A DoH-route-shaped stub: keyed by "<name>|<type>" → the Answer array.
const doh = (table: Record<string, Ans[]>): void => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    const name = u.searchParams.get("name") ?? "";
    const type = u.searchParams.get("type") ?? "";
    const key = `${name}|${type}`;
    if (key in table) return new Response(JSON.stringify({ Answer: table[key] }), { status: 200 });
    throw new Error(`unexpected DoH query: ${key}`);
  }) as typeof fetch;
};

const txtOkTable: Record<string, Ans[]> = { [`${TXT_NAME}|TXT`]: [{ data: `"${TOKEN}"` }] };

// ── (1) apex flattened + proxied target: no CNAME, no chain, overlapping IPs ────

test("apex-flattened proxied domain verifies via A-set intersection", async () => {
  const edgeIps = [{ type: 1, data: "172.67.199.106" }, { type: 1, data: "104.21.84.244" }];
  doh({
    ...txtOkTable,
    [`${DOMAIN}|CNAME`]: [], // apex can't hold a CNAME
    [`${DOMAIN}|A`]: edgeIps, // flattened synthesized A records, NO type-5 chain
    [`${TARGET}|A`]: edgeIps, // the proxied target synthesizes the same edge IPs
  });

  const r = await probeDns(DOMAIN, TOKEN, TARGET);
  expect(r.txtOk).toBe(true);
  expect(r.cnameOk).toBe(true);
});

// ── (2) disjoint A sets, no chain → not routing to us ──────────────────────────

test("disjoint A sets with no CNAME chain do NOT verify", async () => {
  doh({
    ...txtOkTable,
    [`${DOMAIN}|CNAME`]: [],
    [`${DOMAIN}|A`]: [{ type: 1, data: "1.2.3.4" }],
    [`${TARGET}|A`]: [{ type: 1, data: "5.6.7.8" }],
  });

  const r = await probeDns(DOMAIN, TOKEN, TARGET);
  expect(r.txtOk).toBe(true);
  expect(r.cnameOk).toBe(false);
});

// ── (3a) the direct-CNAME path still short-circuits true (no A lookups needed) ──

test("a direct CNAME to the target still verifies", async () => {
  doh({
    ...txtOkTable,
    [`${DOMAIN}|CNAME`]: [{ type: 5, data: `${TARGET}.` }], // trailing dot tolerated
  });

  const r = await probeDns(DOMAIN, TOKEN, TARGET);
  expect(r.cnameOk).toBe(true);
});

// ── (3b) the A-query CNAME-chain path still verifies (ALIAS-flattened, chain seen) ─

test("a type-5 CNAME in the A-query chain still verifies", async () => {
  doh({
    ...txtOkTable,
    [`${DOMAIN}|CNAME`]: [],
    [`${DOMAIN}|A`]: [{ type: 5, data: TARGET }, { type: 1, data: "203.0.113.7" }],
  });

  const r = await probeDns(DOMAIN, TOKEN, TARGET);
  expect(r.cnameOk).toBe(true);
});
