// ============================================================================
// CrashHost — the data/actions contract between the React app (App.tsx, which
// owns ALL the gasless/data LOGIC) and the ported e05 presentation
// (crash-e05.ts + crash-base.ts, which build the EXACT design-lab-v3 DOM +
// scoped CSS + canvas chart).
// ----------------------------------------------------------------------------
// The presentation NEVER fetches or signs anything. It reads `data` (live —
// the app mutates the same object in place each render, the e05 rAF reads it),
// and calls `actions.*` for every interactive control (stake chips, UP/DOWN,
// Become the house, Add funds, cash out, claim, sign in/out). The field shapes
// mirror design-lab-v3/stub.js so the ported e05 code changes only its source
// (stub.X -> data.X), never its structure.
// ============================================================================

// One side's live bet view-model (standard fixed-stake binary betting).
// The WAGER is constant across sides; the WIN (payout if this side is right)
// DIFFERS per side because UP and DOWN carry different implied odds.
export type CrashSide = {
  win: number // $ PAYOUT if this side wins (differs per side — the headline)
  multiple: number | null // win / wager (the dopamine number); null until quoted
  costUsd: number | null // the WAGER in $ — the SAME constant on both sides; null until quoted
  double: boolean // true when the multiple sits in the ~2x "double your money" band
  // DUAL-SIDE MODEL: BOTH sides are always tappable — a tap folds into its own
  // bucket (UP and DOWN never net on chain). false only when locked / unaffordable
  // / no quote / market not active / a write is in flight (serialization). NO
  // lopsidedness gating — a near-1.0x favorite and a 1.7x longshot are both bettable.
  enabled: boolean
}

// One row of the live "Placing now" tape (ambient social proof; ZERO gameplay).
export type CrashTapeRow = {
  id: number
  name: string
  amountUsd: number
  side: 'UP' | 'DOWN'
}

// One row of the GAINS/LOSS results log (top-right, below the account cluster).
// A settled outcome we captured this session (or seeded from the redeemed feed):
// the side, whether it won, and the realized P&L in plain USD (signed). Rendered
// most-recent-first, capped to a few rows. Pure presentation — never feeds a tx.
export type CrashResult = {
  id: number // monotonic render key (epoch ms of capture)
  // STABLE bucket key (oracle|side|strike|expiry) for dedup across the live session
  // capture + the reload seed + a sweep/auto-claim double-fire, so ONE settled
  // bucket is ONE row. Optional only for back-compat; every producer now sets it.
  key?: string
  isUp: boolean
  won: boolean
  pnlUsd: number // signed realized P&L in dollars (+win / −loss)
}

// ONE side of the held position, presented as its OWN distinct position card —
// "The Exit Ticket": an OUTLINED LEDGER/RECEIPT (vs the filled, side-coloured WAGER
// posters). The card's CHROME (verdict rail / border / fill / glow / hero colour) is
// driven by the SIGN OF THE LIVE P&L (`liveNet`), NOT by the side — a DOWN bet
// that's winning right now renders a GREEN card. The side (UP/DOWN) is only a tiny
// mono glyph that NEVER tints chrome.
//
// TWO-DISTINCT-POSITIONS MODEL: UP and DOWN are separate on-chain buckets under
// distinct MarketKeys that settle independently, so the UI shows each as its own
// card with its OWN cash-out button. There is NO merged/netted number — every
// figure here is for THIS side alone, honest by construction.
export type SideVM = {
  side: 'UP' | 'DOWN'
  // This side's contract count: "3.2 contracts" (qty / ONE_CONTRACT_QTY).
  contractsStr: string
  // ----- LIVE P&L (drives the card chrome + the hero) -----
  // The signed live net in DOLLARS = exit-now value − cost. The CHROME state binds
  // to sign(liveNet) ONLY, so a losing position is structurally incapable of
  // rendering green. (Carried for completeness; the render uses `state`/`liveNetStr`.)
  liveNet: number
  // The hero string with caret: "▴ +$0.31" (winning) / "▾ −$0.74" (losing) /
  // "+$0.00" (neutral). Coloured by `state` in the render.
  liveNetStr: string
  // The verdict from liveNet + a $0.02 deadband (kills strobe at break-even).
  // 'neutral' ALSO when there is no live quote yet (pre-quote → no phantom).
  state: 'winning' | 'losing' | 'neutral'
  // Plain-word sublabel matching `state`: "winning now" / "losing now" / "about even".
  nowSublabel: string
  // The MATH line proving the hero: "value now $2.12" + the paid basis below.
  exitValueStr: string
  // This side's cost basis, muted: "paid $0.50" (cents-aware).
  paidStr: string
  // ----- conditional settle figures (ALWAYS grey, ALWAYS "IF"-prefixed) -----
  // The net profit IF this side wins at settle = (qty × $1) − cost. "+$2.09".
  // NEVER tinted — it can never green a loser. Deterministic (no live quote needed).
  profitIfRightStr: string
  // The FULL gross payout you'd hold if right = qty × $1. "pays $3.90 total".
  totalIfSettledStr: string
  // ----- cash-out CTA -----
  // Signed real exit net, agreeing with the hero: "Cash out · take +$0.31" (green) /
  // "...take −$0.74" (honest red). Plain "Cash out" until the first live quote.
  cashoutCtaStr: string
  cashoutPositive: boolean // the signed exit net on the button is >= 0
  canCashout: boolean // this side firable (confirmed quote, no write in flight)
  busyCashout: boolean // THIS side's cash-out tx is in flight
  // ----- LOCKED / SETTLING (the held round is settling — neutral, outcome unknown) -
  // True once the held round is settling (keyed off the App-level held_settling /
  // settling_now flag). When set the card goes NEUTRAL grey (NEVER fake-tinted), the
  // NOW block is replaced by "SETTLING ROUND… / payout pending", and BOTH honest
  // outcomes are shown below the hairline; the cash-out button is disabled.
  settling: boolean
  // The two honest outcome strings shown while settling: "IF DOWN WINS → you get
  // $3.90" and "IF DOWN LOSES → you get $0".
  ifWinsStr: string
  ifLosesStr: string
}

// The held position cluster (replaces/accompanies the bet controls while a bet is
// live). TWO-DISTINCT-POSITIONS MODEL: a SHARED header (entry + time-to-settle)
// plus a per-side map — each present side renders its own card with its own
// cash-out button. A side with 0 contracts is simply absent from `sides` (its
// column shows the pre-bet wager selector instead, for opening/growing).
export type CrashHeld = {
  // The shared round strike, relabelled "LINE $67,000" (it is the round's locked
  // settlement line — fixed for the whole round, NOT a cost basis; "ENTRY" read as
  // a cost and confused users). Shown once above/between the two cards.
  entryStr: string
  // The two distinct positions; a side is present only when its qty > 0.
  sides: { up?: SideVM; down?: SideVM }
  // ----- shared settle/round state (drives the masthead + per-card CTA mode) -----
  pending: boolean // oracle pending_settlement (trading frozen)
  settled: boolean // oracle settled -> auto-claim path (cards show CLAIMING…)
  // True from expiry until the position resolves (pending OR settled OR past
  // expiry): the masthead shows the SETTLING treatment (hairline loader, no "…")
  // and the held numbers freeze. The held analogue of CrashData.validating.
  settling: boolean
  countdownText: string // mm:ss for the held round (live) — real remaining time
  // Special masthead state for a held round: 'settling' once the round is past
  // expiry / settling (masthead shows SETTLING + the hairline loader, NOT "…").
  // null while the round is still live (the real mm:ss timer shows).
  countdownSpecial: 'settling' | null
  // Seconds left in the ~15s on-chain settlement/validation window for a HELD
  // position (position.expiry + 15s − now), or null once it elapses.
  settlingSecs: number | null
  busyClaim: boolean // a settled-round auto-claim is in flight (shared)
}

export type CrashData = {
  // ---- top-right account cluster: balance + identity ----
  signedIn: boolean
  balanceStr: string // "$250" (whole dollars), or "—" while unknown
  roundStr: string // "· round 1" (we map the app's market into a round index)
  // Identity shown next to Sign out. We have NO SuiNS/handle wired (no resolver
  // call), so this is the truncated, click-to-copy hex address ("0x1234…abcd").
  // `addressFull` is the full 0x… (clipboard payload); null when signed-out.
  addressFull: string | null
  addressShort: string // "0x1234…abcd" (or '' when signed-out)

  // ---- connect state (e05 prototype lacks this; styled in e05 language) ----
  googleWallet: boolean
  connecting: boolean
  hasMoney: boolean // total balance > 0 (show CASH OUT in the couplet)
  walletEmpty: boolean // signed in but balance == 0 (show ADD FUNDS)
  managerHasBalance: boolean // manager internal balance > 0 (CASH OUT enabled)

  // ---- countdown masthead ----
  countdownMm: string
  countdownSs: string
  cdClass: string // '' | 'urgent' | 'dead'
  cdWarn: boolean // locked -> "Waiting for next round"
  lockFrac: number // 0..1 blue lock-drain hairline

  // ---- VALIDATING-ROUND phase (round over / settling, no live bettable round) ----
  // True AFTER a round's oracle passes expiry (or goes pending_settlement /
  // settled) and BEFORE the next active round is selected — the "validation
  // window". DISTINCT from `locked` (the earlier final-15s pre-expiry lock while
  // the oracle is still active). While `validating` the masthead reads
  // "VALIDATING ROUND" (with the hairline motion cue) instead of the 3 dots, and
  // every live display number FREEZES at its round-end value (see `frozen`).
  validating: boolean
  // Seconds left in the derivable ~15s settlement window (oracle.expiry +15s −
  // now), or null when no deadline is derivable / it has elapsed (then show just
  // the label). Rendered as a small "Ns" countdown under the VALIDATING label.
  validatingSecs: number | null
  // True while displayed numbers are HELD at their round-end snapshot (currently
  // == validating). The e05 layer + chart read this to STOP advancing the live
  // price, the per-side payouts/multiples, the balance figures, and the chart
  // head until the next round goes active (then it clears and live resumes).
  frozen: boolean

  // ---- pre-bet controls ----
  locked: boolean
  betStatusText: string
  stakes: readonly number[]
  stake: number
  maxAffordableUsd: number | null
  canAfford: (usd: number) => boolean
  up: CrashSide
  down: CrashSide
  busyUp: boolean // bet-up or manager creation in flight
  busyDown: boolean

  // ---- held position (null when no live bet) ----
  held: CrashHeld | null

  // ---- chart (read live each frame) ----
  chartSamples: number[] // rolling spot history in plain USD (live ref, mutated in place)
  spot: number | null // live spot in USD
  strike: number | null // entry/strike line in USD
  chartSide: 'UP' | 'DOWN' | null // held side -> tints the line + ENTRY label
  // The AUTHORITATIVE win/lose verdict for the chart line tint, so the line and
  // the cash-out card ALWAYS agree. Driven by App from the live bid-vs-cost P&L
  // while the bet is live (and the settlement verdict once settled) — NOT from a
  // spot-vs-strike re-derivation (which can disagree when the bid leads/lags the
  // spot crossing, e.g. bet DOWN, price up but the bid still > cost). null when
  // no bet is held (the line falls back to a neutral 50/50 tint).
  chartWinning: boolean | null

  // ---- tape ----
  tape: CrashTapeRow[]

  // ---- settle flash ----
  flash: 'win' | 'lose' | null

  // ---- house footer (REAL vault data) ----
  house: {
    tvlStr: string // "$1,008,026" whole dollars, or "…"/"—"
    sharePriceStr: string // "$1.0013"
    shareChgStr: string // "Share price $1.0013 · live"
    yieldStr: string // "+0.13%" honest all-time, NEVER a fake APY
    yieldUnit: string // "all-time"
    projFromStr: string // "Your $250"
    projEarnStr: string // "+$0.33"
    projTierStr: string // "+$1.30"  ($1,000 tier)
    utilizationStr: string // "0.1%"
    yourStakeStr: string | null // "$120.00 · 0.01%" when has position, else null
    ctaLabel: string // "Become the house" | "Add to the house"
    hasPosition: boolean
    // deposit sheet
    walletDusdcUsd: number | null
    // The user's REAL stake value (shares × live share price), e.g. "$120.00" — the
    // PROMINENT house number while holding ("Your stake") AND the deposit-sheet
    // figure. null when no position.
    positionValueStr: string | null
    supplyBusy: boolean
    redeemBusy: boolean
    canSupply: (usd: number) => boolean
    error: string | null
    // Epoch ms of the last SUCCESSFUL supply (0 if none). The e05 layer closes
    // the deposit sheet when this changes — ALL house state (your stake, share
    // price, withdraw) lives in the house section, with NO success toast.
    supplyDoneAt: number
  }

  // ---- toasts ----
  error: string | null
  notice: string | null
  // Flavour of the current `notice` toast so the e05 layer can colour it: 'ok' is
  // the neutral blue info line; 'win' is the green WIN settle toast; 'loss' is the
  // red LOSS settle toast (fixes T + U — the concise, coloured win/loss toast that
  // replaces the old cropped "settled — claiming…" string). null == plain notice.
  noticeKind: 'ok' | 'win' | 'loss' | null
  reconstructFailed: boolean

  // ---- GAINS/LOSS results log (top-right, below the account cluster) ----
  // Recent settled outcomes, MOST RECENT FIRST, already capped by App. Each row
  // is one finished position (win/loss + signed P&L). Read live by the e05 layer.
  results: CrashResult[]

  // GLOBAL ACTION LOCK — true while ANY sponsored write (bet, cash out, claim,
  // supply, withdraw, redeem) is in flight. The e05 layer disables + greys out
  // every action control while this is true so a second click (e.g. Enoki slow
  // to sign) can never start a concurrent action. The per-action busy flags
  // (busyUp, held.busyCashout, …) still drive the inline spinner on the control
  // that is actually in flight; this is the cross-action interlock.
  txPending: boolean
}

export type CrashActions = {
  selectStake: (usd: number) => void
  setCustomStake: (usd: number) => void
  placeBet: (side: 'UP' | 'DOWN') => void
  // Cash out ONE side only (its own router::cash_out leg); the other bucket stays
  // open. The two distinct positions exit independently.
  cashOutSide: (side: 'UP' | 'DOWN') => void
  claimBet: () => void
  becomeHouse: () => void // open the deposit sheet (focus the house)
  supply: (usd: number) => void
  redeemHouse: () => void
  withdraw: () => void
  addFunds: () => void // open the external wallet top-up (wallet.suize.io)
  signInGoogle: () => void
  signOut: () => void
  goToBet: () => void
}

// The single object handed to crash-e05's mount(). `data` is read live (the app
// keeps the SAME object reference and mutates its fields each render via
// host.update()); `actions` are stable callbacks. crash-e05 only ever reads
// host.data and calls host.actions.
export type CrashHost = {
  data: CrashData
  actions: CrashActions
}
