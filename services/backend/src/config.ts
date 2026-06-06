// Single source of truth for environment-driven config. Every module reads from
// here instead of touching process.env directly, so the env contract lives in
// one place (mirrored by .env.example).

const csv = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// CORS origins for the whole unified backend. ALSO gates the /ws upgrade (the
// wallet's ONLY transport), so the wallet's real prod origin MUST be present.
// Defaults cover BOTH apps:
//   - Crash:  https://crash.suize.io  + http://localhost:5173
//   - Wallet: https://wallet.suize.io + http://localhost:5180
//   - Landing/redirect: https://suize.io
// Override via ALLOWED_ORIGINS (comma-separated) in prod/k8s — and keep
// https://wallet.suize.io in that override or the deployed wallet WS gets 403'd.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://crash.suize.io",
  "https://wallet.suize.io",
  "https://suize.io",
  "http://localhost:5173",
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

  // --- gas-drain ceilings (sponsor + deploy) ---
  // The Enoki sponsor pool / deploy wallet are spent on EVERY sponsored tx. A
  // jailbroken client can't steal funds (allowedAddresses=[sender]) but CAN burn
  // our gas by looping cheap valid txs. These are PROCESS-GLOBAL daily counters
  // (in-memory, reset every 24h) plus a per-address sub-cap, enforced BEFORE we
  // call Enoki. Tune via env in prod; the defaults are generous for a demo and
  // tight against a drain loop. (Not cross-replica — a single replica's ceiling
  // is enough to blunt abuse; the real hard cap is Enoki's own pool budget.)
  sponsorDailyMax: Number(process.env.SPONSOR_DAILY_MAX ?? 20_000),       // sponsored txs / day / replica
  sponsorDailyPerAddressMax: Number(process.env.SPONSOR_DAILY_PER_ADDRESS_MAX ?? 500), // sponsored txs / day / address
  deployDailyMax: Number(process.env.DEPLOY_DAILY_MAX ?? 200),            // deploys / day / replica (each pays real SUI gas)

  // --- handle (self-custody SuiNS) module ---
  // Handle issuance is now FULLY ON-CHAIN — no Redis. The module is ENABLED only
  // when all three knobs below are set; otherwise every /handle/* op returns a
  // clear 503 "handle issuance not configured" so the backend boots and runs
  // before the owner finishes the SuiNS setup.
  suinsParentNftId: process.env.SUINS_PARENT_NFT_ID,         // parent `suize.sui` SuinsRegistration object id
  handleIssuerKey: process.env.HANDLE_ISSUER_PRIVATE_KEY,    // secret — env only; signs leaf-subname mints (parent-NFT holder)
  suinsParentDomain: process.env.SUINS_PARENT_DOMAIN ?? "suize.sui",

  // --- deploy module (Suize Deploy — "Vercel for Sui") ---
  // The deploy module orchestrates: unpack a posted tar → Walrus quilt upload →
  // on-chain `deploy_sui::site::create_site` → optional custom-domain linkage. It
  // is ENABLED only when DEPLOY_WALLET_PRIVATE_KEY is set; until then every
  // /deploy, /sites, /domains op returns 503 "deploy not configured" (the rest of
  // the backend boots fine). Walrus storage goes through the HTTP PUBLISHER (no CLI):
  // on the PUBLIC testnet publisher the operator pays the WAL, so the deploy SERVICE
  // WALLET only needs a little SUI for the on-chain create_site gas — NO Enoki sponsor
  // (the agent signs nothing). For the MVP you can run ONE funded key: set
  // DEPLOY_WALLET_PRIVATE_KEY, or it falls back to AGENT_PRIVATE_KEY (the wallet-agent's
  // key) so a single SUI-funded wallet serves both. Repo rule is "never reuse keys across
  // modules" — keep them separate for prod; one key is fine for the demo. (The agent
  // module is still a stub, so AGENT_PRIVATE_KEY isn't otherwise consumed yet.)
  deployWalletKey: process.env.DEPLOY_WALLET_PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY, // secret — bech32 `suiprivkey…`; signs Site PTBs (pays own gas).
  deployEpochs: Number(process.env.DEPLOY_EPOCHS ?? 30),     // Walrus storage duration (epochs). Default 30 ≈ ~2 months on testnet.
  deployBaseDomain: process.env.DEPLOY_BASE_DOMAIN ?? "deploy.suize.io", // base zone for free subdomains: <base36(siteId)>.<this>
  walrusAggregator: process.env.WALRUS_AGGREGATOR ?? "https://aggregator.walrus-testnet.walrus.space", // Walrus testnet aggregator base (worker reads from here)
  // Walrus HTTP PUBLISHER base — the deploy module PUTs quilts/blobs here. Default is
  // the public testnet publisher (operator-pays-WAL). The SAME HTTP code serves a
  // self-hosted MAINNET publisher — just change this URL (no other change needed).
  walrusPublisherUrl: process.env.WALRUS_PUBLISHER_URL ?? "https://publisher.walrus-testnet.walrus.space",

  // Optional Cloudflare-for-SaaS (Custom Hostnames) adapter for custom-domain
  // auto-SSL. When BOTH are set the deploy module provisions the custom hostname
  // on link; otherwise it returns manual-CNAME instructions (never a build blocker).
  cfApiToken: process.env.CF_API_TOKEN,                     // secret — Cloudflare API token with Custom Hostnames edit scope
  cfZoneId: process.env.CF_ZONE_ID,                         // Cloudflare zone id for the deploy base domain
} as const;
