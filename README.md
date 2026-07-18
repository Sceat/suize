<div align="center">

# Suize

### The publish button for the agentic web.

**An agent pays over HTTP 402, in USDC, gasless, and a site goes live on Walrus. No account, no API key, no signup. The chain is the receipt.**

[![License: MIT](https://img.shields.io/badge/License-MIT-111.svg)](./LICENSE)
[![Built on Sui](https://img.shields.io/badge/Built%20on-Sui-6fbcf0.svg)](https://sui.io)
[![x402 V2 "exact"](https://img.shields.io/badge/payments-x402%20V2%20%22exact%22-7c3aed.svg)](https://github.com/x402-foundation/x402/pull/2616)
[![npm @suize/mcp](https://img.shields.io/npm/v/@suize/mcp?label=%40suize%2Fmcp&color=cb3837)](https://www.npmjs.com/package/@suize/mcp)

</div>

---

Suize is one product and the open rail it runs on, both live on Sui mainnet today:

1. **Suize Deploy** ([`services/deploy-worker`](./services/deploy-worker)), the publish button for [Walrus](https://www.walrus.xyz): an agent (via [`@suize/mcp`](./packages/mcp) or raw x402) or a human (the [suize.io](https://suize.io) dashboard, wallet-connect) pays a flat rate in USDC over an x402-compatible rail and a static site goes live at `<id>.suize.site`, served with on-chain integrity verification. Whoever pays, owns the site: there's no account to create.
2. **An open-source x402 facilitator** ([`services/facilitator`](./services/facilitator)), a small, stateless Cloudflare Worker that verifies and settles x402 V2 `exact` payments on Sui. Fork it, point it at your own treasury, `wrangler deploy`, and you're running your own facilitator with your own fee.

Suize Deploy is itself just a merchant on the open facilitator, no special access, same rail anyone else can use.

## See it live

| Surface | What it is | Try it |
|---|---|---|
| **Facilitator** | the open x402 rail for Sui, `/health` `/supported` `/verify` `/settle` | [facilitator.suize.io/supported](https://facilitator.suize.io/supported) |
| **Deploy (charge API)** | pay to publish a site, `/deploy` `/extend` `/domains` `/preview` | [api.suize.site/health](https://api.suize.site/health) |
| **Site** | the Suize home and a live gallery of deployed sites | [suize.io](https://suize.io) |
| **`deploy_sui`** | the on-chain Move package behind every deploy | [suivision.xyz](https://suivision.xyz/package/0xec2dcd65271127019351678ddd05287176a0b9b7fc59ef6ceef34fdbc36e87db) |

## Quickstart: deploy a site

Price discovery needs no payment, no signup, just ask:

```bash
curl -X POST "https://api.suize.site/deploy?months=1"
```

```jsonc
// 402 Payment Required (abridged, this is a real, live response)
{
  "x402Version": 2,
  "resource": { "url": "https://api.suize.site/deploy?months=1" },
  "accepts": [{
    "scheme": "exact",
    "network": "sui:mainnet",
    "amount": "250000",
    "asset": "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    "payTo": "0x9036f4be5ca0d0c2b890f12b398c032a00952aa41c2776507db0d018002373a7",
    "maxTimeoutSeconds": 120,
    "extra": {
      "outputs": [
        { "to": "0x9036f4be5ca0d0c2b890f12b398c032a00952aa41c2776507db0d018002373a7", "amount": "250000" }
      ]
    }
  }]
}
```

That's a real quote: $0.25 for one month of hosting. Deploy is Suize's own first-party merchant on the rail, its payTo is the same address as the facilitator's fee treasury, so the outputs collapse to a single leg (a third-party merchant's quote splits into a merchant leg and a separate facilitator fee leg the same way, enforced identically at verify). An agent signs a gasless Sui transaction paying those exact outputs and retries the same request as `multipart/form-data` (`name`, `site.tar`) with the signature in `X-PAYMENT`. The easiest way to do that from a coding assistant:

```bash
claude mcp add suize -- npx -y @suize/mcp
```

By default the MCP signs through your own Sui CLI: create a dedicated key with `sui client new-address ed25519 suize`, fund it with a little mainnet USDC, then ask your assistant to deploy your `./dist` folder. The key never enters the MCP process, and the address that pays is the address that owns the site.

Building your own payer instead of using the MCP? [`@suize/x402`](./packages/x402) exports `buildGaslessOutputs` for exactly this, build the transaction from the declared `outputs`, sign it, retry with `X-PAYMENT`.

## Quickstart: run your own facilitator

```bash
git clone https://github.com/Sceat/suize && cd suize/services/facilitator
bun install
cp .dev.vars.example .dev.vars   # set FEE_TREASURY to your own address or SuiNS name
bun run dev                      # wrangler dev, then curl localhost:8787/supported
npx wrangler deploy               # ship it, the fee is yours to keep
```

Full endpoint contract, fee math, and configuration: [`services/facilitator/README.md`](./services/facilitator/README.md).

## Architecture

A [Bun](https://bun.sh) workspace monorepo, `apps/* packages/* services/*`. The pieces that make up the rail:

| Path | Package | What it is |
|---|---|---|
| [`apps/suize`](./apps/suize) | `@suize/suize` | The product frontend at [suize.io](https://suize.io): landing + live gallery, the `#/sites` dashboard, and the sealed-site viewer. Everything on it is chain-derived. |
| [`services/facilitator`](./services/facilitator) | `@suize/facilitator` | The open-source x402 `exact` facilitator for Sui. Keyless, stateless, four endpoints. Live at `facilitator.suize.io`. |
| [`services/deploy-worker`](./services/deploy-worker) | `@suize/deploy-worker` | Suize Deploy: charges for and serves Walrus-hosted sites, and pays its own facilitator instance like any other merchant. Live at `api.suize.site` and `*.suize.site`. |
| [`packages/shared`](./packages/shared) | `@suize/shared` | The single source of truth for network selection, on-chain ids, prices, and wire types. Nothing else hardcodes an id or a network. |
| [`packages/x402`](./packages/x402) | `@suize/x402` | The shared x402 V2 `exact` primitives for Sui: wire types, the gasless payment-transaction builder, the fee-split math, and the facilitator's verify logic. |
| [`packages/mcp`](./packages/mcp) | `@suize/mcp` | A local stdio MCP server, gives Claude Code / Cursor / Codex a `deploy_site` tool that pays with your own local Sui key. |
| [`packages/move-deploy`](./packages/move-deploy) | `deploy_sui` | The on-chain Move package: the `Site` object, the domain registry, and the Seal allowlist for private sites. |

## How the rail works

Suize is x402-compatible by design: it implements an **x402 V2 `exact`** scheme for Sui over Sui's protocol-level gasless Address-Balance transfers, no custom payment contract, no gas token, ever. A merchant mints a 402 with the exact terms (price, asset, and a declared fee split in `extra.outputs`); the payer signs a `send_funds` transaction crediting those outputs with its own key (`gasPayment: []`, `gasPrice: 0`) and retries with the signature. The facilitator simulates that transaction to prove it pays the declared split exactly, then broadcasts it, keyless, over gRPC. The on-chain balance-change set is the receipt: there is no payment database anywhere in this rail.

The fee is never something a merchant can quietly drop: the facilitator recomputes the split from its own operator policy at `/verify` and rejects anything that doesn't match, a merchant's declared outputs are never trusted at face value.

## Proof

Nothing here is a mockup.

- **On-chain (Sui mainnet).** `deploy_sui` is published and live: [`0xec2dcd65…`](https://suivision.xyz/package/0xec2dcd65271127019351678ddd05287176a0b9b7fc59ef6ceef34fdbc36e87db). Suize's own suize.io frontend was deployed onto Walrus through this exact rail, a real USDC settlement on mainnet.
- **On npm.** [`@suize/mcp`](https://www.npmjs.com/package/@suize/mcp) (`npx @suize/mcp`) is published and installable.
- **Upstream.** We authored the Sui `exact` scheme and opened the spec + mechanism PRs upstream on `x402-foundation/x402`: [#2615](https://github.com/x402-foundation/x402/pull/2615) (spec) and [#2616](https://github.com/x402-foundation/x402/pull/2616) (`@x402/sui` mechanism).
- **Tests.** 165 TypeScript tests passing across the facilitator, `@suize/x402`, `@suize/mcp`, and the deploy worker, plus 26 Move tests for `deploy_sui`. Zero failing.

## Run it locally

```bash
git clone https://github.com/Sceat/suize && cd suize
bun install                                     # one install at the root

bun run --filter '@suize/facilitator' dev       # the facilitator (wrangler dev)
bun run --filter '@suize/deploy-worker' dev     # the deploy worker (wrangler dev)
```

Tests, per package:

```bash
cd services/facilitator && bun test    # 28 passing
cd packages/x402 && bun test           # 39 passing
cd packages/mcp && bun test            # 19 passing
cd services/deploy-worker && bun test  # 79 passing
cd packages/move-deploy && sui move test  # 26 passing
```

## License

[MIT](./LICENSE) © 2026 Suize.
