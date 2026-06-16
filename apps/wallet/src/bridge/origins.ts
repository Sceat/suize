/**
 * The origin ALLOWLIST for the /confirm-subscribe popup — the wallet-origin policy
 * for who may open it (today: Deploy, for the storage subscription).
 *
 * EXACT-MATCH STRINGS ONLY — no wildcards, no regex, no suffix matching (a
 * `endsWith('.suize.io')` check is how `evil-suize.io`-class bugs are born).
 * Add each new product origin explicitly. NEVER add `*.suize.site` origins —
 * that domain serves user-deployed content.
 */

const PRODUCTION_ORIGINS = [
  'https://deploy.suize.io',
  'https://crash.suize.io',
];

/** Dev: the suite's vite servers — pay/crash share 5173, deploy 5183. */
const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5183',
  'http://127.0.0.1:5183',
];

export const BRIDGE_ALLOWED_ORIGINS: readonly string[] = import.meta.env.DEV
  ? [...PRODUCTION_ORIGINS, ...DEV_ORIGINS]
  : PRODUCTION_ORIGINS;

export const isAllowedBridgeOrigin = (origin: string): boolean =>
  BRIDGE_ALLOWED_ORIGINS.includes(origin);
