# Crash → Overflow 2026 Battle Plan — beat yosuku.xyz on the DeepBook Predict track

> Owner strategy doc. Companion to `GROWTH-PLAN.md` (distribution) and `DIRECTION.md` (brand/assets). This file owns **how we win the DeepBook Predict track at Sui Overflow 2026** against the named rival `yosuku.xyz`. Built from a live-product autopsy (Playwright) + a 7-agent recon sweep on 2026-06-14, each load-bearing fact carrying its confidence + source. **Calibrated honesty is LAW here too** — every "unconfirmed" flag is kept on purpose; we do NOT build a strategy on a hallucinated rubric.
>
> Deadline: **June 21 2026** (owner-locked). The win is a flagship demo that makes a judge believe **this is a company that will grow, and it's real.**

---

## 0. Verdict (read this first)

**As-is, Crash is a strict, narrower SUBSET of yosuku.xyz and loses.** Yosuku ships our exact concept (one-tap 15-min BTC binary, cash-out, "Be the House" PLP) *plus* ranges, 4 assets, 3× leverage, an agent keeper, and a published open-source SVI pricing SDK + MCP — wrapped in an Awwwards-tier dark-editorial brand. We cannot out-feature them on the surface they already own.

**But yosuku is a beautiful ghost town with a closed, empty product, and they have no payment rail.** We win by **changing the axis of competition**, not cloning:

1. **Out-execute on the consumer spine** — the track *explicitly invites* a gamified, mobile-first, one-tap prediction PWA (their words). Win it on focus, realness, gasless onboarding, and the Polymarket dopamine loops yosuku never bothered to build.
2. **Add the one wedge a solo Predict-frontend builder structurally cannot copy** — a **personal agent that bets on DeepBook Predict from a capped, revocable, Walrus-logged sub-account, and can pay its own way in via the Suize x402 rail**, exposed through an **MCP**. This is the Agentic-Web × DeepBook intersection. Suize already owns the rail (x402 facilitator, 21/21 E2E green). Yosuku's "agent" has a key in an env var and no way to pay.
3. **Make the judges believe it's solid + will grow** — verifiable on-chain economics (auditable PLP + on-chain rake), an open repo (theirs is empty), a "Be the House" vault with a real simulation, and a credible mainnet-day-one plan.

**Honest probability:** with the rebrand + the agent/MCP/payments wedge shipped and a flawless ≤5-min demo, this is a **legitimate top-3-on-the-DeepBook-track contender** — because we'd be the only entry sitting on a real agentic-payment rail. Without the wedge, it's a coin-flip skin fight we're slightly behind on. The wedge is the plan.

---

## 1. The rival, verified — `yosuku.xyz`

Live autopsy (2026-06-14) + npm/GitHub/source verification. Confidence noted; **calibrated honesty — do not repeat the overstatements in any public copy.**

### What's real and impressive (steal the *feeling*, not the code)
- **Feature-for-feature our concept, broader.** 15-min BTC binary, cash-out at the live bid ("Leave when you like"), "Be the house" PLP vault, range positions across the vol surface, optional 3× leverage ("yolev"), 4 assets on the marketing surface. Editorial "予測 · Edition One · Tokyo 2026" brand, a radial probability dial, kanji section heads. **Design is their sharpest weapon.** [HIGH — live site]
- **A genuinely real SVI→N(d2) vol-surface pricing engine, open-sourced.** `@yosuku/deepbook-predict` (npm, MIT, v0.3.0) ships `src/pricing.ts` with real `decodeSvi()`, `totalVariance()`, `digitalUp()` (N(d2)), Abramowitz-Stegun erf. Not marketing — verified code. This is their judge-magnet: reusable ecosystem infra the official `@mysten/deepbook-v3` SDK lacks. [HIGH — source-read]
- **The first MCP for DeepBook Predict.** `@yosuku/deepbook-predict-mcp` (npm v0.1.0): `list_markets, quote_market, house_health, market_activity, open_position, redeem_winners`. [HIGH — npm]
- **A documented agent + Walrus memory.** Docs describe a "Bellkeeper" autonomous strategist trading a contract-custodied vault, "signed inside a TEE," "hard caps enforced on-chain," plus a Seal-encrypted Walrus memory module. [HIGH it's *claimed*; the on-chain TEE-attestation re-verification has **no inspectable code** — likely roadmap.]

### Where they're soft (this is where we punch) — verified
- **The flagship app is CLOSED and the repo is EMPTY.** `yosuku-lab/yosuku` = 0 KB, "This repository is empty" (created 2026-06-08, pushed once). Only the *SDK* and *MCP* are public; the live frontend, the Bellkeeper agent, and the Move vault are **un-inspectable**. Judges can verify their SDK but **cannot verify their product**. We open-source our full app + router → **our** claims become the verifiable ones. [HIGH — GitHub API]
- **A polished site with no audience.** Every web/X/Telegram search for yosuku/`@cyberX___`/Bellkeeper returned **zero** product results — no demo video, no launch thread, no press. SDK repo: 3 stars (all self-affiliated), 1 fork. Live markets read `$546` total volume, `434` wallets, "0 traders" / flat 50/50 on most markets. **Polished site, invisible product.** [HIGH]
- **Solo founder, same profile as us.** GitHub `shaibuafeez` ("Cyber", `@cyberX___`), 6 followers, predict-sdk = 1 contributor. No org, no co-founders, racing the same June 21 deadline. Beatable on polish + execution + a louder launch. [HIGH]
- **No gasless onboarding; key-holder agent flow.** They *do* list zkLogin sign-in (don't overclaim "no zkLogin"), but there's **no Enoki-sponsored gasless write and no one-tap mobile flow**, and their agent/MCP path needs a raw `PREDICT_AGENT_KEY` + a manual `PredictManager` ceremony. **Our gasless Google one-tap + capped-agent flow is the defensible contrast.** [HIGH]
- **Broad-but-thin, self-disclosed.** Their own `/docs` admits "BTC only… more assets at mainnet," "testnet only," "audits in progress." The 4-asset/leverage/ranges surface is largely aspirational. [HIGH]
- **They optimize for judges and assume fact-checking** (changelog: "award-winning README rewrite," "soften live-parity wording per independent review"). **So must we — every Crash claim must be independently reproducible, or it backfires.** [HIGH]

> **Both of us wrap the SAME shared Predict primitive + the same indexer** (`predict-server.testnet.mystenlabs.com`). There is **no protocol-layer moat for either side.** The moat is execution + the payment rail + on-chain enforcement. Sell THAT.

---

## 2. The prize, the rubric, the calendar — what "winning" means

**Confidence discipline:** the participant handbook is a JS-only Notion page our verifier could not re-fetch, so several "exact" figures are **single-sourced and unconfirmed**. The **DeepBook problem statement you pasted is ground truth.** Plan as if the handbook numbers are right (they're directionally safe), but never cite them publicly as fact.

| Fact | Value | Confidence |
|---|---|---|
| DeepBook specialized track pool | **~$70K** (overflow.sui.io; $140K Walrus+DeepBook pool ÷ 2) | MED — site-level; exact 1st–4th split conflicts ($35/15/7.5/5 vs $30/15/10/7.5) |
| Reported judging rubric | **Real-World Application 50% · Product & UX 20% · Technical 20% · Presentation & Vision 10%** | LOW-MED — handbook only, not independently confirmable. **Plan as true.** |
| Track explicitly invites | "gamified prediction apps, mobile-first PWAs… streaks, social feeds"; idea-bank #6 = a BTC up/down streaks/leaderboard PWA | **HIGH — your pasted problem statement** |
| Minimum bar | integrate Predict testnet contract · **"we will test the entire flow"** end-to-end · **simulation result** required for a vault strategy | HIGH (pasted statement) / MED (exact wording) |
| Submission | ≤5-min demo video (YouTube) · **public** GitHub repo · testnet OR mainnet both qualify · logo · package id | MED — handbook |
| Deadline | **June 21 2026 submission** | **HIGH — owner-locked** |
| After submission | shortlist ~July 8 → **live Demo Day ~July 20–21** (present to judge panel) → winners ~Aug 27 | LOW — handbook, unconfirmed dates |
| Payout | 50% on win / 50% after mainnet deploy (community votes are part of judging) | LOW (split) / MED (community votes confirmed for 2025) |
| 2025 scale | 599 submissions, ~36 winners — **judge fatigue is real; the first 30s decides the shortlist** | HIGH |
| 2025 winners' DNA | working live product + ONE crisp use case + deep Sui-primitive use (Walrus/Seal/zkLogin/DeepBook/Pyth) | HIGH |

**Strategic read:** if the rubric is ~50% real-world + 20% UX, a focused, *real*, low-friction consumer product that solves "Predict is pro-only and friction-heavy" beats a broad-but-thin quant showcase — **as long as** it also lands enough Innovation/Technical (the agent + payments wedge) to not read as "just a betting skin." Two surfaces to win: the async shortlist screen, then a live pitch. Rehearse both; cue a fallback recording for the live demo.

---

## 3. The product — three layers (what to build, strip, defer)

The rebrand is **one consumer product with a depth wedge underneath.** Keep the spine narrow and flawless; the depth is the differentiator, not feature-count.

### Layer 1 — The consumer dopamine spine (wins Real-World 50% + UX 20% + community votes)
Keep + sharpen what we have; add the Polymarket loops (§4).
- One-tap **gasless** Google-zkLogin 15-min BTC up/down binary + the live **cash-out** as the emotional hero (the continuous variable-ratio dopamine stream — the most engagement-sticky mechanic, per the science).
- **Public leaderboard** (the Théo/whale-hero engine) + **streak** + weekly board — *built straight off Predict's free on-chain event surface*, the exact idea-bank #6 the track named.
- **Price-as-live-odds**: surface the **implied probability** (the vol-surface-derived odds) on the entry line — "the market's live read of BTC." Makes checking feel informational, not just gambling, and quietly proves we use the surface.
- **Near-miss + probability-move pushes**: "you were 0.2% from winning"; "BTC just crossed your line — you're winning now," P&L animated 200–300ms.
- **Better brand + UI than yosuku.** Their lane = quiet dark-editorial Tokyo quant. Ours must be an equally-premium but **more alive, visceral, mobile-first** identity that's unmistakably not a clone. (Direction = owner call; see §8.)

### Layer 2 — Make judges believe it's solid (wins Technical 20% + the long-term-value half of the 50%)
- **"Be the House" as a real strategy with a simulation result** (the track *requires* a sim for a vault). Upgrade `useHouse.ts`'s LP panel into a real PLP position view with NAV, utilization, and a simulated/backtested PnL curve — mirrors what **DeepMaker won 2025 with**. Not a deposit button.
- **Auditable on-chain economics.** Open-source the full app + `crash_sui::router`; the on-chain rake + PLP are inspectable by package id (theirs aren't). **Evaluate switching/augmenting the bespoke 3% router to Predict's native `builder_code.move` `BuilderCode` fee attribution** — "we monetize the way DeepBook intended," a cheap credibility win with a DeepBook judge.
- **Honest realness signals**: real testnet volume from real users before June 21 (community votes + the "is it real" filter).

### Layer 3 — The unbeatable wedge: agent + MemWal + revocation + the Suize payment rail + an MCP
This is the whole reason we win. Nobody else on this track sits on a payment rail.
- **A personal agent that trades Predict from a capped sub-account** — the leash: *balance = the hard cap*, one-tap **kill/revocation**, every mint/redeem **logged to Walrus** (MemWal = "it remembers your preferences"). "Autonomy you switch on." This is Suize's thesis pointed at DeepBook.
- **An MCP for the product** (`suize`-branded) so an external agent (Claude/Cursor) can play — **and, the finale, an agent can PAY to play via the Suize x402 rail.** Yosuku's MCP needs a raw key and can't pay. Ours: agent authenticates → pays via x402 → bets via MCP → spends from the capped leash → Walrus-logged → revocable. "The first DeepBook product an AI agent can pay its own way into."
- **Oversell, but within the claim ladder (LAW):** MemWal/limits/revocation get a confident, ambitious narrative — but a feature is described **as it works today or it is absent**; no "coming soon" on a public surface, no false "live." Roadmap lives in the pitch as *vision*, never as shipped fact. (§7 ledger governs this.)

### Strip / defer (their features that are vapor or won't move users)
- **Multi-asset (ETH/SOL/SUI)** → a tasteful **"more markets unlocking"** teaser in-product; BTC-only is the focused, in-scope hero (the track is BTC-only on testnet anyway). Don't fake 4 live assets like they do.
- **3× leverage / ranges / Seal "strategies marketplace"** → out of v1. Retail is directional one-tap (Polymarket: 30% traded *only* one side). Ranges/leverage are quant-trader surface that dilutes the consumer story and the demo. Optional "pro mode — soon" at most.

---

## 4. Polymarket's playbook — what to steal, with Sui sauce

Polymarket proved the category (2024 election: ~$3.6B headline / ~$391M rigorous exchange-equivalent; MAU ~80K → ~450K). The transferable mechanics:

| Polymarket lever | Why it worked (the science) | Crash adaptation |
|---|---|---|
| Public leaderboard + a whale hero ("Théo $45M") | Social proof + a screenshot-worthy narrative | On-chain leaderboard from Predict events; surface a session "whale"/top streak |
| Price = live odds, treated as news | Hayek price-as-information; checking feels informational (IEM beat polls 74%) | The entry line + implied prob = "the market's live read of BTC" |
| **Zero fees first**, monetize later | Win the land grab before taxing it | Keep friction near-zero; rake is fine but **lead the pitch with instant, dispute-free settlement** (<400ms oracle, no UMA human window) |
| Variable-ratio + instant outcomes | Hardest reward schedule to extinguish | **Live cash-out** turns one 15-min bet into a continuous dopamine stream — make it the hero |
| (What they ADMIT they never built) re-engagement loops | "No reason to return between events" is the #1 killer | **Always-on**: a fresh fairly-priced 15-min BTC market every 15 min, 24/7 — Crash's single biggest structural edge over an event-shaped product |
| Bridging/KYC/gas friction killed conversion | UX research: friction at the door kills crypto-prediction | **Gasless Google one-tap** — "your grandma can trade Predict, no wallet, no seed, no gas" |

**The two science-backed killers of prediction products are illiquidity and event boom-bust. DeepBook's always-on PLP vault + rolling 15-min oracle kill both by construction. Lead the demo on exactly that.**

---

## 5. The demo (the thing we actually win on)

≤5-min video AND a live Demo Day. Win the first 30 seconds with the **live product doing the thing** — never a logo or a problem slide.

1. **0:00–0:30 — the hook.** Google login → one tap → a **real gasless BTC bet lands and settles sub-second on testnet**, on camera. "No wallet. No gas. No idea what a blockchain is."
2. **0:30–1:30 — the dopamine.** Live P&L ticking over the entry-line chart; the price crosses the line (near-miss); cash out a win. Leaderboard + streak flash.
3. **1:30–2:00 — it's real economics.** "Be the House" PLP with the simulated PnL curve; the on-chain rake + auditable LP, by package id; "open repo, go check."
4. **2:00–4:00 — the wow nobody else can show.** A **personal agent** places a capped bet for the user (or an external Claude/Cursor agent via the **MCP pays via Suize's x402 rail and plays**), the Walrus action-log scrolls, then **one-tap kill / revoke**. "An agent that bets BTC for you, can pay its own way in, can never overspend its leash, and you can pull the plug in one tap."
5. **4:00–5:00 — vision + the close.** Always-on markets, more markets unlocking, mainnet-day-one plan. **One line:** e.g. *"The one-tap way anyone — or any agent — bets BTC on Sui."*

**Live-demo discipline:** rehearse to never depend on flaky network; have a cued fallback recording; pre-fund the demo accounts; pre-warm the oracle/market.

---

## 6. Build punch-list (prioritized, June 14 → June 21)

> P0 = must ship for the demo to land · P1 = strong rubric points, ship if time · P2 = vision/teaser only. Effort is rough.

**P0 — the wedge + a flawless spine**
- [ ] **Personal agent path on the capped sub-account** (reuse the wallet leash model): place bet/cash-out from the agent address, balance = hard cap, one-tap kill, Walrus-log each action. *(M–L)*
- [ ] **MCP for the product** (`suize_*` predict tools) + **x402 pay-to-play** through the existing facilitator (agent authenticates → pays → plays). The user-asked, uncopyable finale. *(M)*
- [ ] **Open-source the full app + `crash_sui::router`**, clean README that is an actual integration guide (theirs isn't). *(S)*
- [ ] **Bulletproof end-to-end gasless flow** ("we will test the entire flow") — fix the chart tab-hide bug ✅ done; sweep every path for breakage. *(S–M)*
- [ ] **Rebrand shell** (name, mark, palette, copy) — see §8. *(M)*

**P1 — believe-it's-solid**
- [ ] **Leaderboard + streak from on-chain Predict events** (idea-bank #6, free indexer surface). *(M)*
- [ ] **"Be the House" → real strategy + simulation result** (NAV/util/backtested PnL). *(M)*
- [ ] **Surface the vol-derived implied probability** as the live odds. *(S)*
- [ ] **Near-miss + probability-move push/animation.** *(S)*
- [ ] **Evaluate native `BuilderCode` fee attribution** vs the bespoke router. *(S–M)*

**P2 — vision/teaser (oversell, honestly framed)**
- [ ] "More markets unlocking" teaser · "pro mode (ranges/leverage) soon" — as *vision in the pitch*, not as live UI claims.
- [ ] Mainnet-day-one readiness one-pager (unlocks the back-half prize + the long-term-value score).

---

## 7. The honest-claims ledger (calibrated honesty — LAW)

Yosuku assumes judges fact-check; so do we. **Every public claim sits at the rung that is TRUE on submission day.** No "coming soon" on a public surface; a feature is shown working or it's absent; vision lives in the spoken pitch as vision.

| Claim | Rung allowed | Notes |
|---|---|---|
| Gasless Google one-tap, sub-second settlement | **Live fact** | Demo it on camera |
| Live cash-out, leaderboard, streaks | **Live fact** *(once built)* | Must be real in the repo + demo |
| Personal agent: capped leash, kill, Walrus log | **Live fact** *(once built)* | This is the wedge — it MUST be real, not a slide |
| Agent pays via x402 / MCP | **Live fact** *(facilitator is 21/21 E2E)* | Wire it for the demo |
| MemWal "remembers you" | **Ambitious-but-true** | Ship a thin real memory; describe scope honestly |
| Multi-asset / ranges / leverage / mainnet | **Vision only, spoken** | Never rendered as a live UI claim |
| vs yosuku | "we open-source the whole product; an agent can pay its own way in" | Don't claim "no zkLogin"; don't name their "TEE" as Nautilus |

---

## 8. Open decisions for the owner

1. **Rebrand name + identity.** Yosuku owns quiet dark-editorial Tokyo quant. We need an ownable, more-alive, mobile-first consumer identity. Directions to react to: a punchy single-word verb/energy name (visceral, fun), vs. keeping "Crash" but re-skinning. *Owner's call — I'll spin variants on request.*
2. **Scope line:** confirm v1 = BTC-only one-tap + agent/MCP/payments wedge, with ranges/leverage/multi-asset deferred to spoken vision. (Recommended.)
3. **Rake vs `BuilderCode`:** keep the 3% router, or move to native builder-fee attribution for DeepBook-judge credibility?
4. **Agent narration model:** Haiku free / Sonnet paid is the Suize line; for the demo agent, confirm which model narrates (the number-wall LAW holds — the deterministic core owns every on-chain amount).

---

## 9. Sources + confidence

- **Live autopsy (HIGH):** yosuku.xyz home + market pages, network calls (`/api/predict/managers`, `/api/predict/trades/*`, Pyth Hermes), "Sui Testnet · v0.4.1", "Connect Wallet" (no gasless).
- **Verified (HIGH):** `@yosuku/deepbook-predict` + `-mcp` on npm (source-read SVI engine); `yosuku-lab/yosuku` empty repo; founder `shaibuafeez`/`@cyberX___`; zero search footprint; shared Predict package `0xf5ea2b37…` + indexer.
- **Track ground truth (HIGH):** the pasted DeepBook Predict problem statement (gamified PWA / streaks / idea-bank #6; minimum requirements; testnet; $70K context).
- **Unconfirmed — plan-as-true, never cite publicly (LOW-MED):** the 50/20/20/10 rubric, the exact prize split, the July/Aug calendar, the 50/50 mainnet payout — all single-sourced to a Notion handbook our verifier could not retrieve. June 21 deadline = owner-locked.
- Polymarket science: arxiv 2603.03136 (volume anatomy), Dune/press MAU figures, IEM accuracy, addiction/near-miss/loss-chasing literature, prediction-market UX research.
