<div align="center">

# Suize

### Stripe for AI agents — on Sui.

**Charge payments or subscriptions to any AI agent. One line of code, live in minutes, settled on-chain.**

[![License: MIT](https://img.shields.io/badge/License-MIT-111.svg)](./LICENSE)
[![Built on Sui](https://img.shields.io/badge/Built%20on-Sui-6fbcf0.svg)](https://sui.io)
[![Payments: x402 V2 exact](https://img.shields.io/badge/payments-x402%20V2%20%E2%80%9Cexact%E2%80%9D-7c3aed.svg)](https://github.com/x402-foundation/x402/pull/2616)
[![tests](https://img.shields.io/badge/tests-192%20passing-3fb950.svg)](#proof--verify-everything)
[![npm @suize/pay](https://img.shields.io/npm/v/@suize/pay?label=%40suize%2Fpay&color=cb3837)](https://www.npmjs.com/package/@suize/pay)
[![npm @suize/mcp](https://img.shields.io/npm/v/@suize/mcp?label=%40suize%2Fmcp&color=cb3837)](https://www.npmjs.com/package/@suize/mcp)

[Live demo deck](https://suize-deck.vercel.app) · [Wallet](https://wallet.suize.io) · [Deploy](https://deploy.suize.io) · [Directory](https://agents.suize.io) · [Facilitator](https://api.suize.io/supported)

</div>

---

Suize is two halves of one thing — **the payment rail for the agentic economy on Sui:**

- **CHARGE — the open rail.** Any AI agent that can hold USDC on Sui can pay any merchant — one-off or subscription — **gasless, in one atomic on-chain transaction, no KYB, no chargebacks, no signup.** The merchant adds one middleware. We take **2% (with a $0.01 minimum), merchant-absorbed**, carved as a second declared output in the *same* transaction — so the on-chain balance change **is** the receipt.
- **PAY — the consumer AI wallet.** A conversational wallet the human talks to. It acts and pays across services from a **capped sub-account it can never overspend**, leaves a **verifiable, encrypted, user-owned log** of everything it did, and is **fully non-custodial — keys never leave your machine.**

The rail is **vanilla [x402](https://github.com/x402-foundation/x402) V2 "exact"** over Sui's protocol-level **gasless** Address-Balance transfers — no custom payment contract, no gas token, ever. The payer needs nothing Suize-specific.

> Built for **[Sui Overflow 2026](https://sui.io/overflow)**. Everything below is **testnet-proven, mainnet-ready** — every link is live, every on-chain id resolves, every claim is checkable.

## See it live

| Surface | What it is | Link |
|---|---|---|
| **Facilitator** | the live x402 service for Sui — `/verify` `/settle` `/supported` `/build` `/terms` `/tx`, keyless & stateless | [api.suize.io/supported](https://api.suize.io/supported) |
| **PAY wallet** | the consumer AI wallet — sign in with Google, a capped agent sub-account, encrypted on-chain history | [wallet.suize.io](https://wallet.suize.io) |
| **Deploy** | "Vercel for Sui" — an agent POSTs a site, pays $0.50 over the rail, it goes live on Walrus | [deploy.suize.io](https://deploy.suize.io) |
| **Directory** | a merchant-agnostic directory of agent commerce — a feed read live from chain + an on-chain ad-slot auction | [agents.suize.io](https://agents.suize.io) |
| **PolySui** | BTC up/down prediction market on DeepBook Predict — gasless, one tap | [polysui.suize.io](https://polysui.suize.io) |
| **A real deployed site** | served from Walrus through Deploy, each byte verified against an on-chain hash | [live site ↗](https://5nqcy919skmvrysyy152vtx3dk5x5w6rip30rc7m5qos7t96kc.suize.site) |
| **The pitch** | the interactive walk-through deck | [suize-deck.vercel.app](https://suize-deck.vercel.app) |

## Four products, four Overflow tracks

Each product is a real, working consumer of the *one* rail — built as proof, not slides.

| Track | Product | What it proves |
|---|---|---|
| **DeFi & Payments** | **Suize** (the rail) — facilitator · `@suize/pay` · `@suize/mcp` · subscriptions · ad auction | Agents pay merchants gasless in one atomic tx; the fee is enforced at settlement and visible in the on-chain receipt. |
| **Agentic Web** | **PAY** — the consumer AI wallet ([`apps/wallet`](./apps/wallet)) | An AI that pays from a sub-account it can't overspend, with a verifiable encrypted action log. |
| **Walrus** | **Deploy** — agent-native hosting ([`apps/deploy`](./apps/deploy)) | An agent ships a site to Walrus and pays for it over the rail; every served byte is hash-verified. |
| **DeepBook** | **PolySui** — BTC up/down ([`apps/crash`](./apps/crash)) | Gasless prediction-market trading on DeepBook Predict with an on-chain rake. |

## How the rail works

A merchant gates a route. An agent hits it, gets a `402` with the exact terms, signs a gasless transfer with its **own** key, and the facilitator verifies + settles. No SDK on the payer side, no account, no database — **the chain is the ledger.**

**Merchant side — the entire integration:**

```ts
import { suize } from "@suize/pay";

// One line. Any agent that can pay USDC on Sui can now pay you.
const paywall = suize({ to: "0x<your Sui address>", price: "0.10" });

Bun.serve({ fetch: paywall.wrap(handler) }); // Bun / Hono / Next route handlers
// app.use(paywall.express);                 // …or Express / Connect
```

**The 402 challenge** the merchant mints — the whole contract in one response:

```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "sui:testnet",
    "amount": "1000000",
    "asset": "0x…::usdc::USDC",
    "payTo": "0xMERCHANT…",
    "extra": { "buildUrl": "https://api.suize.io/build" }
  }],
  "extensions": { "payment-identifier": { "info": { "id": "pay_…" } } }
}
```

The agent reproduces the declared outputs — one `0x2::balance::send_funds` per output, `gasBudget = 0` (protocol-level gasless), the **2% fee leg to the treasury** included — and signs locally. `/verify` simulates and rejects anything that doesn't pay *exactly* right; `/settle` broadcasts the agent's own signed tx, idempotent by digest. **Suize never holds a key and never stores a payment.**

## Proof — verify everything

Nothing here is a mockup. Open the links.

- **On-chain (Sui testnet)** — every Move module is published and live:
  - subscriptions `subs::subscription` → [`0x759105…`](https://testnet.suivision.xyz/package/0x759105b5f7382cb22533e8a5282e90c92c558edb1bc2eaa0904247914082d821)
  - ad auction `auction::auction` → [`0xa7151d…`](https://testnet.suivision.xyz/package/0xa7151d699c93e48e5f502759d4de704ba4b8f22111b3d0b5a60c265ff2d37869)
  - deploy `deploy_sui` → [`0x5cbf0c…`](https://testnet.suivision.xyz/package/0x5cbf0ce0a2f56128ef0d7679aab8f3a8ba690533163dc2524754fd40f27faf0b)
  - prediction-market router `crash_sui::router` → [`0x16eb26…`](https://testnet.suivision.xyz/package/0x16eb262d69300c4291beab7e9f27b2b94640124a290f373230c5c8a3d3d50c26)
  - encrypted action-log anchor `trace::trace` → [`0xc7c95e…`](https://testnet.suivision.xyz/package/0xc7c95e514776cee94d65b5997247d88ff2493bd5b83971b176cd1a072cbd8c07)
  - business profile `profile::profile` → [`0x21be5a…`](https://testnet.suivision.xyz/package/0x21be5a6957d8e944eebb93d594057859fd793474ed6778479145b73b0b156c5d)
- **On npm** — [`@suize/pay`](https://www.npmjs.com/package/@suize/pay) (`npm i @suize/pay`) and [`@suize/mcp`](https://www.npmjs.com/package/@suize/mcp) (`npx @suize/mcp`) are published and installable.
- **Upstream** — we authored the Sui "exact" scheme and opened the PRs on `x402-foundation/x402`: [#2615 (spec)](https://github.com/x402-foundation/x402/pull/2615) + [#2616 (`@x402/sui` mechanism)](https://github.com/x402-foundation/x402/pull/2616).
- **Tests** — **192 passing** (119 TypeScript · 73 Move). The facilitator's fee enforcement, the wallet's spend-safety kernel, and every Move module's abort matrix are covered.

## Repository layout

A [Bun](https://bun.sh) workspace monorepo — `apps/* packages/* services/*`.

```
apps/
  wallet/        @suize/wallet        the PAY consumer AI wallet (React 19 + Vite)
  deploy/        @suize/deploy        Deploy merchant — agent-native Walrus hosting
  crash/         @suize/crash         PolySui — BTC up/down on DeepBook Predict
  agents/        @suize/agents-app    agents.suize.io — agent-commerce feed + ad auction
  landing/       @suize/landing       the consumer home + /for-business
  deck/          @suize/deck          the interactive pitch deck

packages/
  x402/          @suize/x402          the x402 V2 "exact" Sui scheme — wire types + build/verify
  pay/           @suize/pay           the ~60-line merchant middleware (published on npm)
  mcp/           @suize/mcp           the agent/dev payment wallet — 6 tools (published on npm)
  shared/        @suize/shared        network · package ids · wire types — single source of truth
  move-subs/     @suize/move-subs     subs::subscription — soulbound Party-object subscriptions
  move-deploy/   @suize/move-deploy   deploy_sui — immutable on-chain Site + domain registry
  move-crash/    @suize/move-crash    crash_sui::router — the DeepBook Predict rake gateway
  move-auction/  @suize/move-auction  auction::auction — on-chain ad-slot auction
  move-trace/    @suize/move-trace    trace::{anchor, seal_approve} — encrypted action-log anchor
  move-profile/  @suize/move-profile  profile::profile — on-chain business profiles

services/
  backend/       @suize/backend       one Bun service: x402 facilitator · MCP · deploy · sponsor · directory
  deploy-worker/ @suize/deploy-worker  Cloudflare Worker serving Walrus sites, double-hash verified
```

> The architecture, the rail standard, and every locked decision live in [`CLAUDE.md`](./CLAUDE.md). Each piece has its own `SPEC.md`.

## Run it locally

```bash
bun install                       # one install at the root
bun run dev                       # all apps + the backend (fans out via --filter)
bun run --filter '@suize/wallet' dev   # …or just one
bun test                          # the TypeScript suites
```

Move packages build and test with the [Sui CLI](https://docs.sui.io/references/cli):

```bash
cd packages/move-subs && sui move test
```

## Status

**Testnet-proven, mainnet-ready.** The rail needs *zero* new on-chain publishes to go to mainnet — Sui's gasless transfers, native USDC, and the treasury all exist there today. Crash/PolySui stays on testnet (DeepBook Predict is testnet-only).

## License

[MIT](./LICENSE) © 2026 Suize.
