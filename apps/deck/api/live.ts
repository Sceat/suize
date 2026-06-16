// Vercel Edge function — a same-origin proxy to the LIVE Suize facilitator so the
// deck can render genuine production responses in-browser without a CORS round-trip
// (the facilitator's allow-list is for the wallet origins; its public x402 surface
// is meant for server-side agents). This keeps every "live test" real and self-
// contained in the deck — zero backend change.

export const config = { runtime: 'edge' };

const FAC = 'https://api.suize.io';
// a sample merchant address (the directory payout addr) — used only to show a real
// fee split; this is a READ, no money moves.
const SAMPLE_MERCHANT =
  '0x087aa862ca645c0b94400c49e11b491011fca35db837361ccfc4c6f69d356e86';

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const probe = url.searchParams.get('probe') ?? 'supported';

  try {
    if (probe === 'supported') {
      const r = await fetch(`${FAC}/supported`, { headers: { accept: 'application/json' } });
      return reply({ ok: r.ok, status: r.status, endpoint: 'GET /supported', data: await r.json() });
    }

    if (probe === 'terms') {
      const amount = url.searchParams.get('amount') ?? '1.00';
      const q = new URLSearchParams({ payTo: SAMPLE_MERCHANT, amount });
      const r = await fetch(`${FAC}/terms?${q}`, { headers: { accept: 'application/json' } });
      return reply({
        ok: r.ok,
        status: r.status,
        endpoint: `GET /terms?payTo=…&amount=${amount}`,
        data: await r.json(),
      });
    }

    if (probe === 'challenge') {
      // an unpaid POST to a real merchant endpoint → the real 402 x402 challenge
      const r = await fetch(`${FAC}/deploy`, { method: 'POST', headers: { accept: 'application/json' } });
      return reply({
        ok: r.status === 402,
        status: r.status,
        endpoint: 'POST /deploy (no payment)',
        data: await r.json(),
      });
    }

    return reply({ ok: false, error: `unknown probe "${probe}"` }, 400);
  } catch (e) {
    return reply({ ok: false, error: (e as Error).message }, 502);
  }
}
