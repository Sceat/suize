/**
 * @suize/shared — the single source of truth shared by every app + service.
 *
 * Lives at the root of the Bun workspace so the product frontend, the deploy
 * worker, and the facilitator all import the SAME network constant, on-chain
 * package ids, and deploy wire types. Pure types + constants — no runtime deps.
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
 * (decimals 6, symbol "USDC"; testnet value verified live via getCoinMetadata).
 * Mainnet is Circle's NATIVE USDC (a RegulatedCoin — orthogonal to
 * non-custodial). The `Account<USDC>`
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

/**
 * Walrus on-chain ids per network: the shared `System` object (its `package_id`
 * field is read at runtime so a Walrus package upgrade never strands an extend)
 * and the WAL coin type `system::extend_blob` payments are drawn from.
 * MAINNET values are VERIFY-AT-FLIP (the T-009 gate) — confirm against the live
 * Walrus deployment before any mainnet extend runs.
 */
export const WALRUS_IDS: Record<SuiNetwork, { systemObject: string; walCoinType: string }> = {
  testnet: {
    systemObject: '0x6c2547cbbc38025cf3adac45f63cb0a8d12ecf777cdc75a4971612bf97fdf6af',
    walCoinType: '0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL',
  },
  mainnet: {
    systemObject: '0x2134d52768ea07e8c43570ef975eb3e4c27a39fa6396bef985b5abc58d03ddd2',
    walCoinType: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
  },
};

/**
 * Seal key-server object ids per network (free, keyless, OPEN-mode key servers
 * registered on-chain). Sealed (private) sites encrypt/decrypt against these —
 * the worker (encrypt at publish) and the viewer (decrypt in-browser) MUST use
 * the exact same set. Testnet is Mysten's two open servers; mainnet is a three-
 * operator committee of verified free Open-mode servers (live-probed 2026-07-15,
 * each answering GET <url>/v1/service?service_id=<id> with a valid pop).
 * These ids are MONEY-CRITICAL: a wrong id encrypts a paid site against a
 * nonexistent committee and it is undecryptable forever.
 */
export const SEAL_KEY_SERVERS: Record<SuiNetwork, string[]> = {
  testnet: [
    '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75', // mysten-testnet-1
    '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8', // mysten-testnet-2
  ],
  mainnet: [
    '0x1afb3a57211ceff8f6781757821847e3ddae73f64e78ec8cd9349914ad985475', // NodeInfra
    '0x145540d931f182fef76467dd8074c9839aea126852d90d18e1556fcbbd1208b6', // Overclock
    '0xe0eb52eba9261b96e895bbb4deca10dcd64fbc626a1133017adcd5131353fd10', // Studio Mirai
  ],
};

/**
 * Seal decryption threshold per network. INVARIANT: this is the SAME number at
 * encrypt (the worker) and at fetchKeys (the viewer) — a mismatch makes paid
 * sites undecryptable. It must be <= the server count for that network. Mainnet
 * is 2-of-3 so one operator being down or disappearing never bricks a paid site;
 * testnet is 2-of-2 (Mysten's two open servers).
 */
export const SEAL_THRESHOLD: Record<SuiNetwork, number> = {
  testnet: 2,
  mainnet: 2,
};

// ---------------------------------------------------------------------------
// On-chain package ids + the deploy_sui Move-call targets. These are public
// on-chain ids — safe to commit.
// ---------------------------------------------------------------------------

/**
 * Deploy Move package (`deploy_sui`) — v2 REPUBLISHED to testnet 2026-06-10
 * (publish digest Gkg5FJPAkf8pPAM7w24gTWzVFN3N17uxBTnihtBkhiwu; the 2026-06-06
 * v1 publish 0xadcc8d… is abandoned — its Sites/domains are orphaned). v2 adds:
 * Site blob-OBJECT id fields (Walrus storage extension). PACKAGE is the package id;
 * the two *_OBJECT ids are the shared objects created by the modules' init — the
 * deploy worker reads these to build PTBs and to resolve + serve sites.
 *
 * NOTE (x402 V2 pivot 2026-06-12): the `charge_ledger` + `renewal_registry` modules
 * were REMOVED from move-deploy (deploy billing is now x402-exact settlements via
 * the keyless facilitator; storage renewal is now the prepaid-months model below —
 * `extend_site` buys more months, no subscription module). Their two shared objects
 * from THIS testnet publish are orphaned-harmless (nothing references them); the
 * MAINNET republish excludes both modules.
 * REPUBLISHED on testnet 2026-06-14 (publish digest BQ7Pna6hwEutTeJCpvtFKivxy9MP6RHYfJHgQZEY2UQB)
 * to add the on-chain ONE-SITE-PER-PAYMENT guard: `site::create_site` now takes a
 * settled payment digest + the shared `SiteDigestRegistry` and aborts `EDigestUsed`
 * (site.move code 0) if the digest already minted a site — the chain is the atomic
 * dedup lock (multi-replica-safe; replaces the old in-memory settledDeploys map).
 * Caps from this publish: the DeployerCap 0xfcdbc25d… (the create_site mint authority —
 * gates Site minting to the paid worker) was minted to the publisher 0x087aa862… then
 * TRANSFERRED to the prod deploy service wallet 0xcc58bc00… (agent@suize, which signs
 * create_site in prod and already holds the SiteAdminCaps — digest mLcJFogd…). The cap's
 * CUSTODY == the mint trust root (a hot-wallet single point of failure; see
 * services/deploy-worker/README.md). version::AdminCap 0x6aa982b5… + UpgradeCap 0x81f93227… stay on the
 * CLI publisher. (2026-06-14 republish `6kAxGVLn…` adds the DeployerCap gate — Move audit.)
 */
// v4 REPUBLISHED to testnet 2026-07-12 (digest 4LLhhe1gikCYQP4aYbq9CpeuGpf7VatVYh8wbR56N5dH,
// publisher = the `suize-deploy` CLI wallet 0x171a87c1…). Prepaid-months model: Site carries
// `paid_until_ms` (mutable, via `extend_site`) + `sealed`; the `allowlist` module (Seal access
// control for private sites — DeployerCap-gated creation, owner-held AllowlistCap, `seal_approve`
// un-version-gated so an upgrade freeze can't brick decryption). v4 supersedes v3 (0x437d0a29…)
// with the MONEY-HAT fix: `extend_site` now takes a Clock + a RELATIVE `add_ms` and computes the
// new paid-through on-chain as max(now, paid_until)+add — so two concurrent extenders can't strand
// one's funds on a stale absolute target, and a lapsed site gets the full purchased time; plus
// `site_for_digest` (the digest→site audit read the worker's recovery path uses after an
// already-consumed retry). v2/v3 abandoned in place. version::AdminCap 0x5abd2300… + UpgradeCap
// 0x89acb559… stay on the publisher wallet.
const DEPLOY_PACKAGE =
  '0x41cc6bab26d2b7b63c47f1dcc2bf1494cbee798cd47cc2115100d7e1cd71ac36';
const DEPLOY_VERSION_OBJECT =
  '0xd97828ae3e5ca26f7aa712a8d9af4a65b65bc49c404c97ad89b62ac1d0b0fbfa';
const DEPLOY_DOMAIN_REGISTRY_OBJECT =
  '0x11d7efed38c1a4e98fa1cd68b2e236b3c459eb583e316f28a96b8aa1b5afd6aa';
const DEPLOY_SITE_DIGEST_REGISTRY_OBJECT =
  '0xe5928ef6b1ae7418876c567a916aca38e2c5cb7d546412eadb43370afa9092e8';
/** The owned `DeployerCap` (held by the deploy service wallet — `suize-deploy`,
 *  0x171a87c1… on testnet): the mint authority `create_site` + `extend_site` +
 *  `allowlist::create_for_owner` require — only the paid worker can mint/extend,
 *  so every on-chain field is service-attested. Custody == the mint trust root. */
const DEPLOY_DEPLOYER_CAP_OBJECT =
  '0xa9c5279717fb0d5cb2b334dab814e6e6dee71128400b735dcc9af9d195cbe05a';

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
 *  `SuiClient` exposes `resolveNameServiceAddress` natively; a gRPC client has no
 *  such method, so it needs a thin adapter over `NameService.lookupName` conforming
 *  to this shape. Either satisfies this. */
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

// ---------------------------------------------------------------------------
// Deploy pricing — PREPAID MONTHS (owner-locked 2026-07-10; one-shot cap
// 2026-07-13). One flat rate: $0.10 per month of hosting; extend = buy more
// months at the same rate. The prepay ceiling is what Walrus can fund in ONE
// store (WALRUS_MAX_EPOCHS_AHEAD), DERIVED per network by maxDeployMonths (about
// two years on mainnet); there is no permanent tier and no drip-funding cron.
// Sealed (Seal-encrypted private) sites pay 2×. Custom domains are a separate
// $19.99/year one-off. A "month" is 30 days flat: the commercial month every
// price and expiry computes with. The worker enforces these at the charge door;
// the MCP + gallery quote with the SAME helpers (one home for the math).
// ---------------------------------------------------------------------------

/** One pricing month: 30 days flat, in ms. */
export const DEPLOY_MONTH_MS = 2_592_000_000;

/** The price of ONE month of hosting, in USDC base units (6 decimals): $0.10. */
export const DEPLOY_PRICE_PER_MONTH_USDC = 100_000;

/** Sealed (private, Seal-encrypted) sites pay this multiple of the flat rate. */
export const DEPLOY_SEALED_MULTIPLIER = 2;

/** A custom domain costs this per YEAR (charged at link, re-paid yearly): $19.99. */
export const DOMAIN_PRICE_PER_YEAR_USDC = 19_990_000;

/**
 * Walrus protocol ring-buffer length: the furthest-ahead epoch a single store or
 * extend may fund (the System object's `future_accounting` ring). A protocol
 * constant on BOTH networks, verified on-chain 2026-07-13. Storage is funded in
 * ONE shot at deploy/extend time (there is no drip-funding cron), so a purchase
 * can never reach past `currentEpoch + WALRUS_MAX_EPOCHS_AHEAD`; the max prepay
 * horizon is DERIVED from it per network by `maxDeployMonths`.
 */
export const WALRUS_MAX_EPOCHS_AHEAD = 53;

/**
 * How many Walrus epochs cover `months` of hosting on `net` — ceil'd, so the
 * rounding always over-provisions in the buyer's favor (testnet ~1-day epochs
 * → 30/month; mainnet 14-day epochs → 1 month = 3 epochs). The whole purchase is
 * stored in one shot, so this stays within `WALRUS_MAX_EPOCHS_AHEAD`: exactly
 * what `maxDeployMonths` caps `months` to.
 */
export const deployEpochsForMonths = (months: number, net: SuiNetwork): number =>
  Math.ceil((months * DEPLOY_MONTH_MS) / WALRUS_EPOCHS[net].durationMs);

/**
 * The largest whole months of hosting Walrus can fund in ONE store on `net`: the
 * biggest month count whose `deployEpochsForMonths` still fits within
 * `WALRUS_MAX_EPOCHS_AHEAD`. DERIVED per network, never hardcoded per env — with
 * mainnet's 14-day epochs this is 24 months (about two years); with testnet's
 * 1-day epochs it collapses to 1. One month always fits, so the result is >= 1.
 */
export const maxDeployMonths = (net: SuiNetwork): number => {
  let months = 1;
  while (deployEpochsForMonths(months + 1, net) <= WALRUS_MAX_EPOCHS_AHEAD) months++;
  return months;
};

/**
 * The absolute prepay ceiling in months: the mainnet-derived cap (the largest of
 * any network). It is the outer bound the pure price function guards against; the
 * tighter per-network gate is `maxDeployMonths(net)`, applied at the charge door
 * before a quote. Mainnet today: 24 months ($2.40 public, $4.80 sealed).
 */
export const DEPLOY_MAX_MONTHS = maxDeployMonths('mainnet');

/**
 * The exact USDC amount (base units) a deploy or extend of `months` costs.
 * Throws on a non-integer / out-of-range month count — the charge door surfaces
 * that as a 400, never a mis-priced 402. `months` is bounded by the absolute
 * ceiling here; the tighter per-network cap is enforced at the route.
 */
export const deployPriceUsdc = (months: number, sealed: boolean): number => {
  if (!Number.isInteger(months) || months < 1 || months > DEPLOY_MAX_MONTHS) {
    throw new RangeError(`months must be an integer in [1, ${DEPLOY_MAX_MONTHS}]`);
  }
  return months * DEPLOY_PRICE_PER_MONTH_USDC * (sealed ? DEPLOY_SEALED_MULTIPLIER : 1);
};

// ── The upload cap: Walrus storage cost ─────────────────────────────────────
// A site may not cost more than $0.05/month of Walrus storage (owner law
// 2026-07-10) — the floor that guarantees ≥50% margin on the largest allowed
// site. Cost model (Walrus mainnet, USD-pegged): bytes are ~5× erasure-encoded,
// and EACH blob pays a ~64 MiB metadata floor — a deploy writes TWO blobs (the
// quilt + the manifest). ≈420 MiB raw passes; today the CF-Worker ~100 MB
// ingress ceiling binds first, so this guard is the future-proof outer wall.

/** The hard ceiling on a site's monthly Walrus storage cost, in USD. */
export const MAX_SITE_WALRUS_USD_PER_MONTH = 0.05;

/** Walrus storage price: USD per GiB of ENCODED bytes per month (USD-pegged). */
export const WALRUS_USD_PER_GIB_ENCODED_MONTH = 0.023;

/** Erasure-coding expansion: encoded size ≈ raw × this. */
export const WALRUS_ENCODING_FACTOR = 5;

/** Per-blob metadata floor, bytes (~64 MiB — dominates small blobs). */
export const WALRUS_BLOB_METADATA_BYTES = 64 * 1024 ** 2;

/** A deploy writes this many Walrus blobs (site quilt + manifest). */
export const DEPLOY_BLOB_COUNT = 2;

/** The estimated monthly Walrus storage cost (USD) of a site of `rawBytes`. */
export const walrusMonthlyCostUsd = (rawBytes: number): number =>
  ((rawBytes * WALRUS_ENCODING_FACTOR + DEPLOY_BLOB_COUNT * WALRUS_BLOB_METADATA_BYTES) /
    1024 ** 3) *
  WALRUS_USD_PER_GIB_ENCODED_MONTH;

/** True when a bundle of `rawBytes` is within the $0.05/month storage-cost cap. */
export const withinUploadCap = (rawBytes: number): boolean =>
  walrusMonthlyCostUsd(rawBytes) <= MAX_SITE_WALRUS_USD_PER_MONTH;

/**
 * Deploy package block (`deploy_sui`) — PUBLISHED on testnet (real ids in the
 * DEPLOY_PACKAGE / VERSION_OBJECT / DOMAIN_REGISTRY_OBJECT consts above) AND on
 * mainnet (published 2026-07-12 — real ids in NETWORK_ADDRESSES.mainnet below).
 * The write targets are signed
 * directly by the deploy worker's OWN deploy service wallet (it pays its own gas) —
 * there is no sponsor in this path; DEPLOY_MOVE_TARGETS exports them for future use.
 * Detail: services/deploy-worker/README.md.
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
   *  forge one (free hosting / a renewer-draining Site). Mainnet cap is minted to the
   *  publisher/operator wallet, PENDING transfer to the prod service wallet. */
  DEPLOYER_CAP_OBJECT: ids.deployerCap,
  TARGETS: {
    CREATE_SITE: `${ids.pkg}::site::create_site`,
    EXTEND_SITE: `${ids.pkg}::site::extend_site`,
    LINK_DOMAIN: `${ids.pkg}::domain_registry::link_domain`,
    UNLINK_DOMAIN: `${ids.pkg}::domain_registry::unlink_domain`,
    // Seal allowlist (private sites). create is worker-signed (DeployerCap);
    // add/remove are OWNER-signed (AllowlistCap) from the dashboard;
    // seal_approve is DRY-RUN by Seal key servers, never broadcast.
    ALLOWLIST_CREATE: `${ids.pkg}::allowlist::create_for_owner`,
    ALLOWLIST_ADD: `${ids.pkg}::allowlist::add`,
    ALLOWLIST_REMOVE: `${ids.pkg}::allowlist::remove`,
    SEAL_APPROVE: `${ids.pkg}::allowlist::seal_approve`,
  },
});

/**
 * Per-network ADDRESS SLOTS for the deploy block. BOTH networks are live now:
 * testnet (v4, publish digest 4LLhhe1g…) and mainnet (published 2026-07-12,
 * publish tx 93E1S1Gb…) — see the per-network entries below (LOCKED #12 —
 * `deploy_sui` mainnet is a republish).
 */
const NETWORK_ADDRESSES: Record<
  SuiNetwork,
  {
    deploy: {
      pkg: string;
      version: string;
      registry: string;
      siteDigestRegistry: string;
      deployerCap: string;
    };
  }
> = {
  testnet: {
    deploy: {
      pkg: DEPLOY_PACKAGE,
      version: DEPLOY_VERSION_OBJECT,
      registry: DEPLOY_DOMAIN_REGISTRY_OBJECT,
      siteDigestRegistry: DEPLOY_SITE_DIGEST_REGISTRY_OBJECT,
      deployerCap: DEPLOY_DEPLOYER_CAP_OBJECT,
    },
  },
  // MAINNET deploy_sui — PUBLISHED 2026-07-12 from the operator page (publish tx
  // 93E1S1GbB3k2cDPcjp2rYS2bX3aRuK1ZFRa6LCZZ4cjt, publisher/operator wallet
  // 0x9036f4be…). `version`/`registry`/`siteDigestRegistry` are the SHARED objects
  // from the modules' init; `deployerCap` is the owned mint authority, minted to the
  // publisher 0x9036f4be… — PENDING transfer to the prod deploy service wallet
  // (custody == the mint trust root). version::AdminCap 0x69a17d3f… + package::UpgradeCap
  // 0xe5d9873b… also stay on the publisher (wallet-held, not wired into shared).
  mainnet: {
    deploy: {
      pkg: '0xec2dcd65271127019351678ddd05287176a0b9b7fc59ef6ceef34fdbc36e87db',
      version: '0xfc39ef5748bccdbbc445054940ff99bb448cf47497da71b047c1a5530bf56b4e',
      registry: '0x28d4557f9c55cdc8bb1afb98092ecfba505d8f23b0eae8a067473c2cba7a972b',
      siteDigestRegistry: '0xc95ac121e1ebc7727022c944ef573180a044360ff20208eca525dc36ea0b0ce5',
      deployerCap: '0x235e9170233b6aaa022df9cd336b12f3de5d65ac6bbf88b42ff32f56b68df59c',
    },
  },
};

/**
 * The network-keyed package-id table. DEPLOY resolves from
 * NETWORK_ADDRESSES[network] (mainnet is a republish — '0x0' until then).
 */
export const packageIds = (network: SuiNetwork) => ({
  DEPLOY: deployIds(NETWORK_ADDRESSES[network].deploy),
});

/**
 * The TESTNET table — what every shipping consumer uses today (the whole stack
 * defaults to testnet). A network-aware consumer should call
 * `packageIds(network)` with the network IT resolved from ITS env.
 */
export const PACKAGE_IDS = packageIds('testnet');

/**
 * Flat list of the deploy targets (create_site / link_domain / unlink_domain / …).
 * Exported for future use only — these are signed directly by the deploy worker's
 * own service wallet (it pays its own gas), so there is no sponsor allow-list to
 * add them to.
 */
export const DEPLOY_MOVE_TARGETS: string[] = Object.values(PACKAGE_IDS.DEPLOY.TARGETS);

// ---------------------------------------------------------------------------
// Deploy wire types — the request/response contract between agents/dashboard and
// the deploy worker's charge face (POST /deploy, GET /sites, GET /sites/:id,
// POST /domains, DELETE /domains/:domain). Sites are deployed to Walrus + a fresh
// on-chain `Site` object by the worker's OWN deploy service wallet (it pays SUI +
// WAL gas). POST /deploy is AUTHENTICATED BY THE PAYMENT ITSELF — the X-PAYMENT header
// carries a signed gasless payment, and the on-chain `owner` is ALWAYS the recovered
// payer (whoever pays, owns). There is no separate deploy-auth nonce/signature and no
// anonymous/service-owned deploy. See services/deploy-worker/README.md.
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
// 2026-06-12). A deploy is a gasless settlement on the rail BEFORE the Walrus upload
// + Site mint, priced per prepaid month at `deployPriceUsdc` (see the pricing block
// above). There are NO Suize-specific wire types here anymore: the wire is vanilla
// x402 V2 (the `PaymentRequired` body + the `X-PAYMENT` header carrying the b64
// `PaymentPayload`), so the dashboard + agents import the shapes from
// `@suize/pay` / `@suize/x402`, NOT from here. The old sub-account convenience door
// (deploy/quote · deploy/charge · deploy/execute + their request/response types) is
// DELETED — the payer pays directly from its Address Balance, keyless-settled. See
// `services/deploy-worker/src/payment.ts` + `services/deploy-worker/README.md`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Facilitator wire types — the open merchant-side door of the rail (x402 V2).
//
// NOTE (x402 V2 pivot 2026-06-12): the GET /verify {paid,gross,fee,net} shape and
// the POST /pay/build + /pay/submit sponsored-door types are DELETED. Verification
// is now the vanilla x402 POST /verify → `VerifyResponse` and POST /settle →
// `SettleResponse` (both exported from `@suize/x402` / `@suize/pay`, NOT here —
// they ride the standard wire). Payments settle KEYLESS over gRPC (no sponsor
// signs the payer leg), so there is no sponsored build/submit pair. The domain-op
// wire types below (DomainLinkRequest / DomainChallengeResponse / …) are the only
// Suize-shaped wire left in this section.
// ---------------------------------------------------------------------------

/**
 * GET /sites/:id (and the entries of GET /sites) response body.
 * `owner` is the cryptographically-recovered payer address (recovered from the
 * settled `X-PAYMENT` signature) — always a real, authenticated owner, never the
 * service wallet. `domains` are the linked custom domains.
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
}

/**
 * POST /domains?verify=0 request body — ISSUE a link challenge for a site. This
 * step writes nothing on-chain and is intentionally unauthenticated (it only mints
 * the DNS TXT/CNAME challenge material). The response (DomainChallengeResponse)
 * carries the TXT record to publish; the verify step below signs a fresh
 * client-picked timestamp, not a server-issued nonce (STATELESS, no nonce store).
 */
export interface DomainLinkRequest {
  siteId: string;
  domain: string;
}

/**
 * POST /domains?verify=1 request body — VERIFY + link on-chain. Authority is a
 * SERVER-VERIFIED zkLogin personal-message signature (op-bound + timestamp-fresh):
 * the client signs `buildDeployLinkAuthMessage(domain, siteId, ts)` with its
 * zkLogin signer; the worker reconstructs that exact message, recovers the
 * signer address via `verifyPersonalMessageSignature`, and requires it to equal
 * `Site.owner`. There is NO client-claimed `requester` — the recovered address
 * IS the requester. `ts` is the client ms-epoch timestamp the signed message binds
 * (the worker accepts it within a freshness window — STATELESS, no nonce store);
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
// renewal is now a direct prepaid-months purchase: anyone pays an `extend_site`
// x402 charge for more months at the flat per-month rate (see `deployPriceUsdc` /
// `deployEpochsForMonths` above). There is no subscription↔site registry to link.

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

/** Personal message for RE-POINTING `domain` onto `newSiteId` — moving a custom
 * domain to ANOTHER site the same owner controls, WITHOUT re-paying the yearly
 * reservation. Bound to a client `ts` (ms epoch). The backend recovers the signer
 * and requires it == the owner of BOTH the domain's currently-linked site (proves
 * domain control) AND `newSiteId` (you can only move onto a site you own). Free —
 * the reservation is already paid, so there is no payment to recover from. */
export const buildDeployRepointAuthMessage = (
  domain: string,
  newSiteId: string,
  ts: number,
): string => `Suize Deploy\nrepoint ${domain} -> ${newSiteId}\n@${ts}`;

// NOTE (x402 V2 pivot 2026-06-12): the renewal-join auth-message builders
// (buildDeployRenewalLink/UnlinkAuthMessage) are DELETED — there is no
// subscription↔site registry to link/unlink anymore (storage renewal is a direct
// prepaid `extend_site` purchase, not a subscription).

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
