// Sync the on-chain `ProfileConfig` to the rail's canonical values: the `treasury@suize`
// address AND the USDC coin-type PIN. Both are ProfileAdminCap-gated stored values that the
// module's `init` can't seed correctly (init seeds treasury = publisher, coin_type = none).
//
// WHY each:
//   • TREASURY — the BusinessProfile mint/edit flat fee ($0.10) is `balance::send_funds`'d
//     to `ProfileConfig.treasury`. Move can't resolve the `treasury@suize` SuiNS object on
//     a mint, so the address is STORED here and kept in sync via `set_treasury`.
//   • COIN TYPE — `set_coin_type<USDC>` pins which coin counts as a real fee; after it, a
//     profile mint/edit paid in any other coin aborts `EWrongCoin` on-chain.
//
// RUN IT — after EVERY profile publish, and whenever `treasury@suize` repoints:
//   bun run scripts/sync-profile-config.ts                    # from services/backend
//   SUI_NETWORK=mainnet bun run scripts/sync-profile-config.ts # after the mainnet publish
//   DRY_RUN=1 bun run scripts/sync-profile-config.ts           # print only, no tx
//
// Idempotent: re-running when already in sync is a no-op. Sets ONLY the legs that differ
// (batched into one tx). AUTH: signs with the ProfileAdminCap holder — `SUIZE_ADMIN_PRIVATE_KEY`
// if set, else the Sui CLI active address (~/.sui/sui_config). Mirrors sync-subs-config.ts.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  packageIds,
  resolveNetwork,
  resolveTreasury,
  grpcUrl,
  TREASURY_SUINS_DOTTED,
  SUI_ADDRESS_RE,
  USDC_TYPES,
} from "@suize/shared";
import { treasuryResolver } from "../src/sui";

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

/** Pull the `addr::mod::Name` out of a `ProfileConfig.coin_type` (Option<TypeName>) RPC value,
 *  tolerating the shapes Sui renders it in; null when unpinned (none). */
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

async function main() {
  const { PROFILE } = packageIds(network);
  if (PROFILE.PACKAGE === "0x0") throw new Error(`profile not published on ${network} — nothing to sync`);

  const client = new SuiGrpcClient({ network, baseUrl: grpcUrl(network) });

  // The canonical values to enforce. gRPC has no resolveNameServiceAddress, so adapt
  // the client to the shared TreasuryResolver (name→address via NameService.lookupName).
  const targetTreasury = await resolveTreasury(treasuryResolver(client));
  if (!targetTreasury || !SUI_ADDRESS_RE.test(targetTreasury)) {
    throw new Error(`${TREASURY_SUINS_DOTTED} did not resolve to a valid address on ${network} — aborting (won't guess)`);
  }
  const usdcType = USDC_TYPES[network];

  // The current on-chain ProfileConfig.
  const cfgObj = (await client.getObject({ objectId: PROFILE.CONFIG_OBJECT, include: { json: true } })).object;
  if (!cfgObj?.json) {
    throw new Error(`could not read ProfileConfig from ${PROFILE.CONFIG_OBJECT}`);
  }
  const fields = cfgObj.json as Record<string, unknown>;
  const curTreasury = (fields.treasury as string) ?? "";
  const curCoin = extractCoinType(fields.coin_type);

  const treasuryOk = !!curTreasury && curTreasury.toLowerCase() === targetTreasury.toLowerCase();
  const coinOk = !!curCoin && normType(curCoin) === normType(usdcType);

  console.log(`network:   ${network}`);
  console.log(`treasury@suize -> ${targetTreasury}`);
  console.log(`  on-chain ProfileConfig.treasury -> ${curTreasury || "(unreadable)"} ${treasuryOk ? "✓" : "✗ will set"}`);
  console.log(`USDC type  -> ${usdcType}`);
  console.log(`  on-chain ProfileConfig.coin_type -> ${curCoin ?? "(unpinned)"} ${coinOk ? "✓" : "✗ will set"}`);

  if (treasuryOk && coinOk) {
    console.log("\n✓ already synced — no-op.");
    return;
  }

  // Find the ProfileAdminCap the signer holds.
  const admin = loadAdminKeypair();
  const adminAddr = admin.toSuiAddress();
  const caps = await client.listOwnedObjects({
    owner: adminAddr,
    type: `${PROFILE.PACKAGE}::profile::ProfileAdminCap`,
  });
  const capId = caps.objects[0]?.objectId;
  if (!capId) throw new Error(`signer ${adminAddr} holds no ProfileAdminCap — wrong wallet?`);

  console.log(`\nsigner: ${adminAddr}\n  cap:    ${capId}\n  config: ${PROFILE.CONFIG_OBJECT}`);
  if (DRY_RUN) {
    console.log("\nDRY_RUN=1 — not executing.");
    return;
  }

  // Batch the legs that differ into ONE admin tx. NOTE the arg order matches the module:
  // set_treasury(config, cap, addr) · set_coin_type<T>(config, cap).
  const tx = new Transaction();
  if (!treasuryOk) {
    tx.moveCall({
      target: `${PROFILE.PACKAGE}::profile::set_treasury`,
      arguments: [tx.object(PROFILE.CONFIG_OBJECT), tx.object(capId), tx.pure.address(targetTreasury)],
    });
  }
  if (!coinOk) {
    tx.moveCall({
      target: `${PROFILE.PACKAGE}::profile::set_coin_type`,
      typeArguments: [usdcType],
      arguments: [tx.object(PROFILE.CONFIG_OBJECT), tx.object(capId)],
    });
  }
  const res = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: admin,
    include: { effects: true },
  });
  const exec = res.Transaction ?? res.FailedTransaction;
  if (!exec.status.success) {
    throw new Error(`sync failed: ${exec.status.error?.message ?? "unknown"}`);
  }
  console.log(`\n✓ synced (treasury${treasuryOk ? "" : " set"}, coin_type${coinOk ? "" : " set"}). digest: ${exec.digest}`);
}

main().catch((e) => {
  console.error("sync-profile-config FAILED:", (e as Error).message);
  process.exit(1);
});
