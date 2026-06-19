# Demo Video Scripts — Sui Overflow 2026

> Four videos, one per track. The through-line: **never just claim — show it on-chain.**
> Every script ends on a verifiable artifact (an explorer tx, an integrity reject, a fresh-device restore). That is what separates a real build from a slide deck. Speak plainly; let the proof do the bragging.

## The universal "real deal" moves (use at least one per video)

1. **Open the actual transaction on SuiVision/Suiscan** — the on-chain truth, not a screenshot.
2. **Show the balance-change legs** — money moving where you said it would, atomically.
3. **Make something REJECT** — tamper a byte → 502; over-cap spend → refused. Proof lands when it refuses, not when it succeeds.
4. **Wipe and restore** — close the tab / fresh browser → state rebuilds from chain. Nothing faked in localStorage.
5. **Say what's NOT done** — one honest line ("testnet-proven, mainnet-ready") buys you more trust than ten polished claims.

## Pre-baked answers (have these ready — judges WILL ask)

- **"Can the AI drain my main wallet?"** → "No. The agent's spend planner has no access to the main balance — it's structurally incapable of authorizing it. Over-cap returns an error, never a fallback. We have 18 tests on exactly that."
- **"Is this live on mainnet?"** → "Testnet-proven, mainnet-ready. The rail needs zero new on-chain publishes to flip — Sui's gasless transfers, native USDC, and the treasury all exist on mainnet today. I can show you the testnet proof right now."
- **"Are you actually on the x402 standard?"** → "We wrote the Sui implementation and the PRs are open upstream on the x402 foundation repo — #2615 and #2616. We run the live facilitator. Once they merge, we're the default Sui lane."
- **"What stops you minting infinite free deploys?"** → "The single service cap that signs every paid deploy lives in our custody; post-MVP it moves to a multisig / cold key."

---

## 1 · PAY — the AI wallet  → Agentic Web track  (the flagship, ~90s)

**HOOK:** *"This is an AI agent with a wallet it cannot overspend. Watch it pay for and publish a real website — then prove, on-chain, everything it did."*

| On screen | Say |
|---|---|
| Sign in with Google | "I sign in with Google. No seed phrase, no extension. My keys never leave this browser — fully non-custodial." |
| Fund the agent sub-account with a few $ | "I give my AI agent a sub-account and fund it. **This balance IS its spending limit** — it physically cannot touch my main wallet. The leash is on-chain, not a promise." |
| Chat: *"build me a little clicker game and put it on the web"* | "I just talk to it. It writes the page — and to publish it, it has to **pay**, over our own payment rail." |
| Confirm card shows **$0.50**, "paid from agent sub-account" | "Notice — I never typed that price. The AI *proposes*; the wallet, not the model, sets the number. That's the safety wall." |
| Publish → live `*.suize.site` URL → open it, play it | "And there it is — a live website my AI paid for and shipped to decentralized storage, gaslessly, in one flow." |
| **PROOF** — click the `anchored ↗` badge → explorer tx | "Here's what nobody else has: every message and action is **encrypted, anchored on-chain, and decryptable only by me** — a verifiable, user-owned receipt of what my agent did." |
| Open in a fresh browser profile → history restores | "Fresh device, sign in — it all comes back. Coinbase's and Tempo's agent wallets can't show you this." |
| One tap "Bring it back" → sweep | "And if I want out — one tap, the money comes home. The kill switch is **physics**." |

**CLOSE:** *"An AI that acts, pays, and proves it — non-custodial, capped, verifiable. That's the agentic web, on Sui."*

⚠️ **Film prerequisites:** `ANTHROPIC_API_KEY` live + the 2nd Google OAuth client armed, or the chat/agent-arm won't work. **Rehearse the deploy twice** — Walrus testnet latency is the #1 on-camera risk; pre-fund the sub-account and have a known-good prompt. Fallback if the deploy stalls: cut to a pre-recorded successful run.

---

## 2 · Deploy — agent-native Walrus hosting  → Walrus track  (~75s)

**HOOK:** *"An AI agent can deploy a website to Walrus, and pay for it, with zero human in the loop — and every byte you're served is verified against the chain."*

| On screen | Say |
|---|---|
| Agent POSTs a built site to `api.suize.io/deploy` | "My agent POSTs a built site to our deploy endpoint. It gets back a **402 — payment required**. The x402 standard." |
| Agent pays $0.50 over the rail, retries with the receipt | "It pays half a dollar over our rail, gaslessly, and retries. No dashboard, no signup, no card — this is built for **machines**." |
| Returns `siteId` + URL → open the live site | "Seconds later — a live site on Walrus, at its own subdomain." |
| **PROOF** — `curl -D` the URL, show `x-suize-integrity: verified` | "Here's why you can trust it: our edge worker re-hashes **every file and the manifest** against what's recorded on-chain." |
| Tamper a blob in storage → reload → **502** | "Watch — I corrupt one byte in storage, and you don't get the bytes, you get a **502**. Most 'decentralized hosting' just trusts the gateway. We verify, every request." |
| Show the on-chain `Site` object | "The site is an immutable shared object on Sui. The hash is the contract." |

**CLOSE:** *"Agent-native, gasless, and cryptographically honest about what it serves — we dogfood it; our own landing page ships through this exact pipeline. That's Walrus, done right."*

⚠️ **Do NOT demo:** storage auto-renewal (never exercised live) or custom domains (needs a human DNS step). Stick to the deploy → live URL → integrity-reject arc.

---

## 3 · PolySui — BTC up/down on DeepBook  → DeepBook track  (~75s)

**HOOK:** *"A prediction market on DeepBook where you bet on Bitcoin up or down — no gas, no seed phrase, and the house edge is enforced on-chain."*

| On screen | Say |
|---|---|
| Sign in with Google → live BTC chart | "Sign in with Google. You're trading in five seconds — gasless, sponsored writes." |
| Place a $1 UP bet, one tap | "I bet a dollar that BTC rises in the next 15 minutes. One tap — a real position on **DeepBook Predict**, Sui's prediction protocol." |
| **PROOF** — open the tx on SuiVision: `router::bet` + the rake leg | "Here's the real deal — the on-chain transaction. Our router takes a **3% rake, carved out right here, on-chain, non-bypassable**. The economics are auditable by anyone." |
| Cash out early → portfolio rebuilds from chain | "I can cash out before expiry. My whole portfolio is reconstructed from the chain — wipe the cache, it's still all there. Nothing faked locally." |
| Be-the-House vault | "And the other side? Anyone can **be the house** — supply the vault, earn the edge. On-chain LP economics." |

**CLOSE:** *"Real DeepBook integration, real gasless UX, real on-chain economics — not a paper trade."*

⚠️ **Honesty guardrails:** do **NOT** claim agent betting (not built) and do **NOT** say bets "settle over x402" (they're Enoki-sponsored router calls — x402 isn't in this path). Frame it as a polished consumer product + a proven router/rake/sponsor stack on DeepBook. The Crash→Suize 2% leg is designed, not wired — don't mention it as live.

---

## 4 · Suize — the CHARGE rail  → DeFi & Payments track  (the thesis, ~90s)

**HOOK:** *"Stripe for AI agents. Any agent that can hold a stablecoin on Sui can pay any merchant — and the merchant adds one line of code."*

| On screen | Say |
|---|---|
| The merchant snippet: `suize({ to, price })` + `paywall.wrap(handler)` | "This is the **entire** merchant integration. One middleware. No wallet code, no chain code. Live in minutes." |
| Agent hits the route → the 402 challenge JSON | "An agent hits a paid route, gets a 402 with the exact terms. This is vanilla **x402** — the emerging standard. We wrote the Sui implementation; our PRs are open upstream right now." |
| Agent signs a gasless transfer, facilitator settles | "The agent signs with its **own** key. Our facilitator verifies and settles — keyless, stateless. We never hold a key, never touch funds, never store a payment. The chain is the database." |
| **PROOF** — open the settle tx → show the **two balance-change legs** | "Here's the moat. The merchant gets paid, **and** our 2% fee lands at the treasury — atomically, same transaction. **The receipt IS the enforcement.** A merchant can't route around the fee — the facilitator recomputes it and rejects anything else." |
| Subscriptions: a soulbound object; cancel = delete | "Subscriptions too — a recurring charge is an on-chain object you **delete** to cancel. Push, not pull. Nothing reaches into your funds." |

**CLOSE:** *"Gasless is table stakes, standards are commodity. What we own is **on-chain enforcement** — the fee in the receipt, the cap as physics, the subscription as an object you control. That's the rail the agent economy runs on. On Sui."*

⚠️ **Claim ladder:** say "live facilitator for Sui," "open PRs upstream (#2615/#2616)," "implements the x402 exact scheme." Do **NOT** say "on x402," "official," or "the default Sui facilitator" as fact. For the receipt, use the settle tx on SuiVision or `GET /tx?digest` — **don't rely on the agents.suize.io live feed** unless the directory 502 is fixed first.

---

### Recording order recommendation
Film **#4 (the rail)** and **#1 (PAY)** first and best — they're the thesis and the flagship, the two you're most likely to win. #2 (Deploy) is your strongest *code* story and the safest to film. #3 (PolySui) is the placement play — keep it tight and honest, don't oversell the track fit.
