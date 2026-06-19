import { useEffect, useState } from 'react';
import { LIVE } from '../tracks';
import './settlement.css';

// Shared across all three decks. Framing: AGENTIC PAYMENTS, VC pitch.

// The giants who validated agentic payments — THEIR facts, cited as theirs.
export const GIANTS: [string, string][] = [
  ['Google', 'AP2 · agent payments'],
  ['Stripe', 'agentic commerce'],
  ['Visa', 'agent-pay program'],
  ['Mastercard', 'agentic tokens'],
  ['Coinbase', 'x402 + agent wallets'],
  ['Alipay', '~120M agent tx / week'],
  ['WeChat', 'rolling out agent pay'],
];

// VC-ammo market figures (sourced; presented as theirs, never as Suize metrics).
export const MARKET = [
  ['$1–5T', 'agentic commerce by 2030 — McKinsey'],
  ['7+', 'of the biggest payment co’s already shipping agent pay'],
  ['Sui', 'protocol-level gasless USDC — the open lane'],
];

// The four products = the traction (each already live on the rail).
export const PRODUCTS: [string, string, string, string][] = [
  ['The business rail', 'Suize', 'Get paid by AI agents — facilitator + ~60-line middleware', 'suize'],
  ['The Vercel for Walrus', 'Deploy', 'Agents ship production sites to the decentralized web', 'deploy'],
  ['The prediction market', 'PolySui', 'Gasless one-tap BTC up/down on DeepBook', 'polysui'],
  ['The agentic wallet', 'Pay', 'A non-custodial AI wallet that can’t overspend', 'pay'],
];

// Positioning for each product page (the framing the founder asked for).
export const POSITIONING: Record<string, { kicker: string; title: string; line: string }> = {
  suize: {
    kicker: 'The business rail',
    title: 'Get paid by AI agents.',
    line: 'The open rail any agent pays through — one gasless transaction, settled on-chain, you receive USDC.',
  },
  deploy: {
    kicker: 'The Vercel for Walrus',
    title: 'Agents ship to the decentralized web.',
    line: 'An AI agent POSTs a site and pays for it in one request — served from Walrus, owned by whoever paid, hash-verified on every byte.',
  },
  polysui: {
    kicker: 'The prediction market',
    title: 'Read the tide. Take a side.',
    line: 'A consumer prediction market on Sui — gasless one-tap BTC up/down on DeepBook, and a vault that takes the other side.',
  },
  pay: {
    kicker: 'The consumer wallet',
    title: 'An AI wallet it can’t overspend.',
    line: 'A non-custodial wallet that gives an agent real spending power inside a hard, on-chain cap — fund it, it acts, you confirm, one tap claws it back.',
  },
};

const NAV_TABS: [string, string][] = [
  ['', 'Overview'],
  ['suize', 'Business Rail'],
  ['deploy', 'Deploy'],
  ['polysui', 'PolySui'],
  ['pay', 'Agentic Wallet'],
];

// The deck navbar — reuses the suize.io chassis (gradient wordmark, frost-on-
// scroll, raised CTA) but surfaces the 4 sections as prominent tabs with a clear
// "you are here" state, so a first look reads as four products on one rail.
export function DeckNav({ active, onJump, onDark }: { active: string; onJump: (id: string) => void; onDark?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', on, { passive: true });
    on();
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`dn${onDark ? ' dn--on-dark' : ''}${scrolled ? ' is-scrolled' : ''}`}>
      <button className="dn__logo" onClick={() => onJump('')} aria-label="Suize — deck overview">
        <span className="dn__mark">SUIZE</span>
      </button>
      <span className="dn__spacer" />
      <nav className="dn__tabs" aria-label="Sections">
        {NAV_TABS.map(([id, label]) => (
          <button key={id} className={`dn__tab ${active === id ? 'is-on' : ''}`} aria-current={active === id} onClick={() => onJump(id)}>
            {label}
          </button>
        ))}
      </nav>
      <a className="dn__cta" href={`${LIVE.facilitator}/supported`} target="_blank" rel="noreferrer">
        Live facilitator ↗
      </a>
    </header>
  );
}

export function Probe() {
  const [s, setS] = useState<{ out?: string; loading?: boolean } | null>(null);
  async function ping() {
    setS({ loading: true });
    try {
      const r = await fetch('/api/live?probe=supported');
      const j = (await r.json()) as { data?: unknown; error?: string };
      setS({ out: j.error ? `⚠ ${j.error}` : JSON.stringify(j.data, null, 2) });
    } catch (e) {
      setS({ out: `⚠ ${(e as Error).message}` });
    }
  }
  return (
    <div>
      <button className="st-btn st-btn--primary" onClick={ping}>
        Ping the live facilitator
      </button>
      {s && (
        <pre className="st-code" style={{ marginTop: 13, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
          {s.loading ? 'hitting api.suize.io…' : `GET /supported\n${s.out}`}
        </pre>
      )}
    </div>
  );
}

export function DeckFoot({ onJump }: { onJump: (id: string) => void }) {
  return (
    <footer className="st-foot">
      <div className="st-foot__in">
        <div>
          <div className="st-foot__mast">suize</div>
          <p className="st-foot__tag">
            The open rail for agentic payments — gasless USDC on Sui, the on-chain balance change is the receipt.
          </p>
        </div>
        <div className="st-foot__col">
          <h4>Product</h4>
          <a onClick={() => onJump('suize')}>The rail</a>
          <a onClick={() => onJump('deploy')}>Deploy</a>
          <a onClick={() => onJump('polysui')}>PolySui</a>
          <a onClick={() => onJump('pay')}>Pay</a>
        </div>
        <div className="st-foot__col">
          <h4>Live</h4>
          <a href={`${LIVE.facilitator}/supported`} target="_blank" rel="noreferrer">
            api.suize.io
          </a>
          <a href={LIVE.agents} target="_blank" rel="noreferrer">
            agents.suize.io
          </a>
          <a href={LIVE.demoSite} target="_blank" rel="noreferrer">
            A deployed site
          </a>
        </div>
      </div>
      <div className="st-foot__bar">
        <span>Suize · agentic payments on Sui · x402 “exact” · gasless USDC</span>
        <span className="mono">testnet-proven · mainnet-ready</span>
      </div>
    </footer>
  );
}

// A live embed of the real Walrus site an agent deployed (shared demo proof).
export function DemoFrame() {
  return (
    <div className="st-demo__frame st-glass" style={{ padding: 0 }}>
      <div className="st-demo__bar">
        <span className="st-dot" />
        {LIVE.demoSite.replace('https://', '').slice(0, 40)}…suize.site
      </div>
      <iframe src={LIVE.demoSite} title="A site an agent deployed to Walrus, paid via Suize" />
    </div>
  );
}
