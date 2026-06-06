/**
 * MoveMoney — the journal's DRAG-AND-DROP money move + confirm popup (leaf L2).
 *
 * Ported 1:1 from /tmp/suize-designs/journal.html (the `DRAG-AND-DROP money move +
 * confirm popup` block, lines ~1066-1135) — the ghost-drag affordance, the
 * `.drop-ok` highlight, and the `.pop` confirm dialog (from → to + amount). The CSS
 * is the foundation's `src/system/tokens-journal.css` (`.ghost`/`.scrim`/`.pop`/
 * `.btn`, all scoped under `.journal`); this file ports ONLY the BEHAVIOUR + the
 * overlay markup, wired to the REAL `HomeApi.transferBetweenAccounts`.
 *
 * ── HOW IT FINDS THE DRAWERS ────────────────────────────────────────────────
 * The account drawers (leaf L1) render the mockup's exact DOM hooks:
 *   • each draggable grip:  <div class="acct__grip" data-drag="main|spend|invest">
 *   • each drop target:     <div class="acct" data-acct="main|spend|invest">
 * This component attaches ONE delegated `pointerdown` listener to the `.journal`
 * root and drives the gesture off those data-attributes (exactly like the mockup's
 * `$$("[data-drag]")` + `elementFromPoint(...).closest(".acct")`). It owns NO drawer
 * markup — it only reads/toggles classes on the drawers the L1 leaf already rendered.
 * This keeps the leaves decoupled: L1 owns the cards, L2 owns the gesture.
 *
 * ── WIRING (real vs stub, honest) ───────────────────────────────────────────
 * On confirm we map the mockup's drawer keys → the HomeApi call:
 *   from "main"  → 'main-to-vault'  (role = the AI `to`)        → REAL deposit PTB
 *   to   "main"  → 'vault-to-main'  (role = the AI `from`)      → 🚩 pending-agent
 *   AI   → AI    → 'vault-to-vault' (role = the AI `from`)      → 🚩 pending-agent
 * `transferBetweenAccounts` returns `{status:'executed',digest}` for the real path
 * or `{status:'pending-agent'}` for the agent-gated stub. We surface the outcome in
 * the popup hint honestly — a real digest for the deposit, an explicit "pending your
 * AI" line for the stub — and NEVER fabricate a success number for the stub paths.
 *
 * 🚩 UNIT NOTE: the journal mockup shows USDC balances, but the only REAL on-chain
 * move available this pass is a SUI deposit (`buildDepositSui`, amount in Mist). We
 * therefore treat the typed amount as SUI and convert to Mist (1 SUI = 1e9 Mist).
 * The amount field is labeled SUI (no "$"/"USDC" chrome) so the visible unit matches
 * what actually executes — honesty over mockup fidelity: this move is SUI.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AiRole, HomeApi, TransferDirection } from '../data/types';
import { ArrowRight, ICON_STROKE } from '../system';

// ── the mockup's drawer keys (data-acct / data-drag) ────────────────────────
type DrawerKey = 'main' | 'spend' | 'invest';

/** Human labels — ported verbatim from journal.html `NAMES`. */
const NAMES: Record<DrawerKey, string> = {
  main: 'Main',
  spend: 'AI Spending',
  invest: 'AI Investing',
};

/** Map a drawer key → the HomeApi AiRole (only the two AI accounts have a role). */
function roleOf(key: DrawerKey): AiRole | null {
  if (key === 'spend') return 'spending';
  if (key === 'invest') return 'investing';
  return null;
}

/** 1 SUI = 1e9 Mist. The real deposit PTB takes Mist. */
const MIST_PER_SUI = 1_000_000_000n;

/** Convert a decimal SUI string to Mist (bigint), truncating beyond 9 dp. */
function suiToMist(input: string): bigint {
  const s = input.trim();
  if (!s) return 0n;
  const neg = s.startsWith('-');
  const [whole, frac = ''] = (neg ? s.slice(1) : s).split('.');
  const wholeMist = BigInt(whole || '0') * MIST_PER_SUI;
  const fracPadded = (frac + '000000000').slice(0, 9);
  const fracMist = BigInt(fracPadded || '0');
  const mist = wholeMist + fracMist;
  return neg ? 0n : mist;
}

/** Resolve { direction, role } from the dragged-from + dropped-on drawer keys. */
function resolveMove(
  from: DrawerKey,
  to: DrawerKey,
): { direction: TransferDirection; role: AiRole } | null {
  if (from === 'main') {
    const role = roleOf(to);
    if (!role) return null; // main → main is impossible (drag-onto-self is filtered)
    return { direction: 'main-to-vault', role };
  }
  // from is an AI account
  const fromRole = roleOf(from);
  if (!fromRole) return null;
  if (to === 'main') return { direction: 'vault-to-main', role: fromRole };
  return { direction: 'vault-to-vault', role: fromRole };
}

// ── live drag state (refs, not React state — the gesture is imperative) ─────
interface DragState {
  from: DrawerKey;
  over: DrawerKey | null;
  /** pointer start, to gate the drag behind a movement threshold (click vs drag). */
  startX: number;
  startY: number;
  /** true once the pointer moved past DRAG_THRESHOLD — only then is it a real drag. */
  engaged: boolean;
}

/** px the pointer must travel before a press becomes a DRAG (else it's a click/select). */
const DRAG_THRESHOLD = 6;

/** The confirm popup's open state — the only piece the React tree re-renders on. */
interface PopState {
  from: DrawerKey;
  to: DrawerKey;
}

/**
 * The drag overlays + confirm popup. Render this into `JournalShell`'s `overlays`
 * slot (it lives inside `.journal`, so the scoped `.ghost`/`.scrim`/`.pop` tokens
 * resolve). It listens on the `.journal` root for `[data-drag]` grips the L1
 * drawers render — no other wiring needed.
 */
export function MoveMoney({ home }: { home: HomeApi }) {
  // The ghost element (follows the cursor). Imperatively positioned for 60fps.
  const ghostRef = useRef<HTMLDivElement | null>(null);
  // Live drag bookkeeping — imperative, never triggers a React render.
  const dragRef = useRef<DragState | null>(null);

  // The confirm popup (null = closed). The ONLY React-rendered drag state.
  const [pop, setPop] = useState<PopState | null>(null);
  const [amount, setAmount] = useState('');
  // Outcome line shown after a confirm: 'idle' | 'sending' | the resolved result.
  const [phase, setPhase] = useState<
    | { kind: 'idle' }
    | { kind: 'sending' }
    | { kind: 'done'; digest: string }
    | { kind: 'pending' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const amtRef = useRef<HTMLInputElement | null>(null);
  // The root we delegate from + query `.acct`/`[data-drag]` within.
  const rootRef = useRef<HTMLDivElement | null>(null);

  // ── ghost positioning (mockup `moveGhost`: left=x, top=y-26) ──────────────
  const moveGhost = useCallback((x: number, y: number) => {
    const g = ghostRef.current;
    if (!g) return;
    g.style.left = `${x}px`;
    g.style.top = `${y - 26}px`;
  }, []);

  // ── the drag gesture: pointerdown on a grip → move → up (ported 1:1) ──────
  useEffect(() => {
    // The `.journal` root is this overlay's ancestor; walk up to find it so our
    // queries are scoped to the journal subtree (and never the whole document).
    const root =
      (rootRef.current?.closest('.journal') as HTMLElement | null) ??
      document.querySelector('.journal');
    if (!root) return;

    const accts = () =>
      [...root.querySelectorAll<HTMLElement>('.acct[data-acct]')];

    const clearDropHints = () => {
      for (const a of accts()) {
        a.classList.remove('drop-ok');
        a.classList.remove('dragging');
      }
    };

    // While a drag is ACTIVELY engaged, kill text selection across the whole page
    // (not just the card) so dragging a card never highlights body copy. We stash
    // the prior inline value and restore it the moment the drag ends.
    let prevUserSelect = '';
    const lockSelection = () => {
      prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
    };
    const unlockSelection = () => {
      document.body.style.userSelect = prevUserSelect;
    };

    /** Begin the visible drag (ghost + dragging class) once movement crosses the threshold. */
    const engage = (from: DrawerKey) => {
      const g = ghostRef.current;
      if (g) {
        g.innerHTML = `<span class="g-from">Move from</span> ${NAMES[from]}`;
        g.classList.add('on');
      }
      const card = root.querySelector<HTMLElement>(`.acct[data-acct="${from}"]`);
      card?.classList.add('dragging');
    };

    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // gate: only treat this as a DRAG once the pointer has moved past the threshold
      if (!drag.engaged) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.engaged = true;
        lockSelection();
        engage(drag.from);
      }
      // now that it's a real drag, stop the browser from extending a text selection
      e.preventDefault();
      moveGhost(e.clientX, e.clientY);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const acct = el ? (el.closest('.acct') as HTMLElement | null) : null;
      for (const a of accts()) a.classList.remove('drop-ok');
      drag.over = null;
      const key = acct?.dataset.acct as DrawerKey | undefined;
      if (acct && key && key !== drag.from) {
        acct.classList.add('drop-ok');
        drag.over = key;
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      unlockSelection();
      ghostRef.current?.classList.remove('on');
      clearDropHints();
      const drag = dragRef.current;
      // only a real (engaged) drag opens the popup; a press-without-move was a click
      // and falls through to the card's native onClick (which selects the account).
      if (drag && drag.engaged) {
        // suppress the click that would otherwise fire on the source card after a drag
        suppressNextClick();
        if (drag.over) openPop(drag.from, drag.over);
      }
      dragRef.current = null;
    };

    const onDown = (e: PointerEvent) => {
      // primary button only; ignore the toggle (it stops propagation itself).
      if (e.button !== 0) return;
      const card = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-drag]',
      );
      if (!card) return;
      const from = card.dataset.drag as DrawerKey | undefined;
      if (!from) return;
      // DO NOT preventDefault here — a press without movement must remain a click so
      // the card's onClick selects the account. The drag engages on first move.
      dragRef.current = { from, over: null, startX: e.clientX, startY: e.clientY, engaged: false };
      // passive:false so e.preventDefault() in onMove can suppress text selection.
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp, { once: true });
    };

    root.addEventListener('pointerdown', onDown);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // restore selection if we unmount mid-drag (defensive — onUp normally handles it).
      unlockSelection();
    };
    // openPop is stable (defined below via useCallback); moveGhost is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveGhost]);

  // After a real drag we suppress the trailing synthetic click on the source card so
  // the drag doesn't also "select" it. One-shot capture-phase listener on the root.
  const suppressNextClick = useCallback(() => {
    const root =
      (rootRef.current?.closest('.journal') as HTMLElement | null) ??
      document.querySelector('.journal');
    if (!root) return;
    const swallow = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
      root.removeEventListener('click', swallow, true);
    };
    root.addEventListener('click', swallow, true);
    // safety: clear it if no click arrives shortly
    window.setTimeout(() => root.removeEventListener('click', swallow, true), 350);
  }, []);

  // ── popup open/close ──────────────────────────────────────────────────────
  const openPop = useCallback((from: DrawerKey, to: DrawerKey) => {
    setPhase({ kind: 'idle' });
    setAmount('');
    setPop({ from, to });
    // focus the amount field after the open transition (matches mockup's 350ms)
    window.setTimeout(() => amtRef.current?.focus(), 350);
  }, []);

  const closePop = useCallback(() => {
    setPop(null);
  }, []);

  // ── confirm → the REAL transfer (or the honest pending-agent stub) ────────
  const onConfirm = useCallback(async () => {
    if (!pop) return;
    const move = resolveMove(pop.from, pop.to);
    if (!move) return;
    // mockup: parse the typed value, else fall back to the placeholder, else 100.
    const placeholder = pop.from === 'main' ? '200.00' : '100.00';
    const typed = amount.trim() || placeholder;
    const mist = suiToMist(typed);
    if (mist <= 0n) {
      setPhase({ kind: 'error', message: 'Enter an amount greater than zero.' });
      return;
    }
    setPhase({ kind: 'sending' });
    try {
      const res = await home.transferBetweenAccounts(
        move.direction,
        move.role,
        mist,
      );
      if (res.status === 'executed') {
        setPhase({ kind: 'done', digest: res.digest });
      } else {
        // 🚩 agent-gated: honest pending state, never a fake digest.
        setPhase({ kind: 'pending' });
      }
    } catch (err) {
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Move failed.',
      });
    }
  }, [pop, amount, home]);

  const onAmtKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void onConfirm();
      }
    },
    [onConfirm],
  );

  const open = pop != null;
  const placeholder = pop?.from === 'main' ? '200.00' : '100.00';
  const sending = phase.kind === 'sending';

  // The hint line: default copy, swapped for the honest outcome once resolved.
  const hint: ReactNode = (() => {
    switch (phase.kind) {
      case 'sending':
        return 'Moving…';
      case 'done':
        return (
          <>
            Moved. <span className="good">On-chain</span> · {short(phase.digest)}
          </>
        );
      case 'pending':
        // 🚩 vault payouts are driven by your AI (it holds the cap) — no fake digest.
        return 'Queued for your AI to run — it holds the key to move money out.';
      case 'error':
        return phase.message;
      default:
        return 'Drag a card onto another to move money. It moves the same way back.';
    }
  })();

  return (
    <div ref={rootRef} style={{ display: 'contents' }}>
      {/* drag ghost — follows the cursor (positioned imperatively) */}
      <div className="ghost" ref={ghostRef} aria-hidden="true" />

      {/* scrim — click to dismiss */}
      <div
        className={`scrim${open ? ' open' : ''}`}
        onClick={closePop}
        aria-hidden="true"
      />

      {/* confirm popup */}
      <div
        className={`pop${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Move money"
        data-from={pop?.from}
        data-to={pop?.to}
      >
        <div className="pop__eyebrow">Move money</div>
        <div className="pop__flow">
          {/* inverted node: muted "From" kicker ABOVE the account name */}
          <span className="node">
            <small>From</small>
            <span>{pop ? NAMES[pop.from] : 'Main'}</span>
          </span>
          {/* arrow lives ONLY on the name row (CSS places it grid-row 2),
              baseline-aligned to the account titles, accent-colored, name-size */}
          <span className="arr" aria-hidden="true">
            <ArrowRight strokeWidth={ICON_STROKE} />
          </span>
          <span className="node">
            <small>To</small>
            <span>{pop ? NAMES[pop.to] : 'AI Investing'}</span>
          </span>
        </div>
        <div className="pop__field">
          <input
            ref={amtRef}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={onAmtKeyDown}
            inputMode="decimal"
            placeholder={placeholder}
            aria-label="Amount in SUI"
            disabled={sending}
          />
          <span className="suf">SUI</span>
        </div>
        <div className="pop__hint">{hint}</div>
        <div className="pop__act">
          <button
            className="btn btn--ghost"
            type="button"
            onClick={closePop}
            disabled={sending}
          >
            {phase.kind === 'done' || phase.kind === 'pending' ? 'Close' : 'Cancel'}
          </button>
          {phase.kind === 'done' || phase.kind === 'pending' ? null : (
            <button
              className="btn btn--cy"
              type="button"
              onClick={() => void onConfirm()}
              disabled={sending}
            >
              {sending ? 'Moving…' : 'Move'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Short on-chain digest for the receipt line (head…tail). */
function short(digest: string): string {
  if (digest.length <= 14) return digest;
  return `${digest.slice(0, 8)}…${digest.slice(-4)}`;
}

export default MoveMoney;
