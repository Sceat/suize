// POST /domains/assist — "add the records for me" (Vercel-style).
//
// The user pastes a Cloudflare API token scoped to THEIR OWN zone; the worker
// re-derives the SAME challenge facts POST /domains would issue (challengeFacts —
// one home for the txtValue), resolves the zone the token can see, and upserts
// BOTH records grey-cloud (proxied:false, so the 1.1.1.1 DoH verify sees the raw
// CNAME), then fires ONE verify pass. The records land in the user's account; we
// never delegate anything to ourselves.
//
// TOKEN HYGIENE (the load-bearing lines — the lead reviews these):
//   • the token is READ from the request body, shape-checked, and passed ONLY as
//     the `token` arg into cf() where it rides a single Authorization header;
//   • it is NEVER logged, NEVER cached/stored (no cache.put / KV / R2), NEVER
//     echoed back, and NEVER placed in a thrown error — every surfaced CF message
//     is run through scrub(token) first (defence in depth; CF never echoes it);
//   • the whole token lifetime is this one request's stack — nothing outlives it.

import { SUI_ADDRESS_RE } from "@suize/shared";
import { json } from "./http";
import { chargeConfigured, type Env } from "./env";
import { ChainError, readSite } from "./chain";
import { challengeFacts, probeDns, DOMAIN_RE, type ChallengeFacts } from "./domains";

const CF_API = "https://api.cloudflare.com/client/v4";
/** A Cloudflare API token is a URL-safe opaque string; reject anything else
 * before it ever touches a CF call. */
const CF_TOKEN_RE = /^[A-Za-z0-9_-]{20,}$/;
const MAX_BODY_BYTES = 8 * 1024;

// ── the surfaced-error type: a status + a SAFE payload (never carries the token) ─

export class AssistError extends Error {
  constructor(
    public status: number,
    public payload: Record<string, unknown>,
  ) {
    super(String(payload.error ?? "cloudflare error"));
    this.name = "AssistError";
  }
}

/** Remove any echo of the token from a message before it can be surfaced. CF does
 * not echo the Authorization header, but this makes the guarantee mechanical. */
const scrub = (msg: string, token: string): string => (token ? msg.split(token).join("***") : msg);

// ── the Cloudflare client — the ONLY place the token is used ──────────────────

interface CfError {
  code?: number;
  message?: string;
}
interface CfResponse<T> {
  success?: boolean;
  result?: T;
  errors?: CfError[];
}

/** One CF API call. The token rides ONLY the Authorization header here and is
 * never part of the returned value. */
const cf = async <T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: CfResponse<T> }> => {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: CfResponse<T>;
  try {
    body = (await res.json()) as CfResponse<T>;
  } catch {
    body = {};
  }
  return { status: res.status, body };
};

/** Map a failed CF response to an AssistError with a SCRUBBED, token-free payload.
 * A 403 is always the DNS-edit-permission message (never CF's raw text). */
const cfFail = (res: { status: number; body: CfResponse<unknown> }, token: string): AssistError => {
  if (res.status === 403) return new AssistError(403, { error: "token lacks DNS edit permission" });
  const first = res.body.errors?.[0];
  const status = res.status >= 400 && res.status < 500 ? res.status : 502;
  return new AssistError(status, {
    error: scrub(first?.message ?? "Cloudflare rejected the request", token),
    code: first?.code,
  });
};

/** Codes / shapes that mean "a record like this already exists" → upgrade to PATCH
 * rather than fail. (81057/81058 are the documented dup codes; the message regex
 * also catches the CNAME-conflict variants and any status-409.) */
const isDuplicate = (res: { status: number; body: CfResponse<unknown> }): boolean =>
  res.status === 409 ||
  (res.body.errors ?? []).some((e) => e.code === 81057 || e.code === 81058 || /already exists/i.test(e.message ?? ""));

// ── zone resolution: the registrable-domain walk ──────────────────────────────

/** Candidate zone names for `domain`, MOST specific first down to the apex
 * (2-label floor). test.suize.io → [test.suize.io, suize.io]. The token may only
 * see ONE zone, so we query each until one matches. */
export const zoneCandidates = (domain: string): string[] => {
  const labels = domain.split(".").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i + 2 <= labels.length; i++) out.push(labels.slice(i).join("."));
  return out;
};

const resolveZone = async (token: string, domain: string): Promise<{ id: string; name: string } | null> => {
  for (const name of zoneCandidates(domain)) {
    const res = await cf<{ id?: string; name?: string }[]>(token, `/zones?name=${encodeURIComponent(name)}`);
    if (res.status === 403) throw new AssistError(403, { error: "token lacks DNS edit permission" });
    const z = res.body.success ? res.body.result?.[0] : undefined;
    if (z?.id) return { id: z.id, name: z.name ?? name };
  }
  return null;
};

// ── record upsert (create; on dup, list-and-PATCH) ────────────────────────────

interface DnsRecord {
  type: "TXT" | "CNAME";
  name: string;
  content: string;
}
interface RecordOutcome {
  type: string;
  name: string;
  created: boolean;
}

const upsert = async (token: string, zoneId: string, rec: DnsRecord): Promise<RecordOutcome> => {
  const payload = { type: rec.type, name: rec.name, content: rec.content, proxied: false, ttl: 60 };
  const created = await cf<{ id?: string }>(token, `/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (created.body.success) return { type: rec.type, name: rec.name, created: true };
  if (!isDuplicate(created)) throw cfFail(created, token);

  // Already present — find the existing record of this type+name and PATCH it.
  const list = await cf<{ id?: string }[]>(
    token,
    `/zones/${zoneId}/dns_records?type=${rec.type}&name=${encodeURIComponent(rec.name)}`,
  );
  const id = list.body.success ? list.body.result?.[0]?.id : undefined;
  if (!id) throw cfFail(created, token); // couldn't reconcile — surface the original (scrubbed)
  const patched = await cf<{ id?: string }>(token, `/zones/${zoneId}/dns_records/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!patched.body.success) throw cfFail(patched, token);
  return { type: rec.type, name: rec.name, created: false };
};

// ── the token-bearing core (unit-tested directly; readSite/chain not involved) ─

export interface AssistResult {
  zone: string;
  recordsCreated: RecordOutcome[];
}

/** Resolve the zone + upsert BOTH records. This is the entire lifetime of the
 * token: it enters here, is used in the CF calls, and is gone when this returns.
 * Throws AssistError (payload always token-free). */
export const assistRecords = async (
  cfToken: string,
  domain: string,
  facts: ChallengeFacts,
): Promise<AssistResult> => {
  const zone = await resolveZone(cfToken, domain);
  if (!zone) {
    throw new AssistError(404, {
      error: `no Cloudflare zone found for ${domain} with this token; check the token's zone scope`,
    });
  }
  const recordsCreated: RecordOutcome[] = [];
  recordsCreated.push(await upsert(cfToken, zone.id, { type: "TXT", name: facts.txtName, content: facts.txtValue }));
  recordsCreated.push(await upsert(cfToken, zone.id, { type: "CNAME", name: domain, content: facts.cname }));
  return { zone: zone.name, recordsCreated };
};

// ── the request body reader (size-bounded) ────────────────────────────────────

const readBody = async (req: Request): Promise<Record<string, unknown> | null> => {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return null;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return null;
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return null;
  }
};

// ── POST /domains/assist ──────────────────────────────────────────────────────

export const handleDnsAssist = async (req: Request, env: Env): Promise<Response> => {
  if (!chargeConfigured(env)) return json({ error: "domains not configured" }, 503);

  const body = await readBody(req);
  if (!body) return json({ error: "invalid or oversized body" }, 400);

  const siteId = String(body.siteId ?? "").trim();
  const domain = String(body.domain ?? "")
    .trim()
    .toLowerCase();
  const cfToken = String(body.cfToken ?? "").trim();

  // Mirror /domains' validation responses for siteId/domain.
  if (!SUI_ADDRESS_RE.test(siteId)) return json({ error: "invalid siteId" }, 400);
  if (!DOMAIN_RE.test(domain)) return json({ error: "invalid domain" }, 400);
  // Shape-check the token BEFORE any CF call — a malformed token never leaves here.
  if (!CF_TOKEN_RE.test(cfToken)) return json({ error: "invalid Cloudflare token" }, 400);

  const site = await readSite(env, siteId);
  if (!site) return json({ error: "site not found" }, 404);

  const facts = await challengeFacts(env, siteId, domain);

  try {
    const { zone, recordsCreated } = await assistRecords(cfToken, domain, facts);
    const check = await probeDns(domain, facts.txtValue, facts.cname);
    return json({
      status: "records-added",
      zone,
      recordsCreated,
      txtName: facts.txtName,
      txtValue: facts.txtValue,
      cname: facts.cname,
      txtOk: check.txtOk,
      cnameOk: check.cnameOk,
    });
  } catch (err) {
    if (err instanceof AssistError) return json(err.payload, err.status);
    if (err instanceof ChainError) return json({ error: err.message }, err.status);
    // Last-resort: log a scrubbed message (a stray network error can't carry the
    // token, but scrub anyway) and surface a plain, token-free line.
    console.error("[domains/assist]", scrub((err as Error).message ?? "unknown", cfToken));
    return json({ error: "could not add the records; add them manually, then verify" }, 502);
  }
};
