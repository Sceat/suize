/**
 * DEPLOY-FROM-AGENT — publish a single self-contained static page through the
 * Suize Deploy x402 flow, from the wallet. Mirrors apps/deploy/src/api.ts (the
 * proven path that shipped the landing), minimal subset: probe POST /deploy with
 * no payment → 402 PaymentRequired → settle the $0.50 charge LOCALLY (build the
 * gasless send_funds, sign the EXACT bytes with the local zkLogin session) →
 * retry with the b64 X-PAYMENT header → the live URL.
 *
 * The backend never signs the payer leg; the WALLET signs. The amount is the
 * backend's own 402 challenge (the number wall — the model never sets the price).
 * Same backend + CORS as the facilitator (API_BASE = api.suize.io).
 */
import type { DeployResponse } from '@suize/shared';
import type { PaymentRequired, Output } from '@suize/pay';
import { API_BASE } from '../lib/env';
import { pack_tar, type PackFile } from './pack';

class DeployError extends Error {
  status: number;
  body?: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'DeployError';
    this.status = status;
    this.body = body;
  }
}

const b64json = (o: unknown): string => btoa(unescape(encodeURIComponent(JSON.stringify(o))));

async function req<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  let res: Response;
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    res = await fetch(`${API_BASE}${path}`, ctrl ? { ...init, signal: ctrl.signal } : init);
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    throw new DeployError(
      0,
      aborted
        ? 'This is taking longer than usual — the network or Walrus is slow right now. Try again in a moment.'
        : (e as Error)?.message ?? 'network error',
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const detail =
      typeof body === 'string' ? body : (body as { error?: string } | undefined)?.error ?? `deploy ${res.status}`;
    throw new DeployError(res.status, detail, body);
  }
  return body as T;
}

const buildPayment = (sender: string, outputs: Output[]): Promise<{ bytes: string }> =>
  req('/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sender, outputs }) });

const postDeploy = (name: string, tar: Blob, payment?: string, timeoutMs?: number): Promise<DeployResponse> => {
  const form = new FormData();
  form.append('name', name);
  form.append('site.tar', tar, 'site.tar'); // the multipart key the backend reads
  return req<DeployResponse>('/deploy', { method: 'POST', headers: payment ? { 'X-PAYMENT': payment } : {}, body: form }, timeoutMs);
};

// A strict, self-contained-page CSP: blocks ALL network (remote scripts/styles/
// images/fonts, fetch/xhr/websockets) while allowing the inline <style>/<script>
// the page is built from, plus data: images/fonts.
const SELF_CONTAINED_CSP =
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${SELF_CONTAINED_CSP}">`;

/**
 * Harden a model-authored page into a TRULY self-contained one by injecting the CSP
 * above as the first node in <head>. This is a REAL, declarative enforcement of the
 * "self-contained" contract (not a regex guess) and touches ONLY agent-authored
 * pages — normal Deploy uploads serve unchanged. (The deployed page is also a
 * SEPARATE ORIGIN from the wallet — suize.site vs suize.io — so it can never reach
 * the user's wallet session regardless; the CSP is defense-in-depth on the page's
 * own content.)
 */
function hardenHtml(html: string): string {
  const headOpen = html.match(/<head\b[^>]*>/i);
  if (headOpen) {
    const at = headOpen.index! + headOpen[0].length;
    return html.slice(0, at) + CSP_META + html.slice(at);
  }
  const htmlOpen = html.match(/<html\b[^>]*>/i);
  if (htmlOpen) {
    const at = htmlOpen.index! + htmlOpen[0].length;
    return html.slice(0, at) + `<head>${CSP_META}</head>` + html.slice(at);
  }
  return `<head>${CSP_META}</head>` + html;
}

/**
 * Deploy a single static `index.html` (the model's generated page) and return the
 * DeployResponse (siteId + live URL). `signBytes` is the local zkLogin signer over
 * the gasless payment bytes (dapp-kit signTransaction → { signature }).
 */
export async function deployStaticSite(args: {
  name: string;
  html: string;
  sender: string;
  signBytes: (bytes: string) => Promise<{ signature: string }>;
  /** optional live-progress reporter for the (slow) publish — surfaces each phase so
   *  the working state is legible instead of a silent 2-3 min wait. */
  onProgress?: (label: string) => void;
}): Promise<DeployResponse> {
  const step = args.onProgress ?? (() => {});
  const files: PackFile[] = [{ path: 'index.html', bytes: new TextEncoder().encode(hardenHtml(args.html)) }];
  const tar = pack_tar(files);
  // 1. probe — POST with no payment. Un-gated path returns the DeployResponse
  //    directly; the charge gate answers 402 with the x402 PaymentRequired.
  try {
    return await postDeploy(args.name, tar);
  } catch (e) {
    if (!(e instanceof DeployError) || e.status !== 402) throw e;
    const challenge = e.body as PaymentRequired | undefined;
    const accepted = challenge?.accepts?.[0];
    if (!accepted) throw e;
    // 2. settle: build the gasless payment for the declared split, sign locally.
    step('Building the payment');
    const { bytes } = await buildPayment(args.sender, accepted.extra.outputs);
    step('Authorizing from your sub-account');
    const { signature } = await args.signBytes(bytes);
    const header = b64json({
      x402Version: 2,
      accepted,
      payload: { signature, transaction: bytes },
      extensions: challenge?.extensions ?? {},
    });
    // 3. retry with the X-PAYMENT header → settle + 2× Walrus upload + on-chain mint.
    //    This is the slow leg (~1-3 min on a slow Walrus testnet day); bound it so a
    //    true hang fails cleanly instead of spinning forever — but generously, since a
    //    real deploy legitimately takes a couple minutes.
    step('Publishing to the web');
    return await postDeploy(args.name, tar, header, 230_000);
  }
}
