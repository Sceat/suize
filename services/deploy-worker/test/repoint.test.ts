// POST /domains/repoint — move a PAID custom domain onto another site the SAME
// owner controls, WITHOUT re-paying the yearly reservation. The load-bearing part
// is the auth: the signer (recovered from the repoint personal-message) must own
// BOTH the domain's currently-linked site AND the target site. This suite drives
// the REAL handleRepoint with a stubbed chain (mirrors deploy-replay.test.ts):
//
//   - `../src/chain` is module-mocked with a snapshot spread so every real export
//     stays present; only `suiClient` (a fake gRPC), `readSite` (an owner map),
//     and `executeWithRetry` (captures the built PTB) are steered.
//   - the DomainRegistry table-UID GraphQL read is fetch-stubbed; NO facilitator /
//     x402 endpoint is ever hit (a repoint is free — proven by the fetch assertion).
//   - signatures are REAL Ed25519 personal-message sigs, verified offline.
import { test, expect, afterEach, mock } from "bun:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { bcs } from "@mysten/sui/bcs";
import { buildDeployRepointAuthMessage } from "@suize/shared";
import type { Env } from "../src/env";

const CURRENT_SITE = "0x" + "5e".repeat(32);
const NEW_SITE = "0x" + "77".repeat(32);
const OLD_CAP = "0x" + "c0".repeat(32);
const NEW_CAP = "0x" + "c1".repeat(32);
const DOMAIN = "news.example.com";
const TABLE_UID = "0x" + "db".repeat(32);
const GRAPHQL_URL = "https://graphql.repoint.example/graphql";
const FACILITATOR_URL = "https://fac-repoint.example";

// ── steered-by-test state the chain mock reads at CALL time ────────────────────
let ownerBySite: Record<string, string> = {}; // siteId(lc) -> owner address
let capturedFns: string[] | null = null; // the repoint PTB's move-call functions, or null if never built
let capturedModules: string[] | null = null;
// Reset via a helper (not an inline `= null`) so TS keeps the `string[] | null`
// type at each read instead of narrowing to `null` past the assignment.
const resetCapture = (): void => {
  capturedFns = null;
  capturedModules = null;
};

const siteState = (owner: string) => ({
  owner: owner.toLowerCase(),
  sealed: false,
  paidUntilMs: 0,
  quiltBlobObject: "",
  manifestBlobObject: "",
  sizeBytes: 0,
});

// Fake gRPC: getDynamicField resolves the domain -> CURRENT_SITE (siteForDomain);
// listOwnedObjects returns BOTH sites' SiteAdminCaps (findAdminCapForSite picks one).
const fakeClient = {
  getDynamicField: async () => ({
    dynamicField: { value: { bcs: bcs.Address.serialize(CURRENT_SITE).toBytes() } },
  }),
  listOwnedObjects: async () => ({
    objects: [
      { objectId: OLD_CAP, json: { site_id: CURRENT_SITE } },
      { objectId: NEW_CAP, json: { site_id: NEW_SITE } },
    ],
    hasNextPage: false,
    cursor: null,
  }),
};

import * as chainNS from "../src/chain";
const realChain = { ...chainNS };
mock.module("../src/chain", () => ({
  ...realChain,
  suiClient: () => fakeClient,
  readSite: async (_env: Env, id: string) => {
    const owner = ownerBySite[id.toLowerCase()];
    return owner ? siteState(owner) : null;
  },
  executeWithRetry: async (_env: Env, build: () => { getData(): { commands: unknown[] } }) => {
    const cmds = build().getData().commands as { MoveCall?: { module?: string; function?: string } }[];
    capturedFns = cmds.map((c) => c.MoveCall?.function ?? "");
    capturedModules = cmds.map((c) => c.MoveCall?.module ?? "");
    return { digest: "REPOINT_DIGEST", effects: undefined, events: [] };
  },
}));

const env: Env = {
  SUI_GRAPHQL_URL: GRAPHQL_URL,
  WALRUS_AGGREGATOR: "https://aggregator.example",
  SUI_NETWORK: "testnet",
  FACILITATOR_URL,
  SUIZE_MERCHANT: "0x" + "6a".repeat(32),
  WALRUS_PUBLISHER: "https://publisher.example",
  DEPLOY_WALLET_KEY: Ed25519Keypair.generate().getSecretKey(),
};

// ── fetch stub: only the table-UID GraphQL read is expected; nothing else ─────
const realFetch = globalThis.fetch;
let fetchCalls: string[] = [];
const stubFetch = () => {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url === GRAPHQL_URL) {
      return new Response(
        JSON.stringify({ data: { object: { asMoveObject: { contents: { json: { domains: { id: TABLE_UID } } } } } } }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
};
afterEach(() => {
  globalThis.fetch = realFetch;
});

const signRepoint = async (kp: Ed25519Keypair, domain: string, newSiteId: string, ts: number): Promise<string> => {
  const { signature } = await kp.signPersonalMessage(
    new TextEncoder().encode(buildDeployRepointAuthMessage(domain, newSiteId, ts)),
  );
  return signature;
};

const makeReq = (b: Record<string, unknown>): Request =>
  new Request("http://localhost/domains/repoint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  });

const noFacilitatorHit = (): boolean =>
  fetchCalls.some((u) => u.includes(FACILITATOR_URL) || /\/(verify|settle|supported)\b/.test(u));

// ── (1) happy path: signer owns BOTH sites → atomic unlink+link, no charge ─────
test("repoint succeeds when the signer owns both sites (atomic unlink+link, no x402)", async () => {
  const { handleRepoint } = await import("../src/domains");
  stubFetch();
  resetCapture();

  const owner = Ed25519Keypair.generate();
  const addr = owner.toSuiAddress().toLowerCase();
  ownerBySite = { [CURRENT_SITE.toLowerCase()]: addr, [NEW_SITE.toLowerCase()]: addr };

  const ts = Date.now();
  const signature = await signRepoint(owner, DOMAIN, NEW_SITE, ts);
  const res = await handleRepoint(makeReq({ domain: DOMAIN, newSiteId: NEW_SITE, ts, signature }), env);

  expect(res.status).toBe(200);
  const body = (await res.json()) as { siteId: string; previousSiteId: string; digest: string | null };
  expect(body.siteId).toBe(NEW_SITE);
  expect(body.previousSiteId.toLowerCase()).toBe(CURRENT_SITE.toLowerCase());
  expect(body.digest).toBe("REPOINT_DIGEST");

  // The ONE atomic PTB: unlink THEN link, both in domain_registry, nothing else.
  expect(capturedFns).toEqual(["unlink_domain", "link_domain"]);
  expect(capturedModules).toEqual(["domain_registry", "domain_registry"]);
  // Free move: no facilitator / x402 settlement was ever touched.
  expect(noFacilitatorHit()).toBe(false);
});

// ── (2) signer is NOT the current site's owner → 403, no PTB ───────────────────
test("rejects (403) when the signer is not the current site's owner", async () => {
  const { handleRepoint } = await import("../src/domains");
  stubFetch();
  resetCapture();

  const signer = Ed25519Keypair.generate(); // valid sig, but not the owner
  const someoneElse = Ed25519Keypair.generate().toSuiAddress().toLowerCase();
  ownerBySite = {
    [CURRENT_SITE.toLowerCase()]: someoneElse, // current site owned by another
    [NEW_SITE.toLowerCase()]: signer.toSuiAddress().toLowerCase(),
  };

  const ts = Date.now();
  const signature = await signRepoint(signer, DOMAIN, NEW_SITE, ts);
  const res = await handleRepoint(makeReq({ domain: DOMAIN, newSiteId: NEW_SITE, ts, signature }), env);

  expect(res.status).toBe(403);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/current site/i);
  expect(capturedFns).toBeNull(); // never reached the on-chain write
});

// ── (3) signer does NOT own the target site → 403, no PTB ──────────────────────
test("rejects (403) when the signer does not own the target site", async () => {
  const { handleRepoint } = await import("../src/domains");
  stubFetch();
  resetCapture();

  const signer = Ed25519Keypair.generate();
  const addr = signer.toSuiAddress().toLowerCase();
  const someoneElse = Ed25519Keypair.generate().toSuiAddress().toLowerCase();
  ownerBySite = {
    [CURRENT_SITE.toLowerCase()]: addr, // owns the domain's current site
    [NEW_SITE.toLowerCase()]: someoneElse, // but NOT the target
  };

  const ts = Date.now();
  const signature = await signRepoint(signer, DOMAIN, NEW_SITE, ts);
  const res = await handleRepoint(makeReq({ domain: DOMAIN, newSiteId: NEW_SITE, ts, signature }), env);

  expect(res.status).toBe(403);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/target site/i);
  expect(capturedFns).toBeNull();
});

// ── (4) newSiteId == current linked site → idempotent 200, no on-chain write ───
test("idempotent 200 (no on-chain write) when the domain already points at newSiteId", async () => {
  const { handleRepoint } = await import("../src/domains");
  stubFetch();
  resetCapture();
  ownerBySite = {}; // never consulted on the no-op path

  const signer = Ed25519Keypair.generate();
  const ts = Date.now();
  // newSiteId is the SAME site the domain already resolves to (CURRENT_SITE).
  const signature = await signRepoint(signer, DOMAIN, CURRENT_SITE, ts);
  const res = await handleRepoint(makeReq({ domain: DOMAIN, newSiteId: CURRENT_SITE, ts, signature }), env);

  expect(res.status).toBe(200);
  const body = (await res.json()) as { siteId: string; digest: string | null };
  expect(body.siteId.toLowerCase()).toBe(CURRENT_SITE.toLowerCase());
  expect(body.digest).toBeNull();
  expect(capturedFns).toBeNull(); // no unlink/link ran
});
