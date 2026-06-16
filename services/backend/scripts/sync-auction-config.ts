// Sync the on-chain `AuctionConfig` (the agents.suize.io ad-slot auction) to the rail's
// canonical values, and ensure the genesis ad slots exist. All three legs are
// AuctionAdminCap-gated stored state the module's `init` can't seed correctly (init
// seeds treasury = directory = publisher, coin_type = none, and creates NO slots):
//
//   • TREASURY  — the off-chain x402 fee path resolves `treasury@suize` LIVE, but Move
//     can't take the SuiNS shared object on every bid (hot-path cost), so
//     `AuctionConfig.treasury` is a STORED address kept in sync here via `set_treasury`.
//   • COIN TYPE — `set_coin_type<USDC>` pins which coin a bid must pay; after it, a bid
//     in any other coin aborts `EWrongCoin` on-chain. Pinned to `USDC_TYPES[network]`.
//   • SLOTS     — `create_slot(name, start_price)` mints each genesis slot (held by the
//     directory at $50). Idempotent: existing slot names are discovered by querying the
//     module's `SlotCreated` events — authoritative even BEFORE @suize/shared is
//     backfilled (the static PACKAGE_IDS.AUCTION.SLOTS id list can lag a freshly-created
//     slot, which would otherwise double-create on a re-run). The on-chain `create_slot`
//     has no name-uniqueness guard, so the dedup MUST happen here.
//
// RUN IT — after EVERY auction publish, and whenever `treasury@suize` repoints:
//   bun run auction:sync-config                          # from services/backend
//   bun run --filter @suize/backend auction:sync-config  # from repo root
//   SUI_NETWORK=mainnet bun run auction:sync-config       # after the mainnet publish
//   DRY_RUN=1 bun run auction:sync-config                 # print only, no tx
//
// The LIVE testnet config is ALREADY synced manually — this script is for
// reproducibility/record. Idempotent + safe to re-run: re-running when already in sync
// is a no-op ("already synced"). AUTH: signs with the AuctionAdminCap holder —
// `SUIZE_ADMIN_PRIVATE_KEY` if set, else the Sui CLI active address (~/.sui/sui_config).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  packageIds,
  resolveNetwork,
  resolveTreasury,
  fullnodeUrl,
  TREASURY_SUINS_DOTTED,
  SUI_ADDRESS_RE,
  USDC_TYPES,
  AD_SLOT_DEFS,
  AD_SLOT_START_PRICE,
} from "@suize/shared";

const network = resolveNetwork(process.env.SUI_NETWORK);
const DRY_RUN = process.env.DRY_RUN === "1";

/** Load the admin keypair: env key first, else the Sui CLI active address. */
function loadAdminKeypair(): Ed25519Keypair {
  const envKey = process.env.SUIZE_ADMIN_PRIVATE_KEY?.trim();
  if (envKey) return Ed25519Keypair.fromSecretKey(envKey);
  const dir = join(homedir(), ".sui", "sui_config");
  const active = readFileSync(join(dir, "client.yaml"), "utf8").match(/active_address:\s*"?(0x[0-9a-fA-F]+)"?/)?.[1];
  if (!active) throw new Error("no active_address in client.yaml — set SUIZE_ADMIN_PRIVATE_KEY instead");
  const entries = JSON.parse(readFileSync(join(dir, "sui.keystore"), "utf8")) as string[];
  for (const b64 of entries) {
    const raw = Buffer.from(b64, "base64");
    if (raw[0] !== 0x00) continue; // 0x00 = Ed25519 scheme flag
    const kp = Ed25519Keypair.fromSecretKey(new Uint8Array(raw.subarray(1)));
    if (kp.toSuiAddress().toLowerCase() === active.toLowerCase()) return kp;
  }
  throw new Error(`no Ed25519 keystore entry matches active address ${active}`);
}

/** Normalize a Sui type tag for comparison: strip a leading `0x` on the address, lowercase. */
function normType(t: string): string {
  const s = t.trim().toLowerCase();
  return s.startsWith("0x") ? s.slice(2) : s;
}

/** Pull the `addr::mod::Name` out of an `AuctionConfig.coin_type` (Option<TypeName>) RPC
 *  value, tolerating the shapes Sui renders it in; null when unpinned (none). */
function extractCoinType(field: unknown): string | null {
  if (field == null) return null;
  if (typeof field === "string") return field;
  const f = field as Record<string, any>;
  const vec = f?.fields?.vec ?? f?.vec; // Option as { fields: { vec: [...] } }
  if (Array.isArray(vec)) {
    const v = vec.length ? vec[0] : null;
    if (v == null) return null;
    return typeof v === "string" ? v : (v?.fields?.name ?? v?.name ?? null);
  }
  return f?.fields?.name ?? f?.name ?? null; // TypeName directly
}

/** Discover the names of every AdSlot already created for this package by paging the
 *  `SlotCreated` events — authoritative regardless of whether @suize/shared's static
 *  slot-id list has been backfilled (so a re-run never double-creates a slot). */
async function existingSlotNames(client: SuiJsonRpcClient, pkg: string): Promise<Set<string>> {
  const names = new Set<string>();
  let cursor: { txDigest: string; eventSeq: string } | null | undefined = undefined;
  for (let page = 0; page < 10; page++) {
    const ev = await client.queryEvents({
      query: { MoveEventType: `${pkg}::auction::SlotCreated` },
      cursor: cursor ?? undefined,
      limit: 50,
    });
    for (const e of ev.data) {
      const name = (e.parsedJson as { name?: unknown })?.name;
      if (typeof name === "string") names.add(name);
    }
    if (!ev.hasNextPage || !ev.nextCursor) break;
    cursor = ev.nextCursor;
  }
  return names;
}

async function main() {
  const { AUCTION } = packageIds(network);
  if (AUCTION.PACKAGE === "0x0") throw new Error(`auction not published on ${network} — nothing to sync`);

  const client = new SuiJsonRpcClient({ url: fullnodeUrl(network), network });

  // The canonical values to enforce.
  const targetTreasury = await resolveTreasury(client);
  if (!targetTreasury || !SUI_ADDRESS_RE.test(targetTreasury)) {
    throw new Error(`${TREASURY_SUINS_DOTTED} did not resolve to a valid address on ${network} — aborting (won't guess)`);
  }
  const usdcType = USDC_TYPES[network];

  // The current on-chain AuctionConfig.
  const cfg = await client.getObject({ id: AUCTION.CONFIG_OBJECT, options: { showContent: true } });
  const content = cfg.data?.content;
  if (!content || content.dataType !== "moveObject") {
    throw new Error(`could not read AuctionConfig from ${AUCTION.CONFIG_OBJECT}`);
  }
  const fields = content.fields as Record<string, unknown>;
  const curTreasury = (fields.treasury as string) ?? "";
  const curCoin = extractCoinType(fields.coin_type);

  const treasuryOk = !!curTreasury && curTreasury.toLowerCase() === targetTreasury.toLowerCase();
  const coinOk = !!curCoin && normType(curCoin) === normType(usdcType);

  // Which genesis slots already exist on-chain (by name)? Discover via SlotCreated events
  // — authoritative regardless of whether @suize/shared has been backfilled.
  const existingNames = await existingSlotNames(client, AUCTION.PACKAGE);
  const missingSlots = AD_SLOT_DEFS.filter((d) => !existingNames.has(d.key));

  console.log(`network:   ${network}`);
  console.log(`treasury@suize -> ${targetTreasury}`);
  console.log(`  on-chain AuctionConfig.treasury -> ${curTreasury || "(unreadable)"} ${treasuryOk ? "✓" : "✗ will set"}`);
  console.log(`USDC type  -> ${usdcType}`);
  console.log(`  on-chain AuctionConfig.coin_type -> ${curCoin ?? "(unpinned)"} ${coinOk ? "✓" : "✗ will set"}`);
  console.log(`slots:     ${AD_SLOT_DEFS.map((d) => d.key).join(", ")}`);
  console.log(
    `  existing -> ${[...existingNames].join(", ") || "(none)"}` +
      (missingSlots.length ? ` ✗ will create: ${missingSlots.map((d) => d.key).join(", ")}` : " ✓"),
  );

  if (treasuryOk && coinOk && missingSlots.length === 0) {
    console.log("\n✓ already synced — no-op.");
    return;
  }

  // Find the AuctionAdminCap the signer holds.
  const admin = loadAdminKeypair();
  const adminAddr = admin.toSuiAddress();
  const caps = await client.getOwnedObjects({
    owner: adminAddr,
    filter: { StructType: `${AUCTION.PACKAGE}::auction::AuctionAdminCap` },
    options: { showType: true },
  });
  const capId = caps.data[0]?.data?.objectId;
  if (!capId) throw new Error(`signer ${adminAddr} holds no AuctionAdminCap — wrong wallet?`);

  console.log(`\nsigner: ${adminAddr}\n  cap:    ${capId}\n  config: ${AUCTION.CONFIG_OBJECT}`);
  if (DRY_RUN) {
    console.log("\nDRY_RUN=1 — not executing.");
    return;
  }

  // Batch every leg that differs into ONE admin tx.
  const tx = new Transaction();
  if (!treasuryOk) {
    tx.moveCall({
      target: `${AUCTION.PACKAGE}::auction::set_treasury`,
      arguments: [tx.object(AUCTION.CONFIG_OBJECT), tx.object(capId), tx.pure.address(targetTreasury)],
    });
  }
  if (!coinOk) {
    tx.moveCall({
      target: `${AUCTION.PACKAGE}::auction::set_coin_type`,
      typeArguments: [usdcType],
      arguments: [tx.object(AUCTION.CONFIG_OBJECT), tx.object(capId)],
    });
  }
  for (const def of missingSlots) {
    tx.moveCall({
      target: `${AUCTION.PACKAGE}::auction::create_slot`,
      // create_slot(version, config, cap, name, start_price, ctx) — version-gated.
      arguments: [
        tx.object(AUCTION.VERSION_OBJECT),
        tx.object(AUCTION.CONFIG_OBJECT),
        tx.object(capId),
        tx.pure.string(def.key),
        tx.pure.u64(AD_SLOT_START_PRICE),
      ],
    });
  }

  const res = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: admin,
    options: { showEffects: true },
  });
  if (res.effects?.status?.status !== "success") {
    throw new Error(`sync failed: ${res.effects?.status?.error}`);
  }
  console.log(
    `\n✓ synced (treasury${treasuryOk ? "" : " set"}, coin_type${coinOk ? "" : " set"}` +
      (missingSlots.length ? `, created ${missingSlots.length} slot(s)` : "") +
      `). digest: ${res.digest}`,
  );

  // Print the name -> AdSlot id map (from SlotCreated events) so @suize/shared's
  // AUCTION_SLOTS can be backfilled after a fresh publish.
  const slotIds: Record<string, string> = {};
  let cursor: { txDigest: string; eventSeq: string } | null | undefined = undefined;
  for (let page = 0; page < 10; page++) {
    const ev = await client.queryEvents({
      query: { MoveEventType: `${AUCTION.PACKAGE}::auction::SlotCreated` },
      cursor: cursor ?? undefined,
      limit: 50,
    });
    for (const e of ev.data) {
      const pj = e.parsedJson as { name?: string; slot_id?: string };
      if (pj?.name && pj?.slot_id) slotIds[pj.name] = pj.slot_id;
    }
    if (!ev.hasNextPage || !ev.nextCursor) break;
    cursor = ev.nextCursor;
  }
  console.log(`\nAUCTION_SLOTS (copy into @suize/shared):\n${JSON.stringify(slotIds, null, 2)}`);
}

main().catch((e) => {
  console.error("sync-auction-config FAILED:", (e as Error).message);
  process.exit(1);
});
