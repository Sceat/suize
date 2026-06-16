# PolySui — UI Law & Build Order (multi-agent consensus, 2026-06-14)

> Owner build bible for the PolySui app (the Crash rebrand → standalone DeepBook-Predict product). Synthesized from a 5-agent consensus (UX-cleanliness · crocodile-brain/viral · hackathon-winning · competitive-teardown → one ranked law). Companion to `OVERFLOW-BATTLE-PLAN.md` (strategy) and `web-design` house law. **This file owns HOW the screens look and behave; build against it.** Code lives in `apps/crash` (dir kept; product = PolySui).

## The one rule above all others
**Quarantine green/red to TRUE signal only** — the UP/DOWN decision buttons (desaturated lean), the chart line-vs-strike tint, win/loss numbers, P&L cells, the settle flash. *Everything else* — balance, odds %, cost, payout, NAV, countdown, leaderboard, agent gauge — is **one blue (#1e7fd6 / #4da2ff) on editorial paper**. Countdown urgency = size/weight, never color. This single rule is the line between premium and ai-slop.

## Type & accent discipline (global)
Every numeral (balance, odds, cost, payout, NAV, countdown, P&L, rank) → **Martian Mono, tabular, right-aligned** so digits don't jitter on count-up. Event titles + kickers → **Newsreader**. All words/labels/buttons → **Space Grotesk**. Spend the blue accent **~3× per screen max** (winning side · active CTA · live cash-out value). Never saturate both UP and DOWN at once.

## DELETE / never build
No leverage · no price-ranges · no 4-asset selector · no candlesticks · no order-book depth · no circular odds dial · no center-FAB · no left-accent-border cards · no 999px pills · no glow-on-everything · no pulsing "live" diodes · no centered-bootstrap column · no emoji-in-UI. **Win by deleting, not by matching yosuku's feature count.** Copy obeys the claim ladder: only *"gasless · x402-compatible by design · we run a live x402 facilitator for Sui"* — never "on x402 / official facilitator" as fact.

## The ranked UI law

**Play (the demo IS this screen)**
1. **Cash-out is the hero.** While a position is live, the bet-ticket TRANSFORMS into one full-width persistent **"Cash Out · $X.XX"** docked in the thumb zone — the largest, most-animated element on screen. Value counts up/down live (~1.5s); small "entry $Y.YY" delta beneath; one tap = animated value-grab into balance + haptic + 3s undo-toast (no confirm modal). Real `router::cash_out`.
2. **Bet-ticket = thumb-zone bottom sheet, one tap to commit.** Stake chips ($1/$5/$25/Max) above two large UP ▲ / DOWN ▼ buttons, each printing its own live cost AND "win $X.XX" **bound to the live quote** (the stale-quote bug sized real money off a static number). No review screen; press-hold-confirm only above the user's confirm-dial threshold.
3. **LiveOddsBar** — one full-width sliding split bar (UP fill left, DOWN right) whose boundary slides each poll, with the two % in Martian Mono **rolling digit-by-digit** over 200-300ms (reuse `AnimatedBalance` tween). Contract cost ("$0.63") as the small line beneath. Kill static labels and any circular dial. *Movement is the product.*
4. **LiveChart** — clean Canvas2D area/line of BTC (never candlesticks) over the **section-scoped** deep-blue void (the void is confined to THIS section; every other tab is flat paper), dashed ENTRY hairline at the strike, fill between line-and-strike tinted bull/bear, a draining 15:00 countdown ring, "Updated Xs ago" gentle pulse — no "LIVE" diode.
5. **Settle = full-bleed takeover that HOLDS until tapped** (not a 1.2s toast — that wastes the peak share/re-bet instant): frozen chart at resolution, payout counting into balance, primary **Share** + secondary **Bet again**. Winner = one restrained flourish + haptic + streak++; loser = **neutral** ("CRASHED · settled below your strike", entry crossed) — no red wall, no confetti.
6. **Near-miss reframe** on a close loss — amber "so close" beat, chart shows how close, one-tap **"Run it back"** on the same market. Amber, never red; the re-bet hook.
7. **RoundStrip** atop Play — "Round closes 04:12 · $X in play · 312 UP / 188 DOWN" from REAL chain/event reads, static hairline row of mono numbers. One honest moving stat beats four static brags.

**Realness pass (cheap, high-leverage — the credibility moat)**
8. **Render the tx digests** (already exist in `App.tsx` ~1336/1501/1867/2149/2325) as clickable **"View on SuiVision ↗"** (`testnet.suivision.xyz/txblock/DIGEST`) on every confirmed bet, cash-out, settle, and Portfolio row. No rival puts their txs one tap from the explorer.
9. **KILL the Math.random tape** (`App.tsx` ~2895-2915) → real feed from `PositionMinted` events (`EVENT_POSITION_MINTED`). Fewer real rows beats many fake ones; a crypto-native judge spots fabricated social proof instantly.
10. **Live on-chain stat strip** under the chart — volume settled · rounds resolved · settlement latency, computed from chain/event reads, never hardcoded.

**Shell & IA**
11. **5-tab mobile-first bottom bar** — Play / Markets / House / Portfolio / Leaderboard, icons + text, 44px+ targets, **Play default**. Active = ink weight + 2px blue underline, never a filled pill. **Agent reached via a persistent header chip** (avatar + "Agent"), NOT a 6th tab — it's an armed *mode*, keeps the bar uncramped.
12. **Streak = consecutive DAYS-WITH-A-BET** (not wins — a win-streak feels rigged and churns losers), giant persistent masthead glyph (typeface, never emoji), at-risk warning + earnable Streak Freeze. Win-quality shown separately as all-time accuracy %.

**Agent (the uncopyable wedge)**
13. Capped sub-account as a physical **depleting fuel gauge** (funded balance = hard cap, blue, draining as it bets) + policy dial segmented control (confirm-each / auto-under-$X / full-auto) + always-visible one-tap red **"Revoke & Sweep"** + live verifiable action feed ("Agent bet $5 UP on BTC · 14:32 · verify ↗", each row links its proof). Consumer word **"sub-account"** only (never leash/pot); **"verifiable log"** never "Walrus". Physics-not-policy made visceral.

**Markets / House / Portfolio / Leaderboard**
14. **Markets grid** — cards (Newsreader title · dominant UP-% in mono · mini LiveOddsBar + sparkline + countdown · "Take a side" → Play pre-filled). BTC card #1, featured/live. Other assets = same silhouette, **desaturated LOCKED state with a real next-open countdown** — never fake odds, never "coming soon".
15. **House (PLP vault)** — NAV-per-share hero + share-price appreciation area chart (**100% blue, never green/red — LPing is not a bet**) + "your stake / current value / lifetime gain" row + equal Supply/Redeem + TVL/APY secondary + a one-line "you are the house — you earn the spread" demystifier. `useHouse.ts` already drives it; surfacing job.
16. **Portfolio** — two zones: **Open** (live positions, per-row ticking cash-out + button) and **History** (settled WIN/CRASHED · stake · signed net P&L mono · SuiVision link each). Reconstruct from on-chain events (`gather_realized_results_from_events` / `gather_settled_results` exist — survives refresh from chain, not localStorage). Hero = aggregate Net P&L; accuracy % secondary. P&L is one of the few green/red-allowed places.
17. **Leaderboard** — rows: SuiNS handle (`resolveSuizeHandle`, else 0x) · ONE metric (net P&L or win-rate) · streak column. Source `PositionRedeemed` events (no invented users — a judge clicking an address must reach a real account). Sticky self-row, top-3 size-emphasis (no medals), accent only on the user's row, "copy their bet" tap (whale-hero engine).

**Hardening**
18. Empty/loading states never blank/spinner-on-void: last-known number at reduced opacity + "Updated Xs ago", ghost rows, the faucet fallback. Bullet-proof the silent-funding + thin-liquidity/settling-round path so nothing renders a dead UI in the 5-min judging window.

## Resolved conflicts (the decisions)
- **UP/DOWN button color:** desaturated green-lean (UP) / red-lean (DOWN) — the decision is the one sanctioned green/red zone — but never two fully-saturated hues at once; rest of screen stays one-blue.
- **Odds:** ship BOTH — a sliding split bar (gut read) WITH rolling-digit % numerals (precise read). One component, strictly better than either.
- **Bet confirm:** one-tap commit is default (first-bet velocity wins the cold open); press-hold-confirm only above the confirm-dial threshold.
- **Settle flash:** HOLDS until tapped (the share window is the #1 viral mechanic) — loss-side neutral but also holds with "Run it back".
- **Agent:** full screen, but reached via the header chip, not a 6th bottom tab.
- **Streak:** consecutive days-with-a-bet, not wins.

## Winning criteria (Overflow judges)
Real-world ≈50%: every on-chain action one tap from a resolving SuiVision link, real event-sourced tape/leaderboard, genuine on-chain cash-out — irrefutable realness beats yosuku's empty frontend. · The 30-second cold open: Google → one-tap bet → real position → profitable cash-out + explorer link, zero friction. · The Agent tab as a visibly-real capped/revocable/logged autonomous bettor (the x402 + on-chain-leash wedge). · Win by deleting (one asset, viscerally). · Movement is the product. · Survives-a-refresh-from-chain-truth.

## Viral criteria
Shareable canvas win card (the whole loop) · daily streak + freeze (Duolingo loss-aversion) · on-chain whale-hero leaderboard + copy-their-bet · live-ticking cash-out tension · near-miss "Run it back" · post-first-win opt-in push · two-sided referral on the share link (rake-free first bet, zero marginal cost on testnet) · identity/badges (lifetime record, best multiple, longest streak).

## Build order
0. **Shell** — 5-tab bottom bar + Agent header chip + token/quarantine discipline. *(in progress)*
1. **Play core loop** — bet-ticket bottom sheet, LiveOddsBar, section-scoped LiveChart. *(the cold open)*
2. **Cash-out hero + settle takeover** — ticket→Cash Out transform, holding takeover (Share / Bet-again / Run-it-back).
3. **Realness pass** — SuiVision links, kill Math.random tape → real `PositionMinted` feed, RoundStrip + stat strip.
4. **Portfolio** — Open/History from events, per-row cash-out + links, hero Net P&L.
5. **Agent tab** — fuel gauge, policy dial, Revoke & Sweep, verifiable feed.
6. **Markets grid** — real BTC card + locked-silhouette cards w/ real next-open countdowns.
7. **House tab** — surface `useHouse` PLP vault (NAV hero + blue share-price chart + Supply/Redeem).
8. **Leaderboard** — `PositionRedeemed` ranking + handles + sticky self-row + copy-their-bet.
9. **Viral layer** — canvas Share card, streak flame + freeze, near-miss reframe, referral, post-win push.
10. **Hardening + demo seed path** — every empty/loading state, bullet-proof silent-funding + thin-liquidity.
