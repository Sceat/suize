import { useState } from 'react'
import { navigate } from '../viewer/router'
import { Terminal } from './Terminal'

// The lead editorial: the hero claim (kicker, headline, lede, the two doors as
// plain CTAs) sits beside the living agent terminal on desktop; on mobile the
// terminal drops directly under the lede, before the actions (see styles.css,
// the max-width:900px block that reorders these with display:contents + order).
// The four value cards are the fact band under the hero. Prices never appear on
// this page (owner law) — the DeployPanel checkout is the only place a figure shows.
const MCP_CMD = 'claude mcp add suize -- npx -y @suize/mcp'

const VALUES = [
  { n: '01', k: 'Hosting', d: 'No servers, nothing to maintain. Your files are served straight from Walrus.' },
  { n: '02', k: 'Integrity', d: 'Nobody can tamper with your site. Every byte is checked when it is served.' },
  { n: '03', k: 'Lifespan', d: 'Stays online as long as you want. Extend anytime, or let it expire.' },
  { n: '04', k: 'Domain', d: 'Use your own domain. Point it at any site you publish.' },
]

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  )
}

export function Lead() {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(MCP_CMD)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  const goDashboard = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate('/sites')
  }

  return (
    <section className="wrap lead">
      <div className="lead__grid">
        <div className="lead__claim">
          <p className="kick">From a folder to live in seconds.</p>
          <h2 className="lead__head">
            Websites on <em>Walrus</em>, shipped by your agent.
          </h2>
          <p className="lead__lede">
            Your static site goes live with one gasless USDC payment. Whoever pays owns it on-chain.
            No account to open, no API keys to manage.
          </p>
          <div className="acts">
            <button
              type="button"
              className={`btn btn--primary${copied ? ' is-copied' : ''}`}
              onClick={copy}
              aria-live="polite"
            >
              <CopyIcon />
              {copied ? 'Copied to clipboard' : 'Copy the setup command'}
            </button>
            <a className="btn btn--ghost" href="#/sites" onClick={goDashboard}>
              Publish in your browser
            </a>
          </div>
        </div>

        <div className="lead__demo">
          <Terminal />
          <p className="clients">
            <span>
              Use Suize with <b>Claude Code</b>, <b>Codex</b>, any MCP client, or{' '}
              <a href="#/sites" onClick={goDashboard}>
                the browser
              </a>
              . Pick the way you already work.
            </span>
          </p>
        </div>
      </div>

      <div className="values">
        {VALUES.map((v) => (
          <div className="value" key={v.n}>
            <span className="value__n">{v.n}</span>
            <h3 className="value__k">{v.k}</h3>
            <p className="value__d">{v.d}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
