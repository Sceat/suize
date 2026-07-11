// Single source of truth for environment-driven config. Every module reads from
// here instead of touching process.env directly, so the env contract lives in
// one place (mirrored by .env.example).

import { grpcUrl, resolveNetwork, WALRUS_DEFAULTS, DEPLOY_SUB_PERIOD_MS, DEPLOY_SUB_PRICE_USDC, DEPLOY_STORAGE_EPOCHS } from "@suize/shared";

const csv = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// --- network (ENV-ONLY — owner directive 2026-06-10) ---
// SUI_NETWORK selects the network ('mainnet' opts in; anything else = testnet —
// a fresh checkout with zero env vars behaves exactly as before). RPC endpoints
// are now gRPC BASE URLS (JSON-RPC is retired): they come from SUI_RPC_URLS
// (comma-separated; FIRST entry is the primary), falling back to the legacy single
// SUI_RPC_URL, then the public fullnode gRPC base for the configured network. The
// k8s-injected SUI_RPC_URL[S] keep their names but now mean gRPC bases. Never
// hardcoded here.
const suiNetwork = resolveNetwork(process.env.SUI_NETWORK);
const suiRpcUrls: string[] = (() => {
  const list = csv(process.env.SUI_RPC_URLS);
  if (list.length > 0) return list;
  return [process.env.SUI_RPC_URL ?? grpcUrl(suiNetwork)];
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
  "https://polysui.suize.io",
  "https://crash.suize.io",
  "https://wallet.suize.io",
  "https://deploy.suize.io",
  "https://agents.suize.io",
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
  /** Full gRPC-base list (SUI_RPC_URLS). First entry is the primary every module uses today. */
  suiRpcUrls,
  /** Primary gRPC base URL — suiRpcUrls[0]. */
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

  // --- facilitator: the x402 V2 fee-tier merchant registry ---
  // SUIZE_MERCHANTS is a JSON map of the ONLY addresses that get a 2% (+ $0.01
  // floor) rake declared in their 402 outputs: { "0x<addr>": { "feeBps": 200 }, … }.
  // Any payTo NOT in this map is FREE tier (a single full-amount output, no rake).
  // Unset/empty = every merchant is free tier. Parsed once at boot (in
  // src/facilitator/fees.ts); a malformed entry is skipped loudly, never fatal.
  suizeMerchants: process.env.SUIZE_MERCHANTS,

  // --- handle (self-custody SuiNS) module ---
  // Handle issuance is now FULLY ON-CHAIN — no Redis. The module is ENABLED only
  // when all three knobs below are set; otherwise every /handle/* op returns a
  // clear 503 "handle issuance not configured" so the backend boots and runs
  // before the owner finishes the SuiNS setup.
  suinsParentNftId: process.env.SUINS_PARENT_NFT_ID,         // parent `suize.sui` SuinsRegistration object id
  handleIssuerKey: process.env.HANDLE_ISSUER_PRIVATE_KEY,    // secret — env only; signs leaf-subname mints (parent-NFT holder)
  suinsParentDomain: process.env.SUINS_PARENT_DOMAIN ?? "suize.sui",

  // --- charge module (the no-code hosted merchant door) ---
  // ONE Ed25519 key (separate secret — never reuse). Signs the stateless charge
  // token (`api.suize.io/charge/<token>`, facilitator-verified) AND the settled-order
  // webhook (merchant-verified via @suize/pay verifyWebhook). Public key published at
  // GET /charge/pubkey. Unset → the /charge door answers 503 (the rest boots fine).
  chargeKey: process.env.SUIZE_CHARGE_PRIVATE_KEY, // secret — bech32 `suiprivkey…`
  // The public origin the hosted charge link is built on (api.suize.io/charge/<token>).
  chargeBaseUrl: process.env.SUIZE_PUBLIC_BASE ?? "https://api.suize.io",

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
  // The Deploy MERCHANT address — who the deploy revenue pays. UNSET (or == treasury)
  // → FIRST-PARTY: a single full-amount output, the deploy fee IS treasury income.
  // Set to a REAL merchant address (≠ treasury) → each deploy becomes a rail charge to
  // that merchant: net → merchant, the 2%/$0.01 fee leg → treasury (the on-chain leg the
  // wallet reads as a `charged` merchant payment, so it lands in the business ledger).
  // On mainnet this is the real Deploy merchant; on testnet, the demo merchant (e.g. sceat).
  deployMerchant: process.env.SUIZE_DEPLOY_MERCHANT,
  deployEpochs: Number(process.env.DEPLOY_EPOCHS ?? DEPLOY_STORAGE_EPOCHS),     // Walrus storage (epochs). Default = shared DEPLOY_STORAGE_EPOCHS (the UI/llms.txt quote it). ~1 month at testnet's ~1-day epochs. Env-tunable (DEPLOY_EPOCHS).
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

  // --- Walrus storage auto-renewal (the deterministic subscription↔storage cron) ---
  // The subs module charges (push, user-signed); this cron's only job is to keep a
  // PAID site's Walrus storage extended so it never lapses. Two triggers: the
  // on-settle hook (fires per sponsored renewal) + this safety cron (every
  // extendTickMs, repairs any near-expiry paid site). Enabled only when the deploy
  // wallet is set AND the subs module is published.
  extendTickMs: Number(process.env.EXTEND_TICK_MS ?? 6 * 60 * 60_000),   // safety-cron interval (ms; default 6h)
  renewalEpochs: Number(process.env.RENEWAL_EPOCHS ?? 35),               // epochs added per extend (clamped to the ~53-ahead Walrus max)
  renewalSafetyEpochs: Number(process.env.RENEWAL_SAFETY_EPOCHS ?? 5),   // extend cushion: blobs ending within this many epochs get repaired
  // The Deploy subscription period (ms). Defaults to the shared 30-day constant;
  // the env override exists so a DEMO can run e.g. 2-minute periods.
  deploySubPeriodMs: Number(process.env.DEPLOY_SUB_PERIOD_MS ?? DEPLOY_SUB_PERIOD_MS),
  // The Deploy subscription per-period price (atomic USDC, 6dp). PRODUCTION value is
  // the shared $19.99 number-wall constant; the env override (DEPLOY_SUB_PRICE_USDC)
  // exists ONLY so a TESTNET proof can ride a reduced price (a fresh zkLogin payer
  // rarely holds $19.99 of testnet USDC) — it is NEVER set in prod.
  deploySubPriceUsdc: Number(process.env.DEPLOY_SUB_PRICE_USDC ?? DEPLOY_SUB_PRICE_USDC),
  // The WAL coin type the extend_blob payment is drawn from (testnet default;
  // override on mainnet). The Walrus PACKAGE itself is resolved at runtime from
  // the System object's `package_id` field (survives Walrus upgrades).
  walCoinType: process.env.WAL_COIN_TYPE ??
    "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL",
  // The shared Walrus System object (testnet default; override on mainnet).
  walrusSystemObject: process.env.WALRUS_SYSTEM_OBJECT ??
    "0x6c2547cbbc38025cf3adac45f63cb0a8d12ecf777cdc75a4971612bf97fdf6af",

  // --- brain (the wallet AI) — the FENCED inference module (CLAUDE.md LOCKED #5,
  // amended 2026-06-14). It holds the Anthropic key and runs Claude to power the
  // PAY wallet's conversation, but returns ONLY narration + PROPOSED actions —
  // it never signs, settles, sponsors, or touches a key (the wallet is the sole
  // signer; the number wall stands). The brain WS frame 503s when the key is unset.
  // The key is SERVER-ONLY — never a VITE_/frontend var, never in a bundle. ---
  anthropicApiKey: process.env.ANTHROPIC_API_KEY, // secret — env only
  // Haiku ONLY (owner 2026-06-14: no paid wallet tier; no model routing). `effort`
  // 400s on Haiku 4.5 and is never sent.
  brainModel: process.env.BRAIN_MODEL ?? "claude-haiku-4-5",
  // STRICT per-user daily token cap (input+output, keyed by the verified
  // ws.data.address). Demo-tight on purpose: when a user crosses it the brain
  // replies with the work-in-progress notice and makes NO model call.
  brainDailyTokenMax: Number(process.env.BRAIN_DAILY_TOKEN_MAX ?? 60_000),
  // Hard ceiling on one turn's output so a single prompt can't burn the budget.
  brainMaxOutputTokens: Number(process.env.BRAIN_MAX_OUTPUT_TOKENS ?? 1_024),

  // --- memory (MemWal — Walrus's agent-memory SDK; the brain's "it remembers you") ---
  // The brain recalls + stores the user's memory via MemWal (default mode). The
  // per-user delegate key is DERIVED (HKDF) from this ONE master secret — no per-user
  // secret store (stateless / chain-derivable, fits our laws). DEFAULT MODE: the MemWal
  // relayer does embed+Seal+Walrus and SEES PLAINTEXT in transit (owner-accepted
  // 2026-06-14; the manual / self-hosted-embedder upgrade = relayer-sees-only-ciphertext
  // is the documented improve-later). Memory is BEST-EFFORT (never blocks a payment).
  // ENABLED only when MEMWAL_MASTER_KEY + the contract ids are all set; OFF otherwise.
  memwalMasterKey: process.env.MEMWAL_MASTER_KEY, // secret — env only; the HKDF root for every user's delegate key
  memwalRelayerUrl: (process.env.MEMWAL_RELAYER_URL ?? "https://relayer.memwal.ai").replace(/\/+$/, ""),
  memwalPackageId: process.env.MEMWAL_PACKAGE_ID, // the MemWal contract package id (fill per network from the MemWal docs)
  memwalRegistryId: process.env.MEMWAL_REGISTRY_ID, // the AccountRegistry shared object id (for createAccount)
  memwalNamespace: process.env.MEMWAL_NAMESPACE ?? "suize",
} as const;
