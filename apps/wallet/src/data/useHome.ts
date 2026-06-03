/**
 * The wallet data layer — the THREE-account home (Main + AI Spending + AI Investing).
 *
 * The UI imports the HomeApi from HERE, never from a mock. There is no mock layer:
 * MAIN balances are REAL (`getAllBalances`), and each AI account reflects REAL
 * on-chain Mandate/Vault state once the account is CREATED. No fabricated P&L —
 * until an account exists it shows an honest EMPTY state ($0, 0 delta).
 *
 * REAL NOW (all on-chain writes route through the unified WS sponsor — build
 * tx-KIND bytes, wsSponsor, sign the sponsored bytes VERBATIM, wsExecute):
 *   • MAIN — `getAllBalances({ owner })` mapped onto SUPPORTED, owned-first.
 *   • AUTO-SETUP-ON-FUND (the production path) — transferBetweenAccounts('main-to-
 *     vault', role, amount) makes the account EXIST on its first fund: with no
 *     persisted refs, ensureAccount silently runs the two-phase create (mandate +
 *     vault + cap) BEFORE the deposit, then deposits. The user only sees "money
 *     moved"; first fund = create. There is NO "account not set up" error anywhere.
 *   • createAccount(role, …) — the EXPLICIT setup-sheet path: mint the mandate,
 *     create + fund the vault, issue the AgentCap to the configured agent
 *     (VITE_AGENT_ADDRESS). Delegates the cage build to ensureAccount. TWO-PHASE
 *     because create_mandate shares + returns no id: phase 1 mints the mandate and we
 *     read mandate_id from MandateCreated; phase 2 creates the vault + issues the cap
 *     and we read vault_id + cap_id from their events; phase 3 (single-asset) funds it.
 *     The ids persist in `accountStore` (localStorage, owner-scoped) so pause /
 *     strategy keep working across reloads.
 *   • togglePause(role) — revoke_agent_cap (pause) / issue_agent_cap (resume),
 *     against the PERSISTED refs. Resume re-issues a fresh cap (revoke is permanent)
 *     and we persist the new cap id.
 *   • setStrategy(role,s) — revoke the old cap + mint a new mandate with the new
 *     scope (phase 1), then issue a fresh cap for the new mandate (phase 2, after the
 *     new mandate id is read). Re-leashes the investing account onto the new scope
 *     and persists the new { mandateId, capId }.
 *   • send(args) — direct MAIN public_transfer (sponsored iff SPONSORED_COINS).
 *   (Convert is agent-gated — the AgentCap lives on the agent, not the owner — so it's
 *   disabled in the UI until the agent loop signs swaps; there is no owner-side convert.)
 *
 * LIVE STATE: once an account's refs exist, its budget / expiry / vault value are
 * read from chain via devInspect (mandate::budget_remaining / expiry_ms,
 * vault::idle_value) so the home mirror reflects truth, not a guess.
 *
 * The hook signature is STABLE: `useHome(ownerAddress?) -> HomeApi`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useSignTransaction,
  useSuiClient,
  useSuiClientQuery,
} from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { PACKAGE_IDS } from '@suize/shared';
import type {
  AccountRefs,
  AiAccount,
  AiRole,
  AllocationWeights,
  ChatMessage,
  CreateAccountOpts,
  Currency,
  HomeApi,
  HomeState,
  SendInput,
  Strategy,
  TransferDirection,
  TransferResult,
} from './types';
import { strategyFromAllocations } from './types';
import { SUI, SUPPORTED, SPONSORED_COINS } from './coins';
import { priceUsd } from './prices';
import { requestSponsorship, executeSponsored } from './suins';
import { onBalanceUpdate, onLivechatMessage } from './ws';
import { AGENT_ADDRESS } from '../lib/env';
import {
  getAccountRefs,
  setAccountRefs,
  updateCapId,
  updateMandate,
  updateAllocations,
} from './accountStore';
import {
  buildCreateMandate,
  buildVaultAndCap,
  buildDepositSui,
  buildPause,
  buildResume,
  buildSetStrategyPhase1,
  buildTransfer,
  buildTransferSuiSponsored,
  scopeFor,
  vaultKindFor,
} from './ptb';

const WALLET_PKG = PACKAGE_IDS.WALLET.PACKAGE;

/**
 * Read-only accessor targets for devInspect (NEVER sponsored — they're not in the
 * shared sponsorable TARGETS set on purpose; reads aren't signed, only inspected).
 * Built locally from the live package id so the home mirror reflects chain truth.
 */
const READ_TARGETS = {
  MANDATE_BUDGET_REMAINING: `${WALLET_PKG}::mandate::budget_remaining`,
  MANDATE_EXPIRY_MS: `${WALLET_PKG}::mandate::expiry_ms`,
  VAULT_IDLE_VALUE: `${WALLET_PKG}::vault::idle_value`,
} as const;

/** Default leash window for a freshly (re-)minted mandate. Owner can edit later. */
const DEFAULT_EXPIRY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The all-zero address — a safe devInspect sender when no owner is signed in. */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000000000000000000000000000';

/** Per-render mutable controls so pause/strategy feel immediate before the read settles. */
interface Controls {
  spendingPaused: boolean;
  investingPaused: boolean;
  investingStrategy: Strategy;
}

/** Live on-chain values read for ONE account (budget/expiry/vault value). */
interface AccountLive {
  budgetUsd: number;
  expiryDays: number;
  usd: number;
}

/**
 * Build the honest EMPTY AI account for `role`. Real vault value is $0 until funded;
 * deltas are 0 (NO fabricated P&L). The mandate mirror reflects the chosen scope
 * with `active = !paused`; budget/expiry come from `live` when an account exists.
 */
function accountView(
  role: AiRole,
  strategy: Strategy,
  paused: boolean,
  live: AccountLive | null,
): AiAccount {
  return {
    role,
    label: role === 'spending' ? 'Spending' : 'Investing',
    usd: live?.usd ?? 0,
    deltaPct: 0,
    deltaUsd: 0,
    mandate: {
      budgetUsd: live?.budgetUsd ?? 0,
      expiryDays: live?.expiryDays ?? 0,
      scope: scopeFor(role, strategy),
      active: !paused,
    },
    paused,
  };
}

/**
 * Merge live `getAllBalances` rows onto SUPPORTED, then re-sort OWNED-FIRST (held
 * balances by USD descending, then the rest in SUPPORTED order).
 */
function mergeBalances(balances: Map<string, string>): Currency[] {
  const merged: Currency[] = SUPPORTED.map((coin) => {
    const raw = balances.get(coin.type) ?? '0';
    const ui = Number(raw) / 10 ** coin.decimals;
    return {
      sym: coin.sym,
      name: coin.name,
      type: coin.type,
      decimals: coin.decimals,
      color: coin.color,
      raw,
      ui,
      usd: ui * priceUsd(coin.type),
      displayOnly: coin.displayOnly,
    };
  });

  return merged
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const aOwned = a.c.usd > 0 ? 1 : 0;
      const bOwned = b.c.usd > 0 ? 1 : 0;
      if (aOwned !== bOwned) return bOwned - aOwned;
      if (aOwned === 1 && a.c.usd !== b.c.usd) return b.c.usd - a.c.usd;
      return a.i - b.i;
    })
    .map(({ c }) => c);
}

/** Extract a string field from one of a tx's emitted events whose type ends with `suffix`. */
function eventField(
  events: Array<{ type: string; parsedJson?: unknown }> | null | undefined,
  typeSuffix: string,
  field: string,
): string | null {
  if (!events) return null;
  for (const ev of events) {
    if (ev.type.endsWith(typeSuffix) && ev.parsedJson && typeof ev.parsedJson === 'object') {
      const val = (ev.parsedJson as Record<string, unknown>)[field];
      if (typeof val === 'string') return val;
    }
  }
  return null;
}

/**
 * The data hook. `ownerAddress` is the signed-in zkLogin address (from `useAuth`);
 * pass `null`/omit pre-login (empty MAIN + empty AI accounts, no requests fire).
 * `handle` is the resolved "<name>@suize" (from `useIdentity`) threaded into the home
 * snapshot so the TopBar chip + the get-paid sheet show the real handle; '' until resolved.
 */
export function useHome(ownerAddress?: string | null, handle?: string): HomeApi {
  const client = useSuiClient();
  // Sign-ONLY mutation: for sponsored writes we sign the EXACT sponsored bytes the
  // backend returns (passed as a string => signed verbatim), NOT a rebuilt tx.
  const { mutateAsync: signTransaction } = useSignTransaction();

  const owner = ownerAddress ?? '';

  // User-controlled state (immediate UI feedback; reconciled with chain on read).
  const [controls, setControls] = useState<Controls>({
    spendingPaused: false,
    investingPaused: false,
    investingStrategy: 'safe',
  });
  // Which role is mid-mutation (disables that account's controls).
  const [pending, setPending] = useState<AiRole | null>(null);
  // Live on-chain values per account, read after creation / mutation.
  const [live, setLive] = useState<{ spending: AccountLive | null; investing: AccountLive | null }>({
    spending: null,
    investing: null,
  });
  // Bump to force the account-refs memo to recompute after a create/strategy change.
  const [refsVersion, setRefsVersion] = useState(0);
  // The SPENDING chat transcript (journal §03). Future-proof: server livechat pushes
  // append here when the agent emits them. Dormant today (the agent doesn't emit
  // chat); the visible transcript is the chat leaf's local scripted one. 🚩 STUB.
  const [chat, setChat] = useState<ChatMessage[]>([]);

  // REAL MAIN balances — only enabled once we have an address.
  const balancesQuery = useSuiClientQuery(
    'getAllBalances',
    { owner },
    { enabled: owner.length > 0, staleTime: 10_000 },
  );

  const liveCurrencies = useMemo<Currency[] | null>(() => {
    if (!owner || balancesQuery.status !== 'success' || !balancesQuery.data) return null;
    const map = new Map<string, string>();
    for (const b of balancesQuery.data) map.set(b.coinType, b.totalBalance);
    return mergeBalances(map);
  }, [owner, balancesQuery.status, balancesQuery.data]);

  // Server-push augmentation: a `main` BalanceUpdate triggers an immediate refetch.
  const refetchBalances = balancesQuery.refetch;
  useEffect(() => {
    if (!owner) return;
    const off = onBalanceUpdate((update) => {
      if (update.account === 'main') void refetchBalances();
    });
    return off;
  }, [owner, refetchBalances]);

  // Future-proof livechat subscriber (journal §03). Harmless today — the agent
  // backend is a documented stub and never emits livechat, so this never fires.
  // When it does, the protocol's { from, text, at } maps onto the UI ChatMessage
  // shape ({ who:'ai', body }) and appends to the transcript. 🚩 STUB-dormant.
  useEffect(() => {
    if (!owner) return;
    const off = onLivechatMessage((msg) => {
      setChat((prev) => [
        ...prev,
        { id: `lc-${msg.at}-${prev.length}`, who: 'ai', body: msg.text },
      ]);
    });
    return off;
  }, [owner]);

  // ──────────────────────────────────────────────────────────────────────
  // Live-object refs per account — REAL now (persisted in accountStore at
  // creation time, keyed by owner+role). Null until the account is funded, in
  // which case mutations (pause/strategy) are simply UNAVAILABLE (silent no-op)
  // — NEVER a user-facing "not set up" error. The account comes into existence
  // by being funded (transferBetweenAccounts auto-creates on first deposit).
  // ──────────────────────────────────────────────────────────────────────
  const accountRefs = useCallback(
    (role: AiRole): AccountRefs | null => getAccountRefs(owner, role),
    // refsVersion forces a re-read after create/strategy persisted new ids.
    [owner, refsVersion],
  );

  // ──────────────────────────────────────────────────────────────────────
  // Sponsored PTB execution (mirror Crash: build KIND bytes -> wsSponsor ->
  // sign verbatim -> wsExecute). Returns the executed digest.
  // ──────────────────────────────────────────────────────────────────────
  type BuildClient = NonNullable<Parameters<Transaction['build']>[0]>['client'];

  const runSponsored = useCallback(
    async (tx: Transaction): Promise<string> => {
      if (!owner) throw new Error('Not signed in.');
      const kindBytes = await tx.build({
        client: client as unknown as BuildClient,
        onlyTransactionKind: true,
      });
      const { bytes, digest } = await requestSponsorship({
        kindBytesB64: toBase64(kindBytes),
        sender: owner,
      });
      const { signature } = await signTransaction({ transaction: bytes });
      const executed = await executeSponsored({ digest, signature });
      return executed.digest;
    },
    [owner, client, signTransaction],
  );

  /**
   * Execute a sponsored tx and return its emitted events (for reading created object
   * ids). Waits for indexing so MandateCreated / VaultCreated / AgentCapIssued are
   * present, then reads the event list.
   */
  const runSponsoredWithEvents = useCallback(
    async (tx: Transaction) => {
      const digest = await runSponsored(tx);
      const res = await client.waitForTransaction({
        digest,
        options: { showEvents: true },
      });
      return { digest, events: res.events ?? [] };
    },
    [runSponsored, client],
  );

  // ──────────────────────────────────────────────────────────────────────
  // Live on-chain reads (devInspect) — budget / expiry / vault idle value.
  // ──────────────────────────────────────────────────────────────────────
  const readU64 = useCallback(
    async (target: string, objectId: string, typeArgs: string[] = []): Promise<bigint | null> => {
      try {
        const tx = new Transaction();
        tx.moveCall({ target, arguments: [tx.object(objectId)], typeArguments: typeArgs });
        // Build the KIND bytes (Uint8Array) so devInspect is SDK-version agnostic
        // (same cross-SDK bridge as runSponsored — avoids the dapp-kit/@mysten Transaction
        // nominal-type mismatch by handing the RPC raw bytes, not the tx object).
        const kindBytes = await tx.build({
          client: client as unknown as BuildClient,
          onlyTransactionKind: true,
        });
        const res = await client.devInspectTransactionBlock({
          sender: owner || ZERO_ADDRESS,
          transactionBlock: kindBytes,
        });
        const ret = res.results?.[0]?.returnValues?.[0];
        if (!ret) return null;
        // returnValue = [ byteArray, type ]; a u64 is 8 LE bytes.
        const [bytes] = ret;
        let v = 0n;
        for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
        return v;
      } catch {
        return null;
      }
    },
    [client, owner],
  );

  const refreshLive = useCallback(
    async (role: AiRole) => {
      const refs = getAccountRefs(owner, role);
      if (!refs) {
        setLive((l) => ({ ...l, [role]: null }));
        return;
      }
      const [budgetRaw, expiryRaw, idleRaw] = await Promise.all([
        readU64(READ_TARGETS.MANDATE_BUDGET_REMAINING, refs.mandateId),
        readU64(READ_TARGETS.MANDATE_EXPIRY_MS, refs.mandateId),
        // single-asset vault idle value (SwapVault uses base/quote; idle read is a
        // best-effort SUI value for the single vault — 0 for swap until valued).
        refs.vaultKind === 'single'
          ? readU64(READ_TARGETS.VAULT_IDLE_VALUE, refs.vaultId, [SUI.type])
          : Promise.resolve(0n),
      ]);

      const budgetUsd = budgetRaw != null ? (Number(budgetRaw) / 10 ** SUI.decimals) * priceUsd(SUI.type) : 0;
      const expiryDays =
        expiryRaw != null ? Math.max(0, Math.round((Number(expiryRaw) - Date.now()) / DAY_MS)) : 0;
      const usd = idleRaw != null ? (Number(idleRaw) / 10 ** SUI.decimals) * priceUsd(SUI.type) : 0;

      setLive((l) => ({ ...l, [role]: { budgetUsd, expiryDays, usd } }));
    },
    [owner, readU64],
  );

  // Read live state for any already-created accounts on mount / owner change.
  useEffect(() => {
    if (!owner) return;
    void refreshLive('spending');
    void refreshLive('investing');
    // refsVersion re-reads after a create/strategy mutation persists new ids.
  }, [owner, refsVersion, refreshLive]);

  // ──────────────────────────────────────────────────────────────────────
  // The home snapshot.
  // ──────────────────────────────────────────────────────────────────────
  const state = useMemo<HomeState>(() => {
    const currencies = liveCurrencies ?? [];
    const totalUsd = currencies.reduce((sum, c) => sum + c.usd, 0);

    const spending = accountView('spending', 'safe', controls.spendingPaused, live.spending);
    const investing = accountView(
      'investing',
      controls.investingStrategy,
      controls.investingPaused,
      live.investing,
    );

    // The resolved handle is "<name>@suize"; `name` is the bare label before the @.
    const resolvedHandle = handle ?? '';
    const resolvedName = resolvedHandle.split('@')[0] ?? '';

    return {
      name: resolvedName,
      handle: resolvedHandle,
      address: ownerAddress ?? '',
      currencies,
      totalUsd,
      spending,
      investing,
      healthy: !controls.spendingPaused && !controls.investingPaused,
      log: [],
      chat,
    };
  }, [liveCurrencies, controls, ownerAddress, live, handle, chat]);

  // ──────────────────────────────────────────────────────────────────────
  // ensureAccount(role, strategy, budgetMist) — the IDEMPOTENT cage builder.
  //
  // If the account already has persisted refs, returns them untouched (no
  // on-chain write). Otherwise runs the REAL two-phase create (mint mandate ->
  // read id -> create vault + issue cap -> read ids) and persists the refs.
  // This is the single source of truth for "make the account exist", shared by
  // the explicit createAccount sheet AND the transparent auto-create-on-fund
  // path. It does NOT deposit — funding is the caller's separate concern.
  //
  // HONEST PREVIEW GUARD: throws calmly (no fake success) when there is no
  // signer (owner) or no configured agent to receive the cap. The PRODUCTION
  // path is fund -> ensureAccount -> deposit -> ready.
  // ──────────────────────────────────────────────────────────────────────
  const ensureAccount = useCallback(
    async (role: AiRole, strategy: Strategy, budgetMist: bigint): Promise<AccountRefs> => {
      const existing = getAccountRefs(owner, role);
      if (existing) return existing;

      if (!owner) throw new Error('Not signed in.');
      if (!AGENT_ADDRESS) {
        // Owner action: the agent address must be configured to issue the cap to it.
        throw new Error('Agent not configured — set VITE_AGENT_ADDRESS to enable AI accounts.');
      }
      const kind = vaultKindFor(role, strategy);

      // PHASE 1 — mint the mandate; read its id from MandateCreated.
      const expiryMs = Date.now() + DEFAULT_EXPIRY_DAYS * DAY_MS;
      const phase1 = buildCreateMandate({ role, strategy, budgetMist, expiryMs });
      const { events: e1 } = await runSponsoredWithEvents(phase1);
      const mandateId = eventField(e1, '::mandate::MandateCreated', 'mandate_id');
      if (!mandateId) throw new Error('Account creation failed: no mandate id in events.');

      // PHASE 2 — create the vault + issue the cap for THIS mandate; read both ids.
      const phase2 = buildVaultAndCap({ mandateId, kind, agentAddress: AGENT_ADDRESS });
      const { events: e2 } = await runSponsoredWithEvents(phase2);
      const vaultId =
        kind === 'swap'
          ? eventField(e2, '::swap::SwapVaultCreated', 'vault_id')
          : eventField(e2, '::vault::VaultCreated', 'vault_id');
      const capId = eventField(e2, '::mandate::AgentCapIssued', 'cap_id');
      if (!vaultId || !capId) {
        throw new Error('Account creation failed: missing vault/cap id in events.');
      }

      const refs: AccountRefs = {
        mandateId,
        capId,
        vaultId,
        agentAddress: AGENT_ADDRESS,
        vaultKind: kind,
      };
      setAccountRefs(owner, role, refs);

      // Reflect the chosen strategy in the controls so the mirror is coherent.
      setControls((c) => (role === 'investing' ? { ...c, investingStrategy: strategy } : c));
      setRefsVersion((v) => v + 1);
      return refs;
    },
    [owner, runSponsoredWithEvents],
  );

  // ──────────────────────────────────────────────────────────────────────
  // createAccount(role, opts) — the EXPLICIT setup-sheet entry point: build the
  // cage via ensureAccount, then optionally fund it (phase 3). Kept for the
  // SetupAccountSheet; the journal's fund path uses transferBetweenAccounts,
  // which auto-creates transparently.
  // ──────────────────────────────────────────────────────────────────────
  const createAccount = useCallback(
    async (role: AiRole, opts: CreateAccountOpts): Promise<AccountRefs> => {
      if (!owner) throw new Error('Not signed in.');
      const strategy: Strategy = role === 'investing' ? opts.strategy ?? 'safe' : 'safe';

      setPending(role);
      try {
        const refs = await ensureAccount(role, strategy, opts.budgetMist);

        // PHASE 3 (single-asset only) — fund the vault's idle pot with SUI if asked.
        if (refs.vaultKind === 'single' && opts.fundMist && opts.fundMist > 0n) {
          await runSponsored(buildDepositSui({ vaultId: refs.vaultId, amountMist: opts.fundMist }));
        }

        setRefsVersion((v) => v + 1);
        void refetchBalances();
        return refs;
      } finally {
        setPending(null);
      }
    },
    [owner, ensureAccount, runSponsored, refetchBalances],
  );

  const hasAccount = useCallback(
    (role: AiRole): boolean => getAccountRefs(owner, role) != null,
    [owner, refsVersion],
  );

  // ──────────────────────────────────────────────────────────────────────
  // togglePause(role) — the per-account kill switch (REAL sponsored PTB).
  // ──────────────────────────────────────────────────────────────────────
  const togglePause = useCallback(
    async (role: AiRole): Promise<void> => {
      const refs = accountRefs(role);
      const isPaused =
        role === 'spending' ? controls.spendingPaused : controls.investingPaused;
      const nextPaused = !isPaused;

      setControls((c) =>
        role === 'spending'
          ? { ...c, spendingPaused: nextPaused }
          : { ...c, investingPaused: nextPaused },
      );

      if (!refs) {
        // The account isn't funded yet, so there's no on-chain cap to revoke.
        // The kill switch is simply UNAVAILABLE until the account exists (the
        // UI doesn't surface it pre-fund) — NO user-facing "not set up" error.
        // The optimistic control flip above is harmless local mirror state.
        return;
      }

      setPending(role);
      try {
        if (nextPaused) {
          // PAUSE: revoke the cap (the kill switch).
          await runSponsored(buildPause({ mandateId: refs.mandateId, capId: refs.capId }));
        } else {
          // RESUME: mint + allow-list a FRESH cap; persist the new cap id.
          const { events } = await runSponsoredWithEvents(
            buildResume({ mandateId: refs.mandateId, agentAddress: refs.agentAddress }),
          );
          const newCapId = eventField(events, '::mandate::AgentCapIssued', 'cap_id');
          if (newCapId) {
            updateCapId(owner, role, newCapId);
            setRefsVersion((v) => v + 1);
          }
        }
      } catch (e) {
        setControls((c) =>
          role === 'spending'
            ? { ...c, spendingPaused: isPaused }
            : { ...c, investingPaused: isPaused },
        );
        throw e;
      } finally {
        setPending(null);
      }
    },
    [accountRefs, controls.spendingPaused, controls.investingPaused, runSponsored, runSponsoredWithEvents, owner],
  );

  // ──────────────────────────────────────────────────────────────────────
  // setStrategy(role, s) — re-leash INVESTING onto a NEW mandate (new scope).
  // TWO-PHASE: (1) revoke old cap + mint new mandate -> read new mandate id;
  // (2) issue a fresh cap for the new mandate -> persist { mandateId, capId }.
  // ──────────────────────────────────────────────────────────────────────
  const setStrategy = useCallback(
    async (role: AiRole, s: Strategy): Promise<void> => {
      if (role !== 'investing') {
        throw new Error('Strategy applies to the Investing account only.');
      }
      const prev = controls.investingStrategy;
      setControls((c) => ({ ...c, investingStrategy: s }));

      const refs = accountRefs(role);
      if (!refs) {
        // No on-chain mandate to re-leash yet — the account comes into existence
        // by being FUNDED (transferBetweenAccounts auto-creates with the chosen
        // strategy). Until then the strategy is just a local preference; we keep
        // the optimistic control flip and return. NO "not set up" error.
        return;
      }

      setPending(role);
      try {
        // PHASE 1 — revoke the old cap + mint the new mandate (new scope).
        const phase1 = buildSetStrategyPhase1({
          oldMandateId: refs.mandateId,
          oldCapId: refs.capId,
          strategy: s,
        });
        const { events: e1 } = await runSponsoredWithEvents(phase1);
        const newMandateId = eventField(e1, '::mandate::MandateCreated', 'mandate_id');
        if (!newMandateId) throw new Error('Strategy change failed: no new mandate id.');

        // PHASE 2 — issue a fresh cap for the new mandate.
        const phase2 = buildResume({ mandateId: newMandateId, agentAddress: refs.agentAddress });
        const { events: e2 } = await runSponsoredWithEvents(phase2);
        const newCapId = eventField(e2, '::mandate::AgentCapIssued', 'cap_id');
        if (!newCapId) throw new Error('Strategy change failed: no new cap id.');

        updateMandate(owner, role, newMandateId, newCapId);
        setRefsVersion((v) => v + 1);
      } catch (e) {
        setControls((c) => ({ ...c, investingStrategy: prev }));
        throw e;
      } finally {
        setPending(null);
      }
    },
    [accountRefs, controls.investingStrategy, runSponsoredWithEvents, owner],
  );

  // ──────────────────────────────────────────────────────────────────────
  // send(args) — direct MAIN transfer (sponsored iff SPONSORED_COINS, else self-pay).
  // ──────────────────────────────────────────────────────────────────────
  const send = useCallback(
    async (args: SendInput): Promise<string> => {
      if (!owner) throw new Error('Not signed in.');
      const sponsored = SPONSORED_COINS.has(args.coinType);

      // Resolve the sender's input coins of this type (needed for non-SUI always,
      // and for SUI when sponsored — a sponsored tx's gas coin belongs to the sponsor,
      // so the SUI being sent must come from one of the SENDER's own SUI coins).
      let tx: Transaction;
      if (args.coinType === SUI.type) {
        if (sponsored) {
          const coins = await client.getCoins({ owner, coinType: SUI.type });
          const ids = coins.data.map((c) => c.coinObjectId);
          tx = buildTransferSuiSponsored({
            recipient: args.recipient,
            amountRaw: args.amountRaw,
            sourceCoinIds: ids,
          });
        } else {
          tx = buildTransfer({
            coinType: SUI.type,
            recipient: args.recipient,
            amountRaw: args.amountRaw,
          });
        }
      } else {
        const coins = await client.getCoins({ owner, coinType: args.coinType });
        tx = buildTransfer({
          coinType: args.coinType,
          recipient: args.recipient,
          amountRaw: args.amountRaw,
          sourceCoinIds: coins.data.map((c) => c.coinObjectId),
        });
      }

      let digest: string;
      if (sponsored) {
        digest = await runSponsored(tx);
      } else {
        // Self-pay: sign + submit through dapp-kit's full flow (the tx carries its
        // own gas from the sender). Used for non-sponsored coins (e.g. SUI/DEEP).
        tx.setSender(owner);
        const built = await tx.build({ client: client as unknown as BuildClient });
        const { signature, bytes } = await signTransaction({ transaction: toBase64(built) });
        const res = await client.executeTransactionBlock({
          transactionBlock: bytes,
          signature,
        });
        digest = res.digest;
      }
      void refetchBalances();
      return digest;
    },
    [owner, client, runSponsored, signTransaction, refetchBalances],
  );

  // ──────────────────────────────────────────────────────────────────────
  // JOURNAL: setAllocations — persist the multi-select split + re-mint the
  // mandate for the EFFECTIVE tier via the existing two-phase setStrategy.
  // 🚩 The granular per-tier split is intent only (persisted); the cage runs
  // the single effective {safe|risky} scope (strategyFromAllocations).
  // ──────────────────────────────────────────────────────────────────────
  const setAllocations = useCallback(
    async (role: AiRole, w: AllocationWeights): Promise<void> => {
      if (role !== 'investing') {
        throw new Error('Allocations apply to the Investing account only.');
      }
      // Persist the chosen split (intent) even if the account isn't set up yet —
      // it re-displays in the journal; updateAllocations is a no-op without refs.
      updateAllocations(owner, role, w);
      setRefsVersion((v) => v + 1);
      // Re-leash the effective tier. If the account isn't funded yet, setStrategy
      // just records the local preference (no on-chain re-mint, no error); the
      // strategy is applied for real the moment the account is auto-created on its
      // first fund. Once funded, this re-mints the mandate for the new scope.
      await setStrategy(role, strategyFromAllocations(w));
    },
    [owner, setStrategy],
  );

  // ──────────────────────────────────────────────────────────────────────
  // JOURNAL: transferBetweenAccounts — the drag-drop money move.
  //   main-to-vault → REAL deposit (MAIN → AI vault), sponsored. AUTO-SETUP-ON-
  //     FUND: if the target AI account does NOT yet exist on-chain, we silently
  //     build the cage first (ensureAccount: mint mandate + create vault + issue
  //     cap, two-phase) and THEN deposit — invisible to the user, first fund =
  //     create. The returned digest is the DEPOSIT's, so the journal reads
  //     "money moved" while the creation rode along transparently. The funded
  //     amount doubles as the mandate budget cap (the agent can never act past
  //     what was funded). Strategy defaults to 'safe' (the spending scope is
  //     fixed; investing's risk tier is changed later via setStrategy).
  //   vault-to-main / vault-to-vault → 🚩 STUB (agent-gated; no owner-side
  //     withdraw PTB). Resolves to the PENDING_AGENT sentinel — NEVER a fake
  //     digest. Auto-create does NOT apply (nothing to move out of yet).
  // ──────────────────────────────────────────────────────────────────────
  const transferBetweenAccounts = useCallback(
    async (
      direction: TransferDirection,
      role: AiRole,
      amountMist: bigint,
    ): Promise<TransferResult> => {
      if (!owner) throw new Error('Not signed in.');

      if (direction === 'main-to-vault') {
        setPending(role);
        try {
          // AUTO-SETUP-ON-FUND: make the account exist (no-op if it already
          // does), then deposit. ensureAccount throws calmly with no fake
          // success if there is no signer / agent — the catch in the caller
          // surfaces it; it never reports a move that didn't happen.
          const strategy: Strategy =
            role === 'investing' ? controls.investingStrategy : 'safe';
          const refs = await ensureAccount(role, strategy, amountMist);

          // The single-asset vault funds with a SUI deposit. The swap vault
          // (investing RISKY) takes no single-asset deposit — its base/quote
          // funding is agent-driven — so a fund-into-swap is honestly pending.
          if (refs.vaultKind !== 'single') {
            return { status: 'pending-agent' };
          }

          const digest = await runSponsored(
            buildDepositSui({ vaultId: refs.vaultId, amountMist }),
          );
          void refetchBalances();
          void refreshLive(role);
          return { status: 'executed', digest };
        } finally {
          setPending(null);
        }
      }

      // vault-to-main / vault-to-vault: the owner cannot drive a vault payout (the
      // AgentCap lives on the agent). Honest pending-agent state, no fake digest.
      return { status: 'pending-agent' };
    },
    [owner, ensureAccount, controls.investingStrategy, runSponsored, refetchBalances, refreshLive],
  );

  // The persisted INVESTING split (intent) for the journal's multi-select re-display.
  const investingAllocations = useMemo<AllocationWeights | undefined>(
    () => getAccountRefs(owner, 'investing')?.allocations,
    // refsVersion re-reads after setAllocations persists a new split.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [owner, refsVersion],
  );

  return {
    state,
    pending,
    togglePause,
    setStrategy,
    createAccount,
    hasAccount,
    send,
    investingAllocations,
    setAllocations,
    transferBetweenAccounts,
  };
}
