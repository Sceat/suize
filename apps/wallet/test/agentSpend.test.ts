// Regression tests for the agent spending-safety kernel. The bug these guard:
// the agent must spend ONLY from its capped SUB-ACCOUNT, NEVER the owner's main
// wallet (and "bring funds back" must respect the dials). Pure logic — no network.
import { test, expect } from 'bun:test';
import { planAgentSend, planAgentSweep, type SpendDials } from '../src/data/agentSpend';

const full: SpendDials = { mode: 'full', thresholdUsd: 50 };
const each: SpendDials = { mode: 'each', thresholdUsd: 50 };
const under: SpendDials = { mode: 'under', thresholdUsd: 50 };

const base = {
  armed: true,
  subBalanceUi: 100,
  amountUi: 5,
  toIsOwner: false,
  agentOn: true,
  knownPayee: true,
  repeat: false,
  dials: full,
};

// ── THE REGRESSION ────────────────────────────────────────────────────────────
// An over-cap send is REFUSED, never silently routed to the main wallet.
test('send over the sub-account cap is refused (never falls back to main)', () => {
  const p = planAgentSend({ ...base, subBalanceUi: 2, amountUi: 5 });
  expect(p.kind).toBe('error');
  if (p.kind === 'error') expect(p.message).toContain('never spends from your main wallet');
});

test('the planner cannot authorize against a main balance — there is no such input', () => {
  // A funded MAIN but EMPTY sub-account must still refuse: the planner only knows the
  // sub-account, so a rich main wallet can never green-light an agent spend.
  expect(planAgentSend({ ...base, subBalanceUi: 0, amountUi: 5 }).kind).toBe('error');
});

// ── send gating ─────────────────────────────────────────────────────────────
test('send when the sub-account is not armed is refused', () => {
  expect(planAgentSend({ ...base, armed: false }).kind).toBe('error');
});

test('send to the owner is refused (use bring-back)', () => {
  expect(planAgentSend({ ...base, toIsOwner: true }).kind).toBe('error');
});

test('non-positive amount is refused', () => {
  expect(planAgentSend({ ...base, amountUi: 0 }).kind).toBe('error');
  expect(planAgentSend({ ...base, amountUi: -1 }).kind).toBe('error');
});

test('funded + full-auto + known payee → auto (no card)', () => {
  expect(planAgentSend({ ...base }).kind).toBe('auto');
});

test('a NEW payee always confirms, even in full-auto', () => {
  expect(planAgentSend({ ...base, knownPayee: false }).kind).toBe('card');
});

test('each-mode always confirms', () => {
  expect(planAgentSend({ ...base, dials: each }).kind).toBe('card');
});

test('under-mode: below threshold auto, at/above threshold confirms', () => {
  expect(planAgentSend({ ...base, dials: under, amountUi: 10 }).kind).toBe('auto');
  expect(planAgentSend({ ...base, dials: under, amountUi: 50 }).kind).toBe('card');
});

test('a runaway repeat falls through to a confirm', () => {
  expect(planAgentSend({ ...base, repeat: true }).kind).toBe('card');
});

test('agent off → confirm (no autonomous spend)', () => {
  expect(planAgentSend({ ...base, agentOn: false }).kind).toBe('card');
});

test('exactly at the cap is allowed; one cent over is refused', () => {
  expect(planAgentSend({ ...base, subBalanceUi: 5, amountUi: 5 }).kind).toBe('auto');
  expect(planAgentSend({ ...base, subBalanceUi: 5, amountUi: 5.01 }).kind).toBe('error');
});

// ── SWEEP (bring funds back) — respects the dials ───────────────────────────
test('sweep in full-auto → auto (the "why am I asked in full-auto" fix)', () => {
  expect(planAgentSweep({ armed: true, subBalanceUi: 5, amountUi: 1, dials: full }).kind).toBe('auto');
});

test('sweep in each-mode → confirm', () => {
  expect(planAgentSweep({ armed: true, subBalanceUi: 5, amountUi: 1, dials: each }).kind).toBe('card');
});

test('sweep under-mode below threshold → auto', () => {
  expect(planAgentSweep({ armed: true, subBalanceUi: 100, amountUi: 10, dials: under }).kind).toBe('auto');
});

test('sweep over the balance is refused', () => {
  expect(planAgentSweep({ armed: true, subBalanceUi: 1, amountUi: 5, dials: full }).kind).toBe('error');
});

test('sweep with an empty sub-account is refused', () => {
  expect(planAgentSweep({ armed: true, subBalanceUi: 0, amountUi: 1, dials: full }).kind).toBe('error');
});

test('sweep when unarmed is refused', () => {
  expect(planAgentSweep({ armed: false, subBalanceUi: 5, amountUi: 1, dials: full }).kind).toBe('error');
});
