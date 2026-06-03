/**
 * Environment + network config. Single source of truth for the wallet's wiring.
 *
 * NETWORK is TESTNET (locked) — sourced from @suize/shared, the single source of
 * truth across every app + service. Real DeepBook spot liquidity on testnet,
 * matches the Move deploy target and the backend sponsor. Auth is REAL Enoki
 * zkLogin only — there is NO fallback session: when the Enoki/Google creds are
 * absent, sign-in throws and App.tsx redirects to suize.io (see useAuth.ts).
 */

import { NETWORK, type SuiNetwork } from '@suize/shared';

export { NETWORK };
export type { SuiNetwork };

/** Enoki API key (publishable). Empty -> Enoki registration is skipped, so sign-in throws and App.tsx redirects to suize.io (no fallback session). */
export const ENOKI_API_KEY: string = import.meta.env.VITE_ENOKI_API_KEY ?? '';

/** Google OAuth client id for zkLogin via Enoki. Empty -> the Google zkLogin wallet never registers, sign-in throws, App.tsx redirects to suize.io. */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

/**
 * Backend WebSocket URL — the single Enoki-verified transport (replaces the old
 * `VITE_SPONSOR_URL` HTTP base). The wallet is pure-WS now: handle + sponsor +
 * execute + balance pushes all ride this one socket. Dev: `ws://localhost:8080/ws`
 * (the backend's default PORT — services/backend/src/config.ts); prod:
 * `wss://api.suize.io/ws`. Trailing slash stripped; `ws.ts` appends the `?address=`
 * query param at connect time.
 */
export const WS_URL: string = (import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080/ws')
  .trim()
  .replace(/\/$/, '');

/**
 * The scoped AI agent's Sui address — the destination the owner-minted `AgentCap`
 * is transferred to at account creation (mandate::issue_agent_cap). The agent's
 * PRIVATE key never lives in the frontend bundle (it runs in the off-chain helm);
 * the wallet only needs the public ADDRESS to issue a cap to it.
 *
 * Empty => account creation throws a clear "agent not configured" error rather than
 * minting a cap to nobody (an owner action — see useHome.createAccount). On testnet
 * set VITE_AGENT_ADDRESS to the helm keypair's address.
 */
export const AGENT_ADDRESS: string = (import.meta.env.VITE_AGENT_ADDRESS ?? '').trim();

/** The SuiNS parent we issue subnames under: <name>@suize. */
export const SUINS_PARENT = 'suize';

/** Explorer base for tappable tx digests in the LOG. */
export const EXPLORER_TX = (digest: string) =>
  `https://suiscan.xyz/${NETWORK}/tx/${digest}`;
