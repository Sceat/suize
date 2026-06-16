## **DeepBook**

Build functional applications, services, vaults, bots, or analytics, single-product or multi-component, in any flavor (consumer, professional, structured, social).

**DeepBook Predict Problem Statement**

- 1st Prize: $35,000
- 2nd Prize: $15,000
- 3rd Prize: $7,500
- 4th Prize: $5,000

***NB:** A total of $7,500 in additional funds will be distributed among notable honorable mentions or as special awards.*

# **DeepBook Predict Problem Statement**

<aside>
💡

Join our Telegram group!  https://t.me/+bZTS2KvwIBQyOGZl

Follow our X for update  https://x.com/DeepBookonSui

Register on deepsurge https://www.deepsurge.xyz/hackathons/b587dc0c-4cb8-4e63-ada5-519df38103bf

Workshop  https://www.youtube.com/watch?v=8m3Q9My-qDo

https://mystenlabs.notion.site/db-predict-workshop-faq

</aside>

Prediction markets today are powerful, but still fundamentally fragmented and shallow. Most live venues either run as CLOB-matched event markets (Polymarket, Kalshi) or as off-chain sportsbooks pretending to be markets. They settle slowly, list a narrow set of binary outcomes, can't price strikes or ranges, and have no real notion of an underlying volatility surface — making serious quant strategies, structured products, and on-chain risk transfer nearly impossible.

As prediction markets evolve from "will X happen" novelty bets into a real piece of crypto market structure, they need a more durable foundation

- the ability to price *every* strike and expiry against a live volatility surface, not just hand-listed events
- short, rolling expiries that work like a real options market — sub-hour cycles, not weekly
- a vault that takes the other side of every trade so liquidity is always present, with on-chain LP economics anyone can audit and compose against
- and primitives that are portable across the wider Sui DeFi ecosystem — composable with margin, lending, structured vaults, and bots — not locked inside a single app

This track challenges you to build an innovative product and tools around **DeepBook Predict**, our programmable, vol-surface-priced prediction protocol on Sui.

Where Predict is today

- The Predict protocol itself is **live on Sui testnet** with rolling sub-hour BTC oracles, a public indexer/API at `predict-server.testnet.mystenlabs.com`, and a `dUSDC` quote asset. Mainnet launch is planned, and projects built during this hackathon are expected to redeploy on day one.
- The DeFi surface you'll compose against DeepBook spot, `deepbook_margin` (margin trading + liquidation), and `iron_bank` (permissioned USDsui supply with the Slush user vault on top) is **already live on Sui mainnet**.

<aside>
💡

You need DUSDC for deepbook predict, this is not the official USDC on testnet.

You can request DUSDC by submitting this form  https://tally.so/r/Xx102L

</aside>

## What you’ll build

Build functional applications, services, vaults, bots, or analytics — single product or multi-component — in any flavor (consumer, professional, structured, social).

To guide you, we're especially interested in:

- **Vault strategies** where capital is allocated programmatically across Predict positions, ranges, and PLP supply (e.g. range-ladder vaults, PLP+hedge vaults, BTC-collateralized premia harvesters, three-protocol margin loops)
- **Cross-venue arbitrage** where bots watch Predict's vol surface against Polymarket / Hyperliquid event markets, or Hyperliquid perps and trade the spread
- **Alt-flavor frontends** including gamified prediction apps, mobile-first PWAs, Telegram bots, or anything that surfaces a behavior the canonical pro UI won't (streaks, social feeds, chat-based trading, watch complications)
- **Analytics and developer tooling** that make Predict legible — live SVI surface viewers, PLP risk dashboards, manager PnL attribution, settlement leaderboards, oracle-feed health monitors

For integrations and tooling, think along the lines of:

- building tokenized share tokens on top of `PredictManager` so vault positions plug into other Sui DeFi (margin collateral, LP composability, structured products)
- composing Predict with `deepbook_margin` (already on mainnet) and `iron_bank` (USDsui supply, already on mainnet) to stack yield, leverage, or hedge exposure across protocols
- creating keeper services and orchestration layers — settled-redeem keepers, oracle monitors, withdrawal-limiter watchers — using `predict::redeem_permissionless` and the public `predict-server` event surface
- building interfaces or developer tools that make it easier to inspect, debug, or manage Predict markets, vault state, and per-user `PredictManager` accounts

Your project could be:

- a user-facing app or trading frontend
- a vault, structured product, or composable token built on top of Predict
- a bot, keeper, or arbitrage service
- a developer tool, SDK, analytics dashboard

### Minimum requirement

In order to be qualified, your project needs to

- Integrate deepbook predict contract on testnet.
- Work end to end if you are building a product, we will test the entire flow.
- Have proper simulation result if you are building a vault strategy.

## Idea bank

Pick one, twist it, or ignore it entirely — these are starting points, not a checklist.

### Vaults & structured products

1. Range Ladder Vault. Auto-deposits user funds into a strip of Predict ranges around the at-the-money strike at each new expiry, then auto-rolls into the next expiry on settlement. Issue a tokenized share so the position is portable across Sui DeFi. Hooks for hackers: pick the strike-width policy (fixed bps, 1σ from SVI, dynamic on realized vol), decide how to handle deep-ITM/OTM rolls, expose a withdrawal queue.

2. PLP + Hedge Vault. Supply quote into `predict::supply` to earn `PLP` returns, and simultaneously buy out-of-the-money binaries via `predict::mint` to cap left-tail drawdown. The product is "PLP yield minus crash insurance" — a much easier sell to outside LPs than raw PLP. Hooks for hackers: tune the hedge ratio dynamically based on vault utilization, sell the hedges back near expiry, expose a clean APY net of insurance cost.

3. BTC-collateral Predict Vault. Accept BTC (xBTC, sBTC, whatever's live), route through DeepBook spot to convert to dUSDC, deposit into a `PredictManager`, run a directional or range strategy, and return BTC-denominated yield to the user. Hooks for hackers: choose the strategy (delta-neutral premia harvest vs. directional momentum), price the FX leg honestly, handle settlement-day swap-back.

4. Three-Protocol Margin Loop. Borrow dUSDC on `deepbook_margin` against an `iron_bank` USDsui share token, deploy the borrow into Predict ranges, repay from settlement payouts. One team, three protocol logos — a flagship "this is what Sui DeFi composability actually looks like" demo. Hooks for hackers: design the liquidation path, bound LTV against worst-case Predict outcomes, expose a single PTB that opens the whole stack atomically.

### Frontends & consumer apps

5. Telegram Quick-Predict Bot. Commands like `/up 70k 15m 100usdc` resolve to a `predict::mint`, an inline keyboard offers "redeem now / show PnL / share to group," and settlement triggers a DM with the result. Lowest-friction onboarding for non-crypto-native users — the bot creates a `PredictManager` on first use and faucets dUSDC behind the scenes. Hooks for hackers: group-chat tournaments, copy-trading another user's bot wallet, leaderboards inside a single chat.

6. Streaks & Leaderboard PWA. Daily binary picks ("BTC up or down by close"), per-user streaks, weekly prize pools. Gamified retention loop on top of Predict's mint/redeem flow. Hooks for hackers: NFT badges for streaks, social graph from on-chain manager-to-manager interactions, mobile-first install flow.

### Bots, keepers, and arbitrage

7. Vol-Arb Bot: Predict ↔ Polymarket. Back-solves Predict's implied vol from `OracleSVI` (or directly evaluates the SVI params), compares against Polymarket BTC option smile at the matching expiry, and trades the spread when it exceeds a threshold. Stretch: delta-hedge the binary on Hyperliquid perps so the bot's PnL is pure vol edge. This is the single most realistic mainnet-day-one strategy — and it doubles as live stress test of the SVI feeder. Hooks for hackers: handle stale SVI updates gracefully, size by Kelly fraction, add a kill switch on feeder lag.

8. Settled-Redeem Keeper Network. Watches for settled oracles, scans the indexer for un-redeemed positions and ranges, and calls `predict::redeem_permissionless` in a single PTB to claim payouts on behalf of the owner — splitting a tip from the payout. Trivial to start, runs unattended, generates lots of low-friction testnet tx. Hooks for hackers: multi-keeper coordination so they don't collide on the same position, MEV-resistant submission, opt-in vs. opt-out tipping policies.

### Analytics & developer tooling

9. Predict Surface Studio. Live 3-D volatility surface (strike × expiry → IV) streamed from `oracle::OracleSVIUpdated` events, with a time-travel slider for replaying recent updates and an arbitrage-free checker that flags butterfly or calendar violations. A recruiting tool for sophisticated traders to sanity-check the protocol. Hooks for hackers: side-by-side comparison vs. Polymarket smile, alerts on smile shape change, embeddable widget for other Sui frontends.

10. PLP Risk Dashboard. Vault utilization, withdrawal-limiter token-bucket state, per-oracle exposure breakdown, and a "what-if" scenario simulator showing PLP PnL under a ±5σ BTC move. Directly addresses the "is PLP safe?" question that gates serious LP TVL. Hooks for hackers: historical drawdown replay, per-strike heatmap of vault inventory, exportable risk reports for institutional LPs.

## References to use:

- DeepBook Predict codebase (protocol, current testnet deployment, integration model)
    - remember to use branch `predict-testnet-4-16` instead of `main` branch
- Deepbook sandbox (1 line deployment of entire deepbook stack on your local machine, predict support coming soon)
- Deepbook predict doc
- Deepbook v3 doc
- Deepbook margin doc

### Join the DeepBook Builder Group

For questions, discussions, and direct support from the DeepBook team, join the official Telegram group: https://go.sui.io/ofw-deepbook-tg
