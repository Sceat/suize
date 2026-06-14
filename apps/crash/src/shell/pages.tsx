// PolySui dashboard routes. Play is the real betting screen (App.tsx); these
// five are the surfaces being built out around it. Each is a clean, branded
// placeholder that states what the surface is — the structure the consensus
// pass + live build will fill in.

function Page({
  kicker,
  title,
  lede,
  parts,
}: {
  kicker: string
  title: string
  lede: string
  parts: string
}) {
  return (
    <main className="ps-page">
      <div className="kick">{kicker}</div>
      <h1>{title}</h1>
      <p className="lede">{lede}</p>
      <hr className="ps-rule" />
      <span className="ps-soon">
        <b>{parts}</b>
      </span>
    </main>
  )
}

export const Markets = () => (
  <Page
    kicker="Markets"
    title="Every market, one tide."
    lede="Pick the asset and the window. Bitcoin runs live on rolling 15-minute rounds; more markets open as DeepBook adds them."
    parts="BTC live · ETH · SOL · SUI opening"
  />
)

export const House = () => (
  <Page
    kicker="The House"
    title="Be the house."
    lede="Supply the pool that backs every round and earn the spread. Your stake, the vault's value, and your gains over time — all on-chain and auditable."
    parts="vault NAV · your stake · gains chart · supply / redeem"
  />
)

export const Portfolio = () => (
  <Page
    kicker="Portfolio"
    title="Your positions, your proof."
    lede="Every open and settled position, your live and realized profit, and a verifiable on-chain history of everything you've traded."
    parts="open positions · live P&L · settled history"
  />
)

export const Leaderboard = () => (
  <Page
    kicker="Leaderboard"
    title="Who's reading the tide."
    lede="Streaks, top gains, and the session's biggest calls — read straight from the chain, no scorekeeper required."
    parts="streaks · ranks · biggest calls"
  />
)

export const Agent = () => (
  <Page
    kicker="Agent"
    title="An agent that trades the tide for you."
    lede="Fund a capped sub-account, set the limits, switch it on. The agent trades within on-chain spend caps, logs every move to Walrus, and you revoke it in one tap."
    parts="capped sub-account · spend limits · Walrus trail · one-tap kill"
  />
)
