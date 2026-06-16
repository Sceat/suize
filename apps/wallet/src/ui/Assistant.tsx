/**
 * THE ASSISTANT PANEL. The chat is SECONDARY by owner law: the wallet's money
 * surfaces own the page; this panel docks beside them (a right glass column).
 * The agent on/off control is the SINGLE Pause/Resume button on the agent card
 * (the deck) — NOT a duplicate switch here. This panel only READS `agentOn`
 * (to quiet the composer when the agent is paused).
 *
 * PRODUCTION is honest: the conversational layer is still being built, so the
 * thread starts empty (chips invite a try; the reply says plainly what works
 * today) and there is NO fabricated history and NO fabricated confirm card.
 * The `demo` seam (DEV-only) plays the full SF choreography — ask → plan →
 * found-it → confirm card → "Book it" → `onBooked()` ticks the host balances.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, ExternalLink, Plus, ICON_STROKE } from '../system';
import { ASSISTANT, WALLET, money, type ChatMsg } from './copy';
import { Divider, Row, Spark, TypingRow, rich } from './bits';
import { wsBrainChat, wsBrainToolResult } from '../data/ws';
import type { AgentToolRunner, ToolRun } from '../data/agentTools';
import type { BrainMessage } from '@suize/shared/protocol';

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SEED_STEPS = WALLET.thread.length + 1;

type ConfirmState = 'pending' | 'done' | 'declined';

interface Extra {
  who: 'you' | 'ai';
  text: string;
}

export interface AssistantPanelProps {
  /** READ-ONLY here — the Pause/Resume control lives on the agent card. Quiets the
   *  composer when the agent is paused. */
  agentOn: boolean;
  /** the host ticks its balance + activity when the DEMO booking confirms */
  onBooked?: () => void;
  /** DEV demo seam — seeded thread + sample history + the confirm card */
  demo?: boolean;
  /** PRODUCTION: the wallet's agent tool runner (reads + write-confirm plans). When
   *  present (and not demo), the panel runs the REAL brain chat instead of the stub. */
  runAgentTool?: AgentToolRunner;
  /** the user's MemWal memory account id (if onboarded) — sent with each turn so the
   *  brain recalls/stores memory under it. Undefined = no memory this session. */
  memwalAccountId?: string;
}

export function AssistantPanel(props: AssistantPanelProps) {
  // Production with the agent wired → the REAL brain chat. Demo (DEV-only) or a
  // missing tool runner → the legacy panel (the SF choreography / honest empty thread).
  if (!props.demo && props.runAgentTool) {
    return (
      <BrainAssistant
        agentOn={props.agentOn}
        runAgentTool={props.runAgentTool}
        memwalAccountId={props.memwalAccountId}
      />
    );
  }
  return <LegacyAssistant {...props} />;
}

function LegacyAssistant({ agentOn, onBooked, demo = false }: AssistantPanelProps) {
  const reduce = useMemo(reduceMotion, []);

  const [convo, setConvo] = useState<string>(demo ? 'sf' : 'new');
  const [seedShown, setSeedShown] = useState(reduce ? SEED_STEPS : 0);
  const seedRef = useRef(reduce ? SEED_STEPS : 0);
  const setSeed = (n: number) => {
    seedRef.current = n;
    setSeedShown(n);
  };
  const [typing, setTyping] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState>('pending');
  const [payoffShown, setPayoffShown] = useState(false);
  const [extras, setExtras] = useState<Record<string, Extra[]>>({});
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);

  // ── seeded choreography (DEMO only; StrictMode/cleanup-safe via seedRef) ──
  useEffect(() => {
    if (!demo || convo !== 'sf') return;
    if (seedRef.current >= SEED_STEPS) return;
    if (seedRef.current > 0) {
      setTyping(false);
      setSeed(SEED_STEPS);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    let t = 500;
    WALLET.thread.forEach((m, i) => {
      if (m.who === 'ai') {
        at(t, () => setTyping(true));
        t += 1050;
        at(t, () => {
          setTyping(false);
          setSeed(i + 1);
        });
        t += 620;
      } else {
        at(t, () => setSeed(i + 1));
        t += 650;
      }
    });
    at(t + 150, () => setSeed(SEED_STEPS));
    return () => {
      timers.forEach(clearTimeout);
      setTyping(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convo, demo]);

  // auto-scroll to the foot on every thread change
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [seedShown, typing, payoffShown, extras, convo, confirm]);

  function onBook() {
    setConfirm('done');
    onBooked?.();
    if (reduce) {
      setPayoffShown(true);
      return;
    }
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setPayoffShown(true);
    }, 900);
  }

  function onDecline() {
    setConfirm('declined');
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setPayoffShown(true);
    }, 700);
  }

  function send(text: string) {
    const msg = text.trim();
    if (!msg || !agentOn) return;
    setDraft('');
    setExtras((e) => ({ ...e, [convo]: [...(e[convo] ?? []), { who: 'you', text: msg }] }));
    setTyping(true);
    setTimeout(
      () => {
        setTyping(false);
        setExtras((e) => ({
          ...e,
          // production answers HONESTLY (the AI is roadmap); the demo plays co-pilot
          [convo]: [...(e[convo] ?? []), { who: 'ai', text: demo ? WALLET.scriptedReply : WALLET.prodReply }],
        }));
      },
      reduce ? 0 : 1100,
    );
  }

  const activeHistory = demo ? WALLET.history.find((h) => h.id === convo) : undefined;
  const isSeed = demo && convo === 'sf';
  const isNew = convo === 'new';
  const liveExtras = extras[convo] ?? [];
  const flightBooked = confirm === 'done';

  return (
    <div className="rd-asst rd-glass">
      {/* head — the assistant identity (the agent on/off control is the agent
          card's Pause/Resume button, not a duplicate switch here) */}
      <div className="rd-asst__head">
        <span className="rd-asst__title">
          <Spark />
          {ASSISTANT.title}
        </span>
      </div>

      {/* recent conversations — TOP-DOWN list (DEMO history only; production has
          no past conversations to fabricate) */}
      {demo ? (
        <div className="rd-asst__recent">
          <div className="rd-asst__recenthead">
            <span className="rd-label">{ASSISTANT.recentLabel}</span>
            <button type="button" className="rd-asst__new" onClick={() => setConvo('new')}>
              <Plus size={11} strokeWidth={2} aria-hidden />
              {WALLET.newChat}
            </button>
          </div>
          {WALLET.history.map((h) => (
            <button
              key={h.id}
              type="button"
              className={`rd-asst__item${convo === h.id ? ' is-active' : ''}`}
              onClick={() => setConvo(h.id)}
            >
              <span className="rd-asst__itemtitle">{h.title}</span>
              <span className="rd-asst__itemwhen">{h.when}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* the thread */}
      <div className="rd-asst__thread" ref={threadRef}>
        {isNew && liveExtras.length === 0 ? (
          <div className="rd-asst__empty">
            <p className="rd-asst__emptytitle">What can I handle for you?</p>
            <div className="rd-chips">
              {(demo ? WALLET.chips : [WALLET.prodChip]).map((c) => (
                <button key={c} type="button" className="rd-chip" onClick={() => send(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {!isSeed && !isNew && activeHistory && 'transcript' in activeHistory
          ? (activeHistory.transcript as readonly ChatMsg[]).map((m, i) => (
              <Row key={i} who={m.who}>
                {rich(m.text)}
              </Row>
            ))
          : null}

        {isSeed
          ? WALLET.thread.map((m, i) => (
              <div key={i} style={{ display: 'contents' }}>
                {m.divider && i < seedShown ? <Divider label={m.divider} /> : null}
                <Row who={m.who} landed={i < seedShown}>
                  {rich(m.text)}
                </Row>
              </div>
            ))
          : null}

        {isSeed && seedShown >= SEED_STEPS ? (
          <div className="rd-row rd-row--ai is-in">
            <article className={`rd-confirm rd-glass${flightBooked ? ' is-done' : ''}`}>
              <div className="rd-confirm__head">
                <Spark />
                {WALLET.confirmCard.label}
              </div>
              <div className="rd-confirm__body">
                <span className="rd-confirm__merchant">{WALLET.confirmCard.merchant}</span>
                <span className="rd-confirm__detail">{WALLET.confirmCard.detail}</span>
                <span className="rd-confirm__amount">{money(WALLET.confirmCard.amount)}</span>
                <span className="rd-confirm__source">{WALLET.confirmCard.source}</span>
              </div>
              {confirm === 'pending' ? (
                <div className="rd-confirm__acts">
                  <button type="button" className="rd-cta" onClick={onBook} disabled={!agentOn}>
                    {WALLET.confirmCard.yes}
                  </button>
                  <button type="button" className="rd-btn" onClick={onDecline}>
                    {WALLET.confirmCard.no}
                  </button>
                </div>
              ) : null}
              <div className="rd-confirm__done">
                <Check size={14} strokeWidth={2.2} aria-hidden />
                Booked · receipt logged
              </div>
              {confirm === 'declined' ? (
                <div className="rd-confirm__done" style={{ display: 'flex', color: 'var(--rd-fg-3)' }}>
                  Skipped — still watching prices
                </div>
              ) : null}
            </article>
          </div>
        ) : null}

        {isSeed && payoffShown && confirm === 'done' ? (
          <Row who="ai">
            {rich(WALLET.payoff)}
            <a className="rd-paid" href="#receipt" onClick={(e) => e.preventDefault()}>
              <i>
                <Check size={10} strokeWidth={2.4} aria-hidden />
              </i>
              {WALLET.paidChip}
              <ExternalLink size={10} strokeWidth={ICON_STROKE} aria-hidden />
            </a>
          </Row>
        ) : null}
        {isSeed && payoffShown && confirm === 'declined' ? <Row who="ai">{rich(WALLET.declined)}</Row> : null}

        {liveExtras.map((m, i) => (
          <Row key={`x${i}`} who={m.who}>
            {rich(m.text)}
          </Row>
        ))}

        {typing ? <TypingRow /> : null}
      </div>

      {/* the composer */}
      <form
        className="rd-asst__composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={agentOn ? WALLET.composer : WALLET.composerOff}
          disabled={!agentOn}
          aria-label="Message your wallet"
        />
        <button type="submit" className="rd-composer__send" aria-label="Send" disabled={!agentOn || !draft.trim()}>
          <ArrowUp size={15} strokeWidth={2} aria-hidden />
        </button>
      </form>
    </div>
  );
}

// (The floating AssistantDock died with the dock-pill pattern — both faces now
// keep their chat as a PERMANENT column, owner law 2026-06-10.)

// ─────────────────────────────────────────────────────────────────────────────
// THE BRAIN ASSISTANT — the REAL conversational wallet (production). Drives the
// backend's keyless agentic loop over the WS: the user types → the brain streams
// narration (chunks) and PROPOSES tools → the WALLET runs each tool via
// `runAgentTool` (reads answer instantly; writes surface an inline confirm card the
// user taps, then sign LOCALLY) → the result is fed back → the model continues.
// The model never moves money: every spend is a card the user approves, decoded by
// the wallet itself (the number wall, on the client). One turn at a time.
// ─────────────────────────────────────────────────────────────────────────────
// A thread entry: a chat bubble (`you`/`ai`), OR a compact RECEIPT — a confirmed
// (or declined) action that turned into a small permanent record instead of vanishing.
type Turn = { who: 'you' | 'ai'; text: string; kind?: 'receipt'; meta?: string; bad?: boolean };
type CardPhase = 'pending' | 'working' | 'done' | 'error';
interface ActiveCard {
  toolUseId: string;
  title: string;
  subtitle?: string;
  rows: { k: string; v: string }[];
  cta: string;
  commit: (onStep?: (label: string) => void) => Promise<string>;
  phase: CardPhase;
  error?: string;
}

const PROD_CHIPS = ["What's my balance?", 'Show my recent activity', 'What am I subscribed to?'];

// Friendly, no-jargon status verbs for the live loader (consumer-vocabulary law —
// never the tool name). When a step is running we pin its verb; otherwise the loader
// cycles the generic thinking verbs below.
const TOOL_STATUS: Record<string, string> = {
  get_balance: 'Checking your balance',
  get_activity: 'Looking through your activity',
  get_subscriptions: 'Checking your subscriptions',
  send_usdc: 'Preparing your payment',
  cancel_subscription: 'Setting that up',
  sweep_agent: 'Bringing your money back',
  deploy_site: 'Publishing your page',
};
const THINKING_VERBS = ['Thinking', 'Working it out', 'One moment', 'Putting it together'];

/** The agentic loader — a pulsing spark, a shimmering status verb, an animated
 *  ellipsis, and an elapsed beat (Claude-Code style). `label` pins a step-specific
 *  verb; without one it cycles the generic thinking verbs. Real model thinking runs
 *  under the hood — this is the on-screen treatment, no raw reasoning shown. */
function LoaderRow({ label }: { label?: string | null }) {
  const [tick, setTick] = useState(0);
  const start = useRef(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = Math.floor((Date.now() - start.current) / 1000);
  // Open with an instant acknowledgement ("Sure, let me do that") so there's a beat of
  // feedback before the model's thinking lands; then a step verb (if pinned) or rotating
  // generic verbs. The elapsed beat sits on the LEFT (fixed width) so it never shifts as
  // the verb / animated ellipsis change width.
  const verb = label ?? (tick < 3 ? 'Sure, let me do that' : THINKING_VERBS[Math.floor((tick - 3) / 3) % THINKING_VERBS.length]!);
  return (
    <div className="rd-row rd-row--ai is-in">
      <span className="rd-loader" aria-live="polite" aria-label={`${verb}…`}>
        <span className="rd-loader__t">{elapsed >= 1 ? `${elapsed}s` : ''}</span>
        <span className="rd-loader__spark">
          <Spark />
        </span>
        <span className="rd-loader__label">
          {verb}
          <i className="rd-loader__ell" aria-hidden="true" />
        </span>
      </span>
    </div>
  );
}

function BrainAssistant({
  agentOn,
  runAgentTool,
  memwalAccountId,
}: {
  agentOn: boolean;
  runAgentTool: AgentToolRunner;
  memwalAccountId?: string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [thinking, setThinking] = useState(false);
  const [status, setStatus] = useState<string | null>(null); // current loader verb (step-specific)
  const [workingLabel, setWorkingLabel] = useState<string | null>(null); // live progress on a committing card
  const [card, setCard] = useState<ActiveCard | null>(null);
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const aiIdxRef = useRef(-1); // index of the streaming AI turn in `turns`
  const busy = thinking || card != null;

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, thinking, card]);

  const appendAi = useCallback((delta: string) => {
    setTurns((prev) => {
      const i = aiIdxRef.current;
      if (i < 0 || !prev[i]) return prev;
      const next = prev.slice();
      next[i] = { ...next[i]!, text: next[i]!.text + delta };
      return next;
    });
  }, []);

  const setAi = useCallback((text: string) => {
    setTurns((prev) => {
      const i = aiIdxRef.current;
      if (i < 0 || !prev[i]) return prev;
      const next = prev.slice();
      next[i] = { ...next[i]!, text };
      return next;
    });
  }, []);

  // Run one proposed tool. Reads answer immediately; writes surface a confirm card.
  const onToolUse = useCallback(
    async (toolUseId: string, tool: string, input: Record<string, unknown>) => {
      setStatus(TOOL_STATUS[tool] ?? null); // pin the step verb on the loader
      let run: ToolRun;
      try {
        run = await runAgentTool(tool, input);
      } catch (e) {
        wsBrainToolResult(toolUseId, `That failed: ${(e as Error).message}`, true);
        return;
      }
      if (run.kind === 'immediate') {
        wsBrainToolResult(toolUseId, run.content, run.isError ?? false);
        setThinking(true); // keep the loader up while the model reasons about the next step
        return;
      }
      // a money action — show the confirm card and wait for the user's tap.
      setThinking(false);
      setStatus(null);
      setCard({
        toolUseId,
        title: run.title,
        subtitle: run.subtitle,
        rows: run.rows,
        cta: run.cta,
        commit: run.commit,
        phase: 'pending',
      });
    },
    [runAgentTool],
  );

  const startTurn = useCallback(
    (messages: BrainMessage[]) => {
      wsBrainChat(messages, {
        onChunk: (delta) => {
          setThinking(false);
          setStatus(null);
          appendAi(delta);
        },
        onToolUse: (id, tool, input) => void onToolUse(id, tool, input),
        onDone: () => {
          setThinking(false);
          setStatus(null);
          aiIdxRef.current = -1;
          // drop a trailing empty AI bubble (the model acted silently then ended).
          setTurns((prev) =>
            prev.length && prev[prev.length - 1]!.who === 'ai' && !prev[prev.length - 1]!.text.trim()
              ? prev.slice(0, -1)
              : prev,
          );
        },
        onError: (message) => {
          setThinking(false);
          setStatus(null);
          setAi(message);
          aiIdxRef.current = -1;
        },
      }, memwalAccountId);
    },
    [appendAi, setAi, onToolUse, memwalAccountId],
  );

  const send = useCallback(
    (text: string) => {
      const msg = text.trim();
      if (!msg || !agentOn || busy) return;
      setDraft('');
      setTurns((prev) => {
        const next: Turn[] = [...prev, { who: 'you', text: msg }, { who: 'ai', text: '' }];
        aiIdxRef.current = next.length - 1;
        // the transcript = every non-empty turn EXCEPT the trailing AI placeholder.
        const messages: BrainMessage[] = next
          .slice(0, -1)
          .filter((t) => t.text.trim())
          .map((t) => ({ role: t.who === 'you' ? 'user' : 'assistant', text: t.text }));
        startTurn(messages);
        return next;
      });
      setThinking(true);
    },
    [agentOn, busy, startTurn],
  );

  // A confirmed/declined card doesn't vanish — it collapses into a compact, permanent
  // RECEIPT row that stays in the thread (the card's title + a short status line).
  const pushReceipt = useCallback((c: ActiveCard, line: string, bad = false) => {
    const cost = c.rows.find((r) => r.k === 'Cost')?.v;
    const meta = bad ? line : [cost, line].filter(Boolean).join(' · ');
    setTurns((prev) => [...prev, { who: 'ai', kind: 'receipt', text: c.title, meta, bad }]);
  }, []);

  function onYes() {
    if (!card || card.phase !== 'pending') return;
    const c = card;
    setWorkingLabel(null);
    setCard({ ...c, phase: 'working' });
    void c
      .commit((label) => setWorkingLabel(label)) // live progress on the working card
      .then((ok) => {
        pushReceipt(c, 'done'); // card → permanent receipt
        setCard(null);
        setWorkingLabel(null);
        wsBrainToolResult(c.toolUseId, ok, false);
        setThinking(true); // the model narrates the outcome next
      })
      .catch((e) => {
        const m = (e as Error).message || 'failed';
        pushReceipt(c, `Couldn't complete — ${m}`, true);
        setCard(null);
        setWorkingLabel(null);
        wsBrainToolResult(c.toolUseId, `That failed: ${m}`, true);
        setThinking(true);
      });
  }

  function onNo() {
    if (!card || card.phase !== 'pending') return; // mirror onYes — never double-resolve a tool
    pushReceipt(card, 'Not now', true);
    wsBrainToolResult(card.toolUseId, 'The user declined this action.', true);
    setCard(null);
    setThinking(true); // let the model acknowledge the decline
  }

  const empty = turns.length === 0;

  return (
    <div className="rd-asst rd-glass">
      <div className="rd-asst__head">
        <span className="rd-asst__title">
          <Spark />
          {ASSISTANT.title}
        </span>
      </div>

      <div className="rd-asst__thread" ref={threadRef}>
        {empty ? (
          <div className="rd-asst__empty">
            <p className="rd-asst__emptytitle">What can I handle for you?</p>
            <div className="rd-chips">
              {PROD_CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="rd-chip"
                  onClick={() => send(c)}
                  disabled={!agentOn || busy}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((m, i) =>
          m.kind === 'receipt' ? (
            <div key={i} className={`rd-receipt is-in${m.bad ? ' is-bad' : ''}`}>
              {m.bad ? <span className="rd-receipt__x" aria-hidden>·</span> : <Check size={12} strokeWidth={2.4} aria-hidden />}
              <span className="rd-receipt__title">{m.text}</span>
              {m.meta ? <span className="rd-receipt__meta">{m.meta}</span> : null}
            </div>
          ) : m.who === 'ai' && !m.text ? null : (
            <Row key={i} who={m.who}>
              {rich(m.text)}
            </Row>
          ),
        )}

        {card ? (
          <div className="rd-row rd-row--ai is-in">
            <article className={`rd-confirm rd-glass${card.phase === 'done' ? ' is-done' : ''}`}>
              <div className="rd-confirm__head">
                <Spark />
                {card.title}
              </div>
              <div className="rd-confirm__body">
                {card.subtitle ? <span className="rd-confirm__detail">{card.subtitle}</span> : null}
                {card.rows.map((r) => (
                  <span key={r.k} className="rd-confirm__source">
                    {r.k}: {r.v}
                  </span>
                ))}
              </div>
              {card.phase === 'pending' ? (
                <div className="rd-confirm__acts">
                  <button type="button" className="rd-cta" onClick={onYes} disabled={!agentOn}>
                    {card.cta}
                  </button>
                  <button type="button" className="rd-btn" onClick={onNo}>
                    Not now
                  </button>
                </div>
              ) : null}
              {card.phase === 'working' ? (
                <div className="rd-confirm__done">{workingLabel ? `${workingLabel}…` : 'Working…'}</div>
              ) : null}
              {card.phase === 'done' ? (
                <div className="rd-confirm__done">
                  <Check size={14} strokeWidth={2.2} aria-hidden />
                  Done
                </div>
              ) : null}
              {card.phase === 'error' ? (
                <div className="rd-confirm__done" style={{ display: 'flex', color: 'var(--rd-fg-3)' }}>
                  Couldn’t complete — {card.error}
                </div>
              ) : null}
            </article>
          </div>
        ) : null}

        {thinking ? <LoaderRow label={status} /> : null}
      </div>

      {thinking || card?.phase === 'working' ? (
        <div className="rd-asst__notice" role="status">
          Keep the wallet open — closing it stops what your agent is doing.
        </div>
      ) : null}

      <form
        className="rd-asst__composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={agentOn ? WALLET.composer : WALLET.composerOff}
          disabled={!agentOn || busy}
          aria-label="Message your wallet"
        />
        <button
          type="submit"
          className="rd-composer__send"
          aria-label="Send"
          disabled={!agentOn || busy || !draft.trim()}
        >
          <ArrowUp size={15} strokeWidth={2} aria-hidden />
        </button>
      </form>
    </div>
  );
}
