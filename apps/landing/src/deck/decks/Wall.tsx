import { useEffect, useRef } from 'react';
import { LIVE } from '../tracks';
import { DeckNav, DeckFoot, Probe, DemoFrame, GIANTS, PRODUCTS } from './kit';
import './settlement.css';
import './wall.css';

// The real, two-sided gap — two colour-coded sides, no repeated headline.
const MERCHANT_FRICS = ['Closed checkouts, built for humans', 'KYB & signups gate every onboard', 'Custodial — someone else holds it'];
const AGENT_FRICS = ['No directory of who accepts', 'Fragmented and opaque', 'No agent-native rail — until now'];

export function Wall({ onJump }: { onJump: (id: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const outer = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current!;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
      { threshold: 0, rootMargin: '0px 0px -8% 0px' },
    );
    el.querySelectorAll('.st-sec').forEach((s) => obs.observe(s));
    const safety = window.setTimeout(() => el.querySelectorAll('.st-sec').forEach((s) => s.classList.add('in')), 2600);

    // eased (lerped) parting — silky regardless of scroll cadence
    let target = 0;
    let cur = 0;
    let raf = 0;
    let alive = true;
    const measure = () => {
      const o = outer.current;
      if (!o) return;
      const rect = o.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      target = Math.min(1, Math.max(0, -rect.top / Math.max(1, total)));
    };
    const loop = () => {
      cur += (target - cur) * 0.09;
      if (Math.abs(target - cur) < 0.0004) cur = target;
      pin.current?.style.setProperty('--part', cur.toFixed(4));
      if (alive) raf = requestAnimationFrame(loop);
    };
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure, { passive: true });
    measure();
    loop();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      obs.disconnect();
      window.clearTimeout(safety);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div className="st" ref={root}>
      <DeckNav active="" onJump={onJump} onDark />

      {/* ACT 1+2 — the wall (closed status quo) parting to the open rail */}
      <div className="wl-pin-outer" ref={outer}>
        <div className="wl-pin" ref={pin}>
          {/* revealed behind */}
          <div className="wl-rail">
            <p className="wl-rail__eye">agentic payments · on Sui</p>
            <h1 className="wl-rail__h">
              We built the <span className="door">door</span> — and the <span className="dir">directory</span>.
            </h1>
            <p className="wl-rail__p">
              The open rail any merchant accepts in ~60 lines — and the directory where AI agents discover
              who to pay. Gasless USDC on Sui, the on-chain balance change is the receipt.
            </p>
            <div className="wl-flow">
              merchant accepts <span style={{ color: 'var(--merchant, #0e7a8a)' }}>→</span> agent finds <span style={{ color: 'var(--agent, #6a5acd)' }}>→</span> <b>pays</b>
            </div>
          </div>

          {/* light through the gap */}
          <div className="wl-bloom" />
          <div className="wl-seam" />

          {/* MERCHANT side */}
          <div className="wl-door wl-door--l">
            <span className="wl-eye">the merchant side</span>
            <h2 className="wl-side-h">Merchants can’t accept agent money.</h2>
            <div className="wl-frics">
              {MERCHANT_FRICS.map((f) => (
                <span className="wl-fric" key={f}>
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* AGENT side (violet) */}
          <div className="wl-door wl-door--r">
            <span className="wl-eye">the agent side</span>
            <h2 className="wl-side-h">Agents can’t find who to pay.</h2>
            <div className="wl-frics">
              {AGENT_FRICS.map((f) => (
                <span className="wl-fric" key={f}>
                  {f}
                </span>
              ))}
            </div>
          </div>
          <div className="wl-cue">scroll — open the rail ↓</div>
        </div>
      </div>

      <div className="st-wrap">
        {/* THE TWO-SIDED FIX — the door + the directory */}
        <section className="st-sec st-center">
          <div className="st-reveal" style={{ marginBottom: 24 }}>
            <p className="st-eye" style={{ textAlign: 'center' }}>the fix · two sides, one rail</p>
            <h2 className="st-h" style={{ maxWidth: '24ch' }}>
              One rail to accept. One directory to be found.
            </h2>
          </div>
          <div className="st-two st-reveal">
            <div className="st-panel st-glass" style={{ width: '100%' }}>
              <p className="st-env__label" style={{ color: 'var(--blue)' }}>the door</p>
              <h3 className="st-h" style={{ fontSize: 23, margin: '0 0 8px' }}>
                Any merchant accepts in ~60 lines.
              </h3>
              <p className="st-p">
                Drop in <b>@suize/pay</b>. Any AI agent that holds USDC pays you in one gasless transaction,
                settled on-chain — no KYB, no chargebacks, you receive USDC.
              </p>
              <div className="st-hero__row" style={{ marginTop: 16, justifyContent: 'flex-start' }}>
                <a className="st-btn" href="https://www.npmjs.com/package/@suize/pay" target="_blank" rel="noreferrer">
                  @suize/pay ↗
                </a>
              </div>
            </div>
            <div className="st-panel st-glass" style={{ width: '100%' }}>
              <p className="st-env__label" style={{ color: '#6a5acd' }}>the directory</p>
              <h3 className="st-h" style={{ fontSize: 23, margin: '0 0 8px' }}>
                Where agents find who to pay.
              </h3>
              <p className="st-p">
                <b>agents.suize.io</b> — a live, on-chain directory of every merchant on the rail. Agents
                discover you; the whole stream of agent commerce is readable, merchant-agnostic.
              </p>
              <div className="st-hero__row" style={{ marginTop: 16, justifyContent: 'flex-start' }}>
                <a className="st-btn" href={LIVE.agents} target="_blank" rel="noreferrer">
                  agents.suize.io ↗
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* WHY NOW — the giants as a positive tailwind (validation, not the wall) */}
        <section className="st-sec st-center">
          <div className="st-reveal">
            <p className="st-eye" style={{ textAlign: 'center' }}>why now</p>
            <div className="st-bignum">$1–5T</div>
            <div className="st-bignum__l">projected agentic-commerce volume by 2030 — McKinsey</div>
            <h2 className="st-h" style={{ maxWidth: '22ch', marginTop: 28 }}>
              The whole industry just validated it.
            </h2>
            <p className="st-p" style={{ textAlign: 'center' }}>
              Google, Stripe, Visa, Mastercard, Coinbase, Alipay and WeChat are all racing in — but
              <b> closed and custodial</b>. The open, on-chain lane has no winner yet.
            </p>
          </div>
          <div className="st-wall st-reveal" style={{ marginTop: 24 }}>
            {GIANTS.map(([n, d]) => (
              <div className="st-brick" key={n}>
                <div className="st-brick__n">{n}</div>
                <div className="st-brick__d">{d}</div>
              </div>
            ))}
            <div className="st-brick" style={{ background: 'rgba(30,127,214,0.16)', borderColor: 'rgba(30,127,214,0.4)' }}>
              <div className="st-brick__n">Suize</div>
              <div className="st-brick__d">the open rail · on Sui</div>
            </div>
          </div>
        </section>

        {/* THE RAIL — how it works (fee-vague) */}
        <section className="st-sec">
          <div className="st-two">
            <div className="st-reveal">
              <p className="st-eye">the rail</p>
              <h2 className="st-h">One transaction. The chain is the receipt.</h2>
              <p className="st-p">
                A merchant adds <b>~60 lines</b>; any agent that holds USDC pays in one gasless transaction,
                signed with its own key, settled on Sui — instant, final, <b>non-custodial</b>. No KYB, no
                chargebacks. The public balance change is the proof.
              </p>
            </div>
            <div className="st-panel st-glass st-reveal">
              <p className="st-env__label">one settled transaction · $1.00</p>
              <div className="st-ledger" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
                <div className="st-ledger__r">
                  <span>agent (payer)</span>
                  <b>−1.000000</b>
                </div>
                <div className="st-ledger__r">
                  <span>merchant</span>
                  <b>+1.000000</b>
                </div>
              </div>
              <div className="st-chips">
                <span>gasless</span>
                <span>instant</span>
                <span>non-custodial</span>
                <span>on Sui</span>
              </div>
            </div>
          </div>
        </section>

        {/* PROOF */}
        <section className="st-sec st-center">
          <div className="st-reveal" style={{ maxWidth: 640, margin: '0 auto 20px' }}>
            <p className="st-eye" style={{ textAlign: 'center' }}>the proof</p>
            <h2 className="st-h" style={{ maxWidth: '22ch' }}>
              An agent paid — and this website went live.
            </h2>
            <p className="st-p" style={{ textAlign: 'center' }}>
              It shipped to Walrus through Deploy, owned by whoever paid. And the rail itself is live — ping
              it.
            </p>
          </div>
          <div className="st-reveal">
            <DemoFrame />
            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center' }}>
              <Probe />
            </div>
          </div>
        </section>

        {/* TRACTION — the four products, repositioned */}
        <section className="st-sec st-center">
          <div className="st-reveal">
            <p className="st-eye" style={{ textAlign: 'center' }}>traction — built as proof, not slides</p>
            <h2 className="st-h" style={{ maxWidth: '20ch' }}>
              Four products already live on the rail.
            </h2>
          </div>
          <div className="st-stations st-reveal">
            {PRODUCTS.map(([k, n, d, id]) => (
              <button className="st-station" key={id} onClick={() => onJump(id)}>
                <span className="st-station__k">{k}</span>
                <span className="st-station__n">{n}</span>
                <span className="st-station__d">{d}</span>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 11, justifyContent: 'center', marginTop: 24 }} className="st-reveal">
            <a className="st-btn st-btn--primary" href={`${LIVE.facilitator}/supported`} target="_blank" rel="noreferrer">
              The live facilitator ↗
            </a>
          </div>
        </section>
      </div>

      <DeckFoot onJump={onJump} />
    </div>
  );
}
