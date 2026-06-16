/**
 * PTB builders + the owned-object read for the `profile::profile` module — the
 * Business Profile NFT (one merchant identity, reused across the ad slots + the agents
 * directory). PUBLISHED on testnet (`PACKAGE_IDS.PROFILE`); ids live ONLY in `@suize/shared`.
 *
 * A business mints ONE `BusinessProfile` (an owned NFT with on-chain `Display<>`): name ·
 * description · logo (`image_url`) · banner · website. `create_profile` + `edit_profile` each
 * cost a FLAT $0.10 fee (PROFILE_FEE), PUSHED as a `Balance<USDC>` → the Suize treasury — a
 * service charge / spam guard, NOT the x402 2% rake (this is the whole payment, sent in full).
 *
 * THE ON-CHAIN INTERFACE (verified against packages/move-profile/sources/profile.move):
 *   create_profile<T>(version, config, payment: Balance<T>, name, description, image_url,
 *                     banner_url, website, ctx)                 — mint (flat fee → treasury)
 *   edit_profile<T>(version, config, profile: &mut BusinessProfile, payment: Balance<T>,
 *                   name, description, image_url, banner_url, website, ctx)  — owner edits
 *
 * VERSION GATE: every entry takes the shared `Version` FIRST (assert_latest). The fee is
 * pushed via `tx.balance({ type, balance })` (the CoinWithBalance intent), so the create/edit
 * is a USER-SIGNED, Enoki-SPONSORED owner tx (same transport as subs — see runSponsored).
 */

import { Transaction } from '@mysten/sui/transactions';
import { PACKAGE_IDS, PROFILE_FEE } from '@suize/shared';
import { USDC } from './coins';

const T = PACKAGE_IDS.PROFILE.TARGETS;
const PROFILE_CONFIG = PACKAGE_IDS.PROFILE.CONFIG_OBJECT;
const PROFILE_VERSION = PACKAGE_IDS.PROFILE.VERSION_OBJECT;
const PROFILE_PKG = PACKAGE_IDS.PROFILE.PACKAGE;

/** The flat mint/edit fee, in USDC base units ($0.10 = 100_000). The number wall: this is a
 *  `@suize/shared` constant, NEVER a user/LLM input. */
export const PROFILE_FEE_RAW = BigInt(PROFILE_FEE);

/** The fully-qualified `BusinessProfile` struct type — the getOwnedObjects filter. */
export const BUSINESS_PROFILE_TYPE = `${PROFILE_PKG}::profile::BusinessProfile`;

/** Whether the profile module is published on this network (a `0x0` pkg fails closed). */
export const PROFILE_PUBLISHED = PROFILE_PKG !== '0x0';

/** The five editable identity fields a business sets. All optional except `name`. */
export interface ProfileFields {
  name: string;
  description: string;
  imageUrl: string;
  bannerUrl: string;
  website: string;
}

/** A resolved on-chain BusinessProfile (what the UI renders + the directory reads). */
export interface BusinessProfileView extends ProfileFields {
  /** The NFT object id (passed to edit_profile). */
  id: string;
  /** The minting business address (the edit authority). */
  owner: string;
}

// ───────────────────────────────────────────────────────────────────────────
// create_profile — mint the BusinessProfile, paying the $0.10 flat fee inline.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build `create_profile<USDC>(version, config, payment, name, description, image_url,
 * banner_url, website)`. The `payment` is exactly PROFILE_FEE USDC, materialized from the
 * sender's own USDC via the SDK `tx.balance` intent (sponsored). The new NFT is transferred
 * to the sender (soulbound — `key`, no `store`).
 */
export function buildCreateProfile(fields: ProfileFields): Transaction {
  const tx = new Transaction();
  const payment = tx.balance({ type: USDC.type, balance: PROFILE_FEE_RAW });
  tx.moveCall({
    target: T.CREATE_PROFILE,
    arguments: [
      tx.object(PROFILE_VERSION),
      tx.object(PROFILE_CONFIG),
      payment,
      tx.pure.string(fields.name),
      tx.pure.string(fields.description),
      tx.pure.string(fields.imageUrl),
      tx.pure.string(fields.bannerUrl),
      tx.pure.string(fields.website),
    ],
    typeArguments: [USDC.type],
  });
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// edit_profile — owner replaces every field, paying the $0.10 flat fee again.
// ───────────────────────────────────────────────────────────────────────────

/** Build `edit_profile<USDC>(version, config, profile, payment, …fields)` — OWNER-ONLY
 *  (aborts `ENotOwner` if the signer isn't the profile's `owner`). */
export function buildEditProfile(profileId: string, fields: ProfileFields): Transaction {
  const tx = new Transaction();
  const payment = tx.balance({ type: USDC.type, balance: PROFILE_FEE_RAW });
  tx.moveCall({
    target: T.EDIT_PROFILE,
    arguments: [
      tx.object(PROFILE_VERSION),
      tx.object(PROFILE_CONFIG),
      tx.object(profileId),
      payment,
      tx.pure.string(fields.name),
      tx.pure.string(fields.description),
      tx.pure.string(fields.imageUrl),
      tx.pure.string(fields.bannerUrl),
      tx.pure.string(fields.website),
    ],
    typeArguments: [USDC.type],
  });
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// Read — the owner's BusinessProfile (one per business by convention; take the first).
// ───────────────────────────────────────────────────────────────────────────

/** The minimal getOwnedObjects client slice (dapp-kit's SuiClient exposes exactly this). */
export interface OwnedProfilesClient {
  getOwnedObjects(args: {
    owner: string;
    filter?: { StructType: string };
    options?: { showContent?: boolean; showType?: boolean };
    limit?: number;
  }): Promise<{
    data: Array<{
      data?: {
        objectId: string;
        content?: { fields?: Record<string, unknown> } | null;
      } | null;
    }>;
  }>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Map one owned-object's content fields to a BusinessProfileView. Null if malformed. */
export function profileFromFields(
  objectId: string,
  fields: Record<string, unknown> | null | undefined,
): BusinessProfileView | null {
  if (!fields) return null;
  const owner = str(fields.owner);
  const name = str(fields.name);
  if (!owner || !name) return null;
  return {
    id: objectId,
    owner,
    name,
    description: str(fields.description),
    imageUrl: str(fields.image_url),
    bannerUrl: str(fields.banner_url),
    website: str(fields.website),
  };
}

/**
 * The `owner`'s BusinessProfile, or null when they haven't minted one. One profile per
 * business by convention → take the FIRST owned `BusinessProfile` (no registry to contend
 * on at mint). Best-effort: any read failure → null (the UI shows the mint form).
 */
export async function loadProfile(
  client: OwnedProfilesClient,
  owner: string,
): Promise<BusinessProfileView | null> {
  if (!owner || !PROFILE_PUBLISHED) return null;
  try {
    const res = await client.getOwnedObjects({
      owner,
      filter: { StructType: BUSINESS_PROFILE_TYPE },
      options: { showContent: true, showType: true },
      limit: 5,
    });
    for (const node of res.data) {
      const d = node.data;
      if (!d) continue;
      const view = profileFromFields(d.objectId, d.content?.fields ?? null);
      if (view) return view;
    }
    return null;
  } catch {
    return null;
  }
}
