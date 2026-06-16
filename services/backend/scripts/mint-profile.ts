// Mint (or seed) a BusinessProfile NFT from the Sui CLI active address — the same
// `profile::create_profile<USDC>` the wallet's Profile tab builds, but signed by the CLI
// keypair (self-gas, native USDC), so it runs headless. Used to seed the genesis ad-slot
// holder's house profile and to E2E-prove the directory resolves a real on-chain profile.
//
//   bun run scripts/mint-profile.ts                       # house defaults (Suize)
//   NAME="Acme AI" DESC="…" LOGO=https://… BANNER=https://… SITE=https://acme.ai \
//     bun run scripts/mint-profile.ts
//   DRY_RUN=1 bun run scripts/mint-profile.ts             # print, no tx
//
// AUTH: signs with the CLI active address (~/.sui/sui_config) — it pays the flat $0.10
// (PROFILE_FEE) in native USDC + gas in SUI. The profile is SOULBOUND to that address.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { packageIds, resolveNetwork, fullnodeUrl, USDC_TYPES, PROFILE_FEE, type SuiNetwork } from "@suize/shared";

const network = resolveNetwork(process.env.SUI_NETWORK) as SuiNetwork;
const DRY_RUN = process.env.DRY_RUN === "1";

const FIELDS = {
  name: process.env.NAME ?? "Suize",
  description: process.env.DESC ?? "Get paid by AI agents — USDC, gasless, no signup.",
  imageUrl: process.env.LOGO ?? "https://suize.io/logo.png",
  bannerUrl: process.env.BANNER ?? "https://suize.io/og.png",
  website: process.env.SITE ?? "https://suize.io",
};

function loadKeypair(): Ed25519Keypair {
  const envKey = process.env.SUIZE_ADMIN_PRIVATE_KEY?.trim();
  if (envKey) return Ed25519Keypair.fromSecretKey(envKey);
  const dir = join(homedir(), ".sui", "sui_config");
  const active = readFileSync(join(dir, "client.yaml"), "utf8").match(/active_address:\s*"?(0x[0-9a-fA-F]+)"?/)?.[1];
  if (!active) throw new Error("no active_address in client.yaml");
  const entries = JSON.parse(readFileSync(join(dir, "sui.keystore"), "utf8")) as string[];
  for (const b64 of entries) {
    const raw = Buffer.from(b64, "base64");
    if (raw[0] !== 0x00) continue;
    const kp = Ed25519Keypair.fromSecretKey(new Uint8Array(raw.subarray(1)));
    if (kp.toSuiAddress().toLowerCase() === active.toLowerCase()) return kp;
  }
  throw new Error(`no Ed25519 keystore entry matches ${active}`);
}

async function main() {
  const { PROFILE } = packageIds(network);
  if (PROFILE.PACKAGE === "0x0") throw new Error(`profile not published on ${network}`);
  const usdcType = USDC_TYPES[network];
  const client = new SuiJsonRpcClient({ url: fullnodeUrl(network), network });
  const signer = loadKeypair();
  const addr = signer.toSuiAddress();

  console.log(`network : ${network}`);
  console.log(`minter  : ${addr}`);
  console.log(`fee     : ${PROFILE_FEE} (native USDC)`);
  console.log(`fields  :`, JSON.stringify(FIELDS, null, 2));
  if (DRY_RUN) {
    console.log("\nDRY_RUN=1 — not executing.");
    return;
  }

  const tx = new Transaction();
  const payment = tx.balance({ type: usdcType, balance: BigInt(PROFILE_FEE) });
  tx.moveCall({
    target: PROFILE.TARGETS.CREATE_PROFILE,
    typeArguments: [usdcType],
    arguments: [
      tx.object(PROFILE.VERSION_OBJECT),
      tx.object(PROFILE.CONFIG_OBJECT),
      payment,
      tx.pure.string(FIELDS.name),
      tx.pure.string(FIELDS.description),
      tx.pure.string(FIELDS.imageUrl),
      tx.pure.string(FIELDS.bannerUrl),
      tx.pure.string(FIELDS.website),
    ],
  });

  const res = await client.signAndExecuteTransaction({
    transaction: tx,
    signer,
    options: { showEffects: true, showObjectChanges: true },
  });
  if (res.effects?.status?.status !== "success") {
    throw new Error(`mint failed: ${res.effects?.status?.error}`);
  }
  const created = (res.objectChanges ?? []).find(
    (c) => c.type === "created" && typeof c.objectType === "string" && c.objectType.endsWith("::profile::BusinessProfile"),
  );
  const profileId = created && "objectId" in created ? created.objectId : "(unknown)";
  console.log(`\n✓ minted BusinessProfile ${profileId}`);
  console.log(`  digest: ${res.digest}`);
}

main().catch((e) => {
  console.error("mint-profile FAILED:", (e as Error).message);
  process.exit(1);
});
