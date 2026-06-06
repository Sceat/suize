import { PRICE_SCALE, DUSDC_SCALE } from './config'

// A 1e9-scaled price (strike/spot) -> formatted "$67,000" style.
export const fmt_strike = (p: bigint): string =>
  '$' +
  Math.round(Number(p) / Number(PRICE_SCALE)).toLocaleString('en-US')

// 1e6-scaled dUSDC base units -> human dollars number.
export const dusdc_to_usd = (units: bigint): number =>
  Number(units) / Number(DUSDC_SCALE)

// ===========================================================================
//  THE ONE MONEY RULE — applied to every displayed USD sum across the app.
//    value < 10   -> 1 decimal, e.g. "0.5", "5.3", "9.4"
//    value >= 10  -> 0 decimals + thousands separators, e.g. "53", "1,009,080"
//  Display rounding ONLY — never touches bet math/sizing. Returns the bare
//  number string (no "$"); callers prefix the sign + "$" themselves so a
//  negative reads "−$5.3", not "$−5.3".
// ===========================================================================
export const fmt_amount = (n: number): string => {
  if (!Number.isFinite(n)) return '0'
  const v = Math.abs(n)
  return v < 10
    ? v.toFixed(1)
    : Math.round(v).toLocaleString('en-US')
}

// A plain-USD number -> "$" + the money rule. Sign sits OUTSIDE the "$"
// ("−$5.3" / "$53"). The single helper for any non-compact displayed sum.
export const fmt_usd_amount = (n: number): string =>
  (n < 0 ? '−' : '') + '$' + fmt_amount(n)

// dUSDC base units -> "$" string under the money rule (e.g. "$53" / "$5.3").
// The `digits` arg is gone: the rule decides decimals, not the caller.
export const fmt_usd = (units: bigint): string =>
  fmt_usd_amount(Number(units) / Number(DUSDC_SCALE))

// Signed P&L under the money rule: "+$53" / "−$5.3" (Unicode minus for losses).
// Sign always shown; "$" follows the sign. The single helper for every P&L row,
// delta and signed earnings figure.
export const fmt_signed_usd = (n: number): string =>
  (n < 0 ? '−' : '+') + '$' + fmt_amount(n)

// ----- CENTS variants — KEEP 2 DECIMALS for small values (the "+0.0$" fix) -----
// The money rule above rounds sub-$10 to ONE decimal, so a real +$0.04 P&L
// collapsed to "+$0.0" and a +$0.03 win read as "+$0.00"→"+$0.0"... ZERO. For
// realized P&L rows + the toast + the live position figures (often a few cents on
// a small wager) we show 2 DECIMALS under $10 so the cents always read; at/above
// $10 we defer to the whole-dollar + separators rule. Display ONLY — never touches
// bet math. The history row + the settle toast both use fmt_signed_cents so they
// agree to the cent for the same outcome.
export const cents_amount = (n: number): string => {
  const v = Math.abs(n)
  if (v < 10) return v.toFixed(2)
  return Math.round(v).toLocaleString('en-US')
}
// dUSDC base units -> "$0.04" / "$5.04" / "$1,234" (cents kept under $10).
export const fmt_usd_cents = (units: bigint): string =>
  (units < 0n ? '−' : '') +
  '$' +
  cents_amount(Number(units) / Number(DUSDC_SCALE))
// Signed P&L with cents: "+$0.04" / "−$0.12" / "+$53" (sign always shown).
export const fmt_signed_cents = (n: number): string =>
  (n < 0 ? '−' : '+') + '$' + cents_amount(n)

// A [0,1] fraction -> "12%" style percent string (0 decimals by default).
export const fmt_pct = (frac: number, digits = 0): string =>
  `${(frac * 100).toFixed(digits)}%`

// Compact a plain-USD number so it never clips in a chip/card. FOLLOWS THE ONE
// MONEY RULE for everything below the k/M collapse: value < 10 -> 1 decimal
// ("5.3"), value >= 10 -> 0 decimals + thousands separators ("53", "1,500").
// Crop-prone magnitudes still collapse: thousands -> "k" (150000 -> "150k",
// 12500 -> "12.5k") and millions -> "M" (1_250_000 -> "1.3M"). NEVER shows 2
// decimals anywhere (k/M capped at 1, the sub-10 case at 1). Strips trailing-
// zero decimals on k/M so "2.0k" reads "2k". Used wherever a raw toLocaleString
// would overflow its container.
export const fmt_compact = (n: number): string => {
  if (!Number.isFinite(n)) return '0'
  const sign = n < 0 ? '-' : ''
  const v = Math.abs(n)
  const trim = (s: string): string =>
    s.includes('.') ? s.replace(/\.?0+$/, '') : s
  if (v >= 1_000_000) return `${sign}${trim((v / 1_000_000).toFixed(1))}M`
  if (v >= 10_000) return `${sign}${trim((v / 1_000).toFixed(1))}k`
  // below the k collapse, defer to the shared money rule (1 decimal under $10,
  // whole + separators at/above $10).
  return `${sign}${fmt_amount(v)}`
}

// Compact USD with a leading "$" (e.g. 150000 -> "$150k"). Convenience wrapper
// for the bet WIN headline, balance couplet and any value chip that can overflow.
export const fmt_usd_compact = (n: number): string => '$' + fmt_compact(n)

// THE BALANCE — cents-visible so any realized change (e.g. a +$0.45 win bumping a
// $148 balance) is VISIBLE, while a fat testnet balance still never clips. Below
// the k collapse we show 2 DECIMALS ("$148.45", "$5.04", "$0.30") so a sub-dollar
// settle change reads; thousands collapse to k/M ("$12.5k", "$1.25M") to fit the
// couplet box. dUSDC base units in. Display only — never touches bet math.
export const fmt_balance = (units: bigint): string => {
  const n = Number(units) / Number(DUSDC_SCALE)
  if (!Number.isFinite(n)) return '$0.00'
  const sign = n < 0 ? '−' : ''
  const v = Math.abs(n)
  const trim = (s: string): string =>
    s.includes('.') ? s.replace(/\.?0+$/, '') : s
  if (v >= 1_000_000) return `${sign}$${trim((v / 1_000_000).toFixed(2))}M`
  if (v >= 10_000) return `${sign}$${trim((v / 1_000).toFixed(1))}k`
  // below the k collapse: full cents + thousands separators ("$1,234.56").
  return `${sign}$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Truncate a 0x… address to "0x12ab…cd34" for compact display. Returns '' for
// a missing address so callers can render a placeholder.
export const fmt_addr = (addr: string | null | undefined): string => {
  if (!addr) return ''
  return addr.length <= 12 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// mm:ss countdown from a millisecond delta. Clamps at 0.
export const fmt_countdown = (ms: number): string => {
  if (ms <= 0) return '00:00'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
