I have the full picture from the MAP and the three adversarial challenges. Here's the master plan.

---

# Suize — T-4 Master Plan (Jun 17 → Jun 21)

> One rail, proven four ways. Win Walrus + DeFi clean, submit DeepBook opportunistically, enter Agentic Web only if its gaps close. Sell the rails; products are proof. Scrub every borrowed number before it ships.

---

## 1. The narrative

**The pitch (slide-ready):**
> **Suize is the open payment rails for AI agents — gasless, non-custodial, on-chain, on Sui.** Every agent is about to need to pay, and today they can only pay through closed, custodial, walled-garden checkouts. Suize is the open answer: any agent that holds USDC on Sui can pay any merchant — one-off or subscription — in a single gasless transaction, where the 2% fee is a second declared output in the *same* PTB, so the on-chain balance-change set IS the receipt. We don't pitch this from a deck: **we built four merchants on our own rail** — Deploy (an agent ships a site to Walrus), PolySui (an agent takes a position on DeepBook), the PAY wallet (a non-custodial agent wallet that can't overspend), and the agents directory — each one live proof the ecosystem already works. The moat isn't the standard or "gasless" (both commodity) — it's **on-chain enforcement**: the funded balance IS the spend cap, a subscription is a soulbound object you delete to cancel, and the fee is visible in the receipt. Enforcement custodial incumbents structurally can't replicate.

**Per-track "why now" hooks (figures cited as THEIRS, each needs an inline source — see §6):**

- **DeFi / Rail:** *"McKinsey projects $1–5T in agentic commerce by 2030; Alipay, Visa, Mastercard, Stripe+Tempo and Coinbase all shipped agent-payment rails in 2026 — every one custodial and walled-garden. The open, on-chain seat is empty, and Sui isn't on x402's network list. We run the only live x402 facilitator for Sui."*
- **Walrus / Deploy:** *"Walrus is live and already a top decentralized-storage network with 120+ projects building on it — programmable storage needs a programmable buyer. Deploy is the first merchant that lets an agent pay for and own Walrus storage in one request."*
- **DeepBook / PolySui:** *"Prediction markets went mainstream — Polymarket cleared tens of billions in monthly volume in 2026 and Google Finance now embeds the odds. PolySui brings that to Sui on DeepBook Predict, and an agent can pay its way into a position."*
- **Agentic Web / PAY:** *"Every incumbent agrees agents will spend — Visa, Mastercard, Stripe+Tempo, Coinbase and Alipay all shipped agent wallets in 2026. Every one holds the keys. PAY is the non-custodial counter: the agent spends, you hold the keys, one tap claws it all back."*

---

## 2. Deck changes (file-level, `apps/deck/src/`)

Ordered. Two code changes (schema + one component + ~12 CSS lines); rest is copy.

| # | Edit | File · what | Effort | Who |
|---|---|---|---|---|
| 1 | **Home H1 flip** — `Index`: kicker → "The agentic payment rails on Sui"; H1 "Four products. One rail." → **"The open payment rails for AI agents."**; sub → "Agents are about to move trillions… one transaction, on Sui." | `views.tsx` (Index, ~L254-261) | 10 min | [CLAUDE] |
| 2 | **Per-card `proves:` line** — add optional `proves` to each track card, render in `tcard`. Suize="the rail itself" · Deploy="proves the rail bills real Walrus storage" · PolySui="proves an agent can pay into a live market" · PAY="proves a consumer wallet pays merchants safely". *This single change re-sequences the deck from "4 products" to "1 rail, 3 proofs."* | `types.ts` + `tracks.ts` + `views.tsx` + `deck.css` | 30 min | [CLAUDE] |
| 3 | **`WhyNow` component + schema** — add `whyNow?: {figures:string[]; close:string}` + `ecosystemProof?:string` to `TrackPage`; new `WhyNow` render fn (↗ bullets + serif close, mirrors `.proof`); ~12 CSS lines. | `types.ts` + `views.tsx` + `deck.css` | 45 min | [CLAUDE] |
| 4 | **Rails why-now band on Home** — render `WhyNow` between `phead` and `grid4` with the §1 DeFi/rails figures + land-grab close. Keep `thesisbar` as closer. | `views.tsx` (Index) | 20 min | [CLAUDE] |
| 5 | **Per-track why-now + ecosystemProof copy** — populate `whyNow` + `ecosystemProof` on all 4 tracks (§1 hooks). PolySui `ecosystemProof` MUST carry the caveat verbatim: *"live merchant + payer — the Crash→Suize 2% leg is designed, positioned as PoC, not claimed live (LOCKED #11)."* | `tracks.ts` | 45 min | [CLAUDE] |
| 6 | **Fix the x402 PR claim** — `tracks.ts` L40/74/189: the skeptic verified #2615/#2616 ARE open upstream on x402-foundation/x402 (the "not yet open" guardrail is stale). Current "open PRs upstream" is rung-LEGAL — **leave it**, but downgrade any "merged upstream" wording to roadmap framing. | `tracks.ts` | 10 min | [CLAUDE] |
| 7 | **402 artifact reconcile** — Deploy journey shows a 1-output $0.50 sample (matches live `/deploy`); keep the 2-output split only on the generic `/suize` rail page. Kills the ping-and-catch mismatch. | `tracks.ts` | 15 min | [CLAUDE] |
| 8 | **Masthead tagline** → "The open payment rails for AI agents · built on Sui." | `App.tsx` L36 | 5 min | [CLAUDE] |

**Deck law (do not trip):** never mention hackathon/prize money on the deck (judges + future VCs read it). No "live on mainnet" until publish lands. No "diodes"/dot-pill slop.

---

## 3. Features to ship before deadline

Ranked by readiness. **Decisive verdict: ship the action-log (Tier A) — it's the one true differentiator and unblocks Agentic Web. Live-test subs (it's done, just rehearse). Light up MemWal TODAY as a cheap probe — if the relayer's dead, cut it and lose nothing.**

### (a) Subscriptions live-test — **SHIP (it's done, just demo it)**
- **BUILT:** Move module published testnet, 17/17 tests, `verify-testnet.ts` proves create→renew→`ETooEarly`→cancel against live chain. Wallet `subs.ts` builders + in-app silent-renew loop (`useSubscriptions.ts:127`) all green.
- **Gap:** never exercised *on camera in the wallet UI*; war-room says there's no in-app "create subscription" button (seed via Deploy `/confirm-subscribe`).
- **Minimum demo-real:** open wallet → create a short-period sub → background/refocus → watch silent renew toast → cancel → object deleted. **~1 hr.** Closed-app cron = OPTIONAL (~1-2 hr more), defer.
- **Effort:** ~1 hr. **Who:** [CLAUDE] dry-run + [OWNER] on camera. **Verdict: SHIP — zero new code, it's the "push-not-pull, client-first" headline.**

### (b) Walrus tool-call action-log — **SHIP Tier A (the only real build, the moat line)**
- **BUILT:** nothing — one BACKLOG line. The existing "trace" is a chain-derived *financial* ledger, not an agent-action log. **This is the gap the judge + VC both stabbed.**
- **Reuse (all proven):** `walrus.ts:232 storeBlob`, the deploy sign path, capture chokepoint at `WalletDeck.tsx:385 runAgentTool`.
- **Minimum demo-real (Tier A):** hash-chained JSONL (one entry/tool-call: `ts,tool,outcome,txDigest?,prevHash`) → batch flush → `POST /trace` stores blob + service-wallet emits `trace::record` on-chain anchor event (`{owner,blobId,batchHash,count}`, ~30 lines Move, copy move-deploy shape) → viewer recomputes chain, checks against on-chain event → "✓ verified · N actions · anchored at <tx>" badge; tamper one byte → red. **Don't Seal-encrypt v1** (tool names + digests = no PII; public-but-verifiable is the *stronger* demo).
- **Effort:** ~1.5–2 days. **Who:** [CLAUDE] (Move publish needs [OWNER] key, ~3-4 hr of it). **Verdict: SHIP — it's the difference between "we stored a file" and "verifiable on-chain trace," and it's the Agentic-Web must-have. Premortem: per-tool on-chain write = laggy demo → batch one anchor per session.**

### (c) MemWal — **PROBE TODAY, then SHIP or CUT**
- **BUILT:** fully coded both ends (`memory/index.ts`, `data/memwal.ts:50`), SDK installed, wired into the brain + `WalletDeck.tsx:685`. **DORMANT** — no `MEMWAL_*` env set anywhere; never run against a real relayer.
- **Gap:** pure configuration + external-dependency risk. We have *never* seen the relayer respond.
- **Minimum demo-real:** set 4 envs (`MEMWAL_PACKAGE_ID/REGISTRY_ID/RELAYER_URL/MASTER_KEY`) → write a 30-line verify script (`analyze` a preference, `recall` it) → demo cross-session memory. **~half-day, dominated by dependency wrangling.**
- **Effort:** ~half-day. **Who:** [OWNER] gets MemWal testnet ids; [CLAUDE] writes verify script. **Verdict: PROBE TODAY (Jun 18). If the staging relayer answers → SHIP (cheap moat line). If it's dead → CUT immediately, fall back to "memory layer built, MemWal pending their testnet." Do NOT claim "encrypted end-to-end" — relayer sees plaintext; say "stored encrypted on Walrus, owned on-chain by the user."**

---

## 4. Mainnet release plan (Wallet + Deploy + rail + subs — NOT PolySui)

> **GO/NO-GO: NO-GO before Jun 21. Defer mainnet to post-submission (collect the 50% prize half later — LOCKED #12 says testnet wins).** Reason: the flip is gated on a 🔴 code blocker (§3 of the mainnet report) that touches every id consumer, plus Move republishes + WAL funding + Enoki paid tier. That's a 1-2 day money/keys operation with brick risk, colliding with the 4-day submission crunch. **Do it the week of Jun 22, calmly, before the August announcement, to bank 100%.** Below is the ordered checklist for then.

| # | Step | Who | Note |
|---|---|---|---|
| 1 | 🔴 **Fix network-aware id resolution** — every consumer imports static `PACKAGE_IDS = packageIds('testnet')`. Replace with `packageIds(config.suiNetwork)` in backend (`deploy/*`, `directory/*`, `sponsor/*`) + wallet + deploy app; make `*_PUBLISHED` flags network-aware. **Naive `SUI_NETWORK=mainnet` without this runs mainnet against testnet ids + poisons the sponsor allow-list.** | [CLAUDE] | DO FIRST. Show-stopper. |
| 2 | Fix `coins.ts:69` hardcoded testnet USDC → `USDC_TYPES[NETWORK]`; override `WAL_COIN_TYPE` + `WALRUS_SYSTEM_OBJECT` (default testnet in config.ts). | [CLAUDE] | |
| 3 | Flip `move-subs` + `move-deploy` Move.toml `framework/testnet` → `framework/mainnet`; ship the F6 u128 fee-widen. | [CLAUDE] | |
| 4 | **Publish** `subs` + `deploy_sui` on mainnet; transfer `DeployerCap` to the prod deploy wallet. | [OWNER] | keys |
| 5 | Fill mainnet ids in `@suize/shared` `NETWORK_ADDRESSES.mainnet` from publish digests. | [CLAUDE] | |
| 6 | Run `sync-subs-config.ts` (`SUI_NETWORK=mainnet`) — sets `SubsConfig.treasury` to resolved `treasury@suize` + pins mainnet USDC. | [CLAUDE]+[OWNER] (SubsAdminCap) | else renewals abort `EWrongCoin` |
| 7 | **Funding + secrets:** Enoki PAID tier; fund sponsor pool (SUI); fund deploy wallet (SUI **+ WAL** — the one that bites); stand up self-hosted mainnet Walrus publisher (WAL); set `ALLOWED_ORIGINS` (replaces defaults — list ALL prod origins). | [OWNER] | money/keys |
| 8 | Redeploy: backend (k8s), worker (`wrangler deploy --env mainnet` + move the `*/*` route), wallet + deploy frontends (`VITE_SUI_NETWORK=mainnet`). **Keep PolySui/Crash pinned testnet.** | [CLAUDE] | |
| 9 | Smoke test mainnet: rail (never sender==recipient), treasury resolves, Deploy $0.50 one-off, subs create/renew/`ETooEarly`/cancel, WAL storage-extend, wallet reads mainnet USDC, Crash still sponsors on testnet (dual-network guard). | [CLAUDE]+[OWNER] | |

**Risks:** static-id blocker (🔴), `*_PUBLISHED` poisoning sponsor allow-list (🔴), forgot WAL funding (🟠), Enoki still free tier (🟠), CF route collision (🟡), "live on mainnet" claimed before publish (🟡 claim-ladder).

---

## 5. Judge/VC holes to close

| Hole (who flagged) | Severity | Fix |
|---|---|---|
| **100% of GMV is dogfood — zero external merchants/agents** (VC, "the fundability killer") | 🔴 | Get **ONE external party** to pay the 2% before the raise — one merchant you didn't build, or one external agent. Worth more than all four submissions for fundability. Frame the raise around this milestone. |
| **Agentic Web fails 2 of 4 must-haves** (judge) — no real DeepBook order, no on-chain activity log | 🔴 | Ship the action-log (§3b). For the DeepBook-order must-have: either wire one Predict order from the capped sub-account, or **don't submit Agentic Web** (a must-have-fail is told to be down-ranked). Decide by Jun 19. |
| **Moat sold as the standard/gasless (commodity) + facilitator is an absence** (judge + VC) | 🟠 | Re-lead the DeFi video with **on-chain enforcement**: fee leg a merchant can't zero (balance-change receipt) → soulbound subscription deleted live to cancel. That's the defensible, demo-able delta. |
| **"Why not self-host the 60-line verifier + keep the 2%?"** (judge killer objection) | 🟠 | Crisp rebuttal: facilitator network effects + the x402 land-grab + `/supported` being the only live Sui facilitator. Put it in speaker notes. |
| **PolySui has no PLP backtest/sim** (judge) — track asks for it on vaults | 🟡 | Either add a basic sim curve or position PolySui as PoC and spend zero marginal hours. It's lowest 1st-place odds + testnet-capped. |
| **Submission hygiene: repo private, no LICENSE, no videos** (judge, disqualifying) | 🔴 | Flip repo public + MIT LICENSE; record 4 tight ≤5-min videos, each opening with real money moving, each pointing at ONE product. Verify Crash builds against `predict-testnet-4-16`. |
| **Four products read as unfocused** (VC) | 🟠 | The deck H1 flip + `proves:` lines (§2.1, §2.2) land "one rail, three proofs" in 30 sec. |

---

## 6. Honesty fixes (non-negotiable)

| Issue (skeptic) | Rewrite |
|---|---|
| **Every proposed market figure is unsourced; some fabricated-precise** ("Alipay 120M agent-tx/week", "WeChat Q3 2026", "Stripe+Tempo Mar 2026 100+ services", "Polymarket $25.7B/mo", "Walrus 467TB/$140M/2nd-largest"). One debunked stat poisons every true claim. | **Add inline source + as-of date to EVERY figure** ("McKinsey, 2025"; "Walrus dashboard, Jun 2026"; "Polymarket, Q1 2026"). **If you can't cite it, DELETE it.** Drop the precise-but-unverifiable counts; keep ranged/attributed claims. This is the #1 honesty fix. |
| **"2nd-largest decentralized storage"** — unprovable superlative in front of Walrus-native judges | **Cut it.** Keep "only LIVE x402 facilitator for Sui" (that one is true + verifiable — Sui isn't on x402's list). |
| **PolySui "an agent can pay into a live market" / "live merchant + payer"** stated as present-tense fact | **Keep the caveat verbatim on the slide AND speaker notes:** "the Crash→Suize 2% leg is DESIGNED, positioned as PoC — not claimed live (cross-network gap, LOCKED #11)." Never let a presenter say "PolySui pays Suize" as fact. |
| **PAY "verifiable trace of every agent action"** = roadmap (only the financial ledger exists today) | Say **"verifiable on-chain payment trace"** (true now). Keep "every agent action" OFF the deck until the action-log badge turns green. |
| **402 artifact 2-output vs live 1-output `/deploy`** | §2.7 — 1-output sample on the Deploy journey, 2-output only on `/suize`. |
| **x402 PR claim** | Skeptic VERIFIED #2615/#2616 are open upstream — "open PRs upstream" is rung-legal, **keep it.** Never say "on x402 / official / default Sui facilitator" as fact. |

---

## 7. The 4-day sequence (Jun 18 → Jun 21)

**Critical path is bolded. I (Claude) start on deck edits + the MemWal probe + the action-log Move scaffold immediately.**

**Jun 18 (Wed) — unblock externals + deck spine**
- **[CLAUDE] START NOW: deck edits §2.1–§2.5 + §2.8** (H1 flip, `proves:` lines, WhyNow band, per-track copy). Highest leverage, lowest risk.
- **[CLAUDE→probe] MemWal verify script + 4 envs** — find out TODAY if the relayer answers. Cut-or-keep decision by EOD.
- **[CLAUDE] START the action-log Move module** (`packages/move-trace`, copy move-deploy) — the long pole.
- [OWNER] confirm `ANTHROPIC_API_KEY` fires via a live WS turn + the 2nd OAuth client is allow-listed + sub-account funded ≥1 USDC (the two demo-killing gates). Get MemWal testnet ids. **Flip repo public + add MIT LICENSE.**
- [OWNER] scrub every market figure for a real source (§6) — hand citations to [CLAUDE].

**Jun 19 (Thu) — build the differentiator + decide Agentic Web**
- **[CLAUDE] Action-log Tier A: client capture (`runAgentTool`) + `POST /trace` + viewer/badge.** [OWNER] signs the `trace::record` publish.
- **DECISION GATE (Jun 19): Agentic Web in or out.** If action-log + one real DeepBook-order spend ship → in. Else → out, redirect that video slot to Deploy/DeFi.
- [CLAUDE] honesty scrub on deck (§6) using owner's citations; reconcile 402 artifact (§2.7).
- [CLAUDE] subs live-test dry-run (§3a) so the camera take is clean.

**Jun 20 (Fri) — videos + flagships**
- **[OWNER+CLAUDE] Record the two flagship videos: Walrus/Deploy + DeFi/Rail** (each ≤5 min, open with money moving, lead DeFi with the enforcement moat not "gasless"). These are the keystone assets — Presentation is 10% and the carrier for the other 90%.
- [CLAUDE] action-log polish + verified-badge tamper demo.
- [OWNER] record DeepBook/Crash video (opportunistic); verify `predict-testnet-4-16` branch.
- [OWNER] write/rehearse the two killer-objection rebuttals (self-host-the-verifier; why-not-Stripe+Tempo).

**Jun 21 (Sat) — submit**
- [OWNER] final 4 (or 3) submissions: each points at ONE product + its own package IDs, ≤5-min video, 1:1 logo, public repo, MIT license.
- **NEVER submit a must-have-failing Agentic Web entry** — if its gaps didn't close, ship 3 clean ones.
- No mainnet flip today. Defer to Jun 22+ (§4).

---

## 8. Cut list (drop in this exact order if time runs out)

1. **MemWal** — first to go (cut Jun 18 if the relayer doesn't answer; it's a nice-to-have moat line, not load-bearing).
2. **Closed-app subscription cron** — the in-app silent-renew already proves push-not-pull; skip the cron live-exercise.
3. **PolySui PLP backtest/sim** — position as PoC, spend zero marginal hours.
4. **Agentic Web submission entirely** — if the action-log + DeepBook-order gaps don't both close by Jun 19, don't submit it (a checklist-fail is down-ranked anyway).
5. **DeepBook/Crash video** — opportunistic; cut if the two flagship videos aren't done.
6. **Action-log Tier A → Tier B** — if Move-publish time vanishes, fall back to Walrus-only storage (content-addressed) and say "stored immutably on Walrus" — but you lose "anchored on-chain."

**NEVER CUT:** the flagship **Deploy/DeFi flow** (agent → gasless $0.50 → live Walrus site → owner==payer → visible fee receipt — it sells 3 of 4 tracks), **calibrated honesty** (every number sourced or deleted), and **submitting the two flagships before the deadline with their ≤5-min videos**.

---

**Bottom line:** Go all-in on **Walrus (Deploy) + DeFi (Rail)** — best fit, best odds, the thesis. Ship the **action-log** (the only real build, the moat line, the Agentic-Web unblock). **Live-demo subs** (done). **Probe MemWal today, cut on failure.** **Defer mainnet** to the calm week after. **Source every market number or delete it** — your real proof (live facilitator, dogfood landing, 21/21 green) wins on its own; one fabricated stat costs you every true one.