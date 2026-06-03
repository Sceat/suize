# The Suize Fundraising Handbook
### Complete Playbook for Raising Pre-Seed/Seed for "Google for Sui" — May 2026

You're raising for B2A agent infrastructure on Sui, with x402 monetization, into a market where 40 cents of every crypto VC dollar in 2025 already went to AI x crypto ([CoinDesk](https://www.coindesk.com/business/2026/04/18/ai-is-increasingly-eating-into-vc-fundings-and-here-is-how-crypto-firms-are-adapting)). The wind is at your back. Don't waste it.

---

## 1. How Crypto VC Fundraising Mechanically Works in 2026

### The Instruments

**SAFE (Simple Agreement for Future Equity)** — A convertible promise: investor wires money now, gets equity later at the next priced round, at a discount or capped valuation. No interest, no maturity. Two flavors that matter enormously:

- **Post-money SAFE** (YC standard since 2018, ~90% of pre-seed rounds on Carta in Q1 2025): The investor's ownership % is *locked in* against the post-money cap. Stacks brutally against founders.
- **Pre-money SAFE**: Investors dilute *each other* when you raise more SAFEs.

The math difference is concrete. Three $1M SAFEs at $10M cap:
- **Post-money**: Each investor gets exactly 10%. Founder dilution = 30%.
- **Pre-money**: $3M / ($9M + $3M) = 25% total dilution. Founder gives up 5 percentage points less.

Sources: [Carta](https://carta.com/learn/startups/fundraising/convertible-securities/pre-money-vs-post-money-safes/), [Hustle Fund](https://www.hustlefund.vc/post/pre-money-vs-post-money-safes), [Qubit Capital](https://qubit.capital/blog/post-money-safes-founder-dilution).

**Priced round (preferred equity)** — Real shares of preferred stock issued. You get a 409A, a cap table, a closing book. Liquidation preferences kick in. Standard in 2026: 1x non-participating preferred (80%+ of Series A/B per NVCA data; 90% of UK 2025 prefs non-participating) ([Value Add VC](https://valueaddvc.com/blog/liquidation-preference-explained-1x-2x-participating-vs-non-participating)).

**SAFT (Simple Agreement for Future Tokens)** — Investor pays now for tokens delivered later, usually at TGE. Used when tokenomics is finalized. Sold through a Token SPV (Cayman, BVI, Panama foundation typically) ([Legal Nodes](https://www.legalnodes.com/template/simple-agreement-for-future-tokens)).

**Token Side Letter / Token Warrant** — Bolted onto a SAFE when tokenomics isn't finalized. The warrant gives investors the *right* (not obligation) to buy tokens pro-rata to their equity at TGE. Side letter is the contractual hook ([Skala](https://www.skala.io/blog/saft-vs-token-warrant)).

**Dual Structure (SAFE + Token Warrant)** — The 2026 default for crypto-native startups with future tokens but undefined tokenomics. You give investors:
1. Equity ownership today via SAFE
2. Pro-rata right to buy tokens at TGE via warrant (typically free or at par)

For Suize this is the structure to use. You're not ready to do a SAFT — tokenomics aren't finalized, and locking in a token allocation pre-product locks you into expectations you can't back out of.

### Valuation Mechanics

- **Valuation Cap**: The maximum valuation at which the SAFE converts. Lower cap = more dilution to you, more upside for investor.
- **Discount**: 15–25% off the next round's price. Most modern SAFEs use cap *or* discount, whichever benefits the investor.
- **MFN (Most Favored Nation)**: If you give a later investor better terms, this investor automatically gets those terms. Standard but watch the language — bad MFNs ratchet *down* every time you sign a new SAFE.
- **FDV (Fully Diluted Valuation)**: Token price × total supply. Crypto investors anchor returns on FDV, not equity valuation. If your TGE FDV is $200M and they bought at $20M FDV, that's a 10x.

### 2026 Valuation Ranges (Carta + crypto-specific data)

| Stage              | Round Size        | Pre-money / Cap (general) | Crypto/Web3 (premium ~20–40%) |
| ------------------ | ----------------- | ------------------------- | ----------------------------- |
| Pre-seed <$250k    | —                 | $7.5M median              | ~$10M                         |
| Pre-seed $250k–$1M | —                 | $10M median               | $12–15M                       |
| Pre-seed $1M–$2.5M | —                 | $15M median               | $18–22M                       |
| Seed               | $4M median raised | $20M post-money median    | $25–40M post                  |
| Series A           | $10–15M           | —                         | $50–100M+                     |

Sources: [Carta State of Pre-Seed 2025](https://carta.com/data/state-of-pre-seed-2025/), [Carta Q1 2026](https://carta.com/data/state-of-pre-seed-q1-2026/), [Carta record valuations](https://carta.com/data/record-setting-valuations/). Crypto/Web3 startups command higher caps than market average.

For Suize, a fundable pre-seed range in 2026 is **$500k–$1.5M on a $12–18M post-money cap**, with token warrants. If your Sui Overflow demo lands and you have a CoinDesk hit, push to $20–25M.

### Token Allocation Conventions (2026)

[Tokenomics.com 2025 playbook](https://medium.com/@izaguirre.john/the-2025-tokenomics-playbook-vesting-allocations-and-a-new-institutional-era-1d3062697d5b):

| Bucket                 | % of Supply |
| ---------------------- | ----------- |
| Core team              | 18–20%      |
| Investors (all rounds) | 12–18%      |
| Treasury/reserves      | 20–25%      |
| Ecosystem/community    | 35–45%      |
| Public sale            | 1–5%        |
| Advisors               | 1–3%        |

**Vesting (investors)**: 2–3 year lockup, 6–12 month cliff, 24–48 month linear unlock. TGE unlock 0–15% max — projects with >25% TGE unlock saw median first-year price declines of 72% vs 38% for sub-15% ([Tokenomics.com](https://tokenomics.com/articles/token-vesting-complete-guide-to-vesting-schedules-cliffs-and-unlock-mechanisms)).

**Vesting (team)**: 4 years, 1-year cliff. Standard.

### Concrete Cap Table Walkthrough

Suize raises $1M post-money SAFE at $15M cap, then $4M seed at $25M post-money 18 months later.

| Stage                                    | You    | SAFE Investors | Seed Investors | ESOP              |
| ---------------------------------------- | ------ | -------------- | -------------- | ----------------- |
| Pre-SAFE                                 | 100%   | —              | —              | —                 |
| Post-SAFE (locked %)                     | ~93.3% | 6.7%           | —              | —                 |
| Pre-seed priced                          | 76%    | 6.7%           | 16%            | ~10% (post-round) |
| Realistic post-seed with 10% pool top-up | ~66%   | 6.0%           | 16%            | 12%               |

Add token side letter: those same investors get ~6–8% combined token allocation at TGE (pro-rata to equity, typical structure).

---

## 2. The Crypto / Sui VC Landscape — May 2026

### Sui Ecosystem-Native

**Sui Foundation** ([programs](https://www.sui.io/programs-funding), [RFP](https://www.sui.io/request-for-proposals))
- **Developer Grants**: $10k–$100k + potential SUI token bonus. Non-dilutive. Identity verification required, signed milestone agreement.
- **Research Awards**: $25k for blockchain research.
- **DeFi Liquidity**: up to $500k in liquidity incentives for selected DeFi protocols.
- **Strategic Investments**: For "core primitives or ecosystem-wide apps" — direct equity investments (your category).
- **Managing Director**: Greg Siourounis (verified). Apply via the public forms; the strategic investment path is by introduction through Mysten team.

**Mysten Labs Ventures** ([about](https://www.mystenlabs.com/about))
- Founders: Evan Cheng (CEO), Sam Blackshear (CTO), Adeniyi Abiodun (COO), George Danezis (Chief Scientist), Kostas Chalkias.
- Investment arm exists; co-invests in ecosystem projects ([Crypto-Fundraising profile](https://crypto-fundraising.info/projects/sui/)).
- Contact: info@mystenlabs.com (general). For investment/strategic, target Adeniyi Abiodun on X (@EmanAbio) or Evan Cheng (@evan_was_here) — both post publicly.

**OKX Ventures** — Active in Sui specifically. Backed Haedal, Cetus, Navi, Momentum ([source](https://cryptonews.com/news/okx-ventures-invests-in-sui-based-liquid-staking-protocol-haedal/)). Reach via Jeff Ren on X.

**Comma3 Ventures** — Sui-focused. Led a $2M Sui pre-seed alongside Coin98's Arche Fund. Comma3 was in Mill City Ventures' $450M Sui placement ([source](https://www.omm.com/news/press-releases/o-melveny-advises-sui-foundation-in-connection-with-mill-city-ventures-us-450-million-private-placement/)).

**Karatage Opportunities** — London hedge fund, equivalent investor to Sui Foundation in Mill City placement. Strategic Sui aligned ([same source](https://www.omm.com/news/press-releases/o-melveny-advises-sui-foundation-in-connection-with-mill-city-ventures-us-450-million-private-placement/)).

**Mill City Ventures (MCV)** — Nasdaq SUI treasury vehicle, $450M raised July 2025. Not a direct early-stage VC but signals deep capital alignment with Sui — relevant for later rounds ([blog.sui.io](https://blog.sui.io/nasdaq-listed-sui-treasury-mill-city-ventures/)).

**Bixin Ventures, Animoca Brands** — Both have Sui exposure. Animoca is gaming-heavy, less aligned to your B2A thesis.

### Crypto AI / Agent Infrastructure (Tier 1 for You)

**a16z crypto** — $2.2B new fund (5th fund, May 2026), bringing total to $9.8B ([TechCrunch](https://techcrunch.com/2026/05/05/as-crypto-cools-a16zcrypto-raises-a-2-2b-fund/)). Their published thesis: "Know Your Agent" (KYA) is the missing primitive; nanopayments and attribution will reward every entity contributing to an agent's task ([a16z](https://a16zcrypto.com/posts/article/trends-ai-agents-automation-crypto/)). **This is literally Suize's thesis.**
- Partners to target: **Chris Dixon** (@cdixon), **Ali Yahya** (@alive_eth), **Eddy Lazzarin** (@eddylazzarin), **Daren Matsuoka** (data). Eddy posts most heavily on agent infra.
- Email pattern: firstname@a16z.com (unconfirmed but standard).

**Paradigm** — $1.5B new fund Feb 2026 expanding into AI/robotics ([source](https://ventureburn.com/paradigm-raises-1-5b/)). Led Nous Research's $50M Series A at $1B valuation.
- GPs: **Matt Huang** (@matthuang), **Dan Robinson** (@danrobinson — head of research, focuses on open-source protocols), **Charlie Noyes** (@_charlienoyes — promoted to GP, MEV/Flashbots heritage, agent-curious). ([Paradigm team](https://www.paradigm.xyz/team), [The Block](https://www.theblock.co/post/209716/paradigm-shift-as-crypto-vc-firm-names-general-partners-for-first-time))
- Email pattern: firstname@paradigm.xyz.

**Multicoin Capital** — $5.9B AUM. Kyle Samani stepped back from day-to-day in 2025 to focus on AI/robotics personally; Tushar Jain runs the firm now. Check range $1–50M ([Cryptopolitan](https://www.cryptopolitan.com/multicoin-co-founder-shifts-focus-to-ai/)). Frontier Thesis explicitly covers "AI x Crypto infrastructure" and "zero-employee companies powered by AI agents."
- Target: **Tushar Jain** (@TusharJain_), **Spencer Applebaum** (@ApplebaumSpence), **Shayon Sengupta** (@shayonsengupta — most active on infra), **John Robert Reed** (@JohnRobertReed — marketing/founder relations, good warm intro vector).

**Hack VC** — Dedicated 41% of latest fund to Web3 AI per Alex Pack ([CoinDesk April 2025](https://www.coindesk.com/business/2025/04/12/where-top-vcs-think-crypto-x-ai-is-headed-next)). Led Nillion's privacy-preserving AI compute round.
- Target: **Alex Pack** (@alpackorg), **Ed Roman** (@EdRomanVC), **Christopher Ahn**.

**Variant Fund** — Fund IV ($250M target, 2025 SEC filing). Ownership economy thesis. ([variant.fund](https://variant.fund/))
- GPs: **Jesse Walden** (@jessewldn), **Li Jin** (@ljin18), **Spencer Noon** (@spencernoon).
- Variant runs **Forge by Variant** accelerator.
- Email pattern: firstname@variant.fund (per [vcsheet.com](https://www.vcsheet.com/who/jesse-walden)).

**1kx** — Invested in Camp ($25M Series A April 2025, AI+blockchain for content/IP).
- Founder: **Lasse Clausen**.

**Delphi Ventures** — Co-invests heavily with Pantera/Coinbase on AI ([Gate.com](https://www.gate.com/learn/articles/comprehensive-analysis-of-2024-crypto-vc-ai-investments/5380)).
- Target: **Anil Lulla** (@anildelphi), **Jeremy Ong** (@JeremyOng_).

**Robot Ventures** — $75M fund, Robert Leshner (Compound) + Tarun Chitra (Gauntlet). Pre-seed crypto primitives specialist ([medium](https://medium.com/@rleshner/introducing-robot-ventures-d45f40ec12a0)).
- Target: **Robert Leshner** (@rleshner), **Tarun Chitra** (@tarunchitra). Both extremely operator-friendly, fast yes/no.

**Coinbase Ventures** — In Surf ($15M), Based ($11.5M), OpenMind ($20M) — all AI/agent plays in 2025/26. Coinbase owns x402 — they're structurally aligned with your monetization layer.
- Target: **Shan Aggarwal** (@shanaggarwal), **Hoolie Tejwani** (@hooliet).

**Pantera Capital** — Led Surf, Based, OpenMind. AI thesis: "DePIN + AI = new infrastructure layer."
- Target: **Paul Veradittakit** (@veradittakit), **Cosmo Jiang**.

**Polychain Capital** — Backed Grass (data layer), views AI as new blockchain infra layer.
- Target: **Olaf Carlson-Wee** (@oacarlson), **Niraj Pant**.

**Dragonfly** — $650M Fund IV closed Feb 2026 ([Fortune](https://fortune.com/2026/02/17/dragonfly-fourth-fund-crypto-venture-capital-blockchain-polymarket-ethena/)). Portfolio: Polymarket, Ethena, Rain.
- GPs: **Haseeb Qureshi** (@hosseeb — most public, agent-curious), **Rob Hadick** (@HadickM), **Tom Schmidt** (@tomhschmidt), **Bo Feng** (founder).

**Bankless Ventures** — Hoffman/Adams network; 37 investments; small checks but powerful media halo.

**Symbolic Capital** — ex-Hyperedge, Lemniscap-aligned.

**Lemniscap** — Led Senpi's $4M ([source](https://www.cbinsights.com/investor/lemniscap-vc)) — AI wallet/personal agent. Direct portfolio adjacency.

**IOSG Ventures** — 181 investments, infra-heavy.

**Castle Island Ventures** — Nic Carter (@nic__carter). Stablecoin-focused but agent payments adjacent.

**Standard Crypto** — Lower public profile, agent-curious.

**Placeholder VC** — Joel Monegro / Chris Burniske. Mature thinkers on protocol value capture.

**Bankless / Empire / Lightspeed / Lattice Fund / Galaxy Ventures** — Smaller checks, strategic value (media halo, distribution).

### Accelerators

**Alliance DAO** — The crypto YC. ALL18 cohort starts Sept 7, 2026. **Application deadline May 27, 2026.** Free program, no equity taken in exchange for program; they invest $500k at founder-friendly terms. Median Alliance startup raises $3.5M at $25M post after the program. Investors include Paradigm, Multicoin, Dragonfly ([Alliance.xyz](https://alliance.xyz/), [startupgrantshub](https://startupgrantshub.com/opportunities/alliance-crypto-ai-accelerator-2026/)). **Check immediately if applications still rolling or if you can apply for the next cohort.**

**a16z CSX** — $500k for 7% equity. ~3% acceptance rate. Skews infra/DeFi/dev tooling — perfect fit ([a16zcrypto.com](https://a16zcrypto.com/accelerator/)).

**Forge by Variant** — Variant's accelerator, ownership economy lens. Smaller, more boutique.

**Outlier Ventures Base Camps** — Now specialized (DePIN, RWA). Less relevant unless you reframe Suize as DePIN-adjacent (you could — the indexed corpus argument).

**Sui Builder House / Sui Basecamp** — Sui's official builder events. Not an accelerator per se but co-located VCs and Mysten team. Apply to demo at the next one.

**Orange DAO** — YC-alum-led, broader crypto.

### Honest Recommendation

**Apply to Alliance DAO immediately.** Their batch dynamics + warm intros to Paradigm/Multicoin/Dragonfly are worth more than the $500k. Second priority: a16z CSX. Don't bother with general Y Combinator — crypto founders consistently report YC doesn't move the needle for crypto-native rounds.

---

## 3. The Pitch Deck — Section by Section

10–15 slides total. Pre-read version: text-heavy, designed to be read solo. In-person version: visual-heavy, 20-min talk + 10 min Q&A. Demo day version: 5 minutes flat. Make all three.

### Slide-by-Slide

**1. Cover** — Logo. One-liner: "The query layer for autonomous agents on Sui." Raising: "$1.5M pre-seed via SAFE + token warrants." Your name, email, X handle.

**2. The Problem** — Agents waste massive inference cycles scraping human dashboards. Anthropic's MCP team and a16z both confirmed: 67% of CTOs name MCP their default agent integration standard within 12 months ([digitalapplied.com](https://www.digitalapplied.com/blog/mcp-adoption-statistics-2026-model-context-protocol)). Yet no on-chain data is MCP-native. Show: agent doing a 14-step scrape to answer "what's the TVL of Cetus?"

**3. Why Now** — Three converging curves:
- MCP went from 1,200 servers Q1 2025 to 9,400+ in April 2026 (+18% MoM through Q1 2026), 97M monthly SDK downloads ([digitalapplied.com](https://www.digitalapplied.com/blog/mcp-adoption-statistics-2026-model-context-protocol))
- x402 hit 156k weekly txs, 492% growth, $600M annualized volume by March 2026, backed by Cloudflare, Visa, Google, Stripe, AWS ([CoinDesk](https://www.coindesk.com/markets/2026/03/11/coinbase-backed-ai-payments-protocol-wants-to-fix-micropayment-but-demand-is-just-not-there-yet))
- Sui processed 300k+ TPS, parallel execution gives agents deterministic state without contention ([Yellow.com](https://yellow.com/learn/sui-object-model-parallel-execution-layer-1))

**4. Solution + Live Demo** — One slide describing the product. Then the demo. Open Claude/Cursor, paste a prompt: *"What's the 24h volume on Cetus and the largest LP?"* — show the MCP call → x402 payment flow → structured JSON response in <2 seconds. **The demo is the deck.**

**5. Market Sizing** — Agentic AI market: $7.92B (2025) → $11.55B (2026) → $294B (2035) per Precedence Research. Conservative analysts say $40B in 2026 ([Information Matters](https://informationmatters.net/sizing-the-agentic-ai-market-40-billion-now-140-billion-by-2030-if-three-triggers-hit/)). B2A query infra capture: agents make ~10–100 queries per task at $0.001–0.01 each. Bottom-up: 10M agents × 1000 queries/day × $0.005 = $50M/day TAM at full saturation.

**6. Traction (Pre-Revenue Proxies)** — See Section 4 for target numbers.

**7. Business Model** — Per-call revenue via x402. Take rate: 5–15% of payment, rest accrues to indexers/validators. Gross margin: 80%+ (compute is the only cost). At $0.005/call × 100M monthly calls × 10% take = $50k MRR by month 12; scales linearly.

**8. Moat** — Four layers:
1. Sui-native (object model gives 10x latency advantage vs Ethereum scraping)
2. Network effect from indexed corpus (more agents → more queries → better cache hits → faster responses)
3. Embedded payment rail (x402 + USDsui = zero integration tax)
4. MCP registry positioning (first-mover for Sui MCP server registry)

**9. Team / Why You** — Solo founder slide. Don't apologize. Lead with: "I'm shipping faster solo than most teams of four. Hiring CTO post-seed." Show your shipped artifacts (landing, terminal demo, viral X video reach). If you have an advisor — Mysten employee, x402 contributor, MCP committer — name them.

**10. Roadmap** — Q3 2026: Sui Overflow demo + waitlist conversion. Q4 2026: 50 beta agents live. Q1 2027: $10k MRR, 5 design partners. Q2 2027: $50k MRR → Series A.

**11. Ask** — "$1.5M pre-seed via SAFE + token warrants. $15M cap. 18-month runway. Use: 60% engineering, 20% infra/indexing, 15% BD with agent builders, 5% legal/ops."

### Pitch Length

- **In-person partner meeting**: 25–30 min total. 15 min deck-walk + demo, 15 min Q&A.
- **First Zoom (associate filter)**: 15 min. Skip slides 5 (market sizing — they'll trust you).
- **Demo day** (Alliance, CSX, Overflow): 3–5 min flat. Slides 1, 3, 4, 6, 11. That's it.

Sources: [Skywork](https://skywork.ai/blog/how-to-build-investor-ready-ai-pitch-deck-2025-guide/), [Storydoc](https://www.storydoc.com/pitch-deck-templates/crypto-pitch-deck).

---

## 4. Traction Signals That Move the Needle (Pre-Revenue, 2026)

These are the numbers that *change the conversation* from "interesting, follow up in 6 months" to "let's term-sheet this week." Hit any 3 of these to be fundable at $15M+ cap:

| Signal                            | Weak         | Good        | Fundable          | Hot                  |
| --------------------------------- | ------------ | ----------- | ----------------- | -------------------- |
| Waitlist signups (qualified, dev) | <500         | 1.5k        | 5k                | 15k+                 |
| GitHub stars (your SDK)           | <100         | 500         | 2k                | 5k+                  |
| Weekly active agents in beta      | <5           | 25          | 100               | 500+                 |
| Design partner LOIs               | 0            | 1           | 3                 | 5+                   |
| MCP registry listing              | yes/no       | listed      | featured          | top 10 in category   |
| X following (founder personal)    | <2k          | 10k         | 25k               | 50k+                 |
| Hackathon results                 | participated | finalist    | track winner      | Overflow grand prize |
| Mysten/Sui Foundation endorsement | none         | private nod | public RT         | named partner        |
| Press hits                        | none         | 1 podcast   | Bankless+CoinDesk | Empire + Lightspeed  |

**Design partner LOIs are by far the highest-leverage signal.** An LOI from a real org saying "we will pay $X for queries when live" is worth 100 GitHub stars. Target the obvious B2A buyers: trading firms (Wintermute, GSR), agent platforms (Virtuals, Olas), analytics firms (Messari, Nansen), wallet providers wanting agent data (Phantom, Backpack — both Sui-active).

**Sui Overflow 2026 result** is *the* moment for you. $500k+ prize pool, Agentic Web track explicitly exists ([Sui on X](https://x.com/SuiNetwork/status/2052456124956446841)). Winning the Agentic Web track = instant credibility. Even being a finalist with strong demo = warm intros to Sui Foundation strategic investment.

---

## 5. Pre-Seed / Seed Terms — Realistic Asks (May 2026)

### Pre-Seed (Where Suize Is)

- **Round size**: $750k–$2M total. Don't be greedy; you don't need $3M to ship MVP.
- **Vehicle**: Post-money SAFE + token warrant.
- **Valuation cap**: $12–18M baseline. Push to $20–25M if you have Sui Overflow win + 3 design partner LOIs + 5k waitlist.
- **Discount**: 20% (industry standard).
- **MFN**: yes, but with a sunset — "until next priced round only."
- **Token warrant**: investors get pro-rata of equity ownership in token allocation, at par or nominal price, subject to same vesting as team (1-yr cliff, 4-yr linear) at TGE.
- **Lead check size**: $250–500k from a tier-1 (a16z, Paradigm, Multicoin, Variant, Dragonfly, Hack VC, 1kx). Or $500k+ from Alliance/a16z CSX if you accelerate.
- **Follow-on**: Sui Foundation strategic check ($100–300k), Coinbase Ventures ($150–250k), 3–5 angels ($25–100k each).

### Seed (12–18 months out)

- **Round size**: $3–6M.
- **Vehicle**: Priced preferred + token warrant.
- **Post-money**: $20–40M depending on traction. With $50k MRR + 3k weekly active agents you're at $30M+.
- **Equity to investors**: 15–25%. Lead takes 8–15%, fills out with strategic.
- **Liquidation pref**: 1x non-participating. Don't accept anything else. **If a VC pushes 2x or participating, walk.**
- **Board**: At seed, board observer seat for lead. No board *member* until Series A unless lead writes >$3M check.
- **Pro-rata**: yes for lead. No for small checks (<$100k).

### Token Allocation to Investors

Aggregate across all rounds (pre-seed + seed + strategic): **12–18% of total supply maximum.** Pre-seed investors typically receive 3–6% of supply pro-rata to their equity stake. Resist any one investor demanding >5% of token supply.

### Strategic vs Financial

**Strategic (Sui Foundation, Mysten, Coinbase Ventures)** — Smaller checks ($100–500k), massive halo, real BD support, but slower process and may want roadmap influence. **Take them.** Foundation backing is signal money for everyone else.

**Financial (a16z, Paradigm, Multicoin)** — Bigger checks, faster process, sharper diligence, real network. Lead with one of these.

**Bad combo**: Two strategic investors with conflicting agendas (e.g., Coinbase Ventures + Binance Labs in same round). Pick a lane.

### Solo Founder "Discount"?

The data is sobering: solo-led companies are 30% of 2024 startups but received only 14.7% of priced-round capital ([Carta Solo Founders Report 2025](https://carta.com/data/solo-founders-report/)). Garry Tan publicly admits YC pushes solo founders to find co-founders ([Slashdot](https://slashdot.org/story/25/08/28/1540255/solo-founders-are-battling-silicon-valleys-biggest-bias)).

**But:** crypto-native rounds and AI-tooled solo founders are an exception. With AI tooling, solo founders ship faster than 4-person teams. Reframe: *"I'm not solo, I'm leveraged."* Be ready to hire CTO #1 with the pre-seed money — that's the implicit deal. Pre-commit to one named senior eng hire in your deck.

---

## 6. Traps to Avoid

### Post-Money SAFE Stacking
You raise 4 post-money SAFEs of $250k each at $15M cap over 6 months. Each locks 1.67% ownership. Total: 6.7% gone, founder-only dilution. Then your priced seed adds standard ESOP top-up + 20% to seed investors. You're at ~67% before Series A. Cap your total SAFE raise; don't keep stacking "just one more friendly check."

### MFN Ratchets
Bad MFN: "If any future SAFE has a lower cap, this SAFE auto-converts to that cap." Sign one $15M cap SAFE, then take a strategic at $10M cap → your first investor ratchets down free. Always restrict MFN to *priced rounds only* or *next priced round* with sunset.

### Signaling Risk
Tier-1 VC writes a tiny $150k check from "scout fund" or "founder fund," takes board info rights, then *passes* on your seed. Every other VC sees that pass as anti-signal. As [Mark Suster wrote](https://bothsidesofthetable.com/understanding-the-risks-of-vc-signaling-37dff617306f) and [Cobloom amplified](https://www.cobloom.com/blog/seed-funding-and-signaling-risk-how-to-avoid-killing-your-series-a): "If a major VC backs you at seed but doesn't follow on, you're probably dead." Rule: only take small tier-1 checks if they commit to follow-on terms in writing, or if it's their scout program with explicit "no signaling" carve-out.

### Token Allocation Over-Promise
Promise pre-seed investor 4% of supply on a $1M check at $25M FDV-equivalent. Then you raise seed where investors expect 12% combined. Then strategic wants 5%. You're at 21% to investors before TGE — anything above 20% is a red flag to public buyers ([Tokenomics.com](https://tokenomics.com/articles/token-vesting-complete-guide-to-vesting-schedules-cliffs-and-unlock-mechanisms)). The Suize fix: tie token allocation to *equity ownership at TGE*, not nominal % promised at SAFE signing. Use weighted-average dilution.

### FDV-Anchored Expectations
Crypto VCs underwrite to 10–100x on FDV at unlock. If you say "$200M FDV at TGE" in your deck, they'll buy at $20M FDV-equivalent and expect liquidity in 24–36 months. Token investors are *not* equity investors — they want exits, not enduring partnership. Don't promise TGE timing you can't hit.

### Lockup Misalignment
Investor lockup ends month 12 post-TGE; founder vesting runs 48 months. Investors dump, price tanks, you're still vesting through a crashed token. Standard fix: investor unlocks should be *equal to or longer than* founder vesting. Push for 12-month cliff + 36-month linear minimum for investors.

### Side Letters You Forgot About
Lead writes "1.5x pro-rata in next 2 rounds" into a side letter. Three rounds later, you've given them 7% extra dilution rights you forgot existed. Keep a single side-letter registry. Audit before every new round.

### Conflicting Portfolio
Some VC funds backed competing query/data layers (e.g., The Graph, Subsquid, Goldsky on EVM). If you take their money on Sui, you may get deprioritized as a "hedge." Ask: "Where do you have conflicts? Will Suize be your primary bet in this category?"

### Sui Foundation Grant Strings
Foundation grants come with milestone reporting (quarterly), ecosystem alignment expectations, and sometimes token allocation hooks (foundation may want allocation if you TGE). Read the agreement; their "strategic investments" are real equity with rights ([blog.sui.io](https://blog.sui.io/grants-rfp-process/)). Not necessarily bad, but understand: foundation expects you to stay Sui-exclusive (don't multi-chain in year 1 if you take their money). They can also fork off ecosystem work — they're a foundation, not a partner you can demand from.

### High Valuation Trap
You raise $1M at $30M cap with hype. 18 months later, no traction. Down round to $15M is brutal — anti-dilution kicks in for everyone, ESOP re-strikes, employees lose. Raise at a cap you can *grow into*. $12–18M is responsible; $25M+ requires real proof.

### Solo Founder Key-Person Risk
VCs will ask: "What if you get hit by a bus?" Counter: have a notarized continuity plan, an emergency CTO contact, and ideally a co-founder *in dialogue* you can name privately. Pre-commit to senior eng hire by month 3 of pre-seed.

### Convertible Note Traps
Old-school instrument: 6–8% interest accrual, 18–24 month maturity. If you don't raise priced round by maturity, you owe principal back or default. **Don't use convertible notes for crypto rounds.** SAFE + warrant is cleaner. If an angel insists on a note, push for 0% interest, 36-month maturity, automatic conversion at maturity.

### Anti-Dilution
Full ratchet = if next round is lower, all prior investors re-price to new low. Devastating. Broad-based weighted average = formula-based, founder-friendly. **Demand broad-based weighted average. Period.**

### Drag-Along / Tag-Along
Drag-along: majority can force you to sell. Tag-along: minority can join majority sale. Both are normal but watch the thresholds. Drag-along should require >66% combined founder + investor consent, not just majority preferred.

### Liquidation Pref Stacking
At Series B someone wants 1.5x participating with 3x cap. That sounds reasonable until you stack it on top of your seed 1x non-part. In a $40M exit with $20M stacked prefs, founders get nothing. Always model the exit waterfall before signing any non-1x non-participating term.

Sources: [Hustle Fund](https://www.hustlefund.vc/post/pre-money-vs-post-money-safes), [Seedlegals](https://seedlegals.com/us/resources/yc-post-money-safes-avoiding-expensive-dilution-mistakes/), [Value Add VC](https://valueaddvc.com/blog/liquidation-preference-explained-1x-2x-participating-vs-non-participating).

---

## 7. Warm Intros and Cold Outreach in 2026

### Warm Intro Paths (in priority order)

1. **Existing Sui portcos** — Founders of Cetus, Navi, Haedal, Scallop, NAVI. Reach out via X DM, ask for 15 min, end with "who at [VC] would care about Sui-native agent infra?"
2. **Mysten Labs employees** — DM Adeniyi (@EmanAbio), Kostas Chalkias (@KChalkias). Smaller team = more responsive than typical foundation reps.
3. **Sui Foundation BD / ecosystem** — Greg Siourounis publicly active. Reach via their forms first.
4. **x402 / MCP community** — Coinbase x402 contributors on GitHub, Anthropic MCP committers. A merged PR on the x402 spec = legit warm intro currency.
5. **Crypto YC / Alliance DAO alumni** — Any Alliance alum will intro you for a coffee if your thesis is strong.
6. **Lawyers**: Cooley, Latham, O'Melveny crypto practices know everyone. A 30-min paid consult = curated warm intro list.

### Cold Outreach That Actually Works

**Channel order**: X DM > Telegram > Farcaster > Email. Email is last because crypto VCs prefer X/TG/LinkedIn ([Innmind](https://blog.innmind.com/cold-messaging-crypto-vc-investors/)).

**Cold X DM template (best-performing 2026 format)**:

```
[Partner], you wrote about [their specific post on agents / KYA / nanopayments].
We're building exactly that on Sui.

Suize = MCP endpoint for Sui state, x402-metered, gasless USDsui.
Live agents are querying us today.

3-min demo? https://[your demo link]

Raising $1.5M pre-seed. SAFE + warrants. $15M cap.
```

Five lines. Specific reference to their public writing. Concrete numbers. One link. One ask. ([Pitchwise 2026 data](https://www.pitchwise.se/blog/email-outreach-for-fundraising-in-2026-proven-subject-lines-templates-and-follow-up-strategies))

**What NOT to do**: 500-word emails. Generic "loved your work" openers. No demo link. Attached PDF deck on first contact. Asking for "advice" when you really want money (be honest — they can tell).

### X Presence as Fundraising Weapon

VCs check your X profile within 30 seconds of seeing your DM. They want to see:
- Build-in-public posts (weekly product updates, latency wins, design partner reveals)
- Technical depth (one good Sui object-model thread = signal you actually get the stack)
- Engagement with their tweets (real comments, not "great post!")
- Founder voice (sarcastic, opinionated, sharp — the Anthropic/Mysten/Coinbase ecosystem rewards personality)

Post 1x/day minimum during fundraise. Use threads. Tag people sparingly but precisely.

### Conferences (Where to Spend Travel Budget)

| Event                            | Where/When               | ROI for You                                                      |
| -------------------------------- | ------------------------ | ---------------------------------------------------------------- |
| **Sui Basecamp / Builder House** | Multiple cities, rolling | Highest — Mysten team, ecosystem VCs, Sui Foundation in one room |
| **Sui Overflow 2026 Demo Day**   | Online + IRL             | Highest — your launch moment                                     |
| **Token2049 Singapore**          | Oct 7–8, 2026            | High — NEXUS program connects founders to investors directly     |
| **Breakpoint (Solana)**          | Late 2026                | Medium — Solana ecosystem but crypto-AI investors all attend     |
| **Permissionless (Blockworks)**  | NYC                      | High — DeFi-heavy but AI track growing                           |
| **ETHDenver**                    | Feb 2027                 | Medium — Ethereum-centric, but a16z/Variant attend               |
| **Consensus**                    | Annual                   | Low — too corporate, ROI poor for early-stage                    |
| **Devcon**                       | Buenos Aires 2026        | Low for Sui builder                                              |

Strategy: target Sui Basecamp first. Token2049 Singapore second. Skip the rest for round 1.

### Newsletters / Podcasts That VCs Read

Reach producers cold with a 3-line pitch: Bankless, Empire (Jason Yanowitz, Santi Santos), Lightspeed (Solana-focused but AI overlap), On The Margin (Mike Ippolito), Milk Road, The Rollup. Empire and Bankless give the most measurable VC lift per appearance.

---

## 8. How to Convince — Narrative and FOMO

### The Three-Beat Story

1. **The Agent Economy is Real** — Reference a16z's "Know Your Agent" framing. Quote that "non-human identities now outnumber human employees 96-to-1" in financial services per a16z ([source](https://a16zcrypto.com/posts/article/trends-ai-agents-automation-crypto/)). MCP went from 1.2k servers to 9.4k in 12 months. x402 hit $600M annualized in 10 months. *The infrastructure is being built right now.*

2. **Sui is the Inevitable Agent Chain** — Object model = no state contention. Parallel execution at 300k TPS. Sub-second finality. Move's resource safety prevents agent footguns. While Ethereum agents fight gas wars, Sui agents have deterministic state. Reference Sui's 35% latency reduction via Mysticeti ([Yellow](https://yellow.com/learn/sui-object-model-parallel-execution-layer-1)).

3. **Suize is the Query Layer** — Every agent ecosystem needs a query layer. The Graph emerged for EVM. Subsquid for Substrate. *Sui has no native MCP query layer.* First-mover, embedded payments, network effect via indexed corpus. We are picking up $50M/day in queries by 2027.

### Process Management (Run a Competitive Round)

**Anchor**: Get your first "yes" — even a $50k angel commitment in writing — *before* approaching tier-1s. The first yes is the hardest. Once you have it, every meeting changes tone.

**Tiered outreach**: Week 1 — 5 "B-tier" VCs (your fallback). Week 2 — 5 "A-tier." Week 3 — top 3 (Paradigm, a16z, Multicoin). This way you have momentum and term-sheet pressure when you hit the top.

**Create deadline**: "We're closing in 3 weeks." This is socially acceptable in crypto and forces decisions. Don't lie about deadlines — actually close.

**Multi-bidder dynamics**: If you have 2 term sheets, share with both that you have "competing interest." Never name names unless asked directly.

**Party round vs lead-led**: Lead-led is better — one investor with skin in the game writes 40–60% of round, brings BD. Party rounds (10 investors @ $100k each, no lead) leave you stranded with no advocate.

### Term Sheet Psychology

- Anchor high on cap; negotiate down. Never anchor low.
- Never negotiate on equity *percentage* — negotiate on *valuation cap*. Investors think in %, but cap is the lever.
- Concede on non-economic terms (pro-rata, info rights) to win on economic terms (cap, lib pref).
- Get everything in writing in the same week. Verbal "we're in" means nothing until signed.

### Reference Checks

Investors *will* call your past employers, co-workers, design partners. Pre-brief 3–5 references. Tell them what's coming. Send them a one-pager on Suize so they don't sound surprised on the call. The most valuable references are *demanding* customers (a design partner saying "we will pay for this") and *technical* mentors (a Mysten engineer saying "this person ships").

---

## 9. What's Expected of You After the Round

### Investor Updates

Monthly email, 250–750 words ([Visible.vc](https://visible.vc/blog/how-to-write-the-perfect-investor-update/)). Format:

```
SUIZE — MAY UPDATE

WINS
- [3 bullets max]

METRICS
- Weekly active agents: 47 → 89
- Queries/week: 12k → 34k
- Revenue: $0 (pre-launch)
- Runway: 16 months

ASKS
- Intro to [specific person/company]
- Hiring senior Move engineer — refer please

LOWLIGHTS
- [Be honest. VCs respect this.]

LOOKING AHEAD
- [Next 30 days]
```

Send mid-week (Wed/Thu). Consistency > frequency.

### Board Management

At pre-seed: no formal board. Lead investor may want quarterly catch-ups, board *observer* rights. Fine.

At seed: probably still no formal board. If lead writes >$2M, they'll want a seat. Push for 1 founder + 1 investor + 1 independent (you pick) structure. Avoid investor-majority boards until Series B.

### What Investors Actually Do (Honest)

| Promised                | Actual reality                                                         |
| ----------------------- | ---------------------------------------------------------------------- |
| "We open doors"         | True 30% of time. Quality varies wildly.                               |
| "We help hire"          | True for very senior roles only. They don't recruit your engineers.    |
| "We advise on strategy" | True if you ask specific questions. Don't expect proactive guidance.   |
| "Help with next round"  | Real value-add. Lead intros to A/B-round VCs is the #1 actual benefit. |

Most value-add is *reactive*. Treat your investors like a Slack channel you ping with specific asks. Don't expect them to push.

### Reporting Cadence

Monthly updates → quarterly board meetings (if board exists) → annual audited financials (only at Series A+). Information rights: standard "major investors" (typically $250k+) get info rights. Small angels usually don't.

### Your Job Post-Close

1. **Ship the product.** All else is theater.
2. **Hit milestones to next round** (the metrics in your deck — own them).
3. **Don't lie in updates.** Bad news early is forgivable; surprise bad news at next round kills you.
4. **Hire #1 senior eng within 90 days.** Solo-founder pre-seeds expect this. Failing to hire breaks the implicit deal.

---

## 10. Specific Contact List

### Sui Ecosystem

| Person          | Role                      | Public Handle    | Email Pattern                                            |
| --------------- | ------------------------- | ---------------- | -------------------------------------------------------- |
| Greg Siourounis | MD, Sui Foundation        | LinkedIn / forms | apply via [sui.io](https://www.sui.io/programs-funding)  |
| Evan Cheng      | CEO, Mysten Labs          | @evan_was_here   | info@mystenlabs.com (general)                            |
| Adeniyi Abiodun | COO, Mysten Labs          | @EmanAbio        | (DM first)                                               |
| Kostas Chalkias | Co-founder, Mysten        | @kostascrypto    | (DM first)                                               |
| Jeff Ren        | OKX Ventures (Sui-active) | @jeffrenLOL      | apply via [okxventures.com](https://www.okxventures.com) |

Sui Foundation RFP: [sui.io/request-for-proposals](https://www.sui.io/request-for-proposals). Grants: $10k–$100k + SUI bonus, signed milestone agreement.

### Tier-1 Crypto AI / Agent VCs

| Fund              | Partner               | X Handle                                            | Email Pattern                      |
| ----------------- | --------------------- | --------------------------------------------------- | ---------------------------------- |
| a16z crypto       | Chris Dixon           | @cdixon                                             | firstname@a16z.com                 |
| a16z crypto       | Ali Yahya             | @alive_eth                                          | firstname@a16z.com                 |
| a16z crypto       | Eddy Lazzarin         | @eddylazzarin                                       | firstname@a16z.com                 |
| Paradigm          | Matt Huang            | @matthuang                                          | firstname@paradigm.xyz             |
| Paradigm          | Dan Robinson          | @danrobinson                                        | firstname@paradigm.xyz             |
| Paradigm          | Charlie Noyes         | @_charlienoyes                                      | firstname@paradigm.xyz             |
| Multicoin         | Tushar Jain           | @TusharJain_                                        | firstname@multicoin.capital        |
| Multicoin         | Shayon Sengupta       | @shayonsengupta                                     | firstname@multicoin.capital        |
| Multicoin         | John Robert Reed      | @JohnRobertReed                                     | firstname@multicoin.capital        |
| Variant           | Jesse Walden          | @jessewldn                                          | firstname@variant.fund             |
| Variant           | Li Jin                | @ljin18                                             | firstname@variant.fund             |
| Variant           | Spencer Noon          | @spencernoon                                        | firstname@variant.fund             |
| Hack VC           | Alex Pack             | @alpackorg                                          | firstname@hack.vc                  |
| Hack VC           | Ed Roman              | @EdRomanVC                                          | firstname@hack.vc                  |
| Dragonfly         | Haseeb Qureshi        | @hosseeb                                            | firstname@dragonfly.xyz            |
| Dragonfly         | Rob Hadick            | @HadickM                                            | firstname@dragonfly.xyz            |
| Dragonfly         | Tom Schmidt           | @tomhschmidt                                        | firstname@dragonfly.xyz            |
| Robot Ventures    | Robert Leshner        | @rleshner                                           | rleshner@gmail.com (historic)      |
| Robot Ventures    | Tarun Chitra          | @tarunchitra                                        | tarun@gauntlet.network             |
| Pantera           | Paul Veradittakit     | @veradittakit                                       | firstname@panteracapital.com       |
| Polychain         | Niraj Pant            | @nirajpant                                          | firstname@polychain.capital        |
| Coinbase Ventures | Shan Aggarwal         | @shanaggarwal                                       | sa@coinbase.com (verified pattern) |
| Coinbase Ventures | Hoolie Tejwani        | @hooliet                                            | first.last@coinbase.com            |
| Delphi            | Anil Lulla            | @anildelphi                                         | firstname@delphidigital.io         |
| 1kx               | Lasse Clausen         | @lassec_                                            | lasse@1kx.network                  |
| Castle Island     | Nic Carter            | @nic__carter                                        | nic@castleisland.vc                |
| Bankless Ventures | Ryan Sean Adams       | @RyanSAdams                                         | (DM only)                          |
| Lemniscap         | Roderik van der Graaf | (DM via [lemniscap.com](https://www.lemniscap.com)) | apply via site                     |

**Email patterns are inferred from public posts and standard fund conventions; verify before sending.** When in doubt, DM first on X.

### Accelerators

- **Alliance DAO**: [alliance.xyz](https://alliance.xyz/) — apply via site; cohort ALL18 starts Sept 7, 2026
- **a16z CSX**: [a16zcrypto.com/accelerator](https://a16zcrypto.com/accelerator/) — $500k for 7%
- **Forge by Variant**: apply via [variant.fund](https://variant.fund/)

### Public Theses to Reference in Outreach

- [a16z "AI in 2026: 3 trends"](https://a16zcrypto.com/posts/article/trends-ai-agents-automation-crypto/) — KYA, nanopayments
- [a16z "Big Ideas 2026"](https://a16z.com/newsletter/big-ideas-2026-part-3/)
- [Hack VC's Alex Pack on Web3 AI as "biggest alpha"](https://www.coindesk.com/business/2025/04/12/where-top-vcs-think-crypto-x-ai-is-headed-next)
- [Multicoin Frontier Thesis 2025 — zero-employee companies, AI x crypto infra](https://multicoin.capital/)

---

## The First 14 Days Action Plan

### Day 1–2: Asset Lockdown
- Polish landing → live with working waitlist (capture email + role + org)
- Deploy 30-second demo video to X pinned post (your viral video reach is leverage)
- Write/refine 12-slide deck (sections in §3 above)
- Write 5-line cold DM template (§7) — personalize per recipient
- Set up Calendly with 25-min "Suize / 5-min demo" slots, weekdays only
- Open data room (Notion or DocSend): deck, demo video, technical architecture doc, founder bio, financial model (simple), cap table simulation

### Day 3: Alliance DAO Application
- Apply to Alliance DAO Crypto & AI Accelerator immediately. Even if past current deadline, applications roll for next cohort. ALL18 starts Sept 7, 2026.

### Day 4: Sui Ecosystem Outreach (3 messages)
- DM Adeniyi Abiodun (@EmanAbio) — short, specific, demo link
- Apply to Sui Foundation Developer Grant via [sui.io](https://www.sui.io/programs-funding) — push for $50–100k non-dilutive
- Submit Sui Overflow 2026 pre-registration via [overflow.sui.io](https://overflow.sui.io/), target Agentic Web track

### Day 5: Tier-2 Friendly Outreach (5 messages)
Start with the warmer/smaller checks who give faster feedback:
- Robot Ventures: @rleshner + @tarunchitra (both reply on X, fast yes/no)
- Bankless Ventures: Ryan Sean Adams via X DM
- Castle Island: Nic Carter via X DM
- Lemniscap: apply via site
- Symbolic Capital: via partner X DMs

Goal: First "yes" in writing within 14 days. Even a $50k commitment is enough to anchor.

### Day 6: Design Partner Sprint
- Email 5 obvious B2A buyers asking for 20-min "design partner conversation":
  - Wintermute (trading desk wanting Sui agent data)
  - Phantom or Backpack (wallet wanting agent-readable Sui state)
  - Messari or Nansen (analytics — they're competitors but also partners)
  - Virtuals Protocol (agent launchpad on Base — would they want Sui expansion?)
  - Olas Network (agent infra — natural partner)
- Goal: 3 LOIs by Day 30

### Day 7: X Posting Cadence
Start daily posting:
- Mon: technical deep-dive (object model thread, MCP architecture)
- Wed: build-in-public update (metric, screenshot, agent count)
- Fri: thesis post (why Sui for agents, x402 for B2A)
- Engage with 5 VC partner posts per day with substantive comments

### Day 8–10: Tier-1 Outreach (10 messages)
Now with momentum (waitlist count, design partner replies, Robot Ventures interest):
- Variant: Jesse Walden + Li Jin
- Multicoin: Shayon Sengupta + John Robert Reed
- Paradigm: Charlie Noyes + Dan Robinson
- Hack VC: Alex Pack
- 1kx: Lasse Clausen
- Coinbase Ventures: Shan Aggarwal
- Dragonfly: Haseeb Qureshi
- Pantera: Paul Veradittakit
- a16z crypto: Eddy Lazzarin

Personalize each DM with reference to *their specific recent post*. No spray-and-pray.

### Day 11–12: First Meetings
You'll have 3–5 first calls by now. Drill demo to 4 minutes flat. Practice answer to "where's your co-founder?" (§5 solo founder section).

### Day 13: Conference Lock-in
- Register Token2049 Singapore (Oct 2026)
- Apply to Sui Basecamp next event (any city)
- Apply to demo at any Sui Builder House in next 60 days

### Day 14: Status Check + Lawyer
- Count: how many warm conversations, how many first meetings, how many term-sheet signals?
- Engage Cooley, Latham, or Gunderson Dettmer for SAFE template + cap table review. Budget $5–10k for initial setup. They'll also intro you to investors.
- If you have 1+ "interested" verbal: start drafting your closing timeline. Aim for first wire within 45 days.

---

## Closing Honest Note

You're building important infrastructure at the right time. The agent economy thesis is no longer speculative — Coinbase, Google, Cloudflare, Stripe, and Visa are aligned on x402; Anthropic, OpenAI, Microsoft, Google are aligned on MCP; a16z is publicly saying "agents need legible payment rails." Sui's technical fit is real and underexploited.

But solo founders in crypto face structural headwinds. Your job in the next 14 days is to convert visible momentum (X reach, design partner LOIs, Sui Overflow positioning) into a *first yes*, then leverage that yes into 4 more, then close a $1–1.5M round at a $15M cap with token warrants.

Don't optimize for the highest valuation. Optimize for the *right lead* — one who'll write a Series A follow-on check and not signal-poison you. Robot Ventures, Variant, Multicoin, or 1kx as lead are all credible paths. Save a16z and Paradigm for seed when you have $20k+ MRR and 5 design partners — they'll move faster then.

Ship the product. Hit Overflow. Close the round. In that order.



