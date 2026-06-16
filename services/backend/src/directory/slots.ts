// Directory AD-SLOT reads — the on-chain ad-slot auction surface for agents.suize.io.
// Each slot in PACKAGE_IDS.AUCTION.SLOTS is a SHARED `AdSlot` object sold by continuous
// English auction (a strictly-higher bid takes it). We read each slot's fields LIVE
// (price/holder/creative/last_bid_ms), join the display label/blurb from AD_SLOT_DEFS,
// and compute `minNextBid = price + 1` (strictly greater). The AdSlot Move object's
// fields are exactly { name, price, holder, creative, last_bid_ms }.
import { PACKAGE_IDS, AD_SLOT_DEFS } from "@suize/shared";
import { suiClient, resolveOwnerHandle, resolveProfile, type ProfileView } from "./chain";

/** One read ad slot — on-chain state + display metadata + the next-bid floor. */
export type DirectorySlot = {
  key: string;
  label: string;
  blurb: string;
  slotId: string;
  /** current top price (atomic USDC string). */
  price: string;
  holder: string;
  holderHandle: string | null;
  lastBidMs: number;
  /** price + 1 (a bid must STRICTLY exceed the current price). */
  minNextBid: string;
  /** The holder's resolved BusinessProfile — the ad's banner/logo/name/desc/site come from
   *  this (no per-slot creative). Null when the holder has no profile. */
  profile: ProfileView | null;
};

type SlotFields = {
  name?: unknown;
  price?: unknown;
  holder?: unknown;
  last_bid_ms?: unknown;
};

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;

/** Read ONE slot object → its fields. Returns null when the object is unreadable
 * (missing / not a move object) so a single bad slot never sinks the whole list. */
const readSlotFields = async (slotId: string): Promise<SlotFields | null> => {
  try {
    const res = await suiClient().getObject({ id: slotId, options: { showContent: true } });
    const content = res.data?.content;
    if (!content || content.dataType !== "moveObject") return null;
    // `fields` is the flattened struct map ({ [key]: value }) for a getObject read.
    const fields = (content.fields ?? {}) as Record<string, unknown>;
    return {
      name: fields.name,
      price: fields.price,
      holder: fields.holder,
      last_bid_ms: fields.last_bid_ms,
    };
  } catch (e) {
    console.error(`[directory/slots] read ${slotId} failed:`, (e as Error).message);
    return null;
  }
};

/**
 * Read EVERY ad slot defined in AD_SLOT_DEFS (the surface order) → DirectorySlot[].
 * A slot whose object can't be read is OMITTED (never throws the whole list). The
 * holder is resolved to its OWNER handle — its own `@suize` handle, or the human
 * behind it when the holder is an agent sub-account (cached, resilient). Slots with
 * no on-chain id (an unpublished network) are skipped.
 */
export const readSlots = async (): Promise<DirectorySlot[]> => {
  const out: DirectorySlot[] = [];
  for (const def of AD_SLOT_DEFS) {
    const slotId = PACKAGE_IDS.AUCTION.SLOTS[def.key];
    if (!slotId || slotId === "0x0") continue;
    const fields = await readSlotFields(slotId);
    if (!fields) continue;
    const price = str(fields.price, "0");
    const holder = str(fields.holder);
    const minNextBid = (BigInt(price || "0") + 1n).toString();
    out.push({
      key: def.key,
      label: def.label,
      blurb: def.blurb,
      slotId,
      price,
      holder,
      // The holder is whoever PAID for the slot — for an agent claim that's its Suize
      // sub-account (a multisig with no handle of its own), so resolve the human MAIN
      // member's handle, exactly like the Deploy dashboard's owner identity.
      holderHandle: holder ? await resolveOwnerHandle(holder) : null,
      lastBidMs: Number(str(fields.last_bid_ms, "0")) || 0,
      minNextBid,
      profile: holder ? await resolveProfile(holder) : null,
    });
  }
  return out;
};

/** The key of the CHEAPEST slot (the lowest current price), or "" when none. */
export const cheapestSlotKey = (slots: DirectorySlot[]): string => {
  let key = "";
  let min = -1n;
  for (const s of slots) {
    const p = BigInt(s.price || "0");
    if (min < 0n || p < min) {
      min = p;
      key = s.key;
    }
  }
  return key;
};
