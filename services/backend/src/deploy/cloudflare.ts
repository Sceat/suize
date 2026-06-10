// Cloudflare for SaaS (Custom Hostnames) adapter — the SWAPPABLE auto-SSL piece
// (SPEC §6). When CF_API_TOKEN + CF_ZONE_ID are both set, linking a custom domain
// provisions a Cloudflare Custom Hostname (auto-SSL via HTTP/TXT validation);
// otherwise we skip it and return manual-CNAME instructions. NEVER a build
// blocker — the on-chain link + worker resolution work regardless.
//
// OPERATOR REQUIREMENT (auto-SSL): set CF_API_TOKEN (a Cloudflare API token with
// the "SSL and Certificates: Edit" / Custom Hostnames edit scope) + CF_ZONE_ID
// (the zone for the deploy base domain) AND enable Cloudflare-for-SaaS (Custom
// Hostnames) on the account/zone. With all three, linking a custom domain
// auto-provisions SSL (sslStatus → pending → active). WITHOUT them the module runs
// in manual-CNAME mode: the user CNAMEs the domain themselves and terminates SSL on
// their side (sslStatus is reported as "manual"). Either way the on-chain link +
// worker resolution work.
import { config } from "../config";

export type CustomHostnameStatus =
  | { provisioned: true; hostnameId: string; sslStatus: string }
  | { provisioned: false; reason: "not-configured" }
  | { provisioned: false; reason: "error"; detail: string };

/** Whether the CF adapter is configured (both knobs present). */
export const cloudflareEnabled = (): boolean =>
  Boolean(config.cfApiToken) && Boolean(config.cfZoneId);

interface CfResponse {
  success: boolean;
  errors?: Array<{ message?: string }>;
  result?: { id?: string; ssl?: { status?: string } };
}

/**
 * Provision a Custom Hostname for `domain` so Cloudflare terminates SSL for it.
 * No-op (returns not-configured) when the adapter is off. Best-effort: a CF
 * error is reported, NOT thrown — domain linkage already succeeded on-chain, so a
 * failed SSL provision must not fail the whole link (the caller surfaces it).
 */
export const provisionCustomHostname = async (domain: string): Promise<CustomHostnameStatus> => {
  if (!cloudflareEnabled()) return { provisioned: false, reason: "not-configured" };

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${config.cfZoneId}/custom_hostnames`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.cfApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hostname: domain,
          ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    const body = (await res.json().catch(() => null)) as CfResponse | null;
    if (!res.ok || !body?.success) {
      const detail = body?.errors?.map((e) => e.message).filter(Boolean).join("; ") || `HTTP ${res.status}`;
      return { provisioned: false, reason: "error", detail };
    }
    return {
      provisioned: true,
      hostnameId: body.result?.id ?? "",
      sslStatus: body.result?.ssl?.status ?? "pending",
    };
  } catch (err) {
    return { provisioned: false, reason: "error", detail: (err as Error).message };
  }
};

/**
 * Read the current SSL provisioning state of a Custom Hostname by name. Used by the
 * verify response to surface a LIVE `sslStatus` (the POST result can lag — CF returns
 * `pending` initially and flips to `active` once validation lands). Best-effort: a CF
 * error or a missing hostname returns null (the caller falls back to the provision
 * result). Returns CF's raw `ssl.status` string (e.g. `pending`/`active`/`error`...).
 */
export const customHostnameSslStatus = async (domain: string): Promise<string | null> => {
  if (!cloudflareEnabled()) return null;
  try {
    const url = `https://api.cloudflare.com/client/v4/zones/${config.cfZoneId}/custom_hostnames?hostname=${encodeURIComponent(domain)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.cfApiToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as
      | { success?: boolean; result?: Array<{ ssl?: { status?: string } }> }
      | null;
    if (!res.ok || !body?.success) return null;
    return body.result?.[0]?.ssl?.status ?? null;
  } catch {
    return null;
  }
};

/**
 * Remove a Custom Hostname when a domain is unlinked. Best-effort: looks up the
 * hostname id by name, then deletes it. Returns true if removed (or nothing to
 * remove), false on a CF error — the caller treats failure as non-fatal (the
 * on-chain unlink is the source of truth; a dangling CF hostname is harmless).
 */
export const removeCustomHostname = async (domain: string): Promise<boolean> => {
  if (!cloudflareEnabled()) return true;

  try {
    const base = `https://api.cloudflare.com/client/v4/zones/${config.cfZoneId}/custom_hostnames`;
    const listRes = await fetch(`${base}?hostname=${encodeURIComponent(domain)}`, {
      headers: { Authorization: `Bearer ${config.cfApiToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const listBody = (await listRes.json().catch(() => null)) as
      | { success: boolean; result?: Array<{ id?: string }> }
      | null;
    const id = listBody?.result?.[0]?.id;
    if (!listRes.ok || !id) return true; // nothing to remove

    const delRes = await fetch(`${base}/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.cfApiToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    return delRes.ok;
  } catch {
    return false;
  }
};
