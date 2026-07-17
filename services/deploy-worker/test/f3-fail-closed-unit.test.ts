// FIX 3b (money-safety) — siteIdByDigest is the pre-store replay guard: a `null`
// means "no prior site → safe to mint/store". It MUST therefore fail CLOSED on an
// indeterminate RPC read (throw), never return null, or a transient fault during a
// REPLAY would be mis-read as "fresh" and re-burn a permanent Walrus store / re-mint.
// (A genuine miss — the fresh-deploy case — still returns null; that path is
// live-verified: Sui gRPC throws `Object 0x… not found`, which siteIdByDigest maps
// to null. It can't be exercised offline without a real registry read, so this unit
// pins the load-bearing direction: a transport error is NOT swallowed to null.)
import { test, expect, afterEach } from "bun:test";
import { siteIdByDigest, ChainError } from "../src/chain";
import type { Env } from "../src/env";

// A bogus, fast-failing gRPC URL (connection refused) — plus a throwing fetch
// stub — so the registry read cannot succeed and MUST surface as a fault.
const env = { SUI_NETWORK: "testnet", SUI_GRPC_URL: "http://127.0.0.1:1" } as Env;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("siteIdByDigest FAILS CLOSED on a transient RPC read error (throws 503, never null)", async () => {
  globalThis.fetch = (async () => {
    throw new Error("simulated transient RPC failure");
  }) as unknown as typeof fetch;

  let result: string | null | undefined;
  let threw: unknown = null;
  try {
    result = await siteIdByDigest(env, "SOME_SETTLED_DIGEST");
  } catch (e) {
    threw = e;
  }

  expect(result).toBeUndefined(); // it did NOT return (a null return here = double-mint bug)
  expect(threw).toBeInstanceOf(ChainError);
  expect((threw as ChainError).status).toBe(503);
});
