# Deploy — 2-minute demo script (Walrus track)

**Hero claim:** agent-native web hosting on Walrus — a machine deploys *and pays for* a site by itself, and every byte served is verified against the chain.
**Differentiators to land:** (1) agent-native / gasless / no human, (2) **integrity — we reject tampered bytes**, (3) dogfooded (our own landing ships through it).
**Runtime:** ~2:00. Narration ≈ 290 words; the rest is on-screen action.

---

### 0:00 – 0:13 · COLD OPEN (show the payoff first)
**[SCREEN:** a polished website loads live at a `…​.suize.site` URL. Let it breathe — scroll it once.**]**

> "This site is hosted on Walrus — Sui's decentralized storage. There's no server behind it. And no human deployed it: an AI agent built it, paid for it, and shipped it — by itself. I'll show you exactly how it works, and why you can trust every byte it serves."

### 0:13 – 0:30 · THE PROBLEM
**[SCREEN:** a generic hosting signup wall — "create account", a credit-card field.**]**

> "Two problems with hosting today. One — an AI agent can't use any of it: every platform wants a human, a login, a card. Two — even 'decentralized' hosting just hands you whatever the gateway serves; you're trusting it blindly. Deploy solves both."

### 0:30 – 0:42 · WHAT IT IS
**[SCREEN:** `deploy.suize.io` — the deploy view.**]**

> "Deploy is agent-native web hosting on Walrus. An agent hands us a built site, pays fifty cents over our payment rail, and it's live — gasless, no signup, no human in the loop. Think Vercel, but the customer is a machine and the storage is on-chain."

### 0:42 – 1:15 · THE DEMO (how it works, live)
**[SCREEN:** terminal — the agent POSTs a built site to `api.suize.io/deploy`. Response: **`402 Payment Required`** with the x402 JSON.**]**

> "Here's the agent. It POSTs a built site to our endpoint — and gets back a **402, Payment Required**. That's the x402 standard, the way the agent economy is learning to pay."

**[SCREEN:** the agent signs and retries with an `X-PAYMENT` header.**]**

> "It reads the price, signs a **gasless** payment with its own key — no gas token, ever — and retries. We settle that payment on-chain *first*. No payment, no deploy — there's no free tier to game."

**[SCREEN:** response streams — `uploading to Walrus → writing manifest → minting Site → { siteId, url }`. The URL opens; the site loads.**]**

> "Then the real work: we pack the files into a **Walrus** blob, write a manifest that lists the hash of every file, and mint the whole site as an **immutable, shared object on Sui** — with that manifest hash-locked on-chain. Seconds later, a live URL."

### 1:15 – 1:45 · THE PROOF (the differentiator — make it REJECT)
**[SCREEN:** terminal — `curl -I` the URL, highlight the **`x-suize-integrity: verified`** header.**]**

> "Now the part that matters. On every single request, our edge worker pulls the bytes back from Walrus and re-checks them against the chain — the manifest against its on-chain hash, then every file against the manifest."

**[SCREEN:** tamper a stored blob (or point at a deliberately-mismatched build) → reload the URL → **`502`**, not the page.**]**

> "So watch what happens if one byte is wrong. I tamper with the stored file… reload… and you don't get the page. You get a **502**. We'd rather serve you nothing than serve you something we can't prove. No gateway does this."

### 1:45 – 2:00 · CLOSE (dogfood + track fit)
**[SCREEN:** the on-chain `Site` object on SuiVision (highlight the `manifest_hash` field) → cut to `suize.io`.**]**

> "The site is an immutable object on Sui; the hash is the contract. And this isn't a toy — **our own landing page is deployed through this exact pipeline**. Agent-native, gasless, and cryptographically honest about every byte. That's Walrus, done right."

---

## How it works (one-glance, for your own confidence + Q&A)

```
agent ──POST built site──▶ api.suize.io/deploy
        ◀── 402 + x402 challenge ($0.50 → treasury)
agent ──signs gasless send_funds, retries w/ X-PAYMENT──▶
        backend: SETTLE on-chain FIRST  (no pay → no deploy)
              → tar → Walrus quilt + manifest (per-file sha256)
              → mint immutable shared Site on Sui (deploy_sui), manifest_hash on-chain
        ◀── { siteId, url, digest }
visitor ──GET <base36(siteId)>.suize.site──▶ Cloudflare deploy-worker
              → reads on-chain Site → pulls Walrus bytes
              → verify #1: manifest blob == on-chain manifest_hash
              → verify #2: each file == its sha256 in the manifest
              → match → 200 + `x-suize-integrity: verified` · mismatch → 502 (never the bytes)
```
- On-chain `deploy_sui` package: `0x5cbf0ce0…` (testnet).
- The "double-hash" verify is the moat: the chain anchors the manifest; the manifest anchors every file.

## Film prerequisites
- A testnet address holding ≥ $0.50 native USDC to pay the deploy charge.
- The agent/deploy path working end-to-end on the live stack — **rehearse once**; Walrus testnet upload can be slow (have a fallback take ready if it stalls).
- **The 502 reject needs a reproducible mismatch.** Easiest: deploy a site, then tamper/replace a stored blob and reload. If you can't tamper Walrus on camera, fall back to showing the worker's verify code + the `x-suize-integrity: verified` header on the good path, and *explain* the reject — but the live 502 is the money shot; try to get it.

## Honesty guardrails (do NOT cross)
- **Do NOT demo** storage auto-renewal (never exercised live) or custom domains (needs a human DNS step). The hero arc is deploy → live URL → integrity-reject. Stop there.
- Keep it network-agnostic ("on Walrus / on Sui"); **don't claim mainnet.** If asked: "testnet-proven, mainnet-ready — the deploy module is a republish away."
- It's true that our landing is deployed through this on testnet — say "our own landing ships through this pipeline," not "in production on mainnet."
- "x402 standard / we run the live facilitator" — fine. Don't say "official x402" or "the default Sui facilitator."
