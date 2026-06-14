// Deploy's subscription STATE — read ENTIRELY through the merchant SDK (@suize/pay's
// suizeSubs). Deploy is a first-party MERCHANT onboarded on the Suize rail: it asks the
// chain "does this site have an active Deploy subscription?" the SAME way any external
// merchant does — via suizeSubs.isActive / findByRef / watch, NEVER a bespoke
// getObject/queryEvents read. This module is the single place the suizeSubs instance is
// constructed (merchant = the resolved Deploy treasury) and memoized, so the /domains
// gate, the /deploy/subscribe read-back, and the storage extender all share ONE indexer.
//
// THE SUB↔SITE JOIN: a Deploy subscription's on-chain `ref` is still the site id's 32
// bytes (the create PTB is wire-unchanged), but the per-ADDRESS model no longer GATES or
// FANS OUT on the ref — the domain-unlock gate reads the site's owner + subs.activeFor,
// and the storage renewer enumerates a sub owner's sites directly (extend.ts). The only
// remaining ref read is subscribe.ts's read-back of the JUST-CREATED sub by its ref
// (siteId) right after submit — that is what `refToSiteIdHex` (bare-hex form for
// suizeSubs.findByRef) still serves.
import { suizeSubs, type SubStatus, type SuizeSubsConfig } from "@suize/pay/subs";
import {
  DEPLOY_SUB_PERIOD_MS,
  DEPLOY_SUB_PRICE_USDC,
  PACKAGE_IDS,
  USDC_TYPES,
  type SuiNetwork,
} from "@suize/shared";
import { config } from "../config";
import { deployMerchant } from "./payment";

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;
const SUBS_PUBLISHED = PACKAGE_IDS.SUBS.PACKAGE !== "0x0";

// The Deploy asset (USDC, this network). A subscription paying in anything else is not
// a real payment, regardless of its `active` flag.
const DEPLOY_SUB_COIN_TYPE = USDC_TYPES[config.suiNetwork as SuiNetwork].toLowerCase();

/**
 * Does an ACTIVE subscription BIND to Deploy's actual price? Existence is not enough —
 * the audit's free/underpriced-premium class (`subs-coin-type-unchecked` HIGH +
 * `subs-amount-period-unvalidated` MEDIUM): a `Subscription<JunkCoin>`, or a $0.01 /
 * 100-year USDC sub, is "active" yet worthless. Premium (custom domains + storage
 * auto-renewal) requires a sub that (a) pays in USDC, (b) at least one Deploy period's
 * price, and (c) with a period no LONGER than one Deploy period — so a single
 * century-long payment cannot masquerade as a recurring monthly plan. This is the ONE
 * place Deploy binds sub TERMS; every gate + the renewer call it (never `.length > 0`).
 */
export const isValidDeploySub = (s: SubStatus): boolean =>
  s.active &&
  s.coinType === DEPLOY_SUB_COIN_TYPE &&
  s.amount >= DEPLOY_SUB_PRICE_USDC &&
  s.periodMs > 0 &&
  s.periodMs <= DEPLOY_SUB_PERIOD_MS;

/**
 * Does `owner` hold an active Deploy subscription with VALID terms (see
 * `isValidDeploySub`)? The single premium gate — custom-domain unlock AND storage
 * auto-renewal both call this, NEVER bare `activeFor(owner).length > 0`. Returns false
 * (fail-closed) when subs is unpublished / the treasury is unresolvable. RPC errors from
 * `activeFor` PROPAGATE (the caller maps them to a transient 503 / a skipped renew, never
 * a false unlock).
 */
export const hasValidDeploySub = async (owner: string): Promise<boolean> => {
  const subs = await deploySubs();
  if (!subs) return false;
  return (await subs.activeFor(owner)).some(isValidDeploySub);
};

type SuizeSubsApi = ReturnType<typeof suizeSubs>;

// Memoized per resolved merchant: deployMerchant() resolves the treasury (SuiNS /
// fallback) async; once resolved it's stable, so we build the indexer once. A re-resolve
// to a DIFFERENT merchant (a treasury env flip) rebuilds it (defensive — never happens
// in a single run).
let cached: { merchant: string; api: SuizeSubsApi } | null = null;

/**
 * The shared suizeSubs merchant indexer for Deploy, or null when the subs module is
 * unpublished or the treasury is unresolvable (fail-closed — no merchant, no honored
 * subs). The merchant is ALWAYS the resolved Deploy treasury (deployMerchant()), never
 * hardcoded. `graceMs` is 0 (a lapsed sub is inactive the instant it lapses); the
 * storage extender's own near-expiry cushion is the operational grace, not a gate grace.
 */
export const deploySubs = async (): Promise<SuizeSubsApi | null> => {
  if (!SUBS_PUBLISHED) return null;
  const merchant = await deployMerchant();
  if (!merchant || !SUI_ADDRESS_RE.test(merchant)) return null;
  if (cached && cached.merchant === merchant.toLowerCase()) return cached.api;
  const cfg: SuizeSubsConfig = {
    merchant,
    network: config.suiNetwork as SuiNetwork,
    rpcUrl: config.suiRpcUrl,
    subsPackage: PACKAGE_IDS.SUBS.PACKAGE,
  };
  const api = suizeSubs(cfg);
  cached = { merchant: merchant.toLowerCase(), api };
  return api;
};

/** A site id (`0x…64`) → the BARE-hex ref form suizeSubs compares on (the 32 bytes,
 * lowercased, no `0x`). Used ONLY by subscribe.ts to read a just-created sub back by its
 * ref (subs.findByRef(refToSiteIdHex(siteId))) — the per-address gate/renewer no longer
 * use it. */
export const refToSiteIdHex = (siteId: string): string =>
  (siteId.startsWith("0x") ? siteId.slice(2) : siteId).toLowerCase();
