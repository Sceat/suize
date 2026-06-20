/**
 * The BUSINESS ANALYTICS CHAT — read-side narration only (the number wall
 * holds). Starts honest-empty (no fabricated revenue talk) and answers
 * honestly until there is real revenue to narrate.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from '../system';
import { BUSINESS } from './copy';
import { Row, Spark, TypingRow } from './bits';

interface BizMsg {
  who: 'you' | 'ai';
  text: string;
  bars?: boolean;
  list?: readonly { k: string; v: string }[];
}

export function BizChat() {
  const [msgs, setMsgs] = useState<BizMsg[]>([]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, typing]);

  function ask(text: string, reply: BizMsg) {
    setMsgs((m) => [...m, { who: 'you', text }]);
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMsgs((m) => [...m, reply]);
    }, 1000);
  }

  function onSend(e: React.FormEvent) {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    // answer honestly — no revenue to narrate yet
    ask(t, { who: 'ai', text: BUSINESS.prodReply });
  }

  const maxBar = Math.max(...BUSINESS.week.bars);

  return (
    <aside className="rd-bizchat rd-glass">
      <div className="rd-bizchat__head">
        <Spark />
        {BUSINESS.chatTitle}
      </div>
      <div className="rd-bizchat__thread" ref={threadRef}>
        {msgs.length === 0 ? <p className="rd-empty-line">{BUSINESS.chatEmpty}</p> : null}
        {msgs.map((m, i) => (
          <Row key={i} who={m.who}>
            {m.text}
            {m.bars ? (
              <span style={{ display: 'block' }}>
                <span className="rd-bars">
                  {BUSINESS.week.bars.map((b, j) => (
                    <span className="rd-bars__col" key={j}>
                      <span
                        className="rd-bars__bar"
                        style={{ height: Math.round((b / maxBar) * 44), animationDelay: `${j * 60}ms` }}
                      />
                      <span className="rd-bars__day">{BUSINESS.week.days[j]}</span>
                    </span>
                  ))}
                </span>
                <span className="rd-bars__label" style={{ display: 'block' }}>
                  {BUSINESS.week.label}
                </span>
              </span>
            ) : null}
            {m.list ? (
              <span className="rd-kv" style={{ display: 'block' }}>
                {m.list.map((r) => (
                  <span className="rd-line" key={r.k}>
                    <span className="rd-line__body rd-money" style={{ fontSize: 11.5 }}>
                      {r.k}
                    </span>
                    <span className="rd-line__dots" />
                    <span className="rd-line__amt">{r.v}</span>
                  </span>
                ))}
              </span>
            ) : null}
          </Row>
        ))}
        {typing ? <TypingRow /> : null}
      </div>
      <form className="rd-bizchat__composer" onSubmit={onSend}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={BUSINESS.composer}
          aria-label="Ask about your business"
        />
        <button type="submit" className="rd-composer__send" aria-label="Send" disabled={!draft.trim()}>
          <ArrowUp size={15} strokeWidth={2} aria-hidden />
        </button>
      </form>
    </aside>
  );
}
