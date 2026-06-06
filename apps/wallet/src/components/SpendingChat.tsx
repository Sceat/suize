/**
 * SpendingChat — §03 of THE JOURNAL: the in-app SPENDING AI chat.
 *
 * Ported 1:1 from /tmp/suize-designs/journal.html (.detail#chatDetail → .chat):
 * a scrolling message log (seeded with the mockup's verbatim transcript), a
 * typing indicator, and an input row. The CSS lives in src/system/tokens-journal.css
 * (.chat / .msg / .dots / .chat__input), scoped under `.journal`.
 *
 * ── WHAT THE SHELL OWNS vs THIS LEAF ───────────────────────────────────────────
 * This is the AI SPENDING sub account's DETAIL — rendered into the right pane when
 * the Spending card is selected. The shell renders the pane head + `.rule`; this
 * leaf renders the `.detail#chatDetail` wrapper + the `.chat` (log + form). It owns
 * its own `.chat__log` scroll (the desktop CSS makes `.chat__log` the scroll surface
 * and pins `.chat__input`). AI Spending holds ONLY USDC — reflected on the input row.
 *
 * ── CONFIRM CARDS (founder rework) ─────────────────────────────────────────────
 * A send is NEVER auto-executed. When a clear "send/pay <amount> to <name>" parses,
 * we append an AI ACTION CARD (.chatcard) in a 'pending' state — the PTB is shown,
 * not run. The user CLICKS Confirm to fire the REAL plumbing: `resolveRecipient`
 * (SuiNS/hex) + `home.send` (a real sponsored MAIN→recipient transfer). The card
 * walks 'pending' → 'sending' → 'sent' (collapses to one check + summary line) or
 * 'failed' (retry); Cancel dismisses it.
 * This makes every send an explicit, visible click-to-confirm-the-PTB step.
 *
 * ── REAL vs STUB (sanctioned) ──────────────────────────────────────────────────
 * The chat UI is REAL (log, input, typing dots, auto-scroll, confirm cards). The
 * NATURAL-LANGUAGE parsing is the sanctioned stub (there is no client→server chat
 * frame; the agent backend is a documented stub). A clear send routes through the
 * REAL path on Confirm; a non-send prompt keeps the mockup's scripted reply verbatim
 * — never claiming an on-chain action that did not happen.
 *
 * 🚩 STUB: the fallback replies (and the seed transcript) are scripted local state.
 * The inbound `onLivechatMessage` slice (home.state.chat) is dormant today; this leaf
 * shows the local transcript and never fabricates a number that lands in a tx.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import type { HomeApi } from '../data/types';
import { resolveRecipient } from '../data/suins';
import { USDC } from '../data/coins';
import { SUIVISION_TX } from '../lib/env';
import { ArrowUpRight, RefreshCw, Check, ICON_STROKE } from '../system';

export interface SpendingChatProps {
  /** the data hook — used for the REAL "send X to Y" path (home.send). */
  home: HomeApi;
  /**
   * DEV-ONLY design preview flag. `true` ONLY under `?preview` → seed the populated
   * sample transcript (incl. the example confirm cards). `false` in production → start
   * with a single non-transactional welcome line — NO fabricated 'sent' card, NO dead
   * digest. The live send → confirm-card flow is fully real either way.
   */
  demo: boolean;
}

// ── action-card model ───────────────────────────────────────────────────────────
// A confirm card is a row the founder clicks to run (or cancel) the real PTB. It
// walks: 'pending' (awaiting click) → 'sending' (home.send in flight) → 'sent' (✓)
// or 'failed' (retry available). 'sent' is also the seed's past-example state.
type ActionStatus = 'pending' | 'sending' | 'sent' | 'failed';
interface SendAction {
  kind: 'send';
  amount: number;
  name: string;
  status: ActionStatus;
  /** The executed tx digest — set on 'sent'; powers the "View on SuiVision" link. */
  digest?: string;
}

// ── message model (component-local; mirrors the mockup's DOM rows) ──────────────
// AI bodies carry rich inline markup (bold amount/handle spans + a "good" Done span),
// so we render them as structured React nodes rather than raw HTML — the same visual
// the mockup produces with innerHTML, but without dangerouslySetInnerHTML. An AI row
// can ALSO be an action card (carries `action`, no `body`) — the click-to-confirm PTB.
type Row =
  | { id: string; who: 'me'; body: string }
  | { id: string; who: 'ai'; body: ReactNode; typing?: false; action?: undefined }
  | { id: string; who: 'ai'; typing: true; body?: undefined; action?: undefined }
  | { id: string; who: 'ai'; action: SendAction; body?: undefined; typing?: false };

// ── the seed transcript — DEV ?preview hatch ONLY (demo true). It SHOWS the confirm-
// card feature: "send 50 to alice" → a past send card already in 'sent' state (the ✓
// example, with a SAMPLE digest), and "pay my rent" → a LIVE 'pending' card (amount
// 900, landlord) the founder clicks to walk confirm → sending → sent. NEVER shown to
// a real user — the sample 'sent' card + its digest would be fabricated activity.
const SEED_ROWS: Row[] = [
  { id: 'seed-0', who: 'me', body: 'send 50 to alice' },
  {
    id: 'seed-1',
    who: 'ai',
    // A representative sample digest so the "View on SuiVision" link is visible in
    // preview — demo seed content, not a real on-chain tx.
    action: {
      kind: 'send',
      amount: 50,
      name: 'alice',
      status: 'sent',
      digest: '7gqPJ8nF2vQ4xkZ3mWpR6sT1uY9bC5dH8eA2fN4jL7K',
    },
  },
  { id: 'seed-2', who: 'me', body: 'pay my rent' },
  {
    id: 'seed-3',
    who: 'ai',
    action: { kind: 'send', amount: 900, name: 'landlord', status: 'pending' },
  },
];

// ── the production opener — a single NON-TRANSACTIONAL welcome line. No fabricated
// activity, no card, no digest: it only invites the first real send. Shown when
// demo is false (every real user). ──────────────────────────────────────────────
const WELCOME_ROWS: Row[] = [
  {
    id: 'welcome',
    who: 'ai',
    body: 'Hi — I can send or pay from your AI Spending money. Tell me an amount and who to pay.',
  },
];

/** Money formatter matching the mockup's `fmt(n, 2)`. */
function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Parse a CLEAR "send/pay/transfer <amount> to <name>" prompt — the only intent we
 * upgrade to a REAL transfer. Mirrors the mockup's regex (amount = first number,
 * recipient = the word after "to") but requires BOTH an amount and an explicit
 * "to <name>" to qualify; anything looser stays a scripted stub reply.
 */
function parseSend(text: string): { amount: number; name: string } | null {
  if (!/send|pay|transfer/i.test(text)) return null;
  const amountMatch = text.match(/(\d+(?:\.\d+)?)/);
  const toMatch = text.match(/to\s+([a-zA-Z0-9_.-]+)/i);
  if (!amountMatch || !toMatch) return null;
  const amount = parseFloat(amountMatch[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, name: toMatch[1] };
}

/** The mockup's scripted fallback reply for non-send prompts — the sanctioned stub. */
function scriptedReply(): ReactNode {
  return (
    <>
      On it. I&apos;ll handle that from <b>AI Spending</b> — your Main money stays put.
    </>
  );
}

// ── input SUGGESTIONS (founder rework) — quiet chips that PREFILL the input (no
// auto-submit), so the user can edit before sending. Two prefill a parseable send so
// a click shows the confirm-card flow; two are conversational starters. ────────────
const SUGGESTIONS = [
  'Send money',
  'Pay a bill',
  'Split a bill',
  'What can you do?',
] as const;

const reduceMotion = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

export function SpendingChat({ home, demo }: SpendingChatProps) {
  const client = useSuiClient();
  // demo (DEV ?preview) → the populated sample transcript (incl. example cards).
  // production → a single non-transactional welcome line; the live send→confirm flow
  // appends REAL cards from here. Never a fabricated 'sent' card or dead digest.
  const [rows, setRows] = useState<Row[]>(demo ? SEED_ROWS : WELCOME_ROWS);
  const [value, setValue] = useState('');
  // Guards against overlapping submits (a real send is async + slow).
  const busyRef = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const idRef = useRef(0);
  const nextId = () => `m-${++idRef.current}`;

  // Keep the log pinned to the newest message (mockup appends + lets flex scroll).
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);

  // Append a finished AI row (replacing the trailing typing row if present).
  const settleAi = useCallback((body: ReactNode) => {
    setRows((prev) => {
      const trimmed = prev.filter((r) => !(r.who === 'ai' && 'typing' in r && r.typing));
      return [...trimmed, { id: `ai-${Date.now()}`, who: 'ai', body }];
    });
  }, []);

  // Patch one action card's status in place (the card row is keyed by id). A
  // 'sent' transition may carry the executed digest (powers the SuiVision link).
  const setActionStatus = useCallback(
    (id: string, status: ActionStatus, digest?: string) => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === id && r.who === 'ai' && 'action' in r && r.action
            ? { ...r, action: { ...r.action, status, ...(digest ? { digest } : {}) } }
            : r,
        ),
      );
    },
    [],
  );

  // ── CONFIRM: run the REAL PTB for a pending/failed card. resolveRecipient (SuiNS/
  // hex) → home.send (sponsored MAIN→recipient USDC transfer). 'sending' while in
  // flight, 'sent' on success, 'failed' on any miss/error — we NEVER flip a card to
  // 'sent' for a transfer that didn't land. ──────────────────────────────────────
  const onConfirm = useCallback(
    async (id: string, action: SendAction) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setActionStatus(id, 'sending');
      try {
        const resolved = await resolveRecipient(action.name, client);
        if (!resolved.address) {
          setActionStatus(id, 'failed');
          return;
        }
        // USDC is the journal's account currency. amount → USDC base units (6 dp).
        const amountRaw = BigInt(Math.round(action.amount * 10 ** USDC.decimals));
        const digest = await home.send({
          coinType: USDC.type,
          recipient: resolved.address,
          amountRaw,
        });
        setActionStatus(id, 'sent', digest);
      } catch {
        setActionStatus(id, 'failed');
      } finally {
        busyRef.current = false;
      }
    },
    [client, home, setActionStatus],
  );

  // ── CANCEL: dismiss a pending card (drop the row). ──────────────────────────────
  const onCancel = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const v = value.trim();
      if (!v || busyRef.current) return;

      const meId = nextId();
      const send = parseSend(v);
      setValue('');

      // ── CONFIRM-CARD PATH: a clear send becomes a 'pending' action card — the
      // user clicks Confirm to fire the real PTB. No typing dots; the card IS the
      // reply. (No auto-execute — this is the whole point of the founder rework.) ──
      if (send) {
        setRows((prev) => [
          ...prev,
          { id: meId, who: 'me', body: v },
          {
            id: nextId(),
            who: 'ai',
            action: { kind: 'send', amount: send.amount, name: send.name, status: 'pending' },
          },
        ]);
        return;
      }

      // ── STUB PATH: scripted reply after the mockup's typing delay (900ms / 60ms) ──
      const typingId = nextId();
      setRows((prev) => [
        ...prev,
        { id: meId, who: 'me', body: v },
        { id: typingId, who: 'ai', typing: true },
      ]);
      busyRef.current = true;
      const reduce = reduceMotion();
      window.setTimeout(
        () => {
          settleAi(scriptedReply());
          busyRef.current = false;
        },
        reduce ? 60 : 900,
      );
    },
    [value, settleAi],
  );

  // Clicking a suggestion chip PREFILLS + focuses the input (never auto-submits), so
  // the user can edit before sending.
  const onSuggest = useCallback((text: string) => {
    setValue(text);
    inputRef.current?.focus();
  }, []);

  return (
    <div className="detail" id="chatDetail">
      <div className="chat">
        <div className="chat__log" id="chatLog" ref={logRef}>
          {rows.map((row, i) => {
            // Speaker-grouped rhythm: the first row and every row whose speaker
            // differs from the previous one start a new "turn" (the CSS gives
            // `.msg--turn` the bigger gap; consecutive same-speaker rows stay tight).
            // The same `turn` flag also GATES the .msg__who kicker — only a turn row
            // prints "You" / "Suize AI"; consecutive same-speaker rows omit it.
            const turn = i === 0 || rows[i - 1].who !== row.who;
            const cls = (base: string) => `${base}${turn ? ' msg--turn' : ''}`;

            if (row.who === 'me') {
              return (
                <div key={row.id} className={cls('msg msg--me')}>
                  {turn && <div className="msg__who">You</div>}
                  <div className="msg__body">{row.body}</div>
                </div>
              );
            }

            // ── AI ACTION CARD — the click-to-confirm PTB ──────────────────────────
            if ('action' in row && row.action) {
              const { amount, name, status, digest } = row.action;
              const stateCls =
                status === 'sent'
                  ? ' is-sent'
                  : status === 'failed'
                    ? ' is-failed'
                    : status === 'sending'
                      ? ' is-sending'
                      : '';
              return (
                <div key={row.id} className={cls('msg msg--ai')}>
                  {turn && <div className="msg__who">Suize AI</div>}
                  <div className={`chatcard${stateCls}`}>
                    {/* SENT — collapses to ONE compact line: a small good check + the
                        whole 'Sent · $X to name@suize' summary, then a quiet
                        "View on SuiVision" txid link once a digest exists. No buttons. */}
                    {status === 'sent' ? (
                      <div className="chatcard__status">
                        <Check
                          className="chatcard__check"
                          size={12}
                          strokeWidth={ICON_STROKE}
                          aria-hidden
                        />
                        Sent · <span className="amt">${fmt(amount)}</span> to{' '}
                        <span className="rcpt">{name}@suize</span>
                        {digest && (
                          <a
                            className="chatcard__tx"
                            href={SUIVISION_TX(digest)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View on SuiVision
                            <ArrowUpRight size={11} strokeWidth={ICON_STROKE} aria-hidden />
                          </a>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* tiny mono kicker + lucide icon — chrome recedes (compact) */}
                        <div className="chatcard__head">
                          <ArrowUpRight size={12} strokeWidth={ICON_STROKE} aria-hidden />
                          Send
                        </div>
                        {/* the AMOUNT is the hero; recipient on its own quiet line */}
                        <div className="chatcard__amount">${fmt(amount)}</div>
                        <div className="chatcard__to">
                          to <span className="rcpt">{name}@suize</span>
                        </div>

                        {/* PENDING — hairline divider, then Cancel ghost + flat-accent Confirm */}
                        {status === 'pending' && (
                          <>
                            <div className="chatcard__rule" aria-hidden />
                            <div className="chatcard__foot">
                              <button
                                type="button"
                                className="chatcard__cancel"
                                onClick={() => onCancel(row.id)}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="chatcard__confirm"
                                onClick={() => onConfirm(row.id, row.action!)}
                              >
                                Confirm
                              </button>
                            </div>
                          </>
                        )}

                        {/* SENDING — a calm status line, no buttons */}
                        {status === 'sending' && (
                          <div className="chatcard__status">Sending…</div>
                        )}

                        {/* FAILED — a warn line + a quiet Retry (Dismiss to drop it) */}
                        {status === 'failed' && (
                          <>
                            <div className="chatcard__status chatcard__status--warn">
                              Couldn&apos;t send
                            </div>
                            <div className="chatcard__rule" aria-hidden />
                            <div className="chatcard__foot">
                              <button
                                type="button"
                                className="chatcard__cancel"
                                onClick={() => onCancel(row.id)}
                              >
                                Dismiss
                              </button>
                              <button
                                type="button"
                                className="chatcard__confirm"
                                onClick={() => onConfirm(row.id, row.action!)}
                              >
                                <RefreshCw size={12} strokeWidth={ICON_STROKE} aria-hidden />
                                Retry
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            }

            // ── AI text / typing row ──────────────────────────────────────────────
            return (
              <div key={row.id} className={cls('msg msg--ai')}>
                {turn && <div className="msg__who">Suize AI</div>}
                <div className="msg__body">
                  {'typing' in row && row.typing ? (
                    <span className="dots" aria-label="Suize AI is typing">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    row.body
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* SUGGESTIONS — quiet chips that prefill (no auto-submit) the input below. */}
        <div className="chat__suggest" role="group" aria-label="Suggestions">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="suggest"
              onClick={() => onSuggest(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <form className="chat__input" id="chatForm" onSubmit={onSubmit}>
          <span className="prompt" aria-hidden>
            ›
          </span>
          <input
            id="chatInput"
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="ask for anything — send, pay, split…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Ask the spending AI"
          />
          {/* AI Spending holds ONLY USDC — reflected as a quiet single-currency tag. */}
          <span className="chat__cur" aria-hidden="true">
            USDC
          </span>
          <button className="chat__send" type="submit">
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

export default SpendingChat;
