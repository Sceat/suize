import Nav from '../components/Nav'
import Footer from '../components/Footer'
import { Reveal, CopyButton } from '../ui'
import { DOCS } from '../config'
import '../docs.css'

// ============================================================================
// #/docs — HOW SUIZE WORKS. The demoable VISUAL explainer (docs + quickstart
// MERGED): the two-tier merchant onboarding ladder (Tier 2 = the one-liner
// snippet + the animated 402 loop), the two doors onto the rail, the
// consumer controls, the MCP quickstart, and the two-door close. Copy lives
// in DOCS (config.js — LOCKED #14, never hardcode here).
//
// LAWS (enforced):
//  · every word from config; tech terms (402/USDC/MCP/Sui) are sanctioned on
//    THIS page only — each section still leads monkey-simple.
//  · NO Suize pricing numbers anywhere — "the fee is printed on every receipt"
//    + a link to #/pricing. The snippet/verify price is the MERCHANT's own
//    example number ('0.10') — allowed; never a Suize fee.
//  · "sub-account" / "allowance" — never "leash" / "pot".
//  · glassmorphism cards (~12px), light default, high contrast, NO diode
//    dots / device mockups / nav numbers.
//  · MOTION: the loop sequence runs on pure CSS keyframes (no second rAF —
//    the Lenis+GSAP clock stays the only JS clock); reveals ride the shared
//    Reveal/scrub helpers; reduced motion ⇒ a static, fully-lit, labeled
//    sequence (docs.css guards every animation).
// ============================================================================

// the section dossier marker — same editorial furniture as the product rooms
function Marker({ no, label }) {
  return (
    <div className="sx-marker">
      <span className="sx-marker__no">{no}</span>
      <span className="sx-marker__label">{label}</span>
      <span className="sx-marker__line" />
    </div>
  )
}

function SectionHead({ eyebrow, head, sub }) {
  return (
    <Reveal className="sx-sectionhead dxd-head">
      <span className="ed-eyebrow">{eyebrow}</span>
      <h2 className="dxd-head__title">{head}</h2>
      {sub && <p className="dxd-head__sub">{sub}</p>}
    </Reveal>
  )
}

// ---- HERO ------------------------------------------------------------------
function DocsHero() {
  const { hero } = DOCS
  return (
    <section className="dxd-hero">
      <div className="sx-wrap">
        <Reveal lines className="dxd-hero__claim">
          <div className="ed-eyebrow">{hero.eyebrow}</div>
          <h1 className="dxd-hero__h1">{hero.h1}</h1>
          <p className="dxd-hero__sub">{hero.sub}</p>
        </Reveal>
      </div>
    </section>
  )
}

// ---- SECTION 1 · THE ONBOARDING LADDER ---------------------------------------
// "Get paid, whatever your stack." — three precise tiers, high-level (no code)
// → low-level. Each tier states WHO it's for, WHAT YOU DO, WHAT SUIZE DOES,
// and HOW YOU KNOW YOU'RE PAID (the three labeled fact columns). Tier 2 keeps
// the one-liner glass code card + the auto-playing five-step sequence as its
// demo: the sequence lights step by step on a 12s CSS loop — a payment packet
// travelling the rail; reduced motion shows the five steps fully lit and
// numbered (a static labeled sequence). The loop markup/animation is APPROVED
// — never touch it.
function ChallengeCard() {
  const { challenge } = DOCS.merchant
  return (
    <div className="dxd-402" aria-label="The 402 payment challenge">
      <span className="dxd-402__status">{challenge.status}</span>
      <div className="dxd-402__json">
        <span className="dxd-402__brace">{'{'}</span>
        {challenge.fields.map(([k, v]) => (
          <span className="dxd-402__row" key={k}>
            <span className="dxd-402__k">“{k}”</span>
            <span className="dxd-402__sep">: </span>
            <span className="dxd-402__v">“{v}”</span>
          </span>
        ))}
        <span className="dxd-402__brace">{'}'}</span>
      </div>
    </div>
  )
}

// Tier 2's demo — the APPROVED one-liner + animated 402 loop, verbatim (pure
// CSS keyframes, no second rAF; reduced motion ⇒ static, fully lit).
function LoopDemo() {
  const m = DOCS.merchant
  return (
    <div className="dxd-loop">
      {/* the one line — a frosted glass code card with a copy button */}
      <Reveal className="dxd-loop__left" scrub={{ from: 'left' }}>
        <div className="dxd-glass dxd-code">
          <div className="dxd-code__head">
            <span className="dxd-code__file">{m.snippet.file}</span>
            <span className="dxd-code__tags">
              <span className="dxd-tag">{m.snippet.tag}</span>
              <CopyButton value={m.snippet.code} label="Copy the snippet" />
            </span>
          </div>
          {/* the FULL real path — install, import, one line. @suize/pay is the
              real npm package; the price is the merchant's own example number. */}
          <pre className="dxd-code__pre">
            <code>
              npm i <span className="c-str">@suize/pay</span>
              {'\n\n'}
              <span className="c-fn">import</span> {'{ suize }'}{' '}
              <span className="c-fn">from</span>{' '}
              <span className="c-str">'@suize/pay'</span>
              {'\n'}app.<span className="c-fn">use</span>(
              <span className="c-fn">suize</span>({'{ '}to:{' '}
              <span className="c-str">'0xYOU'</span>, price:{' '}
              <span className="c-str">'0.10'</span>
              {' }).'}<span className="c-fn">express</span>)
            </code>
          </pre>
        </div>
        <p className="dxd-caption">{m.caption}</p>
      </Reveal>

      {/* the animated sequence — pure CSS loop, no second rAF */}
      <Reveal
        className="dxd-loop__right"
        scrub={{ from: 'right' }}
        aria-label="The payment loop, step by step"
      >
        <div className="dxd-seq" role="list">
          <span className="dxd-seq__rail" aria-hidden="true" />
          <span className="dxd-seq__packet" aria-hidden="true" />
          {m.steps.map((s, i) => (
            <div
              className="dxd-seq__step"
              role="listitem"
              key={s.title}
              style={{ '--i': i }}
            >
              <span className="dxd-seq__tick" aria-hidden="true" />
              <div className="dxd-seq__body">
                <div className="dxd-seq__line">
                  <span className="dxd-seq__no">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="dxd-seq__title">{s.title}</span>
                  <span className="dxd-seq__tag">{s.tag}</span>
                </div>
                <p className="dxd-seq__desc">{s.desc}</p>
                {s.challenge && <ChallengeCard />}
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  )
}

// one ladder rung — the tier head (no + title + who) over the three labeled
// fact columns (what you do / what Suize does / how you know you're paid).
function Tier({ t, labels }) {
  return (
    <Reveal className="dxd-glass dxd-tier">
      <div className="dxd-tier__head">
        <span className="dxd-tier__no">{t.tier}</span>
        <h3 className="dxd-tier__title">{t.title}</h3>
        <p className="dxd-tier__who">{t.who}</p>
      </div>
      <div className="dxd-tier__grid">
        <div className="dxd-tier__cell">
          <span className="dxd-tier__k">{labels.you}</span>
          <p className="dxd-tier__v">{t.you}</p>
          {t.code && <code className="dxd-tier__code">{t.code}</code>}
        </div>
        <div className="dxd-tier__cell">
          <span className="dxd-tier__k">{labels.suize}</span>
          <p className="dxd-tier__v">{t.suize}</p>
        </div>
        <div className="dxd-tier__cell">
          <span className="dxd-tier__k">{labels.paid}</span>
          <p className="dxd-tier__v">{t.paid}</p>
        </div>
      </div>
      {/* Tier 1's language-agnostic example — a bordered ink panel (NOT a nested
          glass card), proving the Suize-specific step is one HTTP POST. */}
      {t.example && (
        <div className="dxd-tier__example">
          <div className="dxd-tier__example-head">
            <span className="dxd-code__file">{t.example.file}</span>
            <CopyButton value={t.example.code} label="Copy the example" />
          </div>
          <pre className="dxd-code__pre">
            <code>{t.example.code}</code>
          </pre>
        </div>
      )}
      {t.note && <p className="dxd-tier__note">{t.note}</p>}
      {t.demo && <LoopDemo />}
    </Reveal>
  )
}

function MerchantLadder() {
  const m = DOCS.merchant
  return (
    <section className="sx-station dxd-station" id="charge">
      <div className="sx-wrap">
        <Marker no="//01" label={m.marker} />
        <SectionHead eyebrow={m.eyebrow} head={m.head} sub={m.sub} />

        {/* the premise — nothing to sign up for — before the rungs */}
        {m.premise && (
          <Reveal className="dxd-premise" lines>
            <span className="dxd-premise__kicker">{m.premise.kicker}</span>
            <h3 className="dxd-premise__statement">{m.premise.statement}</h3>
            <p className="dxd-premise__body">{m.premise.body}</p>
            <p className="dxd-premise__ledger">{m.premise.ledger.join('   ·   ')}</p>
          </Reveal>
        )}

        <div className="dxd-ladder">
          {m.tiers.map(t => (
            <Tier t={t} labels={m.labels} key={t.tier} />
          ))}
        </div>

        {/* the coexistence footnote — Stripe named for coexistence ONLY */}
        <Reveal className="dxd-coexist">
          <h3 className="dxd-coexist__title">{m.coexist.title}</h3>
          <p className="dxd-coexist__body">{m.coexist.body}</p>
        </Reveal>
      </div>
    </section>
  )
}

// ---- SECTION 2 · TWO DOORS ONTO THE RAIL -------------------------------------
// The two canonical payer doors (CLAUDE.md, owner-locked): the agent has its
// OWN Sui key (it signs — Suize builds the tx or it builds its own), or it
// borrows one from Suize via the MCP wallet. Section 4 below is that MCP door's
// setup detail, not a third door.
// Small inline flow glyphs — line-art strokes, currentColor, no diode dots.
const GLYPHS = {
  // door 1 — its own key: a signature stroke Suize carries to the chain
  sign: (
    <svg viewBox="0 0 48 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 16c3-7 6-7 7 0s4 7 6 0" />
      <path d="M22 12h17" />
      <path d="M35 7l5 5-5 5" />
    </svg>
  ),
  // door 2 — it borrows a key from Suize (the MCP wallet)
  key: (
    <svg viewBox="0 0 48 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="12" r="6" />
      <path d="M15 12h29" />
      <path d="M38 12v6" />
      <path d="M44 12v4" />
    </svg>
  ),
}

function Ways() {
  const w = DOCS.ways
  return (
    <section className="sx-station dxd-station dxd-station--ways" id="ways">
      <div className="sx-wrap">
        <Marker no="//02" label={w.marker} />
        <SectionHead eyebrow={w.eyebrow} head={w.head} sub={w.sub} />

        <Reveal className="dxd-ways" lines>
          {w.cards.map((c, i) => (
            <div className="dxd-glass dxd-way" key={c.title} style={{ '--i': i }}>
              <span className="dxd-way__glyph">{GLYPHS[c.glyph]}</span>
              <h3 className="dxd-way__title">{c.title}</h3>
              <p className="dxd-way__body">{c.body}</p>
            </div>
          ))}
        </Reveal>

        <Reveal className="dxd-ways__foot">
          <p className="dxd-foot">{w.foot}</p>
          <p className="dxd-foot dxd-foot--fee">
            {w.fee}{' '}
            <a className="sx-ghost" href={w.pricing.href}>
              {w.pricing.label}
            </a>
          </p>
          {/* the reference pointer — /docs is the showroom; llms.txt is the
              field-by-field contract a dev/agent integrates against. */}
          <p className="dxd-foot dxd-foot--fee">
            <a
              className="sx-ghost"
              href={w.contract.href}
              target="_blank"
              rel="noreferrer"
            >
              {w.contract.label}
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  )
}

// ---- SECTION 3 · THE CONSUMER HALF -------------------------------------------
// The controls ledger (left) + a small glass sub-account motif (right) — the
// home's wallet language at a glance, never the whole hero duplicated. The
// meter is illustrative and number-free (NO pricing figure may appear here).
function Consumer() {
  const c = DOCS.consumer
  return (
    <section className="sx-station dxd-station" id="pay">
      <div className="sx-wrap">
        <Marker no="//03" label={c.marker} />
        <SectionHead eyebrow={c.eyebrow} head={c.head} sub={c.sub} />

        <div className="dxd-consumer">
          <Reveal className="dxd-controls" lines>
            {c.controls.map(ctl => (
              <div className="dxd-control" key={ctl.title}>
                <h3 className="dxd-control__title">{ctl.title}</h3>
                <p className="dxd-control__body">{ctl.body}</p>
              </div>
            ))}
          </Reveal>

          <Reveal className="dxd-consumer__motif" scrub={{ from: 'up', scale: 0.97 }}>
            <div
              className="dxd-glass dxd-wallet"
              role="img"
              aria-label="The agent sub-account: an allowance meter under your cap, the confirm dial, and a one-tap revoke on an approved merchant."
            >
              <div className="dxd-wallet__head">
                <span className="ed-eyebrow">{c.wallet.label}</span>
                <span className="dxd-wallet__toggle">
                  <span className="dxd-wallet__knob" aria-hidden="true" />
                  {c.wallet.toggle}
                </span>
              </div>

              <div className="dxd-wallet__meter" aria-hidden="true">
                <span className="dxd-wallet__fill" />
              </div>
              <div className="dxd-wallet__scale" aria-hidden="true">
                <span>{c.wallet.meter.spent}</span>
                <span>{c.wallet.meter.cap}</span>
              </div>

              <div className="dxd-wallet__dial">
                {c.wallet.dial.map((d, i) => (
                  <span
                    className={`dxd-wallet__mode${i === 0 ? ' is-on' : ''}`}
                    key={d}
                  >
                    {d}
                  </span>
                ))}
              </div>

              <div className="dxd-wallet__allow">
                <span className="dxd-wallet__merchant">
                  {c.wallet.allowance.name}
                  <span className="dxd-wallet__note">{c.wallet.allowance.note}</span>
                </span>
                <span className="dxd-wallet__revoke">{c.wallet.revoke}</span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

// ---- SECTION 4 · THE MCP DOOR -------------------------------------------------
function McpDoor() {
  const m = DOCS.mcp
  return (
    <section className="sx-station dxd-station dxd-station--mcp" id="mcp">
      <div className="sx-wrap">
        <Marker no="//04" label={m.marker} />
        <SectionHead eyebrow={m.eyebrow} head={m.head} sub={m.sub} />

        <div className="dxd-mcp">
          <Reveal className="dxd-mcp__left" scrub={{ from: 'left' }}>
            <div className="dxd-glass dxd-term">
              <div className="dxd-term__head">
                <span className="dxd-term__file">terminal</span>
                <CopyButton value={m.command} label="Copy the install command" />
              </div>
              <pre className="dxd-term__pre">
                <code>
                  <span className="dxd-term__prompt">{m.prompt} </span>
                  {m.command}
                </code>
              </pre>
            </div>
          </Reveal>

          <Reveal className="dxd-mcp__right" scrub={{ from: 'right' }}>
            <div className="dxd-tools">
              {m.tools.map(t => (
                <span className="dxd-tool" key={t}>
                  {t}
                </span>
              ))}
            </div>
            <p className="dxd-foot dxd-mcp__note">{m.note}</p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

// ---- SECTION 5 · THE CLOSE -----------------------------------------------------
function Close() {
  const c = DOCS.close
  return (
    <section className="sx-station dxd-station dxd-close">
      <div className="sx-wrap dxd-close__inner">
        <Reveal>
          <h2 className="dxd-close__title">{c.head}</h2>
        </Reveal>
        <Reveal className="dxd-close__ctas">
          <a className="sx-cta sx-cta--lg" href={c.business.href}>
            {c.business.label}
          </a>
          <a
            className="sx-cta sx-cta--lg"
            href={c.consumer.href}
            target={c.consumer.href.startsWith('#') ? undefined : '_blank'}
            rel={c.consumer.href.startsWith('#') ? undefined : 'noreferrer'}
          >
            {c.consumer.label}
          </a>
        </Reveal>
        <Reveal>
          <a className="sx-ghost dxd-close__pricing" href={c.pricing.href}>
            {c.pricing.label}
          </a>
        </Reveal>
      </div>
    </section>
  )
}

export default function Docs() {
  return (
    <>
      <Nav />
      <main className="sx-main dxd-page">
        <DocsHero />
        <MerchantLadder />
        <Ways />
        <Consumer />
        <McpDoor />
        <Close />
      </main>
      <Footer />
    </>
  )
}
