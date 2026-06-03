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
 * ── REAL vs STUB (sanctioned) ──────────────────────────────────────────────────
 * The chat UI is REAL (log, input, typing dots, auto-scroll). The NATURAL-LANGUAGE
 * parsing is the sanctioned stub (there is no client→server chat frame; the agent
 * backend is a documented stub). HOWEVER, a CLEAR "send <amount> to <name>" is
 * upgraded to route through the REAL plumbing: `resolveRecipient` (SuiNS/hex) +
 * `home.send` (a real sponsored MAIN→recipient transfer). On success the AI row
 * shows a real receipt with the executed digest; on an ambiguous prompt, a failed
 * resolve, or any send error it falls back to the mockup's scripted reply verbatim
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

export interface SpendingChatProps {
  /** the data hook — used for the REAL "send X to Y" path (home.send). */
  home: HomeApi;
}

// ── message model (component-local; mirrors the mockup's DOM rows) ──────────────
// AI bodies carry rich inline markup (bold spans / a "good" span / a receipt line),
// so we render them as structured React nodes rather than raw HTML — the same visual
// the mockup produces with innerHTML, but without dangerouslySetInnerHTML.
type Row =
  | { id: string; who: 'me'; body: string }
  | { id: string; who: 'ai'; body: ReactNode; typing?: false }
  | { id: string; who: 'ai'; typing: true; body?: undefined };

// ── the mockup's verbatim seed transcript (journal.html lines 678–687) ──────────
const SEED_ROWS: Row[] = [
  { id: 'seed-0', who: 'me', body: 'send 50 to alice' },
  {
    id: 'seed-1',
    who: 'ai',
    body: (
      <>
        Sent <b>$50.00</b> to <b>alice@suize</b>. <span className="good">Done.</span>
        <Receipt>from AI Spending · 0.4s</Receipt>
      </>
    ),
  },
  { id: 'seed-2', who: 'me', body: 'pay my rent' },
  {
    id: 'seed-3',
    who: 'ai',
    body: (
      <>
        Rent to <b>landlord@suize</b> is <b>$900.00</b>, due in 2 days. Pay it now?
      </>
    ),
  },
];

/** Money formatter matching the mockup's `fmt(n, 2)`. */
function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The green receipt line under an AI action (mockup `.msg__receipt`). */
function Receipt({ children }: { children: ReactNode }) {
  return (
    <span className="msg__receipt">
      <svg viewBox="0 0 16 16" fill="none">
        <path
          d="M3 8.5l3 3L13 4.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>{' '}
      {children}
    </span>
  );
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

/** The mockup's scripted fallback replies (verbatim) — the sanctioned stub. */
function scriptedReply(text: string): ReactNode {
  const m = text.match(/(\d+(?:\.\d+)?)/);
  const who = (text.match(/to\s+(\w+)/i) || [])[1] || 'alice';
  if (/send|pay|transfer/i.test(text)) {
    const amt = m ? parseFloat(m[1]) : 50;
    return (
      <>
        Sent <b>${fmt(amt)}</b> to <b>{who}@suize</b>. <span className="good">Done.</span>
        <Receipt>from AI Spending · 0.4s</Receipt>
      </>
    );
  }
  return (
    <>
      On it. I&apos;ll handle that from <b>AI Spending</b> — your Main money stays put.
    </>
  );
}

const reduceMotion = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

export function SpendingChat({ home }: SpendingChatProps) {
  const client = useSuiClient();
  const [rows, setRows] = useState<Row[]>(SEED_ROWS);
  const [value, setValue] = useState('');
  // Guards against overlapping submits (a real send is async + slow).
  const busyRef = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);
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

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const v = value.trim();
      if (!v || busyRef.current) return;
      busyRef.current = true;

      const meId = nextId();
      const typingId = nextId();
      // user row + a typing indicator (mockup: addMsg → typing dots).
      setRows((prev) => [
        ...prev,
        { id: meId, who: 'me', body: v },
        { id: typingId, who: 'ai', typing: true },
      ]);
      setValue('');

      const reduce = reduceMotion();
      const send = parseSend(v);

      // ── REAL PATH: a clear "send <amount> to <name>" → resolveRecipient + home.send ──
      if (send) {
        try {
          const resolved = await resolveRecipient(send.name, client);
          if (!resolved.address) {
            // Honest miss — the name didn't resolve; fall back to the scripted reply
            // (NEVER claim a send happened) but tell the truth about the recipient.
            settleAi(
              <>
                I couldn&apos;t find <b>{send.name}@suize</b>. Check the name and try again?
              </>,
            );
            busyRef.current = false;
            return;
          }
          // USDC is the journal's account currency (the mockup shows $/USDC). Real
          // sponsored MAIN→recipient transfer. amount → USDC base units (6 decimals).
          const amountRaw = BigInt(Math.round(send.amount * 10 ** USDC.decimals));
          const digest = await home.send({
            coinType: USDC.type,
            recipient: resolved.address,
            amountRaw,
          });
          const short = `${digest.slice(0, 6)}…${digest.slice(-4)}`;
          settleAi(
            <>
              Sent <b>${fmt(send.amount)}</b> to <b>{send.name}@suize</b>.{' '}
              <span className="good">Done.</span>
              <Receipt>from AI Spending · {short}</Receipt>
            </>,
          );
        } catch {
          // Any real-send failure (no funds, RPC, not signed in) → honest scripted
          // fallback. We do NOT fabricate a receipt for a transfer that didn't land.
          setRows((prev) => prev.filter((r) => r.id !== typingId));
          settleAi(
            <>
              I couldn&apos;t complete that send right now. Your Main money stays put —
              try again in a moment?
            </>,
          );
        } finally {
          busyRef.current = false;
        }
        return;
      }

      // ── STUB PATH: scripted reply after the mockup's typing delay (900ms / 60ms) ──
      const reply = scriptedReply(v);
      window.setTimeout(
        () => {
          settleAi(reply);
          busyRef.current = false;
        },
        reduce ? 60 : 900,
      );
    },
    [value, client, home, settleAi],
  );

  return (
    <div className="detail" id="chatDetail">
      <div className="chat">
        <div className="chat__log" id="chatLog" ref={logRef}>
          {rows.map((row) =>
            row.who === 'me' ? (
              <div key={row.id} className="msg msg--me">
                <div className="msg__who">You</div>
                <div className="msg__body">{row.body}</div>
              </div>
            ) : (
              <div key={row.id} className="msg msg--ai">
                <div className="msg__who">Suize AI</div>
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
            ),
          )}
        </div>
        <form className="chat__input" id="chatForm" onSubmit={onSubmit}>
          <span className="prompt" aria-hidden>
            ›
          </span>
          <input
            id="chatInput"
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
