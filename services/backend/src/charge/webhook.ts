// Fire the settled-order webhook to the merchant — SIGNED, fire-and-forget, SSRF-guarded.
//
// The webhook is a NOTIFICATION, never an AUTHORIZATION: the body carries the on-chain
// `txDigest` (the sole proof of payment) plus a convenience copy, signed with the Suize
// CHARGE key. A spoofer hitting the public URL has neither a valid signature nor a real
// digest. The merchant verifies via @suize/pay `verifyWebhook` (signature + freshness),
// dedupes on `txDigest`, and MAY read the digest on-chain before fulfilling — see SPEC.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { signWithChargeKey, chargePublicKey } from "./token";

/** The exact body Suize POSTs (and @suize/pay verifyWebhook parses). v1 only. */
export interface WebhookOrder {
  v: 1;
  chargeRef: string | null;
  payer: string;
  amount: string; // atomic USDC base units (= the listed price)
  asset: string;
  network: string;
  merchant: string;
  txDigest: string; // THE on-chain receipt — the only authority to fulfill
  order: unknown; // the agent's order data, verbatim (opaque) or null
  paidAt: number; // epoch ms
}

const TIMEOUT_MS = 8_000;
// Backoff schedule (~15 min total) — a merchant endpoint can be down for a deploy
// or a brief outage and still receive the order. The schedule is a pure function of
// the attempt index (no per-replica timer state worth persisting): if a replica
// restarts mid-retry the in-flight delivery is lost, but the payment is on-chain and
// the merchant reconciles by `chargeRef` from the chain (the webhook is at-least-once,
// eventually-delivered — never the system of record). 6 retries after the first try.
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000, 120_000, 300_000, 900_000];

/** Block private / loopback / link-local / metadata ranges (SSRF). */
const isBlockedIp = (ip: string): boolean => {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const lc = ip.toLowerCase();
    return lc === "::1" || lc.startsWith("fc") || lc.startsWith("fd") || lc.startsWith("fe80") || lc.startsWith("::ffff:");
  }
  return true; // unknown → block
};

/** https-only, public-IP-only, no-redirect, timed-out POST. */
const safePost = async (url: string, body: string, headers: Record<string, string>): Promise<number> => {
  const u = new URL(url); // throws on garbage → caught by caller
  if (u.protocol !== "https:") throw new Error("webhook must be https");
  const resolved = await lookup(u.hostname, { all: true });
  if (resolved.length === 0 || resolved.some((r) => isBlockedIp(r.address))) {
    throw new Error("webhook host resolves to a blocked address");
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      redirect: "error", // follow ZERO redirects
      signal: ctrl.signal,
    });
    return res.status;
  } finally {
    clearTimeout(t);
  }
};

/** Sign + deliver the order to the merchant's webhook. Fire-and-forget: the caller
 *  does NOT await this — the agent's response never blocks on the merchant's endpoint.
 *  At-least-once with bounded retry; the merchant's catch-up is its own chain read. */
export const fireChargeWebhook = (webhookUrl: string, order: WebhookOrder): void => {
  void (async () => {
    let bodyStr: string;
    let header: Record<string, string>;
    try {
      bodyStr = JSON.stringify(order);
      const { keyId } = chargePublicKey();
      const sig = await signWithChargeKey(new TextEncoder().encode(bodyStr));
      header = { "x-suize-signature": `${keyId}.${sig}`, "x-suize-timestamp": String(order.paidAt) };
    } catch (e) {
      console.error("[charge/webhook] sign failed (order paid, delivery skipped):", (e as Error).message, order.txDigest);
      return;
    }
    // attempt 0 = the first try; 1..N = the backoff retries. A 5xx OR a thrown
    // network/timeout/SSRF-block both retry; only a <500 status is "delivered".
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const status = await safePost(webhookUrl, bodyStr, header);
        if (status < 500) return; // 2xx/3xx/4xx = delivered (a 4xx is the merchant's bug, not ours)
      } catch {
        // network / timeout / SSRF-block — fall through to the backoff
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
    // exhausted ~15 min — money already moved on-chain; the merchant reconciles by chargeRef
    console.error("[charge/webhook] delivery dropped after ~15min of retries:", order.txDigest);
  })();
};
