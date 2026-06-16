import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSuiClient } from '@mysten/dapp-kit'
import { fetch_manager } from '../api'
import {
  EVENT_POSITION_MINTED,
  DUSDC_SCALE,
  PRICE_SCALE,
} from '../config'
import { resolveSuizeHandle } from '../suins'
import './agent.css'

// ===========================================================================
//  AGENT — the uncopyable wedge, made legible.
//  --------------------------------------------------------------------------
//  This is a NORMAL tab (same level as Play/Markets/House/Portfolio/Leaderboard).
//  It EXPLAINS + ONBOARDS the one thing a plain Predict frontend can never do:
//  let a personal AI wallet agent PLAY PolySui — and PAY its own way in — from a
//  capped sub-account, gaslessly, with a verifiable on-chain log, revocable in
//  one tap.
//
//  Copy law (consumer vocabulary ONLY): "sub-account" (never leash/pot), "a
//  verifiable log" (never Walrus), "sign in with Google" (never zkLogin),
//  "a smarter AI" (never a model name). x402 CLAIM LADDER: only
//  "gasless · x402-compatible by design · we run a live x402 facilitator for
//  Sui" — NEVER "on x402 / official facilitator" as fact.
//
//  REALNESS: when an agent sub-account address is present (the Suize wallet
//  deep-links it as ?agent=0x… when it points an agent at PolySui, or the user
//  pastes one), we read that address's REAL PolySui activity straight from
//  on-chain PositionMinted events and link every row to the explorer. With no
//  address we show an honest connect state — never fabricated rows.
// ===========================================================================

const WALLET_URL = 'https://wallet.suize.io'
const SUIVISION_TX = (digest: string) =>
  `https://testnet.suivision.xyz/txblock/${digest}`
const SUIVISION_ADDR = (addr: string) =>
  `https://testnet.suivision.xyz/account/${addr}`

const isSuiAddress = (s: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(s.trim())
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

// A real on-chain PolySui bet placed by the agent's sub-account.
type AgentBet = {
  digest: string
  ts: number // ms
  isUp: boolean
  costUsd: number // dUSDC, plain dollars
  strikeUsd: number // 1e9-scaled strike → plain dollars
}

// ---- the minimal client slice we read (queryEvents keeps id + timestamp) ----
type EventsClient = {
  queryEvents: (args: {
    query: { MoveEventType: string }
    cursor?: { txDigest: string; eventSeq: string } | null
    limit?: number
    order?: 'ascending' | 'descending'
  }) => Promise<{
    data: Array<{
      parsedJson?: unknown
      timestampMs?: string | null
      id?: { txDigest: string; eventSeq: string }
    }>
    hasNextPage: boolean
    nextCursor?: { txDigest: string; eventSeq: string } | null
  }>
}

const numField = (o: Record<string, unknown>, k: string): number => {
  const v = o[k]
  if (typeof v === 'string') return Number(v)
  if (typeof v === 'number') return v
  return NaN
}

// Read the agent sub-account's REAL recent PolySui bets, filtered to its manager.
// Best-effort + capped — a slow/empty feed never blocks the surface.
async function fetchAgentBets(
  client: EventsClient,
  managerId: string,
  cap = 12,
): Promise<AgentBet[]> {
  const out: AgentBet[] = []
  let cursor: { txDigest: string; eventSeq: string } | null = null
  let pages = 0
  try {
    while (out.length < cap && pages < 10) {
      pages++
      const page = await client.queryEvents({
        query: { MoveEventType: EVENT_POSITION_MINTED },
        cursor,
        limit: 50,
        order: 'descending',
      })
      for (const e of page.data) {
        const j = e.parsedJson
        if (!j || typeof j !== 'object') continue
        const o = j as Record<string, unknown>
        if (o.manager_id !== managerId) continue
        const digest = e.id?.txDigest
        if (!digest) continue
        out.push({
          digest,
          ts: e.timestampMs ? Number(e.timestampMs) : 0,
          isUp: o.is_up === true || o.is_up === 'true',
          costUsd: numField(o, 'cost') / Number(DUSDC_SCALE),
          strikeUsd: numField(o, 'strike') / Number(PRICE_SCALE),
        })
        if (out.length >= cap) break
      }
      if (!page.hasNextPage || !page.nextCursor) break
      cursor = page.nextCursor
    }
  } catch {
    /* best-effort — return what we gathered */
  }
  return out
}

const fmtAgo = (ts: number, now: number): string => {
  if (!ts) return ''
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ===========================================================================
//  Live activity — resolves an agent address → its manager → its real bets.
// ===========================================================================
function useAgentActivity(address: string | null) {
  const client = useSuiClient() as unknown as EventsClient
  const [state, setState] = useState<{
    loading: boolean
    bets: AgentBet[] | null
    noManager: boolean
  }>({ loading: false, bets: null, noManager: false })

  useEffect(() => {
    if (!address) {
      setState({ loading: false, bets: null, noManager: false })
      return
    }
    let alive = true
    setState({ loading: true, bets: null, noManager: false })
    ;(async () => {
      const managerId = await fetch_manager(address).catch(() => null)
      if (!alive) return
      if (!managerId) {
        setState({ loading: false, bets: null, noManager: true })
        return
      }
      const bets = await fetchAgentBets(client, managerId)
      if (!alive) return
      setState({ loading: false, bets, noManager: false })
    })()
    return () => {
      alive = false
    }
  }, [address, client])

  return state
}

// ---- small editorial primitives ------------------------------------------
const SparkGlyph = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2.2l2 5.6 5.6 2-5.6 2L12 17.4l-2-5.6L4.4 9.8l5.6-2z" />
  </svg>
)
const ArrowOut = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 17 17 7M9 7h8v8" />
  </svg>
)

export function AgentScreen() {
  const client = useSuiClient()
  const [params, setParams] = useSearchParams()

  // The agent sub-account address: the Suize wallet deep-links it (?agent=0x…),
  // else the user can paste one to watch it play. Falls back to nothing — never
  // the user's own wallet (that's not an AGENT, and we never fabricate).
  const agentParam = params.get('agent')
  const agentAddr = agentParam && isSuiAddress(agentParam) ? agentParam.trim() : null
  const activity = useAgentActivity(agentAddr)

  // resolve the agent's @suize handle for the connected header (read-only)
  const [agentHandle, setAgentHandle] = useState<string | null>(null)
  useEffect(() => {
    setAgentHandle(null)
    if (!agentAddr) return
    let alive = true
    resolveSuizeHandle(agentAddr, client).then(h => {
      if (alive) setAgentHandle(h)
    })
    return () => {
      alive = false
    }
  }, [agentAddr, client])

  // live "Xs ago" ticking for the feed
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // paste-to-watch
  const [draft, setDraft] = useState('')
  const draftValid = isSuiAddress(draft)
  const watch = () => {
    if (!draftValid) return
    const next = new URLSearchParams(params)
    next.set('agent', draft.trim())
    setParams(next, { replace: false })
    setDraft('')
  }
  const stopWatching = () => {
    const next = new URLSearchParams(params)
    next.delete('agent')
    setParams(next, { replace: false })
  }

  const openWallet = () =>
    window.open(WALLET_URL, '_blank', 'noopener,noreferrer')

  return (
    <main className="ag">
      {/* ---------------- HERO — one oversized statement, alone in a field ---- */}
      <header className="ag-hero ag-hero-ghost">
        <div className="ag-furniture">
          <span className="ag-kicker">The agent wedge</span>
          <span className="ag-gloss tnum">FIG 01 · UNCOPYABLE</span>
        </div>
        <h1 className="ag-title">
          Your wallet&rsquo;s agent
          <br />
          plays the tide
          <br />
          <em>for</em> you.
        </h1>
        <p className="ag-lede">
          <span className="ag-lede-lede">
            A plain prediction site only knows how to take a tap from a human.
          </span>{' '}
          PolySui takes a tap from your <b>Suize wallet&rsquo;s personal agent</b>
          {' '}— it reads the round, places the bet, and <b>pays its own way in</b>,
          spending only from a <b>capped sub-account</b> you fund and can empty in
          a single tap. Autonomy you switch on — bounded by physics, never by a
          promise.
        </p>
        <div className="ag-hero-cta">
          <button className="ag-primary" onClick={openWallet}>
            Open your Suize wallet
            <span className="ag-primary-ico"><ArrowOut /></span>
          </button>
          <span className="ag-hero-note">
            Sign in with Google — your keys never leave your machine.
          </span>
        </div>
      </header>

      {/* ---------------- THE WEDGE — three claims on hairlines, not tiles ----- */}
      <section className="ag-claims" aria-label="Why this is different">
        <div className="ag-claim">
          <span className="ag-claim-n tnum">01</span>
          <h3 className="ag-claim-h">The balance is the cap.</h3>
          <p className="ag-claim-p">
            The agent spends from a <b>separate sub-account</b> — its balance{' '}
            <i>is</i> the hard limit. It cannot reach past what you funded. A
            ceiling made of physics, not a policy you hope it honours.
          </p>
        </div>
        <div className="ag-claim">
          <span className="ag-claim-n tnum">02</span>
          <h3 className="ag-claim-h">It pays its own way in.</h3>
          <p className="ag-claim-p">
            Every bet settles <b>gasless</b>, over our live x402 facilitator for
            Sui — <b>x402-compatible by design</b>. No seed, no gas token, no
            top-up dance. The agent simply shows up and plays.
          </p>
        </div>
        <div className="ag-claim">
          <span className="ag-claim-n tnum">03</span>
          <h3 className="ag-claim-h">A verifiable log. One-tap revoke.</h3>
          <p className="ag-claim-p">
            Every move it makes lands in a <b>verifiable log</b> you own and
            anyone can audit on-chain. Change your mind, and{' '}
            <b>revoke &amp; sweep</b> empties the sub-account in a single tap.
          </p>
        </div>
      </section>

      <div className="ag-rule" />

      {/* ---------------- HOW — three numbered editorial steps ---------------- */}
      <section className="ag-how" aria-label="How to let your agent play">
        <div className="ag-how-head">
          <div className="ag-furniture">
            <span className="ag-kicker">Three steps</span>
            <span className="ag-gloss tnum">PLAYBOOK · 01–03</span>
          </div>
          <h2 className="ag-h2">How to let your agent play.</h2>
          <p className="ag-h2-sub">
            Three deliberate moves — open, fund, switch on. Nothing in this flow
            ever asks for a seed phrase, and nothing reaches past the line you draw.
          </p>
        </div>
        <ol className="ag-steps">
          <li className="ag-step">
            <span className="ag-step-n tnum">1</span>
            <div className="ag-step-body">
              <h3 className="ag-step-h">Open your Suize wallet</h3>
              <p className="ag-step-p">
                Sign in with Google — no seed phrase, no extension. Inside is a{' '}
                <b>smarter AI</b> that remembers you and acts across the services
                you use.
              </p>
            </div>
          </li>
          <li className="ag-step">
            <span className="ag-step-n tnum">2</span>
            <div className="ag-step-body">
              <h3 className="ag-step-h">Fund a capped sub-account, set the limits</h3>
              <p className="ag-step-p">
                Move in only what you&rsquo;re comfortable risking. Pick a dial —{' '}
                <b>confirm each bet</b>, <b>auto under a set amount</b>, or{' '}
                <b>full-auto</b>. The balance is the ceiling.
              </p>
            </div>
          </li>
          <li className="ag-step">
            <span className="ag-step-n tnum">3</span>
            <div className="ag-step-body">
              <h3 className="ag-step-h">Switch it on, point it at PolySui</h3>
              <p className="ag-step-p">
                Flip the agent on and tell it to play PolySui. It places bets
                within your caps, gaslessly, and writes every one to a log you
                can audit — and revoke in one tap.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <div className="ag-rule" />

      {/* ---------------- LIVE ACTIVITY — real chain reads, never faked ------- */}
      <section className="ag-live" aria-label="Agent activity on PolySui">
        <div className="ag-live-head">
          <div className="ag-furniture">
            <span className="ag-kicker">On-chain</span>
            <span className="ag-gloss tnum">LIVE · READ-ONLY</span>
          </div>
          <h2 className="ag-h2">Your agent on PolySui.</h2>
          <p className="ag-live-sub">
            Point an agent here from your wallet and its plays surface below —
            read straight from the chain, nothing staged. Every row is one tap
            from the explorer, so the proof is never ours to forge.
          </p>
        </div>

        {!agentAddr ? (
          // ---- honest connect state: no agent → no fabricated rows ----
          <div className="ag-connect surface-mesh">
            <div className="ag-connect-mark"><SparkGlyph /></div>
            <p className="ag-connect-lede">
              <span className="ag-connect-lede-strong">No agent is watching this screen yet.</span>{' '}
              Arm one in your Suize wallet — or paste a sub-account address below
              and watch it play, live, with nothing hidden.
            </p>
            <div className="ag-watch">
              <input
                className="ag-watch-in tnum"
                placeholder="0x… agent sub-account address"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') watch()
                }}
                spellCheck={false}
                autoComplete="off"
              />
              <button className="ag-watch-btn" onClick={watch} disabled={!draftValid}>
                Watch
              </button>
            </div>
            <button className="ag-connect-cta" onClick={openWallet}>
              Arm an agent in your wallet
              <span className="ag-primary-ico"><ArrowOut /></span>
            </button>
          </div>
        ) : (
          <div className="ag-feed-wrap surface">
            {/* connected agent header — read-only identity */}
            <div className="ag-agentbar">
              <span className="ag-chip-live">
                <span className="ag-chip-live-dot" />
                Watching
              </span>
              <span className="ag-agentbar-label">agent</span>
              <a
                className="ag-agentbar-id tnum"
                href={SUIVISION_ADDR(agentAddr)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {agentHandle ?? shortAddr(agentAddr)}
              </a>
              <button className="ag-agentbar-stop" onClick={stopWatching}>
                Stop watching
              </button>
            </div>

            {activity.loading ? (
              <div className="ag-feed-state">Reading the chain…</div>
            ) : activity.noManager || (activity.bets && activity.bets.length === 0) ? (
              <div className="ag-feed-state">
                This sub-account hasn&rsquo;t played PolySui yet. The moment it
                does, the bet appears here — live, verifiable, gasless.
              </div>
            ) : (
              <ul className="ag-feed">
                {activity.bets!.map(b => (
                  <li className="ag-row" key={b.digest}>
                    <span className={'ag-row-side ' + (b.isUp ? 'up' : 'down')}>
                      {b.isUp ? 'UP' : 'DOWN'}
                    </span>
                    <span className="ag-row-desc">
                      Agent bet{' '}
                      <b className="tnum">${b.costUsd.toFixed(2)}</b>{' '}
                      {b.isUp ? 'UP' : 'DOWN'} on BTC
                      <span className="ag-row-strike tnum">
                        {' · strike $'}
                        {Math.round(b.strikeUsd).toLocaleString('en-US')}
                      </span>
                    </span>
                    <span className="ag-row-ago tnum">{fmtAgo(b.ts, now)}</span>
                    <a
                      className="ag-row-verify"
                      href={SUIVISION_TX(b.digest)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      verify
                      <span className="ag-row-verify-ico"><ArrowOut /></span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* ---------------- CLOSER — the pitch line, given room to breathe ------ */}
      <section className="ag-closer ag-closer-ghost">
        <span className="ag-gloss tnum ag-closer-gloss">The wedge · in one breath</span>
        <p className="ag-closer-line">
          <span className="ag-closer-lede">It pays its own way in.</span>
          Spending only from a capped sub-account — limits enforced on-chain,
          revocable in a single tap.
          <span className="ag-closer-punch">
            That is the part a prediction frontend can&rsquo;t copy.
          </span>
        </p>
        <button className="ag-primary ag-primary-lg" onClick={openWallet}>
          Start with your Suize wallet
          <span className="ag-primary-ico"><ArrowOut /></span>
        </button>
      </section>
    </main>
  )
}

export default AgentScreen
