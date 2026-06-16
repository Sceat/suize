/**
 * unfurlSite — pull a website's OpenGraph/meta (title · description · image) for the
 * Business Profile form. The browser can't read another origin's <head> (CORS), so
 * the backend does it (GET /unfurl, SSRF-guarded). Best-effort: any failure → null,
 * and the form simply keeps whatever's there. A bare domain is assumed https.
 */
import { API_BASE } from '../lib/env';

export interface SiteMeta {
  title: string;
  description: string;
  image: string;
}

export async function unfurlSite(website: string, signal?: AbortSignal): Promise<SiteMeta | null> {
  const raw = website.trim();
  if (!raw || /\s/.test(raw)) return null;
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const res = await fetch(`${API_BASE}/unfurl?url=${encodeURIComponent(url)}`, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<SiteMeta>;
    return {
      title: typeof body.title === 'string' ? body.title : '',
      description: typeof body.description === 'string' ? body.description : '',
      image: typeof body.image === 'string' ? body.image : '',
    };
  } catch {
    return null;
  }
}
