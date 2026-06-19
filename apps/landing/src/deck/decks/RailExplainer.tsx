// The Rail, made legible: what base x402 needs vs what Suize adds, the
// facilitator in call-order (with required/optional), and the three flows.
// Sourced from services/backend/SPEC.md §7 + packages/x402 + packages/pay.

const BASE: [string, string, string][] = [
  ['1', 'A 402 challenge', 'the merchant replies “pay this, exactly” — amount, asset, who’s paid'],
  ['2', 'A signed payment', 'the agent signs with its OWN key, resends in the X-PAYMENT header'],
  ['3', 'Verify + settle', 'someone checks it matches the terms, then broadcasts it on-chain'],
];

const SUIZE: [string, string, string][] = [
  ['@x402/sui', 'Makes x402 work on Sui — one gasless transaction, no gas token. We authored the scheme.', 'required on Sui'],
  ['The facilitator', 'Keyless /verify + /settle — the only live one for Sui. Stateless: the chain is the database.', 'the rail'],
  ['@suize/pay', 'The whole merchant side in ~60 lines: answer 402, verify the retry, settle.', 'convenience'],
  ['The directory', 'agents.suize.io — where agents discover merchants. Entirely off the payment path.', 'network'],
  ['Subscriptions', 'A soulbound on-chain object for recurring — push, user-signed, cancel = delete.', 'recurring'],
];

const STEPS: [string, string, 'optional' | 'required' | 'merchant'][] = [
  ['GET /supported', 'capability discovery — what the rail speaks', 'optional'],
  ['402 challenge', 'the merchant mints the terms (GET /terms is optional)', 'merchant'],
  ['build the tx', 'self-build with @x402/sui, OR POST /build for unsigned bytes', 'optional'],
  ['sign locally', 'the agent signs with its own key — keys never leave the client', 'required'],
  ['POST /verify', 'simulate · exact outputs · recover signer · replay guard', 'required'],
  ['POST /settle', 'keyless gRPC broadcast · idempotent by digest', 'required'],
  ['GET /tx', 'audit the balance-change receipt — checkable, never trusted', 'optional'],
];

const FLOWS: [string, string][] = [
  ['Power door', 'A Sui-native agent with its own key builds and signs the payment itself — zero Suize tooling. The facilitator just settles.'],
  ['Suize wallet', 'An agent signs with a Suize zkLogin session via @suize/mcp. Client-side spend dials gate it; the funded balance is the hard cap.'],
  ['Merchant', 'Drop in @suize/pay (it calls the facilitator), or verify against your own terms — the facilitator’s answer is checkable, not trusted.'],
];

export function RailExplainer() {
  return (
    <>
      {/* A — x402 vs Suize */}
      <section className="st-sec">
        <div className="st-reveal" style={{ marginBottom: 24 }}>
          <p className="st-eye">x402 vs Suize</p>
          <h2 className="st-h" style={{ maxWidth: '24ch' }}>
            You don’t need Suize to pay. You need it to settle on Sui.
          </h2>
        </div>
        <div className="st-two st-reveal">
          <div className="st-panel st-glass" style={{ width: '100%' }}>
            <p className="rx-kicker rx-kicker--base">x402 — the open protocol</p>
            <p className="st-p" style={{ margin: '0 0 16px', fontSize: 14 }}>
              Anyone’s. No account, no SDK, no signup. Three things:
            </p>
            <div className="rx-list">
              {BASE.map(([n, t, d]) => (
                <div className="rx-item" key={n}>
                  <span className="rx-num">{n}</span>
                  <div>
                    <div className="rx-t">{t}</div>
                    <div className="rx-d">{d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="st-panel st-glass" style={{ width: '100%' }}>
            <p className="rx-kicker rx-kicker--suize">Suize — what we run on top</p>
            <div className="rx-list" style={{ marginTop: 14 }}>
              {SUIZE.map(([t, d, tag]) => (
                <div className="rx-item" key={t}>
                  <div style={{ flex: 1 }}>
                    <div className="rx-t">{t}</div>
                    <div className="rx-d">{d}</div>
                  </div>
                  <span className="rx-tag">{tag}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* B — the facilitator, in order */}
      <section className="st-sec st-center">
        <div className="st-reveal" style={{ marginBottom: 24 }}>
          <p className="st-eye" style={{ textAlign: 'center' }}>the facilitator · in order</p>
          <h2 className="st-h" style={{ maxWidth: '22ch' }}>
            What runs, when — and what’s optional.
          </h2>
          <p className="st-p" style={{ textAlign: 'center' }}>
            Only <b>two</b> endpoints are the trust gate. Everything else is discovery or convenience —
            the agent can self-build, the merchant can self-verify.
          </p>
        </div>
        <div className="rx-steps st-reveal">
          {STEPS.map(([ep, d, kind], i) => (
            <div className={`rx-step rx-step--${kind}`} key={ep}>
              <span className="rx-step__n">{String(i + 1).padStart(2, '0')}</span>
              <div className="rx-step__main">
                <span className="rx-step__ep mono">{ep}</span>
                <span className="rx-step__d">{d}</span>
              </div>
              <span className={`rx-badge rx-badge--${kind}`}>{kind}</span>
            </div>
          ))}
        </div>
      </section>

      {/* C — three flows */}
      <section className="st-sec st-center">
        <div className="st-reveal" style={{ marginBottom: 24 }}>
          <p className="st-eye" style={{ textAlign: 'center' }}>three ways through</p>
          <h2 className="st-h" style={{ maxWidth: '18ch' }}>
            One wire. Three flows.
          </h2>
        </div>
        <div className="rx-flows st-reveal">
          {FLOWS.map(([t, d]) => (
            <div className="rx-flowcard st-glass" key={t}>
              <div className="rx-flowcard__t">{t}</div>
              <div className="rx-flowcard__d">{d}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
