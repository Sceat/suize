/**
 * @suize/shared — the single source of truth shared by every app + service.
 *
 * Lives at the root of the Bun workspace so the wallet frontend, the landing
 * page, and the unified backend all import the SAME network constant, on-chain
 * package ids, and sponsor wire types. Pure types + constants — no runtime deps.
 */

// ---------------------------------------------------------------------------
// Network — the ONE source of truth. Everything is locked to testnet.
// ---------------------------------------------------------------------------

export type SuiNetwork = 'mainnet' | 'testnet' | 'devnet';

/** The network the whole stack targets. Locked to testnet. */
export const NETWORK: SuiNetwork = 'testnet';

/** Public JSON-RPC fullnode URL for a given Sui network. */
export const fullnodeUrl = (network: SuiNetwork): string =>
  `https://fullnode.${network}.sui.io:443`;

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
 * Deploy Move package (`deploy_sui`) — NOT YET PUBLISHED to testnet.
 * `PACKAGE`, `VERSION_OBJECT`, and `DOMAIN_REGISTRY_OBJECT` below are PLACEHOLDERS
 * ('0x0') until `packages/move-deploy` is published (gated, owner-approved — see
 * docs/deploy/SPEC.md §13). Mirror of how WALLET_PACKAGE was a placeholder pre-publish:
 * after publish, overwrite these with the real package id + shared object ids.
 */
const DEPLOY_PACKAGE = '0x0';
const DEPLOY_VERSION_OBJECT = '0x0';
const DEPLOY_DOMAIN_REGISTRY_OBJECT = '0x0';

export const PACKAGE_IDS = {
  /**
   * Crash router package + its 7 sponsorable `router::*` targets, PLUS the one
   * framework helper a fully-manager-funded bet needs (`0x2::coin::zero`): after a
   * cash-out the manager holds the funds and the wallet has no dUSDC coin object, so
   * the bet PTB mints a zero Coin<DUSDC> as its (harmless) 0-value payment. It moves
   * no value — it just lets the bet build without a wallet coin to split.
   */
  CRASH: {
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
  },

  /**
   * Wallet package — LIVE on testnet. The sponsorable WRITE targets across the four
   * modules (mandate / vault / swap / navi). Read-only accessors are intentionally
   * omitted — they are never signed, only `devInspect`ed. The sponsor allow-lists
   * this exact set (via WALLET_MOVE_TARGETS) so gasless onboarding + agent moves can
   * call ONLY these; every one of them enforces the on-chain cage (budget / scope /
   * expiry / allow-list) so over-listing OUR own functions is safe.
   */
  WALLET: {
    PACKAGE: WALLET_PACKAGE,
    TARGETS: {
      // mandate — the leash (owner mint/revoke/top-up + the agent gate).
      MANDATE_CREATE: `${WALLET_PACKAGE}::mandate::create_mandate`,
      MANDATE_ISSUE_CAP: `${WALLET_PACKAGE}::mandate::issue_agent_cap`,
      MANDATE_REVOKE_CAP: `${WALLET_PACKAGE}::mandate::revoke_agent_cap`,
      MANDATE_TOP_UP: `${WALLET_PACKAGE}::mandate::top_up_budget`,
      MANDATE_SET_EXPIRY: `${WALLET_PACKAGE}::mandate::set_expiry`,
      MANDATE_CONSUME: `${WALLET_PACKAGE}::mandate::consume_budget`,
      // vault — single-coin sandbox custody (owner deposit/withdraw + agent deploy).
      VAULT_CREATE: `${WALLET_PACKAGE}::vault::create_vault`,
      VAULT_DEPOSIT: `${WALLET_PACKAGE}::vault::deposit`,
      VAULT_WITHDRAW_IDLE: `${WALLET_PACKAGE}::vault::withdraw_idle`,
      VAULT_AGENT_CONSUME: `${WALLET_PACKAGE}::vault::agent_consume`,
      // swap — DEGEN two-sided DeepBook vault (owner deposits/withdraws + agent swaps).
      SWAP_CREATE: `${WALLET_PACKAGE}::swap::create_swap_vault`,
      SWAP_DEPOSIT_BASE: `${WALLET_PACKAGE}::swap::deposit_base`,
      SWAP_DEPOSIT_QUOTE: `${WALLET_PACKAGE}::swap::deposit_quote`,
      SWAP_DEPOSIT_DEEP: `${WALLET_PACKAGE}::swap::deposit_deep`,
      SWAP_WITHDRAW_BASE: `${WALLET_PACKAGE}::swap::withdraw_base`,
      SWAP_WITHDRAW_QUOTE: `${WALLET_PACKAGE}::swap::withdraw_quote`,
      SWAP_WITHDRAW_DEEP: `${WALLET_PACKAGE}::swap::withdraw_deep`,
      SWAP_AGENT_BASE_TO_QUOTE: `${WALLET_PACKAGE}::swap::agent_swap_base_to_quote`,
      SWAP_AGENT_QUOTE_TO_BASE: `${WALLET_PACKAGE}::swap::agent_swap_quote_to_base`,
      // navi — SAFE multi-asset lend-as-is vault (owner custody + agent supply/withdraw).
      NAVI_CREATE: `${WALLET_PACKAGE}::navi::create_vault`,
      NAVI_SET_ACCOUNT_CAP: `${WALLET_PACKAGE}::navi::set_account_cap`,
      NAVI_TAKE_ACCOUNT_CAP: `${WALLET_PACKAGE}::navi::take_account_cap`,
      NAVI_DEPOSIT: `${WALLET_PACKAGE}::navi::deposit`,
      NAVI_WITHDRAW_IDLE: `${WALLET_PACKAGE}::navi::withdraw_idle`,
      NAVI_AGENT_SUPPLY: `${WALLET_PACKAGE}::navi::agent_supply`,
      NAVI_AGENT_WITHDRAW_REQUEST: `${WALLET_PACKAGE}::navi::agent_withdraw_request`,
      NAVI_AGENT_ABSORB_WITHDRAWN: `${WALLET_PACKAGE}::navi::agent_absorb_withdrawn`,
    } as Record<string, string>,
  },

  /**
   * Deploy package (`deploy_sui`) — PLACEHOLDER ids until published to testnet.
   * `PACKAGE`/`VERSION_OBJECT`/`DOMAIN_REGISTRY_OBJECT` are all '0x0' for now (see
   * the DEPLOY_PACKAGE comment above + docs/deploy/SPEC.md §13). The three write
   * targets are signed by the backend's OWN deploy service wallet (it pays its own
   * gas) — NOT Enoki-sponsored — so they are intentionally absent from the sponsor
   * allow-list union; DEPLOY_MOVE_TARGETS exports them for future use only.
   */
  DEPLOY: {
    PACKAGE: DEPLOY_PACKAGE,
    VERSION_OBJECT: DEPLOY_VERSION_OBJECT,
    DOMAIN_REGISTRY_OBJECT: DEPLOY_DOMAIN_REGISTRY_OBJECT,
    TARGETS: {
      CREATE_SITE: `${DEPLOY_PACKAGE}::site::create_site`,
      LINK_DOMAIN: `${DEPLOY_PACKAGE}::domain_registry::link_domain`,
      UNLINK_DOMAIN: `${DEPLOY_PACKAGE}::domain_registry::unlink_domain`,
    },
  },
} as const;

/** Flat list of the Crash router targets, in declaration order. */
export const CRASH_MOVE_TARGETS: string[] = Object.values(PACKAGE_IDS.CRASH.TARGETS);

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
// WAL gas). The route is OPEN in the MVP — no auth, optional `owner` attribution —
// payments gate it later. See docs/deploy/SPEC.md.
// ---------------------------------------------------------------------------

/**
 * POST /deploy response body.
 * Each deploy mints a NEW immutable `Site` (new id → new URL); there is no
 * overwrite path in the MVP. `siteId` is the on-chain object id; `subdomain` is
 * `base36(siteId)`; `url` is `https://<subdomain>.deploy.suize.io`; `version` is
 * always 1 in the MVP; `digest` is the create_site tx digest.
 */
export interface DeployResponse {
  siteId: string;
  subdomain: string;
  url: string;
  version: number;
  digest: string;
}

/**
 * GET /sites/:id (and the entries of GET /sites) response body.
 * `owner` is best-effort attribution (the deployer, or the service-wallet address
 * if none was passed) — NOT Sui-ownership. `domains` are the linked custom domains.
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
 * POST /domains request body — request to link a custom domain to a site. The
 * backend replies with a DNS TXT challenge (DomainChallengeResponse) the caller
 * must satisfy before the on-chain `link_domain` runs.
 */
export interface DomainLinkRequest {
  siteId: string;
  domain: string;
}

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
 * `cname` is the `<subdomain>.deploy.suize.io` target to CNAME the apex/host at.
 *
 * The optional fields ride on specific outcomes:
 * - `detail` — a still-`pending` reason (TXT not found yet / mismatch).
 * - `digest` — the `link_domain` tx digest (only on a successful `linked`).
 * - `ssl` — the best-effort Cloudflare SSL provisioning result (only on `linked`).
 * - `instructions` — manual-CNAME guidance when the CF adapter is off (`linked`).
 */
export interface DomainChallengeResponse {
  domain: string;
  status: 'pending' | 'linked';
  txtName: string;
  txtValue: string;
  cname: string;
  detail?: string;
  digest?: string;
  ssl?: DomainSslStatus;
  instructions?: string;
}
