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
