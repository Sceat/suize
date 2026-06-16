import { Fragment, useEffect, useState } from 'react';
import type { Action, JourneyStep, StepTech, SubProduct, TrackPage } from './types';
import { tracks } from './tracks';

// ── tech chips (npm / module / endpoint / primitive) — the meat ──────────────
function TechChips({ items }: { items: StepTech[] }) {
  return (
    <div className="techs">
      {items.map((t, k) => {
        const inner = (
          <>
            <span className={`tech__kind tech__kind--${t.kind}`}>{t.kind}</span>
            <span className="tech__label mono">{t.label}</span>
            <span className="tech__note">{t.note}</span>
            {t.href && <span className="tech__go">↗</span>}
          </>
        );
        return t.href ? (
          <a key={k} className="tech" href={t.href} target="_blank" rel="noreferrer">
            {inner}
          </a>
        ) : (
          <div key={k} className="tech">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

// ── the journey — a manually-advanced, rich, per-step walkthrough ────────────
function Journey({ steps }: { steps: JourneyStep[] }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setI((x) => (x + 1) % steps.length), 4200);
    return () => clearInterval(id);
  }, [playing, steps.length]);

  const go = (n: number) => {
    setPlaying(false);
    setI(Math.max(0, Math.min(steps.length - 1, n)));
  };
  const s = steps[i];

  return (
    <div className="jr">
      <div className="jr__rail">
        {steps.map((st, n) => (
          <Fragment key={n}>
            <button
              className={`jr__chip ${n === i ? 'is-active' : ''} ${n < i ? 'is-done' : ''}`}
              onClick={() => go(n)}
            >
              <span className="jr__chipn">{n + 1}</span>
              <span className="jr__chipt">{st.title}</span>
            </button>
            {n < steps.length - 1 && <span className="jr__sep">→</span>}
          </Fragment>
        ))}
      </div>

      <div className="jr__ctrl">
        <button className="jr__nav" onClick={() => go(i - 1)} disabled={i === 0}>
          ← prev
        </button>
        <button className="jr__play" onClick={() => setPlaying((p) => !p)}>
          {playing ? '❚❚ pause' : '▶ walk it'}
        </button>
        <button className="jr__nav" onClick={() => go(i + 1)} disabled={i === steps.length - 1}>
          next →
        </button>
        <span className="jr__count mono">
          {i + 1} / {steps.length}
        </span>
      </div>

      <div className="jr__panel" key={i}>
        <div className="jr__phead">
          <span className="jr__actor">{s.actor}</span>
          <h3 className="jr__title">{s.title}</h3>
        </div>
        <p className="jr__over">{s.overview}</p>
        <ul className="jr__points">
          {s.points.map((p, k) => (
            <li key={k}>{p}</li>
          ))}
        </ul>
        {s.artifact && (
          <div className="jr__art">
            <div className="jr__artcap">{s.artifact.caption}</div>
            <pre className="jr__artbody mono">{s.artifact.body}</pre>
          </div>
        )}
        {s.tech && <TechChips items={s.tech} />}
      </div>
    </div>
  );
}

// ── proof points (the meat, up top) ──────────────────────────────────────────
function Proof({ items }: { items: string[] }) {
  return (
    <div className="proof">
      {items.map((p, k) => (
        <div className="proof__row" key={k}>
          <span className="proof__check">✓</span>
          {p}
        </div>
      ))}
    </div>
  );
}

// ── a sub-product (shown after the journey) ──────────────────────────────────
function SubProductCard({ s }: { s: SubProduct }) {
  return (
    <div className="sub">
      <span className="sub__kick">Sub-product</span>
      <div className="sub__head">
        <h3 className="sub__name">{s.name}</h3>
        <span className="sub__tag">{s.tagline}</span>
      </div>
      <ul className="sub__points">
        {s.points.map((p, k) => (
          <li key={k}>{p}</li>
        ))}
      </ul>
      {s.tech && <TechChips items={s.tech} />}
      {s.actions && <Acts actions={s.actions} />}
    </div>
  );
}

function Roadmap({ items }: { items: string[] }) {
  return (
    <div className="road">
      {items.map((r, k) => (
        <div className="road__row" key={k}>
          <span className="road__arrow">→</span>
          {r}
        </div>
      ))}
    </div>
  );
}

function Acts({ actions }: { actions: Action[] }) {
  if (!actions.length) return null;
  return (
    <div className="acts">
      {actions.map((a, i) => (
        <a key={i} className={`btn ${a.primary ? 'btn--primary' : ''}`} href={a.href} target="_blank" rel="noreferrer">
          {a.label}
          <span className="btn__arrow">↗</span>
        </a>
      ))}
    </div>
  );
}

// ── the LIVE probe: genuine production responses, via the edge proxy ─────────
type ProbeState = { label: string; caption: string; status?: number; data?: unknown; err?: string; loading?: boolean };
function LiveProbe() {
  const [state, setState] = useState<ProbeState | null>(null);
  async function run(probe: string, label: string, caption: string, qs = '') {
    setState({ label, caption, loading: true });
    try {
      const r = await fetch(`/api/live?probe=${probe}${qs}`);
      const j = (await r.json()) as { status?: number; data?: unknown; error?: string };
      setState({ label, caption, status: j.status, data: j.data, err: j.error });
    } catch (e) {
      setState({ label, caption, err: (e as Error).message });
    }
  }
  return (
    <div className="live">
      <div className="live__head">LIVE · api.suize.io · hit in real time</div>
      <div className="live__btns">
        <button className="btn" onClick={() => run('supported', 'GET /supported', 'The facilitator is up — it advertises the x402 V2 “exact” scheme it speaks on Sui.')}>
          Ping the facilitator
        </button>
        <button className="btn" onClick={() => run('terms', 'GET /terms', 'A real merchant split on $1.00 — the fee leg, carved as a second output, visible.', '&amount=1.00')}>
          Show a live split
        </button>
        <button className="btn" onClick={() => run('challenge', 'POST /deploy', 'A real 402 from production: the price, the declared outputs, the payment-identifier. The actual wire.')}>
          Fetch a live 402
        </button>
      </div>
      {state && (
        <div className="live__panel">
          <div className="live__meta">
            <span className="mono">{state.label}</span>
            {state.status != null && <span className="live__code">{state.status}</span>}
          </div>
          <div className="live__cap">{state.caption}</div>
          <pre className="live__out mono">
            {state.loading
              ? 'fetching live from api.suize.io…'
              : state.err
                ? `⚠ ${state.err}\n\n(the live proxy runs in production)`
                : JSON.stringify(state.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── one product page — the journey IS the page ───────────────────────────────
export function TrackPageView({ page }: { page: TrackPage }) {
  return (
    <div className="stage">
      <div className="phead">
        <span className="phead__kick">{page.track}</span>
        <h1 className="phead__title">{page.productName}</h1>
        <p className="phead__one">{page.pitch}</p>
        <p className="trackline">{page.trackline}</p>
      </div>

      <Proof items={page.proof} />
      <Acts actions={page.actions} />

      <div className="section-label">The journey — step through it</div>
      <Journey steps={page.journey} />

      {page.live && (
        <>
          <div className="section-label">See it live</div>
          <LiveProbe />
        </>
      )}

      {page.subProducts?.map((s) => (
        <SubProductCard key={s.name} s={s} />
      ))}

      <div className="section-label">The stack</div>
      <TechChips items={page.stack} />

      <div className="section-label">What’s next</div>
      <Roadmap items={page.roadmap} />
    </div>
  );
}

// ── the index ────────────────────────────────────────────────────────────────
export function Index({ onJump }: { onJump: (id: string) => void }) {
  return (
    <div className="stage">
      <div className="phead">
        <span className="phead__kick">Agentic payments on Sui</span>
        <h1 className="phead__title">Four products. One rail.</h1>
        <p className="phead__one">
          The building blocks for agentic payments on Sui — every product is a real, working consumer
          of one gasless x402 rail any agent can pay through.
        </p>
      </div>

      <div className="grid4">
        {tracks.map((t) => (
          <button className="tcard" key={t.id} onClick={() => onJump(t.id)}>
            <span className="tcard__track">{t.track}</span>
            <span className="tcard__name">{t.productName}</span>
            <span className="tcard__pitch">{t.pitch}</span>
            <span className="tcard__go">open ↗</span>
          </button>
        ))}
      </div>

      <div className="thesisbar">
        One rail underneath all four — a payer signs a gasless USDC payment, a keyless facilitator settles it,
        and the on-chain balance change is the receipt.
      </div>
    </div>
  );
}

export { tracks };
