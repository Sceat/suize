/**
 * The agent's spending-safety DECISION — PURE (no React, no async, no I/O), so the
 * safety rules are unit-testable and can never silently regress.
 *
 * THE LOAD-BEARING INVARIANT (the bug this exists to make impossible): the agent
 * spends ONLY from its funded SUB-ACCOUNT — its balance IS the hard cap — and NEVER
 * from the owner's main wallet. This planner has NO `mainBalance` input: it can only
 * authorize against the sub-account, so it is STRUCTURALLY incapable of green-lighting
 * a main-wallet drain. If the sub-account can't cover the spend, the answer is `error`,
 * never a fallback to main.
 *
 * The handler executes the result via `agent.spend` / `agent.withdraw` (the multisig
 * send FROM the sub-account) — never `api.sendWallet` (the main wallet).
 */
export interface SpendDials {
  mode: 'each' | 'under' | 'full';
  thresholdUsd: number;
}

export type SpendPlan =
  | { kind: 'error'; message: string }
  | { kind: 'auto' } // execute now, no confirm card (still leaves a receipt)
  | { kind: 'card' }; // surface a confirm card

/** Decide how an agent SEND (sub-account → payee) should proceed. */
export function planAgentSend(input: {
  armed: boolean; // the sub-account exists (a funded address)
  subBalanceUi: number; // the sub-account USDC balance — the HARD CAP (the only balance the agent may touch)
  amountUi: number; // the requested send amount
  toIsOwner: boolean; // is the destination the owner's own main wallet?
  agentOn: boolean; // the live agent toggle
  knownPayee: boolean; // a previously-paid payee (a NEW payee always confirms)
  repeat: boolean; // a runaway-loop repeat to the same payee
  dials: SpendDials;
}): SpendPlan {
  if (!input.armed)
    return {
      kind: 'error',
      message:
        "Your agent sub-account isn't set up yet — fund it first. The agent only spends from there, never your main wallet.",
    };
  if (!(input.amountUi > 0)) return { kind: 'error', message: 'The amount must be greater than zero.' };
  if (input.toIsOwner)
    return { kind: 'error', message: "That's your own wallet — ask me to bring funds back from the sub-account instead." };
  // THE CAP — the agent can never spend more than its sub-account holds, and never reaches main.
  if (input.amountUi > input.subBalanceUi)
    return {
      kind: 'error',
      message: `Your agent sub-account only holds $${input.subBalanceUi.toFixed(2)} — fund it first. (The agent never spends from your main wallet.)`,
    };
  const auto =
    input.agentOn &&
    input.knownPayee &&
    !input.repeat &&
    (input.dials.mode === 'full' || (input.dials.mode === 'under' && input.amountUi < input.dials.thresholdUsd));
  return auto ? { kind: 'auto' } : { kind: 'card' };
}

/**
 * Decide how an agent SWEEP (sub-account → the owner's own wallet) should proceed.
 * Bringing money BACK is the SAFEST move (de-risking — pulling funds out of the
 * agent's reach, to a fixed destination: your wallet), so it respects the SAME dials
 * as a send: full-auto / under-threshold → no card.
 */
export function planAgentSweep(input: {
  armed: boolean;
  subBalanceUi: number;
  amountUi: number; // the (partial) amount, or the full balance
  dials: SpendDials;
}): SpendPlan {
  if (!input.armed) return { kind: 'error', message: 'There is no agent sub-account set up.' };
  if (!(input.subBalanceUi > 0)) return { kind: 'error', message: 'The agent sub-account is already empty.' };
  if (input.amountUi > input.subBalanceUi)
    return {
      kind: 'error',
      message: `The agent sub-account only holds $${input.subBalanceUi.toFixed(2)} — I can't bring back more than that.`,
    };
  const auto = input.dials.mode === 'full' || (input.dials.mode === 'under' && input.amountUi < input.dials.thresholdUsd);
  return auto ? { kind: 'auto' } : { kind: 'card' };
}
