// Single source of truth for environment-driven config. Every module reads from
// here instead of touching process.env directly, so the env contract lives in
// one place (mirrored by .env.example).

const csv = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// CORS origins for the whole unified backend. Defaults cover BOTH apps:
//   - Crash:  https://crash.suize.io + http://localhost:5173
//   - Wallet: https://suize.io       + http://localhost:5180
// Override via ALLOWED_ORIGINS (comma-separated) in prod/k8s.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://crash.suize.io",
  "http://localhost:5173",
  "https://suize.io",
  "http://localhost:5180",
];

export const config = {
  port: Number(process.env.PORT ?? 8080),

  // Browser origins allowed through CORS (union for both frontends).
  allowedOrigins: (() => {
    const fromEnv = csv(process.env.ALLOWED_ORIGINS);
    return fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED_ORIGINS;
  })(),

  // --- sponsor module ---
  suiRpcUrl: process.env.SUI_RPC_URL ?? "https://fullnode.testnet.sui.io:443",
  enokiPrivateApiKey: process.env.ENOKI_PRIVATE_API_KEY, // secret — env only, never hardcoded

  // --- api (waitlist) module ---
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  turnstileSecret: process.env.TURNSTILE_SECRET, // secret — env only

  // --- handle (self-custody SuiNS) module ---
  // The handle module is ENABLED only when all three are set; otherwise every
  // /handle/* route returns a clear 503 "handle issuance not configured" so the
  // backend boots and runs before the owner finishes the SuiNS setup.
  suinsParentNftId: process.env.SUINS_PARENT_NFT_ID,         // parent `suize.sui` SuinsRegistration object id
  handleIssuerKey: process.env.HANDLE_ISSUER_PRIVATE_KEY,    // secret — env only; signs leaf-subname mints (parent-NFT holder)
  suinsParentDomain: process.env.SUINS_PARENT_DOMAIN ?? "suize.sui",
} as const;
