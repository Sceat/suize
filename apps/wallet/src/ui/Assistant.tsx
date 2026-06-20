/**
 * THE ASSISTANT PANEL. The chat is SECONDARY by owner law: the wallet's money
 * surfaces own the page; this panel docks beside them (a right glass column).
 * The agent on/off control is the SINGLE Pause/Resume button on the agent card
 * (the deck) — NOT a duplicate switch here. This panel only READS `agentOn`
 * (to quiet the composer when the agent is paused).
 *
 * The panel runs the REAL brain chat over the WS: the user types, the brain
 * streams narration and proposes tools, and the WALLET runs each tool locally
 * (reads answer instantly; writes surface an inline confirm card the user signs).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, ExternalLink, Plus, X, Brain, Sparkles, Lock, ChevronDown, ICON_STROKE } from '../system';
import {
  listChats,
  loadChat,
  saveChat,
  deleteChat,
  newChatId,
  getActiveChatId,
  setActiveChatId,
  type ChatMeta,
  type ChatTurn,
} from '../data/conversations';
import { WALLET } from './copy';
import { Row, Spark, rich } from './bits';
import { wsBrainChat, wsBrainToolResult } from '../data/ws';
import type { AgentToolRunner, ToolRun } from '../data/agentTools';
import type { BrainMessage } from '@suize/shared/protocol';
import { useSuiClient, useSignTransaction, useSignPersonalMessage } from '@mysten/dapp-kit';
import { EXPLORER_TX, WALRUS_BLOB } from '../lib/env';
import { readTraceBuffer, setTraceBuffer, flushAndAnchor, fetchLatestAnchor, restoreFromChain, type TraceEntry } from '../data/trace';

export interface AssistantPanelProps {
  /** READ-ONLY here — the Pause/Resume control lives on the agent card. Quiets the
   *  composer when the agent is paused. */
  agentOn: boolean;
  /** the wallet's agent tool runner (reads + write-confirm plans) — drives the real
   *  brain chat: the user types, the brain proposes tools, the WALLET runs each one. */
  runAgentTool: AgentToolRunner;
  /** the user's MemWal memory account id (if onboarded) — sent with each turn so the
   *  brain recalls/stores memory under it. Undefined = no memory this session. */
  memwalAccountId?: string;
  /** the signed-in wallet address — keys the in-session transcript store so the chat
   *  survives switching to the business face and back (the panel unmounts there). */
  ownerAddress?: string;
}

export function AssistantPanel(props: AssistantPanelProps) {
  return (
    <BrainAssistant
      agentOn={props.agentOn}
      runAgentTool={props.runAgentTool}
      memwalAccountId={props.memwalAccountId}
      ownerAddress={props.ownerAddress ?? ''}
    />
  );
}

// In-session transcript store — keeps the chat alive across unmounts (e.g. switching to
// the business console and back, which unmounts the whole wallet panel). Keyed by owner;
// in-memory only (cleared on reload), so no chat history is persisted to disk.
const TRANSCRIPTS = new Map<string, Turn[]>();

// ─────────────────────────────────────────────────────────────────────────────
// THE COMPOSER COCKPIT — the toolbar under the input (model · context · memory),
// shared by both assistants. The wallet's brain is Claude Haiku today (fast,
// included); stronger models are teased as "Soon" — when they land they bill live
// to the agent's USDC balance over x402, so the picker shows the roadmap, no price.
// ─────────────────────────────────────────────────────────────────────────────
const MODELS: { id: string; name: string; tag: string; active?: boolean }[] = [
  { id: 'haiku', name: 'Claude Haiku', tag: 'Fast · always on', active: true },
  { id: 'opus', name: 'Claude Opus', tag: 'Deepest reasoning' },
  { id: 'fable', name: 'Claude Fable', tag: 'Creative & precise' },
  { id: 'gpt', name: 'GPT-5.5', tag: 'OpenAI frontier' },
  { id: 'glm', name: 'GLM-5.2', tag: 'Open weights' },
];

/** The active model's REAL context window. Claude Haiku 4.5 = 200K tokens (NOT 1M — that's
 *  the premium models). Server-side compaction isn't available on Haiku, so the meter is the
 *  honest fill-then-drop signal and the tooltip says so. */
const CTX_WINDOW = 200_000;

/** Compact token count for the meter/tooltip: 850 → "850", 1234 → "1.2K", 200000 → "200K". */
const fmtTokens = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(Math.max(0, Math.round(n)));

/** The model chip + a glass popover. Only Haiku is selectable today; the rest read
 *  "Soon" (they'll bill from the agent's USDC balance over x402). */
function ModelMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="rd-mdl">
      <button
        type="button"
        className={`rd-mdl__chip${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Sparkles size={13} strokeWidth={ICON_STROKE} aria-hidden />
        <span className="rd-mdl__chipname">Claude Haiku</span>
        <ChevronDown size={12} strokeWidth={2.2} aria-hidden className="rd-mdl__chev" />
      </button>
      {open ? (
        <>
          <span className="rd-mdl__scrim" onClick={() => setOpen(false)} aria-hidden />
          <div className="rd-mdl__pop rd-glass" role="menu">
            <div className="rd-mdl__poptitle">Model</div>
            <div className="rd-mdl__list">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`rd-mdl__opt${m.active ? ' is-active' : ''}`}
                  role="menuitemradio"
                  aria-checked={!!m.active}
                  disabled={!m.active}
                >
                  <span className="rd-mdl__mark">
                    {m.active ? (
                      <Sparkles size={14} strokeWidth={ICON_STROKE} aria-hidden />
                    ) : (
                      <Lock size={13} strokeWidth={ICON_STROKE} aria-hidden />
                    )}
                  </span>
                  <span className="rd-mdl__optbody">
                    <span className="rd-mdl__optname">{m.name}</span>
                    <span className="rd-mdl__opttag">{m.tag}</span>
                  </span>
                  <span className={`rd-mdl__badge${m.active ? ' is-free' : ''}`}>{m.active ? 'Free' : 'Soon'}</span>
                </button>
              ))}
            </div>
            <p className="rd-mdl__note">Stronger models are paid live from your agent’s USDC balance over x402.</p>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The REAL context-window meter: a ring + a glass hover popup. `tokens`/`window` come
 *  from the SDK's `usage` (the live count, not an estimate). Haiku can't compact, so the
 *  tooltip says so — as it fills, the oldest messages drop. */
function ContextMeter({ tokens, window }: { tokens: number; window: number }) {
  const pct = Math.max(0, Math.min(100, (tokens / window) * 100));
  const r = 6;
  const circ = 2 * Math.PI * r;
  const filled = pct / 100;
  return (
    <span className="rd-ctx" tabIndex={0} aria-label={`Context window: ${fmtTokens(tokens)} of ${fmtTokens(window)} tokens`}>
      <svg className="rd-ctx__ring" width="15" height="15" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r={r} className="rd-ctx__track" />
        <circle
          cx="8"
          cy="8"
          r={r}
          className="rd-ctx__fill"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - filled)}
          transform="rotate(-90 8 8)"
        />
      </svg>
      <span className="rd-ctx__pct">{pct.toFixed(1)}%</span>
      <span className="rd-ctx__pop rd-glass" role="tooltip">
        <span className="rd-ctx__poptitle">Context window</span>
        <span className="rd-ctx__popbody">
          <strong>{fmtTokens(tokens)}</strong> of {fmtTokens(window)} tokens in play — how much of this conversation the
          AI is holding at once. Compaction isn’t available on this model, so the oldest messages drop as it fills.
        </span>
      </span>
    </span>
  );
}

/** The memory switch + a glass hover popup. On by default (MemWal); click → ephemeral. */
function MemoryToggle({ on, available, onToggle }: { on: boolean; available: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`rd-mem${on ? ' is-on' : ''}`} onClick={onToggle} disabled={!available} aria-pressed={on}>
      <Brain size={14} strokeWidth={ICON_STROKE} aria-hidden />
      <span className="rd-mem__label">{on ? 'Memory' : 'Ephemeral'}</span>
      <span className="rd-mem__pop rd-glass" role="tooltip">
        {!available
          ? 'Memory isn’t set up for this session.'
          : on
            ? 'Memory is on by default, provided by MemWal. Click to disable and enter ephemeral mode.'
            : 'Ephemeral mode — nothing is remembered. Click to turn memory back on.'}
      </span>
    </button>
  );
}

/** The toolbar under the composer input: model · context · memory. */
function ComposerBar({
  ctxTokens,
  ctxWindow,
  memoryOn,
  memoryAvailable,
  onToggleMemory,
}: {
  ctxTokens: number;
  ctxWindow: number;
  memoryOn: boolean;
  memoryAvailable: boolean;
  onToggleMemory: () => void;
}) {
  return (
    <div className="rd-composer__bar">
      <ModelMenu />
      <span className="rd-composer__spacer" />
      <ContextMeter tokens={ctxTokens} window={ctxWindow} />
      <span className="rd-composer__div" aria-hidden />
      <MemoryToggle on={memoryOn} available={memoryAvailable} onToggle={onToggleMemory} />
    </div>
  );
}

/** "Thought for Xs" — the quiet collapsed thinking marker above an answer. */
function ThoughtMark({ sec }: { sec: number }) {
  return (
    <div className="rd-thought" aria-hidden>
      <Sparkles size={11} strokeWidth={ICON_STROKE} />
      {sec >= 1 ? `Thought for ${sec}s` : 'Thought for a moment'}
    </div>
  );
}

/** Compact relative time for the history list. */
function relTime(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

/** THE CHAT HISTORY RAIL — a glass sticky column (top-left of the wide chat): a "New chat"
 *  button over the list of saved conversations (IndexedDB-backed; the active one also
 *  anchors to Walrus via the trace path). Click to switch, the × to forget. */
function ChatHistory({
  chats,
  activeId,
  onNew,
  onSwitch,
  onDelete,
}: {
  chats: ChatMeta[];
  activeId: string;
  onNew: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  // ONE floating glass card pinned top-left of the chat: the recent-chats list with a
  // "New chat" line at the bottom of the SAME card (never a full panel/column).
  return (
    <div className="rd-hist rd-glass">
      <div className="rd-hist__list">
        {chats.length === 0 ? (
          <p className="rd-hist__empty">Your chats are saved here.</p>
        ) : (
          chats.map((c) => (
            <div key={c.id} className={`rd-hist__item${c.id === activeId ? ' is-active' : ''}`}>
              <button type="button" className="rd-hist__pick" onClick={() => onSwitch(c.id)} title={c.title}>
                <span className="rd-hist__title">{c.title}</span>
                <span className="rd-hist__when">{relTime(c.updatedAt)}</span>
              </button>
              <button type="button" className="rd-hist__del" onClick={() => onDelete(c.id)} aria-label="Forget this chat">
                <X size={12} strokeWidth={2} aria-hidden />
              </button>
            </div>
          ))
        )}
      </div>
      <button type="button" className="rd-hist__new" onClick={onNew} title="Start a new chat">
        <Plus size={13} strokeWidth={2.4} aria-hidden />
        New chat
      </button>
    </div>
  );
}

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
type Turn = { who: 'you' | 'ai'; text: string; kind?: 'receipt'; meta?: string; bad?: boolean; digest?: string; thoughtSec?: number };

/** Reconstruct a thread Turn from a persisted trace entry — a RECEIPT keeps its kind + meta +
 *  explorer digest so it survives a reload as a receipt card, not a plain chat bubble. */
function entryToTurn(e: TraceEntry): Turn {
  if (e.kind === 'receipt') {
    return { who: 'ai', kind: 'receipt', text: e.text ?? '', meta: e.meta, bad: e.bad, digest: e.txDigest };
  }
  return { who: e.role === 'user' ? 'you' : 'ai', text: e.text ?? '' };
}

type CardPhase = 'pending' | 'working' | 'done' | 'error';
interface ActiveCard {
  toolUseId: string;
  title: string;
  subtitle?: string;
  rows: { k: string; v: string }[];
  cta: string;
  commit: (onStep?: (label: string) => void) => Promise<{ message: string; digest?: string }>;
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

/** The thinking line — LEAN, ChatGPT-style: a single verb read by a monochrome shimmer
 *  sweeping the word, with a quiet elapsed counter that joins after ~2s. `label` pins a
 *  step-specific verb (e.g. "Checking your balance"); without one it cycles the generic
 *  thinking verbs. Real model thinking runs under the hood — no raw reasoning shown; when
 *  the turn answers, this collapses to a "Thought for Xs" mark (ThoughtMark) above it.
 *  (Styling: `.rd-think*` in rd.css — the shimmer lives on `.rd-think__verb`.) */
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
  // Lean, ChatGPT-style: a single shimmering verb (a step verb when pinned, else the
  // rotating thinking verbs). A quiet elapsed counter joins after a couple seconds.
  const verb = label ?? THINKING_VERBS[Math.floor(tick / 3) % THINKING_VERBS.length]!;
  return (
    <div className="rd-row rd-row--ai is-in">
      <span className="rd-think" aria-live="polite" aria-label={`${verb}…`}>
        <span className="rd-think__verb">{verb}</span>
        {elapsed >= 2 ? <span className="rd-think__t">{elapsed}s</span> : null}
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
  const [ephemeral, setEphemeral] = useState(false); // memory OFF for this session
  // Multi-conversation history (IndexedDB archive; the active one also rides the Walrus trace).
  const [chatId, setChatId] = useState<string>(() => getActiveChatId(ownerAddress) || newChatId());
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [contextTokens, setContextTokens] = useState(0); // live context size from the SDK usage
  const threadRef = useRef<HTMLDivElement>(null);
  const aiIdxRef = useRef(-1); // index of the streaming AI turn in `turns`
  const thinkStartRef = useRef(0); // when the current model wait began → "Thought for Xs"
  const busy = thinking || card != null;

  // Memory is on by default when MemWal is set up; the user can drop to ephemeral mode
  // (no memory id sent → the brain neither recalls nor stores this session).
  const memoryAvailable = Boolean(memwalAccountId);
  const memoryOn = memoryAvailable && !ephemeral;
  const effectiveMemwal = ephemeral ? undefined : memwalAccountId;
  // The REAL context size comes from the SDK's `usage`, reported on each turn's done frame.
  // Until the first turn lands (or for a freshly-loaded conversation), fall back to a
  // chars→tokens (÷4) estimate so the meter is never dead.
  const ctxTokensShown = useMemo(() => {
    if (contextTokens > 0) return contextTokens;
    return Math.round(turns.reduce((n, t) => n + (t.text?.length ?? 0), 0) / 4);
  }, [contextTokens, turns]);

  // ── Verifiable history (trace) — ADDITIVE + non-blocking; never touches the chat
  // or money flow. capture → IndexedDB → Seal-encrypt → Walrus → on-chain anchor.
  // See data/trace.ts. (`as never` bridges the @mysten/seal↔dapp-kit client type — the
  // runtime client is the real one; the mismatch is only the cross-package nominal type.)
  const suiClient = useSuiClient();
  const { mutateAsync: signTx } = useSignTransaction();
  const { mutateAsync: signPM } = useSignPersonalMessage();
  const [traceBadge, setTraceBadge] = useState<{ count: number; digest: string; blobId: string } | null>(null);
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
          .map(entryToTurn);
        if (alive && restored.length) setTurns(restored);
      }
      const a = await fetchLatestAnchor(ownerAddress, suiClient as never);
      if (alive && a) {
        setTraceBadge({ count: a.count, digest: a.digest, blobId: a.blobId });
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
              setTurns(entries.filter((e) => (e.text ?? '').trim()).map(entryToTurn));
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
      .map((t, seq) =>
        t.kind === 'receipt'
          ? {
              seq,
              ts: Date.now(),
              kind: 'receipt' as const,
              role: 'assistant' as const,
              text: t.text,
              meta: t.meta,
              bad: t.bad,
              txDigest: t.digest,
            }
          : {
              seq,
              ts: Date.now(),
              kind: 'msg' as const,
              role: t.who === 'you' ? 'user' : 'assistant',
              text: t.text,
            },
      );
    void setTraceBuffer(ownerAddress, entries);
  }, [ownerAddress, turns, thinking]);

  // Flush + anchor the encrypted transcript to Walrus. Background, non-fatal, idempotent
  // (only writes when there's NEW content past what's already anchored).
  const flushingRef = useRef(false);
  const anchorNow = useCallback(async () => {
    if (!ownerAddress || flushingRef.current) return;
    const buf = await readTraceBuffer(ownerAddress);
    if (buf.length === 0 || buf.length <= tracedCountRef.current) return; // nothing new
    flushingRef.current = true;
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
        setTraceBadge({ count: r.count, digest: r.digest, blobId: r.blobId });
      }
    } catch (e) {
      console.warn('[trace] flush pending (non-fatal):', (e as Error).message);
    } finally {
      flushingRef.current = false;
      setTraceSaving(false);
    }
  }, [ownerAddress, suiClient, signPM, signTx]);

  // Anchor triggers: on tab-hide + a coarse 2-min backstop.
  useEffect(() => {
    if (!ownerAddress) return;
    const onVis = () => {
      if (document.visibilityState === 'hidden') void anchorNow();
    };
    document.addEventListener('visibilitychange', onVis);
    const id = window.setInterval(() => void anchorNow(), 120_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(id);
    };
  }, [ownerAddress, anchorNow]);

  // …AND ~16s after a turn settles, so the "anchored ↗" badge appears DURING a session,
  // not only when the user leaves. Debounced — a new message resets the timer.
  useEffect(() => {
    if (!ownerAddress || thinking || turns.length === 0) return;
    const t = window.setTimeout(() => void anchorNow(), 16_000);
    return () => window.clearTimeout(t);
  }, [ownerAddress, thinking, turns, anchorNow]);

  // Persist the transcript on every change so a remount (after the business switch)
  // rehydrates it; drop the trailing empty AI placeholder so it doesn't restore blank.
  useEffect(() => {
    if (!ownerAddress) return;
    const last = turns[turns.length - 1];
    TRANSCRIPTS.set(ownerAddress, last && last.who === 'ai' && !last.text.trim() ? turns.slice(0, -1) : turns);
  }, [ownerAddress, turns]);

  // Load the conversation list + pin the active-chat pointer (the history-rail source).
  useEffect(() => {
    if (!ownerAddress) return;
    setActiveChatId(ownerAddress, chatId);
    void listChats(ownerAddress).then(setChats);
    // once per owner — new/switch refresh the list themselves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerAddress]);

  // Archive the active conversation to IndexedDB on every SETTLED change (idempotent) and
  // refresh the list so titles/order stay current. Skipped while streaming.
  useEffect(() => {
    if (!ownerAddress || thinking) return;
    void saveChat(ownerAddress, chatId, turns as ChatTurn[]).then(() => listChats(ownerAddress).then(setChats));
  }, [ownerAddress, chatId, turns, thinking]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, thinking, card]);

  const appendAi = useCallback((delta: string) => {
    setTurns((prev) => {
      const i = aiIdxRef.current;
      if (i < 0 || !prev[i]) return prev;
      const next = prev.slice();
      const cur = next[i]!;
      // The first token of this segment closes the "thinking" beat → stamp its duration.
      const firstToken = !cur.text && cur.thoughtSec == null;
      next[i] = {
        ...cur,
        text: cur.text + delta,
        thoughtSec: firstToken ? Math.max(0, Math.round((Date.now() - thinkStartRef.current) / 1000)) : cur.thoughtSec,
      };
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
          setTurns((prev) => [...prev, { who: 'ai', kind: 'receipt', text: r.title, meta: r.meta, digest: r.digest }]);
        }
        wsBrainToolResult(toolUseId, run.content, run.isError ?? false);
        thinkStartRef.current = Date.now();
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
        onDone: (stopReason, _limited, ctxTokens) => {
          setThinking(false);
          setStatus(null);
          if (ctxTokens != null && ctxTokens > 0) setContextTokens(ctxTokens); // live token meter
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
      }, effectiveMemwal);
    },
    [appendAi, onToolUse, effectiveMemwal],
  );

  const send = useCallback(
    (text: string) => {
      const msg = text.trim();
      if (!msg || !agentOn || busy) return;
      setDraft('');
      thinkStartRef.current = Date.now();
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

  // ── history controls (new / switch / forget) ──
  const newChat = useCallback(() => {
    setCard(null);
    setThinking(false);
    setStatus(null);
    const id = newChatId();
    setChatId(id);
    setActiveChatId(ownerAddress, id);
    setTurns([]);
    TRANSCRIPTS.set(ownerAddress, []);
    void setTraceBuffer(ownerAddress, []); // fresh Walrus base for the new conversation
  }, [ownerAddress]);

  const switchChat = useCallback(
    (id: string) => {
      if (id === chatId) return;
      setCard(null);
      setThinking(false);
      setStatus(null);
      setChatId(id);
      setActiveChatId(ownerAddress, id);
      void loadChat(ownerAddress, id).then((t) => {
        const ts = t as Turn[];
        setTurns(ts);
        TRANSCRIPTS.set(ownerAddress, ts);
      });
    },
    [ownerAddress, chatId],
  );

  const removeChat = useCallback(
    (id: string) => {
      void deleteChat(ownerAddress, id).then(() => listChats(ownerAddress).then(setChats));
      if (id === chatId) newChat(); // forgetting the active one → start fresh
    },
    [ownerAddress, chatId, newChat],
  );

  // A confirmed/declined card doesn't vanish — it COLLAPSES into a permanent receipt that
  // stays in the thread, placed BEFORE the model's follow-up narration so the order reads
  // "you asked → ✓ here's the record → here's my note" (not an ambiguous receipt AFTER the
  // reply). Drops the empty pre-card placeholder, appends the receipt, then a fresh
  // placeholder the post-action narration streams into (aiIdxRef → that fresh placeholder).
  const collapseToReceipt = useCallback((c: ActiveCard, line: string, bad = false, digest?: string) => {
    const cost = c.rows.find((r) => r.k === 'Cost' || r.k === 'Amount')?.v;
    const meta = bad ? line : [cost, line].filter(Boolean).join(' · ');
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      const base =
        last && last.who === 'ai' && last.kind !== 'receipt' && !last.text.trim() ? prev.slice(0, -1) : prev;
      const next: Turn[] = [...base, { who: 'ai', kind: 'receipt', text: c.title, meta, bad, digest }, { who: 'ai', text: '' }];
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
      .then((res) => {
        collapseToReceipt(c, 'done', false, res.digest); // card → permanent receipt + explorer link
        setCard(null);
        setWorkingLabel(null);
        wsBrainToolResult(c.toolUseId, res.message, false);
        thinkStartRef.current = Date.now();
        setThinking(true); // the model narrates the outcome next
      })
      .catch((e) => {
        const m = (e as Error).message || 'failed';
        collapseToReceipt(c, `couldn't complete — ${m}`, true);
        setCard(null);
        setWorkingLabel(null);
        wsBrainToolResult(c.toolUseId, `That failed: ${m}`, true);
        thinkStartRef.current = Date.now();
        setThinking(true);
      });
  }

  function onNo() {
    if (!card || card.phase !== 'pending') return; // mirror onYes — never double-resolve a tool
    collapseToReceipt(card, 'declined', true);
    wsBrainToolResult(card.toolUseId, 'The user declined this action.', true);
    setCard(null);
    thinkStartRef.current = Date.now();
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
    <div className="rd-asst rd-asst--chat rd-glass">
      <ChatHistory chats={chats} activeId={chatId} onNew={newChat} onSwitch={switchChat} onDelete={removeChat} />
      {traceSaving ? (
        <span className="rd-asst__trace" style={{ opacity: 0.6 }}>saving…</span>
      ) : traceBadge ? (
        <a
          className="rd-asst__trace"
          href={WALRUS_BLOB(traceBadge.blobId)}
          target="_blank"
          rel="noreferrer"
          title="Your chat, encrypted and stored on Walrus — only you can read it. Tap to view the blob."
        >
          <Check size={11} strokeWidth={2.6} aria-hidden /> {traceBadge.count} · on Walrus ↗
        </a>
      ) : null}

      <div className="rd-asst__thread" ref={threadRef}>
        <div className="rd-asst__convo">
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
                <span className="rd-receipt__icon" aria-hidden>
                  {m.bad ? <X size={12} strokeWidth={2.6} /> : <Check size={12} strokeWidth={2.8} />}
                </span>
                <span className="rd-receipt__body">
                  <span className="rd-receipt__title">{m.text}</span>
                  {m.meta ? <span className="rd-receipt__meta">{m.meta}</span> : null}
                </span>
                {m.digest ? (
                  <a
                    className="rd-receipt__link"
                    href={EXPLORER_TX(m.digest)}
                    target="_blank"
                    rel="noreferrer"
                    title="View this transaction on the explorer"
                  >
                    Explorer
                    <ExternalLink size={11} strokeWidth={2.2} aria-hidden />
                  </a>
                ) : null}
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
                {m.thoughtSec != null ? <ThoughtMark sec={m.thoughtSec} /> : null}
                {prose ? <Row who="ai">{rich(prose)}</Row> : null}
                <SitePreview url={url} />
              </div>
            );
          }
          return (
            <div key={i} style={{ display: 'contents' }}>
              {m.who === 'ai' && m.thoughtSec != null ? <ThoughtMark sec={m.thoughtSec} /> : null}
              <Row who={m.who}>{rich(m.text)}</Row>
            </div>
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
      </div>

      <form
        className="rd-asst__composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <div className="rd-composer__top">
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
        </div>
        <ComposerBar
          ctxTokens={ctxTokensShown}
          ctxWindow={CTX_WINDOW}
          memoryOn={memoryOn}
          memoryAvailable={memoryAvailable}
          onToggleMemory={() => setEphemeral((e) => !e)}
        />
      </form>

      {/* persistent one-line footer under the composer — the agent's work lives in this
          tab (no durable store), so closing it stops the in-flight turn. */}
      <p className="rd-asst__notice">Keep the wallet open — closing it stops what your agent is doing.</p>
    </div>
  );
}
