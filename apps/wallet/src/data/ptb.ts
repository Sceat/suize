/**
 * PTB builders — the wallet's on-chain WRITE surface, in ONE place.
 *
 * Every builder here returns a `@mysten/sui` `Transaction` (the PTB), NOT bytes and
 * NOT a network call. The caller (`useHome.runSponsored`) does the transport in the
 * EXACT Crash pattern: build the transaction-KIND bytes (`onlyTransactionKind`),
 * `wsSponsor` for the full sponsored bytes + digest, sign those bytes VERBATIM with
 * the zkLogin session, then `wsExecute`. Keeping the builders pure (tx in, tx out)
 * makes them trivially testable and keeps the WS seam in exactly one file.
 *
 * WHY tx-builders and not tx-KIND-bytes here: `tx.build({ onlyTransactionKind })`
 * needs a live SuiClient (for object/coin resolution) which only `useHome` holds at
 * the dapp-kit boundary. So this module owns the MOVE SHAPES (targets, arg order,
 * type args, the Clock at 0x6) — the single source of truth for what each write IS —
 * and `useHome` owns the transport. One concern per file.
 *
 * THE MOVE SURFACES (verified against packages/move-wallet/sources):
 *   mandate::create_mandate(budget:u64, scope:vector<u8>, expiry_ms:u64, &Clock, ctx)
 *           — SHARES the Mandate, emits MandateCreated{mandate_id,…}. No return value,
 *             so the new mandate id is only known POST-execution (read the event).
 *   mandate::issue_agent_cap(&mut Mandate, agent:address, ctx)
 *           — mints + allow-lists an AgentCap, TRANSFERS it to `agent`, emits
 *             AgentCapIssued{mandate_id,cap_id,agent}.
 *   mandate::revoke_agent_cap(&mut Mandate, cap_id:ID, ctx)   — the kill switch.
 *   vault::create_vault<T>(mandate_id:ID, ctx)                — single-asset custody.
 *   swap::create_swap_vault<Base,Quote>(mandate_id:ID, ctx)   — DEGEN two-sided.
 *   navi::create_vault<AccountCapT>(mandate_id:ID, ctx)       — SAFE multi-asset.
 *   vault::deposit<T>(&mut Vault<T>, Coin<T>, ctx)            — fund the idle pot.
 *   swap::agent_swap_base_to_quote<Base,Quote>(vault, mandate, cap, pool, scope_tag,
 *           amount_in, deep_fee, min_quote_out, &Clock, ctx)  — agent-only swap.
 *
 * THE TWO-PHASE TRUTH (honest, not a stub): `create_mandate` shares the mandate and
 * returns NOTHING, so step "issue cap / create vault for this mandate" cannot
 * reference the new mandate's id in the SAME PTB. Account creation is therefore a
 * REAL two-phase flow:
 *   phase 1: buildCreateMandate  -> execute -> read mandate_id from MandateCreated
 *   phase 2: buildVaultAndCap    -> execute -> read vault_id + cap_id from events
 * `useHome.createAccount` runs both phases and persists the ids. This file exposes
 * each phase as its own builder so the phasing is explicit + testable.
 */

import { Transaction } from '@mysten/sui/transactions';
import { PACKAGE_IDS } from '@suize/shared';
import type { AiRole, Strategy } from './types';
import { ScopeTag } from './types';
import { SUI, USDC } from './coins';

const TARGETS = PACKAGE_IDS.WALLET.TARGETS;

/** The system Clock object id — always 0x6 on every Sui network. */
export const CLOCK_ID = '0x6';

/** Default leash window for a freshly-minted mandate (owner can re-leash later). */
export const DEFAULT_EXPIRY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** An expiry timestamp `days` from now, in epoch ms (matches mandate.expiry_ms). */
export function expiryFromNow(days: number = DEFAULT_EXPIRY_DAYS): number {
  return Date.now() + days * DAY_MS;
}

// ───────────────────────────────────────────────────────────────────────────
// Scope + vault-kind mapping (UI role/strategy -> on-chain mandate scope + vault).
// ───────────────────────────────────────────────────────────────────────────

/**
 * The mandate scope set for a (role, strategy) pair — the tags the agent may act
 * under. Mirrors the on-chain mint choice (mandate::create_mandate `scope`):
 *   spending          -> [Spend]                          (pay/transfer)
 *   investing + safe   -> [NaviSupply, NaviWithdraw]       (NAVI lend-as-is)
 *   investing + risky  -> [DeepbookSwap]                   (DeepBook spot swaps)
 */
export function scopeFor(role: AiRole, strategy: Strategy): ScopeTag[] {
  if (role === 'spending') return [ScopeTag.Spend];
  return strategy === 'safe'
    ? [ScopeTag.NaviSupply, ScopeTag.NaviWithdraw]
    : [ScopeTag.DeepbookSwap];
}

/**
 * Which vault kind a (role, strategy) needs:
 *   'single' — single-asset `Vault<T>` (spending, or a simple idle custody).
 *   'swap'   — two-sided `SwapVault<Base,Quote>` (investing RISKY / DeepBook).
 *   'navi'   — multi-asset `MultiAssetVault<AccountCapT>` (investing SAFE / NAVI).
 *
 * SPENDING + INVESTING-SAFE both use a single `Vault<SUI>` in THIS pass: the NAVI
 * MultiAssetVault needs a real `AccountCap` type arg (created off-chain by the helm
 * via lending_core::create_account — see ARCHITECTURE §2), which the wallet can't
 * mint yet. A single `Vault<SUI>` is the honest, real, fundable custody object for
 * both until the helm wires the NAVI AccountCap. RISKY uses the real SwapVault.
 */
export type VaultKind = 'single' | 'swap';

export function vaultKindFor(role: AiRole, strategy: Strategy): VaultKind {
  if (role === 'investing' && strategy === 'risky') return 'swap';
  return 'single';
}

// ───────────────────────────────────────────────────────────────────────────
// PHASE 1 — create the mandate (the leash).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build PHASE 1 of account creation: mint + share a `Mandate` with `budgetMist`
 * budget, the (role, strategy) scope, and a 30-day expiry. SHARES the mandate (no
 * return value) and emits `MandateCreated{mandate_id,…}` — the caller reads
 * `mandate_id` from that event AFTER execution to drive phase 2.
 *
 * @param role        which AI account (scopes Spend vs Navi/Deepbook).
 * @param strategy    investing risk tier (ignored for spending). Picks the scope.
 * @param budgetMist  budget cap in the smallest unit (Mist for SUI). The agent
 *                    can never spend past this — the on-chain budget gate.
 * @param expiryMs    epoch-ms expiry (default: 30 days from now).
 */
export function buildCreateMandate(opts: {
  role: AiRole;
  strategy: Strategy;
  budgetMist: bigint | number;
  expiryMs?: number;
}): Transaction {
  const scope = scopeFor(opts.role, opts.strategy).map((t) => Number(t));
  const expiryMs = opts.expiryMs ?? expiryFromNow();

  const tx = new Transaction();
  tx.moveCall({
    target: TARGETS.MANDATE_CREATE,
    arguments: [
      tx.pure.u64(BigInt(opts.budgetMist)),
      tx.pure.vector('u8', scope),
      tx.pure.u64(BigInt(expiryMs)),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// PHASE 2 — create the vault + issue the agent cap (both reference the mandate id
// minted in phase 1). Funding rides phase 3 (buildDepositSui) once the vault id is
// known, since create_vault SHARES the vault and returns no result to deposit into.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build PHASE 2 of account creation against an already-minted `mandateId`:
 *   1. create the vault (single `Vault<SUI>` or two-sided `SwapVault<SUI,USDC>`),
 *   2. issue an AgentCap to `agentAddress` (transferred to the agent, allow-listed).
 *
 * Emits `VaultCreated`/`SwapVaultCreated` (-> vault_id) and `AgentCapIssued`
 * (-> cap_id); the caller reads both after execution and persists them.
 *
 * FUNDING NOTE: create_vault SHARES the vault and returns nothing, so there is no
 * result to deposit into in THIS PTB. Funding is a separate signed step
 * (buildDepositSui) once the vault id is read — for the single-asset vault. The swap
 * vault funds via its dedicated deposit_base/quote/deep calls.
 *
 * @param mandateId    the shared Mandate id from phase 1's MandateCreated event.
 * @param kind         'single' (Vault<SUI>) or 'swap' (SwapVault<SUI,USDC>).
 * @param agentAddress the agent keypair address the AgentCap is transferred to.
 */
export function buildVaultAndCap(opts: {
  mandateId: string;
  kind: VaultKind;
  agentAddress: string;
}): Transaction {
  const tx = new Transaction();

  if (opts.kind === 'swap') {
    // Two-sided DeepBook vault: Base=SUI, Quote=USDC (DeepBook pool order).
    tx.moveCall({
      target: TARGETS.SWAP_CREATE,
      arguments: [tx.pure.id(opts.mandateId)],
      typeArguments: [SUI.type, USDC.type],
    });
  } else {
    // Single-asset SUI custody. create_vault SHARES the vault and returns nothing,
    // so we cannot deposit into THIS call's result — funding rides phase 3
    // (buildDepositSui) once the vault id is read. Here we just create the vault.
    tx.moveCall({
      target: TARGETS.VAULT_CREATE,
      arguments: [tx.pure.id(opts.mandateId)],
      typeArguments: [SUI.type],
    });
  }

  // Issue the AgentCap for THIS mandate, transferred to the agent + allow-listed.
  tx.moveCall({
    target: TARGETS.MANDATE_ISSUE_CAP,
    arguments: [tx.object(opts.mandateId), tx.pure.address(opts.agentAddress)],
  });

  return tx;
}

/**
 * Build a SUI funding deposit into an existing single-asset `Vault<SUI>`: split
 * `amountMist` off the gas coin and `vault::deposit<SUI>` it into the idle pot.
 * Used by `useHome.createAccount` (phase 3, after the vault id is read) and by any
 * later "add funds" action on a single-asset account.
 *
 * @param vaultId     the shared Vault<SUI> id (from VaultCreated.vault_id).
 * @param amountMist  SUI to deposit, in Mist.
 */
export function buildDepositSui(opts: { vaultId: string; amountMist: bigint | number }): Transaction {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(opts.amountMist))]);
  tx.moveCall({
    target: TARGETS.VAULT_DEPOSIT,
    arguments: [tx.object(opts.vaultId), coin],
    typeArguments: [SUI.type],
  });
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// Kill switch — pause (revoke the cap) / resume (issue a fresh cap).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build the PAUSE tx: revoke the agent cap (remove it from the allow-list). The
 * agent's next gated move aborts `ECapNotAllowed` — the on-chain kill switch.
 * mandate::revoke_agent_cap(&mut Mandate, cap_id:ID, ctx).
 */
export function buildPause(opts: { mandateId: string; capId: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: TARGETS.MANDATE_REVOKE_CAP,
    arguments: [tx.object(opts.mandateId), tx.pure.id(opts.capId)],
  });
  return tx;
}

/**
 * Build the RESUME tx: mint + allow-list a FRESH AgentCap, transferred to the agent.
 * (We never un-revoke the old cap; a revoke is permanent — a new cap is issued.)
 * The new cap id comes from AgentCapIssued post-execution; the caller updates the
 * persisted ref. mandate::issue_agent_cap(&mut Mandate, agent:address, ctx).
 */
export function buildResume(opts: { mandateId: string; agentAddress: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: TARGETS.MANDATE_ISSUE_CAP,
    arguments: [tx.object(opts.mandateId), tx.pure.address(opts.agentAddress)],
  });
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// Set strategy (investing) — re-leash onto a NEW mandate with the new scope.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build PHASE 1 of a strategy change: revoke the current cap (drop the old leash)
 * AND mint a new mandate with the NEW scope, atomically in one tx. The new mandate
 * is shared (id only known post-execution), so issuing the cap for it is PHASE 2
 * (buildResume against the new mandate id, read from the new MandateCreated event).
 *
 * Budget defaults to 0 (the new mandate is funded separately — no fabricated
 * budget); pass `budgetMist` to carry a budget across.
 *
 * @param oldMandateId  the current mandate (its cap is revoked).
 * @param oldCapId      the current AgentCap id to revoke.
 * @param strategy      the NEW risk tier (safe / risky) -> the new scope set.
 * @param budgetMist    budget for the new mandate (default 0; fund separately).
 */
export function buildSetStrategyPhase1(opts: {
  oldMandateId: string;
  oldCapId: string;
  strategy: Strategy;
  budgetMist?: bigint | number;
  expiryMs?: number;
}): Transaction {
  const scope = scopeFor('investing', opts.strategy).map((t) => Number(t));
  const expiryMs = opts.expiryMs ?? expiryFromNow();

  const tx = new Transaction();
  // 1. Drop the old leash so the old scope can no longer act.
  tx.moveCall({
    target: TARGETS.MANDATE_REVOKE_CAP,
    arguments: [tx.object(opts.oldMandateId), tx.pure.id(opts.oldCapId)],
  });
  // 2. Mint the new mandate with the new scope (shared on execution).
  tx.moveCall({
    target: TARGETS.MANDATE_CREATE,
    arguments: [
      tx.pure.u64(BigInt(opts.budgetMist ?? 0n)),
      tx.pure.vector('u8', scope),
      tx.pure.u64(BigInt(expiryMs)),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// Manual send / transfer (MAIN wallet -> recipient). NOT a vault op.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build a direct coin transfer from the owner's MAIN wallet to `recipient`. This is
 * a plain `0x2::transfer::public_transfer` (NOT a vault/mandate op) — the user
 * moving their OWN money. Sponsored over the WS iff the coin type is in
 * SPONSORED_COINS (the caller decides), but the PTB is identical either way.
 *
 * SUI is sent by splitting the gas coin; any other coin is sent by merging the
 * owner's coins of that type and splitting the exact amount. dapp-kit's
 * `tx.splitCoins(tx.gas, …)` works for SUI; for non-SUI we resolve the input coins
 * at build time via the client (handled in useHome, which holds the client).
 *
 * To keep this builder PURE (no client), the caller passes the already-resolved
 * input coin object id(s) for non-SUI; for SUI it passes `coinType === SUI.type` and
 * we split gas. This mirrors how Crash builds its bet PTB at the dapp-kit boundary.
 *
 * @param coinType   the Move coin type to send (SUI.type uses gas-split).
 * @param recipient  the destination 0x… address (already resolved from SuiNS/hex).
 * @param amountRaw  amount in the coin's smallest unit (Mist for SUI, 1e-6 for USDC).
 * @param sourceCoinIds  for NON-SUI: owned coin object ids of `coinType` to draw from
 *                       (merged then split). Ignored for SUI. Resolved by the caller.
 */
export function buildTransfer(opts: {
  coinType: string;
  recipient: string;
  amountRaw: bigint | number;
  sourceCoinIds?: string[];
}): Transaction {
  const tx = new Transaction();
  const amount = tx.pure.u64(BigInt(opts.amountRaw));

  if (opts.coinType === SUI.type) {
    // Native SUI: split off the gas coin (the sponsor provides gas, but the SPLIT
    // is from the SENDER's SUI — for a sponsored tx the gas owner differs from the
    // sender, so the caller must pass an explicit SUI coin id when sponsoring SUI;
    // see useHome.send which resolves it). Default path (self-pay) splits gas.
    const [coin] = tx.splitCoins(tx.gas, [amount]);
    tx.transferObjects([coin], tx.pure.address(opts.recipient));
    return tx;
  }

  // Non-SUI: merge the owner's coins of this type, then split the exact amount.
  const sources = opts.sourceCoinIds ?? [];
  if (sources.length === 0) {
    throw new Error(`buildTransfer: no source coins for ${opts.coinType}`);
  }
  const primary = tx.object(sources[0]);
  if (sources.length > 1) {
    tx.mergeCoins(primary, sources.slice(1).map((id) => tx.object(id)));
  }
  const [coin] = tx.splitCoins(primary, [amount]);
  tx.transferObjects([coin], tx.pure.address(opts.recipient));
  return tx;
}

/**
 * Build a SUI transfer that splits from an EXPLICIT owned SUI coin (not the gas
 * coin). Required when the tx is SPONSORED: the gas coin belongs to the sponsor, so
 * the SUI being sent must come from one of the SENDER's own SUI coins. The caller
 * (useHome.send) resolves the sender's SUI coins and passes them here.
 */
export function buildTransferSuiSponsored(opts: {
  recipient: string;
  amountRaw: bigint | number;
  sourceCoinIds: string[];
}): Transaction {
  if (opts.sourceCoinIds.length === 0) {
    throw new Error('buildTransferSuiSponsored: no source SUI coins');
  }
  const tx = new Transaction();
  const primary = tx.object(opts.sourceCoinIds[0]);
  if (opts.sourceCoinIds.length > 1) {
    tx.mergeCoins(primary, opts.sourceCoinIds.slice(1).map((id) => tx.object(id)));
  }
  const [coin] = tx.splitCoins(primary, [tx.pure.u64(BigInt(opts.amountRaw))]);
  tx.transferObjects([coin], tx.pure.address(opts.recipient));
  return tx;
}

// ───────────────────────────────────────────────────────────────────────────
// Convert / swap (investing RISKY, agent-gated DeepBook swap).
// ───────────────────────────────────────────────────────────────────────────

/**
 * A direction for the swap vault: which side of SUI/USDC goes in. SUI->USDC is
 * `base_to_quote`; USDC->SUI is `quote_to_base`. Consumed by `ConvertSheet.tsx`.
 *
 * The agent-gated DeepBook swap PTB itself is NOT built here yet — it lands with the
 * agent loop (the convert path rebuilds it then, mirroring `useHome.convert`). This
 * type is the stable seam the sheet uses to pick a direction in the meantime.
 */
export type SwapDirection = 'base_to_quote' | 'quote_to_base';
