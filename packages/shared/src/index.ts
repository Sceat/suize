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

/** Crash router package (live on testnet). */
const CRASH_ROUTER_PACKAGE =
  '0x885bc905f8c39a8a179a6013a4a688c19d94f49ae3a98653452f97dcaff9d2c3';

/**
 * Wallet Move package — LIVE on testnet.
 * Published 2026-06-02 from packages/move-wallet (modules: mandate / vault / swap /
 * navi). Publish digest EuEspy1q7qEbVGT7HCWvyVxEDmfbL88gGuUjwUdrpYAe; UpgradeCap
 * 0xc2d611327d2b684fc14ca9fc6c813b84253689e21e095f78f9108736006f782d (deployer-owned).
 */
const WALLET_PACKAGE =
  '0x285865f6795ae733bbbb3d55df6826d4614dbdcad7bd5c177ab6a4b4314267b1';

export const PACKAGE_IDS = {
  /** Crash router package + its 7 sponsorable `router::*` targets. */
  CRASH: {
    PACKAGE: CRASH_ROUTER_PACKAGE,
    TARGETS: {
      CREATE_MANAGER: `${CRASH_ROUTER_PACKAGE}::router::create_manager`,
      BET: `${CRASH_ROUTER_PACKAGE}::router::bet`,
      CASH_OUT: `${CRASH_ROUTER_PACKAGE}::router::cash_out`,
      CLAIM: `${CRASH_ROUTER_PACKAGE}::router::claim`,
      WITHDRAW: `${CRASH_ROUTER_PACKAGE}::router::withdraw`,
      SUPPLY: `${CRASH_ROUTER_PACKAGE}::router::supply`,
      REDEEM_LP: `${CRASH_ROUTER_PACKAGE}::router::redeem_lp`,
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
} as const;

/** Flat list of the Crash router targets, in declaration order. */
export const CRASH_MOVE_TARGETS: string[] = Object.values(PACKAGE_IDS.CRASH.TARGETS);

/** Flat list of the wallet targets — the wallet pkg is LIVE on testnet (mandate/vault/swap/navi). */
export const WALLET_MOVE_TARGETS: string[] = Object.values(PACKAGE_IDS.WALLET.TARGETS);

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
// subnames). Backend (Redis) is the source of truth; the SuiNS reverse record
// is a backstop. Issuance is self-custody (Path B): the backend custodies the
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
 */
export interface HandleClaimResponse {
  handle: string;
  txDigest: string;
}
