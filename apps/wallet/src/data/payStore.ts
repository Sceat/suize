/**
 * Per-owner local stores for the PAY wallet:
 *   1. The APPROVED-TERMS store — the leash for silent renewals. Keyed by the
 *      `Subscription<USDC>` object id, it records the EXACT terms the user
 *      approved at create (`{merchant, amountRaw, periodMs}`). The silent-renew
 *      loop (`useSubscriptions`) renews a subscription ONLY when the live on-chain
 *      terms still equal this approved entry — so a (hypothetical) terms change
 *      can never trigger an unapproved auto-charge. The user approved THESE terms;
 *      anything else demands a fresh confirm.
 *   2. The AGENT-MEMBERS store — the two zkLogin public keys (Sui-serialized base64)
 *      whose 1-of-2 multisig IS the agent's sub-account: { MAIN session, AGENT
 *      session }. We persist the MEMBERS, not the address — the sub-account address
 *      is a PURE FUNCTION of them (`@suize/x402` formAgentSubaccount), so the wallet
 *      (MAIN member) and the MCP (AGENT member) BOTH re-derive the identical address
 *      with no shared trusted state. The user funds it, the AI spends from it, and
 *      the user withdraws from it — either member signs alone (threshold 1).
 *
 * WHY localStorage (the YAGNI win): the approved terms are a CLIENT-SIDE policy
 * dial (CLAUDE.md two-control-layers), not on-chain state — the chain enforces the
 * fixed payee + period; this store just gates whether WE auto-renew silently. The
 * agent members are public zkLogin keys, not secrets. Both are keyed by the owner's
 * stable zkLogin address so two Google logins on one browser never collide.
 *
 * SEAM: to move either to the backend later, swap the get/set bodies for a WS RPC —
 * the signatures stay, so the hooks are unchanged.
 */

// ── Approved-terms store ─────────────────────────────────────────────────────

/** The exact terms a user approved at subscription create — the silent-renew leash. */
export interface ApprovedTerms {
  /** the FIXED merchant address. */
  merchant: string;
  /** the per-period price in USDC base units (1e-6) as a string. */
  amountRaw: string;
  /** the period length in ms. */
  periodMs: number;
}

const TERMS_KEY = (owner: string) => `suize:subs:terms:${owner.toLowerCase()}`;

type TermsMap = Record<string, ApprovedTerms>;

const readTermsMap = (owner: string): TermsMap => {
  if (!owner) return {};
  try {
    const raw = localStorage.getItem(TERMS_KEY(owner));
    return raw ? (JSON.parse(raw) as TermsMap) : {};
  } catch {
    return {};
  }
};

const writeTermsMap = (owner: string, map: TermsMap): void => {
  try {
    localStorage.setItem(TERMS_KEY(owner), JSON.stringify(map));
  } catch {
    /* storage full / disabled — the renew loop just falls back to confirm-each */
  }
};

/** All approved-terms entries for `owner` (subId → terms). */
export function getApprovedTerms(owner: string): TermsMap {
  return readTermsMap(owner);
}

/** Read the approved terms for one subscription id, or null if none recorded. */
export function getApprovedTermsFor(owner: string, subId: string): ApprovedTerms | null {
  return readTermsMap(owner)[subId] ?? null;
}

/** Record the terms a user just approved for `subId` (called after a create lands). */
export function setApprovedTerms(owner: string, subId: string, terms: ApprovedTerms): void {
  if (!owner || !subId) return;
  const map = readTermsMap(owner);
  map[subId] = terms;
  writeTermsMap(owner, map);
}

/** Forget a subscription's approved terms (called after a cancel lands). */
export function clearApprovedTerms(owner: string, subId: string): void {
  if (!owner || !subId) return;
  const map = readTermsMap(owner);
  if (subId in map) {
    delete map[subId];
    writeTermsMap(owner, map);
  }
}

// ── Spending dials — the agent's autonomy policy (CLIENT-SIDE, the second of the
//    two control layers; the first is funding physics). Governs send_usdc ONLY:
//    cancel / sweep / deploy / subscribe ALWAYS confirm. A send to a NEW payee
//    ALWAYS confirms even in full-auto (the cheapest partial allow-list). ──

export type DialMode = 'each' | 'under' | 'full';

export interface Dials {
  /** 'each' = confirm every send (default) · 'under' = auto-approve KNOWN payees
   *  under the threshold · 'full' = auto-approve KNOWN payees (new payee still confirms). */
  mode: DialMode;
  /** the auto-approve ceiling for 'under', in whole USDC. */
  thresholdUsd: number;
}

const DEFAULT_DIALS: Dials = { mode: 'each', thresholdUsd: 20 };
const DIALS_KEY = (owner: string) => `suize:dials:${owner.toLowerCase()}`;

export function getDials(owner: string): Dials {
  if (!owner) return DEFAULT_DIALS;
  try {
    const raw = localStorage.getItem(DIALS_KEY(owner));
    if (!raw) return DEFAULT_DIALS;
    const d = JSON.parse(raw) as Partial<Dials>;
    const mode: DialMode = d.mode === 'under' || d.mode === 'full' ? d.mode : 'each';
    const thresholdUsd = typeof d.thresholdUsd === 'number' && d.thresholdUsd > 0 ? d.thresholdUsd : DEFAULT_DIALS.thresholdUsd;
    return { mode, thresholdUsd };
  } catch {
    return DEFAULT_DIALS;
  }
}

export function setDials(owner: string, dials: Dials): void {
  if (!owner) return;
  try {
    localStorage.setItem(DIALS_KEY(owner), JSON.stringify(dials));
  } catch {
    /* private mode — the in-memory state still carries it this session */
  }
}

// ── Known payees — addresses the user has successfully sent to before. A send to
//    a NEW payee always confirms (even in full-auto); known payees are eligible
//    for the dials. Capped so the list can't grow unbounded. ──
const PAYEES_KEY = (owner: string) => `suize:payees:${owner.toLowerCase()}`;

function readPayees(owner: string): string[] {
  try {
    const raw = localStorage.getItem(PAYEES_KEY(owner));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function isKnownPayee(owner: string, address: string): boolean {
  if (!owner || !address) return false;
  return readPayees(owner).includes(address.toLowerCase());
}

export function addKnownPayee(owner: string, address: string): void {
  if (!owner || !address) return;
  const a = address.toLowerCase();
  const list = readPayees(owner);
  if (list.includes(a)) return;
  list.push(a);
  try {
    localStorage.setItem(PAYEES_KEY(owner), JSON.stringify(list.slice(-200)));
  } catch {
    /* private mode */
  }
}

// ── Repeat-action guard — a LOOP-BREAKER, not a money cap (owner law 2026-06-14).
//    The agent may auto-approve a known-payee send under the dials, but if it sends to
//    the SAME payee repeatedly (ANY amount — keyed per-recipient so a vary-by-a-cent
//    loop can't dodge it), the Nth send in a short window STOPS auto-approving and falls
//    through to the confirm card — the cheap guard against a runaway loop draining to a
//    known payee. The wallet balance + the (coming) Walrus action-log are the real
//    backstops; this just probes intent on a repeat. Per-owner, rolling short window. ──
interface AutoAction {
  sig: string;
  at: number;
}
const AUTOACT_KEY = (owner: string) => `suize:autoact:${owner.toLowerCase()}`;
const AUTOACT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const AUTOACT_DUP_LIMIT = 3; // the 3rd identical auto-action in the window forces a confirm

function readAutoActions(owner: string): AutoAction[] {
  try {
    const raw = localStorage.getItem(AUTOACT_KEY(owner));
    const list = raw ? (JSON.parse(raw) as AutoAction[]) : [];
    const cutoff = Date.now() - AUTOACT_WINDOW_MS;
    return list.filter((a) => a && typeof a.at === 'number' && a.at >= cutoff && typeof a.sig === 'string');
  } catch {
    return [];
  }
}

/** A stable signature for an auto-approvable action, keyed PER RECIPIENT (NOT amount) —
 *  so N auto-sends to the same payee trip the loop-breaker regardless of amount, closing
 *  the vary-by-a-cent dodge. (today the only auto-approvable action is a send.) */
export function autoActionSig(recipient: string): string {
  return `send:${recipient.toLowerCase()}`;
}

/** True once `sig` has already auto-fired enough times in the window that THIS one is
 *  a repeat — the caller must show the confirm card instead of auto-approving. */
export function autoActionIsRepeat(owner: string, sig: string): boolean {
  if (!owner) return false;
  return readAutoActions(owner).filter((a) => a.sig === sig).length >= AUTOACT_DUP_LIMIT - 1;
}

/** Record an auto-approved action against the rolling window (call AFTER it lands). */
export function recordAutoAction(owner: string, sig: string): void {
  if (!owner) return;
  const next = [...readAutoActions(owner), { sig, at: Date.now() }].slice(-50);
  try {
    localStorage.setItem(AUTOACT_KEY(owner), JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

// ── Agent on/off (the Pause kill switch) — persisted per-owner so a Pause survives a
//    reload: a killed switch stays killed (in-memory state alone would silently re-arm
//    to the saved dials on refresh). Default ON. ──
const AGENTON_KEY = (owner: string) => `suize:agenton:${owner.toLowerCase()}`;

export function getAgentEnabled(owner: string): boolean {
  if (!owner) return true;
  try {
    const raw = localStorage.getItem(AGENTON_KEY(owner));
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function setAgentEnabled(owner: string, on: boolean): void {
  if (!owner) return;
  try {
    localStorage.setItem(AGENTON_KEY(owner), on ? '1' : '0');
  } catch {
    /* private mode */
  }
}

// ── Agent-members store (the sub-account multisig committee) ──────────────────

/** The two zkLogin public keys (Sui-serialized base64, `PublicKey.toSuiPublicKey()`)
 * whose 1-of-2 multisig is the agent's sub-account. Persisted so the wallet can
 * re-derive the sub-account address with no trusted state — it is a pure function
 * of these two members (`@suize/x402` formAgentSubaccount). */
export interface AgentMembers {
  /** the MAIN wallet session's zkLogin public key. */
  mainPubKey: string;
  /** the AGENT session's zkLogin public key (captured at /agent-connect). */
  agentPubKey: string;
}

const AGENT_KEY = (owner: string) => `suize:agent:${owner.toLowerCase()}`;

/** Read the saved agent multisig members for `owner`, or null until the agent is
 *  armed (the AGENT OAuth has run at least once, so its pubkey is known). */
export function getAgentMembers(owner: string): AgentMembers | null {
  if (!owner) return null;
  try {
    const raw = localStorage.getItem(AGENT_KEY(owner));
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<AgentMembers>;
    return m.mainPubKey && m.agentPubKey ? { mainPubKey: m.mainPubKey, agentPubKey: m.agentPubKey } : null;
  } catch {
    return null;
  }
}

/** Save the agent multisig members for `owner` (pass null to forget them). */
export function setAgentMembers(owner: string, members: AgentMembers | null): void {
  if (!owner) return;
  try {
    if (members) localStorage.setItem(AGENT_KEY(owner), JSON.stringify(members));
    else localStorage.removeItem(AGENT_KEY(owner));
  } catch {
    /* storage full / disabled — the in-memory state still carries it this session */
  }
}
