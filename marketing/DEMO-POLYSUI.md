# PolySui — 2-minute demo script (DeepBook Predict track)

**The thesis (say it, don't just imply it):** DeepBook Predict is a vol-surface options protocol that only quants can use — so it has no retail flow and shallow liquidity. **PolySui brings the users on one side and the liquidity on the other.** Users on one side, a one-click "Be the House" PLP vault on the other — a two-sided market, not a betting toy.

**Why this framing wins the track:** it maps onto the two things the brief scores hardest — the "alt-flavor consumer frontend" they explicitly ask for, AND the "vault that takes the other side, on-chain LP economics" they list first. Don't pitch "bet on Bitcoin."

**Runtime:** ~2:00. Narration ≈ 300 words; the rest is on-screen action.

---

### 0:00 – 0:14 · COLD OPEN (the simplicity hook)
**[SCREEN:** clean PolySui UI — live BTC price ticking, an UP/DOWN pair, a 15-min countdown. Tap **UP**. Done.**]**

> "That's a live trade on DeepBook Predict — Sui's vol-surface prediction protocol. No gas. No seed phrase. No order book to read. One tap. This is PolySui: how a *normal* person actually uses the most advanced prediction market on Sui."

### 0:14 – 0:32 · THE PROBLEM (the two-sided thesis)
**[SCREEN:** the dense canonical pro Predict UI / a vol-surface chart.**]**

> "Predict is powerful — it prices every strike and expiry off a live volatility surface. But that power is built for quants. Normal people can't touch it — which means no retail flow, which means shallow liquidity. PolySui fixes that from *both* sides: we bring the users, and we bring the liquidity."

### 0:32 – 0:48 · WHAT IT IS
**[SCREEN:** the two tabs — "Predict" (the betting UI) and "Be the House" (the vault).**]**

> "Two halves of one market. On one side, a gasless, gamified front-end — sign in with Google, call Bitcoin up or down in fifteen-minute rounds. On the other, a one-click vault that takes the *other* side of every trade — 'Be the House' — with on-chain LP economics anyone can audit."

### 0:48 – 1:10 · DEMO · the user side (a full, real cycle)
**[SCREEN:** place a $1 UP bet; point at the implied-odds number.**]**

> "Here's a trade — a dollar that BTC rises this round. And the odds you see aren't made up: they come straight from Predict's volatility surface. We just make them human. Behind this one tap is a real `predict::mint`, sponsored — the user never touches gas."

**[SCREEN:** tap "cash out" before expiry → position closes.**]**

> "And I'm not locked in — I can cash out before the round even ends. Mint to redeem, the full cycle, gasless."

### 1:10 – 1:32 · PROOF · on-chain (make it auditable)
**[SCREEN:** the tx on SuiVision — highlight `router::bet` + the 3% rake leg; then the portfolio; then the leaderboard.**]**

> "And it's all real. Here's the transaction on-chain — our router takes a 3% rake, carved out right here, non-bypassable, auditable by anyone. My whole portfolio is reconstructed from the chain: wipe the cache, it's still there. And the leaderboard ranks real *settled* P&L — it mathematically can't be faked."

### 1:32 – 1:52 · DEMO · the house side (the LP credential)
**[SCREEN:** the "Be the House" vault — supply dUSDC, the live NAV.**]**

> "Now the other side. Anyone can be the house — supply into the vault and you're earning the edge on every trade in the protocol. That's Predict's PLP yield, packaged so an outside LP can actually understand it. Liquidity that's always present; economics that are always on-chain."

### 1:52 – 2:05 · CLOSE
**[SCREEN:** the two-sided loop animation → a line reading "redeploys on mainnet day one".**]**

> "PolySui is the consumer layer DeepBook Predict has been missing — users on one side, liquidity on the other, every trade settled on Sui. It's live on testnet today, and it redeploys on mainnet day one. That's how prediction markets get real."

---

## Brief-alignment (why each beat is there — this is what they score)
- **"Alt-flavor frontend… gamified, mobile-first, a behavior the pro UI won't surface"** → the gasless one-tap consumer UX + streaks/leaderboard.
- **"A vault that takes the other side… on-chain LP economics anyone can audit"** (listed FIRST) → Be the House (`predict::supply` PLP).
- **"Settlement leaderboards"** (analytics idea bank) → the Wilson-adjusted, real-settled-P&L leaderboard.
- **Minimum requirement: "integrate Predict on testnet, work end-to-end, we test the entire flow"** → show the full mint → cash-out/redeem cycle, not just a bet.
- **"Projects expected to redeploy on mainnet day one"** → the one track where "mainnet day one" is honest and on-message.

## Film prerequisites
- The demo wallet needs **dUSDC** (Predict's quote asset — NOT official testnet USDC; request via the DeepBook form).
- Sign-in / bet works from the production origin — confirm `polysui.suize.io` is in the backend `ALLOWED_ORIGINS` + Google OAuth origins, and `router::*` is in the Enoki allowlist, or the gasless bet 403s on camera.
- **Verify the full flow live before filming** (the judges test it): sign in → bet (`predict::mint`) → cash out / settle → portfolio updates → leaderboard. The brief literally says "we will test the entire flow."

## Honesty guardrails (do NOT cross)
- **The "Be the House" vault is your strongest track-fit beat — but only demo it if `predict::supply` + redeem + live NAV actually work end-to-end.** The brief tests the full flow and wants real results for vault strategies. If the vault isn't fully working live, frame it modestly ("the other side is a PLP vault") and lean the pitch on the consumer frontend — do not oversell a structured product you can't run on camera. (A backtest/strategy curve is roadmap — don't claim it.)
- **No agent betting** — it isn't built. Don't say or imply the wallet's AI places these trades.
- **Do NOT say bets "settle over x402"** — they're Enoki-sponsored `router::bet` calls; x402 is not in this path.
- **Don't mention a Crash→Suize 2% leg** — it's designed, not wired.
- The displayed odds are honest only if they're derived from Predict's cost/quantity (the vol surface) — confirm that's what the UI shows before claiming it.
