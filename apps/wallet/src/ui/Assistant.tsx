/**
 * REDESIGN LAB — THE ASSISTANT PANEL. The chat is SECONDARY by owner law
 * (2026-06-10): the wallet's money surfaces own the page; this panel docks
 * beside/over them. Every wallet variant mounts this same component —
 * Deck = a persistent right column · Minimal = a floating dock panel ·
 * Journal = a flat editorial rail (`flat` prop strips the glass).
 *
 * It still carries the signature moment: the seeded SF thread plays once
 * (ask → plan → found-it), lands the CONFIRM CARD, and a tap on "Book it"
 * fires `onBooked()` so the host page ticks its balance + prepends the
 * activity row. The Agent-enabled switch lives in the panel head — arming
 * the assistant is the assistant's own affordance.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, ExternalLink, Plus, ICON_STROKE } from '../system';
import { ASSISTANT, WALLET, money, type ChatMsg } from './copy';
import { Divider, Row, Spark, Switch, TypingRow, rich } from './bits';

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SEED_STEPS = WALLET.thread.length + 1;

type ConfirmState = 'pending' | 'done' | 'declined';

interface Extra {
  who: 'you' | 'ai';
  text: string;
}

export interface AssistantPanelProps {
  agentOn: boolean;
  onToggleAgent: () => void;
  /** the host ticks its balance + activity when the booking confirms */
  onBooked: () => void;
  /** journal variant: flat editorial rail — no glass, hairline separations */
  flat?: boolean;
}

export function AssistantPanel({ agentOn, onToggleAgent, onBooked, flat = false }: AssistantPanelProps) {
  const reduce = useMemo(reduceMotion, []);

  const [convo, setConvo] = useState<string>('sf');
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

  // ── seeded choreography (plays once; StrictMode/cleanup-safe via seedRef) ──
  useEffect(() => {
    if (convo !== 'sf') return;
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
  }, [convo]);

  // auto-scroll to the foot on every thread change
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [seedShown, typing, payoffShown, extras, convo, confirm]);

  function onBook() {
    setConfirm('done');
    onBooked();
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
          [convo]: [...(e[convo] ?? []), { who: 'ai', text: WALLET.scriptedReply }],
        }));
      },
      reduce ? 0 : 1100,
    );
  }

  const activeHistory = WALLET.history.find((h) => h.id === convo);
  const isSeed = convo === 'sf';
  const isNew = convo === 'new';
  const liveExtras = extras[convo] ?? [];
  const flightBooked = confirm === 'done';

  return (
    <div className={`rd-asst${flat ? ' rd-asst--flat' : ' rd-glass'}`}>
      {/* head — the assistant identity + the arming switch */}
      <div className="rd-asst__head">
        <span className="rd-asst__title">
          <Spark />
          {ASSISTANT.title}
        </span>
        <span className="rd-asst__arm">
          <span>{agentOn ? WALLET.agentToggle : WALLET.agentOff}</span>
          <Switch on={agentOn} onToggle={onToggleAgent} label="Agent enabled" />
        </span>
      </div>

      {/* recent conversations — TOP-DOWN list (owner: never a single scrolling line) */}
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

      {/* the thread */}
      <div className="rd-asst__thread" ref={threadRef}>
        {isNew && liveExtras.length === 0 ? (
          <div className="rd-asst__empty">
            <p className="rd-asst__emptytitle">What can I handle for you?</p>
            <div className="rd-chips">
              {WALLET.chips.map((c) => (
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
            <article className={`rd-confirm${flat ? '' : ' rd-glass'}${flightBooked ? ' is-done' : ''}`}>
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

/**
 * The floating dock — the Minimal variants' fully-secondary chat. A quiet
 * glass pill bottom-right; tap → the panel rises. `children` is the panel
 * content (an AssistantPanel or the business chat).
 */
export function AssistantDock({
  open,
  onToggle,
  label = ASSISTANT.dock,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  /** the pill label — the business face says "Ask about your business" */
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <button type="button" className={`rd-dock${open ? ' is-open' : ''}`} onClick={onToggle}>
        <Spark />
        {label}
      </button>
      <div className={`rd-dockpanel${open ? ' is-open' : ''}`}>{children}</div>
    </>
  );
}
