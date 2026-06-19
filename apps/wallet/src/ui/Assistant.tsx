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
import { useSuiClient, useSignTransaction, useSignPersonalMessage } from '@mysten/dapp-kit';
import { EXPLORER_TX } from '../lib/env';
import { readTraceBuffer, setTraceBuffer, flushAndAnchor, fetchLatestAnchor, restoreFromChain, type TraceEntry } from '../data/trace';

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
  /** the signed-in wallet address — keys the in-session transcript store so the chat
   *  survives switching to the business face and back (the panel unmounts there). */
  ownerAddress?: string;
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
        ownerAddress={props.ownerAddress ?? ''}
      />
    );
  }
  return <LegacyAssistant {...props} />;
}

// In-session transcript store — keeps the chat alive across unmounts (e.g. switching to
// the business console and back, which unmounts the whole wallet panel). Keyed by owner;
// in-memory only (cleared on reload), so no chat history is persisted to disk.
const TRANSCRIPTS = new Map<string, Turn[]>();

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

/** The agentic loader — an EDITORIAL-TERMINAL treatment: a fixed tabular elapsed clock
 *  on the LEFT (gutter-ruled), a mono `>` prompt caret in the family blue, then a
 *  bracketed `[ verb… ]` plate whose verb is read by a single travelling highlight (the
 *  "scanline"). `label` pins a step-specific verb; without one it cycles the generic
 *  thinking verbs. Real model thinking runs under the hood — this is the on-screen
 *  treatment, no raw reasoning shown. (Styling: `.rd-loader*` in rd.css — the brackets
 *  are drawn by `.rd-loader__label`'s ::before/::after; the verb's sweep lives on
 *  `.rd-loader__verb`; the ellipsis dots fill via `.rd-loader__ell`'s ::after.) */
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
        {/* a quiet breathing shell prompt */}
        <span className="rd-loader__spark" aria-hidden="true">
          &gt;
        </span>
        {/* the typed status verb + a blinking block cursor */}
        <span className="rd-loader__label">
          {verb}
          <i className="rd-loader__ell" aria-hidden="true" />
        </span>
      </span>
    </div>
  );
}

// A published Walrus site lives at <base36>.suize.site (served by the deploy-worker).
// Any trailing path must start with `/` — so markdown emphasis the model wraps the URL
// in (`**…**`) can NEVER attach to the URL (it would otherwise become `%2A%2A` in the
// href and 404). Excludes markdown/quote chars from the path for the same reason.
const SITE_URL_RE = /https?:\/\/[a-z0-9-]+\.suize\.site(?:\/[^\s)*\]"'<>`]*)?/i;
const PREV_W = 1024; // the iframe's logical desktop width, scaled down to the chat column
const PREV_H = 640; // 16:10

/** A live, auto-scaled preview of a just-published site — mirrors the Deploy app's
 *  SitePreview (a framed iframe thumbnail) so a publish shows the actual page instead of
 *  a raw overflowing URL. The iframe is decorative (pointer-events off); the card opens
 *  the live site in a new tab. */
function SitePreview({ url, title }: { url: string; title?: string }) {
  const wrap = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(0.32);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / PREV_W);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* keep the raw string */
  }
  return (
    <a className="rd-siteprev is-in" href={url} target="_blank" rel="noopener noreferrer" title={title || host}>
      <span className="rd-siteprev__frame" ref={wrap}>
        {!loaded ? <span className="rd-siteprev__skel" /> : null}
        <iframe
          className={`rd-siteprev__if${loaded ? ' is-on' : ''}`}
          src={url}
          title={title || 'Site preview'}
          loading="lazy"
          tabIndex={-1}
          scrolling="no"
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          style={{ width: PREV_W, height: PREV_H, transform: `scale(${scale})` }}
          onLoad={() => setLoaded(true)}
        />
      </span>
      <span className="rd-siteprev__bar">
        <span className="rd-siteprev__host">{host}</span>
        <span className="rd-siteprev__open">Open ↗</span>
      </span>
    </a>
  );
}

function BrainAssistant({
  agentOn,
  runAgentTool,
  memwalAccountId,
  ownerAddress,
}: {
  agentOn: boolean;
  runAgentTool: AgentToolRunner;
  memwalAccountId?: string;
  ownerAddress: string;
}) {
  // Restore the in-session transcript so switching faces (wallet ↔ business) and back
  // doesn't wipe the chat. (Card/streaming state is transient and intentionally not kept.)
  const [turns, setTurns] = useState<Turn[]>(() => TRANSCRIPTS.get(ownerAddress) ?? []);
  const [thinking, setThinking] = useState(false);
  const [status, setStatus] = useState<string | null>(null); // current loader verb (step-specific)
  const [workingLabel, setWorkingLabel] = useState<string | null>(null); // live progress on a committing card
  const [card, setCard] = useState<ActiveCard | null>(null);
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const aiIdxRef = useRef(-1); // index of the streaming AI turn in `turns`
  const busy = thinking || card != null;

  // ── Verifiable history (trace) — ADDITIVE + non-blocking; never touches the chat
  // or money flow. capture → IndexedDB → Seal-encrypt → Walrus → on-chain anchor.
  // See data/trace.ts. (`as never` bridges the @mysten/seal↔dapp-kit client type — the
  // runtime client is the real one; the mismatch is only the cross-package nominal type.)
  const suiClient = useSuiClient();
  const { mutateAsync: signTx } = useSignTransaction();
  const { mutateAsync: signPM } = useSignPersonalMessage();
  const [traceBadge, setTraceBadge] = useState<{ count: number; digest: string } | null>(null);
  const [traceSaving, setTraceSaving] = useState(false);
  const tracedCountRef = useRef(0);
  const restoredRef = useRef(false);

  // Cold-reload restore from the local buffer + the badge from public chain (no decrypt).
  useEffect(() => {
    if (!ownerAddress) return;
    let alive = true;
    void (async () => {
      if (!restoredRef.current && turns.length === 0) {
        restoredRef.current = true;
        const buf = await readTraceBuffer(ownerAddress);
        const restored: Turn[] = buf
          .filter((e) => (e.text ?? '').trim())
          .map((e) => ({ who: e.role === 'user' ? 'you' : 'ai', text: e.text ?? '' }));
        if (alive && restored.length) setTurns(restored);
      }
      const a = await fetchLatestAnchor(ownerAddress, suiClient as never);
      if (alive && a) {
        setTraceBadge({ count: a.count, digest: a.digest });
        // Auto cross-device restore: the chain is AHEAD of our local buffer (a fresh
        // device or a cleared cache) → silently decrypt the latest blob (the zkLogin
        // session signs the Seal SessionKey — no popup, same path as silent-renew) and
        // rehydrate. Never fires same-device (local == chain), so zero common-case cost.
        // `tracedCountRef` (the flush "what's anchored" guard) is primed ONLY when we are
        // actually in sync — a FAILED restore keeps it at the local count so this device
        // still anchors its own new history instead of going silent.
        const local = await readTraceBuffer(ownerAddress);
        if (a.count > local.length) {
          try {
            const entries = await restoreFromChain({
              owner: ownerAddress,
              anchor: a,
              suiClient: suiClient as never,
              signPersonalMessage: signPM,
            });
            if (alive && entries && entries.length) {
              restoredRef.current = true;
              await setTraceBuffer(ownerAddress, entries);
              tracedCountRef.current = entries.length; // now in sync with the chain
              setTurns(
                entries
                  .filter((e) => (e.text ?? '').trim())
                  .map((e) => ({ who: e.role === 'user' ? 'you' : 'ai', text: e.text ?? '' })),
              );
            } else {
              tracedCountRef.current = local.length; // restore returned nothing → anchor local
            }
          } catch (e) {
            console.warn('[trace] cross-device restore skipped (non-fatal):', (e as Error).message);
            tracedCountRef.current = local.length; // restore failed → keep anchoring local content
          }
        } else {
          tracedCountRef.current = a.count; // local at/ahead of chain — in sync
        }
      }
    })();
    return () => {
      alive = false;
    };
    // once per owner — intentionally not re-running on `turns`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerAddress]);

  // Mirror the transcript into the durable buffer on every SETTLED change (overwrite —
  // idempotent). Skipped while `thinking` so we don't rewrite IndexedDB on every
  // streaming token; the `thinking` dep fires it once when the turn settles.
  useEffect(() => {
    if (!ownerAddress || turns.length === 0 || thinking) return;
    const entries: TraceEntry[] = turns
      .filter((t) => t.text.trim())
      .map((t, seq) => ({
        seq,
        ts: Date.now(),
        kind: 'msg',
        role: t.who === 'you' ? 'user' : 'assistant',
        text: t.text,
      }));
    void setTraceBuffer(ownerAddress, entries);
  }, [ownerAddress, turns, thinking]);

  // Flush + anchor on tab-hide (+ a coarse 2-min backstop). Background, non-fatal.
  useEffect(() => {
    if (!ownerAddress) return;
    let flushing = false;
    const flush = async () => {
      if (flushing) return;
      const buf = await readTraceBuffer(ownerAddress);
      if (buf.length === 0 || buf.length <= tracedCountRef.current) return; // nothing new
      flushing = true;
      setTraceSaving(true);
      try {
        const r = await flushAndAnchor({
          owner: ownerAddress,
          suiClient: suiClient as never,
          signPersonalMessage: signPM,
          signTransaction: signTx,
        });
        if (r) {
          tracedCountRef.current = r.count;
          setTraceBadge({ count: r.count, digest: r.digest });
        }
      } catch (e) {
        console.warn('[trace] flush pending (non-fatal):', (e as Error).message);
      } finally {
        flushing = false;
        setTraceSaving(false);
      }
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onVis);
    const id = window.setInterval(() => void flush(), 120_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerAddress]);

  // Persist the transcript on every change so a remount (after the business switch)
  // rehydrates it; drop the trailing empty AI placeholder so it doesn't restore blank.
  useEffect(() => {
    if (!ownerAddress) return;
    const last = turns[turns.length - 1];
    TRANSCRIPTS.set(ownerAddress, last && last.who === 'ai' && !last.text.trim() ? turns.slice(0, -1) : turns);
  }, [ownerAddress, turns]);

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
        // An auto-approved money action (no card) still leaves a visible ✓ receipt.
        if (run.receipt) {
          const r = run.receipt;
          setTurns((prev) => [...prev, { who: 'ai', kind: 'receipt', text: r.title, meta: r.meta }]);
        }
        wsBrainToolResult(toolUseId, run.content, run.isError ?? false);
        setThinking(true); // keep the loader up while the model reasons about the next step
        return;
      }
      // a money action — show the confirm card and wait for the user's tap. (Keep
      // `thinking` true so the turn stays "active"; the card hides the loader anyway.)
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
          // keep `thinking` true for the whole turn (the loader hides itself once text
          // is streaming, via `awaitingOutput`) so a multi-step turn never goes blank
          setStatus(null);
          appendAi(delta);
        },
        onToolUse: (id, tool, input) => void onToolUse(id, tool, input),
        onDone: (stopReason) => {
          setThinking(false);
          setStatus(null);
          aiIdxRef.current = -1;
          // NEVER vanish into nothing. If the trailing AI bubble is still empty: when the
          // turn was CUT OFF (max_tokens / max_steps) fill it with a recoverable line
          // (belt-and-braces with the backend guard); only a genuine silent SUCCESS
          // (clean end_turn after a card/read) drops the empty bubble.
          setTurns((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.who !== 'ai' || last.text.trim()) return prev;
            if (stopReason === 'max_tokens' || stopReason === 'max_steps') {
              const next = prev.slice();
              next[next.length - 1] = {
                ...last,
                text: 'That got too big to finish in one go — try something a bit simpler, or break it into steps.',
              };
              return next;
            }
            return prev.slice(0, -1);
          });
        },
        onError: (message) => {
          setThinking(false);
          setStatus(null);
          setCard(null); // a mid-turn disconnect must not leave a dead card locking the composer
          setWorkingLabel(null);
          // Surface the error — never swallow it. Fill the empty placeholder if present,
          // else append a fresh line (don't clobber partial narration the user already saw).
          setTurns((prev) => {
            const i = aiIdxRef.current;
            if (i >= 0 && prev[i] && prev[i]!.who === 'ai' && !prev[i]!.text.trim()) {
              const next = prev.slice();
              next[i] = { ...next[i]!, text: message };
              return next;
            }
            return [...prev, { who: 'ai', text: message }];
          });
          aiIdxRef.current = -1;
        },
      }, memwalAccountId);
    },
    [appendAi, onToolUse, memwalAccountId],
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

  // A confirmed/declined card doesn't vanish — it COLLAPSES into a permanent receipt that
  // stays in the thread, placed BEFORE the model's follow-up narration so the order reads
  // "you asked → ✓ here's the record → here's my note" (not an ambiguous receipt AFTER the
  // reply). Drops the empty pre-card placeholder, appends the receipt, then a fresh
  // placeholder the post-action narration streams into (aiIdxRef → that fresh placeholder).
  const collapseToReceipt = useCallback((c: ActiveCard, line: string, bad = false) => {
    const cost = c.rows.find((r) => r.k === 'Cost' || r.k === 'Amount')?.v;
    const meta = bad ? line : [cost, line].filter(Boolean).join(' · ');
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      const base =
        last && last.who === 'ai' && last.kind !== 'receipt' && !last.text.trim() ? prev.slice(0, -1) : prev;
      const next: Turn[] = [...base, { who: 'ai', kind: 'receipt', text: c.title, meta, bad }, { who: 'ai', text: '' }];
      aiIdxRef.current = next.length - 1;
      return next;
    });
  }, []);

  function onYes() {
    if (!card || card.phase !== 'pending') return;
    const c = card;
    setWorkingLabel(null);
    setCard({ ...c, phase: 'working' });
    void c
      .commit((label) => setWorkingLabel(label)) // live progress on the working card
      .then((ok) => {
        collapseToReceipt(c, 'done'); // card → permanent receipt, narration streams below it
        setCard(null);
        setWorkingLabel(null);
        wsBrainToolResult(c.toolUseId, ok, false);
        setThinking(true); // the model narrates the outcome next
      })
      .catch((e) => {
        const m = (e as Error).message || 'failed';
        collapseToReceipt(c, `couldn't complete — ${m}`, true);
        setCard(null);
        setWorkingLabel(null);
        wsBrainToolResult(c.toolUseId, `That failed: ${m}`, true);
        setThinking(true);
      });
  }

  function onNo() {
    if (!card || card.phase !== 'pending') return; // mirror onYes — never double-resolve a tool
    collapseToReceipt(card, 'declined', true);
    wsBrainToolResult(card.toolUseId, 'The user declined this action.', true);
    setCard(null);
    setThinking(true); // let the model acknowledge the decline
  }

  const empty = turns.length === 0;
  // "Are we waiting on the model with nothing yet to show?" — true unless the last thing
  // in the thread is an AI text bubble that already has content. Drives the loader so it
  // shows during EVERY wait (send → first token, between steps, after a confirm → the
  // narration) and hides only while text is actively visible or a card is up.
  const lastTurn = turns[turns.length - 1];
  const awaitingOutput =
    !lastTurn || lastTurn.who !== 'ai' || lastTurn.kind === 'receipt' || !lastTurn.text.trim();
  const showLoader = thinking && !card && awaitingOutput;

  return (
    <div className="rd-asst rd-glass">
      <div className="rd-asst__head">
        <span className="rd-asst__title">
          <Spark />
          {ASSISTANT.title}
        </span>
        {traceSaving ? (
          <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.5, whiteSpace: 'nowrap' }}>saving…</span>
        ) : traceBadge ? (
          <a
            href={EXPLORER_TX(traceBadge.digest)}
            target="_blank"
            rel="noreferrer"
            title="Encrypted on chain — only you can read it. Tap for the on-chain receipt."
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              opacity: 0.65,
              textDecoration: 'none',
              color: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            <Check size={11} strokeWidth={2.6} aria-hidden /> {traceBadge.count} · anchored ↗
          </a>
        ) : null}
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

        {turns.map((m, i) => {
          if (m.kind === 'receipt') {
            return (
              <div key={i} className={`rd-receipt is-in${m.bad ? ' is-bad' : ''}`}>
                {m.bad ? <span className="rd-receipt__x" aria-hidden>·</span> : <Check size={12} strokeWidth={2.4} aria-hidden />}
                <span className="rd-receipt__title">{m.text}</span>
                {m.meta ? <span className="rd-receipt__meta">{m.meta}</span> : null}
              </div>
            );
          }
          if (m.who === 'ai' && !m.text) return null;
          // A just-published site URL → render a LIVE PREVIEW card (like the Deploy app),
          // not a raw overflowing link. The prose around it still renders above.
          const site = m.who === 'ai' ? m.text.match(SITE_URL_RE) : null;
          if (site) {
            const url = site[0];
            // Strip the URL AND the markdown emphasis / punctuation the model wrapped it
            // in (`**`, backticks, `<>`, `()`, dashes, colons) so the prose doesn't show
            // orphaned `**` once the link is lifted into the preview card.
            const before = m.text.slice(0, site.index).replace(/[\s:—–*`<([-]+$/, '').trim();
            const after = m.text
              .slice((site.index ?? 0) + url.length)
              .replace(/^[\s*`>)\].,:—–-]+/, '')
              .trim();
            const prose = [before, after].filter(Boolean).join('\n\n');
            return (
              <div key={i} style={{ display: 'contents' }}>
                {prose ? <Row who="ai">{rich(prose)}</Row> : null}
                <SitePreview url={url} />
              </div>
            );
          }
          return (
            <Row key={i} who={m.who}>
              {rich(m.text)}
            </Row>
          );
        })}

        {card ? (
          <div className="rd-row rd-row--ai is-in">
            <article className={`rd-confirm rd-glass${card.phase === 'done' ? ' is-done' : ''}`}>
              <div className="rd-confirm__head">
                <Spark />
                {card.title}
              </div>
              <div className="rd-confirm__body">
                {card.subtitle ? <span className="rd-confirm__detail">{card.subtitle}</span> : null}
                <div className="rd-confirm__rows">
                  {card.rows.map((r) => (
                    <div key={r.k} className="rd-confirm__row">
                      <span className="rd-confirm__rowk">{r.k}</span>
                      <span className="rd-confirm__rowv">{r.v}</span>
                    </div>
                  ))}
                </div>
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

        {showLoader ? <LoaderRow label={status} /> : null}
      </div>

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

      {/* persistent one-line footer under the composer — the agent's work lives in this
          tab (no durable store), so closing it stops the in-flight turn. */}
      <p className="rd-asst__notice">Keep the wallet open — closing it stops what your agent is doing.</p>
    </div>
  );
}
