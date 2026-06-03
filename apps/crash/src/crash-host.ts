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
  enabled: boolean // false when locked / unaffordable / no quote / market not active
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
  id: number // monotonic key for dedupe/render (epoch ms of capture)
  isUp: boolean
  won: boolean
  pnlUsd: number // signed realized P&L in dollars (+win / −loss)
}

// The held position cluster (replaces the bet controls while a bet is live).
export type CrashHeld = {
  isUp: boolean
  entryStr: string // "ENTRY $67,000"
  label: string // "CASH OUT FOR" | "SETTLING…" | "FINAL PAYOUT"
  cashoutStr: string | null // "$0.74" live bid, null when not quoteable yet
  deltaStr: string // "+0.24 · PAID $0.50"
  winning: boolean
  meterPct: number // 0..100 fill of the cash-out meter (payout vs $1)
  pending: boolean // oracle pending_settlement (trading frozen)
  settled: boolean // oracle settled -> auto-claim path (button shows CLAIMING…)
  countdownText: string // mm:ss for the held round (or special "DONE"/"…")
  countdownSpecial: 'done' | 'pending' | null
  busyCashout: boolean
  busyClaim: boolean
  canCashout: boolean
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
    positionValueStr: string | null // "$120.00" when has position
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
  cashOutBet: () => void
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
