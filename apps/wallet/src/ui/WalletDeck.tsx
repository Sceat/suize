/**
 * THE WALLET — production (the owner-picked Deck). Money first: the two pots,
 * the live subscriptions list, and the verifiable activity ledger own the page;
 * the assistant is a resizable right column (secondary by law).
 *
 * REAL (via the verified `useAccount` + `useAgent` data layer):
 *   · "Your money" = the wallet USDC balance; "Sub-account" = the 1-of-2 multisig
 *     sub-account balance (its hard spend cap) — both read straight from chain.
 *   · Subscriptions + the activity trace reconstructed from on-chain events,
 *     every row carrying its real explorer link.
 *   · Fund → a P2P `sendWallet` to the sub-account · Bring it back → the one-tap
 *     multisig sweep (MAIN signs alone) · Cancel → `subs::subscription::cancel`.
 *   · Send → `sendWallet` (a gasless P2P transfer of the user's OWN USDC — no fee);
 *     names resolve via SuiNS first.
 *   · The assistant runs the keyless brain (Claude); every write it proposes is a
 *     confirm card the user taps + signs locally (the number wall).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useSignTransaction, useSuiClient } from '@mysten/dapp-kit';
import { DEPLOY_CHARGE_AMOUNT } from '@suize/shared';
import { useTheme } from '../system/theme';
import { useAccount } from '../data/useAccount';
import { useAgent } from '../data/useAgent';
import { planAgentSend, planAgentSweep } from '../data/agentSpend';
import { useSubscriptions } from '../data/useSubscriptions';
import { resolveRecipient } from '../data/suins';
import type { SuiClient } from '../data/suins';
import type { AgentToolRunner, ToolRun } from '../data/agentTools';
import { deployStaticSite } from '../data/deploy';
import { ensureMemwalAccount, getStoredAccountId } from '../data/memwal';
import {
  getDials,
  setDials as setDialsStore,
  isKnownPayee,
  addKnownPayee,
  autoActionSig,
  autoActionIsRepeat,
  recordAutoAction,
  getAgentEnabled,
  setAgentEnabled,
  type Dials,
} from '../data/payStore';
import { SUIVISION_TX } from '../lib/env';
import { WALLET, money } from './copy';
import { AssistantPanel } from './Assistant';
import {
  CustodyNote,
  exactWhen,
  fullWhen,
  renewsIn,
  type LedgerRow,
  type SubRow,
} from './money';
import {
  AddFundsSheet,
  CancelSubSheet,
  FundAgentSheet,
  WithdrawAgentSheet,
  SendSheet,
} from './sheets';

type SheetKind =
  | 'addFunds'
  | 'send'
  | 'fundAgent'
  | 'withdrawAgent'
  | null;

const USDC_SCALE = 1_000_000n;

/* ════════════════════════════════════════════════════════════════════════════
 * THE EDITORIAL REGISTER — design helpers ported from `ui/lab/Reconciled.tsx`.
 * Look + CSS are the approved mockup; here they're wired to live data below.
 * `money(ui)` (the imported currency formatter) owns the NUMBER; `moneyStyle`
 * owns the mono/tabular STYLE — never shadow the formatter. NO FEES anywhere.
 * ════════════════════════════════════════════════════════════════════════════ */

/* ── token shorthands ──────────────────────────────────────────────────────── */
const SERIF = 'var(--rd-serif)';
const SANS = 'var(--rd-sans)';
const MONO = 'var(--rd-mono)';
const FG = 'var(--rd-fg)';
const FG2 = 'var(--rd-fg-2)';
const FG3 = 'var(--rd-fg-3)';
const FG4 = 'var(--rd-fg-4)';
const BLUE = 'var(--rd-blue)';
const BULL = 'var(--rd-bull)';
const BEAR = 'var(--rd-bear)';
const EASE = 'var(--rd-ease)';
const HANDLE = 'var(--rd-grad-handle)';

const tabNum: CSSProperties = { fontVariantNumeric: 'tabular-nums slashed-zero' };
/** the design's mono number STYLE (renamed from the lab's `money` so it never
 *  shadows the imported `money(ui)` currency formatter). */
const moneyStyle = (size: number | string, weight = 600): CSSProperties => ({
  fontFamily: MONO,
  fontVariantNumeric: 'tabular-nums slashed-zero',
  fontSize: size,
  fontWeight: weight,
  letterSpacing: '-0.01em',
  color: FG,
  lineHeight: 1,
});
const clipGrad = (g: string): CSSProperties => ({
  background: g,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  color: 'transparent',
});

/* ── boxicon vocabulary — clean, rounded, 2px geometry ─────────────────────── */
type Kind = 'received' | 'sent' | 'agent' | 'renewed';
function Icon({ kind, size = 22 }: { kind: Kind; size?: number }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {kind === 'received' && (<><path {...p} d="M12 3v11" /><path {...p} d="M7.5 9.5 12 14l4.5-4.5" /><path {...p} d="M5 17.5h14" /></>)}
      {kind === 'sent' && (<><path {...p} d="M12 14V3" /><path {...p} d="M7.5 7.5 12 3l4.5 4.5" /><path {...p} d="M5 17.5h14" /></>)}
      {kind === 'agent' && (<><rect {...p} x="4.5" y="8" width="15" height="11" rx="3" /><path {...p} d="M12 8V4.5" /><circle cx="12" cy="3.4" r="1.2" fill="currentColor" stroke="none" /><path {...p} d="M9.3 13h.01M14.7 13h.01" /><path {...p} d="M9 16.4h6" /></>)}
      {kind === 'renewed' && (<><path {...p} d="M19 6.5A8 8 0 0 0 6 8.2" /><path {...p} d="M19 3.5v3.5h-3.5" /><path {...p} d="M5 17.5A8 8 0 0 0 18 15.8" /><path {...p} d="M5 20.5V17h3.5" /></>)}
    </svg>
  );
}
const KIND: Record<Kind, { tone: string; tint: string }> = {
  received: { tone: BULL, tint: `color-mix(in srgb, ${BULL} 13%, transparent)` },
  sent: { tone: FG2, tint: 'var(--rd-quiet)' },
  agent: { tone: BLUE, tint: 'var(--rd-wash)' },
  renewed: { tone: FG2, tint: 'var(--rd-quiet)' },
};

/** classify a real activity row into the design's icon vocabulary + its IN/OUT
 *  column. `amount > 0` is money received; everything else is OUT (the icon then
 *  keys off the action word). */
function rowKind(what: string, amount: number | null): Kind {
  if (amount != null && amount > 0) return 'received';
  const w = what.toLowerCase();
  if (w.includes('agent')) return 'agent';
  if (w.includes('renew')) return 'renewed';
  return 'sent';
}

/** a counterparty token in its identity gradient (handle = warm, 0x = blue mono).
 *  Mirrors the lab's `Who`; `name` may be the `who` handle OR the action title. */
function Who({ name }: { name: string }) {
  if (name.startsWith('0x'))
    return <span style={{ ...tabNum, fontFamily: MONO, fontSize: 13.5, fontWeight: 600, color: FG2 }}>{name}</span>;
  return (
    <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', ...clipGrad(HANDLE) }}>
      {name}
    </span>
  );
}

/** one ledger line, wired to a real `LedgerRow`. The verify seal is a REAL
 *  explorer link (`verifyHref`) — never a fabricated digest hash. A pending row
 *  shows the confirming state with no link. */
function Row({ row }: { row: LedgerRow }) {
  const isIn = row.amount != null && row.amount > 0;
  const kind = rowKind(row.what, row.amount);
  const k = KIND[kind];
  const amt =
    row.amount == null
      ? '—'
      : `${row.amount > 0 ? '+' : '−'}${money(Math.abs(row.amount))}`;
  return (
    <div className="rc-row">
      {/* the boxicon — just the glyph, no tinted box (owner) */}
      <span className="rc-row__ico" style={{ color: k.tone }}>
        <Icon kind={kind} size={18} />
      </span>
      {/* primary = the counterparty (or the action when there is none); the action
          word trails muted when a counterparty leads. All on one line. */}
      <span className="rc-row__primary">
        <span className="rc-row__who">
          <Who name={row.who ?? row.what} />
        </span>
        {row.who ? <span className="rc-row__what">{row.what}</span> : null}
      </span>
      {row.pending ? (
        <span className="rc-when rc-when--pending">{WALLET.books.confirming}</span>
      ) : row.verifyHref ? (
        <a
          className="rc-when rc-when--link"
          href={row.verifyHref}
          target="_blank"
          rel="noreferrer"
          title={row.whenTitle ? `${row.whenTitle} · ${WALLET.books.verify}` : WALLET.books.verify}
        >
          <span className="rc-when__dot" />
          {row.when}
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none"><path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </a>
      ) : (
        <span className="rc-when" title={row.whenTitle}>{row.when}</span>
      )}
      <span className="rc-row__amt" style={{ ...moneyStyle(14), color: isIn ? BULL : FG }}>{amt}</span>
    </div>
  );
}

/** the Suize logo mark — real art (public/logo-mask.png), tinted via the accent */
function Logo({ h, fill = 'var(--rd-grad-hot)' }: { h: number; fill?: string }) {
  return <span role="img" aria-label="Suize" style={{ display: 'block', height: h, width: (h * 56) / 67, flex: '0 0 auto', background: fill, WebkitMask: 'url(/logo-mask.png) center/contain no-repeat', mask: 'url(/logo-mask.png) center/contain no-repeat' }} />;
}

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** ui dollars → USDC base units (6 decimals), safely via cents */
function toRaw(ui: number): bigint {
  return (BigInt(Math.round(ui * 100)) * USDC_SCALE) / 100n;
}

/** Reverse-resolve a Sui address to its WALLET-canonical SuiNS handle (its reverse
 *  record), so the agent confirm card can show a name the WALLET derived — never the
 *  model's raw recipient string (which could be an ASCII look-alike). Best-effort:
 *  null when there is no reverse record or the RPC is unavailable. (F3) */
async function reverseHandle(address: string, client: SuiClient): Promise<string | null> {
  try {
    const c = client as unknown as {
      resolveNameServiceNames?: (a: { address: string }) => Promise<{ data?: string[] }>;
    };
    const page = await c.resolveNameServiceNames?.({ address });
    const name = page?.data?.[0];
    if (!name) return null;
    // <label>.suize.sui → the consumer "@label" form; any other .sui name shown as-is.
    const m = name.match(/^([a-z0-9-]+)\.suize\.sui$/);
    return m ? `${m[1]}@suize` : name;
  } catch {
    return null;
  }
}

export interface WalletDeckProps {
  ownerAddress: string;
  handle: string;
  /** opens the business face */
  onOpenBusiness?: () => void;
  /** disconnects the zkLogin session (the identity menu's Sign out) */
  onSignOut?: () => void;
}

export function WalletDeck({ ownerAddress, handle, onOpenBusiness, onSignOut }: WalletDeckProps) {
  const client = useSuiClient() as unknown as SuiClient;
  const { mutateAsync: signTransaction } = useSignTransaction();
  const api = useAccount(ownerAddress, handle);
  const agent = useAgent(ownerAddress, api.sendWallet, api.spendFromSubaccount);
  const subsApi = useSubscriptions(ownerAddress, true);
  const { theme, toggle } = useTheme();
  const [agentOn, setAgentOn] = useState(() => getAgentEnabled(ownerAddress));
  // Keep a LIVE ref so an in-flight brain turn's frozen executor reads the CURRENT
  // Pause state (the kill switch must bite mid-turn, not just on the next turn), and
  // persist it so Pause survives a reload (a killed switch stays killed).
  const agentOnRef = useRef(agentOn);
  useEffect(() => {
    agentOnRef.current = agentOn;
    setAgentEnabled(ownerAddress, agentOn);
  }, [agentOn, ownerAddress]);
  // The user's MemWal memory account id (null until onboarded). Passed to the agent so
  // the brain can recall/store memory under it. Best-effort — memory is optional.
  const [memAccount, setMemAccount] = useState<string | null>(() => getStoredAccountId(ownerAddress));
  const [dials, setDialsState] = useState<Dials>(() => getDials(ownerAddress));
  const updateDials = (d: Dials) => {
    setDialsState(d);
    setDialsStore(ownerAddress, d);
  };
  const [sheet, setSheet] = useState<SheetKind>(null);
  // which subscription is being cancelled (by id), if any
  const [cancelSub, setCancelSub] = useState<SubRow | null>(null);
  // the identity dropdown (navbar) — new local UI state, no data dependency
  const [idOpen, setIdOpen] = useState(false);

  const yourMoney = api.state.wallet.ui;
  const agentBalance = agent.balance.ui;
  const agentConnected = agent.armed;
  const busy = api.pending != null;
  const displayHandle = api.state.handle || handle || '…@suize';

  // ── map the real on-chain state into the list rows ─────────────────────────
  const subs = useMemo<SubRow[]>(() => {
    // push-not-pull: each renewal is paid inline from the owner's wallet, so the
    // honest line is the paid-through clock — a LAPSED sub (past its paid-through,
    // no auto-renew covered it) must SAY so, never an optimistic guess.
    return subsApi.rows.map((s) => ({
      key: s.id,
      name: s.label,
      renews: s.lapsed
        ? 'lapsed — renew or cancel'
        : s.dueSoon
          ? 'renewing soon'
          : renewsIn(s.paidUntilMs - s.periodMs, s.periodMs),
      perMonth: s.amountUi,
      warn: s.lapsed,
    }));
  }, [subsApi.rows]);

  const activity = useMemo<LedgerRow[]>(() => {
    const agentAddr = agent.agentAddress?.toLowerCase();
    const apiRows: { ts: number; row: LedgerRow }[] = api.state.activity.map((a) => {
      const isAgent = agentAddr != null && a.counterparty?.toLowerCase() === agentAddr;
      // main-account point of view: out is negative, in positive; 'none' (sub-cancelled)
      // moved nothing → no signed amount.
      const signed = a.amountUi == null || a.flow === 'none' ? null : a.flow === 'out' ? -a.amountUi : a.amountUi;
      if (isAgent) {
        // a transfer to/from the user's OWN sub-account belongs to the AGENT book: funding
        // it (main 'out') is money the agent RECEIVED (+); a sweep (main 'in') is the agent
        // RETURNING it (−). No external counterparty token — the other side is "you".
        return {
          ts: a.ts,
          row: {
            id: a.id,
            what: a.flow === 'out' ? 'Funded' : 'Returned',
            when: exactWhen(a.ts),
            whenTitle: fullWhen(a.ts),
            amount: signed == null ? null : -signed,
            verifyHref: a.pending ? undefined : SUIVISION_TX(a.txDigest),
            pending: a.pending,
            account: 'agent' as const,
          },
        };
      }
      return {
        ts: a.ts,
        row: {
          id: a.id,
          // the action ("Sent"/"Paid"/…) + the resolved "to whom" (gradient-coloured by Party).
          what: a.title,
          who: a.detail,
          when: exactWhen(a.ts),
          whenTitle: fullWhen(a.ts),
          amount: signed,
          verifyHref: a.pending ? undefined : SUIVISION_TX(a.txDigest),
          pending: a.pending,
          account: 'main' as const,
        },
      };
    });
    // The agent's OWN outbound sends (sub-account → external payee) — the "spent" half of
    // the sub-account ledger. They never touch main, so they come straight from chain
    // (useAgent.sends), interleaved by time with the fund/return rows.
    const sendRows: { ts: number; row: LedgerRow }[] = agent.sends.map((s) => ({
      ts: s.ts,
      row: {
        id: s.id,
        what: 'Sent',
        who: `${s.to.slice(0, 6)}…${s.to.slice(-4)}`,
        when: exactWhen(s.ts),
        whenTitle: fullWhen(s.ts),
        amount: -s.amountUi,
        verifyHref: SUIVISION_TX(s.txDigest),
        account: 'agent' as const,
      },
    }));
    return [...apiRows, ...sendRows].sort((a, b) => b.ts - a.ts).map((r) => r.row);
  }, [api.state.activity, agent.agentAddress, agent.sends]);

  // ── the sheet ops — the real on-chain verbs ───
  async function onSend(amt: number, to: string) {
    const resolved = await resolveRecipient(to, client);
    if (!resolved.address) throw new Error(`Could not find ${to} — check the name and try again.`);
    // pass the typed recipient as the optimistic row's label (what the user knows).
    await api.sendWallet({ amountRaw: toRaw(amt), to: resolved.address, label: to.trim() });
  }
  async function onFundAgent(amt: number) {
    await agent.fund(toRaw(amt));
  }
  async function onWithdrawAgent(amt: number) {
    await agent.withdraw(toRaw(amt)); // back to your wallet (MAIN member signs alone)
  }
  async function onConfirmCancel() {
    if (!cancelSub) return;
    await api.cancelSubscription(cancelSub.key);
    subsApi.refresh();
  }

  // ── the AGENT's tool runner — the brain (backend) proposes a tool; the WALLET
  // runs it HERE. Reads answer instantly from on-chain state already loaded;
  // writes return a confirm-card PLAN whose commit() signs + executes LOCALLY
  // (this is where the number wall lands on the client — the amount/recipient the
  // user sees + signs is computed here, never taken as authoritative from the AI). ──
  const runAgentTool = useCallback<AgentToolRunner>(
    async (tool, input): Promise<ToolRun> => {
      const usd = (n: number) => `${n.toFixed(2)} USDC`;
      switch (tool) {
        case 'get_balance':
          return {
            kind: 'immediate',
            content: `Wallet: ${usd(api.state.wallet.ui)}. Agent sub-account: ${
              agent.armed ? usd(agent.balance.ui) : 'not set up'
            }.`,
          };
        case 'get_activity': {
          const limit = Math.min(30, Math.max(1, Math.round(Number(input.limit) || 10)));
          const rows = api.state.activity.slice(0, limit);
          if (rows.length === 0) return { kind: 'immediate', content: 'No recent activity.' };
          const lines = rows.map((a) => {
            const amt = a.amountUi == null ? '—' : `${a.flow === 'out' ? '-' : '+'}${usd(a.amountUi)}`;
            const who = a.detail ? ` ${a.detail}` : '';
            return `${a.title}${who} — ${amt} (${exactWhen(a.ts)})`;
          });
          return { kind: 'immediate', content: lines.join('\n') };
        }
        case 'get_subscriptions': {
          const rows = subsApi.rows;
          if (rows.length === 0) return { kind: 'immediate', content: 'No active subscriptions.' };
          const lines = rows.map(
            (s) => `${s.label} — ${usd(s.amountUi)}/period${s.lapsed ? ' (lapsed)' : ''} [id ${s.id.slice(0, 10)}…]`,
          );
          return { kind: 'immediate', content: lines.join('\n') };
        }
        case 'send_usdc': {
          const recipient = String(input.recipient ?? '').trim();
          const amount = Number(String(input.amount_usdc ?? '').trim());
          if (!recipient) return { kind: 'immediate', content: 'No recipient was given.', isError: true };
          if (!(amount > 0)) return { kind: 'immediate', content: 'The amount must be greater than zero.', isError: true };
          const resolved = await resolveRecipient(recipient, client);
          if (!resolved.address)
            return { kind: 'immediate', content: `Couldn't find ${recipient} — check the name or address.`, isError: true };
          const to = resolved.address;
          const dials = getDials(ownerAddress);
          const known = isKnownPayee(ownerAddress, to);
          const sig = autoActionSig(to); // per-recipient → a vary-by-a-cent loop can't dodge it
          const repeat = autoActionIsRepeat(ownerAddress, sig);
          // THE SAFETY DECISION (pure, unit-tested in test/agentSpend.test.ts): the agent
          // spends ONLY from its capped SUB-ACCOUNT — NEVER the owner's main wallet. The
          // planner has no main-balance input, so it cannot authorize a main-wallet drain.
          // (unarmed, self-send, over-cap, and the auto-vs-card dial logic all live there.)
          const plan = planAgentSend({
            armed: agent.armed,
            subBalanceUi: agent.balance.ui,
            amountUi: amount,
            toIsOwner: to.toLowerCase() === ownerAddress.toLowerCase(),
            agentOn: agentOnRef.current,
            knownPayee: known,
            repeat,
            dials,
          });
          if (plan.kind === 'error') return { kind: 'immediate', content: plan.message, isError: true };
          // F3: the card/receipt shows the WALLET-derived destination handle — never the
          // model's raw recipient string (a typosquat resolves to a DIFFERENT address whose
          // reverse handle won't match → we then show the raw 0x).
          const canon = await reverseHandle(to, client);
          const label = canon ?? `${to.slice(0, 6)}…${to.slice(-4)}`;
          const doSend = async () => {
            const digest = await agent.spend(to, toRaw(amount)); // FROM the sub-account (the cap) — NEVER main
            addKnownPayee(ownerAddress, to); // first successful send → a known payee
            return digest;
          };
          if (plan.kind === 'auto') {
            const digest = await doSend();
            recordAutoAction(ownerAddress, sig);
            return {
              kind: 'immediate',
              content: `Sent ${usd(amount)} to ${label} from the agent sub-account — auto-approved.`,
              receipt: { title: canon ? `Sent to ${canon}` : `Sent to ${label}`, meta: `${usd(amount)} · auto`, digest },
            };
          }
          return {
            kind: 'card',
            title: canon ? `Send to ${canon}` : 'Send USDC',
            subtitle: repeat
              ? `You've sent ${usd(amount)} to ${label} a few times just now — confirm this repeat?`
              : 'Spends from your agent sub-account.',
            rows: [
              { k: 'To', v: canon ?? to },
              { k: 'Amount', v: usd(amount) },
              { k: 'From', v: 'agent sub-account' },
            ],
            cta: 'Send',
            commit: async () => {
              const digest = await doSend();
              return { message: `Sent ${usd(amount)} to ${label}.`, digest };
            },
          };
        }
        case 'cancel_subscription': {
          const refRaw = String(input.subscription_ref ?? '').trim();
          const ref = refRaw.toLowerCase();
          if (!ref) return { kind: 'immediate', content: 'Which subscription? Name it from the list.', isError: true };
          const rows = subsApi.rows;
          // exact id / exact label are unambiguous → use directly.
          let row = rows.find((s) => s.id.toLowerCase() === ref) ?? rows.find((s) => s.label.toLowerCase() === ref);
          if (!row) {
            // F4: a fuzzy ref must NOT silently cancel the wrong one — if it matches
            // more than one subscription, ask which instead of first-match-wins.
            const matches = rows.filter(
              (s) => s.label.toLowerCase().includes(ref) || s.id.toLowerCase().startsWith(ref),
            );
            if (matches.length === 1) row = matches[0];
            else if (matches.length > 1)
              return {
                kind: 'immediate',
                content: `Several subscriptions match "${refRaw}": ${matches.map((m) => m.label).join(', ')}. Which one?`,
              };
          }
          if (!row) return { kind: 'immediate', content: `No subscription matches "${refRaw}".`, isError: true };
          const target = row;
          return {
            kind: 'card',
            title: `Cancel ${target.label}`,
            subtitle: 'Cancelling deletes it on-chain.',
            rows: [
              { k: 'Subscription', v: target.label },
              { k: 'Amount', v: `${usd(target.amountUi)}/period` },
            ],
            cta: 'Cancel subscription',
            commit: async () => {
              const digest = await api.cancelSubscription(target.id);
              subsApi.refresh();
              return { message: `Cancelled ${target.label}.`, digest };
            },
          };
        }
        case 'sweep_agent': {
          const full = agent.balance.ui;
          // Optional partial: bring back just `amount_usdc`; omit → the whole balance.
          const raw0 = String(input.amount_usdc ?? '').trim();
          const reqAmt = Number(raw0);
          const partial = raw0 !== '' && reqAmt > 0;
          const amt = partial ? reqAmt : full;
          // Bringing money BACK is the safest move — the planner gates it on the dials
          // (full-auto / under-threshold → no card) + the cap (pure, unit-tested).
          const plan = planAgentSweep({ armed: agent.armed, subBalanceUi: full, amountUi: amt, dials: getDials(ownerAddress) });
          if (plan.kind === 'error') return { kind: 'immediate', content: plan.message, isError: true };
          // Full bring-back uses the EXACT raw balance (no decimal rounding); a partial
          // uses the asked amount. agent.withdraw moves it from the sub-account → wallet.
          const raw = partial ? toRaw(amt) : BigInt(agent.balance.raw);
          const doSweep = () => agent.withdraw(raw);
          if (plan.kind === 'auto') {
            const digest = await doSweep();
            return {
              kind: 'immediate',
              content: `Brought ${usd(amt)} back to your wallet — auto-approved.`,
              receipt: { title: 'Brought funds back', meta: `${usd(amt)} · auto`, digest },
            };
          }
          return {
            kind: 'card',
            title: partial ? 'Bring some funds back' : 'Bring agent funds back',
            subtitle: partial
              ? 'Moves part of your agent sub-account into your wallet.'
              : 'Pulls the whole sub-account balance into your wallet.',
            rows: [
              { k: 'Amount', v: usd(amt) },
              { k: 'To', v: 'your wallet' },
            ],
            cta: 'Bring it back',
            commit: async () => {
              const digest = await doSweep();
              return { message: `Brought ${usd(amt)} back to your wallet.`, digest };
            },
          };
        }
        case 'deploy_site': {
          const title = (String(input.title ?? '').trim() || 'Untitled page').slice(0, 80);
          const html = String(input.html ?? '');
          if (!html.trim() || !html.includes('<'))
            return { kind: 'immediate', content: 'No web page content was provided to publish.', isError: true };
          if (html.length > 400_000)
            return { kind: 'immediate', content: 'That page is too large — keep it small and self-contained.', isError: true };
          const price = DEPLOY_CHARGE_AMOUNT / 1e6;
          // The AI publishes from its OWN sub-account (the leash), NEVER the user's
          // main wallet: the recovered payer owns the site, so the agent owns what it
          // buys, and the spend is capped by the sub-account balance. Require it armed
          // + funded for the charge before offering the card.
          const subAddr = agent.agentAddress;
          const subMs = agent.multisig;
          if (!agent.armed || !subAddr || !subMs)
            return { kind: 'immediate', content: 'Set up your agent sub-account first — then I can publish from it.', isError: true };
          if (agent.balance.ui < price)
            return {
              kind: 'immediate',
              content: `Your agent sub-account holds ${usd(agent.balance.ui)} — publishing costs ${usd(price)}. Fund it and ask me again.`,
              isError: true,
            };
          const publish = async (onStep?: (label: string) => void) => {
            const res = await deployStaticSite({
              name: title,
              html,
              sender: subAddr,
              signBytes: (b) => api.signBytesAsSubaccount(subMs, b),
              onProgress: onStep,
            });
            agent.refresh(); // the sub-account just paid — re-read its balance
            return res.url ? `Published "${title}" — live at ${res.url}` : `Published "${title}".`;
          };
          // The spending dials apply to publishing too — it's a sub-account spend. Full
          // auto (or under the per-action threshold) publishes WITHOUT a card, mirroring
          // send_usdc, EXCEPT: a runaway repeat (the same page 3× in 10min) falls through
          // to a confirm to probe intent. No "new payee" gate — the destination is always
          // the fixed Suize deploy treasury, never an arbitrary address.
          const dials = getDials(ownerAddress);
          const sig = autoActionSig(`deploy:${title}`);
          const repeat = autoActionIsRepeat(ownerAddress, sig);
          const autoOk =
            agentOnRef.current && !repeat && (dials.mode === 'full' || (dials.mode === 'under' && price < dials.thresholdUsd));
          if (autoOk) {
            recordAutoAction(ownerAddress, sig);
            return { kind: 'immediate', content: `${await publish()} — auto-published.` };
          }
          return {
            kind: 'card',
            title: 'Publish a web page',
            subtitle: repeat
              ? `You've published "${title}" a few times just now — confirm this repeat?`
              : `"${title}" — goes live on the web.`,
            rows: [
              { k: 'Page', v: title },
              { k: 'Cost', v: usd(price) },
              { k: 'Paid from', v: 'agent sub-account' },
            ],
            cta: `Publish · ${usd(price)}`,
            commit: async (onStep) => ({ message: await publish(onStep) }),
          };
        }
        default:
          return { kind: 'immediate', content: "That isn't something I can do yet.", isError: true };
      }
    },
    [api, agent, subsApi, client, ownerAddress, signTransaction],
  );

  // Connect the agent sub-account — a popup does the one-time agent Google sign-in,
  // persists the 1-of-2 members, and signals completion over a BroadcastChannel
  // (Google's OAuth COOP severs the opener link, so popup.closed is unreliable). On
  // the signal we re-read the now-persisted members and the card arms itself. No
  // intermediary explainer sheet — the card's CTA acts directly. Popup blocked →
  // full-page fallback.
  function connectSubaccount() {
    const popup = window.open('/agent-connect?arm=1', 'suize-agent-arm', 'width=460,height=760');
    if (!popup) {
      window.location.href = '/agent-connect?arm=1';
      return;
    }
    let poll = 0;
    let ch: BroadcastChannel | null = null;
    const finish = () => {
      if (poll) window.clearInterval(poll);
      ch?.close();
      agent.reloadMembers();
      try {
        popup.close();
      } catch {
        /* COOP may block the parent closing it — harmless, the card already updated */
      }
    };
    try {
      ch = new BroadcastChannel('suize-agent-arm');
      ch.onmessage = (e: MessageEvent) => {
        if ((e.data as { type?: string })?.type === 'armed') finish();
      };
    } catch {
      ch = null;
    }
    // ONLY poll popup.closed when BroadcastChannel is unavailable — on modern browsers
    // the channel is the signal, and polling closed just spams the COOP warning.
    if (!ch) {
      poll = window.setInterval(() => {
        try {
          if (popup.closed) finish();
        } catch {
          /* COOP-blocked read */
        }
      }, 400);
    }
    window.setTimeout(() => {
      if (poll) window.clearInterval(poll);
      ch?.close();
    }, 300_000);
  }

  // MemWal MEMORY onboarding — one-time per user, best-effort. Gated SERVER-SIDE
  // (the delegate handshake returns enabled:false until MEMWAL_* is configured), so
  // this is a no-op until memory is turned on. Registers the backend's derived
  // delegate key on a user-owned account so the agent can remember across sessions.
  useEffect(() => {
    if (!ownerAddress || memAccount) return;
    let live = true;
    void ensureMemwalAccount({
      owner: ownerAddress,
      client: client as unknown as Parameters<typeof ensureMemwalAccount>[0]['client'],
      signTransaction: signTransaction as unknown as Parameters<typeof ensureMemwalAccount>[0]['signTransaction'],
      suiClient: client,
    }).then((id) => {
      if (live && id) setMemAccount(id);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerAddress]);

  // ── the LEFT split bars: each balance as a share of the combined total ──────
  const total = yourMoney + agentBalance;
  const yoursPct = total > 0 ? Math.round((yourMoney / total) * 100) : 0;
  const agentPct = total > 0 ? Math.round((agentBalance / total) * 100) : 0;

  // ── the In/Out ledger split: positive money in the IN column, the rest OUT ──
  // split by BOOK, not direction: the main account's own movement (left) vs the
  // agent sub-account's (right). Each column merges its in + out, newest first.
  const mainRows = activity.filter((a) => a.account !== 'agent');
  const agentRows = activity.filter((a) => a.account === 'agent');

  return (
    <div
      className="rc"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--rd-base)',
        fontFamily: SANS,
        color: FG,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <style>{`
        .rc { --pad: clamp(15px, 1.9vw, 26px); }
        .rc * { box-sizing: border-box; }
        .rc ::selection { background: color-mix(in srgb, var(--rd-blue) 22%, transparent); }
        .rc-fade { opacity: 0; transform: translateY(10px); animation: rc-rise .7s var(--rd-ease) forwards; }
        @keyframes rc-rise { to { opacity: 1; transform: none; } }
        @keyframes rc-pulse { 0%,100% { opacity: .5; } 50% { opacity: 1; } }
        @keyframes rc-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .rc-eyebrow { font-family: var(--rd-sans); font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--rd-fg-3); }

        /* ── TEXTURE LIBRARY (varied · alpha-noise + patterns · 4–10%, theme-aware) ── */
        .rc-tx { position: relative; isolation: isolate; }
        .rc-tx::before { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; border-radius: inherit; }
        .rc-tx--grain::before { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .6 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)'/%3E%3C/svg%3E"); background-size: 170px 170px; opacity: .08; mix-blend-mode: overlay; }
        :root[data-theme='dark'] .rc-tx--grain::before { opacity: .05; mix-blend-mode: soft-light; }

        /* ── NAVBAR — logo + wordmark left · theme + business + identity right ── */
        .rc-nav { position: relative; z-index: 30; flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px;
          padding: 12px var(--pad); border-bottom: 1px solid var(--rd-hair); background: var(--rd-surface); }
        .rc-navl { display: flex; align-items: center; gap: 12px; }
        .rc-mastr { display: flex; align-items: center; gap: 9px; }
        .rc-glyph { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; border: 0; background: transparent; color: var(--rd-fg-3); cursor: pointer; transition: color .18s var(--rd-ease), background .18s var(--rd-ease); }
        .rc-glyph:hover { color: var(--rd-fg); background: var(--rd-quiet); }
        /* Personal | Business switcher — the slick borderless segmented control
           (shared with the Business console's masthead; owner law: NO border). */
        .rc-switcher { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: var(--rd-r-12); background: var(--rd-quiet); }
        .rc-switch-tab { font-family: var(--rd-sans); font-size: 12px; font-weight: 600; padding: 6px 13px; border-radius: var(--rd-r-8); color: var(--rd-fg-3); cursor: pointer; border: 0; background: transparent; transition: color .18s var(--rd-ease), background .18s var(--rd-ease); white-space: nowrap; }
        .rc-switch-tab:hover:not(.is-active) { color: var(--rd-fg); }
        .rc-switch-tab.is-active { color: #fff; background: var(--rd-blue); box-shadow: 0 4px 12px -5px var(--rd-blue); }
        .rc-idwrap { position: relative; }
        .rc-idbtn { display: flex; align-items: center; gap: 9px; background: transparent; border: 0; cursor: pointer; padding: 5px 8px; border-radius: 11px; transition: background .16s ease; }
        .rc-idbtn:hover { background: var(--rd-quiet); }
        .rc-idmenu { position: absolute; top: calc(100% + 8px); right: 0; min-width: 220px; z-index: 40; background: var(--rd-raised); border: 1px solid var(--rd-hair); border-radius: 13px; padding: 5px; box-shadow: 0 22px 50px -22px var(--rd-glass-shadow); animation: rc-rise .2s var(--rd-ease) both; }
        .rc-idrow { display: flex; justify-content: space-between; gap: 12px; width: 100%; text-align: left; padding: 10px 12px; border-radius: 9px; font-size: 12.5px; font-weight: 600; color: var(--rd-fg-2); background: transparent; border: 0; cursor: pointer; transition: background .15s ease, color .15s ease; }
        .rc-idrow:hover { background: var(--rd-quiet); color: var(--rd-fg); }
        .rc-idrow--out:hover { color: var(--rd-bear); }

        /* ── BODY: subscriptions LEFT · editorial CENTRE · Stillness chat RIGHT ── */
        /* Money is the prominent surface: subs | money | chat. The chat takes ~45% of the
           deck (owner-set) while the money side still leads on the left. */
        .rc-body { flex: 1 1 auto; min-height: 0; display: grid;
          grid-template-columns: minmax(220px, 280px) minmax(0, 1fr) clamp(440px, 45%, 760px); }
        .rc-left { overflow-y: auto; padding: var(--pad); display: flex; flex-direction: column; gap: 16px; border-right: 1px solid var(--rd-hair); }
        .rc-mid { overflow-y: auto; padding: clamp(18px, 2vw, 30px) clamp(20px, 2.4vw, 40px); display: flex; flex-direction: column; gap: clamp(18px, 2.2vh, 28px); }
        .rc-right { min-height: 0; border-left: 1px solid var(--rd-hair); display: flex; flex-direction: column; }
        /* the real AssistantPanel root is rd-asst.rd-glass (a rounded glass card) —
           flatten its chrome so it reads as the OPEN column, not a boxed card-in-a-column */
        .rc-right .rd-asst { border-radius: 0; background: transparent; border: 0; box-shadow: none; backdrop-filter: none; -webkit-backdrop-filter: none; }

        /* left column — minimal editorial (no card boxes) */
        .rc-lefthead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding-bottom: 11px; border-bottom: 1px solid var(--rd-hair); }

        .rc-bar { height: 6px; border-radius: 999px; margin-top: 7px; overflow: hidden; background: var(--rd-raised-2); }
        .rc-bar i { display: block; height: 100%; border-radius: 999px; transform-origin: left; animation: rc-grow 1.1s var(--rd-ease) both; }

        .rc-sub { padding: 13px 2px; border-top: 1px solid var(--rd-hair-2); }
        .rc-sub:first-of-type { border-top: 0; }
        .rc-cancel { background: none; border: 0; cursor: pointer; font-size: 11px; font-weight: 600; color: var(--rd-fg-4); padding: 0; transition: color .16s ease; opacity: 0; }
        .rc-sub:hover .rc-cancel { opacity: 1; }
        .rc-cancel:hover { color: var(--rd-bear); }
        .rc-cancel:disabled { cursor: default; opacity: 0; }

        /* HERO + money cards */
        .rc-hero { border-bottom: 1px solid var(--rd-hair); padding-bottom: clamp(16px, 1.8vh, 24px); }
        .rc-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        @media (max-width: 640px) { .rc-cards { grid-template-columns: 1fr; } }
        /* THE TWO BALANCES — Oxblood Luxe jewel-metal bank cards (owner pick 2026-06-15):
           a sapphire-teal vault (mine) + an oxblood-garnet ember (agent). The surfaces are
           DARK, so each card RETINTS its local text tokens to light (the balance, labels,
           notes inherit them); the inverted-token controls are adapted below. Directional
           corner bloom + diagonal sheen + soft-light carbon grain = brushed-metal depth. */
        .rc-card { position: relative; overflow: hidden; display: flex; flex-direction: column; padding: 17px 18px 15px; border-radius: 14px;
          box-shadow: inset 0 0 0 1px var(--rd-hair), inset 0 1px 0 0 color-mix(in srgb, #fff 20%, transparent), 0 18px 40px -24px var(--rd-glass-shadow);
          --rd-fg: #f4f7fc; --rd-fg-2: rgba(244, 247, 252, .84); --rd-fg-3: rgba(244, 247, 252, .66); --rd-fg-4: rgba(244, 247, 252, .48);
          --rd-hair: rgba(255, 255, 255, .16); --rd-hair-2: rgba(255, 255, 255, .09); --rd-hair-strong: rgba(255, 255, 255, .32); }
        .rc-card--mine { background:
          linear-gradient(118deg, rgba(255, 255, 255, .16) 0%, rgba(255, 255, 255, 0) 34%),
          radial-gradient(125% 150% at 12% 8%, rgba(77, 162, 255, .34) 0%, rgba(77, 162, 255, 0) 48%),
          linear-gradient(150deg, #0c3a63 0%, #0a2c4d 46%, #06223c 74%, #041a2e 100%); }
        .rc-card--agent { background:
          linear-gradient(118deg, rgba(255, 255, 255, .16) 0%, rgba(255, 255, 255, 0) 34%),
          radial-gradient(125% 150% at 12% 8%, rgba(255, 99, 84, .40) 0%, rgba(255, 99, 84, 0) 50%),
          linear-gradient(150deg, #6e1424 0%, #560f1f 44%, #3c0a16 74%, #2a0710 100%); }
        :root[data-theme='dark'] .rc-card--mine { background:
          linear-gradient(118deg, rgba(255, 255, 255, .13) 0%, rgba(255, 255, 255, 0) 32%),
          radial-gradient(130% 155% at 12% 6%, rgba(122, 196, 255, .42) 0%, rgba(122, 196, 255, 0) 50%),
          linear-gradient(150deg, #0e4576 0%, #0a3056 44%, #06223c 76%, #03182b 100%); }
        :root[data-theme='dark'] .rc-card--agent { background:
          linear-gradient(118deg, rgba(255, 255, 255, .13) 0%, rgba(255, 255, 255, 0) 32%),
          radial-gradient(130% 155% at 12% 6%, rgba(255, 118, 96, .46) 0%, rgba(255, 118, 96, 0) 52%),
          linear-gradient(150deg, #7e162a 0%, #611224 44%, #420c19 76%, #2c0711 100%); }
        /* carbon grain via soft-light (multiply would vanish on the dark jewel surface) */
        .rc-card.rc-tx::before {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='c'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.05' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .95 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23c)'/%3E%3C/svg%3E");
          background-size: 128px 128px; opacity: .5; mix-blend-mode: soft-light; }
        /* dark-card control adaptations: the dark-on-light ink button → a frosted-light
           chip; the auto-approve seg → a recessed dark island with a frosted-light ACTIVE
           thumb (the old blue .on clashed against the warm oxblood card). */
        .rc-card .rc-btn--ink { background: #f4f7fc; color: #0e1320; }
        .rc-card .rc-seg { background: rgba(0, 0, 0, .24); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .12); }
        .rc-card .rc-segb.on { color: #141821; background: rgba(255, 255, 255, .94); box-shadow: 0 2px 8px -3px rgba(0, 0, 0, .55); }

        .rc-btn { border: 0; cursor: pointer; font-family: var(--rd-sans); font-weight: 600; font-size: 13px; padding: 10px 16px; border-radius: 12px; transition: transform .2s var(--rd-ease), box-shadow .2s var(--rd-ease); }
        .rc-btn:hover:not(:disabled) { transform: translateY(-1px); }
        .rc-btn:disabled { opacity: .5; cursor: default; }
        .rc-btn--ink { background: var(--rd-fg); color: var(--rd-base); }
        .rc-btn--blue { background: var(--rd-grad-accent); color: #fff; box-shadow: 0 6px 18px -8px var(--rd-glow); }
        .rc-btn--warm { background: var(--rd-grad-handle); color: #fff; }
        .rc-btn--ghost { background: transparent; box-shadow: inset 0 0 0 1px var(--rd-hair-strong); color: var(--rd-fg-2); }
        .rc-btn--ghost:hover:not(:disabled) { box-shadow: inset 0 0 0 1px var(--rd-fg-3); }
        .rc-btn--danger { background: transparent; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rd-bear) 40%, transparent); color: var(--rd-bear); }
        .rc-arm { display: inline-flex; align-items: center; gap: 8px; padding: 6px 11px; border-radius: 999px; cursor: pointer; background: transparent; border: 0; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; }
        .rc-arm:disabled { cursor: default; }

        /* small auto-approve tucked in the agent card */
        .rc-auto { display: flex; align-items: center; gap: 8px; margin-top: 13px; padding-top: 13px; border-top: 1px dashed var(--rd-hair); flex-wrap: wrap; }
        .rc-autolab { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--rd-fg-4); }
        .rc-seg { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border-radius: 9px; background: var(--rd-base); box-shadow: inset 0 0 0 1px var(--rd-hair); }
        .rc-segb { display: inline-flex; align-items: center; gap: 1px; white-space: nowrap; font-family: var(--rd-sans); font-size: 11px; font-weight: 700; padding: 6px 9px; border-radius: 7px; color: var(--rd-fg-3); cursor: pointer; border: 0; background: transparent; transition: color .18s var(--rd-ease), background .18s var(--rd-ease); }
        .rc-segb.on { color: #fff; background: var(--rd-grad-accent); }
        .rc-segb:not(.on):hover:not(:disabled) { color: var(--rd-fg); }
        .rc-segb:disabled { cursor: default; opacity: .6; }
        .rc-capin { width: 30px; background: transparent; border: 0; outline: none; text-align: center; font-family: var(--rd-mono); font-variant-numeric: tabular-nums slashed-zero; font-size: 11px; font-weight: 700; color: inherit; border-bottom: 1px solid color-mix(in srgb, currentColor 45%, transparent); padding: 0; }
        .rc-capin:disabled { cursor: default; }

        .rc-sechead { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; padding-bottom: 11px; border-bottom: 1px solid var(--rd-hair); }
        .rc-sectitle { font-family: var(--rd-serif); font-size: clamp(19px, 1.6vw, 23px); font-weight: 500; letter-spacing: -0.01em; color: var(--rd-fg); margin: 0; }

        .rc-ledger { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(16px, 1.8vw, 28px); margin-top: 16px; }
        @media (max-width: 1340px) { .rc-ledger { grid-template-columns: 1fr; gap: 22px; } }
        .rc-colhead { display: flex; align-items: center; gap: 9px; padding: 0 4px 9px; border-bottom: 1px solid var(--rd-hair-strong); }
        .rc-colhead__bar { width: 18px; height: 3px; border-radius: 2px; }
        /* COMPACT single-line ledger row: [glyph] who · action … when↗  amount */
        .rc-row { display: flex; align-items: center; gap: 10px; padding: 7px 6px; border-bottom: 1px solid var(--rd-hair-2); border-radius: 9px; transition: background .18s var(--rd-ease); }
        .rc-row:hover { background: color-mix(in srgb, var(--rd-blue) 5%, transparent); }
        .rc-row:last-child { border-bottom: 0; }
        .rc-row__ico { flex: 0 0 auto; display: grid; place-items: center; width: 22px; height: 22px; }
        .rc-row__primary { flex: 1 1 auto; min-width: 0; display: flex; align-items: baseline; gap: 7px; overflow: hidden; }
        .rc-row__who { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rd-fg-3); }
        .rc-row__what { flex: 0 0 auto; font-family: var(--rd-serif); font-style: italic; font-size: 11.5px; color: var(--rd-fg-4); white-space: nowrap; }
        .rc-when { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-variant-numeric: tabular-nums slashed-zero; color: var(--rd-fg-4); text-decoration: none; white-space: nowrap; transition: color .18s var(--rd-ease); }
        .rc-when--pending { font-style: italic; }
        a.rc-when--link:hover { color: var(--rd-blue); }
        .rc-when__dot { width: 5px; height: 5px; border-radius: 999px; background: var(--rd-bull); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rd-bull) 16%, transparent); }
        .rc-when svg { opacity: 0; transition: opacity .18s var(--rd-ease); }
        a.rc-when--link:hover svg { opacity: 1; }
        .rc-row__amt { flex: 0 0 auto; white-space: nowrap; }
        .rc-empty { font-family: var(--rd-serif); font-style: italic; font-size: 13px; color: var(--rd-fg-4); padding: 14px 4px; }

        @media (prefers-reduced-motion: reduce) { .rc-fade, .rc-bar i { animation: none; opacity: 1; transform: none; } }
        @media (max-width: 1120px) {
          .rc { overflow: auto; }
          .rc-body { grid-template-columns: 1fr; }
          .rc-left, .rc-mid, .rc-right { overflow: visible; border: 0; }
          .rc-left { border-bottom: 1px solid var(--rd-hair); }
          .rc-right { border-top: 1px solid var(--rd-hair); min-height: 560px; }
        }
      `}</style>

      {/* ════════ NAVBAR ════════ */}
      <header className="rc-nav">
        <div className="rc-navl">
          <Logo h={30} />
          <span style={{ fontFamily: 'var(--rd-wordmark)', fontSize: 21, fontWeight: 700, letterSpacing: '0.03em', lineHeight: 1, ...clipGrad('linear-gradient(180deg, var(--rd-fg) 8%, var(--rd-blue) 150%)') }}>SUIZE</span>
        </div>
        <div className="rc-mastr">
          <button type="button" className="rc-glyph" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
            {theme === 'dark'
              ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.4" stroke="currentColor" strokeWidth="1.6" /><g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">{[0, 45, 90, 135, 180, 225, 270, 315].map((d) => <line key={d} x1="12" y1="1.7" x2="12" y2="4" transform={`rotate(${d} 12 12)`} />)}</g></svg>
              : <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M20 14.5A8 8 0 1 1 9.5 4 6.3 6.3 0 0 0 20 14.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>}
          </button>
          {onOpenBusiness ? (
            <div className="rc-switcher" role="tablist" aria-label="Personal or Business">
              <button type="button" className="rc-switch-tab is-active" aria-current="true">Personal</button>
              <button type="button" className="rc-switch-tab" onClick={onOpenBusiness}>Business</button>
            </div>
          ) : null}
          <div className="rc-idwrap">
            <button type="button" className="rc-idbtn" onClick={() => setIdOpen((v) => !v)}>
              <span style={{ width: 30, height: 30, borderRadius: 999, flex: '0 0 auto', background: HANDLE }} />
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
                <span style={{ fontFamily: MONO, fontSize: 12.5, ...tabNum }}>
                  {(() => {
                    const [label, dom] = displayHandle.split('@');
                    return (<><span style={clipGrad(HANDLE)}>{label}</span>{dom ? <span style={{ color: FG4 }}>@{dom}</span> : null}</>);
                  })()}
                </span>
                <span style={{ fontSize: 10, color: FG4, ...tabNum }}>{short(ownerAddress)}</span>
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flex: '0 0 auto', color: FG4, transform: idOpen ? 'rotate(180deg)' : 'none', transition: `transform .2s ${EASE}` }}><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {idOpen && (
              <div className="rc-idmenu">
                <button
                  type="button"
                  className="rc-idrow"
                  onClick={() => {
                    navigator.clipboard?.writeText(ownerAddress);
                    setIdOpen(false);
                  }}
                >
                  <span>Copy address</span>
                  <span style={{ ...tabNum, fontFamily: MONO, fontSize: 11, color: FG4 }}>{short(ownerAddress)}</span>
                </button>
                <button
                  type="button"
                  className="rc-idrow rc-idrow--out"
                  onClick={() => {
                    onSignOut?.();
                    setIdOpen(false);
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ════════ BODY: 3 columns ════════ */}
      <div className="rc-body">
        {/* ── LEFT — minimal editorial: vitals + subscriptions, no cards ── */}
        <aside className="rc-left">
          <div className="rc-fade" style={{ paddingTop: 2 }}>
            <span className="rc-eyebrow">How it splits</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: FG }}>Your money</span>
                  <span style={{ ...moneyStyle(13), color: FG2 }}>{yoursPct}%</span>
                </div>
                <div className="rc-bar"><i style={{ width: `${yoursPct}%`, background: BLUE }} /></div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, ...clipGrad(HANDLE) }}>Agent sub-account</span>
                  <span style={{ ...moneyStyle(13), color: FG2 }}>{agentPct}%</span>
                </div>
                <div className="rc-bar"><i style={{ width: `${agentPct}%`, background: HANDLE, animationDelay: '.15s' }} /></div>
              </div>
            </div>
          </div>

          <div className="rc-fade" style={{ animationDelay: '60ms' }}>
            <div className="rc-lefthead">
              <span className="rc-eyebrow">Subscriptions</span>
              <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 12, color: FG4 }}>they renew themselves</span>
            </div>
            {subs.length === 0 ? (
              <p className="rc-empty">{WALLET.books.emptySubs}</p>
            ) : (
              subs.map((s) => (
                <div key={s.key} className="rc-sub">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: FG }}>{s.name}</div>
                      <div style={{ fontSize: 10.5, color: s.warn ? BEAR : FG4, marginTop: 4, whiteSpace: 'nowrap' }}>{s.renews}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ ...moneyStyle(14) }}>{money(s.perMonth)}<span style={{ color: FG4, fontWeight: 400, fontSize: 10.5 }}>/mo</span></span>
                      <button
                        type="button"
                        className="rc-cancel"
                        disabled={busy}
                        onClick={() => setCancelSub(subs.find((x) => x.key === s.key) ?? null)}
                      >
                        {WALLET.books.cancel}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
            {/* the silent-renew toasts (push-not-pull: each period paid inline) */}
            {subsApi.toasts.map((t) => (
              <p key={t.id} className="rc-empty" role="status" style={{ paddingTop: 8 }}>
                {t.message}
              </p>
            ))}
          </div>

          <CustodyNote />
        </aside>

        {/* ── CENTRE — total hero · money cards · activity ── */}
        <main className="rc-mid">
          <section className="rc-hero rc-fade">
            <span className="rc-eyebrow">{WALLET.totalLabel} balance</span>
            <div style={{ marginTop: 12, lineHeight: 0.9 }}>
              <span style={{ ...moneyStyle('clamp(48px,5.4vw,72px)'), letterSpacing: '-0.04em', ...clipGrad('var(--rd-grad-hot)') }}>{money(total)}</span>
            </div>
            <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 14, color: FG4, margin: '12px 0 0', lineHeight: 1.5, maxWidth: 460 }}>
              Two accounts, one line — what you hold, and what your AI may spend.
            </p>
          </section>

          <section className="rc-cards rc-fade" style={{ animationDelay: '60ms' }}>
            {/* YOUR MONEY */}
            <div className="rc-card rc-card--mine rc-tx rc-tx--grain">
              <span className="rc-eyebrow">{WALLET.books.your.label}</span>
              <div style={{ ...moneyStyle(29, 500), marginTop: 11, letterSpacing: '-0.02em' }}>{money(yourMoney)}</div>
              <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: FG3, marginTop: 7, lineHeight: 1.45 }}>{WALLET.books.your.note}</div>
              <div style={{ display: 'flex', gap: 9, marginTop: 'auto', paddingTop: 16 }}>
                <button type="button" className="rc-btn rc-btn--ink" onClick={() => setSheet('addFunds')}>{WALLET.books.your.actions[0]}</button>
                <button type="button" className="rc-btn rc-btn--ghost" disabled={busy} onClick={() => setSheet('send')}>{WALLET.books.your.actions[1]}</button>
              </div>
            </div>

            {/* AGENT SUB-ACCOUNT */}
            <div className="rc-card rc-card--agent rc-tx rc-tx--grain">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="rc-eyebrow" style={{ color: FG3 }}>{WALLET.books.agent.label}</span>
                {agentConnected ? (
                  <button
                    type="button"
                    className="rc-arm"
                    onClick={() => setAgentOn((v) => !v)}
                    aria-label={agentOn ? 'Pause agent' : 'Resume agent'}
                    style={{ color: agentOn ? BULL : BEAR, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${agentOn ? BULL : BEAR} 32%, transparent)` }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: agentOn ? BULL : BEAR, animation: agentOn ? 'rc-pulse 2.4s var(--rd-ease) infinite' : 'none' }} />
                    {agentOn ? 'ACTIVE' : 'PAUSED'}
                  </button>
                ) : null}
              </div>

              {agentConnected ? (
                <>
                  <div style={{ ...moneyStyle(29, 500), marginTop: 11, letterSpacing: '-0.02em', opacity: agentOn ? 1 : 0.5, transition: 'opacity .3s var(--rd-ease)' }}>{money(agentBalance)}</div>
                  <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: FG3, marginTop: 7, lineHeight: 1.45 }}>
                    {agentOn ? WALLET.books.agent.note : WALLET.books.agent.pausedNote}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 'auto', paddingTop: 16, flexWrap: 'wrap' }}>
                    <button type="button" className="rc-btn rc-btn--warm" disabled={busy} onClick={() => setSheet('fundAgent')}>{WALLET.books.agent.fund}</button>
                    <button type="button" className="rc-btn rc-btn--ghost" disabled={busy} onClick={() => setSheet('withdrawAgent')}>{WALLET.books.agent.withdraw}</button>
                    <button
                      type="button"
                      className={`rc-btn ${agentOn ? 'rc-btn--danger' : 'rc-btn--ghost'}`}
                      style={{ marginLeft: 'auto' }}
                      onClick={() => setAgentOn((v) => !v)}
                    >
                      {agentOn ? WALLET.books.agent.pause : WALLET.books.agent.resume}
                    </button>
                  </div>
                  {/* the tucked auto-approve dials — real client-side policy (sends only;
                      a NEW payee always confirms regardless of the dial). */}
                  <div className="rc-auto">
                    <span className="rc-autolab">Auto-approve</span>
                    <div className="rc-seg">
                      <button type="button" className={`rc-segb${dials.mode === 'each' ? ' on' : ''}`} onClick={() => updateDials({ ...dials, mode:'each' })}>Each</button>
                      <button type="button" className={`rc-segb${dials.mode === 'under' ? ' on' : ''}`} onClick={() => updateDials({ ...dials, mode:'under' })}>
                        Under&nbsp;$
                        <input
                          className="rc-capin"
                          value={dials.thresholdUsd}
                          inputMode="numeric"
                          aria-label="Auto-approve threshold in USDC"
                          onClick={(e) => { e.stopPropagation(); updateDials({ ...dials, mode: 'under' }); }}
                          onChange={(e) => updateDials({ ...dials, thresholdUsd: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                        />
                      </button>
                      <button type="button" className={`rc-segb${dials.mode === 'full' ? ' on' : ''}`} onClick={() => updateDials({ ...dials, mode:'full' })}>Full auto</button>
                    </div>
                    <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 11.5, color: FG4 }}>new payees always confirm</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ ...moneyStyle(29, 500), marginTop: 11, letterSpacing: '-0.02em' }}>{money(0)}</div>
                  <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 13, color: FG3, marginTop: 7, lineHeight: 1.45 }}>{WALLET.books.agent.empty}</div>
                  <div style={{ display: 'flex', gap: 9, marginTop: 'auto', paddingTop: 16 }}>
                    <button type="button" className="rc-btn rc-btn--warm" onClick={connectSubaccount}>{WALLET.books.agent.emptyCta}</button>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="rc-fade" style={{ animationDelay: '120ms' }}>
            <div className="rc-sechead">
              <h2 className="rc-sectitle">{WALLET.books.activityTitle}</h2>
              <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 12.5, color: FG4 }}>every line checkable on-chain</span>
            </div>
            {activity.length === 0 ? (
              <p className="rc-empty">{WALLET.books.emptyActivity}</p>
            ) : (
              <div className="rc-ledger">
                {/* LEFT — your main account's own movement (in + out merged) */}
                <div>
                  <div className="rc-colhead">
                    <span className="rc-colhead__bar" style={{ background: BLUE }} />
                    <span className="rc-eyebrow">Main account</span>
                    <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 12, color: FG4 }}>your own money</span>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    {mainRows.length === 0 ? <p className="rc-empty">No activity yet.</p> : mainRows.map((a) => <Row key={a.id} row={a} />)}
                  </div>
                </div>
                {/* RIGHT — the agent sub-account's movement (funded · returned · spent) */}
                <div>
                  <div className="rc-colhead">
                    <span className="rc-colhead__bar" style={{ background: 'var(--rd-grad-handle)' }} />
                    <span className="rc-eyebrow">Agent</span>
                    <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 12, color: FG4 }}>the sub-account</span>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    {agentRows.length === 0 ? <p className="rc-empty">No agent activity yet.</p> : agentRows.map((a) => <Row key={a.id} row={a} />)}
                  </div>
                </div>
              </div>
            )}
          </section>
        </main>

        {/* ── RIGHT — the assistant pane (≤35%: floating history + centered conversation) ── */}
        <aside className="rc-right rc-fade" style={{ animationDelay: '90ms' }}>
          <AssistantPanel
            agentOn={agentOn}
            ownerAddress={ownerAddress}
            runAgentTool={runAgentTool}
            memwalAccountId={memAccount ?? undefined}
          />
        </aside>
      </div>

      {/* ── THE MONEY SHEETS ── */}
      {sheet === 'addFunds' ? (
        <AddFundsSheet handle={displayHandle} address={ownerAddress} requestEnabled={false} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'send' ? (
        <SendSheet available={yourMoney} onSend={onSend} claimEnabled={false} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'fundAgent' ? (
        <FundAgentSheet available={yourMoney} onFund={onFundAgent} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'withdrawAgent' ? (
        <WithdrawAgentSheet
          balance={agentBalance}
          onWithdraw={onWithdrawAgent}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {cancelSub ? (
        <CancelSubSheet
          label={cancelSub.name}
          perMonth={cancelSub.perMonth}
          onConfirm={onConfirmCancel}
          onClose={() => setCancelSub(null)}
        />
      ) : null}
    </div>
  );
}
