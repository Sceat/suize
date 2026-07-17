// Custom domains — the $19.99/year unlock, payment-authenticated.
//
//   POST   /domains              → { siteId, domain }: the DNS challenge (free).
//   POST   /domains?verify=1     → DNS verified? then 402 → pay → link on-chain.
//   DELETE /domains/<domain>     → owner-signed unlink (free — the ONE surviving
//                                  personal-message auth: there is no payment to
//                                  recover an identity from, and an open unlink
//                                  would be domain-griefing).
//
// LINK AUTH = THE PAYMENT: the recovered payer must equal Site.owner (a DNS
// holder alone cannot bind their domain to a site they don't own; a payer alone
// cannot link a domain they don't control — TXT + CNAME prove DNS control).
// The quote embeds `extra.suize = { op, domain, siteId }`, and the gate compares
// it — so a settled link payment can never be replayed to link a DIFFERENT
// domain/site (there is no on-chain digest registry for domains; the terms
// binding is the replay wall).
//
// DNS reads run over DNS-over-HTTPS (Cloudflare resolver) — workerd has no
// node:dns. The domain → site mapping lives in the DomainRegistry's
// `domains: Table<String, ID>`, whose entries hang off the TABLE'S OWN UID —
// NOT the registry object id (the T-011 confirmed bug; fixed here by resolving
// the inner UID once and caching it).

import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { bcs } from "@mysten/sui/bcs";
import {
  buildDeployUnlinkAuthMessage,
  buildDeployRepointAuthMessage,
  DOMAIN_PRICE_PER_YEAR_USDC,
  SUI_ADDRESS_RE,
} from "@suize/shared";
import { Transaction } from "@mysten/sui/transactions";
import { chargeConfigured, type Env } from "./env";
import { json, b64json } from "./http";
import { sha256Hex, suiGraphql, encodeObjectIdToBase36 } from "./util";
import { ChainError, deployIds, executeWithRetry, readSite, serviceAddress, suiClient } from "./chain";
import { fetchPolicy, gatePayment, settlePayment, quoteRequirements, mint402, PaymentError } from "./payment";
import type { PaymentRequirements } from "@suize/pay";

export const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** ±60 min freshness for the unlink signature (stateless, no nonce store). */
const AUTH_TS_WINDOW_MS = 60 * 60 * 1000;

// ── the DNS challenge (deterministic + keyless — any replica re-derives it) ───

export const txtName = (domain: string): string => `_suize-verify.${domain}`;

export const dnsToken = async (siteId: string, domain: string): Promise<string> =>
  sha256Hex(new TextEncoder().encode(`suize-deploy-dns:${siteId}:${domain.toLowerCase()}`));

// ── DNS-over-HTTPS reads ──────────────────────────────────────────────────────

interface DohAnswer {
  name?: string;
  type?: number;
  data?: string;
}

const dohQuery = async (name: string, type: "TXT" | "CNAME" | "A"): Promise<DohAnswer[]> => {
  const res = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    { headers: { accept: "application/dns-json" } },
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { Answer?: DohAnswer[] };
  return body.Answer ?? [];
};

const sameHost = (a: string, b: string): boolean =>
  a.replace(/\.$/, "").toLowerCase() === b.replace(/\.$/, "").toLowerCase();

/** The ownership TXT is present and carries the challenge token. */
const txtMatches = async (domain: string, token: string): Promise<boolean> => {
  const answers = await dohQuery(txtName(domain), "TXT");
  return answers.some((a) => {
    // TXT data comes quoted (possibly in chunks): "abc" "def" → abcdef
    const flat = (a.data ?? "").replace(/"\s+"/g, "").replace(/^"|"$/g, "");
    return flat === token;
  });
};

/** The domain routes to us: a CNAME to the target, the A-query's answer CHAIN
 * contains the target host (apex/ALIAS-flattened), or the domain and target share
 * at least one resolved IP (flattened-and-proxied apex, no visible chain). */
const cnameRoutesToUs = async (domain: string, expectedTarget: string): Promise<boolean> => {
  const cnames = await dohQuery(domain, "CNAME");
  if (cnames.some((a) => a.data && sameHost(a.data, expectedTarget))) return true;
  const chain = await dohQuery(domain, "A"); // the resolver surfaces the CNAME chain here
  if (chain.some((a) => a.type === 5 && a.data && sameHost(a.data, expectedTarget))) return true;
  // Zone-apex domains cannot hold a CNAME (DNS forbids it), so providers flatten it
  // to synthesized A records; when the target is itself proxied (our *.suize.site
  // wildcard is), the answer is edge A records with NO type-5 chain to match above.
  // Those A records are synthesized FROM the target, so a non-empty IP overlap with
  // the target's own A set proves the domain points at the target (exact for
  // DNS-only targets; for proxied targets both sides synthesize from the same zone
  // edge). This is a routing check only — the authenticity proof stays the TXT token.
  const targetAs = await dohQuery(expectedTarget, "A");
  const targetIps = new Set(targetAs.filter((a) => a.type === 1 && a.data).map((a) => a.data));
  return chain.some((a) => a.type === 1 && a.data && targetIps.has(a.data));
};

// ── the challenge facts + one verify pass (the SINGLE home both endpoints share) ─

export interface ChallengeFacts {
  txtName: string;
  txtValue: string;
  cname: string;
}

/** The deterministic DNS challenge for {siteId, domain}. The txtValue derivation
 * lives HERE only — /domains and /domains/assist both re-derive the identical
 * facts from this one function (never a second copy of the hash formula). */
export const challengeFacts = async (env: Env, siteId: string, domain: string): Promise<ChallengeFacts> => ({
  txtName: txtName(domain),
  txtValue: await dnsToken(siteId, domain),
  cname: `${encodeObjectIdToBase36(siteId)}.${(env.BASE_DOMAIN || "suize.site").toLowerCase()}`,
});

/** One DNS verify pass over the live resolver — exactly what POST /domains?verify=1
 * runs (TXT carries the token AND the CNAME routes to us). */
export const probeDns = async (
  domain: string,
  txtValue: string,
  cname: string,
): Promise<{ txtOk: boolean; cnameOk: boolean }> => {
  const [txtOk, cnameOk] = await Promise.all([txtMatches(domain, txtValue), cnameRoutesToUs(domain, cname)]);
  return { txtOk, cnameOk };
};

// ── the domains Table's INNER UID (the T-011 bug fix) ─────────────────────────

let _tableUid: { value: string; registry: string } | null = null;

/** The UID the registry's `Table<String, ID>` entries actually hang off. */
export const domainsTableUid = async (graphqlUrl: string, registryId: string): Promise<string | null> => {
  if (_tableUid && _tableUid.registry === registryId) return _tableUid.value;
  try {
    const data = await suiGraphql<{
      object?: { asMoveObject?: { contents?: { json?: Record<string, unknown> } | null } | null } | null;
    }>(graphqlUrl, `query($id: SuiAddress!) { object(address: $id) { asMoveObject { contents { json } } } }`, {
      id: registryId,
    });
    const domains = data?.object?.asMoveObject?.contents?.json?.domains as
      | { id?: string }
      | undefined;
    const uid = typeof domains?.id === "string" ? domains.id : null;
    if (uid) _tableUid = { value: uid, registry: registryId };
    return uid;
  } catch {
    return null;
  }
};

// ── domain → site resolution with a stale-read-proof fallback ladder ──────────
//
// The serve path 404s a domain the moment `siteForDomain` returns null, so ONE
// stale/failing fullnode replica must never sink a domain that is linked + paid.
// (Live incident: `fullnode.mainnet.sui.io` served reads up to an hour stale for
// days, intermittently 404ing suize.io itself.) The ladder:
//   1. primary   — the live gRPC dynamic-field read (as before). Hit ⇒ return +
//                  persist last-known-good.
//   2. fallback  — a plain JSON-RPC `suix_getDynamicFieldObject` against a SECOND,
//                  independent fullnode; a regional gRPC replica blinking can't
//                  404 a paid domain when another endpoint still sees it.
//   3. last-good — both live sources null but we resolved this domain before ⇒
//                  serve the persisted mapping (stale beats a 404 for a PAID
//                  domain). A genuinely unlinked domain was NEVER persisted, so it
//                  still falls through to null (a true miss must keep 404ing —
//                  we never immortalise an unlinked domain).
// Newest live read wins on persist, so a repoint's fresh siteId supersedes the
// old and generation flapping self-heals.

/** A second, independent public fullnode for the JSON-RPC fallback read. */
const FALLBACK_JSON_RPC_URL = "https://sui-rpc.publicnode.com";

/** last-known-good TTL — 7 days; long enough to ride out a multi-day RPC brownout. */
const LKG_MAX_AGE_SECONDS = 604800;

/** Synthetic cache key for a domain's last-known-good mapping. */
const lkgKey = (domain: string): string => `https://suize-domain-cache.internal/${encodeURIComponent(domain)}`;

/** The Workers Cache, or null when the runtime provides none (older/dev/test envs).
 * Persistence is best-effort: a missing Cache API degrades to no-last-known-good,
 * never a throw. */
const domainCache = (): Cache | null => {
  try {
    return (globalThis as { caches?: CacheStorage }).caches?.default ?? null;
  } catch {
    return null;
  }
};

/** The last-known-good siteId for a domain, or null (no prior resolution / no Cache). */
const readLastKnownGood = async (domain: string): Promise<string | null> => {
  const cache = domainCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(new Request(lkgKey(domain)));
    if (!hit) return null;
    const { siteId } = (await hit.json()) as { siteId?: string };
    return typeof siteId === "string" && siteId.length > 0 ? siteId : null;
  } catch {
    return null;
  }
};

/** Persist a freshly-resolved mapping (newest-siteId-wins). Only rewrites when the
 * mapping is new or the siteId changed, so a repoint's newer generation supersedes
 * the old one and never moves backward. Best-effort: any failure is swallowed. */
const persistLastKnownGood = async (domain: string, siteId: string): Promise<void> => {
  const cache = domainCache();
  if (!cache) return;
  try {
    if ((await readLastKnownGood(domain)) === siteId) return;
    await cache.put(
      new Request(lkgKey(domain)),
      new Response(JSON.stringify({ siteId, ts: Date.now() }), {
        headers: { "Cache-Control": `max-age=${LKG_MAX_AGE_SECONDS}` },
      }),
    );
  } catch {
    /* persistence is best-effort — a Cache fault must never break resolution */
  }
};

/** Primary read: the live gRPC dynamic-field lookup under the INNER table UID.
 * Returns the linked siteId, or null on a genuine miss OR any read fault (the
 * fallback ladder rescues a fault; a genuine miss stays null). */
const siteForDomainViaGrpc = async (env: Env, parent: string, domain: string): Promise<string | null> => {
  try {
    const field = await suiClient(env).getDynamicField({
      parentId: parent,
      name: { type: "0x1::string::String", bcs: bcs.string().serialize(domain).toBytes() },
    });
    const valueBcs = field.dynamicField?.value?.bcs;
    if (valueBcs && valueBcs.length > 0) return bcs.Address.parse(valueBcs);
  } catch {
    /* stale/unlinked/errored — the ladder decides, never a throw */
  }
  return null;
};

/** Fallback read: one JSON-RPC `suix_getDynamicFieldObject` against a second
 * fullnode, parsing `result.data.content.fields.value` (the linked 0x id). 5s
 * budget; ANY error/empty ⇒ null (a fault here just advances the ladder). */
const siteForDomainViaJsonRpc = async (innerTableUid: string, domain: string): Promise<string | null> => {
  try {
    const res = await fetch(FALLBACK_JSON_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "suix_getDynamicFieldObject",
        params: [innerTableUid, { type: "0x1::string::String", value: domain }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      result?: { data?: { content?: { fields?: { value?: unknown } } | null } | null } | null;
    };
    const value = body.result?.data?.content?.fields?.value;
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
};

/** Which site a domain points at — stale-read-proof (see the ladder note above). */
export const siteForDomain = async (env: Env, domain: string): Promise<string | null> => {
  const registry = deployIds(env).DOMAIN_REGISTRY_OBJECT;
  if (registry === "0x0") return null;
  const parent = await domainsTableUid(env.SUI_GRAPHQL_URL, registry);
  if (!parent) return null;

  // 1) Primary live read (gRPC).
  const primary = await siteForDomainViaGrpc(env, parent, domain);
  if (primary) {
    await persistLastKnownGood(domain, primary);
    return primary;
  }

  // 2) Fallback live read (independent JSON-RPC fullnode).
  const fallback = await siteForDomainViaJsonRpc(parent, domain);
  if (fallback) {
    await persistLastKnownGood(domain, fallback);
    return fallback;
  }

  // 3) Both live sources null → last-known-good (never written for a true miss).
  return await readLastKnownGood(domain);
};

// ── on-chain link / unlink (service wallet signs; SiteAdminCap-gated) ─────────

const findAdminCapForSite = async (env: Env, siteId: string): Promise<string | null> => {
  const capType = `${deployIds(env).PACKAGE}::site::SiteAdminCap`;
  // Extracted so the loop-reassigned cursor doesn't feed back into the generic
  // inference (TS7022) — the param type is fixed here, independent of the loop.
  const capPage = (c: string | null) =>
    suiClient(env).listOwnedObjects({
      owner: serviceAddress(env),
      type: capType,
      include: { json: true },
      cursor: c,
    });
  try {
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const owned = await capPage(cursor);
      for (const o of owned.objects) {
        if ((o.json as Record<string, unknown> | null | undefined)?.site_id === siteId) {
          return o.objectId;
        }
      }
      if (!owned.hasNextPage) break;
      cursor = owned.cursor;
    }
  } catch (err) {
    console.error("[domains] admin-cap scan failed:", (err as Error).message);
  }
  return null;
};

// link/unlink go through executeWithRetry (chain.ts) so a transient SiteAdminCap
// or gas version conflict self-heals — a settled $19.99 link must not strand on a
// contention race (correctness hat F1). The cap is re-found inside build() each
// attempt so a rebuild picks up its fresh version too.
const linkOnChain = async (env: Env, siteId: string, domain: string): Promise<string> => {
  const cap = await findAdminCapForSite(env, siteId);
  if (!cap) throw new ChainError("SiteAdminCap not found for site (cannot link)", 409);
  const ids = deployIds(env);
  const exec = await executeWithRetry(
    env,
    () => {
      const tx = new Transaction();
      tx.moveCall({
        target: ids.TARGETS.LINK_DOMAIN,
        arguments: [
          tx.object(ids.VERSION_OBJECT),
          tx.object(ids.DOMAIN_REGISTRY_OBJECT),
          tx.object(cap),
          tx.object(siteId),
          tx.pure.string(domain),
        ],
      });
      return tx;
    },
    "link_domain",
  );
  return exec.digest;
};

const unlinkOnChain = async (env: Env, siteId: string, domain: string): Promise<string> => {
  const cap = await findAdminCapForSite(env, siteId);
  if (!cap) throw new ChainError("SiteAdminCap not found for linked site", 409);
  const ids = deployIds(env);
  const exec = await executeWithRetry(
    env,
    () => {
      const tx = new Transaction();
      tx.moveCall({
        target: ids.TARGETS.UNLINK_DOMAIN,
        arguments: [
          tx.object(ids.VERSION_OBJECT),
          tx.object(ids.DOMAIN_REGISTRY_OBJECT),
          tx.object(cap),
          tx.pure.string(domain),
        ],
      });
      return tx;
    },
    "unlink_domain",
  );
  return exec.digest;
};

// Re-point a paid domain from `oldSiteId` to `newSiteId` in ONE atomic PTB:
// unlink (old cap) THEN link (new cap). The service wallet holds BOTH sites'
// SiteAdminCaps; if either is missing we fail cleanly (500) and — because it is
// one PTB — nothing partially applies. No charge: the yearly reservation is
// already paid, so this is a free move within it (mirrors unlink's freeness).
const repointOnChain = async (
  env: Env,
  oldSiteId: string,
  newSiteId: string,
  domain: string,
): Promise<string> => {
  const oldCap = await findAdminCapForSite(env, oldSiteId);
  if (!oldCap) throw new ChainError("SiteAdminCap not found for the domain's current site (cannot repoint)", 500);
  const newCap = await findAdminCapForSite(env, newSiteId);
  if (!newCap) throw new ChainError("SiteAdminCap not found for the target site (cannot repoint)", 500);
  const ids = deployIds(env);
  const exec = await executeWithRetry(
    env,
    () => {
      const tx = new Transaction();
      tx.moveCall({
        target: ids.TARGETS.UNLINK_DOMAIN,
        arguments: [
          tx.object(ids.VERSION_OBJECT),
          tx.object(ids.DOMAIN_REGISTRY_OBJECT),
          tx.object(oldCap),
          tx.pure.string(domain),
        ],
      });
      tx.moveCall({
        target: ids.TARGETS.LINK_DOMAIN,
        arguments: [
          tx.object(ids.VERSION_OBJECT),
          tx.object(ids.DOMAIN_REGISTRY_OBJECT),
          tx.object(newCap),
          tx.object(newSiteId),
          tx.pure.string(domain),
        ],
      });
      return tx;
    },
    "repoint_domain",
  );
  return exec.digest;
};

// ── Cloudflare-for-SaaS auto-SSL (optional; "manual" without the token) ───────

const cfEnabled = (env: Env): boolean => Boolean(env.CF_API_TOKEN && env.CF_ZONE_ID);

/** The one-home manual-DNS SSL note — shown whenever SSL is NOT auto-provisioned
 * (CF disabled or a provisioning failure): the site still serves via the on-chain
 * link; only the cert is the user's DNS provider's job. */
const manualSslNote = (domain: string, cname: string): string =>
  `Keep the CNAME ${domain} -> ${cname}; SSL is handled by your DNS provider.`;

/** Collapse a Cloudflare custom-hostname SSL status to the @suize/shared wire
 * values ('active' | 'pending'); anything not yet issued reads as pending. */
const cfSslState = (status: string | undefined): string => (status === "active" ? "active" : "pending");

/** CF signals an EXISTING hostname with a duplicate error — LIVE-observed shape is
 * `{code:1406, message:"Duplicate custom hostname found."}` (also 1407, or a text
 * "already/exists"). This is NOT a failure: the hostname is already provisioned. */
const isDuplicateHostname = (errors?: { code?: number; message?: string }[]): boolean =>
  Boolean(errors?.some((e) => e.code === 1406 || e.code === 1407 || /already|exist|duplicate/i.test(e.message ?? "")));

/** The TRUE SSL state of an already-existing custom hostname (the list endpoint),
 * so a re-provision of a linked domain reports its real status instead of flapping
 * to a flat pending/error on every retry. */
const existingHostnameSsl = async (env: Env, domain: string): Promise<string> => {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/custom_hostnames?hostname=${encodeURIComponent(domain)}`,
    { headers: { authorization: `Bearer ${env.CF_API_TOKEN}` } },
  );
  const body = (await res.json()) as { result?: { ssl?: { status?: string } }[] };
  return cfSslState(body.result?.[0]?.ssl?.status);
};

const provisionCustomHostname = async (env: Env, domain: string): Promise<string> => {
  if (!cfEnabled(env)) return "manual";
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/custom_hostnames`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.CF_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ hostname: domain, ssl: { method: "http", type: "dv" } }),
      },
    );
    const body = (await res.json()) as {
      success?: boolean;
      result?: { ssl?: { status?: string } };
      errors?: { code?: number; message?: string }[];
    };
    if (res.ok) return cfSslState(body.result?.ssl?.status);
    // Already exists (duplicate) — read its TRUE current SSL state; the cert
    // converges. Only a NON-duplicate error is a real provisioning failure.
    if (isDuplicateHostname(body.errors)) return await existingHostnameSsl(env, domain);
    console.error("[domains] CF custom-hostname failed:", JSON.stringify(body.errors ?? []));
    return "error";
  } catch (err) {
    console.error("[domains] CF custom-hostname failed:", (err as Error).message);
    return "error";
  }
};

/** The SSL augmentation for an ALREADY-LINKED response. When CF-for-SaaS is
 * configured, ensure the custom hostname exists (idempotent — a duplicate is read
 * as pending; see provisionCustomHostname) and surface its state; when it is NOT
 * configured, return {} so the response is byte-for-byte the pre-CF `linked` body.
 * A provisioning FAILURE never breaks the on-chain-linked truth: it degrades to
 * `sslStatus:"manual"` (+ the manual-DNS note) and the caller still returns 200.
 * This is what repairs a domain paid + linked while CF creds were absent — a free
 * `verify=1` re-run now provisions the SSL it could not at link time. */
export const linkedSslFields = async (
  env: Env,
  domain: string,
  cname: string,
): Promise<{ sslStatus?: string; instructions?: string }> => {
  if (!cfEnabled(env)) return {};
  let raw: string;
  try {
    raw = await provisionCustomHostname(env, domain);
  } catch {
    raw = "error";
  }
  const sslStatus = raw === "error" ? "manual" : raw;
  return {
    sslStatus,
    ...(sslStatus === "manual" ? { instructions: manualSslNote(domain, cname) } : {}),
  };
};

const removeCustomHostname = async (env: Env, domain: string): Promise<boolean> => {
  if (!cfEnabled(env)) return false;
  try {
    const list = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/custom_hostnames?hostname=${encodeURIComponent(domain)}`,
      { headers: { authorization: `Bearer ${env.CF_API_TOKEN}` } },
    );
    const body = (await list.json()) as { result?: { id?: string }[] };
    const id = body.result?.[0]?.id;
    if (!id) return false;
    const del = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/custom_hostnames/${id}`,
      { method: "DELETE", headers: { authorization: `Bearer ${env.CF_API_TOKEN}` } },
    );
    return del.ok;
  } catch {
    return false;
  }
};

// ── POST /domains ─────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 8 * 1024;

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

export const handleDomains = async (req: Request, env: Env): Promise<Response> => {
  if (!chargeConfigured(env)) return json({ error: "domains not configured" }, 503);

  const url = new URL(req.url);
  const body = await readBody(req);
  if (!body) return json({ error: "invalid or oversized body" }, 400);

  const siteId = String(body.siteId ?? "").trim();
  const domain = String(body.domain ?? "")
    .trim()
    .toLowerCase();
  const verify = url.searchParams.get("verify") === "1" || body.verify === true;

  if (!SUI_ADDRESS_RE.test(siteId)) return json({ error: "invalid siteId" }, 400);
  if (!DOMAIN_RE.test(domain)) return json({ error: "invalid domain" }, 400);

  const site = await readSite(env, siteId);
  if (!site) return json({ error: "site not found" }, 404);

  const { txtValue: token, cname } = await challengeFacts(env, siteId, domain);
  const pending = (detail: string, txtOk: boolean, cnameOk: boolean): Response =>
    json({ domain, status: "pending", txtName: txtName(domain), txtValue: token, cname, txtOk, cnameOk, detail });

  // ── challenge issue (free) ──────────────────────────────────────────────────
  if (!verify) {
    return json({ domain, status: "pending", txtName: txtName(domain), txtValue: token, cname });
  }

  // ── verify: DNS FIRST (free), payment only once the records are green ──────
  const { txtOk, cnameOk } = await probeDns(domain, token, cname);
  if (!txtOk || !cnameOk) {
    const detail = [
      txtOk ? "" : `TXT ${txtName(domain)} missing or not matching yet`,
      cnameOk ? "" : `CNAME ${domain} -> ${cname} not visible yet (for a zone apex, flattened A records pointing at ${cname} are accepted too)`,
    ]
      .filter(Boolean)
      .join("; ");
    return pending(detail, txtOk, cnameOk);
  }

  // Already linked to this site? Idempotent success, no second charge — but still
  // ensure (and surface) auto-SSL, so a domain that was linked while CF creds were
  // absent gets repaired by this same FREE re-verify (never a broken 522).
  const current = await siteForDomain(env, domain);
  if (current === siteId) {
    const ssl = await linkedSslFields(env, domain, cname);
    return json({ domain, status: "linked", txtName: txtName(domain), txtValue: token, cname, txtOk, cnameOk, ...ssl });
  }

  const amount = BigInt(DOMAIN_PRICE_PER_YEAR_USDC);
  const rider =
    `Suize: link ${domain} to site ${siteId} — one year of custom-domain service. ` +
    `The payment must be signed by the site owner. Retry the same request with the X-PAYMENT header.`;

  // The quote is BOUND to this exact op: the terms carry { op, domain, siteId }
  // and the gate compares them — a settled link payment cannot be replayed for a
  // different domain or site.
  const boundQuote = async (): Promise<PaymentRequirements> => {
    const policy = await fetchPolicy(env);
    const { requirements } = quoteRequirements(env, policy, amount, req.url);
    return {
      ...requirements,
      extra: { ...requirements.extra, suize: { op: "link-domain", domain, siteId } },
    };
  };
  const challenge402 = async (errorOverride?: string): Promise<Response> => {
    const policy = await fetchPolicy(env);
    const minted = mint402(env, policy, amount, req.url, rider);
    const bound = {
      ...minted,
      accepts: [
        {
          ...minted.accepts[0],
          extra: { ...minted.accepts[0].extra, suize: { op: "link-domain", domain, siteId } },
        },
      ],
    };
    if (errorOverride) bound.error = errorOverride;
    return json(bound, 402, { "PAYMENT-REQUIRED": b64json(bound) });
  };

  const payHeader = (req.headers.get("X-PAYMENT") ?? req.headers.get("PAYMENT-SIGNATURE") ?? "").trim();

  try {
    if (!payHeader) return await challenge402();

    const verified = await gatePayment(env, payHeader, await boundQuote());
    if (verified.payer !== site.owner) {
      return await challenge402("the payment must be signed by the site owner to link a domain");
    }

    await settlePayment(env, verified);
    // Re-check between settle and link: a concurrent same-owner link (or the
    // recovery retry of a settled payment) may already point the domain here —
    // return idempotent success instead of aborting EDomainTaken on a re-link.
    if ((await siteForDomain(env, domain)) === siteId) {
      return json({ domain, status: "linked", txtName: txtName(domain), txtValue: token, cname, txtOk: true, cnameOk: true });
    }
    const digest = await linkOnChain(env, siteId, domain);
    const sslStatus = await provisionCustomHostname(env, domain);

    return json({
      domain,
      status: "linked",
      txtName: txtName(domain),
      txtValue: token,
      cname,
      txtOk: true,
      cnameOk: true,
      sslStatus,
      digest,
      ...(sslStatus === "manual" ? { instructions: manualSslNote(domain, cname) } : {}),
    });
  } catch (err) {
    if (err instanceof PaymentError) {
      if (err.challenge) {
        try {
          return await challenge402(err.message);
        } catch {
          /* fall through */
        }
      }
      return json({ error: err.message }, err.status);
    }
    if (err instanceof ChainError) return json({ error: err.message }, err.status);
    console.error("[domains]", (err as Error).message);
    return json({ error: "domain link failed" }, 500);
  }
};

// ── DELETE /domains/<domain> — owner-signed unlink (free) ─────────────────────

export const handleUnlink = async (req: Request, env: Env, domain: string): Promise<Response> => {
  if (!chargeConfigured(env)) return json({ error: "domains not configured" }, 503);

  const d = domain.trim().toLowerCase();
  if (!DOMAIN_RE.test(d)) return json({ error: "invalid domain" }, 400);

  const siteId = await siteForDomain(env, d);
  if (!siteId) return json({ error: "domain not linked" }, 404);

  const body = await readBody(req);
  if (!body) return json({ error: "invalid or oversized body" }, 400);
  const ts = typeof body.ts === "number" ? body.ts : Number(body.ts);
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  if (!Number.isFinite(ts) || !signature) return json({ error: "ts and signature required" }, 403);
  if (Math.abs(Date.now() - ts) > AUTH_TS_WINDOW_MS) {
    return json({ error: "stale or skewed timestamp — re-sign with a fresh ts" }, 403);
  }

  let recovered: string;
  try {
    const pk = await verifyPersonalMessageSignature(
      new TextEncoder().encode(buildDeployUnlinkAuthMessage(d, ts)),
      signature,
      { client: suiClient(env) as never },
    );
    recovered = pk.toSuiAddress().toLowerCase();
  } catch {
    return json({ error: "invalid signature" }, 403);
  }

  const site = await readSite(env, siteId);
  if (!site) return json({ error: "site owner unreadable; cannot authorize" }, 403);
  if (recovered !== site.owner) return json({ error: "signer is not the site owner" }, 403);

  try {
    const digest = await unlinkOnChain(env, siteId, d);
    const cfRemoved = await removeCustomHostname(env, d);
    return json({ status: "unlinked", domain: d, digest, cfRemoved });
  } catch (err) {
    if (err instanceof ChainError) return json({ error: err.message }, err.status);
    console.error("[domains/unlink]", (err as Error).message);
    return json({ error: "unlink failed" }, 500);
  }
};

// ── POST /domains/repoint — owner-signed move to another owned site (free) ────
//
// Move an already-paid custom domain from the site it points at now onto ANOTHER
// site the same owner controls, WITHOUT re-paying the yearly reservation. The
// AUTH is the whole point (three checks, all on-chain-read ground truth):
//   1. the domain MUST currently be linked  → its current siteId.
//   2. the signer (recovered from the repoint personal-message) MUST equal the
//      owner of the CURRENTLY-linked site — proving control of the domain.
//   3. the signer MUST ALSO equal the owner of `newSiteId` — you can only move a
//      domain onto a site you own.
// A settled x402 payment is NEVER involved (unlike link): the reservation is
// already paid. The CF custom hostname is unaffected (it still points at this
// worker); only the on-chain domain→siteId mapping changes, and the serving path
// resolves it fresh, so the new content serves after the short domain cache TTL.

export const handleRepoint = async (req: Request, env: Env): Promise<Response> => {
  if (!chargeConfigured(env)) return json({ error: "domains not configured" }, 503);

  const body = await readBody(req);
  if (!body) return json({ error: "invalid or oversized body" }, 400);

  const domain = String(body.domain ?? "")
    .trim()
    .toLowerCase();
  const newSiteId = String(body.newSiteId ?? "").trim();
  const ts = typeof body.ts === "number" ? body.ts : Number(body.ts);
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";

  if (!DOMAIN_RE.test(domain)) return json({ error: "invalid domain" }, 400);
  if (!SUI_ADDRESS_RE.test(newSiteId)) return json({ error: "invalid newSiteId" }, 400);
  if (!Number.isFinite(ts) || !signature) return json({ error: "ts and signature required" }, 403);
  if (Math.abs(Date.now() - ts) > AUTH_TS_WINDOW_MS) {
    return json({ error: "stale or skewed timestamp — re-sign with a fresh ts" }, 403);
  }

  // (1) the domain must currently be linked → resolve its current site.
  const currentSiteId = await siteForDomain(env, domain);
  if (!currentSiteId) return json({ error: "domain not linked" }, 404);

  // No-op: already points at newSiteId. Idempotent success, no on-chain write
  // (the mapping is public on-chain anyway, so no auth is needed to confirm it).
  if (currentSiteId.toLowerCase() === newSiteId.toLowerCase()) {
    return json({ domain, siteId: newSiteId, previousSiteId: newSiteId, digest: null });
  }

  // Recover the signer from the repoint signature (byte-for-byte the shared
  // builder; Ed25519/zkLogin both verify via verifyPersonalMessageSignature).
  let recovered: string;
  try {
    const pk = await verifyPersonalMessageSignature(
      new TextEncoder().encode(buildDeployRepointAuthMessage(domain, newSiteId, ts)),
      signature,
      { client: suiClient(env) as never },
    );
    recovered = pk.toSuiAddress().toLowerCase();
  } catch {
    return json({ error: "invalid signature" }, 403);
  }

  // (2) the signer must own the CURRENTLY-linked site (proves domain control).
  const current = await readSite(env, currentSiteId);
  if (!current) return json({ error: "current site owner unreadable; cannot authorize" }, 403);
  if (recovered !== current.owner) {
    return json({ error: "signer is not the owner of the domain's current site" }, 403);
  }

  // (3) the signer must ALSO own newSiteId — and it must be a real Site of this
  // network's deploy package (readSite type-asserts, returning null otherwise).
  const target = await readSite(env, newSiteId);
  if (!target) return json({ error: "target site not found" }, 404);
  if (recovered !== target.owner) {
    return json({ error: "signer is not the owner of the target site" }, 403);
  }

  try {
    const digest = await repointOnChain(env, currentSiteId, newSiteId, domain);
    return json({ domain, siteId: newSiteId, previousSiteId: currentSiteId, digest });
  } catch (err) {
    if (err instanceof ChainError) return json({ error: err.message }, err.status);
    console.error("[domains/repoint]", (err as Error).message);
    return json({ error: "repoint failed" }, 500);
  }
};
