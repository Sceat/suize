// Worker environment — ONE interface for both faces of the worker:
// the SERVING face (resolve host → on-chain Site → stream verified bytes) and
// the CHARGE face (POST /deploy, /extend, /domains — the x402-paid publish path).
//
// Everything in [vars] is PUBLIC operator config. The ONE secret is
// DEPLOY_WALLET_KEY (`wrangler secret put DEPLOY_WALLET_KEY`, or .dev.vars in
// dev): the service wallet that signs create_site / extend_site /
// allowlist::create_for_owner (it holds the DeployerCap) and pays SUI gas + the
// WAL for storage extends. It NEVER touches payer funds — payments settle
// keyless through the external facilitator.

import { resolveNetwork, type SuiNetwork } from "@suize/shared";

export interface Env {
  // ── serving face (existing) ────────────────────────────────────────────────
  /** Sui GraphQL RPC for indexer-shaped reads (dynamic fields, events). */
  SUI_GRAPHQL_URL: string;
  /** Walrus aggregator base (reads). */
  WALRUS_AGGREGATOR: string;
  /** The base zone sites serve under (default 'suize.site'). */
  BASE_DOMAIN?: string;
  /** R2 durable blob cache (optional). */
  BLOB_CACHE?: R2Bucket;

  // ── charge face ───────────────────────────────────────────────────────────
  /** 'testnet' | 'mainnet' — drives @suize/shared packageIds / USDC / epochs. */
  SUI_NETWORK?: string;
  /** Sui fullnode gRPC base (writes + object reads). */
  SUI_GRPC_URL?: string;
  /** Walrus publisher base (stores; the publisher encodes + pays WAL for the store). */
  WALRUS_PUBLISHER?: string;
  /** SECRET (optional) — `0x<hex>` shared secret gating a SELF-HOSTED publisher's
   * native JWT auth (`walrus publisher --jwt-decode-secret`, HS256). Set for the
   * mainnet self-hosted publisher; absent ⇒ no auth header (public testnet path). */
  WALRUS_PUBLISHER_JWT_SECRET?: string;
  /** The x402 facilitator this merchant settles through (the OSS worker). */
  FACILITATOR_URL?: string;
  /** Where deploy revenue lands (the merchant `payTo`). */
  SUIZE_MERCHANT?: string;
  /** Host that serves the charge API (POST /deploy …). localhost always matches. */
  API_HOST?: string;
  /** The suize.io app origin — sealed sites bootstrap into its viewer. */
  VIEWER_URL?: string;
  /** SECRET — the service wallet key (suiprivkey1… bech32). */
  DEPLOY_WALLET_KEY?: string;
  /** SECRET (optional) — Cloudflare-for-SaaS auto-SSL for custom domains. */
  CF_API_TOKEN?: string;
  /** The suize.site zone id (pairs with CF_API_TOKEN). */
  CF_ZONE_ID?: string;
}

/** The resolved network ('testnet' unless SUI_NETWORK === 'mainnet'). */
export const network = (env: Env): SuiNetwork => resolveNetwork(env.SUI_NETWORK);

/** True when the charge face is fully configured (else API routes 503 cleanly).
 * `SUIZE_MERCHANT` must be a real payTo, not the unset/placeholder "0x0" — a
 * premature mainnet deploy quoting 402s against "0x0" would burn the fee leg. */
export const chargeConfigured = (env: Env): boolean =>
  Boolean(
    env.DEPLOY_WALLET_KEY &&
      env.FACILITATOR_URL &&
      env.SUIZE_MERCHANT &&
      env.SUIZE_MERCHANT !== "0x0" &&
      env.WALRUS_PUBLISHER,
  );
