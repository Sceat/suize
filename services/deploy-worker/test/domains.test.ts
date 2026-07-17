// Domains re-verify SSL repair — the seam that closes the post-payment delivery
// gap: a domain PAID + linked on-chain while CF-for-SaaS creds were absent must
// be repairable by re-running the FREE `verify=1`. `linkedSslFields` is the whole
// of that new behavior (handleDomains just spreads it into the `linked` body), so
// it is unit-tested here directly with a route-shaped fetch stub — the CF API is
// never really called (mirrors dns-assist.test.ts; no token exists for this suite).
import { test, expect, afterEach } from "bun:test";
import { linkedSslFields } from "../src/domains";
import type { Env } from "../src/env";

const CF_ENV = { CF_API_TOKEN: "tok", CF_ZONE_ID: "zone" } as unknown as Env;
const NO_CF_ENV = {} as unknown as Env;
const DOMAIN = "test.suize.io";
const CNAME = "0".repeat(50) + ".suize.site";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const cfHostnames = (input: RequestInfo | URL): boolean =>
  String(input).includes("/custom_hostnames");

// ── (a) already-linked + cfEnabled → provisioning called, sslStatus surfaced ───

test("cfEnabled: provisions the custom hostname and surfaces the SSL status", async () => {
  let posted = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (cfHostnames(input) && (init?.method ?? "GET") === "POST") {
      posted = true;
      return new Response(
        JSON.stringify({ success: true, result: { ssl: { status: "pending_validation" } } }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${String(input)}`);
  }) as typeof fetch;

  const r = await linkedSslFields(CF_ENV, DOMAIN, CNAME);
  expect(posted).toBe(true); // provisioning actually ran
  expect(r.sslStatus).toBe("pending"); // collapsed to the @suize/shared wire contract
  expect(r.instructions).toBeUndefined(); // no manual note on a healthy provision
});

test("cfEnabled: an active cert surfaces sslStatus 'active'", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (cfHostnames(input)) {
      return new Response(JSON.stringify({ success: true, result: { ssl: { status: "active" } } }), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch: ${String(input)}`);
  }) as typeof fetch;

  const r = await linkedSslFields(CF_ENV, DOMAIN, CNAME);
  expect(r.sslStatus).toBe("active");
});

// ── (b) already-linked + CF disabled → response unchanged (no sslStatus) ───────

test("CF disabled: returns {} so the linked response is unchanged from today", async () => {
  let called = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    called = true;
    throw new Error(`fetch must not run when CF is disabled: ${String(input)}`);
  }) as unknown as typeof fetch;

  const r = await linkedSslFields(NO_CF_ENV, DOMAIN, CNAME);
  expect(r).toEqual({}); // no sslStatus, no instructions — byte-for-byte the pre-CF body
  expect(called).toBe(false); // no CF call attempted
});

// ── (c) provisioning fails → still 200-shaped, sslStatus 'manual' + note ───────

test("provisioning throws: degrades to sslStatus 'manual' with the DNS note (never breaks)", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (cfHostnames(input)) throw new Error("CF network down");
    throw new Error(`unexpected fetch: ${String(input)}`);
  }) as unknown as typeof fetch;

  const r = await linkedSslFields(CF_ENV, DOMAIN, CNAME);
  expect(r.sslStatus).toBe("manual");
  expect(r.instructions).toContain(DOMAIN);
  expect(r.instructions).toContain(CNAME);
});

test("provisioning returns a CF error body: also degrades to 'manual'", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (cfHostnames(input)) {
      return new Response(
        JSON.stringify({ success: false, errors: [{ code: 1234, message: "bad request" }] }),
        { status: 400 },
      );
    }
    throw new Error(`unexpected fetch: ${String(input)}`);
  }) as typeof fetch;

  const r = await linkedSslFields(CF_ENV, DOMAIN, CNAME);
  expect(r.sslStatus).toBe("manual");
});

// A duplicate-hostname CF error is NOT a failure — the LIVE shape is code 1406
// "Duplicate custom hostname found." (NOT 1407, NOT "already"): the hostname is
// already provisioned, so we read its TRUE state from the list endpoint rather
// than flapping to "manual" on every re-verify (the bug this whole fix repairs).
test("a duplicate hostname (1406) reads the existing SSL state, not a failure", async () => {
  let listed = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (cfHostnames(input) && (init?.method ?? "GET") === "POST") {
      return new Response(
        JSON.stringify({ success: false, errors: [{ code: 1406, message: "Duplicate custom hostname found." }] }),
        { status: 409 },
      );
    }
    if (cfHostnames(input)) {
      // the list-existing GET → the hostname's real, converged cert state
      listed = true;
      return new Response(JSON.stringify({ success: true, result: [{ ssl: { status: "active" } }] }), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch: ${String(input)}`);
  }) as typeof fetch;

  const r = await linkedSslFields(CF_ENV, DOMAIN, CNAME);
  expect(listed).toBe(true); // the existing-hostname state was fetched
  expect(r.sslStatus).toBe("active");
  expect(r.instructions).toBeUndefined();
});

test("a duplicate hostname still validating reads as 'pending' (not manual)", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (cfHostnames(input) && (init?.method ?? "GET") === "POST") {
      return new Response(
        JSON.stringify({ success: false, errors: [{ code: 1406, message: "Duplicate custom hostname found." }] }),
        { status: 409 },
      );
    }
    if (cfHostnames(input)) {
      return new Response(
        JSON.stringify({ success: true, result: [{ ssl: { status: "pending_validation" } }] }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${String(input)}`);
  }) as typeof fetch;

  const r = await linkedSslFields(CF_ENV, DOMAIN, CNAME);
  expect(r.sslStatus).toBe("pending"); // collapsed to the wire contract, never "manual"
});
