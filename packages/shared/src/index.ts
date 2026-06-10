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

/** Public JSON-RPC fullnode URL for a given Sui network (the default RPC; each runtime may override via its env). */
export const fullnodeUrl = (network: SuiNetwork): string =>
  `https://fullnode.${network}.sui.io:443`;

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

// ---------------------------------------------------------------------------
// On-chain package ids + the exact Move targets the sponsor may sponsor.
// These are public on-chain ids — safe to commit.
// ---------------------------------------------------------------------------

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
 * Site blob-OBJECT id fields (Walrus storage extension), the shared ChargeLedger
 * (on-chain single-use deploy-charge digests; LedgerCap-gated writes), and the
 * shared RenewalRegistry (subscription↔site join for storage auto-renewal).
 * PACKAGE is the package id; the four *_OBJECT ids are the shared objects created
 * by the modules' init — the deploy backend reads these to build PTBs, the
 * worker reads them to resolve + serve sites.
 * Caps from this publish (held by the publisher/CLI dev wallet 0x087aa862…):
 * version::AdminCap 0x6dccadf4…, charge_ledger::LedgerCap 0xb70219fc…,
 * UpgradeCap 0xc655cb7f….
 */
const DEPLOY_PACKAGE =
  '0x9a769a50014208e54c9deb446fd694e54e0d3000fd7d4ceebe5391df01a90ad4';
const DEPLOY_VERSION_OBJECT =
  '0x9e919cb20f1f62871e231a984d143184698de26ee8060b4a3bbe4b1abf960ebf';
const DEPLOY_DOMAIN_REGISTRY_OBJECT =
  '0x7e7fe6245aed8ed86b81bb0c793de06639a2eb595fbe17700f5be6599151041e';
const DEPLOY_CHARGE_LEDGER_OBJECT =
  '0x2d6ff597351d63c3c1fb60b73cd2dd8e7a002cadc3c3b25a7ac6ba7fc5f9664e';
const DEPLOY_RENEWAL_REGISTRY_OBJECT =
  '0xf66b25dfce7c86e926464e21ba3fb534bdca1baef407aa222b09295feb027dc6';

/**
 * Account Move package (`suize::account`) — the v1 PAY core. PLACEHOLDER id until
 * the `account` module is published to testnet (it currently lives unpublished at
 * packages/move-wallet/sources/account.move; the legacy mandate/vault/swap/navi
 * package above is a DIFFERENT publish). `0x0` until then — the wallet reads this id
 * from here per the single-source-of-truth rule, so the moment `account` publishes,
 * setting this one constant lights up every live write/read in apps/wallet.
 *
 * The Account is generic over the settlement coin (`Account<USDC>` in production —
 * Circle's testnet USDC, see apps/wallet/src/data/coins.ts). The state-changing
 * targets below are the sponsorable owner/permissionless surface; the read-only
 * accessors (`balance_value` / `subscription_info` / …) are devInspect-only and are
 * not listed (reads are never signed/sponsored).
 */
// PUBLISHED to testnet 2026-06-10 (digest 7yrZfyhbaGxAnx7VNm9qSxiR3QVz9EQF1nDvFCAYMYx3)
// from the CLI dev wallet 0x087aa862… — which therefore holds the RailAdminCap
// (0x234f822d…) + UpgradeCap (0x035edb9d…) and seeds RailConfig.fee_recipient.
// Mainnet stays '0x0' in NETWORK_ADDRESSES — the mainnet publish is the v1 gate.
const ACCOUNT_PACKAGE: string =
  '0x9f4027e955a483e02def5f4b12c8c2241ab0095c5b04f2f7928869bd9bb210f3';

/**
 * The shared `RailConfig` object (`suize::account::RailConfig`) — Suize's ONE fee-policy
 * object: `{ default_fee_bps = 200, fee_recipient, overrides: Table<address,u16> }`,
 * created + shared at the account package's `init` (publish) and mutated only via the
 * `RailAdminCap`. Every CHARGE verb (`charge` / `charge_subscription` / `pay`) takes
 * this as its `&RailConfig` arg and resolves the per-merchant rate against it.
 * PLACEHOLDER `0x0` until the account package publishes — the publish step MUST capture
 * the shared `RailConfig` id from the `init` effects into this constant (sibling to the
 * DEPLOY `VERSION_OBJECT` / `DOMAIN_REGISTRY_OBJECT` shared-object slots). The backend's
 * CHARGE PTB builders + the charge gate read this id from here per the
 * single-source-of-truth rule.
 */
const ACCOUNT_RAIL_CONFIG: string =
  '0x8b32e4c3c75a6b4c97b5147327ad4b1c7fd16fcc7306c54f7c7bc5a2ff04c9ba';

/**
 * The Suize treasury — the fee recipient. Post-refactor this is no longer a per-Account
 * field: it SEEDS `RailConfig.fee_recipient` at the account package's `init` (publish),
 * and is re-set thereafter only via the admin-gated `set_fee_recipient(cap, config, addr)`.
 * The 2% CHARGE fee lands here; `spend` is free so it never routes here. PLACEHOLDER
 * `0x0` until the treasury address is pinned alongside the account publish (the publisher
 * then runs `set_fee_recipient` to point `RailConfig.fee_recipient` at this address).
 */
// TESTNET DEV: the CLI default account plays every role (owner directive
// 2026-06-10 — no role-address ceremony in dev). It published the rail, so it IS
// RailConfig.fee_recipient already. Real treasury address lands at mainnet pin.
export const SUIZE_TREASURY: string =
  '0x087aa862ca645c0b94400c49e11b491011fca35db837361ccfc4c6f69d356e86';

/**
 * The DEPLOY MERCHANT address — the `merchant` argument the deploy `charge` ($0.50)
 * pays. This is the Deploy-by-Suize business's receiving address (where the $0.50
 * net lands; the 2% fee splits off to `RailConfig.fee_recipient`, i.e. the Suize
 * treasury — the rate is now resolved per-merchant from the shared `RailConfig`, not
 * from any Account). It is DISTINCT from `SUIZE_TREASURY` (the protocol fee recipient):
 * one is "the merchant being paid," the other is "the rail's cut." For the demo the
 * deploy service wallet can BE the merchant (it then both receives the $0.50 net and
 * pays the on-chain Site gas). PLACEHOLDER `0x0` until the owner pins the merchant
 * address. The backend's deploy-charge join reads this as the charge merchant.
 */
// TESTNET DEV: same CLI default account as SUIZE_TREASURY (merchant == treasury
// == publisher in dev). Distinct receive-only merchant address lands at mainnet.
export const SUIZE_DEPLOY_MERCHANT: string =
  '0x087aa862ca645c0b94400c49e11b491011fca35db837361ccfc4c6f69d356e86';

/** The price (in native USDC base units, 6 decimals) of one one-off deploy charge: $0.50 = 500_000. */
export const DEPLOY_CHARGE_AMOUNT = 500_000;

/**
 * The Deploy subscription — $19.99/mo (price placeholder, owner-flagged), unlocking
 * (a) custom domains and (b) Suize auto-renewing the site's Walrus storage via
 * `charge_subscription` (LOCKED #10). PRICE is what each period debits; PERIOD_CAP
 * is the on-chain per-period ceiling the owner signs at `create_subscription`
 * (slight headroom over the price — the cap is the LEASH, the price is policy);
 * PERIOD_MS is the recurring interval (30 days). The relayer charges PRICE, never
 * more — `EOverPeriodCap` is physics if it ever tried.
 */
export const DEPLOY_SUB_PRICE_USDC = 19_990_000;
export const DEPLOY_SUB_PERIOD_CAP = 20_000_000;
export const DEPLOY_SUB_PERIOD_MS = 2_592_000_000;

/** True once the Deploy merchant address has been pinned (no longer the 0x0 placeholder). */
export const DEPLOY_MERCHANT_SET: boolean = SUIZE_DEPLOY_MERCHANT !== '0x0';

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
    COIN_ZERO: `0x2::coin::zero`,
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
  chargeLedger: string;
  renewalRegistry: string;
}) => ({
  PACKAGE: ids.pkg,
  VERSION_OBJECT: ids.version,
  DOMAIN_REGISTRY_OBJECT: ids.registry,
  // Shared ChargeLedger (`charge_ledger::ChargeLedger`) — on-chain single-use
  // deploy-charge digests (Table<String, ID>). Writes are LedgerCap-gated (the
  // deploy service wallet) so a settled digest can't be front-run-recorded by an
  // attacker to brick a paid deploy; Table key uniqueness is the replay physics.
  CHARGE_LEDGER_OBJECT: ids.chargeLedger,
  // Shared RenewalRegistry (`renewal_registry::RenewalRegistry`) — the on-chain
  // subscription↔site join the relayer reads: SubRef{account_id, sub_key} → site_id.
  RENEWAL_REGISTRY_OBJECT: ids.renewalRegistry,
  TARGETS: {
    CREATE_SITE: `${ids.pkg}::site::create_site`,
    LINK_DOMAIN: `${ids.pkg}::domain_registry::link_domain`,
    UNLINK_DOMAIN: `${ids.pkg}::domain_registry::unlink_domain`,
    RECORD_CHARGE: `${ids.pkg}::charge_ledger::record_charge`,
    LINK_RENEWAL: `${ids.pkg}::renewal_registry::link_renewal`,
    UNLINK_RENEWAL: `${ids.pkg}::renewal_registry::unlink_renewal`,
  },
});

/**
 * Account package block (`suize::account`) — the v1 PAY core (the new wallet).
 * PLACEHOLDER id (`0x0`) until `account` publishes; the wallet reads these targets
 * from here so the read-only flows render today and the writes go live the moment
 * the id is set. The sponsorable WRITE targets across the owner + permissionless +
 * admin surface; read accessors are devInspect-only and intentionally omitted.
 *   create_account     — owner mints + shares their Account (NO fee_recipient arg —
 *                         fee policy lives in the shared RailConfig, not the Account;
 *                         `create_account_with_fee` was REMOVED on-chain)
 *   deposit            — anyone tops up (owner funding the wallet)
 *   spend              — OWNER-ONLY free transfer to a payee (the PAY primitive; no config)
 *   charge             — OWNER-ONLY one-off merchant charge, 2% inline, takes &RailConfig (verb ②)
 *   charge_subscription — permissionless-but-terms-gated, takes &RailConfig (backend relayer, verb ③)
 *   pay                — PERMISSIONLESS raw-payer facilitator, takes &RailConfig, no payer Account (verb ④)
 *   withdraw           — OWNER-ONLY pull back to a Coin (returns Coin<T>)
 *   create_subscription / cancel_subscription — OWNER-ONLY recurring authorizations
 *   set_default_fee_bps / set_fee_recipient / set_merchant_rate / remove_merchant_rate
 *                      — ADMIN (each takes &RailAdminCap): mutate the rail fee policy in
 *                        RailConfig. Listed so they CAN be sponsored if Suize automates
 *                        rate changes (cap possession is the on-chain auth).
 *
 * The function names here MUST match `packages/move-wallet/sources/account.move`
 * verbatim — the sponsor allow-lists this exact set, so a typo silently breaks
 * sponsorship of that verb.
 */
const accountIds = (ids: { pkg: string; railConfig: string }) => ({
  PACKAGE: ids.pkg,
  // The shared `RailConfig` object id — the `&RailConfig` arg every CHARGE verb
  // (`charge` / `charge_subscription` / `pay`) takes. `0x0` until publish; the publish
  // step captures the `init`-shared `RailConfig` id into ACCOUNT_RAIL_CONFIG (above).
  RAIL_CONFIG: ids.railConfig,
  TARGETS: {
    CREATE_ACCOUNT: `${ids.pkg}::account::create_account`,
    DEPOSIT: `${ids.pkg}::account::deposit`,
    SPEND: `${ids.pkg}::account::spend`,
    CHARGE: `${ids.pkg}::account::charge`,
    CHARGE_SUBSCRIPTION: `${ids.pkg}::account::charge_subscription`,
    PAY: `${ids.pkg}::account::pay`,
    WITHDRAW: `${ids.pkg}::account::withdraw`,
    CREATE_SUBSCRIPTION: `${ids.pkg}::account::create_subscription`,
    CANCEL_SUBSCRIPTION: `${ids.pkg}::account::cancel_subscription`,
    // Admin (RailAdminCap-gated) fee-policy mutators — sponsorable so Suize can
    // automate rate changes; possession of the cap is the on-chain authority.
    SET_DEFAULT_FEE_BPS: `${ids.pkg}::account::set_default_fee_bps`,
    SET_FEE_RECIPIENT: `${ids.pkg}::account::set_fee_recipient`,
    SET_MERCHANT_RATE: `${ids.pkg}::account::set_merchant_rate`,
    REMOVE_MERCHANT_RATE: `${ids.pkg}::account::remove_merchant_rate`,
  } as Record<string, string>,
});

/**
 * Per-network ADDRESS SLOTS for the network-keyed blocks. Mainnet is ALL '0x0'
 * placeholders until the mainnet publish/republish (LOCKED #12 — publishing
 * `account` to mainnet is the v1 gate; `deploy_sui` mainnet is a republish).
 * CRASH is deliberately ABSENT here — it is network-pinned (CRASH_TESTNET_IDS).
 */
const NETWORK_ADDRESSES: Record<
  SuiNetwork,
  {
    wallet: string;
    deploy: {
      pkg: string;
      version: string;
      registry: string;
      chargeLedger: string;
      renewalRegistry: string;
    };
    account: { pkg: string; railConfig: string };
  }
> = {
  testnet: {
    wallet: WALLET_PACKAGE,
    deploy: {
      pkg: DEPLOY_PACKAGE,
      version: DEPLOY_VERSION_OBJECT,
      registry: DEPLOY_DOMAIN_REGISTRY_OBJECT,
      chargeLedger: DEPLOY_CHARGE_LEDGER_OBJECT,
      renewalRegistry: DEPLOY_RENEWAL_REGISTRY_OBJECT,
    },
    account: { pkg: ACCOUNT_PACKAGE, railConfig: ACCOUNT_RAIL_CONFIG },
  },
  mainnet: {
    wallet: '0x0',
    deploy: {
      pkg: '0x0',
      version: '0x0',
      registry: '0x0',
      chargeLedger: '0x0',
      renewalRegistry: '0x0',
    },
    account: { pkg: '0x0', railConfig: '0x0' },
  },
};

/**
 * The network-keyed package-id table. WALLET / DEPLOY / ACCOUNT resolve from
 * NETWORK_ADDRESSES[network]; CRASH is ALWAYS the testnet ids (LOCKED #11/#12 —
 * Crash is network-pinned, the mainnet flip never drags it along).
 */
export const packageIds = (network: SuiNetwork) => ({
  CRASH: CRASH_TESTNET_IDS,
  WALLET: walletIds(NETWORK_ADDRESSES[network].wallet),
  DEPLOY: deployIds(NETWORK_ADDRESSES[network].deploy),
  ACCOUNT: accountIds(NETWORK_ADDRESSES[network].account),
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
 * Flat list of the `account` write targets (the v1 PAY core: create/deposit/spend/
 * charge/charge_subscription/pay/withdraw/sub create+cancel + the four RailAdminCap-gated
 * fee-policy mutators). `RAIL_CONFIG` is a sibling key on the ACCOUNT block, NOT in
 * TARGETS, so it is correctly excluded from this flatten (it is an object id, not a
 * move target). The sponsor allow-lists these so the gasless wallet can call ONLY the
 * Account surface; every one is gated on-chain (owner-only spend/charge/withdraw/sub-ops;
 * terms-gated charge_subscription; pay is permissionless but takes only the handed-in
 * coin; the admin setters take &RailAdminCap), so listing our own functions is safe.
 * Placeholder package id until `account` publishes
 * — the sponsor MUST union these in ONLY when ACCOUNT_PUBLISHED is true, else a `0x0`
 * target poisons the allow-list (Enoki would match a `0x0::account::*` call).
 */
export const ACCOUNT_MOVE_TARGETS: string[] = Object.values(PACKAGE_IDS.ACCOUNT.TARGETS);

/** True once the `account` package has been published (its id is no longer the 0x0 placeholder). */
export const ACCOUNT_PUBLISHED: boolean = PACKAGE_IDS.ACCOUNT.PACKAGE !== '0x0';

/**
 * True once the shared `RailConfig` object id has been captured from the account
 * package's `init` effects (no longer the 0x0 placeholder). Every CHARGE PTB needs this
 * id as its `&RailConfig` arg, so the CHARGE gates require it ALONGSIDE ACCOUNT_PUBLISHED.
 */
export const RAIL_CONFIG_SET: boolean = PACKAGE_IDS.ACCOUNT.RAIL_CONFIG !== '0x0';

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
// WAL gas). POST /deploy is AUTHENTICATED — every deployer Google-logs-in (dashboard
// via zkLogin, the future MCP via OAuth → a Suize wallet) and signs a single-use
// server nonce (buildDeployAuthMessage); the on-chain `owner` is ALWAYS the
// cryptographically-recovered signer. There is NO anonymous/service-owned deploy.
// See docs/deploy/SPEC.md.
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
// CHARGE↔Deploy join wire types — the payment-gated deploy. A deploy is now a
// one-off $0.50 `charge` on the rail BEFORE the Walrus upload + Site mint runs.
// The flow is three steps because the backend NEVER signs an owner tx (it only
// builds the sponsored bytes the caller's LOCAL zkLogin session signs):
//
//   1. POST /deploy/quote   -> a 402-shaped quote { price, merchant, feeBps, … }.
//   2. POST /deploy/charge  -> the backend builds + Enoki-SPONSORS the `charge`
//      ($0.50) PTB for the caller's Account; the caller signs `bytes` locally and
//      submits via POST /execute (the existing sponsor execute path), getting back
//      the charge tx digest.
//   3. POST /deploy (existing) carrying { chargeDigest } -> the backend VERIFIES the
//      charge settled (a ChargePaid event paying the Deploy merchant ≥ $0.50, not
//      already consumed) and ONLY THEN runs the Walrus upload + Site mint.
//
// All three are 503-gated until PACKAGE_IDS.ACCOUNT is published AND the Deploy
// merchant address is pinned (mirrors the deploy module's 0x0-package gate).
// ---------------------------------------------------------------------------

/**
 * GET/POST /deploy/quote response — the 402-shaped price the caller must settle
 * before a deploy runs. `amount` is in native USDC base units (6 decimals; $0.50 =
 * 500_000); `merchant` is the Deploy merchant address the `charge` pays; `feeBps` is
 * the rail's 2% (emitted in the event, visible by design); `coinType` is the
 * settlement coin (testnet USDC). `payVerb` names the primary rail verb for a
 * wallet-holding agent (`charge` — a funded Suize Account); a raw-coin payer would
 * use `pay` instead (not built in this join — the demo path is the Account holder).
 */
export interface DeployQuoteResponse {
  amount: number;
  coinType: string;
  merchant: string;
  feeBps: number;
  payVerb: 'charge';
  /** Human-readable, e.g. "$0.50 per deploy (one-off)". */
  description: string;
}

/**
 * POST /deploy/charge request — the caller asks the backend to build the sponsored
 * `charge` ($0.50) PTB for THEIR Account. `account` is the caller's shared Account
 * object id; `sender` is the caller's zkLogin owner address (it MUST equal the
 * Account's `owner`, since `charge` is owner-only — the backend pins it as the
 * sponsored `sender`). `memo` is an optional UTF-8 note recorded in the ChargePaid
 * event (defaults to a deploy tag).
 */
export interface DeployChargeRequest {
  account: string;
  sender: string;
  memo?: string;
}

/**
 * POST /deploy/charge response — the SPONSORED `charge` tx the caller signs locally.
 * `bytes` (base64) is signed VERBATIM with the caller's zkLogin session, then
 * `{ digest, signature }` is submitted to POST /execute (the existing sponsor execute
 * path). `digest` is echoed back to /execute. `amount`/`merchant` echo the quote so
 * the caller can show what it is signing. The resulting executed digest becomes the
 * `chargeDigest` the caller passes to POST /deploy.
 */
export interface DeployChargeResponse {
  bytes: string;
  digest: string;
  amount: number;
  merchant: string;
}

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
 * IS the requester. `nonce` is the single-use token from `GET /auth/nonce` (or
 * the issue-step response); `signature` is base64 of the personal-message sig.
 */
export interface DomainLinkVerifyRequest {
  siteId: string;
  domain: string;
  nonce: string;
  signature: string;
}

/**
 * DELETE /domains/:domain request body — UNLINK. Same cryptographic authority as
 * the link-verify path: the client signs `buildDeployUnlinkAuthMessage(domain,
 * nonce)`; the backend recovers the signer and requires it to equal the
 * `Site.owner` of the site the domain currently points at. No `requester`.
 */
export interface DomainUnlinkRequest {
  nonce: string;
  signature: string;
}

/** GET /auth/nonce response body — a single-use, short-TTL, CSPRNG nonce (hex). */
export interface DeployNonceResponse {
  nonce: string;
}

/**
 * POST /deploy/renewal request — link a rail subscription to a site's Walrus
 * auto-renewal. `accountId` is the payer's shared rail Account object id; `subKey`
 * the u64 subscription key from `SubscriptionCreated`; `signature` is over
 * `buildDeployRenewalLinkAuthMessage(siteId, accountId, subKey, nonce)`. The
 * backend verifies ON-CHAIN that the recovered signer == Account.owner, that the
 * subscription exists with payee == SUIZE_DEPLOY_MERCHANT and period_cap >=
 * DEPLOY_SUB_PRICE_USDC, then cap-signs `renewal_registry::link_renewal`.
 */
export interface DeployRenewalLinkRequest {
  siteId: string;
  accountId: string;
  subKey: number;
  nonce: string;
  signature: string;
}

/** DELETE /deploy/renewal request — unlink (signature over the unlink message). */
export interface DeployRenewalUnlinkRequest {
  accountId: string;
  subKey: number;
  nonce: string;
  signature: string;
}

/** POST/DELETE /deploy/renewal response — the on-chain link/unlink tx digest. */
export interface DeployRenewalResponse {
  siteId: string;
  accountId: string;
  subKey: number;
  digest: string;
}

// ---------------------------------------------------------------------------
// Deploy domain-op AUTH MESSAGE BUILDERS — the EXACT personal-message strings the
// client signs and the backend reconstructs to recover the requester address.
// SHARED so the format can NEVER drift between the dashboard signer and the
// backend verifier (LOCKED-DECISION #5). Each message binds to (a) the exact
// operation + its params and (b) a server-issued single-use nonce, so a captured
// signature can't be replayed against a different op or after the nonce is burned.
// ---------------------------------------------------------------------------

/**
 * Personal message a DEPLOYER signs to prove they are the authenticated owner of
 * the deploy they're about to make. A deploy can't bind to a siteId — the Site
 * doesn't exist until create_site runs — so the message binds ONLY the signer (via
 * the recovered address) + a server-issued single-use `nonce`. The backend recovers
 * the signer and uses it AS the on-chain `owner`, so a caller can only ever set
 * THEMSELVES as owner — there is no anonymous/service-owned deploy path.
 */
export const buildDeployAuthMessage = (nonce: string): string =>
  `Suize Deploy\ndeploy\n::${nonce}`;

/** Personal message for LINKING `domain` -> `siteId`, bound to single-use `nonce`. */
export const buildDeployLinkAuthMessage = (
  domain: string,
  siteId: string,
  nonce: string,
): string => `Suize Deploy\nlink ${domain} -> ${siteId}\n::${nonce}`;

/** Personal message for UNLINKING `domain`, bound to single-use `nonce`. */
export const buildDeployUnlinkAuthMessage = (
  domain: string,
  nonce: string,
): string => `Suize Deploy\nunlink ${domain}\n::${nonce}`;

/**
 * Personal message for LINKING a rail subscription (`accountId` + `subKey`) to a
 * site's auto-renewal, bound to a single-use `nonce`. The backend recovers the
 * signer and requires it to equal the rail `Account.owner` ON-CHAIN — only the
 * person whose Account gets debited can authorize the join, so a site owner can
 * never renew on a stranger's subscription.
 */
export const buildDeployRenewalLinkAuthMessage = (
  siteId: string,
  accountId: string,
  subKey: number,
  nonce: string,
): string => `Suize Deploy\nlink-renewal ${accountId}#${subKey} -> ${siteId}\n::${nonce}`;

/** Personal message for UNLINKING a subscription's renewal, bound to `nonce`.
 * Accepted from EITHER the Account.owner (stop my sub renewing) or the
 * Site.owner (stop renewing my site) — the backend checks both. */
export const buildDeployRenewalUnlinkAuthMessage = (
  accountId: string,
  subKey: number,
  nonce: string,
): string => `Suize Deploy\nunlink-renewal ${accountId}#${subKey}\n::${nonce}`;

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
 * - `nonce` — a fresh single-use auth nonce, issued on the ISSUE step (verify=0)
 *   for the client to sign (`buildDeployLinkAuthMessage`) on the verify step.
 */
export interface DomainChallengeResponse {
  domain: string;
  status: 'pending' | 'linked';
  txtName: string;
  txtValue: string;
  cname: string;
  /** Single-use auth nonce to sign for the verify step (present on the issue step). */
  nonce?: string;
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
