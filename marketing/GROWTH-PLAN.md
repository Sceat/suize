# Suize — 30-Day Traction War Plan (June 11 → July 11, 2026)

> Owner strategy doc. Companion to `DIRECTION.md` (which owns brand/assets/production — this file owns **distribution, contacts, and the calendar**). Built from a 9-agent research sweep on 2026-06-11 (~470 web fetches; every load-bearing fact below carries its source; "unverified" flags are preserved on purpose — calibrated honesty applies to our own ops docs too).
>
> Mission: **1,000 merchants + 10,000 users in 30 days**, feeding the late-June pre-seed ($1–1.5M at $12–18M cap).

---

## 0. Verdict & honest math (read this before the tactics)

**The goals are reachable only under precise definitions — and the definitions are also what protects the raise.**

| Goal | Honest path | Base case | Stretch |
|---|---|---|---|
| 1,000 merchants | Tier-0 pay-link = activation, + one bulk event | 300–600 activated | 1,000 with ONE bulk hit (front-page Show HN, Apify deal, or MCP-directory badge) |
| 10,000 users | Open-door wallet + referral loop + deposit-gated quests + UGC swarm + breakout video | 4–12k signups | breakout video or ecosystem RT spike carries the rest |

- Funnel math (launch-playbook lane): the full organic stack (HN front page 5–30k visits + PH 2–5k + Reddit 5–10k + ~1M X views ≈ 5–15k clicks) yields **25–60k qualified visits → 1–4k signups** at dev-tool conversion (3.5–7.1%). 10k consumers needs the quest/referral/UGC blend on top — or one outlier moment. [flint.com benchmarks; danfking.github.io Show HN study]
- Merchant math (merchant lane): concierge 25–50 + hackathon cross-team 20–100 + Reddit/HN/content 150–500 + cold outbound 30–80 ≈ **300–600 base**; the last 400 require a bulk hit. [prospeo.io cold-email data; vibecontentcreation.com]
- **Metric definitions (LAW for all public comms):**
  - "Merchant" reported externally = **received ≥1 real paid charge**. Tier-0 pay-link minted = "activated" (internal funnel metric only).
  - "User" reported externally = **funded sub-account** (≥$1 deposit). Raw Google sign-ins and quest participants are NEVER published.
  - Why law: 2026 VC consensus explicitly discounts quest/testnet/signup counts as sybil vanity ("helicopter money… attracts artificial activity that disappears" — Haseeb Qureshi/Dragonfly; "revenue: sticky vs cyclical" — Ippolito/Blockworks). Paying merchants + retention cohorts + on-chain fee revenue are the ONLY three numbers we publish. [cryptoslate.com; vaasblock.com]

**Sequencing truth:** marketing cannot outrun the product. Four build items gate the whole plan — see §11. The mainnet publish is the single biggest unlock (it arms "live", the traction dashboard, paid tests, and every press pitch).

---

## 1. Three urgent corrections (factual landmines found by research)

### 1a. ~~Overflow calendar conflict~~ — RESOLVED (owner, 2026-06-11)
**June 21 submission deadline confirmed by owner; the dates the research pulled from overflow.sui.io were stale.** Plan runs as written. Still keep the 2025-precedent community-vote window on the radar (vote.sui.io ran June 14–20 in 2025, 195k on-chain votes) — when 2026 voting opens, run the vote-mobilization push.

### 1b. ⚠️ Sui is NOT on the official x402 network list — and that's BETTER than we thought
docs.x402.org lists Base, Solana, Aptos, Stellar, Hedera, TON, Algorand, Monad… **no Sui**. (CLAUDE.md's "Sui is now on its network list" is stale — flag for owner correction.) What actually exists:
- A **merged Sui scheme spec** — `specs/schemes/exact/scheme_exact_sui.md`, authored by Mysten's Brandon Williams (bmwill), June 2025, carried into V2.
- **Two closed Sui PRs** (#340 hayes-mysten, #382) — closed Dec 29, 2025 *only* because they targeted frozen v1 code, with maintainer **phdargen** writing: *"we would love to see SUI integrated… Happy to help if you'd like to pick this up again."* **Unclaimed for 5+ months.**
- The only self-declared "Sui-first" facilitator (**BlockEden**) is a waitlist page — not live.
- x402 itself moved to the **Linux Foundation** (Apr 2, 2026; Google, Microsoft, AWS, Stripe, Visa, Mastercard, Shopify signaling — Mysten absent).

**This is a standing, written invitation to take the seat our whole roadmap bets on.** The move: comment on PR #340 today claiming the v2 implementation, ship the TS scheme package against the merged spec, tag phdargen + CarsonRoscoe + bmwill + hayes-mysten. The open PR is citable raise collateral even before merge. [github.com/x402-foundation/x402/pull/340; docs.x402.org]

### 1c. ⚠️ Beep positioning trap
Mysten's co-founder publicly crowned Beep **"the Stripe of the agentic economy"** on the official Sui blog (Nov 6, 2025). Beep publishes zero traction, zero fee schedule, no facilitator endpoints, and its homepage has drifted to an agentic-quant-trading "Machine GDP" story — the merchant-payments seat on Sui is effectively vacant. But: **never use "Stripe of the agentic economy" phrasing on Sui-stage**, never attack Beep (Sui-endorsed + MIT-open). Differentiate as **"the live, verifiable merchant rail on Sui."** Keep "Stripe for AI agents" as the category metaphor off-Sui-stage. [blog.sui.io/beep-agentic-economy-launch]

---

## 2. The strategy in one paragraph

One asset (the 45–90s **agent-pays-and-deploys demo video**), three audiences (Sui ecosystem, agent-economy devs = merchants, consumers), one calendar anchored on three events we don't control the dates of (Overflow judging, the mainnet publish, the raise opening ~June 22). Sui Foundation amplification is the only zero-follower → six-figure-reach path and it is **documented and free** (sui.io/launch-on-sui says: tag @SuiFamOfficial + @firstmovers_ + @SuiNetwork, book DevRel office hours, list on sui.directory). The x402 seat is claimed in public on GitHub. Merchants come from MCP-author pain (10,000+ public servers, <5% monetized) via concierge + communities + one bulk partnership swing (Apify). Users come from open-door zkLogin + referral perks + deposit-gated quests + a UGC micro-swarm. Press runs on exclusives against the June news cycle (Mastercard Agent Pay launched June 10; Bloomberg's "agent payments barely exist" is our setup line). Everything reports only the three diligence-grade numbers.

---

## 3. Calendar (week-by-week)

### Week 0 — Thu Jun 11 → Sun Jun 14 ("claim + arm")
| Day | Action |
|---|---|
| **Today** | Comment on x402 PR #340 claiming the v2 Sui implementation (§1b). Create/verify X account, set avatar + banner from DIRECTION.md assets; first posts. Start Reddit account warming (karma gates: 50–500 + 7–30d age). |
| **Today/Fri** | Fire the Foundation forms (full manual: `SUI-RESOURCES.md`): **co-marketing/amplification request for launch week — their calendar runs ~2 weeks out, same-week requests refused (go.sui.io/co-marketing-request-form)**; DevRel office hours (cal.com/forms/08983b87-8001-4df6-896a-0d7b60acfd79 — also ask where the 404'd RFP Grants Hub moved); sui.directory/submit-project ("N/A — publish in progress"); **DeFi Moonshots application (OPEN, rolling, ≤$500k growth incentives — tally.so/r/MeRKJX, dossier in SUI-RESOURCES §3a)**; AWS Activate $5k credits (Org ID `1iBSQ`). Walrus RFP: all current RFPs closed — on the watch-list. |
| **Fri** | Start **YZi EASY Residency S4 application** (deadline June 21 — same day as submission; up to $500k, thesis = "global payments + automated agent economies"). Start Alliance ALL18 app (interview invite ~72h; decide on $5M-post dilution only at offer). |
| **Fri–Sun** | Produce the master demo video (§4) + 3 vertical cuts. Draft Show HN + first-comment + Reddit posts + 6-sentence press template (§5). Run Signal by NFX against Gmail (find hidden warm paths). |
| **Sat–Sun** | If Demo Days are real (June 13–14): full presence, work the Overflow channels. Pre-record launch-week videos. DM @firstmovers_ + @0xAmoghGupta for an Ecosystem Call slot. |
| **Sun 7pm ET** | *(only if mainnet/middleware ready — else slides to Jun 21)* **Show HN** window #1: "Show HN: HTTP 402 middleware so AI agents can pay your API (2%, no chargebacks)". Monday 00:00 UTC = statistically best slot (10.8% chance of 50+ pts). |

### Week 1 — Mon Jun 15 → Sun Jun 21 ("launch week + submission")
Launch-week format (Evil Martians: 5× trials in launch month; fixed timeline, flexible scope — cut scope, never the date):
| Day | Drop |
|---|---|
| Mon | **Mainnet publish** (if rail ready — the v1 gate) + public traction dashboard stub. X thread + Discord announce + tag protocol per launch playbook. |
| Tue | **@suize/pay OSS** drop — forums.sui.io design-notes post ("suize-402/1: design notes + live demo") + r/mcp build-log. |
| Wed | **Tier-0 instant-merchant screen** — "paste your address → agent-payable link in 60 seconds" + the OpenAI-Instant-Checkout-retreat contrast content (~30 Shopify merchants in a month, then killed — onboarding friction is the documented failure mode). |
| Thu | **Consumer wallet open-door** (Google sign-in → wallet live; referral leaderboard on; phased waitlist ONLY on autonomous Agent-mode — Phantom Cash-card playbook). |
| Fri–Sun | **Flagship demo + Overflow submission (June 21 per owner)** + press volley to media@sui.io + Weekly Sui TLDR + the Ben Weiss exclusive offer (§6-press). Launch-week recap thread. Sui Overflow cross-team bounty runs all week ("we pair-program your agent-payment leg in 30 min + $25–50 USDC credit"). YZi app submitted. |

### Week 2 — Jun 22 → Jun 28 ("merchant blitz + raise opens")
- 25-name investor wave (§6-investors), each note anchored on the x402.org/ecosystem screenshot (empty Sui facilitator slot) + 60s demo. Follow-ups scheduled (+66% response).
- Collison-install concierge sprint: 2 calls/day (Matt Dailey/Ref first; paid-intent MCP authors from Glama/Smithery listings).
- Apify swing: build the unsolicited PoC (one actor charging via Suize 402), send to Jan Čurn referencing his public x402/Skyfire quote.
- MCP directory blitz (one afternoon): official registry via mcp-publisher, PulseMCP (+ email hello@pulsemcp.com with newsletter pitch), Smithery, Glama, mcp.so.
- Galxe quest pilot live ($500 pool, deposit-gated); UGC swarm posting starts (15 creators staggered Jun 16–30).
- Product Hunt launch (weekend, 12:01am PT) after a Flo Merian (@fmerian) listing review.
- Decrypt op-ed submitted ("The agent economy has a receipts problem").

### Week 3 — Jun 29 → Jul 5 ("amplify + AI Engineer")
- **AI Engineer World's Fair** (June 29–Jul 2, Moscone West SF, $299 expo pass, 6,000+ AI engineers) — laptop demo + 10 pre-booked meetings + Agentic Engineering side event (June 29). *Only if travel is feasible; otherwise reallocate the time to concierge calls + podcasts.*
- Podcast ladder: The Rollup (info@therollup.co — fastest yes) → Empire (@JasonYanowitz DM with 60s clip) → Latent Space warm-intro hunt continues (no cold email — their rule; ~1-month lead lands in raise window).
- Show HN window #2 (if #1 flopped or slid): the flagship demo angle. Second-chance pool email (hn@ycombinator.com) if <10 pts in 24h.
- Weekly metrics note #1 published (three numbers only).
- Hydropower application + (post-results) the Magma-playbook conversation with Sui Foundation; peer-DM Magma founders for the winner-to-round map.

### Week 4 — Jul 6 → Jul 11 ("consolidate")
- Sifted pitch (they ran "agentic payments startups to watch, per VCs" on June 9 — actively sourcing; Ralio got framed off a $2.5M pre-seed).
- The Block funding exclusive pre-booked with Yogita Khatri (announce only when lead signed).
- Referral loop scaling decision (D7 data); quest kill-or-scale decision (D7/D30 <5% retention = kill).
- Comparison/AEO content shipped: "agent payment rails compared", "charge AI agents for your API", "Suize vs Beep" (surgical facts), "What the 2% buys" (never argue price; argue enforcement).
- Week-4 metrics note; raise pipeline review (DocSend medians: ~71 contacts, ~46 meetings — build the CRM for 70, not 15).

---

## 4. The one asset everything reuses

**45–90 second screen-capture: agent receives task → hits 402 → pays $0.50 USDC → site live on Walrus → receipt on explorer with the 2% fee visible.** Recorded, replayable, honest (testnet label until mainnet; flip the asset on publish day).

Cuts: (a) raw screen-record w/ voiceover (HN, PH gallery, GitHub README), (b) <60s native X video (links in first reply — 30–50% reach penalty otherwise), (c) 3 vertical cuts for TikTok/Reels/Shorts — outcome-first, hook in 1.5s: *"My AI just paid for its own website — here's the receipt."* (Lifestyle/satire formats run 10–22% engagement vs 0.10–0.17% for polished ads — Lightreel June 2026; genre proven: "AI Agent Made $250K While He Slept", 1.7M-view AI-spend parody.)

Comps that justify the lottery ticket: fly.pieter.com (3h prototype → Musk RT → $1M ARR in 17 days), Cluely (7.8M views one video), OpenClaw (9k stars in 24h). The channels are the floor; the video is the option.

---

## 5. Where to post + what to post (with drafts)

### Hacker News (merchant engine #1)
- **Law: crypto-deframed titles.** Verified pattern: stablecoin/crypto-titled Show HNs score 1–8 pts; payments-problem + open-source titles score 141–405 (Flowglad 405, Small Transfers 198, Autumn 141). USDC/Sui goes in the body and gets answered directly in comments (Small Transfers pattern).
- Title draft: `Show HN: HTTP 402 middleware so AI agents can pay your API (2%, no chargebacks)`
- First comment skeleton: solo founder → the problem (10k+ public MCP servers, <5% monetized; agents can't do card checkout) → what it is (~60-line middleware: answer 402, verify one GET) → honest status (USDC on Sui underneath; testnet/mainnet state stated plainly; 2% with no fixed floor) → known limitations → ask for feedback. No superlatives. Demo try-able without signup (Show HN rule).
- Timing: Sunday 7pm ET. Flop protocol: 24h → hn@ycombinator.com second-chance pool; relaunch in 2–3 weeks with a genuinely different artifact (wallet or Tier-0 screen).

### X / Twitter (the compounding engine — account at ~zero)
- 3–5 posts/day, **70% substantive replies** to agentic-AI/payments accounts 2–10× our size (replies weighted ~15× likes; TweepCred <65 = strangled distribution; reply-guy is the documented zero-follower escape). 30% original: demo clips, receipt screenshots, build-in-public numbers.
- One topic cluster ONLY (agents paying for things) — SimClusters punish drift. Links always in first reply. Every demo <60s native video.
- Flagship thread (launch day): hook *"An AI agent just paid for its own website. Total: $0.50. The fee is in the receipt."* → video → receipt-explorer link (first reply) → how it works (3 beats) → tag @SuiFamOfficial @firstmovers_ @SuiNetwork @WalrusProtocol (the documented amplification protocol — Walrus, 427k followers + Overflow Headline Partner, has the strongest motive to RT a real dogfood story).
- Reply-target list seed: @SuiNetwork, @WalrusProtocol, @Mysten_Labs, @EvanWeb3, @EmanAbio, @b1ackd0g, @martypartymusic, x402/CDP devs, @levelsio (only with on-topic working artifacts), @steipete (only with the working OpenClaw plugin), agentic-payments commentators.

### Reddit (merchant engine #2 — warm accounts from TODAY)
- r/mcp (89k): *"I made my MCP server charge agents — receipts on-chain"* build-log. The densest pool of target merchants.
- r/SideProject (628–735k): Tier-0 screen demo, screenshots + learnings.
- r/SaaS (200k): value post — *"What OpenAI's 4% Instant Checkout fee means for small merchants"* (product only in the weekly self-promo thread).
- r/ArtificialIntelligence (1.4M): agent-SAFETY framing — *"I let an AI spend from a capped sub-account with a kill switch — here's the verifiable log"*.
- **Skip r/CryptoCurrency entirely** (hostile, low-leverage). 95/5 value rule everywhere; product link in comments; answer for 24h.

### Sui ecosystem surfaces
- forums.sui.io: "suize-402/1 design notes + live testnet demo" technical write-up (precedent: Quikt's agent-payments design notes).
- Official Discord (899k members): announce per server rules; live in Overflow channels through judging.
- First Movers Ecosystem Call: 10-min live demo slot (DM @firstmovers_, hosts @0xAmoghGupta / @chowtato); prep honest roadmap answers for the product-roast segment.
- Suipiens: submit listing + offer the guide ("accept payments from AI agents on Sui in 5 minutes").
- Weekly Sui TLDR (Chainflow): pre-written 3-line item the week of mainnet.

### Agent-economy surfaces
- x402 GitHub: the PR #340 comment + the v2 Sui scheme implementation PR (the single most strategic post of the month). x402.org/ecosystem listing form + x402scan facilitators/config.ts PR + Merit-Systems awesome-x402 PR on mainnet day.
- AP2 issue #118 (open since Nov 26, 2025, one comment, zero maintainer engagement — empty stage): substantive on-chain mandate-verification design comment + reference repo, with the mandatory caveat (AP2 mandates are W3C VCs/ECDSA P-256 — proposed reference implementation, NOT a drop-in). Same artifact, second venue: offer the Sui impl on the open "mandate-bound" x402 scheme PR #2175.
- MCP directories: expect **presence + AEO surface, not installs** (logged builder data: ~0 installs from directories alone). One afternoon, never more.
- OpenClaw wedge (2–4 days): plugin giving any agent a capped, killable USDC sub-account; demo it paying a real 402; post in OpenClaw community; tag @steipete only with the working artifact. Densest population of personal-agent operators (247k stars).
- Discords: x402/CDP (discord.gg/cdp) + LangChain (~45k) — 30 min/day of genuinely helpful answers; announce only after being a known contributor.

### Consumer surfaces
- TikTok/Reels/Shorts: 3 cuts/week, iterate winning format weekly (crypto TikTok: 38.4B views Q1 2026, passed YouTube).
- UGC micro-swarm (Polymarket playbook): 15 creators × $100–300/video via JoinBrands/Influee, 3 fixed hook scripts + raw footage, staggered Jun 16–30, disclosure labels on.
- Quests: ONE Galxe pilot ($500 USDC pool) + free Zealy board — rewarded action is REAL only (fund $1 sub-account / receive first agent payment); never tweet participant counts; kill at D7/D30 <5%.
- Referral: 3 funded-friend referrals = 1 month "smarter AI" + fee-free month; referrer gets +10% of referee's AI-message quota (Rainbow/Notcoin model, non-custodial-safe, perks are software not cash). $2–5 USDC dual-sided variant only if budget allows, released ONLY after referee funds + completes one real payment (Coinbase pattern; CAC $4–10/funded user).
- Distribution: PWA-first + Google Play TWA wrap week 2 ($25 one-time); **skip iOS this sprint** (Guideline 4.2 + weeks-long crypto review); **skip X Ads** (Feb 2026 crypto certification can't clear in-sprint); Meta $500 storage+pay-positioned test only in week 3 behind proven organic creative.

---

## 6. Who to contact (the hit lists)

### Sui ecosystem (free amplification ladder) — *full resource manual + grant dossier: `SUI-RESOURCES.md`*
| Who | Handle/door | The move |
|---|---|---|
| Sui DevRel | cal.com/forms/08983b87-8001-4df6-896a-0d7b60acfd79 | Book office hours this week; agenda: 90s demo, mainnet date, two asks (launch amplification + Agentic-Web/payments intro) |
| Sui press desk | media@sui.io | One-paragraph pitch on mainnet day: "first AI agent to pay for and deploy its own website — 2% fee visible in the receipt" + video + explorer link |
| First Movers | @firstmovers_, @0xAmoghGupta, @chowtato | DM for Ecosystem Call demo slot + Sui Snapshot item; reference sui.io/launch-on-sui routing |
| @SuiFamOfficial | X | Tag on launch thread; DM re partner slot in next quest season (~$1.5k Season-4 precedent) |
| Walrus Foundation | @WalrusProtocol (427k) + RFP Airtable | Tag on demo thread; RFP: "agent-paid deploys + auto-renewing Walrus storage subscriptions" |
| Chainflow (Weekly Sui TLDR) | @chainflowpos / substack | Pre-written 3-line item, mainnet week |
| Suipiens | suipiens.com | Listing + the 5-minute merchant guide |
| Mysten brass (Evan Cheng @EvanWeb3, Adeniyi @EmanAbio, Sam Blackshear @b1ackd0g) | X | **Earn, don't ask**: reply-engage with live receipts; aim for the winners X Space |
| MartyParty | @martypartymusic | Reply to his Sui agentic-finance threads with the 60s demo + SuiVision receipt links (he amplified Beep unprompted) |
| Magma Finance founders | DM post-submission | 30-min "winner→$6M round, who actually wired" map (Overflow 2025 → Dec 2025 raise precedent) |

### Agent economy / standards
| Who | Door | The move |
|---|---|---|
| phdargen (x402 maintainer) | github PR #340 | Accept the standing invitation TODAY; open impl PR within the week |
| hayes-mysten + bmwill (Mysten) | GitHub | Tag on impl PR: "picking up where #340 left off — co-author/review?" (bmwill wrote the merged spec) |
| Carson Roscoe (x402 V2 co-author) | GitHub | Reviewer tag, referencing his V2 migration of the Sui spec |
| Erik Reppel (x402 creator) | GitHub/X — do NOT cold-pitch | Ship facilitator + merged PR first, then the 20s video: "first live Sui x402 facilitator" |
| Merit Systems (x402scan) | GitHub issue/PR | Offer Sui indexing (receipt-event schema + RPC) on mainnet day |
| shivankgoel (AP2 #118 author) + hilarl (PR #2175) | GitHub | The mandate-verification design comment + Sui impl offer |
| Artemis research | classic.artemis.ai | Offer receipt-event schema: "wash-resistant volume by construction (payer ≠ payee + fee emitted)" — gold for the raise |
| Yuga Cohler (CDP eng lead, CDPod) | LinkedIn | Post-impl-PR: pitch the "x402 comes to Sui" episode |

### Merchants & partnerships
| Who | Door | The move |
|---|---|---|
| Tadas Antanavicius (PulseMCP, MCP Steering Committee) | tadas@tadasant.com (confirm on tadasant.com) | Guest-post pitch: "What the 95% of unmonetized MCP servers can charge agents today" |
| Matt Dailey (Ref — paid MCP server) | via ref.tools / PulseMCP post | Concierge call #1: he wrote the exact pain post (agents break subscription pricing) |
| Jan Čurn (CEO, Apify) | @jancurn | The bulk swing: unsolicited PoC actor charging via Suize + his public x402/Skyfire quote. ~$500k/mo paid to creators; 36k+ monthly MCP-marketplace devs |
| Frank Fiegel (Glama) | @punkpeye | "Paid server" metadata/badge powered by Suize pay-links; offer to write the PR |
| Henry Mao (Smithery) | @Calclavia | "You host the servers; we make them payable — pilot with 5 top authors?" |
| Birk Jernström (Polar) | @birk | Complement pitch: "Polar handles fiat+tax; Suize handles agent-USDC" |
| Creem founders | @sudoferraz | Founder-to-founder: crypto leg for their 3,000+ AI-builder merchants |
| Steve Krouse (Val Town) | LinkedIn | "Paywall your val" template val + co-post (25% of their new users come from Claude) |
| Overflow teams | hackathon Discord | Cross-team bounty: "$25–50 USDC + we pair-program your payment leg in 30 min" |

### Press (exclusive > embargo; 6-sentence pitch format; never pay for coverage)
| Who | Outlet/beat | Angle |
|---|---|---|
| Ben Weiss (@bdanweiss) | Fortune — owns agentic-finance features (broke Mastercard AP4M June 10) | **The exclusive:** "Mastercard announced agent payments this week — here's a solo founder's version that already works, receipt on-chain." 72h window, then cascade |
| Sam Reynolds | CoinDesk — wrote the "x402 mostly a mirage" piece (~$28k/day real, ~half wash) | The counter-story: "a rail where every payment is an auditable receipt with the fee emitted" |
| Krisztian Sandor | CoinDesk — stablecoins/agent payments (Keyrock $73M piece) | "Agent payments concentrate on Base/Solana — here's Sui's first live facilitator, data attached" |
| Shaurya Malwa | CoinDesk — standards-war analysis | The sequel: the third lane. Locked phrasing only: "402-shaped, x402-compatible by design" |
| Yogita Khatri (@Yogita_Khatri5) | The Block Funding newsletter (covers $3M pre-seeds) | Pre-book the raise exclusive; announce only when lead signed |
| Julie Bort / Marina Temkin | TechCrunch (tips@techcrunch.com) | "How agents get monetized" business story; chain in paragraph two; strongest paired with the round |
| Decrypt op-eds | editor@decrypt.co | FREE tier-1 byline: 500–800 words, "The agent economy has a receipts problem", zero shilling, ~1 week SLA |
| Brady Dale | frontstageexit.com | Contrarian essay seed: "Everyone says agent payments barely exist. Here's a receipt — audit it yourself" |
| Mary Ann Azevedo | TWIF/Crunchbase News | Merchant economics framing: "what agent-native checkout does to interchange" |
| The Rollup | info@therollup.co | Fastest podcast yes: "MPP vs x402 is a two-horse story — the third rail is Sui; live demo on the show" |
| Jason Yanowitz | @JasonYanowitz (Empire) | 60s clip DM; Friday-roundup mention first |
| swyx/Alessio (Latent Space) | warm intro ONLY (their rule) | Start hunting the intro now via MCP/Anthropic builder community; ~1-month lead = raise-window episode |
| Simon Taylor | @sytaylor (Fintech Brainfood, 45k B2B) | "4 Fintech Companies" pitch — note: he's GTM at Tempo (competitor-adjacent); expect sharp questions |
| PYMNTS desk | pymnts.com tips | Launch-day: no-KYB instant merchant vs the Instant Checkout onboarding failure they covered |
| Sifted fintech desk | sifted.eu | They published "agentic payments startups to watch" June 9 — ask into the next roundup |

### Investors (wave: June 22–30; 25 names; every note references their own thesis + the x402.org empty-Sui-slot screenshot + 60s demo)
| Who | Why them | Door |
|---|---|---|
| Chris Ahn — Haun Ventures | $1B closed May 2026, explicitly "stablecoin infrastructure and AI agent plumbing"; Bridge/BVNK exits | Cold note + demo |
| Rob Hadick — Dragonfly | $650M Fund IV; publicly names agentic payments + x402 themes | Engage his stablecoin writing first, then pitch the non-custodial delta |
| Lex Sokolin — Generative Ventures | Thesis IS the company ("machine economy"); led Nevermined's seed | Sharp cold DM: "Nevermined for the Sui side of the map — live, fee in every receipt" |
| Robert Leshner — Robot Ventures | Pre-seed checks into technical crypto primitives; live Signal profile | Pitch as a primitive: 4-verb rail, RailConfig enforcement, allowances without key delegation |
| Sheel Mohnot — BTV | The credible skeptic ("most agentic-payments hype isn't real money moving") | Lead with the exact counter: mainnet digest + fee receipt + the agent that paid it. One link |
| Coinbase Ventures | Topped up Skyfire, invested in Kite "to advance agentic payments with x402"; co-founded the x402 Foundation | Frame as ecosystem expansion of THEIR standard; via inbound + x402 GitHub presence |
| Charles Hudson — Precursor | THE institutional pre-seed first-check | ⚠️ CONFLICT FLAG: appears behind Beep's founding team — ask directly about the conflict before sharing anything sensitive |
| Zach Abrams — Bridge (acq. Stripe $1.1B) | Stretch-target angel; "Stripe for AI agents" is a sentence about his world | One line + 15-min ask |
| Christian Thompson — Sui Foundation MD | Direct strategic checks exist (Ika, SEED) | Do NOT cold-pitch; win/place Overflow, then the Magma-path conversation |
| + ~15 from OpenVC | Filter: pre-seed crypto/fintech/AI accepting cold inbound (10–20% reply vs 5% baseline) | Personalized notes, follow-ups scheduled |

**Programs:** YZi EASY S4 (≤$500k, **deadline June 21**); Alliance ALL18 ($500k @ $5M post + auto $500k at seed — model dilution vs $12–18M target before accepting; regular deadline July 22); Sui Hydropower (no equity up front — post-Overflow); Outlier Base Camp (backstop, $100–200k for 5–10%); watch a16zcrypto.com/accelerator weekly for CSX-05 (speedrun closed May 17).

**Comps for the deck:** Skyfire $9.5M pre-revenue; Catena $18M pre-product → $30M A; Nevermined $4M seed; Payman $13.8M on a 10k waitlist; Kite $33M A (PayPal Ventures); Ralio $2.5M = "Europe's biggest agentic-payments pre-seed." Carta: AI pre-seed caps $12–25M → our $12–18M ask is mid-market **with a live fee-emitting rail none of them had at raise**.

---

## 7. Growth mechanics (specs)

1. **Tier-0 viral loop (the merchant engine):** paste address / Google sign-in → live pay-link + on-chain history + "Agent-Ready" badge + **auto-generated shareable receipt card** on first payment ("An AI agent just paid me $0.50 — fee visible on-chain", existing mascot/card pipeline). Every merchant's first payment becomes a distribution node. Activation = signup by construction (median SaaS activation is 30–36%; this makes it ~100% of signups).
2. **Founding-merchant offer:** 0% Suize fee for 90 days (RailConfig per-merchant override — already on-chain) + badge. Wedge line: "0% now, 2% later — vs OpenAI Instant Checkout's 4%." Explicit sunset date (avoid Polar's repricing backlash).
3. **Referral (non-custodial-safe):** perks are software — "smarter AI" months + fee-free months + AI-quota boosts; qualifying event = referee funds $1 + one real payment; caps per Google account/funding source; batch payouts after cohort review. Optional $2–5 USDC dual-sided variant within budget.
4. **Quest pilot:** ONE Galxe free-tier campaign, $500 USDC pool, rewarded action = real funded action only; expect ~50% farmers (LayerZero removed 59% as sybil; studied program retained 0.59% post-reward); never publish participant counts; D7/D30 <5% → kill, ≥5% → consider scaling. Zealy free board for sustained tasks (XP → perks, never tokens).
5. **UGC micro-swarm:** 15 creators ($100–300/video, JoinBrands + Influee in parallel), 3 hook scripts, raw b-roll provided, staggered posts, disclosure labels, Modash shortlist (engagement >5%) for round two. Optional one brand-safe mid-tier creator ($500–2k, CryptoWendyO-class) on the safety angle: "the first AI allowance that physically can't overspend."
6. **Kaito Studio / Wallchain (post-ban attention channel):** apply day 1 (async review); $2k outcome-based USDC brief: "film an AI agent paying for and deploying its own website; make YOUR agent pay a Suize pay-link." Only fund after the free demo video shows organic signal.

---

## 8. Budget (<$5k discretionary)

| Item | Cost | Priority |
|---|---|---|
| UGC micro-swarm (15 videos) | ~$2,000–2,500 | P0 |
| Galxe quest pool | $500 | P0 |
| Referral rewards cap (initial) | $1,000–1,500 | P0 (scales only on retention signal) |
| AI Engineer expo pass | $299 (+travel — decide separately) | P1 |
| X Premium | ~$16/mo | P0 (reply visibility) |
| Google Play fee | $25 | P0 |
| Ben's Bites unclassified test | $200 | P2 — post-mainnet only |
| GiveRep / SuiFam quest season | ~$1.5k (quotes unverified) | P2 — only if something above is cut or budget raised |
| Kaito/Wallchain creator brief | $2k | P2 — post-organic-signal, likely post-raise |
| **Hard skips this month** | $0 | X Ads (certification can't clear), Galxe Business+ ($999–1,699/mo), TLDR primary ($5k+), FIDO membership ($3,250), any "guaranteed coverage" service |

---

## 9. Metrics & reporting discipline

Weekly public metrics note (2–3 hrs; numbers are already on-chain), **exactly three numbers**:
1. Merchants with ≥1 real paid charge
2. D7/D30 retention cohorts of funded wallets
3. Protocol fee revenue (the on-chain 2% — independently verifiable by RPC)

Plus the **public traction dashboard** at a stable URL before the raise opens (cumulative charges, fees emitted, receipts RPC-verifiable). This is the artifact every comparable lacked at raise, and the standing rebuttal to the wash-trading narrative (frame small absolutes as "day-N of mainnet" slope, never volume).

Banned from all public comms: raw signups, quest participants, testnet wallet counts, waitlist sizes.

---

## 10. Claims law (what we say / never say)

**We own (truth-gated):**
1. "The first LIVE 402 payment facilitator on Sui — with a published Sui scheme proposal for x402 V2." *(gate: mainnet live + PR public; until merged, "x402-compatible by design" ceiling holds)*
2. "Subscriptions and spending caps enforced by the chain, not by policy — one-tap on-chain kill." *(nobody else: Stripe MPP = Stripe's stack; Coinbase = MPC enclave; Nevermined = prepaid credits; cards = tokenized credentials)*
3. "Agents pay with their OWN keys, fully non-custodial, and every payment emits the fee in a public receipt anyone can audit." *(the answer to the ~half-fake volume narrative)*

**We never say:**
1. "On x402" / "official x402 facilitator" — one screenshot of docs.x402.org disproves it today.
2. "Free / zero-fee / cheapest" — Beep markets zero-fee, Sui native transfers are $0.00, PayAI is $0.001; a 2% business never wins a price frame. Sell enforcement, receipts, minutes-to-live. ("2% no 30¢ floor" is a card-comparison, never a crypto-comparison.)
3. "The Stripe of the agentic economy on Sui" / "Sui's first agentic wallet" / platform name-drops — Beep owns the first two (Mysten quote, Nov 2025); platforms only when a real plugin ships.

---

## 11. Build dependencies (product gates marketing — owner decides priority)

| Build item | Gates | Effort guess |
|---|---|---|
| **Mainnet publish** (the v1 gate) | "Live" claims, dashboard, press volley, paid tests, PH/HN honesty | per plan |
| **Tier-0 instant-merchant screen** | The ENTIRE merchant funnel (without it, 1,000 is mathematically out of reach) | days (specced, locked) |
| x402 V2 Sui scheme impl (TS plugin vs merged spec) | Claim #1, ecosystem/x402scan listings, the land-grab | ~1 focused week |
| Referral wiring (perks on funded+paid events) | User goal | 2–4 days |
| Shareable receipt cards (auto-gen on first payment) | Merchant viral loop | 1–2 days (pipeline exists) |
| OpenClaw plugin (capped sub-account skill) | Payer-side wedge + densest agent community | 2–4 days |
| Public traction dashboard | Raise artifact + every press pitch | 3–5 days |
| AP2 #118 comment + reference repo | Standards credibility (free) | 1–2 days |

Reality check: that's ~3 weeks of build for one person stacked against a marketing calendar that also needs ~3–4 h/day. The plan survives cutting OpenClaw and AP2 to "later"; it does NOT survive cutting mainnet, Tier-0, or the video.

---

*Last updated 2026-06-11. Owner + Nox. Sources: 9-lane agent research sweep (transcript: session workflows dir, run wf_660c2382-d16). Update when a channel's data contradicts this doc twice.*
