/**
 * Suize data-layer types — the SINGLE SOURCE OF TRUTH for the wallet UI.
 *
 * Every component imports its shapes from here. This file is the seam between the
 * UI and the chain: the SAME shapes are filled by live RPC reads + on-chain
 * `mandate`/`vault` events (no mock layer anymore — see useHome.ts).
 *
 * THE THREE-ACCOUNT MODEL (LOCKED):
 *   • MAIN ("Your money") — the user's own zkLogin wallet balances. The agent
 *     NEVER touches it; there is no AgentCap over it. `HomeState.currencies` +
 *     `HomeState.totalUsd`. Source: client.getAllBalances({ owner }).
 *   • AI SPENDING ("Spending") — one on-chain Mandate (its own cap + kill switch),
 *     scoped to pay/transfer. `HomeState.spending`.
 *   • AI INVESTING ("Investing") — one on-chain Mandate (its own cap + kill
 *     switch), scoped SAFE (navi) or RISKY (swap). `HomeState.investing`.
 *
 * Each AI account is independently caged + independently revocable: two Mandates,
 * two budgets, two kill switches. Mutations are per-role (HomeApi.togglePause(role)
 * / setStrategy(role, s)).
 *
 * Wiring map (UI field -> real source), kept honest:
 *   Currency.{raw,ui}    <- RPC: client.getAllBalances({ owner }) mapped onto SUPPORTED
 *   Currency.usd         <- ui * price (price STUB — testnet has no feed; see prices.ts)
 *   AiAccount.mandate    <- mandate::Mandate read (budget_remaining / expiry_ms /
 *                           allowed_scope / allow-list active flag) via devInspect/object read
 *   AiAccount.usd        <- vault value read (real) — honest EMPTY ($0) until the
 *                           agent loop + accounts exist; NO fabricated numbers
 *   LogEntry             <- mandate::AgentActed / vault::AgentDeployed /
 *                           mandate::AgentCapRevoked / MandateCreated events
 *   HomeState.handle     <- SuiNS subname <name>@suize (backend Redis source of truth)
 *   HomeState.address    <- the user's zkLogin wallet address
 *
 * Honesty brand: every dollar figure is DETERMINISTIC (the LLM ranks + narrates,
 * it NEVER emits a number that lands in a transaction). Until the agent loop emits
 * real events, AI accounts show an honest empty state + a heartbeat log — never
 * fake P&L.
 */

// ───────────────────────────────────────────────────────────────────────────
// Currencies (MAIN — "Your money")
// ───────────────────────────────────────────────────────────────────────────

/**
 * A supported on-chain currency, merged with the user's live balance.
 *
 * The static fields (sym/name/type/decimals/color) come from `coins.ts` (SUPPORTED);
 * the balance fields (raw/ui/usd) are filled per-render from `getAllBalances` (or 0
 * when the user holds none / the query is pending).
 */
export interface Currency {
  /** ticker, e.g. "SUI", "USDC". */
  sym: string;
  /** human name, e.g. "Sui", "USD Coin". */
  name: string;
  /** fully-qualified Move coin type, e.g. "0x2::sui::SUI". */
  type: string;
  /** on-chain decimals (SUI=9, USDC=6, …). ui = raw / 10**decimals. */
  decimals: number;
  /** brand hex for the coin disc, e.g. "#4DA2FF". */
  color: string;
  /** raw on-chain balance (base units) as a string — bigint-safe. "0" if none. */
  raw: string;
  /** human-scaled balance = Number(raw) / 10**decimals. */
  ui: number;
  /** USD value = ui * price (price STUB on testnet). */
  usd: number;
  /**
   * TESTNET display-only flag: true when this coin's type is not yet pinned to a
   * real testnet package (DEEP/WAL/USDSUI). Such balances never resolve on-chain
   * (read as 0) and the UI marks them. SUI/USDC are live (false). See coins.ts.
   */
  displayOnly: boolean;
  /**
   * true => a curated SUPPORTED coin (coins.ts) with a brand color + a reference
   * price. false => an UNKNOWN coin the user actually holds, detected live from
   * `getAllBalances` and described from on-chain `getCoinMetadata` — shown with a
   * neutral disc, NO price (usd:0), and an honest "unverified" marker in the UI.
   */
  known: boolean;
  /**
   * UNKNOWN coins only: true when on-chain metadata gave no decimals, so `ui` is a
   * best-effort/raw figure rather than a trustworthy human amount. The UI renders a
   * "decimals unknown" hint instead of a misleading precise balance. Always false
   * for `known` coins (their decimals come from coins.ts).
   */
  decimalsUnknown?: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// Strategy + scope + abort codes (chain contract)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The user-facing risk choice for the INVESTING account. Maps to which mandate
 * scope-set is minted:
 *   'safe'  -> NAVI lend-as-is   (ScopeTag.NaviSupply / NaviWithdraw)
 *   'risky' -> DeepBook spot swaps (ScopeTag.DeepbookSwap)
 * The SPENDING account is not risk-tiered; its scope is the pay/transfer set.
 */
export type Strategy = 'safe' | 'risky';

// ───────────────────────────────────────────────────────────────────────────
// JOURNAL UI: multi-select allocations + chat (UI-LOCAL shapes — NOT chain)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The journal's INVESTING multi-select intent: which of the three strategy tiers
 * the user enabled. These are the user's CHOSEN SPLIT (a UI/intent concept), NOT a
 * three-vault on-chain reality — see `strategyFromAllocations` for how the intent
 * collapses to the single on-chain effective `Strategy` ('safe' | 'risky') that is
 * actually minted.
 *
 * The weights match the journal mockup's `data-weight` (passive=3, degen=2,
 * gamefi=1) so the 50/33/17 split renders identically. A tier is "enabled" when its
 * weight is present + > 0; absent/0 means off. The allocation %s are intent only,
 * persisted to re-display the user's chosen split — the cage runs the effective tier.
 *
 * 🚩 STUB (sanctioned): the granular per-tier split is NOT funded per-tier on-chain
 * (one mandate, one scope). GameFi folds into the 'risky' effective tier + links to
 * the Crash app; it is not wired on-chain this pass. See useHome.ts setAllocations.
 */
export interface AllocationWeights {
  /** Passive tier weight (steady lend/stake) — maps to the 'safe' (NAVI) scope. */
  passive?: number;
  /** Degen tier weight (momentum/new tokens) — maps to the 'risky' (DeepBook) scope. */
  degen?: number;
  /** GameFi tier weight (Crash bets) — intent only; folds into 'risky'. 🚩 STUB. */
  gamefi?: number;
}

/**
 * Collapse the journal's richer multi-select intent to the single on-chain
 * effective `Strategy` the mandate is minted with. ANY aggressive tier (degen OR
 * gamefi enabled) → 'risky' (DeepBook scope); otherwise → 'safe' (NAVI scope).
 *
 * 🚩 The chain has ONE scope-set per mandate; the multi-select is richer than the
 * chain. This is the documented multi-strategy-mandate gap (the per-tier funding
 * stub) — the cage runs the effective {risky|safe} scope, not three coexisting ones.
 *
 * Pure function — no side effects, safe to call in render.
 */
export function strategyFromAllocations(w: AllocationWeights): Strategy {
  const degen = (w.degen ?? 0) > 0;
  const gamefi = (w.gamefi ?? 0) > 0;
  return degen || gamefi ? 'risky' : 'safe';
}

/**
 * One row in the journal's SPENDING chat transcript. A UI-LOCAL shape — distinct
 * from the protocol's `LivechatMessage` ({ from, text, at }). The chat is a
 * sanctioned local stub (scripted replies + receipts, journal.html verbatim);
 * inbound `onLivechatMessage` (dormant today) maps `{ from, text }` → `{ who, body }`.
 *
 * 🚩 STUB (sanctioned): there is NO client→server chat frame in the protocol and the
 * agent backend is a documented stub. `body` may carry inline markup (the receipt /
 * bold spans the mockup renders). No "Send" intent moves real money this pass.
 */
export interface ChatMessage {
  /** stable id for keying the rendered row. */
  id: string;
  /** who authored it — the user ('me') or the scripted AI ('ai'). */
  who: 'me' | 'ai';
  /** the message text (may include the mockup's inline markup for AI rows). */
  body: string;
  /** optional receipt line under an AI action ("from AI Spending · 0.4s"). */
  receipt?: string;
}

/**
 * On-chain scope tags (LOCKED — mandate.move convention; tag->venue is off-chain).
 *   0 NaviSupply / 1 NaviWithdraw — used by navi::agent_supply / agent_withdraw
 *   2 DeepbookSwap                — used by swap::agent_swap_* (both directions)
 *   3 Spend                       — pay/transfer scope for the SPENDING mandate
 *
 * NOTE: navi.move pins withdraw to scope_tag=1 by convention; swap.move takes the
 * caller's scope_tag (we pass 2). Tag 3 (Spend) is OUR convention for the spending
 * mandate's vault payouts — confirm the published mandate covers a transfer/pay
 * scope when the spending account's on-chain wiring is validated (see useHome.ts).
 */
export const ScopeTag = {
  NaviSupply: 0,
  NaviWithdraw: 1,
  DeepbookSwap: 2,
  Spend: 3,
} as const;
export type ScopeTag = (typeof ScopeTag)[keyof typeof ScopeTag];

/**
 * Mandate abort codes (LOCKED — mandate.move; abort codes are a public contract,
 * NEVER renumber). The agent + UI pattern-match these. Surfaced in the activity
 * log when the VM rejects a move (the kill-move row).
 */
export const AbortCode = {
  EExpired: 0,
  ENotOwner: 1,
  ECapNotAllowed: 2,
  EOverBudget: 3,
  EOutOfScope: 4,
  ECapMandateMismatch: 5,
} as const;
export type AbortCode = (typeof AbortCode)[keyof typeof AbortCode];

// ───────────────────────────────────────────────────────────────────────────
// Activity log
// ───────────────────────────────────────────────────────────────────────────

/**
 * The kind of activity-log row — drives its lucide glyph + accent.
 *   'lend'     SAFE: lent-as-is on NAVI                          (AgentActed, scope 0)
 *   'trim'     RISKY/guardian: trimmed overextended SUI -> USDC  (AgentActed, scope 2)
 *   'spend'    SPENDING: paid/transferred within budget          (AgentActed, scope 3)
 *   'check'    routine "all pools fresh" / heartbeat             (off-chain narration)
 *   'hold'     held through a wobble — discipline, not a trade   (off-chain narration)
 *   'blocked'  kill-move: VM aborted an over-mandate tx          (failed tx, AbortCode)
 *   'guardian' bodyguard acted                                   (AgentActed, scope 2)
 *   'mandate'  lifecycle: mandate live / revoked                 (MandateCreated / AgentCapRevoked)
 */
export type LogKind =
  | 'lend'
  | 'trim'
  | 'spend'
  | 'check'
  | 'hold'
  | 'blocked'
  | 'guardian'
  | 'mandate';

/** Outcome chip shown on the right of a log row. */
export type LogOutcome =
  | { type: 'locked'; usd: number } // "+$40 locked"
  | { type: 'up'; pct?: number } // up — good
  | { type: 'down'; pct?: number } // down (rose, never alarm)
  | { type: 'reverted' } // on-chain abort
  | { type: 'none' };

/**
 * One row in the ADVANCED activity log. Mirrors what we can reconstruct from a
 * single on-chain event (+ optional narration). `txDigest` is tappable -> explorer.
 */
export interface LogEntry {
  id: string;
  /** epoch ms — rendered as a clock + relative "14s ago". From event timestamp. */
  ts: number;
  kind: LogKind;
  /** LLM-narrated headline. The LLM NEVER emits a number — every figure is deterministic. */
  title: string;
  /** optional second line — the "why" / triggering signal. */
  detail?: string;
  outcome: LogOutcome;
  /** present once a move hit the chain; tappable link to the explorer. */
  txDigest?: string;
  /** VM abort code, only on `blocked` rows (the expand-to-reveal kill-move detail). */
  abortCode?: AbortCode;
}

// ───────────────────────────────────────────────────────────────────────────
// Mandate (human mirror of the on-chain cage)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The human-readable mirror of the on-chain Move `Mandate` (shown in ADVANCED).
 * Read-only reflection of the chain state for ONE AI account's mandate.
 */
export interface Mandate {
  /** budget cap in USD (mandate.budget_remaining, scaled to USD). 0 until funded. */
  budgetUsd: number;
  /** days until expiry (derived from mandate.expiry_ms). 0 when no live mandate. */
  expiryDays: number;
  /** allowed scope tags (mandate.allowed_scope), mirrored client-side. */
  scope: ScopeTag[];
  /** true when an AgentCap is allow-listed (not revoked) AND not expired. */
  active: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// AI account (one per Mandate — Spending or Investing)
// ───────────────────────────────────────────────────────────────────────────

/** Which of the two AI accounts. Each is one on-chain Mandate. */
export type AiRole = 'spending' | 'investing';

/**
 * One caged AI account — the on-chain mirror of a single Mandate (+ its vault).
 *
 * Every dollar figure is DETERMINISTIC and HONEST: until the agent loop + the
 * account's on-chain objects exist, `usd` is the real vault value read (0 when
 * empty) — NEVER a fabricated P&L. `deltaPct`/`deltaUsd` are 0 in the empty state.
 */
export interface AiAccount {
  /** which account this is. */
  role: AiRole;
  /** human label shown to the user ("Spending" / "Investing"). */
  label: string;
  /** current value of the account in USD (real vault read; 0 when empty/unfunded). */
  usd: number;
  /** today's delta as a fraction (0.021 = +2.1%). 0 in the honest empty state. */
  deltaPct: number;
  /** today's delta in USD. 0 in the honest empty state. */
  deltaUsd: number;
  /** optional sparkline series (most recent last). Absent until real history exists. */
  sparkline?: number[];
  /** the human mirror of this account's on-chain mandate (ADVANCED). */
  mandate: Mandate;
  /** kill-switch state — true when this account's agent is paused (AgentCap revoked). */
  paused: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// Home snapshot + API
// ───────────────────────────────────────────────────────────────────────────

/**
 * The full home snapshot the UI renders. Read-only data; mutations go through HomeApi.
 *
 * `totalUsd` is MAIN-only (sum of `currencies[].usd`) — the user's own money. The
 * AI accounts carry their own `usd` (sandbox), shown separately so "Your money" is
 * never conflated with caged play capital.
 */
export interface HomeState {
  /** the <name> part of <name>@suize. */
  name: string;
  /** full SuiNS handle "<name>@suize" (convenience; = `${name}@suize`). */
  handle: string;
  /** the user's raw zkLogin wallet address (0x…), shown + copyable in ADVANCED. */
  address: string;
  /** MAIN — supported currencies merged with live balances (owned-first ordering). */
  currencies: Currency[];
  /** MAIN total in USD = sum of currencies[].usd. The user's own money. */
  totalUsd: number;
  /** AI SPENDING account (pay/transfer mandate). */
  spending: AiAccount;
  /** AI INVESTING account (SAFE navi / RISKY swap mandate). */
  investing: AiAccount;
  /** true when nothing needs the user's attention (drives the one allowed HealthDot). */
  healthy: boolean;
  /** reverse-chronological activity feed across both AI accounts (ADVANCED only). */
  log: LogEntry[];
  /**
   * The SPENDING chat transcript (journal §03). 🚩 STUB: local scripted state +
   * future inbound `onLivechatMessage` pushes (dormant today). Empty until the chat
   * leaf seeds the journal's scripted transcript. The visible transcript is local;
   * this slice is the future-proof seam for when the agent emits livechat.
   */
  chat: ChatMessage[];
}

/**
 * The data hook contract. `useHome()` returns this; `WalletShell` threads it to leaves.
 *
 * Mutations build REAL sponsored PTBs against the LIVE wallet package (see useHome.ts):
 *   togglePause(role) -> mandate::revoke_agent_cap (pause) / issue_agent_cap (resume)
 *   setStrategy(role, s) -> revoke old cap + mandate::create_mandate (new scope) + issue_agent_cap
 *
 * Both are async and reflect chain truth; `pending` flags the in-flight role so the
 * UI can disable controls. Live object ids (mandate/AgentCap/vault that only exist
 * once an account is created) are read from the persisted `accountStore` and kept
 * fresh by `refreshLive` (see useHome.ts); a mutation against a role with no stored
 * refs is still safe to invoke — pause/strategy are simply UNAVAILABLE (silent no-op)
 * until the account is funded. The account comes into existence by being FUNDED:
 * `transferBetweenAccounts('main-to-vault', …)` auto-creates the cage on first
 * deposit (first fund = create), so there is NO "account not set up" error anywhere.
 */
export interface HomeApi {
  state: HomeState;
  /** role currently mid-mutation (for disabling controls), or null when idle. */
  pending: AiRole | null;
  /** flip the kill switch for ONE account (pause/resume its agent). Sponsored PTB. */
  togglePause(role: AiRole): Promise<void>;
  /** change the INVESTING strategy (re-mints that mandate's scope). Sponsored PTB. */
  setStrategy(role: AiRole, s: Strategy): Promise<void>;
  /**
   * Create the on-chain cage for ONE AI account: mint the mandate, create + fund the
   * vault, and issue the AgentCap to the configured agent. Two-phase (create_mandate
   * shares + returns no id, so the cap/vault are issued in a second tx after the
   * mandate id is read from MandateCreated). Persists { mandateId, capId, vaultId }.
   * Throws "agent not configured" if VITE_AGENT_ADDRESS is unset (an owner action).
   */
  createAccount(role: AiRole, opts: CreateAccountOpts): Promise<AccountRefs>;
  /** true when this account already has persisted on-chain refs (mandate exists). */
  hasAccount(role: AiRole): boolean;
  /**
   * Send the user's OWN money from MAIN to a recipient (direct public_transfer, NOT
   * a vault op). Sponsored over the WS iff the coin type is in SPONSORED_COINS, else
   * self-paid. Returns the executed tx digest.
   */
  send(args: SendInput): Promise<string>;

  // ── JOURNAL additions ─────────────────────────────────────────────────────

  /**
   * The persisted INVESTING allocation intent for the journal's multi-select. Read
   * from `accountStore` (or undefined if never chosen). Used to re-display the
   * actual split (50/33/17 etc). Intent only — the cage runs the effective tier.
   */
  investingAllocations?: AllocationWeights;

  /**
   * Set the journal's INVESTING multi-select split. Persists the full weights to
   * `accountStore`, then re-mints the mandate for the EFFECTIVE tier via the EXISTING
   * `setStrategy(role, strategyFromAllocations(weights))` — so the real two-phase
   * mandate re-mint still fires.
   *
   * 🚩 STUB (sanctioned): the granular per-tier funding (the 50/33/17 split) is NOT
   * funded per-tier on-chain — one mandate, one scope. GameFi folds into 'risky' +
   * links to Crash; not wired on-chain this pass. The effective tier IS real.
   */
  setAllocations(role: AiRole, w: AllocationWeights): Promise<void>;

  /**
   * Move money between accounts (the journal's drag-drop gesture).
   *   'main-to-vault'  → REAL deposit (MAIN → AI vault) over the sponsor, with
   *                      AUTO-SETUP-ON-FUND: if the target AI account does NOT yet
   *                      exist on-chain, the cage (mandate + vault + cap) is created
   *                      SILENTLY before the deposit — first fund = create, invisible
   *                      to the user. The returned digest is the deposit's; the
   *                      creation rode along transparently. (Funding a not-yet-funded
   *                      RISKY/swap account is honestly `pending-agent` — the swap
   *                      vault's base/quote funding is agent-driven.)
   *   'vault-to-main'  → 🚩 STUB (sanctioned): owner can't drive a vault payout (the
   *   'vault-to-vault'    agent holds the cap; no owner-side withdraw PTB). Returns the
   *                      `pending-agent` sentinel, NEVER a fake success digest. The UI
   *                      shows a pending-agent state.
   *
   * Returns the executed digest for the REAL deposit path, or `PENDING_AGENT` for the
   * agent-gated paths. Throws calmly (no fake success) only when there is no signer.
   */
  transferBetweenAccounts(
    direction: TransferDirection,
    role: AiRole,
    amountMist: bigint,
  ): Promise<TransferResult>;
}

/** Direction of a journal money-move. Only 'main-to-vault' is real this pass. */
export type TransferDirection = 'main-to-vault' | 'vault-to-main' | 'vault-to-vault';

/**
 * The result of `transferBetweenAccounts`. A real move carries its on-chain digest;
 * the sanctioned agent-gated stub carries the `PENDING_AGENT` sentinel (the UI must
 * render a pending-agent state, NEVER a fake success digest).
 */
export type TransferResult =
  | { status: 'executed'; digest: string }
  | { status: 'pending-agent' };

/** The sentinel a stubbed (agent-gated) money-move resolves to. */
export const PENDING_AGENT = { status: 'pending-agent' } as const;

/** The on-chain refs persisted per AI account once it is created. */
export interface AccountRefs {
  /** the shared Mandate object id (the leash). */
  mandateId: string;
  /** the current AgentCap object id bound to the mandate (revoked on pause/restrategy). */
  capId: string;
  /** the shared Vault / SwapVault object id (custody). */
  vaultId: string;
  /** the agent address the cap is transferred to (from VITE_AGENT_ADDRESS). */
  agentAddress: string;
  /** which vault kind backs this account ('single' Vault<SUI> | 'swap' SwapVault). */
  vaultKind: 'single' | 'swap';
  /**
   * The journal's INVESTING multi-select intent (the chosen 50/33/17 split), if set.
   * Additive + optional — old persisted blobs (without it) still parse. Investing
   * only; intent only (the cage runs the effective tier from `strategyFromAllocations`).
   */
  allocations?: AllocationWeights;
}

/** Inputs to createAccount(role). Budget + initial funding in the coin's smallest unit. */
export interface CreateAccountOpts {
  /** investing risk tier (ignored for spending — its scope is fixed pay/transfer). */
  strategy?: Strategy;
  /** the mandate budget cap in Mist (smallest unit). The agent can never exceed it. */
  budgetMist: bigint;
  /** initial SUI (Mist) to deposit into the vault's idle pot. 0 => create empty. */
  fundMist?: bigint;
}

/** Inputs to send() — a direct MAIN transfer. */
export interface SendInput {
  /** the Move coin type being sent. */
  coinType: string;
  /** destination 0x… address (already resolved from SuiNS/hex). */
  recipient: string;
  /** amount in the coin's smallest unit (Mist for SUI, 1e-6 for USDC). */
  amountRaw: bigint;
}
