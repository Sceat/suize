// Guard against on-chain ↔ off-chain PTB ARITY DRIFT — the create_site class. A Move
// republish that adds/removes a parameter silently breaks every PTB builder that wasn't
// updated in lockstep (TypeScript can't catch it — moveCall args is just an array). This
// fetches each Move function's LIVE signature and asserts the value-arg + type-arg counts
// match what the backend's PTB builders supply. Run before/after any republish:
//
//   bun run check:arity                                  # from services/backend
//   bun run --filter @suize/backend check:arity          # from repo root
//   SUI_NETWORK=mainnet bun run check:arity
//
// Exits non-zero on ANY drift (so it can gate a deploy). Keep EXPECT in lockstep with the
// PTB builders: bump the `args` here whenever you add/remove a moveCall argument.

import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { PACKAGE_IDS, resolveNetwork, fullnodeUrl } from "@suize/shared";

const network = resolveNetwork(process.env.SUI_NETWORK);
const client = new SuiJsonRpcClient({ url: fullnodeUrl(network), network });

// EXPECT[i].args = the number of VALUE arguments the PTB supplies (everything EXCEPT the
// runtime-injected `&mut TxContext`; `&Clock`, objects, and pure values all count).
// typeArgs = the number of type arguments. `where` = the PTB builder to fix on a mismatch.
const EXPECT: { target: string; args: number; typeArgs: number; where: string }[] = [
  { target: PACKAGE_IDS.DEPLOY.TARGETS.CREATE_SITE, args: 13, typeArgs: 0, where: "deploy/index.ts createSiteOnChain" },
  { target: PACKAGE_IDS.DEPLOY.TARGETS.LINK_DOMAIN, args: 5, typeArgs: 0, where: "deploy/index.ts linkDomainOnChain" },
  { target: PACKAGE_IDS.DEPLOY.TARGETS.UNLINK_DOMAIN, args: 4, typeArgs: 0, where: "deploy/index.ts unlinkDomainOnChain" },
  { target: PACKAGE_IDS.SUBS.TARGETS.CREATE, args: 7, typeArgs: 1, where: "deploy/subscribe.ts buildSubscribeKind (+ wallet/data/subs buildCreate)" },
  { target: PACKAGE_IDS.SUBS.TARGETS.RENEW, args: 4, typeArgs: 1, where: "wallet/data/subs buildRenew (+ relayer)" },
  { target: PACKAGE_IDS.SUBS.TARGETS.CANCEL, args: 1, typeArgs: 1, where: "wallet/data/subs buildCancel" },
];

/** A parameter type that is the runtime-injected `&mut TxContext` (never a PTB arg). */
const isTxContext = (p: unknown): boolean => {
  const s = typeof p === "string" ? p : JSON.stringify(p);
  return /TxContext/.test(s);
};

async function main() {
  let drift = 0;
  for (const e of EXPECT) {
    const [pkg, module, fn] = e.target.split("::");
    if (pkg === "0x0") {
      console.log(`⊘ ${module}::${fn} — package unpublished on ${network} (skipped)`);
      continue;
    }
    let sig: { parameters?: unknown[]; typeParameters?: unknown[] };
    try {
      sig = await client.getNormalizedMoveFunction({ package: pkg, module, function: fn });
    } catch (err) {
      console.error(`✗ ${module}::${fn} — could not read signature: ${(err as Error).message}`);
      drift++;
      continue;
    }
    const params = sig.parameters ?? [];
    const valueArgs = params.filter((p) => !isTxContext(p)).length; // PTB supplies all but TxContext
    const typeArgs = (sig.typeParameters ?? []).length;
    const ok = valueArgs === e.args && typeArgs === e.typeArgs;
    if (ok) {
      console.log(`✓ ${module}::${fn} — ${valueArgs} args, ${typeArgs} type-args`);
    } else {
      drift++;
      console.error(
        `✗ ${module}::${fn} — ON-CHAIN ${valueArgs} args / ${typeArgs} type-args ` +
          `BUT the PTB sends ${e.args} / ${e.typeArgs}. Fix ${e.where} (or update EXPECT).`,
      );
    }
  }
  if (drift > 0) {
    console.error(`\n✗ PTB arity drift on ${drift} function(s) — a deploy would break. Resolve before shipping.`);
    process.exit(1);
  }
  console.log(`\n✓ all PTB builders match their on-chain signatures (${network}).`);
}

main().catch((e) => {
  console.error("check-ptb-arity FAILED:", (e as Error).message);
  process.exit(1);
});
