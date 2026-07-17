// JSON + CORS helpers for the charge API (mirrors the facilitator's http.ts —
// agents and the suize.io dashboard both call these endpoints cross-origin).

export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT, PAYMENT-SIGNATURE",
  "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, X-PAYMENT-RESPONSE",
};

export const json = (
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extra },
  });

export const preflight = (): Response => new Response(null, { status: 204, headers: CORS });

/** Base64 of a JSON body — the PAYMENT-REQUIRED header value. */
export const b64json = (body: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};
