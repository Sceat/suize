import { Fragment } from 'react';

// Color-coded tiers — so you can trace any product's flow start → end and see
// exactly what calls what, what it hands over, and where it settles.
type Tier = 'user' | 'agent' | 'merchant' | 'suize' | 'chain';

export const TIERS: Record<Tier, { label: string; c: string }> = {
  user: { label: 'User', c: '#a8761a' },
  agent: { label: 'AI agent', c: '#1e7fd6' },
  merchant: { label: 'Merchant', c: '#0e7a8a' },
  suize: { label: 'Suize backend', c: '#6a5acd' },
  chain: { label: 'On-chain', c: '#0e7048' },
};

type Step = { tier: Tier; actor: string; act: string; pay?: string };

export const FLOWS: Record<string, Step[]> = {
  suize: [
    { tier: 'agent', actor: 'AI agent', act: 'Calls a paid endpoint', pay: 'request' },
    { tier: 'merchant', actor: 'Merchant · @suize/pay', act: 'Answers 402 — the whole contract', pay: '402 challenge' },
    { tier: 'agent', actor: 'AI agent', act: 'Signs one gasless tx with its own key', pay: 'X-PAYMENT' },
    { tier: 'suize', actor: 'Suize facilitator', act: '/verify → /settle, keyless', pay: 'broadcast' },
    { tier: 'chain', actor: 'Sui', act: 'Settles — the balance change is the receipt', pay: 'settled ✓' },
    { tier: 'merchant', actor: 'Merchant', act: 'Delivers — the agent is served' },
  ],
  deploy: [
    { tier: 'agent', actor: 'AI agent', act: 'POSTs a built site', pay: 'site.tar' },
    { tier: 'suize', actor: 'Deploy · first merchant', act: 'Answers 402 — pay, and you own it', pay: '402' },
    { tier: 'agent', actor: 'AI agent', act: 'Pays in one gasless request', pay: 'X-PAYMENT' },
    { tier: 'suize', actor: 'Suize', act: 'Settles first, then stores', pay: 'settled' },
    { tier: 'chain', actor: 'Walrus', act: 'Stores the artifact — quilt + manifest', pay: 'blob ids' },
    { tier: 'chain', actor: 'Sui · create_site', act: 'Mints an immutable, owned Site', pay: 'siteId' },
    { tier: 'chain', actor: 'CF worker', act: 'Serves it — hash-verified every byte', pay: 'live URL' },
  ],
  polysui: [
    { tier: 'user', actor: 'Player', act: 'Signs in with Google (zkLogin)', pay: 'session' },
    { tier: 'user', actor: 'Player', act: 'One-tap UP or DOWN — gasless', pay: 'bet' },
    { tier: 'suize', actor: 'Router', act: 'Routes the bet, sponsored & atomic', pay: 'mint' },
    { tier: 'chain', actor: 'DeepBook Predict', act: 'Prices + settles on a live BTC oracle', pay: 'position' },
    { tier: 'chain', actor: 'On-chain', act: 'Cash out live, or auto-claim on win', pay: 'payout' },
  ],
  pay: [
    { tier: 'user', actor: 'Human', act: 'Funds a capped sub-account', pay: 'USDC' },
    { tier: 'user', actor: 'Human', act: 'Tells the AI a goal', pay: 'intent' },
    { tier: 'agent', actor: 'AI · fenced', act: 'Proposes a tool call — no on-chain numbers', pay: 'proposal' },
    { tier: 'suize', actor: 'Wallet · number wall', act: 'Re-derives the real amounts from chain', pay: 'confirm card' },
    { tier: 'agent', actor: 'Wallet', act: 'Signs locally, on your confirm', pay: 'X-PAYMENT' },
    { tier: 'chain', actor: 'On-chain', act: 'Spends — capped by balance; one-tap sweep', pay: 'settled ✓' },
  ],
};

export function FlowDiagram({ steps }: { steps: Step[] }) {
  const used = Array.from(new Set(steps.map((s) => s.tier)));
  return (
    <div className="fl">
      <div className="fl-legend">
        {used.map((t) => (
          <span className="fl-leg" key={t} style={{ ['--c' as string]: TIERS[t].c }}>
            {TIERS[t].label}
          </span>
        ))}
      </div>
      <div className="fl-pipe">
        {steps.map((s, i) => (
          <Fragment key={i}>
            <div className="fl-node" style={{ ['--c' as string]: TIERS[s.tier].c }}>
              <span className="fl-node__tier">{TIERS[s.tier].label}</span>
              <div>
                <div className="fl-node__actor">{s.actor}</div>
                <div className="fl-node__act">{s.act}</div>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div
                className="fl-link"
                style={{
                  ['--from' as string]: TIERS[s.tier].c,
                  ['--to' as string]: TIERS[steps[i + 1].tier].c,
                }}
              >
                {s.pay && <span className="fl-link__pay">{s.pay}</span>}
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
