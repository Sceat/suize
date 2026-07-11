/**
 * @suize/shared — the single source of truth shared by every app + service.
 *
 * Lives at the root of the Bun workspace so the wallet frontend, the landing
 * page, and the unified backend all import the SAME network constant, on-chain
 * package ids, and sponsor wire types. Pure types + constants — no runtime deps.
 */

// ---------------------------------------------------------------------------
// Network — ENV-ONLY selection (owner directive, 2026-06-10). This package is
// ISOMORPHIC AND PURE: it is bundled into the CF worker, the Vite apps, AND the
// Bun backend, so it must NEVER read `process.env` / `import.meta.env` itself.
// Each runtime resolves its own network from ITS env (SUI_NETWORK on the
// backend, VITE_SUI_NETWORK in the apps, wrangler [vars] in the worker) via
// `resolveNetwork` and passes it down explicitly. Default everywhere: testnet.
// ---------------------------------------------------------------------------

export type SuiNetwork = 'testnet' | 'mainnet';

/**
 * Resolve a raw env value to a SuiNetwork. ONLY the exact string 'mainnet' opts
 * into mainnet; anything else (undefined, '', 'testnet', a typo) is testnet —
 * fail-safe: a fresh checkout with zero env vars behaves exactly like today.
 */
export const resolveNetwork = (raw: string | undefined | null): SuiNetwork =>
  raw === 'mainnet' ? 'mainnet' : 'testnet';

/**
 * The public fullnode **gRPC** base URL for a Sui network (the default transport;
 * each runtime may override via its env). Mysten retired the public JSON-RPC
 * fullnode in mid-2026 — the SAME hosts now serve gRPC (and GraphQL, below). A
 * `SuiGrpcClient({ baseUrl })` speaks to this; there is no JSON-RPC path anymore.
 */
export const grpcUrl = (network: SuiNetwork): string =>
  `https://fullnode.${network}.sui.io:443`;

/**
 * Mysten's official Sui **GraphQL** endpoint for a network — the indexer transport
 * used ONLY where gRPC core cannot express a query (transaction-by-address listing,
 * event-by-type queries). Verified live for both networks (testnet + mainnet return
 * a valid `chainIdentifier`). A `SuiGraphQLClient({ url })` speaks to this.
 */
export const graphqlUrl = (network: SuiNetwork): string =>
  `https://graphql.${network}.sui.io/graphql`;

/**
 * The settlement coin type the rail charges in, PER NETWORK — Circle's USDC
 * (decimals 6, symbol "USDC"; testnet value verified live via getCoinMetadata,
 * see apps/wallet/src/data/coins.ts). Mainnet is Circle's NATIVE USDC (a
 * RegulatedCoin — orthogonal to non-custodial; LOCKED #12). The `Account<USDC>`
 * type arg + every rail PTB (`charge`/`pay`/…) land THIS exact type, so it is a
 * load-bearing on-chain id and lives here in the single source of truth (not
 * duplicated in any app/service). 6 decimals → $1 = 1_000_000.
 */
export const USDC_TYPES: Record<SuiNetwork, string> = {
  testnet: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
  mainnet: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
};

/**
 * The TESTNET settlement coin — kept as a stable alias because every current
 * consumer (the rail PTB builders, the deploy-charge join) ships testnet today.
 * Network-aware consumers should read `USDC_TYPES[network]` instead.
 */
export const USDC_TYPE = USDC_TYPES.testnet;

// ── Facilitator wire-shape validators — the ONE source of truth ───────────────
// The 402/pay wire (paymentId memo, decimal-string amounts, Sui addresses) is a
// public contract; these regexes + the memo cap are the validators every surface
// shares (the pay page, the SSO confirm popup, the backend verifier). The
// zero-dep published packages (`@suize/pay`, `@suize/mcp`) keep their OWN copies
// — they must not import this package — but every app that already depends on
// `@suize/shared` imports from here so the contract can't silently drift.
export const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;
/** A non-negative USDC decimal: integer part + up to 6 fractional digits. */
export const USDC_DECIMAL_RE = /^(\d+)(?:\.(\d{1,6}))?$/;
/** A base58 Sui tx digest (no 0/O/I/l, ~44 chars) — the shape `/verify` matches. */
export const TX_DIGEST_RE = /^[A-Za-z0-9]{40,50}$/;
/** Max bytes of a payment memo / paymentId carried in a receipt. */
export const MAX_MEMO_LEN = 256;

/** The CAIP-2 chain id for a Sui network (`sui:testnet` / `sui:mainnet`) — the
 * `network` field x402 PaymentRequirements carry. */
export const caip2 = (net: SuiNetwork) => `sui:${net}` as const;

/**
 * Per-network Walrus HTTP endpoint DEFAULTS (the public operator endpoints).
 * The backend overrides these via WALRUS_AGGREGATOR / WALRUS_PUBLISHER_URL; the
 * worker reads its aggregator from wrangler [vars]. These are the fallbacks.
 */
export const WALRUS_DEFAULTS: Record<SuiNetwork, { aggregator: string; publisher: string }> = {
  testnet: {
    aggregator: 'https://aggregator.walrus-testnet.walrus.space',
    publisher: 'https://publisher.walrus-testnet.walrus.space',
  },
  mainnet: {
    aggregator: 'https://aggregator.walrus-mainnet.walrus.space',
    publisher: 'https://publisher.walrus-mainnet.walrus.space',
  },
};

/**
 * Per-network Walrus EPOCH clock — the genesis instant of epoch 0 and the epoch
 * duration. Lets any reader turn a blob's on-chain `storage.end_epoch` into a
 * wall-clock expiry without an extra RPC: `walrusEpochToMs(endEpoch, net)`.
 * SINGLE SOURCE OF TRUTH (both the backend storage reader and the deploy
 * dashboard's chain-derived expiry consume these — no duplicated literals).
 * Testnet epochs are ~1 day; mainnet ~14 days (genesis values from Walrus ops).
 */
export const WALRUS_EPOCHS: Record<SuiNetwork, { genesisMs: number; durationMs: number }> = {
  testnet: { genesisMs: Date.parse('2024-10-17T00:00:00Z'), durationMs: 24 * 60 * 60 * 1000 },
  mainnet: { genesisMs: Date.parse('2025-03-25T15:00:24Z'), durationMs: 14 * 24 * 60 * 60 * 1000 },
};

/** The wall-clock ms a Walrus epoch BOUNDARY falls at (epoch N starts here). A blob
 * ending at epoch N expires at epoch N's start. */
export const walrusEpochToMs = (epoch: number, net: SuiNetwork): number =>
  WALRUS_EPOCHS[net].genesisMs + epoch * WALRUS_EPOCHS[net].durationMs;

// ---------------------------------------------------------------------------
// On-chain package ids + the exact Move targets the sponsor may sponsor.
// These are public on-chain ids — safe to commit.
// ---------------------------------------------------------------------------

/**
 * The Sui framework package `0x2`, in its NORMALIZED 64-hex form. Enoki's sponsor
 * allow-list compares against the tx's NORMALIZED move-call targets, so any
 * framework helper we allow-list for sponsorship (e.g. the `CoinWithBalance`-intent
 * helpers in SUBS_MOVE_TARGETS) MUST use this form — a short `0x2::…` never matches
 * and silently breaks sponsorship (proven on testnet 2026-06-12).
 */
const FRAMEWORK_PKG =
  '0x0000000000000000000000000000000000000000000000000000000000000002';

/**
 * Crash router package (live on testnet — version-gated + accumulator build).
 * Upgraded 2026-06-06 to v2 (added router::withdraw_all for atomic settle->wallet
 * sweep); on-chain Version lifted to 2 via migrate, fencing the prior v1 package
 * 0xcd1f6af8…ebd31e19. UpgradeCap 0xbbb53a32…d886b9e1 (deployer-owned).
 */
const CRASH_ROUTER_PACKAGE =
  '0x16eb262d69300c4291beab7e9f27b2b94640124a290f373230c5c8a3d3d50c26';

/**
 * Wallet Move package — LIVE on testnet.
 * Published 2026-06-02 from packages/move-wallet (modules: mandate / vault / swap /
 * navi). Publish digest EuEspy1q7qEbVGT7HCWvyVxEDmfbL88gGuUjwUdrpYAe; UpgradeCap
 * 0xc2d611327d2b684fc14ca9fc6c813b84253689e21e095f78f9108736006f782d (deployer-owned).
 */
const WALLET_PACKAGE =
  '0x285865f6795ae733bbbb3d55df6826d4614dbdcad7bd5c177ab6a4b4314267b1';

/**
 * Deploy Move package (`deploy_sui`) — v2 REPUBLISHED to testnet 2026-06-10
 * (publish digest Gkg5FJPAkf8pPAM7w24gTWzVFN3N17uxBTnihtBkhiwu; the 2026-06-06
 * v1 publish 0xadcc8d… is abandoned — its Sites/domains are orphaned). v2 adds:
 * Site blob-OBJECT id fields (Walrus storage extension). PACKAGE is the package id;
 * the two *_OBJECT ids are the shared objects created by the modules' init — the
 * deploy backend reads these to build PTBs, the worker reads them to resolve + serve
 * sites.
 *
 * NOTE (x402 V2 pivot 2026-06-12): the `charge_ledger` + `renewal_registry` modules
 * were REMOVED from move-deploy (deploy billing is now x402-exact one-off settlements
 * via the keyless facilitator; storage auto-renewal rides the standalone `subs`
 * module). Their two shared objects from THIS testnet publish are orphaned-harmless
 * (nothing references them); the MAINNET republish excludes both modules.
 * REPUBLISHED on testnet 2026-06-14 (publish digest BQ7Pna6hwEutTeJCpvtFKivxy9MP6RHYfJHgQZEY2UQB)
 * to add the on-chain ONE-SITE-PER-PAYMENT guard: `site::create_site` now takes a
 * settled payment digest + the shared `SiteDigestRegistry` and aborts `EDigestUsed`
 * (site.move code 0) if the digest already minted a site — the chain is the atomic
 * dedup lock (multi-replica-safe; replaces the old in-memory settledDeploys map).
 * Caps from this publish: the DeployerCap 0xfcdbc25d… (the create_site mint authority —
 * gates Site minting to the paid backend) was minted to the publisher 0x087aa862… then
 * TRANSFERRED to the prod deploy service wallet 0xcc58bc00… (agent@suize, which signs
 * create_site in prod and already holds the SiteAdminCaps — digest mLcJFogd…). The cap's
 * CUSTODY == the mint trust root (a hot-wallet single point of failure; see
 * apps/deploy/SPEC.md). version::AdminCap 0x6aa982b5… + UpgradeCap 0x81f93227… stay on the
 * CLI publisher. (2026-06-14 republish `6kAxGVLn…` adds the DeployerCap gate — Move audit.)
 */
const DEPLOY_PACKAGE =
  '0x5cbf0ce0a2f56128ef0d7679aab8f3a8ba690533163dc2524754fd40f27faf0b';
const DEPLOY_VERSION_OBJECT =
  '0x339c2b6bbd8ed4cb5ddef2c6c8f137374c6e1eab4aedef665b61c0b464a77898';
const DEPLOY_DOMAIN_REGISTRY_OBJECT =
  '0xec0565e9c27ab340595a26b8b823ed681e36616f32ebf4aba20a0193574d4c08';
const DEPLOY_SITE_DIGEST_REGISTRY_OBJECT =
  '0x8ed1be2e9ad1813150368e7c458a1f70239185e8545717b04a233bb5333ca5f0';
/** The owned `DeployerCap` (held by the deploy service wallet): the mint authority
 *  `create_site` now requires — only the paid backend can mint a Site, so every Site
 *  field (owner/size/blob ids) is service-attested. Custody == the mint trust root. */
const DEPLOY_DEPLOYER_CAP_OBJECT =
  '0xfcdbc25dafbe2af0aeeb2471acab6d1e657d4f0ac9380435f17a46c4cf8894bf';

// NOTE (x402 V2 pivot 2026-06-12): the `suize::account` rail package + its shared
// `RailConfig` object are RETIRED. Payments are now vanilla x402 V2 'exact' over
// gasless Address-Balance PTBs, settled KEYLESS over gRPC by the facilitator — there
// is no on-chain Account, no RailConfig, no `&RailConfig` arg, no sponsor allow-list
// entry for the rail. The 2% (+$0.01 floor) fee lives in the declared `extra.outputs`
// split (facilitator-enforced), not in an on-chain fee object. The unpublished
// account.move source stays under packages/move-wallet as a retired-in-place archive.

/**
 * Subscriptions Move package (`subs::subscription`) — the standalone Party-object
 * subscription module: each subscription is its own object (fixed payee +
 * per-period cap + period); renewals are USER-SIGNED, sponsored txs the relayer
 * triggers. CONFIG_OBJECT is the shared config the module's `init` creates; the
 * wallet/relayer read these ids from here per the single-source-of-truth rule.
 */
// PUBLISHED to testnet 2026-06-14 (publish digest 2XbnJRCCJzcRXkmPWsVY2sthDevjm25UDB9tZKDNTaqi)
// from packages/move-subs (module: subscription) by the CLI dev wallet 0x087aa862… —
// which therefore holds the SubsAdminCap (0xcd0e5bbc…) + UpgradeCap (0xfb6dac80…) and is
// the SubsConfig.treasury until synced. VERSION-GATED republish (2026-06-15): every
// create/renew/cancel now takes the shared `Version` first (assert_latest) — run
// `sync-subs-config.ts` after publish to set BOTH treasury AND coin_type on the fresh
// SubsConfig. CONFIG_OBJECT is the shared SubsConfig init created; VERSION_OBJECT is the
// shared Version. Mainnet stays '0x0' — its publish is a republish.
const SUBS_PACKAGE: string = '0x759105b5f7382cb22533e8a5282e90c92c558edb1bc2eaa0904247914082d821';

/** Trace package (`trace::trace` — `anchor` + `seal_approve`) — PUBLISHED testnet
 *  2026-06-17 (digest `BcoxS3vp…`). The encrypted-history on-chain commitment + the
 *  Seal owner-only access policy. Mainnet is a republish ('0x0' until then). */
const TRACE_PACKAGE: string = '0xc7c95e514776cee94d65b5997247d88ff2493bd5b83971b176cd1a072cbd8c07';
const SUBS_CONFIG_OBJECT: string = '0x976c10fb2eb9d29b8ae7c17fa6bf8b06cbb1e6a591e6ce7a82c04ff344332029';
const SUBS_VERSION_OBJECT: string = '0x6542cdaa1f7bc55a00a319b98b8dd6d45b546868558a1e1a0b58d409b6d87d86';

/**
 * Ad-slot auction Move package (`auction::auction`) — the agents.suize.io directory's
 * on-chain monetization. Each `AdSlot` is a SHARED object sold by continuous English
 * auction (King-of-the-Hill: a strictly-higher bid takes the slot; the net goes to the
 * directory, the configured fee to the treasury — so an ad sale is a payment on the
 * rail that shows in the directory's own feed). Bids are USER-SIGNED + Enoki-sponsored
 * (same shape as a subs renewal), so the sponsor allow-lists AUCTION_MOVE_TARGETS.
 *
 * PUBLISHED to testnet 2026-06-14 — the HARDENED v2 (republish digest
 * 6kjMqdJzNn46q1sZz2V2smw1eXzg1akfemKNhPgJAH5P; supersedes the pre-hardening 0x07c192ad…,
 * now abandoned) from packages/move-auction by the CLI dev wallet 0x087aa862… — which holds
 * the AuctionAdminCap (0x8df7762c…) + UpgradeCap (0x3bbdadaa…). Post-publish admin txs set
 * the AuctionConfig.treasury to the resolved treasury@suize, pinned USDC (set_coin_type —
 * which MUST precede create_slot now: the hardened module aborts ECoinUnpinned otherwise),
 * and created the three slots below; CONFIG.directory defaults to the publisher
 * (= DIRECTORY_PAYTO). ON-CHAIN CAVEAT (same as subs): AuctionConfig.treasury is a
 * LITERAL set at sync — if treasury@suize is repointed, an admin set_treasury is needed.
 * Mainnet stays '0x0' — its publish is a republish.
 */
// REPUBLISHED 2026-06-15 (digest in git): version gate + `creative`/`update_creative`
// REMOVED — an ad's content now comes from the holder's BusinessProfile NFT (see PROFILE_*).
// Fresh publish (ABI break), so the prior 0xe0c4eeec… is abandoned. CLI dev wallet
// 0x087aa862… holds the new AuctionAdminCap (0x583fb90a…) + UpgradeCap (0x908b44d0…).
const AUCTION_PACKAGE: string = '0xa7151d699c93e48e5f502759d4de704ba4b8f22111b3d0b5a60c265ff2d37869';
/**
 * The auction MOVE-CALL ENTRY package. EQUALS AUCTION_PACKAGE — a FRESH republish (not an
 * upgrade), so the AdSlot/AuctionConfig TYPES and the call targets share this one new id.
 * A future UPGRADE that adds a fn would set this to the upgraded id while PACKAGE keeps the
 * original; that distinction is preserved here for that case.
 */
const AUCTION_PACKAGE_LATEST: string = AUCTION_PACKAGE;
const AUCTION_CONFIG_OBJECT: string = '0xe81a46df69a31d91b0eae9e03eb299e339294142cbd132957558d88e49ad1293';
/** The shared `Version` gate — `bid` / `create_slot` call `assert_latest` first. */
const AUCTION_VERSION_OBJECT: string = '0x9152d4ec84c1e04b0ae8ba453d7fe39e9a8791992ca63eda5384704554bd1a23';
/** The shared `AdSlot` objects (genesis $50, held by the directory) — created by the sync
 * script on this republish (digest G8hBsUWc…). */
const AUCTION_SLOTS: Record<string, string> = {
  hero: '0xce8607a907080baa23685ed2ce03bc3ce7b07e229cbb45faf8ec6af8c2e44128',
  'feed-banner': '0x8c162a8061fd5e9c4fcf48f98601756663a4b2a4f48dbd32e468e2780893b574',
  'rankings-sidebar': '0x5f0abceb1b3ad0e040c1937c4ee497479db63f0a6cff6390f1a1a3fcb2306801',
};

/**
 * The directory's own merchant payout address — where each ad-slot bid's NET proceeds
 * land (the fee leg goes to treasury@suize). This is `AuctionConfig.directory` on-chain
 * (defaults to the publisher; redirect via the AuctionAdminCap `set_directory`). It is
 * the address the directory appears under in its own live feed.
 */
export const DIRECTORY_PAYTO = '0x087aa862ca645c0b94400c49e11b491011fca35db837361ccfc4c6f69d356e86';

/** The genesis price of every ad slot: $50 = 50_000_000 base units (6 decimals). A first
 * bid must STRICTLY exceed it. */
export const AD_SLOT_START_PRICE = 50_000_000;

// ---------------------------------------------------------------------------
// Business Profile NFT (`profile::profile`) — the merchant identity reused across ads +
// the directory. A soulbound `BusinessProfile` (key, no store) with `Display<>` holds
// name · description · image_url (logo) · banner_url · website. PUBLISHED to testnet
// 2026-06-15 by the CLI dev wallet 0x087aa862… (holds ProfileAdminCap 0x100d5892… +
// UpgradeCap 0x981e3548…). create/edit each cost a FLAT $0.10 (USDC) → treasury (the
// rail's 2% is separate). One per business by convention; resolve by the address's owned
// profile. Mainnet '0x0' — a republish. The on-chain ProfileConfig.treasury is set post-
// publish (the sync script), same caveat as subs/auction.
const PROFILE_PACKAGE: string = '0x21be5a6957d8e944eebb93d594057859fd793474ed6778479145b73b0b156c5d';
const PROFILE_CONFIG_OBJECT: string = '0x537c791ad8612122f6f3363e7698125f4a3ed409a1ad8d54cfc796d81fd51e86';
/** The shared `Version` gate — create_profile / edit_profile call `assert_latest` first. */
const PROFILE_VERSION_OBJECT: string = '0xbb63c6c44e565d3b6955729f2e2f7c1149d3eefad26171f08a93370506410954';
/** The on-chain `BusinessProfile` struct type — for `getOwnedObjects` type-filtered lookups. */
export const BUSINESS_PROFILE_TYPE = (network: SuiNetwork): string =>
  `${packageIds(network).PROFILE.PACKAGE}::profile::BusinessProfile`;
/** The flat create/edit fee for a Business Profile: $0.10 at 6 decimals. */
export const PROFILE_FEE = 100_000;

/** Display metadata for the ad slots (the on-chain ids live in PACKAGE_IDS.AUCTION.SLOTS,
 * keyed by the same `key`). The order here is the surface order on agents.suize.io. */
export const AD_SLOT_DEFS = [
  { key: 'hero', label: 'Hero banner', blurb: 'Top of every page' },
  { key: 'feed-banner', label: 'Feed banner', blurb: 'Inside the live purchase feed' },
  { key: 'rankings-sidebar', label: 'Rankings sidebar', blurb: 'Beside the volume leaderboard' },
] as const;

/**
 * The Suize treasury is the SuiNS handle `treasury@suize` — the ONE source of truth,
 * resolved LIVE everywhere it's needed (the x402 fee split, the Deploy charge). There
 * is NO hardcoded treasury address anywhere in the code (owner law 2026-06-14: "any
 * fees go to whatever treasury.suize.sui resolves to; nothing in the code points at a
 * literal address — we abstract"). This reverses the 2026-06-12 pin: a name hijack is
 * the (accepted) tradeoff for a rotatable, single-source treasury; callers CACHE the
 * resolution and FAIL-CLOSED (mint no fee-tier terms) when it can't be resolved, so a
 * transient miss never silently misroutes the rake.
 */
export const TREASURY_SUINS_NAME = 'treasury@suize';

/** `treasury@suize` as the dotted `.sui` name the SuiNS RPC actually resolves. */
export const TREASURY_SUINS_DOTTED = 'treasury.suize.sui';

/** The minimal SuiNS-resolving client this helper needs. The browser's dapp-kit
 *  `SuiClient` exposes `resolveNameServiceAddress` natively; the backend's gRPC
 *  client has no such method, so it passes a thin adapter over `NameService.lookupName`
 *  (see `services/backend/src/sui.ts` → `treasuryResolver`). Either satisfies this. */
export interface TreasuryResolver {
  resolveNameServiceAddress(input: { name: string }): Promise<string | null>;
}

/**
 * Resolve the Suize treasury address from `treasury@suize` (the single source of
 * truth). Returns a lower-cased 0x… address, or `null` when the name doesn't resolve
 * to a valid address — callers MUST fail-closed on null (never fall back to a literal).
 * Callers own caching; this is a single pure async resolve so it stays reusable + testable.
 */
export async function resolveTreasury(client: TreasuryResolver): Promise<string | null> {
  const addr = await client.resolveNameServiceAddress({ name: TREASURY_SUINS_DOTTED });
  return addr && SUI_ADDRESS_RE.test(addr) ? addr.toLowerCase() : null;
}

// NOTE (deploy merchant): the Deploy merchant is resolved at RUNTIME by the backend
// (`deployMerchant()` in services/backend/src/deploy/payment.ts), NOT pinned here —
// so no merchant-address const lives in this package. The `SUIZE_DEPLOY_MERCHANT` env
// selects it: UNSET → the merchant IS the Suize treasury (first-party — a single
// full-amount output, deploy income == treasury income); SET to a real address → a
// third-party merchant (net → merchant, the 2%/$0.01 fee leg → treasury, so the deploy
// shows in that merchant's ledger AND in the agents.suize.io feed). Either way the
// treasury still resolves LIVE from `treasury@suize`.
//
// ON-CHAIN CAVEAT (subs): `subs::subscription`'s `SubsConfig.treasury` is set ON-CHAIN
// at publish and Move can't resolve SuiNS — so the subscription rake goes to whatever
// that stored address is. Point it at the resolved `treasury@suize` via a one-time
// `SubsAdminCap` admin tx; that is NOT a code change (no literal belongs here).

/** The price (in native USDC base units, 6 decimals) of one one-off deploy charge: $0.50 = 500_000. */
export const DEPLOY_CHARGE_AMOUNT = 500_000;

/** The DISCOUNTED per-deploy price for an active Deploy subscriber (Premium): $0.10
 * = 100_000, vs the $0.50 standard rate. A perk of the $19.99/mo plan — each deploy
 * costs a fifth. ENFORCED at the facilitator verify against the payer's on-chain sub
 * (`hasValidDeploySub(payer)`): a non-subscriber that submits this lower amount is
 * rejected; a subscriber may pay either this or the standard amount. */
export const DEPLOY_PREMIUM_CHARGE_AMOUNT = 100_000;

/** The Walrus storage a one-off deploy buys, in EPOCHS — the documented default
 * (the backend's `DEPLOY_EPOCHS`, env-tunable). At testnet's ~1-day epochs that's
 * ~1 month; the actual per-site end epoch is on-chain (the blobs' `storage.end_epoch`,
 * surfaced as `expiresAtMs` on GET /sites/:id). Extend or subscribe to push it out. */
export const DEPLOY_STORAGE_EPOCHS = 30;

/**
 * The Deploy subscription — $19.99/mo (price placeholder, owner-flagged), unlocking
 * (a) custom domains and (b) Suize auto-renewing the site's Walrus storage. PRICE is
 * what each period debits; PERIOD_MS is the recurring interval (30 days). On the subs
 * module the fixed `amount` IS the per-period leash (the module asserts
 * `payment.value() == amount`), so there is no separate PERIOD_CAP const.
 */
export const DEPLOY_SUB_PRICE_USDC = 19_990_000;
export const DEPLOY_SUB_PERIOD_MS = 2_592_000_000;

/**
 * The per-ADDRESS auto-renew ceiling: a single Deploy subscription (owned by an
 * address) auto-renews the Walrus storage of ALL that address's sites, but only up
 * to this much TOTAL site storage. A WAL-spend safety bound — a malicious owner with
 * 10 TB of sites must NOT make the service wallet renew all of it for one $19.99 sub.
 * Cost basis ~$0.023/GB/mo Walrus ⇒ ~$2.30/mo of WAL at the 100 GiB cap, comfortably
 * under the $19.99 revenue. 100 GiB = 100 * 1024^3 bytes.
 */
export const DEPLOY_RENEW_MAX_BYTES = 100 * 1024 ** 3;

/**
 * Crash router package + its 7 sponsorable `router::*` targets, PLUS the one
 * framework helper a fully-manager-funded bet needs (`0x2::coin::zero`): after a
 * cash-out the manager holds the funds and the wallet has no dUSDC coin object, so
 * the bet PTB mints a zero Coin<DUSDC> as its (harmless) 0-value payment. It moves
 * no value — it just lets the bet build without a wallet coin to split.
 *
 * ALWAYS TESTNET (LOCKED #11/#12): Crash stays network-PINNED to testnet (DeepBook
 * Predict is testnet-only). `packageIds()` returns THESE ids for EVERY network, so
 * a suite-wide mainnet flip can never drag Crash along.
 */
export const CRASH_TESTNET_IDS = {
  PACKAGE: CRASH_ROUTER_PACKAGE,
  TARGETS: {
    CREATE_MANAGER: `${CRASH_ROUTER_PACKAGE}::router::create_manager`,
    BET: `${CRASH_ROUTER_PACKAGE}::router::bet`,
    CASH_OUT: `${CRASH_ROUTER_PACKAGE}::router::cash_out`,
    CLAIM: `${CRASH_ROUTER_PACKAGE}::router::claim`,
    WITHDRAW: `${CRASH_ROUTER_PACKAGE}::router::withdraw`,
    // Sweeps the FULL manager balance to the sender (no amount arg). Bundled into
    // the cash_out + claim PTBs for an atomic settle -> auto-sweep to wallet, so
    // payouts never pile up invisibly in the manager.
    WITHDRAW_ALL: `${CRASH_ROUTER_PACKAGE}::router::withdraw_all`,
    SUPPLY: `${CRASH_ROUTER_PACKAGE}::router::supply`,
    REDEEM_LP: `${CRASH_ROUTER_PACKAGE}::router::redeem_lp`,
    // Sui framework: zero-coin mint for a fully-manager-funded bet (moves no value).
    // MUST be the NORMALIZED 64-hex `0x2` form (`0x000…002`): Enoki compares the
    // request's allow-list against the tx's NORMALIZED move-call targets, so a short
    // `0x2::…` entry never matches and silently breaks sponsorship (the same bug class
    // proven on the subs `redeem_funds`/`into_balance` helpers, testnet 2026-06-12).
    COIN_ZERO: `${FRAMEWORK_PKG}::coin::zero`,
  },
} as const;

/**
 * Wallet package block — LIVE on testnet. The sponsorable WRITE targets across the
 * four modules (mandate / vault / swap / navi). Read-only accessors are intentionally
 * omitted — they are never signed, only `devInspect`ed. The sponsor allow-lists
 * this exact set (via WALLET_MOVE_TARGETS) so gasless onboarding + agent moves can
 * call ONLY these; every one of them enforces the on-chain cage (budget / scope /
 * expiry / allow-list) so over-listing OUR own functions is safe.
 */
const walletIds = (pkg: string) => ({
  PACKAGE: pkg,
  TARGETS: {
    // mandate — the leash (owner mint/revoke/top-up + the agent gate).
    MANDATE_CREATE: `${pkg}::mandate::create_mandate`,
    MANDATE_ISSUE_CAP: `${pkg}::mandate::issue_agent_cap`,
    MANDATE_REVOKE_CAP: `${pkg}::mandate::revoke_agent_cap`,
    MANDATE_TOP_UP: `${pkg}::mandate::top_up_budget`,
    MANDATE_SET_EXPIRY: `${pkg}::mandate::set_expiry`,
    MANDATE_CONSUME: `${pkg}::mandate::consume_budget`,
    // vault — single-coin sandbox custody (owner deposit/withdraw + agent deploy).
    VAULT_CREATE: `${pkg}::vault::create_vault`,
    VAULT_DEPOSIT: `${pkg}::vault::deposit`,
    VAULT_WITHDRAW_IDLE: `${pkg}::vault::withdraw_idle`,
    VAULT_AGENT_CONSUME: `${pkg}::vault::agent_consume`,
    // swap — DEGEN two-sided DeepBook vault (owner deposits/withdraws + agent swaps).
    SWAP_CREATE: `${pkg}::swap::create_swap_vault`,
    SWAP_DEPOSIT_BASE: `${pkg}::swap::deposit_base`,
    SWAP_DEPOSIT_QUOTE: `${pkg}::swap::deposit_quote`,
    SWAP_DEPOSIT_DEEP: `${pkg}::swap::deposit_deep`,
    SWAP_WITHDRAW_BASE: `${pkg}::swap::withdraw_base`,
    SWAP_WITHDRAW_QUOTE: `${pkg}::swap::withdraw_quote`,
    SWAP_WITHDRAW_DEEP: `${pkg}::swap::withdraw_deep`,
    SWAP_AGENT_BASE_TO_QUOTE: `${pkg}::swap::agent_swap_base_to_quote`,
    SWAP_AGENT_QUOTE_TO_BASE: `${pkg}::swap::agent_swap_quote_to_base`,
    // navi — SAFE multi-asset lend-as-is vault (owner custody + agent supply/withdraw).
    NAVI_CREATE: `${pkg}::navi::create_vault`,
    NAVI_SET_ACCOUNT_CAP: `${pkg}::navi::set_account_cap`,
    NAVI_TAKE_ACCOUNT_CAP: `${pkg}::navi::take_account_cap`,
    NAVI_DEPOSIT: `${pkg}::navi::deposit`,
    NAVI_WITHDRAW_IDLE: `${pkg}::navi::withdraw_idle`,
    NAVI_AGENT_SUPPLY: `${pkg}::navi::agent_supply`,
    NAVI_AGENT_WITHDRAW_REQUEST: `${pkg}::navi::agent_withdraw_request`,
    NAVI_AGENT_ABSORB_WITHDRAWN: `${pkg}::navi::agent_absorb_withdrawn`,
  } as Record<string, string>,
});

/**
 * Deploy package block (`deploy_sui`) — PUBLISHED on testnet (real ids in the
 * DEPLOY_PACKAGE / VERSION_OBJECT / DOMAIN_REGISTRY_OBJECT consts above; mainnet is
 * a republish — '0x0' placeholders until then). The three write targets are signed
 * by the backend's OWN deploy service wallet (it pays its own gas) — NOT
 * Enoki-sponsored — so they are intentionally absent from the sponsor allow-list
 * union; DEPLOY_MOVE_TARGETS exports them for the worker + future use.
 * Detail: apps/deploy/SPEC.md.
 */
const deployIds = (ids: {
  pkg: string;
  version: string;
  registry: string;
  siteDigestRegistry: string;
  deployerCap: string;
}) => ({
  PACKAGE: ids.pkg,
  VERSION_OBJECT: ids.version,
  DOMAIN_REGISTRY_OBJECT: ids.registry,
  /** The shared `SiteDigestRegistry`: the on-chain one-site-per-payment dedup set.
   *  `create_site` records the settled payment digest here + aborts EDigestUsed on a
   *  duplicate — the multi-replica-safe consume guard. */
  SITE_DIGEST_REGISTRY_OBJECT: ids.siteDigestRegistry,
  /** The owned `DeployerCap` (deploy service wallet): `create_site`'s mint authority —
   *  the FIRST moveCall arg. Only the holder can mint a Site, so an attacker cannot
   *  forge one (free hosting / a renewer-draining Site). Mainnet '0x0' until transferred
   *  to the prod service wallet. */
  DEPLOYER_CAP_OBJECT: ids.deployerCap,
  TARGETS: {
    CREATE_SITE: `${ids.pkg}::site::create_site`,
    LINK_DOMAIN: `${ids.pkg}::domain_registry::link_domain`,
    UNLINK_DOMAIN: `${ids.pkg}::domain_registry::unlink_domain`,
  },
});

/**
 * Subscriptions package block (`subs::subscription`) — the standalone Party-object
 * subscription module (named address `subs`, module `subscription`). PUBLISHED on
 * testnet (real ids in SUBS_PACKAGE / SUBS_CONFIG_OBJECT above; mainnet is a
 * republish — '0x0' until then). The three write targets are USER-SIGNED +
 * Enoki-sponsored (the wallet signs create/cancel locally; the relayer triggers
 * user-pre-authorized renewals), so the sponsor allow-lists this exact set via
 * SUBS_MOVE_TARGETS.
 *   create — the user mints a subscription (fixed payee + per-period cap + period)
 *   renew  — a sponsored, user-pre-authorized recurring debit (relayer-triggered)
 *   cancel — the user kills the subscription
 * Plus the Sui framework helpers the `CoinWithBalance` intent injects under
 * sponsorship (`redeem_funds` / `into_balance`) — the sponsor allow-list must
 * accept them or the sponsored renewal PTB is rejected. The function names MUST
 * match the published module verbatim — a typo silently breaks sponsorship.
 */
const subsIds = (ids: { pkg: string; config: string; version: string }) => ({
  PACKAGE: ids.pkg,
  CONFIG_OBJECT: ids.config,
  /** The shared `Version` gate every create/renew/cancel passes first (assert_latest). */
  VERSION_OBJECT: ids.version,
  TARGETS: {
    CREATE: `${ids.pkg}::subscription::create`,
    RENEW: `${ids.pkg}::subscription::renew`,
    CANCEL: `${ids.pkg}::subscription::cancel`,
    // Sui framework: the helpers the SDK's `tx.balance({ type, balance })` intent
    // injects to materialize the period's `Balance<USDC>` from the sender's funds
    // under sponsorship — `balance::redeem_funds` draws it from the Address Balance,
    // and `coin::into_balance` (+ `balance::redeem_funds` again) covers the
    // split-from-Coin-objects path. The sponsor allow-list must accept these or the
    // sponsored create/renew PTB is rejected. MUST be the NORMALIZED 64-hex `0x2`
    // form (`0x000…002`): Enoki compares the request's allow-list against the tx's
    // NORMALIZED targets, so a short `0x2::…` entry never matches and silently
    // breaks sponsorship (proven on testnet 2026-06-12 — short form → Enoki 400
    // "not part of an allow-listed move call target"; full form → accepted).
    BALANCE_REDEEM_FUNDS: `${FRAMEWORK_PKG}::balance::redeem_funds`,
    COIN_INTO_BALANCE: `${FRAMEWORK_PKG}::coin::into_balance`,
  } as Record<string, string>,
});

/**
 * Trace package block (`trace::trace`). Minimal — just the package + the ONE
 * sponsored write target `anchor` (the on-chain history commitment). `seal_approve`
 * is NOT a target: Seal's key servers DRY-RUN it, it is never broadcast or sponsored.
 * `anchor` moves no coins, so no `CoinWithBalance` framework helpers are needed.
 */
const traceIds = (ids: { pkg: string }) => ({
  PACKAGE: ids.pkg,
  TARGETS: {
    ANCHOR: `${ids.pkg}::trace::anchor`,
  } as Record<string, string>,
});

/**
 * Ad-slot auction package block (`auction::auction`) — PUBLISHED on testnet (real ids
 * above; mainnet is a republish — '0x0' until then). `SLOTS` maps each slot key to its
 * shared `AdSlot` object id (read live for the current price/holder/creative). The ONE
 * write target `bid` is USER-SIGNED + Enoki-sponsored, so the sponsor allow-lists this
 * set via AUCTION_MOVE_TARGETS — PLUS the two Sui framework helpers the `CoinWithBalance`
 * intent injects to materialize the bid's `Balance<USDC>` under sponsorship (same pair
 * as subs; MUST be the NORMALIZED 64-hex `0x2` form or Enoki silently rejects).
 */
const auctionIds = (ids: {
  pkg: string;
  pkgLatest: string;
  config: string;
  version: string;
  slots: Record<string, string>;
}) => ({
  // PACKAGE = the ORIGINAL publish id: the AdSlot/AuctionConfig TYPE origin + AUCTION_PUBLISHED
  // gate. (Fresh republish, so pkg === pkgLatest today.)
  PACKAGE: ids.pkg,
  CONFIG_OBJECT: ids.config,
  /** The shared `Version` gate every bid/create_slot passes (assert_latest). */
  VERSION_OBJECT: ids.version,
  SLOTS: ids.slots,
  TARGETS: {
    // `bid<T>(version, slot, config, payment, clock, ctx)` — USER-SIGNED + Enoki-sponsored, so
    // the sponsor allow-lists this set. No `update_creative` (ad content is the BusinessProfile).
    BID: `${ids.pkgLatest}::auction::bid`,
    BALANCE_REDEEM_FUNDS: `${FRAMEWORK_PKG}::balance::redeem_funds`,
    COIN_INTO_BALANCE: `${FRAMEWORK_PKG}::coin::into_balance`,
  } as Record<string, string>,
});

/**
 * Business Profile package block (`profile::profile`). `create_profile` + `edit_profile` each
 * push a $0.10 `Balance<USDC>` → treasury; USER-SIGNED + Enoki-sponsorable, so the sponsor
 * allow-lists PROFILE_MOVE_TARGETS + the CoinWithBalance framework helpers (same `0x2` form).
 */
const profileIds = (ids: { pkg: string; config: string; version: string }) => ({
  PACKAGE: ids.pkg,
  CONFIG_OBJECT: ids.config,
  VERSION_OBJECT: ids.version,
  TARGETS: {
    CREATE_PROFILE: `${ids.pkg}::profile::create_profile`,
    EDIT_PROFILE: `${ids.pkg}::profile::edit_profile`,
    BALANCE_REDEEM_FUNDS: `${FRAMEWORK_PKG}::balance::redeem_funds`,
    COIN_INTO_BALANCE: `${FRAMEWORK_PKG}::coin::into_balance`,
  } as Record<string, string>,
});

/**
 * Per-network ADDRESS SLOTS for the network-keyed blocks. Mainnet is ALL '0x0'
 * placeholders until the mainnet publish/republish (LOCKED #12 — `deploy_sui` +
 * `subs` mainnet are republishes). CRASH is deliberately ABSENT here — it is
 * network-pinned (CRASH_TESTNET_IDS).
 */
const NETWORK_ADDRESSES: Record<
  SuiNetwork,
  {
    wallet: string;
    deploy: {
      pkg: string;
      version: string;
      registry: string;
      siteDigestRegistry: string;
      deployerCap: string;
    };
    subs: { pkg: string; config: string; version: string };
    auction: { pkg: string; pkgLatest: string; config: string; version: string; slots: Record<string, string> };
    profile: { pkg: string; config: string; version: string };
    trace: { pkg: string };
  }
> = {
  testnet: {
    wallet: WALLET_PACKAGE,
    deploy: {
      pkg: DEPLOY_PACKAGE,
      version: DEPLOY_VERSION_OBJECT,
      registry: DEPLOY_DOMAIN_REGISTRY_OBJECT,
      siteDigestRegistry: DEPLOY_SITE_DIGEST_REGISTRY_OBJECT,
      deployerCap: DEPLOY_DEPLOYER_CAP_OBJECT,
    },
    subs: { pkg: SUBS_PACKAGE, config: SUBS_CONFIG_OBJECT, version: SUBS_VERSION_OBJECT },
    auction: {
      pkg: AUCTION_PACKAGE,
      pkgLatest: AUCTION_PACKAGE_LATEST,
      config: AUCTION_CONFIG_OBJECT,
      version: AUCTION_VERSION_OBJECT,
      slots: AUCTION_SLOTS,
    },
    profile: { pkg: PROFILE_PACKAGE, config: PROFILE_CONFIG_OBJECT, version: PROFILE_VERSION_OBJECT },
    trace: { pkg: TRACE_PACKAGE },
  },
  mainnet: {
    wallet: '0x0',
    deploy: {
      pkg: '0x0',
      version: '0x0',
      registry: '0x0',
      siteDigestRegistry: '0x0',
      deployerCap: '0x0',
    },
    subs: { pkg: '0x0', config: '0x0', version: '0x0' },
    auction: { pkg: '0x0', pkgLatest: '0x0', config: '0x0', version: '0x0', slots: {} },
    profile: { pkg: '0x0', config: '0x0', version: '0x0' },
    trace: { pkg: '0x0' },
  },
};

/**
 * The network-keyed package-id table. WALLET / DEPLOY / SUBS resolve from
 * NETWORK_ADDRESSES[network]; CRASH is ALWAYS the testnet ids (LOCKED #11/#12 —
 * Crash is network-pinned, the mainnet flip never drags it along).
 */
export const packageIds = (network: SuiNetwork) => ({
  CRASH: CRASH_TESTNET_IDS,
  WALLET: walletIds(NETWORK_ADDRESSES[network].wallet),
  DEPLOY: deployIds(NETWORK_ADDRESSES[network].deploy),
  SUBS: subsIds(NETWORK_ADDRESSES[network].subs),
  AUCTION: auctionIds(NETWORK_ADDRESSES[network].auction),
  PROFILE: profileIds(NETWORK_ADDRESSES[network].profile),
  TRACE: traceIds(NETWORK_ADDRESSES[network].trace),
});

/**
 * The TESTNET table — what every shipping consumer uses today (the whole stack
 * defaults to testnet). A network-aware consumer should call
 * `packageIds(network)` with the network IT resolved from ITS env.
 */
export const PACKAGE_IDS = packageIds('testnet');

/** Flat list of the Crash router targets, in declaration order. */
export const CRASH_MOVE_TARGETS: string[] = Object.values(PACKAGE_IDS.CRASH.TARGETS);

/**
 * Flat list of the `subs` write targets (create / renew / cancel) PLUS the Sui
 * framework helpers the `CoinWithBalance` intent injects under sponsorship — the
 * sponsor allow-lists this exact set so the gasless wallet/relayer can call ONLY
 * the subscription surface. The sponsor MUST union these in only when SUBS_PUBLISHED
 * is true, else a `0x0::subs::*` target poisons the allow-list.
 */
export const SUBS_MOVE_TARGETS: string[] = Object.values(PACKAGE_IDS.SUBS.TARGETS);

/** True once the `subs` package has been published (its id is no longer the 0x0 placeholder). */
export const SUBS_PUBLISHED: boolean = PACKAGE_IDS.SUBS.PACKAGE !== '0x0';

/**
 * The `trace` write target (`anchor`) the sponsor allow-lists so the wallet's
 * gas-sponsored history anchor can be called. Just the one target — `anchor` moves
 * no coins (no `CoinWithBalance` helpers), and `seal_approve` is dry-run (never
 * sponsored). Union in ONLY when TRACE_PUBLISHED, else `0x0::trace::anchor` poisons
 * the allow-list.
 */
export const TRACE_MOVE_TARGETS: string[] = Object.values(PACKAGE_IDS.TRACE.TARGETS);

/** True once the `trace` package has been published (its id is no longer 0x0). */
export const TRACE_PUBLISHED: boolean = PACKAGE_IDS.TRACE.PACKAGE !== '0x0';

/**
 * Flat list of the `auction` write target (`bid`) PLUS the Sui framework helpers the
 * `CoinWithBalance` intent injects under sponsorship — the sponsor allow-lists this set
 * so a gasless ad-slot bid can call ONLY the auction surface. The sponsor MUST union
 * these in only when AUCTION_PUBLISHED is true, else a `0x0::auction::*` target poisons
 * the allow-list.
 */
export const AUCTION_MOVE_TARGETS: string[] = Object.values(PACKAGE_IDS.AUCTION.TARGETS);

/** True once the `auction` package has been published (its id is no longer the 0x0 placeholder). */
export const AUCTION_PUBLISHED: boolean = PACKAGE_IDS.AUCTION.PACKAGE !== '0x0';

/** Flat list of the `profile` write targets (create/edit) + the CoinWithBalance framework
 * helpers — the sponsor allow-lists this set so a gasless profile mint/edit calls ONLY the
 * profile surface. Union in only when PROFILE_PUBLISHED. */
export const PROFILE_MOVE_TARGETS: string[] = Object.values(PACKAGE_IDS.PROFILE.TARGETS);

/** True once the `profile` package is published (id no longer the 0x0 placeholder). */
export const PROFILE_PUBLISHED: boolean = PACKAGE_IDS.PROFILE.PACKAGE !== '0x0';

/** Flat list of the wallet targets — the wallet pkg is LIVE on testnet (mandate/vault/swap/navi). */
export const WALLET_MOVE_TARGETS: string[] = Object.values(PACKAGE_IDS.WALLET.TARGETS);

/**
 * Flat list of the deploy targets (create_site / link_domain / unlink_domain).
 * Exported for future use only — these are signed by the backend's own deploy
 * service wallet (pays its own gas), so they are deliberately NOT added to the
 * sponsor's allow-list union. (Placeholder package id until move-deploy ships.)
 */
export const DEPLOY_MOVE_TARGETS: string[] = Object.values(PACKAGE_IDS.DEPLOY.TARGETS);

// ---------------------------------------------------------------------------
// Sponsor wire types — the request/response contract between the apps and the
// unified backend's sponsor module (POST /sponsor, POST /execute).
// ---------------------------------------------------------------------------

/** POST /sponsor request body. */
export interface SponsorRequest {
  network: SuiNetwork;
  /** base64 of `tx.build({ onlyTransactionKind: true })`. */
  transactionKindBytes: string;
  /** zkLogin sender address (0x + 64 hex). */
  sender: string;
}

/** POST /sponsor response body. */
export interface SponsorResponse {
  /** base64 sponsored tx bytes the client signs with its zkLogin keypair. */
  bytes: string;
  /** sponsored tx digest, echoed back to /execute. */
  digest: string;
}

/** POST /execute request body. */
export interface ExecuteRequest {
  /** digest returned by /sponsor. */
  digest: string;
  /** base64 user signature over the sponsored `bytes`. */
  signature: string;
}

/** POST /execute response body. */
export interface ExecuteResponse {
  /** executed tx digest. */
  digest: string;
}

// ---------------------------------------------------------------------------
// Handle wire types — the request/response contract between the apps and the
// unified backend's handle module (GET /handle/available, GET /handle/me,
// POST /handle/claim). Handles are `<name>@suize` (= `<name>.suize.sui` leaf
// subnames). Issuance + lookup are FULLY ON-CHAIN via the Sui SDK (no DB): the
// SuiNS leaf record is the availability source, and the user-signed reverse record
// (setDefault at claim) makes /me resolve. Issuance is self-custody (Path B): the backend custodies the
// suize.sui parent NFT + a separate issuer key, mints leaf subnames via
// @mysten/suins, and sponsors gas through the existing Enoki sponsor.
// ---------------------------------------------------------------------------

/**
 * GET /handle/available?name=<name> response body.
 * `available=false` carries an optional human-readable `reason` (taken,
 * too short, bad charset, blocklisted, reserved) for the onboarding UI.
 */
export interface HandleAvailableResponse {
  available: boolean;
  reason?: string;
}

/**
 * GET /handle/me response body (auth: verified zkLogin address).
 * `handle` is the claimed `<name>@suize` handle, or null if none — this null
 * check drives the onboarding gate. `suggestedName` is an optional seed for the
 * name step (e.g. the Google email local-part) when no handle exists yet.
 */
export interface HandleMeResponse {
  handle: string | null;
  suggestedName?: string;
}

/**
 * POST /handle/claim request body.
 * `name` is the bare label (lowercase [a-z0-9-], 3–20 chars); `address` is the
 * zkLogin address to target — the backend authorizes `address == session`.
 */
export interface HandleClaimRequest {
  name: string;
  address: string;
}

/**
 * POST /handle/claim response body.
 * `handle` is the issued `<name>@suize` handle; `txDigest` is the leaf-subname
 * mint transaction digest (sponsored).
 *
 * `setDefaultBytes`/`setDefaultDigest` carry the SPONSORED `set_reverse_lookup`
 * (setDefault) transaction the WALLET must sign with the user's zkLogin signer
 * and execute via the existing `executeRequest` path. A leaf subname does NOT
 * auto-set a reverse record, so without this step `resolveNameServiceNames`
 * returns nothing — the claim is only complete once the wallet lands these.
 * Both are present whenever the leaf was minted/owned by this address; they are
 * optional only for forward-compat and the (never-hit) configured-but-no-record
 * path. The sender of these bytes is the VERIFIED USER (Enoki sponsors gas), so
 * `set_reverse_lookup` binds the reverse record to the user's address.
 */
export interface HandleClaimResponse {
  handle: string;
  txDigest: string;
  /** Base64 sponsored `set_reverse_lookup` tx bytes — the wallet signs these verbatim. */
  setDefaultBytes?: string;
  /** Digest of the sponsored setDefault tx — passed to `executeRequest` after signing. */
  setDefaultDigest?: string;
}

// ---------------------------------------------------------------------------
// Deploy wire types — the request/response contract between agents/dashboard and
// the unified backend's deploy module (POST /deploy, GET /sites, GET /sites/:id,
// POST /domains, DELETE /domains/:domain). Sites are deployed to Walrus + a fresh
// on-chain `Site` object by the backend's OWN deploy service wallet (it pays SUI +
// WAL gas). POST /deploy is AUTHENTICATED BY THE PAYMENT ITSELF — the X-PAYMENT header
// carries a signed gasless payment, and the on-chain `owner` is ALWAYS the recovered
// payer (whoever pays, owns). There is no separate deploy-auth nonce/signature and no
// anonymous/service-owned deploy. See apps/deploy/SPEC.md.
// ---------------------------------------------------------------------------

/**
 * POST /deploy response body.
 * Each deploy mints a NEW immutable `Site` (new id → new URL); there is no
 * overwrite path in the MVP. `siteId` is the on-chain object id; `subdomain` is
 * `base36(siteId)`; `url` is `https://<subdomain>.suize.site`; `version` is
 * always 1 in the MVP; `digest` is the create_site tx digest.
 */
export interface DeployResponse {
  siteId: string;
  subdomain: string;
  url: string;
  version: number;
  digest: string;
}

// ---------------------------------------------------------------------------
// CHARGE↔Deploy join — the payment-gated deploy (x402 V2 'exact', first-party,
// 2026-06-12). A deploy is a one-off $0.50 gasless settlement on the rail BEFORE the
// Walrus upload + Site mint. There are NO Suize-specific wire types here anymore: the
// wire is vanilla x402 V2 (the `PaymentRequired` body + the `X-PAYMENT` header carrying
// the b64 `PaymentPayload`), so the dashboard + agents import the shapes from
// `@suize/pay` / `@suize/x402`, NOT from here. The old sub-account convenience door
// (deploy/quote · deploy/charge · deploy/execute + their request/response types) is
// DELETED — the payer pays directly from its Address Balance, keyless-settled. See
// `services/backend/src/deploy/payment.ts` + `apps/deploy/SPEC.md` §2.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Facilitator wire types — the open merchant-side door of the rail (x402 V2).
//
// NOTE (x402 V2 pivot 2026-06-12): the GET /verify {paid,gross,fee,net} shape and
// the POST /pay/build + /pay/submit sponsored-door types are DELETED. Verification
// is now the vanilla x402 POST /verify → `VerifyResponse` and POST /settle →
// `SettleResponse` (both exported from `@suize/x402` / `@suize/pay`, NOT here —
// they ride the standard wire). Payments settle KEYLESS over gRPC (no Enoki
// sponsor of the payer leg), so there is no sponsored build/submit pair. Only the
// optional `/checkout` URL-formatter wire (below) is Suize-shaped + lives here.
// ---------------------------------------------------------------------------

/**
 * GET /sites/:id (and the entries of GET /sites) response body.
 * `owner` is the cryptographically-recovered deployer address (the signer of the
 * deploy auth nonce) — always a real, authenticated owner, never the service wallet.
 * `domains` are the linked custom domains.
 */
export interface SiteInfo {
  siteId: string;
  name: string;
  owner: string;
  url: string;
  sizeBytes: number;
  fileCount: number;
  createdAtMs: number;
  domains: string[];
  /** The Walrus storage END epoch (the EARLIER of the site's two blobs' end epochs
   * — the binding expiry constraint), read live. Absent on the list endpoint /
   * pre-v2 sites. */
  storageEndEpoch?: number;
  /** The wall-clock ms the storage lapses at (epochToMs(storageEndEpoch)). Absent
   * when the end epoch is unknown. Drives the dashboard's "expires <date>" copy. */
  expiresAtMs?: number;
  /** True when the site has an ACTIVE Deploy subscription (read through the merchant
   * SDK — suizeSubs.findByRef(siteId)). Unlocks custom domains + auto-renews storage.
   * Absent on the list endpoint; absent when the subs module is unpublished. */
  subscribed?: boolean;
  /** Client-derived, deploy dashboard ONLY: true when this site's `owner` is the
   * signed-in user's agent SUB-ACCOUNT (a 1-of-2 multisig whose committee includes
   * the user's main address) rather than the main address itself. Never set by the
   * backend/wire — the dashboard tags it after an ON-CHAIN committee check (the
   * signature IS the link; no stored state). Drives the "via agent" card chip. */
  viaAgent?: boolean;
}

/**
 * POST /domains?verify=0 request body — ISSUE a link challenge for a site. This
 * step writes nothing on-chain and is intentionally unauthenticated (it only
 * mints DNS/nonce material). The response (DomainChallengeResponse) carries a
 * fresh single-use `nonce` the caller must SIGN for the verify step.
 */
export interface DomainLinkRequest {
  siteId: string;
  domain: string;
}

/**
 * POST /domains?verify=1 request body — VERIFY + link on-chain. Authority is a
 * SERVER-VERIFIED zkLogin personal-message signature (op-bound + nonce-fresh):
 * the client signs `buildDeployLinkAuthMessage(domain, siteId, nonce)` with its
 * zkLogin signer; the backend reconstructs that exact message, recovers the
 * signer address via `verifyPersonalMessageSignature`, and requires it to equal
 * `Site.owner`. There is NO client-claimed `requester` — the recovered address
 * IS the requester. `ts` is the client ms-epoch timestamp the signed message binds
 * (the backend accepts it within a freshness window — STATELESS, no nonce store);
 * `signature` is base64 of the personal-message sig.
 */
export interface DomainLinkVerifyRequest {
  siteId: string;
  domain: string;
  ts: number;
  signature: string;
}

/**
 * DELETE /domains/:domain request body — UNLINK. Same cryptographic authority as
 * the link-verify path: the client signs `buildDeployUnlinkAuthMessage(domain,
 * ts)`; the backend recovers the signer and requires it to equal the `Site.owner`
 * of the site the domain currently points at. No `requester`.
 */
export interface DomainUnlinkRequest {
  ts: number;
  signature: string;
}

// NOTE (x402 V2 pivot 2026-06-12): the POST/DELETE /deploy/renewal join + its wire
// types (DeployRenewalLinkRequest / …UnlinkRequest / …Response) are DELETED. Storage
// auto-renewal now rides the standalone `subs` module (the wallet signs
// `subscription::create` with `ref` = the site id; the backend's extender keeps the
// site's Walrus storage extended). There is no subscription↔site registry to link.

// ---------------------------------------------------------------------------
// Deploy domain-op AUTH MESSAGE BUILDERS — the EXACT personal-message strings the
// client signs and the backend reconstructs to recover the requester address.
// SHARED so the format can NEVER drift between the dashboard signer and the
// backend verifier (LOCKED-DECISION #5). Each message binds to (a) the exact
// operation + its params and (b) a CLIENT timestamp (`ts`, ms epoch) the backend
// accepts within a freshness window — STATELESS (no server-issued nonce store),
// multi-replica-safe (THE PRINCIPLE: the chain is the database, no shared map).
// The op is owner-gated on-chain (Site.owner + the registry's EDomainTaken/
// EWrongCap), so a within-window replay of an owner's own signature is idempotent.
//
// NOTE (deploy-auth is GONE): a deploy no longer carries a separate signed nonce.
// The x402 payment payload IS the private signed authorization — the recovered
// payer becomes the on-chain owner (one auth, no second signature).
// ---------------------------------------------------------------------------

/** Personal message for LINKING `domain` -> `siteId`, bound to a client `ts` (ms epoch).
 * The backend recovers the signer, requires it == Site.owner, and rejects a `ts`
 * outside its freshness window. */
export const buildDeployLinkAuthMessage = (
  domain: string,
  siteId: string,
  ts: number,
): string => `Suize Deploy\nlink ${domain} -> ${siteId}\n@${ts}`;

/** Personal message for UNLINKING `domain`, bound to a client `ts` (ms epoch). */
export const buildDeployUnlinkAuthMessage = (
  domain: string,
  ts: number,
): string => `Suize Deploy\nunlink ${domain}\n@${ts}`;

// NOTE (x402 V2 pivot 2026-06-12): the renewal-join auth-message builders
// (buildDeployRenewalLink/UnlinkAuthMessage) are DELETED — there is no
// subscription↔site registry to link/unlink anymore (storage auto-renewal rides the
// standalone `subs` module; the join is the subscription's on-chain `ref` = the site id).

/**
 * SSL-provisioning status for a linked custom domain (Cloudflare-for-SaaS
 * adapter). Mirrors the backend's `CustomHostnameStatus` structurally — shared has
 * zero runtime deps, so the shape is restated here, not imported. Present on a
 * verify response only when the on-chain link succeeded.
 */
export type DomainSslStatus =
  | { provisioned: true; hostnameId: string; sslStatus: string }
  | { provisioned: false; reason: 'not-configured' }
  | { provisioned: false; reason: 'error'; detail: string };

/**
 * POST /domains response body — the DNS-ownership challenge + target records.
 * `status` is `pending` (TXT not yet verified, on-chain link not run) or `linked`
 * (TXT verified AND `link_domain` landed) — there is no separate intermediate
 * state. `txtName`/`txtValue` are the `_suize-verify.<domain>` TXT record to add;
 * `cname` is the `<subdomain>.suize.site` target to CNAME the apex/host at.
 *
 * The optional fields ride on specific outcomes:
 * - `txtOk` — the ownership TXT record (`_suize-verify.<domain>`) is present + matches.
 * - `cnameOk` — the domain's CNAME routes to our `cname` target (it will actually serve).
 *   BOTH must be true before the on-chain `link_domain` runs; while either is false the
 *   response is `status:"pending"` with a `detail` naming the missing/propagating record.
 * - `sslStatus` — the custom-domain SSL state on a `linked` response: the Cloudflare
 *   custom-hostname provisioning state (`"pending"`/`"active"`/`"error"`) when the CF
 *   adapter is on, or `"manual"` when it is off (the user CNAMEs + handles SSL themselves).
 * - `detail` — a still-`pending` reason (which DNS record is missing/propagating).
 * - `digest` — the `link_domain` tx digest (only on a successful `linked`).
 * - `ssl` — the best-effort Cloudflare SSL provisioning result (only on `linked`).
 * - `instructions` — manual-CNAME guidance when the CF adapter is off (`linked`).
 *
 * The verify/unlink step's owner auth is STATELESS: the client signs
 * `buildDeployLinkAuthMessage(domain, siteId, ts)` with a fresh `ts` (ms epoch) it
 * picks itself — no server-issued nonce is needed (THE PRINCIPLE: no shared store).
 */
export interface DomainChallengeResponse {
  domain: string;
  status: 'pending' | 'linked';
  txtName: string;
  txtValue: string;
  cname: string;
  /** Ownership TXT verified (present + matches the challenge nonce). */
  txtOk?: boolean;
  /** Routing CNAME verified (the domain points at our `cname` target). */
  cnameOk?: boolean;
  /** SSL state: CF custom-hostname status (`pending`/`active`/`error`), or `manual` when CF is off. */
  sslStatus?: 'pending' | 'active' | 'error' | 'manual';
  detail?: string;
  digest?: string;
  ssl?: DomainSslStatus;
  instructions?: string;
}
