// Publisher JWT auth on the Walrus store path (mainnet self-hosted publisher).
// The worker mints a fresh single-use HS256 token per store PUT, keyed by the
// HEX-DECODED bytes of a `0x<hex>` shared secret (walrus config.rs::secret_to_bytes),
// binding `epochs` + `send_object_to` (auth.rs check_valid_upload). This suite
// proves, with a stubbed publisher fetch:
//   (a) secret set → the PUT carries a Bearer whose signature VERIFIES under the
//       hex-decoded key, with a fresh jti + short exp, all segments base64url;
//   (b) no secret → no Authorization header (public testnet path untouched);
//   (c) two stores → two DIFFERENT jti (single-use replay guard).
// All offline: the stub returns a canned publisher body; no network, no real key.
import { test, expect, afterEach } from "bun:test";
import { storeBlob, storeQuilt } from "../src/walrus";

const PUBLISHER = "https://publisher.example";
const SVC = "0x" + "cc".repeat(32); // send_object_to target
const EPOCHS = 7;
const BYTES = new TextEncoder().encode("hello walrus");

// A throwaway 0x<hex> secret, generated per run — NEVER a real key, never printed.
const throwawaySecret = (): string =>
  "0x" +
  [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");

// Canned publisher responses. `newlyCreated` is REQUIRED (dedup would 502).
const NEWLY = { blobObject: { id: "0x" + "ab".repeat(32), blobId: "blobABC", storage: { endEpoch: 99 } } };
const OK_BLOB = JSON.stringify({ newlyCreated: NEWLY });
const OK_QUILT = JSON.stringify({
  blobStoreResult: { newlyCreated: NEWLY },
  storedQuiltBlobs: [{ identifier: "f0", quiltPatchId: "patch0" }],
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Reads the Authorization header off the captured PUT init (object or Headers). */
const authOf = (init: RequestInit | undefined): string | undefined => {
  const h = init?.headers as Record<string, string> | Headers | undefined;
  if (!h) return undefined;
  return h instanceof Headers ? (h.get("Authorization") ?? undefined) : h.Authorization;
};

/** Stub the publisher (URL-aware body), capturing every PUT's Authorization header. */
const captureAuth = (): (() => (string | undefined)[]) => {
  const seen: (string | undefined)[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(authOf(init));
    const body = String(input).includes("/v1/quilts") ? OK_QUILT : OK_BLOB;
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return () => seen;
};

// base64url → bytes (add padding, swap alphabet). No '=', '+', '/' in valid input.
const b64urlToBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlToJson = (s: string): Record<string, unknown> =>
  JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

const hexToBytes = (hex: string): Uint8Array => {
  const h = hex.slice(2);
  return Uint8Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
};

const isBase64Url = (seg: string): boolean => /^[A-Za-z0-9_-]+$/.test(seg);

/** Independently verify a token's HMAC-SHA256 signature under the hex-decoded key. */
const signatureVerifies = async (token: string, hexSecret: string): Promise<boolean> => {
  const [h, p, sig] = token.split(".");
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(hexSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
};

// ── (a) secret set → verifiable Bearer with fresh jti + short exp ──────────────

test("secret set: the store PUT carries a Bearer that verifies, base64url, exp>now, jti present", async () => {
  const secret = throwawaySecret();
  const seen = captureAuth();

  await storeBlob(PUBLISHER, BYTES, EPOCHS, SVC, secret);

  expect(seen().length).toBe(1);
  const header = seen()[0]!;
  expect(header.startsWith("Bearer ")).toBe(true);
  const token = header.slice("Bearer ".length);

  const [h, p, sig] = token.split(".");
  expect(token.split(".").length).toBe(3);
  for (const seg of [h, p, sig]) {
    expect(isBase64Url(seg)).toBe(true); // no '=', no '+', no '/'
  }

  // Signature recomputes under the HEX-DECODED key (not the ascii of the string).
  expect(await signatureVerifies(token, secret)).toBe(true);

  const head = b64urlToJson(h);
  expect(head.alg).toBe("HS256");
  expect(head.typ).toBe("JWT");

  const claims = b64urlToJson(p);
  const now = Math.floor(Date.now() / 1000);
  expect(typeof claims.jti).toBe("string");
  expect((claims.jti as string).length).toBeGreaterThan(0);
  expect(claims.exp as number).toBeGreaterThan(now);
  expect((claims.exp as number) - (claims.iat as number)).toBe(300); // short-lived
  // Bound to the request's terms (auth.rs check_epochs / check_send_object_to).
  expect(claims.epochs).toBe(EPOCHS);
  expect(claims.send_object_to).toBe(SVC);
});

// ── (b) no secret → no Authorization header (public testnet path) ──────────────

test("no secret: the store PUT carries NO Authorization header", async () => {
  const seen = captureAuth();
  await storeBlob(PUBLISHER, BYTES, EPOCHS, SVC); // jwtSecret omitted
  expect(seen().length).toBe(1);
  expect(seen()[0]).toBeUndefined();
});

// ── (c) two stores → two DIFFERENT jti (single-use replay guard) ──────────────

test("two stores mint two DIFFERENT jti", async () => {
  const secret = throwawaySecret();
  const seen = captureAuth();

  // A blob store and a quilt store both go through the single per-PUT mint.
  await storeBlob(PUBLISHER, BYTES, EPOCHS, SVC, secret);
  await storeQuilt(
    PUBLISHER,
    [{ servedPath: "/i", identifier: "f0", data: BYTES, contentType: "text/plain" }],
    EPOCHS,
    SVC,
    secret,
  );

  const tokens = seen().map((a) => a!.slice("Bearer ".length));
  expect(tokens.length).toBe(2);
  const jtis = tokens.map((t) => b64urlToJson(t.split(".")[1]).jti as string);
  expect(jtis[0]).not.toBe(jtis[1]);
  expect(jtis[0].length).toBeGreaterThan(0);
});
