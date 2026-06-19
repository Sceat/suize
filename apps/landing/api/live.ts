// Vercel Edge function — a same-origin proxy to the LIVE Suize facilitator so the
// deck can prove the rail is up in-browser without a CORS round-trip (the
// facilitator's public x402 surface is meant for server-side agents). Read-only,
// no money moves, and it never surfaces fee/pricing detail.

export const config = { runtime: 'edge' };

const FAC = 'https://api.suize.io';

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
    return reply({ ok: false, error: `unknown probe "${probe}"` }, 400);
  } catch (e) {
    return reply({ ok: false, error: (e as Error).message }, 502);
  }
}
