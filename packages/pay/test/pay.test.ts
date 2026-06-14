// Unit tests — NO network. The facilitator (/terms, /verify, /settle) is mocked
// by stubbing globalThis.fetch; the on-chain settlement is never touched.
import { afterEach, describe, expect, test } from "bun:test";
import {
  suize,
  mintPaymentRequired,
  type PaymentRequired,
  type PaymentPayload,
  type Output,
} from "../src/index";

const MERCHANT = "0x" + "1".repeat(64);
const TREASURY = "0x" + "2".repeat(64);
const PAYER = "0x" + "a".repeat(64);
const FACILITATOR = "https://facil.test";
const USDC_TESTNET =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

// ─── fetch stubbing ───────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
/** Route a stubbed fetch by URL substring → a JSON body (status 200 unless given). */
const stubFetch = (routes: Record<string, { body?: unknown; status?: number; throw?: boolean }>) => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [needle, r] of Object.entries(routes)) {
      if (url.includes(needle)) {
        if (r.throw) throw new Error("network down");
        return new Response(JSON.stringify(r.body ?? {}), {
          status: r.status ?? 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    throw new Error(`unstubbed fetch: ${url}`);
  }) as typeof fetch;
};

const b64json = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const unb64json = <T>(s: string) => JSON.parse(decodeURIComponent(escape(atob(s)))) as T;

// ─────────────────────────────────────────────────────────────────────────────
describe("mintPaymentRequired (x402 V2 shape)", () => {
  test("free tier: vanilla single output, valid V2 body", () => {
    const body = mintPaymentRequired({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    expect(body.x402Version).toBe(2);
    expect(body.accepts).toHaveLength(1);
    const req = body.accepts[0];
    expect(req.scheme).toBe("exact");
    expect(req.network).toBe("sui:testnet");
    expect(req.asset).toBe(USDC_TESTNET);
    expect(req.payTo).toBe(MERCHANT);
    expect(req.amount).toBe("500000"); // 0.50 → atomic
    expect(req.maxTimeoutSeconds).toBe(120);
    expect(req.extra.buildUrl).toBe(`${FACILITATOR}/build`);
    // single vanilla output = the whole price to the merchant (the free tier)
    expect(req.extra.outputs).toEqual([{ to: MERCHANT, amount: "500000" }]);
    // payment-identifier extension carries an in-spec id
    const id = (body.extensions[`payment-identifier`] as { info: { id: string; required: boolean } }).info;
    expect(id.required).toBe(true);
    expect(/^[A-Za-z0-9_-]{16,128}$/.test(id.id)).toBe(true);
  });

  test("mainnet selects the native USDC asset", () => {
    const body = mintPaymentRequired({ to: MERCHANT, price: "1", network: "sui:mainnet" });
    expect(body.accepts[0].asset).toBe(
      "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    );
  });

  test("fee split: outputs carried verbatim, sum == amount", () => {
    const outputs: Output[] = [
      { to: MERCHANT, amount: "490000" },
      { to: TREASURY, amount: "10000" },
    ];
    const body = mintPaymentRequired({ to: MERCHANT, price: "0.50" }, { outputs });
    expect(body.accepts[0].extra.outputs).toEqual(outputs);
    expect(body.accepts[0].amount).toBe("500000");
  });

  test("⚠ same-address outputs are MERGED", () => {
    const outputs: Output[] = [
      { to: MERCHANT, amount: "300000" },
      { to: MERCHANT, amount: "190000" },
      { to: TREASURY, amount: "10000" },
    ];
    const body = mintPaymentRequired({ to: MERCHANT, price: "0.50" }, { outputs });
    expect(body.accepts[0].extra.outputs).toEqual([
      { to: MERCHANT, amount: "490000" },
      { to: TREASURY, amount: "10000" },
    ]);
  });

  test("a fixed paymentId is honored (the tracking caller pins it)", () => {
    const id = "pay_" + "a".repeat(32);
    const body = mintPaymentRequired({ to: MERCHANT, price: "0.1" }, { paymentId: id });
    expect((body.extensions["payment-identifier"] as { info: { id: string } }).info.id).toBe(id);
  });

  test("malformed terms throw at mint", () => {
    expect(() => mintPaymentRequired({ to: "0xnope", price: "0.5" })).toThrow();
    expect(() => mintPaymentRequired({ to: MERCHANT, price: "0" })).toThrow();
    expect(() => mintPaymentRequired({ to: MERCHANT, price: "0.0000001" })).toThrow(); // 7dp
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("suize() — challenge minting + the PAYMENT-REQUIRED header", () => {
  test("a bare request → 402 with both the body and the base64 header", async () => {
    stubFetch({ "/terms": { body: { outputs: [] } } });
    const pay = suize({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    const res = await pay.wrap(() => new Response("secret"))(new Request("https://m.test/x"));
    expect(res.status).toBe(402);
    const headerBody = unb64json<PaymentRequired>(res.headers.get("PAYMENT-REQUIRED")!);
    const jsonBody = (await res.json()) as PaymentRequired;
    expect(headerBody.accepts[0].payTo).toBe(MERCHANT);
    expect(jsonBody.x402Version).toBe(2);
  });

  test("terms outputs flow into the minted requirement (fee leg present)", async () => {
    stubFetch({
      "/terms": {
        body: { outputs: [{ to: MERCHANT, amount: "490000" }, { to: TREASURY, amount: "10000" }] },
      },
    });
    const pay = suize({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    const body = await pay.challenge("https://m.test/x");
    expect(body.accepts[0].extra.outputs).toEqual([
      { to: MERCHANT, amount: "490000" },
      { to: TREASURY, amount: "10000" },
    ]);
  });

  test("terms FETCH FAILURE → fail-open to the free tier (the sale survives)", async () => {
    stubFetch({ "/terms": { throw: true } });
    const pay = suize({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    const body = await pay.challenge("https://m.test/x");
    // no fee leg — merchant absorbs no fee rather than refusing to serve
    expect(body.accepts[0].extra.outputs).toEqual([{ to: MERCHANT, amount: "500000" }]);
  });

  test("malformed config throws at boot", () => {
    expect(() => suize({ to: "0xbad", price: "0.5" })).toThrow();
  });
});

// ─── a helper to mint a quote and forge a matching payload ─────────────────────
const issueAndForge = async (
  pay: ReturnType<typeof suize>,
  transaction = "tx_" + Math.random().toString(36).slice(2),
): Promise<{ challenge: PaymentRequired; payload: PaymentPayload }> => {
  const challenge = await pay.challenge("https://m.test/x");
  const accepted = challenge.accepts[0];
  const id = (challenge.extensions["payment-identifier"] as { info: { id: string } }).info.id;
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted,
    payload: { signature: "sig", transaction },
    extensions: { "payment-identifier": { info: { id } } },
  };
  return { challenge, payload };
};

const headerFor = (payload: PaymentPayload) =>
  new Headers({ "PAYMENT-SIGNATURE": b64json(payload) });

describe("suize() — verify → settle → serve (the happy path)", () => {
  test("a verified+settled payment serves the handler with both receipt headers", async () => {
    stubFetch({
      "/terms": { body: { outputs: [] } },
      "/verify": { body: { isValid: true, payer: PAYER } },
      "/settle": { body: { success: true, transaction: "DIGEST123", network: "sui:testnet" } },
    });
    const pay = suize({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    const { payload } = await issueAndForge(pay);
    const res = await pay.wrap(() => new Response("secret"))(
      new Request("https://m.test/x", { headers: headerFor(payload) }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("secret");
    expect(res.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    expect(res.headers.get("X-PAYMENT-RESPONSE")).toBeTruthy();
  });
});

describe("suize() — the SYNCHRONOUS denies (no network)", () => {
  test("an unknown payment-identifier → fresh 402, NO verify call", async () => {
    let verifyCalled = false;
    stubFetch({
      "/terms": { body: { outputs: [] } },
      "/verify": { get body() { verifyCalled = true; return { isValid: true }; } },
    });
    const pay = suize({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    // forge a payload whose id was NEVER issued
    const challenge = await pay.challenge("https://m.test/x");
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: challenge.accepts[0],
      payload: { signature: "s", transaction: "tx1" },
      extensions: { "payment-identifier": { info: { id: "pay_" + "f".repeat(32) } } },
    };
    const res = await pay.wrap(() => new Response("secret"))(
      new Request("https://m.test/x", { headers: headerFor(payload) }),
    );
    expect(res.status).toBe(402);
    expect(verifyCalled).toBe(false);
  });

  test("tampered terms (deep-equal mismatch) → 402, NO verify call", async () => {
    let verifyCalled = false;
    stubFetch({
      "/terms": { body: { outputs: [] } },
      "/verify": { get body() { verifyCalled = true; return { isValid: true }; } },
    });
    const pay = suize({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    const { payload } = await issueAndForge(pay);
    // tamper the amount the payer claims to have agreed to
    payload.accepted = { ...payload.accepted, amount: "1" };
    const res = await pay.wrap(() => new Response("secret"))(
      new Request("https://m.test/x", { headers: headerFor(payload) }),
    );
    expect(res.status).toBe(402);
    expect(verifyCalled).toBe(false);
  });

  test("replay: the SAME settled tx is denied the second time", async () => {
    stubFetch({
      "/terms": { body: { outputs: [] } },
      "/verify": { body: { isValid: true } },
      "/settle": { body: { success: true, transaction: "D", network: "sui:testnet" } },
    });
    const pay = suize({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    const { payload } = await issueAndForge(pay, "tx_replay");
    const first = await pay.wrap(() => new Response("ok"))(
      new Request("https://m.test/x", { headers: headerFor(payload) }),
    );
    expect(first.status).toBe(200);
    // present the exact same payload again → denied (one settlement = one serve)
    const second = await pay.wrap(() => new Response("ok"))(
      new Request("https://m.test/x", { headers: headerFor(payload) }),
    );
    expect(second.status).toBe(402);
  });
});

describe("suize() — F4 concurrent same-payment (the TOCTOU close)", () => {
  test("two concurrent requests with the SAME payment: handler runs ONCE, the loser gets 409", async () => {
    // Gate the handler so both requests are in flight simultaneously: the handler
    // blocks until we release it, so request #2 hits inspect WHILE #1 is mid-flight.
    let release!: () => void;
    const handlerGate = new Promise<void>((r) => (release = r));
    let handlerCalls = 0;

    stubFetch({
      "/terms": { body: { outputs: [] } },
      "/verify": { body: { isValid: true } },
      "/settle": { body: { success: true, transaction: "D_concurrent", network: "sui:testnet" } },
    });
    const pay = suize({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    const { payload } = await issueAndForge(pay, "tx_concurrent");

    const handler = async () => {
      handlerCalls++;
      await handlerGate; // block until released — keeps the first request in flight
      return new Response("secret");
    };
    const fire = () =>
      pay.wrap(handler)(new Request("https://m.test/x", { headers: headerFor(payload) }));

    const p1 = fire(); // claims the tx in-flight, then blocks in the handler
    // Yield so p1 passes inspect (claims inflight) before p2 inspects.
    await new Promise((r) => setTimeout(r, 5));
    const p2 = fire(); // sees the tx already in-flight → 409, handler NOT re-run
    const r2 = await p2;
    expect(r2.status).toBe(409); // the loser is told to retry, never double-served
    expect(handlerCalls).toBe(1); // only the winner ran the handler

    release(); // let the winner finish + settle
    const r1 = await p1;
    expect(r1.status).toBe(200);
    expect(await r1.text()).toBe("secret");
    expect(handlerCalls).toBe(1); // still exactly one handler invocation
  });

  test("a transient settle failure RELEASES the in-flight claim so the same header can retry", async () => {
    // First attempt: settle throws (transient) → 503 AND the claim is released.
    // Second attempt with the SAME header then settles cleanly → 200 (not stuck 409).
    const pay = suize({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    const { payload } = await issueAndForge(pay, "tx_release_retry");

    stubFetch({
      "/terms": { body: { outputs: [] } },
      "/verify": { body: { isValid: true } },
      "/settle": { throw: true },
    });
    const first = await pay.wrap(() => new Response("ok"))(
      new Request("https://m.test/x", { headers: headerFor(payload) }),
    );
    expect(first.status).toBe(503); // transient — claim released, not consumed

    stubFetch({
      "/terms": { body: { outputs: [] } },
      "/verify": { body: { isValid: true } },
      "/settle": { body: { success: true, transaction: "D_retry", network: "sui:testnet" } },
    });
    const second = await pay.wrap(() => new Response("ok"))(
      new Request("https://m.test/x", { headers: headerFor(payload) }),
    );
    expect(second.status).toBe(200); // the released claim let the genuine retry through
  });
});

describe("suize() — fail-closed transient handling (the double-pay guard)", () => {
  test("/verify network error → 503 (resend), NEVER a fresh 402", async () => {
    stubFetch({ "/terms": { body: { outputs: [] } }, "/verify": { throw: true } });
    const pay = suize({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    const { payload } = await issueAndForge(pay);
    const res = await pay.wrap(() => new Response("ok"))(
      new Request("https://m.test/x", { headers: headerFor(payload) }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("2");
  });

  test("/verify non-2xx → 503 transient (not a definitive no)", async () => {
    stubFetch({
      "/terms": { body: { outputs: [] } },
      "/verify": { body: { isValid: false }, status: 502 },
    });
    const pay = suize({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    const { payload } = await issueAndForge(pay);
    const res = await pay.wrap(() => new Response("ok"))(
      new Request("https://m.test/x", { headers: headerFor(payload) }),
    );
    expect(res.status).toBe(503);
  });

  test("/settle network error → 503 (resend same header)", async () => {
    stubFetch({
      "/terms": { body: { outputs: [] } },
      "/verify": { body: { isValid: true } },
      "/settle": { throw: true },
    });
    const pay = suize({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    const { payload } = await issueAndForge(pay);
    const res = await pay.wrap(() => new Response("ok"))(
      new Request("https://m.test/x", { headers: headerFor(payload) }),
    );
    expect(res.status).toBe(503);
  });

  test("a DEFINITIVE !isValid → fresh 402 with the reason", async () => {
    stubFetch({
      "/terms": { body: { outputs: [] } },
      "/verify": { body: { isValid: false, invalidReason: "outputs_mismatch" } },
    });
    const pay = suize({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    const { payload } = await issueAndForge(pay);
    const res = await pay.wrap(() => new Response("ok"))(
      new Request("https://m.test/x", { headers: headerFor(payload) }),
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as PaymentRequired;
    expect(body.error).toBe("outputs_mismatch");
  });
});

describe("suize() — terms cache", () => {
  test("/terms is fetched once and cached across challenges", async () => {
    let termsHits = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/terms")) {
        termsHits++;
        return new Response(JSON.stringify({ outputs: [] }), { status: 200 });
      }
      throw new Error("unstubbed");
    }) as typeof fetch;
    const pay = suize({ to: MERCHANT, price: "0.50", facilitator: FACILITATOR });
    await pay.challenge("https://m.test/a");
    await pay.challenge("https://m.test/b");
    await pay.challenge("https://m.test/c");
    expect(termsHits).toBe(1); // cached within the 5-min TTL
  });
});
