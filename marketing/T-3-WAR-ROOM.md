# SUIZE — T-3 BATTLE PLAN (Jun 18 → Jun 21 submission)

> Owner strategy doc (sanctioned marketing/ exception). Generated 2026-06-17 from a 9-auditor
> ground-truth recon of all 4 products + the rail. The law for this sprint: **we do not fake.**
> The real product is undeniable; faking gets caught in a 5k-person ecosystem = fatal. Polish,
> mockups, videos, "sell the moon" copy = allowed. Fabricated txs / invented metrics = refused.

## 1. VERDICT

You have a **genuinely real, deployed product** — rarer than gold in a hackathon — but a **cold marketing engine and four demos that all hinge on environment config you haven't confirmed**. You can win DeFi/Payments (bullseye fit, best-evidenced flow) and place top-3 on Walrus; PolySui and PAY are fightable, not free. **The single biggest risk: `ANTHROPIC_API_KEY` may not be live in prod — if so, the entire Agentic Web headline AI returns "the assistant isn't configured" on camera and that track collapses from an 8 to a 4.** Confirm that key TODAY, before anything else. Second risk: the demo video — the one asset everything reuses — does not exist on disk.

## 2. REAL-vs-MOCK LEDGER

"Show-live" = real, on camera against prod. "Mockup" = honest illustrative artifact, labeled. "Hide" = don't click it on camera. "Roadmap" = name it as a next step, never as shipped.

### PAY wallet (Agentic Web)
| Feature | Status | Demo stance |
|---|---|---|
| Google sign-in (zkLogin) + handle claim | REAL | show-live |
| USDC balance + verifiable on-chain trace | REAL | show-live |
| Gasless USDC send (x402 send_funds) | REAL | show-live |
| Subscriptions LIST/RENEW/CANCEL | REAL (list may be empty) | show-live IF pre-seeded, else roadmap |
| Agent sub-account arm/fund/sweep (1-of-2 multisig) | REAL (2nd OAuth client prod-unconfirmed) | show-live IF OAuth verified |
| Conversational AI brain (Haiku, 7 tools, number wall) | REAL CODE / **prod key UNCONFIRMED** | show-live ONLY after key confirmed |
| `deploy_site` via chat (the killer moment) | REAL (3-link dependency chain) | show-live ONLY if all 3 green |
| Subscription CREATE from wallet | ABSENT (no in-app button) | hide / seed via Deploy bridge |
| LegacyAssistant "book flight to SF" (?demo=1) | **MOCK — 100% fake** | **NEVER show — do not pass ?demo=1** |
| Add-funds Bank/Apple/Card, request links | ABSENT (coming-soon gated) | hide (don't click) |

### Deploy (Walrus)
| Feature | Status | Demo stance |
|---|---|---|
| Agent pays $0.50 → Walrus → on-chain Site → live URL | REAL, LIVE testnet | **show-live (the flagship)** |
| Double-hash integrity serving (X-Suize-Integrity: verified) | REAL, LIVE | show-live |
| $0.50 x402 charge gate (enforcing, rejects forged) | REAL, LIVE | show-live |
| On-chain dedup (replay → 409) | REAL | show-live |
| Storage-renewal subscription | BUILT, **never run a live renew** | roadmap-slide (don't demo the renew) |
| Custom-domain DNS verify + link | REAL, not live-probed | roadmap / mention only |
| Dashboard (read-only on-chain) | REAL | show-live |
| **Mainnet** | ABSENT (all ids 0x0) | **soften to "live on Sui testnet, mainnet is a one-command republish"** |

### PolySui (DeepBook)
| Feature | Status | Demo stance |
|---|---|---|
| On-chain router (bet/cash_out/claim/supply/redeem) | REAL, LIVE testnet | show-live |
| 3% rake skimmed on-chain | REAL | show-live |
| Gasless zkLogin bet writes | REAL (origin must be allowlisted) | show-live IF origin verified |
| Live BTC odds + cash-out from DeepBook Predict | REAL | show-live IF active round in-window |
| "Be the House" PLP vault (real supply/redeem) | REAL | show-live |
| Portfolio/Leaderboard from chain (SuiVision links) | REAL | show-live |
| "Sample bets" Math.random tape | **MOCK (labeled illustrative)** | **DELETE before demo** |
| Agent tab (autonomous bettor wedge) | STUB (explainer + read-only feed) | roadmap / cross-app demo only |
| CRASH wordmark on Play screen | STALE BRAND | fix before demo |

### Agents directory
| Feature | Status | Demo stance |
|---|---|---|
| DNS + Vercel + backend routes live | REAL (better than docs claim) | show-live |
| On-chain ad-slot read | REAL | show-live |
| Feed / rankings engine (code) | REAL but **returns [] — empty** | **hide unless seeded, else ?stub=1 labeled** |
| Ad slots | REAL but all genesis, never bid | seed one real bid or frame as genesis |
| Sign-in/wallet machinery | STUB (wired, unmounted) | hide |

### Landing
| Feature | Status | Demo stance |
|---|---|---|
| Consumer home (/) + business (/business) | REAL, clean, on-message | show-live |
| Pricing (2% · 1¢ min) | REAL | show-live |
| /docs "Tier 0 hosted no-code pay-link + webhook" | **STALE — documents DELETED system** | **fix (blocker)** |
| llms.txt hosted no-code door | **STALE — points agents at 404** | **fix (blocker)** |

### x402 rail / charge door (DeFi)
| Feature | Status | Demo stance |
|---|---|---|
| Facilitator core (/verify /settle /build /terms /supported /tx) | REAL, LIVE | show-live |
| 2%/$0.01 fee FORCED at verify | REAL | show-live (trust-as-monetization) |
| Deploy $0.50 path, owner==payer, gasless | REAL, hard E2E asserts | **show-live (best-evidenced)** |
| @suize/pay middleware (npm 0.4.1) | REAL, published | show-live |
| subs + auction Move modules | REAL, published testnet | show-live (package ids) |
| `/charge/<token>` hosted door + webhook | REAL CODE / **ZERO tests, never fired live** | rehearse privately; lean on deploy path |
| BusinessConsole demo charge link | MOCK (`charge/demo-${price}`) | hide / run with demo=false |

### Pitch deck
| Feature | Status | Demo stance |
|---|---|---|
| 4 track pages + journey stepper | REAL, deployed | show-live |
| Live 402 probe (real prod wire) | REAL | **show-live (the "not a slide" moment)** |
| npm packages live | REAL | show-live |
| Static 402 artifact (2-output) vs live (/deploy 1-output) | MISMATCH | fix: point live button at /terms |
| "@suize/pay 0.3.1" version note | STALE (is 0.4.1) | fix |

## 3. BLOCKERS (ordered by severity)

1. **`ANTHROPIC_API_KEY` unconfirmed in prod backend.** Headline AI dead if unset. → [OWNER] Set key in k8s SOPS secret, redeploy, send one WS chat turn. **30 min.** *First, today.*
2. **Agent sub-account 2nd OAuth client prod-unverified.** Gates the `deploy_site` killer demo. → [OWNER] Verify wallet.suize.io allow-listed in Google Cloud + Enoki Portal; Connect E2E; fund sub-account ≥1 testnet USDC. **30–60 min.**
3. **Landing /docs + llms.txt ship the DELETED no-code pay-link/webhook door as live.** Honesty blocker + agents hit a 404. → [CLAUDE] Scrub config.js + llms.txt + SPEC §1 docs-truth-lock. **45 min.**
4. **agents.suize.io feed/rankings empty ($0/0/0/0).** Looks dead. → [OWNER+CLAUDE] Seed 2-3 real testnet payments + one ad bid, OR demo with `?stub=1` labeled. **Decide now.**
5. **PolySui Math.random "Sample bets" tape on the primary screen.** Spottable fake. → [CLAUDE] Delete it. **10 min.**
6. **PolySui CRASH wordmark on Play screen.** → [CLAUDE] Swap to PolySui. **20–40 min.**
7. **No `/ready/brain` probe.** Can't confirm AI live without a WS session. → [CLAUDE] Fold `brainInfo.enabled` into `/ready`. **20 min.**
8. **Deck static-vs-live 402 mismatch + stale npm 0.3.1.** → [CLAUDE] Point live button at `/terms`; bump to 0.4.1. **16 min.**
9. **No subscription to LIST in PAY wallet.** → [OWNER/CLAUDE] Pre-create one on testnet via Deploy `/confirm-subscribe`. **30 min.**
10. **Submission deliverables MISSING:** no root LICENSE, no 4 square (1:1) logos, no demo videos, repo not secret-scanned for public flip. **Gating.**
11. **ProductStub "Detail page in progress" status-talk** (forbidden by SPEC §7.5). → [CLAUDE] Neutral label. **5 min.**

## 4. THE 3-DAY PLAN (hour-budgeted)

### DAY 1 — Jun 18: UNBLOCK THE DEMOS
- **[OWNER] Confirm/set `ANTHROPIC_API_KEY` in prod, redeploy, test one WS chat turn. (30–45 min) — CRITICAL, first.**
- **[OWNER] Verify agent 2nd-OAuth client allow-listed for wallet.suize.io; arm + fund the demo sub-account ≥1 USDC. (45 min) — CRITICAL.**
- [OWNER] Confirm service wallet has USDC+SUI for live deploys; `treasury@suize` resolves on demo machine. (15 min)
- **[CLAUDE] Fix landing /docs + llms.txt + SPEC honesty blocker. (45 min) — CRITICAL.**
- [CLAUDE] Add `/ready/brain` probe. (20 min)
- [CLAUDE] PolySui: delete Math.random tape + fix CRASH→PolySui wordmark. (45 min)
- [CLAUDE] Deck: 402 probe → /terms, bump npm version. (16 min)
- [CLAUDE] Root LICENSE (MIT) + ProductStub badge fix. (20 min)
- [OWNER] Secret-scan pass, then **flip monorepo public** (or decide split). (30 min)
- [OWNER] **Comment on x402 PR #340** (rung-legal). Highest-leverage free move. (30 min)

### DAY 2 — Jun 19: SEED DATA + RECORD
- **[OWNER] Record the Deploy/DeFi flagship video first — the keystone. Raw OBS: agent hits 402 → pays $0.50 → live *.suize.site → /tx receipt with fee leg. Testnet label on. (1–2h) — CRITICAL.**
- [OWNER+CLAUDE] Seed agents directory: 2-3 real testnet payments + one real ad-slot bid. (45 min)
- [OWNER/CLAUDE] Pre-create a testnet subscription for the PAY wallet list. (30 min)
- [CLAUDE] Pre-warm a clean demo site for the killer load moment. (1h)
- [OWNER] Record PAY wallet video (chat → build game → confirm → one tap → pays from sub-account → live URL). **Only if blockers 1+2 green.** (1h)
- [OWNER] Record PolySui video (sign-in → one-tap UP → live cash-out → SuiVision rake leg). Verify origin + active round first. (45 min)
- [CLAUDE] Generate 4 square (1:1) logos — Gemini 3.0 Pro. (45 min)
- [OWNER] Create X account, set avatar/banner. (20 min)

### DAY 3 — Jun 20: POLISH + WARM SURFACES
- [OWNER] Record the 4th video (Suize rail / deck live-402). Cut all four to <5 min, YouTube upload. (2h) — CRITICAL.
- [OWNER] Grab the SuiVision receipt screenshot (fee leg visible). (15 min)
- [OWNER] Draft launch thread + Show HN title/first-comment. (1h)
- [OWNER] Post forums.sui.io write-up + r/mcp build-log. (1h)
- [CLAUDE] Final dry-run each demo path against prod; full repo grep for stale strings. (1h)
- [OWNER] Rehearse the `/charge/<token>` door ONCE privately (real pay, real webhook). (45 min)
- [OWNER] Pre-stage: funded wallets, active round queued, fallback pre-deployed URL ready.

### Jun 21 — SUBMIT
- [OWNER] Submit all 4 early (editable until deadline): name, description, 1:1 logo, public repo, ≤5-min YouTube, network, package ids (from `@suize/shared`).
- [OWNER] Same-day: X thread, **Show HN (Sun 7pm ET / Mon 00:00 UTC)**, media@sui.io one-paragraph pitch.

## 5. DEMO-MERCHANT SPEC

1. **Deploy itself (FIRST merchant) — $0.50 one-off.** x402 charge gate at `POST /deploy`. Already live + E2E-proven — **primary, lean on it.** Needs: service wallet funded.
2. **A one-line `@suize/pay` Node merchant — generic API selling a digital good.** ~20 lines guarding `GET /joke`. Proves "one line, live in minutes" on a *third-party* endpoint. Needs: payTo + npm (have both). 30 min.
3. **A plain-HTTP (any-language) 402 merchant — curl-able.** Same gate without the SDK. Proves the "no SDK required" rung. Optional. 30 min.
4. **`/charge/<token>` hosted door — DEFER unless rehearsed.** Coded but untested, landing copy being deleted. Don't feature. Show subs renewal instead for recurring.

**Subscription merchant:** the pre-created testnet `Subscription` object. Proves create→list→silent-renew→cancel(=delete).

**Recommendation:** ship #1 + #2 + the subscription. Skip #3/#4 unless time is abundant.

## 6. PER-PRODUCT DEMO VIDEO SHOT LIST (<90s each)

**Tooling:** these are **screen recordings (OBS), not veo3.1** — the point is "this is real, watch it happen." veo3.1 only for a B-roll intro/mascot bumper, never the product flow.

### Deploy (Walrus) — FLAGSHIP, record first
1. (0–10s) Terminal: fresh agent wallet, `0 SUI`. "Zero gas, zero SUI."
2. (10–30s) Agent signs gasless $0.50 USDC, POSTs a built site as `X-PAYMENT` to `/deploy`.
3. (30–45s) Terminal prints a real `*.suize.site` URL. **WOW: open it — beautiful page loads, header `X-Suize-Integrity: verified`.**
4. (45–65s) On-chain Site object: `owner == the agent that paid`. Treasury up exactly $0.50.
5. (65–80s) Replay the payment → `409` (chain blocks the double-mint).
6. (80–90s) "One agent, one gasless payment, one verifiable on-chain site, no human." Label: testnet; mainnet = one-command republish.

### PAY wallet (Agentic Web) — record ONLY if blockers 1+2 green
1. (0–10s) wallet.suize.io, signed in, balance + sub-account visible.
2. (10–25s) Type: "Build me a playable clicker game and publish it."
3. (25–45s) Haiku authors the HTML game; confirm card: "Publish · 0.50 USDC · Paid from agent sub-account."
4. (45–55s) **WOW: one tap — AI pays $0.50 via gasless x402 FROM its own multisig sub-account, deploys to Walrus.**
5. (55–75s) Returns a live `*.suize.site` URL — open it.
6. (75–90s) Versatility flash: ask balance / show the verifiable trace with a real digest. **If key/OAuth not green: cut to read-only chat + send-USDC, frame deploy as roadmap. NEVER ?demo=1.**

### PolySui (DeepBook) — cold open, all real
1. (0–10s) Google sign-in. No wallet, no gas.
2. (10–25s) One tap UP on the live BTC 15-min round → real position.
3. (25–45s) Live ticking "Cash Out · $X.XX". **WOW: cash out at a profit (or hold to settle + auto-claim).**
4. (45–65s) Portfolio row → "SuiVision ↗" → the actual on-chain tx with the 3% rake leg.
5. (65–80s) Flash the "Be the House" PLP vault (real TVL/share price).
6. (80–90s) "Google sign-in to on-chain settle, gasless, one tap from the explorer."

### Suize rail / DeFi — deck-led proof
1. (0–15s) Deck Suize page. Click **"Fetch a live 402"** → real unedited x402 PaymentRequired streams from api.suize.io. "Not a slide."
2. (15–30s) **WOW: "Show a live split"** (/terms) — real 2% fee leg on $1.00, server-enforced.
3. (30–55s) Cut to the Deploy flagship clip.
4. (55–75s) `GET /tx?digest=…` → balance-change receipt with the treasury fee leg.
5. (75–90s) npm `@suize/pay@0.4.1` + published subs/auction ids. "Stripe for AI agents — gasless, x402-compatible by design, live facilitator for Sui." (Never "on x402"/"official.")

## 7. LAUNCH-NOW MARKETING (72h, reach-per-hour order)

Foundation co-marketing form is **dead for June 21** (≥2-week rule). Everything below is free, solo, no budget.

1. **Comment on x402 PR #340** + tag phdargen/bmwill/hayes-mysten/CarsonRoscoe. Single most strategic free move; `/supported` proves the only live x402 facilitator for Sui. [OWNER, 30 min, Day 1]
2. **Record the demo video.** Gates the thread, Show HN, the deck, every DM. [OWNER, Day 2]
3. **Stand up X + post the flagship thread:** hook → native <60s video → receipt link in first reply → 3 beats → tag @SuiNetwork @WalrusProtocol @SuiDeveloper. [OWNER, Day 3/Jun 21]
4. **Show HN:** *"Show HN: HTTP 402 middleware so AI agents can pay your API (2%, no chargebacks)."* **Sun 7pm ET / Mon 00:00 UTC.** [OWNER, Jun 20–21]
5. **r/mcp build-log:** "I made my MCP server charge agents — receipts on-chain." [OWNER, Day 3]
6. **forums.sui.io technical write-up + Sui Discord Overflow channels.** [OWNER, Day 3]
7. **(if time) AP2 issue #118 design comment** — caveat: AP2 mandates are W3C VCs (ECDSA P-256), NOT zkLogin JWTs — proof-of-capability, not drop-in. [OWNER, Jun 21]

**SKIP:** Foundation form (window closed), UGC swarm, Galxe, Product Hunt, podcasts, the full mascot/Remotion pipeline.

## 8. CUT ORDER

1. The 4th individual video polish — reuse the deck live-402 walkthrough as the DeFi video.
2. Marketing items 5–7. Nice-to-have reach.
3. Agents-directory data seeding — fall back to `?stub=1` labeled.
4. PAY wallet `deploy_site` killer moment — fall back to read-only chat + send-USDC.
5. PolySui video — weakest-fit track; screenshots + deck page can carry it.
6. Demo merchant #2 — lean entirely on Deploy.
7. The pre-warmed beautiful demo site — use an existing served site.
8. The 4 polished 1:1 logos — clean text-on-color square is the floor.

**NEVER CUT:**
- The **Deploy/DeFi flagship flow on screen** (agent → gasless $0.50 → live Walrus site → owner==payer → visible fee receipt). Sells three of four tracks.
- **Calibrated honesty.** Fix the landing blockers, delete the Math.random tape, never `?demo=1`, never "live on mainnet," obey the claim ladder.
- **Submitting all 4 before the deadline** with a public repo, a ≤5-min video, and the package ids.
