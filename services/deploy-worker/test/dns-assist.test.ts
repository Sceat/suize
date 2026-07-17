// The DNS-assist core — the seams that matter for real money and real secrets:
//   (1) the registrable-domain walk queries candidates MOST-specific-first and
//       binds to the first zone the token can see (test.suize.io → suize.io);
//   (2) an existing record is PATCHed, never a hard failure;
//   (3) THE token never appears in any surfaced error — a CF body that echoes it
//       is scrubbed; a 403 is a fixed permission line, never CF's raw text.
// All offline: global fetch is a route-shaped stub per test (the real CF API is
// never called; no token exists for this suite).
import { test, expect, afterEach } from "bun:test";
import { zoneCandidates, assistRecords, AssistError } from "../src/dns-assist";
import type { ChallengeFacts } from "../src/domains";

const TOKEN = "abcDEF0123456789_secret-tok";
const FACTS: ChallengeFacts = {
  txtName: "_suize-verify.app.example.com",
  txtValue: "deadbeef".repeat(8),
  cname: "0".repeat(50) + ".suize.site",
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ok = (result: unknown, status = 200): Response =>
  new Response(JSON.stringify({ success: true, result }), { status });
const fail = (errors: { code?: number; message?: string }[], status = 400): Response =>
  new Response(JSON.stringify({ success: false, errors }), { status });

// ── (1) the registrable-domain walk ───────────────────────────────────────────

test("zoneCandidates walks labels most-specific-first, down to the apex", () => {
  expect(zoneCandidates("test.suize.io")).toEqual(["test.suize.io", "suize.io"]);
  expect(zoneCandidates("a.b.example.com")).toEqual(["a.b.example.com", "b.example.com", "example.com"]);
  expect(zoneCandidates("suize.io")).toEqual(["suize.io"]);
});

test("resolveZone tries each candidate until a zone matches (subdomain → apex)", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    // The token can only see the apex zone; the specific candidate returns [].
    if (url.includes("/zones?name=test.suize.io")) return ok([]);
    if (url.includes("/zones?name=suize.io")) return ok([{ id: "ZONE1", name: "suize.io" }]);
    if (url.includes("/dns_records")) return ok({ id: "REC" }, 200);
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const r = await assistRecords(TOKEN, "test.suize.io", FACTS);
  expect(r.zone).toBe("suize.io");
  expect(calls.some((u) => u.includes("/zones?name=test.suize.io"))).toBe(true);
  expect(calls.some((u) => u.includes("/zones?name=suize.io"))).toBe(true);
  // Both records created under the resolved zone.
  expect(r.recordsCreated.map((x) => x.type)).toEqual(["TXT", "CNAME"]);
  expect(r.recordsCreated.every((x) => x.created)).toBe(true);
});

test("no matching zone → a 404 AssistError naming the domain, never the token", async () => {
  globalThis.fetch = (async (_input: RequestInfo | URL) => ok([])) as typeof fetch;
  let thrown: unknown;
  try {
    await assistRecords(TOKEN, "app.example.com", FACTS);
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(AssistError);
  expect((thrown as AssistError).status).toBe(404);
  expect(JSON.stringify((thrown as AssistError).payload)).not.toContain(TOKEN);
  expect((thrown as AssistError).payload.error).toContain("app.example.com");
});

// ── (2) the upsert / already-exists PATCH path ────────────────────────────────

test("an already-existing record (81057) is list-and-PATCHed, not failed", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/zones?name")) return ok([{ id: "Z", name: "example.com" }]);
    // POST create → the TXT already exists; the CNAME creates clean.
    if (url.endsWith("/dns_records") && method === "POST") {
      const b = JSON.parse(String(init?.body ?? "{}")) as { type?: string };
      if (b.type === "TXT") return fail([{ code: 81057, message: "Record already exists." }]);
      return ok({ id: "NEWCNAME" });
    }
    // list existing TXT → one match; PATCH it.
    if (url.includes("/dns_records?type=TXT")) return ok([{ id: "EXISTINGTXT" }]);
    if (url.includes("/dns_records/EXISTINGTXT") && method === "PATCH") return ok({ id: "EXISTINGTXT" });
    throw new Error(`unexpected fetch: ${method} ${url}`);
  }) as typeof fetch;

  const r = await assistRecords(TOKEN, "app.example.com", FACTS);
  const txt = r.recordsCreated.find((x) => x.type === "TXT");
  const cname = r.recordsCreated.find((x) => x.type === "CNAME");
  expect(txt).toMatchObject({ created: false }); // reconciled via PATCH
  expect(cname).toMatchObject({ created: true });
});

// ── (3) the token-never-in-errors property ────────────────────────────────────

test("a CF error body that echoes the token is scrubbed from the surfaced error", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/zones?name")) return ok([{ id: "Z", name: "example.com" }]);
    // The record POST fails with a message that (adversarially) echoes the token.
    if (url.includes("/dns_records") && (init?.method ?? "GET") === "POST") {
      return fail([{ code: 10000, message: `Invalid header 'Authorization: Bearer ${TOKEN}'` }], 400);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  let thrown: unknown;
  try {
    await assistRecords(TOKEN, "app.example.com", FACTS);
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(AssistError);
  const payloadStr = JSON.stringify((thrown as AssistError).payload);
  expect(payloadStr).not.toContain(TOKEN); // the property under test
  expect(payloadStr).toContain("***"); // proves the scrub ran, not a lucky miss
});

test("a CF 403 anywhere surfaces the permission line, never the token or CF text", async () => {
  globalThis.fetch = (async (_input: RequestInfo | URL) =>
    fail([{ code: 9109, message: `Unauthorized: token ${TOKEN} cannot edit DNS` }], 403)) as typeof fetch;
  let thrown: unknown;
  try {
    await assistRecords(TOKEN, "app.example.com", FACTS);
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(AssistError);
  expect((thrown as AssistError).status).toBe(403);
  const payloadStr = JSON.stringify((thrown as AssistError).payload);
  expect(payloadStr).not.toContain(TOKEN);
  expect((thrown as AssistError).payload.error).toBe("token lacks DNS edit permission");
});
