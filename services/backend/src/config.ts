// Single source of truth for environment-driven config. Every module reads from
// here instead of touching process.env directly, so the env contract lives in
// one place (mirrored by .env.example).

import { fullnodeUrl, resolveNetwork, WALRUS_DEFAULTS, DEPLOY_SUB_PERIOD_MS } from "@suize/shared";

const csv = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// --- network (ENV-ONLY — owner directive 2026-06-10) ---
// SUI_NETWORK selects the network ('mainnet' opts in; anything else = testnet —
// a fresh checkout with zero env vars behaves exactly as before). RPC endpoints
// come from SUI_RPC_URLS (comma-separated; FIRST entry is the primary), falling
// back to the legacy single SUI_RPC_URL, then the public fullnode for the
// configured network. Never hardcoded here.
const suiNetwork = resolveNetwork(process.env.SUI_NETWORK);
const suiRpcUrls: string[] = (() => {
  const list = csv(process.env.SUI_RPC_URLS);
  if (list.length > 0) return list;
  return [process.env.SUI_RPC_URL ?? fullnodeUrl(suiNetwork)];
})();

// CORS origins for the whole unified backend. ALSO gates the /ws upgrade (the
// wallet's ONLY transport), so the wallet's real prod origin MUST be present.
// Defaults cover ALL apps:
//   - Crash:  https://crash.suize.io  + http://localhost:5173
//   - Wallet: https://wallet.suize.io + http://localhost:5180
//   - Deploy: https://deploy.suize.io + http://localhost:5183
//   - Landing/redirect: https://suize.io
// Override via ALLOWED_ORIGINS (comma-separated) in prod/k8s — and keep
// https://wallet.suize.io in that override or the deployed wallet WS gets 403'd.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://crash.suize.io",
  "https://wallet.suize.io",
  "https://deploy.suize.io",
  "https://suize.io",
  "http://localhost:5173",
  "http://localhost:5180",
  "http://localhost:5183",
];

export const config = {
  port: Number(process.env.PORT ?? 8080),

  // Browser origins allowed through CORS (union for both frontends).
  allowedOrigins: (() => {
    const fromEnv = csv(process.env.ALLOWED_ORIGINS);
    return fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED_ORIGINS;
  })(),

  // --- Sui network + RPC (env-only; see the block above) ---
  suiNetwork,
  /** Full RPC list (SUI_RPC_URLS). First entry is the primary every module uses today. */
  suiRpcUrls,
  /** Primary RPC endpoint — suiRpcUrls[0]. */
  suiRpcUrl: suiRpcUrls[0],
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
  deployEpochs: Number(process.env.DEPLOY_EPOCHS ?? 30),     // Walrus storage (epochs). 30 ≈ ~1 month at testnet's ~1-day epochs. Env-tunable (DEPLOY_EPOCHS).
  deployBaseDomain: process.env.DEPLOY_BASE_DOMAIN ?? "suize.site", // served-site base: <base36(siteId)>.<this> — its own zone for free first-level wildcard SSL (the dashboard itself stays deploy.suize.io)
  // Walrus aggregator base — env override (WALRUS_AGGREGATOR), defaulting to the
  // public aggregator for the CONFIGURED network (shared WALRUS_DEFAULTS table).
  walrusAggregator: process.env.WALRUS_AGGREGATOR ?? WALRUS_DEFAULTS[suiNetwork].aggregator,
  // Walrus HTTP PUBLISHER base — the deploy module PUTs quilts/blobs here. Env
  // override (WALRUS_PUBLISHER_URL), defaulting to the public publisher for the
  // CONFIGURED network (on testnet the operator pays the WAL). The SAME HTTP code
  // serves a self-hosted MAINNET publisher — just set this URL (no other change).
  walrusPublisherUrl: process.env.WALRUS_PUBLISHER_URL ?? WALRUS_DEFAULTS[suiNetwork].publisher,

  // Optional Cloudflare-for-SaaS (Custom Hostnames) adapter for custom-domain
  // auto-SSL. When BOTH are set the deploy module provisions the custom hostname
  // on link; otherwise it returns manual-CNAME instructions (never a build blocker).
  cfApiToken: process.env.CF_API_TOKEN,                     // secret — Cloudflare API token with Custom Hostnames edit scope
  cfZoneId: process.env.CF_ZONE_ID ?? "6c2dc349020a8e235085cfe39c501e01", // suize.site zone (not secret; override via env). CF-for-SaaS custom-hostname provisioning.

  // --- renewal relayer (the deterministic subscription↔storage cron) ---
  // The relayer walks the on-chain RenewalRegistry every tick: a DUE subscription
  // gets ONE service-wallet PTB (charge_subscription + extend_blob × 2 — charged
  // IFF storage extends); a charged-but-near-expiry site gets an extend-only PTB.
  // Enabled only when the deploy wallet is set AND the charge gate is live.
  renewalTickMs: Number(process.env.RENEWAL_TICK_MS ?? 60_000),          // loop interval (ms)
  renewalEpochs: Number(process.env.RENEWAL_EPOCHS ?? 35),               // epochs added per extend (clamped to the ~53-ahead Walrus max)
  renewalSafetyEpochs: Number(process.env.RENEWAL_SAFETY_EPOCHS ?? 5),   // extend-only cushion: blobs ending within this many epochs get repaired
  // The Deploy subscription period (ms). Defaults to the shared 30-day constant;
  // the env override exists so a DEMO can run e.g. 2-minute periods.
  deploySubPeriodMs: Number(process.env.DEPLOY_SUB_PERIOD_MS ?? DEPLOY_SUB_PERIOD_MS),
  // The WAL coin type the extend_blob payment is drawn from (testnet default;
  // override on mainnet). The Walrus PACKAGE itself is resolved at runtime from
  // the System object's `package_id` field (survives Walrus upgrades).
  walCoinType: process.env.WAL_COIN_TYPE ??
    "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL",
  // The shared Walrus System object (testnet default; override on mainnet).
  walrusSystemObject: process.env.WALRUS_SYSTEM_OBJECT ??
    "0x6c2547cbbc38025cf3adac45f63cb0a8d12ecf777cdc75a4971612bf97fdf6af",
} as const;
