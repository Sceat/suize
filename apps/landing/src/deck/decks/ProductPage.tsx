import { useEffect, useRef } from 'react';
import type { StepTech, TrackPage } from '../types';
import { DeckNav, DeckFoot, Probe, POSITIONING } from './kit';
import { FlowDiagram, FLOWS } from './Flow';
import { RailExplainer } from './RailExplainer';
import './settlement.css';

function Chips({ items }: { items: StepTech[] }) {
  return (
    <div className="pp-tech">
      {items.map((t, k) => {
        const inner = (
          <>
            <span className={`pp-chip__k pp-chip__k--${t.kind}`}>{t.kind}</span>
            <span className="pp-chip__l">{t.label}</span>
            <span>{t.note}</span>
          </>
        );
        return t.href ? (
          <a className="pp-chip" key={k} href={t.href} target="_blank" rel="noreferrer">
            {inner}
          </a>
        ) : (
          <span className="pp-chip" key={k}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}

export function ProductPage({ page, onJump }: { page: TrackPage; onJump: (id: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const pos = POSITIONING[page.id] ?? { kicker: page.track, title: page.productName, line: page.pitch };

  useEffect(() => {
    const el = root.current!;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('in')),
      { threshold: 0, rootMargin: '0px 0px -8% 0px' },
    );
    el.querySelectorAll('.st-sec').forEach((s) => obs.observe(s));
    const safety = window.setTimeout(() => el.querySelectorAll('.st-sec').forEach((s) => s.classList.add('in')), 2600);
    return () => {
      obs.disconnect();
      window.clearTimeout(safety);
    };
  }, [page.id]);

  return (
    <div className="st" ref={root} key={page.id}>
      <DeckNav active={page.id} onJump={onJump} />

      {/* HERO — positioned */}
      <section className="st-hero" style={{ minHeight: '70vh' }}>
        <div className="st-reveal" style={{ opacity: 1, transform: 'none' }}>
          <p className="st-hero__eye">{pos.kicker}</p>
          <h1 className="st-hero__title" style={{ maxWidth: '18ch' }}>
            {pos.title}
          </h1>
          <p className="st-hero__sub">{pos.line}</p>
          <div className="st-hero__row">
            {page.actions.map((a, i) => (
              <a key={i} className={`st-btn ${a.primary ? 'st-btn--primary' : ''}`} href={a.href} target="_blank" rel="noreferrer">
                {a.label} ↗
              </a>
            ))}
          </div>
        </div>
      </section>

      <div className="st-wrap">
        {/* PROOF */}
        <section className="st-sec">
          <div className="st-reveal">
            <p className="st-eye">proof</p>
            <h2 className="st-h" style={{ marginBottom: 22 }}>
              What’s true today.
            </h2>
            <div className="pp-proof">
              {page.proof.map((p, k) => (
                <div className="pp-proof__row" key={k}>
                  {p}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* THE FLOW — color-coded, follow it end to end */}
        {FLOWS[page.id] && (
          <section className="st-sec st-center">
            <div className="st-reveal" style={{ marginBottom: 26 }}>
              <p className="st-eye" style={{ textAlign: 'center' }}>the flow</p>
              <h2 className="st-h" style={{ maxWidth: '20ch' }}>
                Follow it end to end.
              </h2>
              <p className="st-p" style={{ textAlign: 'center' }}>
                Who calls what, what they hand over, and where it settles — colour-coded by tier.
              </p>
            </div>
            <div className="st-reveal">
              <FlowDiagram steps={FLOWS[page.id]} />
            </div>
          </section>
        )}

        {/* THE RAIL EXPLAINER — x402 vs Suize · the facilitator · the flows.
            Replaces the generic journey on the rail; other products keep it. */}
        {page.id === 'suize' ? (
          <RailExplainer />
        ) : (
          <section className="st-sec">
            <div className="st-reveal" style={{ marginBottom: 22 }}>
              <p className="st-eye">the technicals</p>
              <h2 className="st-h">Under the hood, step by step.</h2>
            </div>
            <div className="pp-steps st-reveal">
              {page.journey.map((s, i) => (
                <div className="pp-step st-glass" key={i}>
                  <div className="pp-step__n">{String(i + 1).padStart(2, '0')}</div>
                  <div>
                    <div className="pp-step__actor">{s.actor}</div>
                    <h3 className="pp-step__h">{s.title}</h3>
                    <p className="pp-step__over">{s.overview}</p>
                    <ul className="pp-points">
                      {s.points.map((p, k) => (
                        <li key={k}>{p}</li>
                      ))}
                    </ul>
                    {s.artifact && (
                      <pre className="st-code" style={{ marginTop: 14 }}>
                        {s.artifact.body}
                      </pre>
                    )}
                    {s.tech && <Chips items={s.tech} />}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* LIVE */}
        {page.live && (
          <section className="st-sec st-center">
            <div className="st-reveal" style={{ maxWidth: 560, margin: '0 auto 18px' }}>
              <p className="st-eye" style={{ textAlign: 'center' }}>see it live</p>
              <h2 className="st-h" style={{ maxWidth: '20ch' }}>
                It isn’t a mockup.
              </h2>
            </div>
            <div className="st-reveal" style={{ display: 'flex', justifyContent: 'center' }}>
              <Probe />
            </div>
          </section>
        )}

        {/* SUB-PRODUCTS */}
        {page.subProducts?.map((sp) => (
          <section className="st-sec" key={sp.name}>
            <div className="st-panel st-glass st-reveal" style={{ width: '100%', maxWidth: 'none' }}>
              <p className="st-eye">sub-product</p>
              <h2 className="st-h" style={{ fontSize: 24 }}>
                {sp.name}
              </h2>
              <p className="st-p" style={{ marginBottom: 12 }}>
                {sp.tagline}
              </p>
              <ul className="pp-points">
                {sp.points.map((p, k) => (
                  <li key={k}>{p}</li>
                ))}
              </ul>
              {sp.tech && <Chips items={sp.tech} />}
              {sp.actions && (
                <div className="st-hero__row" style={{ marginTop: 16, justifyContent: 'flex-start' }}>
                  {sp.actions.map((a, i) => (
                    <a key={i} className={`st-btn ${a.primary ? 'st-btn--primary' : ''}`} href={a.href} target="_blank" rel="noreferrer">
                      {a.label} ↗
                    </a>
                  ))}
                </div>
              )}
            </div>
          </section>
        ))}

        {/* STACK */}
        <section className="st-sec">
          <div className="st-reveal">
            <p className="st-eye">the stack</p>
            <h2 className="st-h" style={{ marginBottom: 18 }}>
              Under the hood.
            </h2>
            <Chips items={page.stack} />
          </div>
        </section>

        {/* ROADMAP */}
        <section className="st-sec st-center">
          <div className="st-reveal">
            <p className="st-eye" style={{ textAlign: 'center' }}>what’s next</p>
            <h2 className="st-h" style={{ marginBottom: 20 }}>
              The roadmap.
            </h2>
            <div className="pp-road">
              {page.roadmap.map((r, k) => (
                <div className="pp-road__r" key={k}>
                  {r}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <DeckFoot onJump={onJump} />
    </div>
  );
}
