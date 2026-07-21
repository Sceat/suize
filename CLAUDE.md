# Suize (CLAUDE.md)

> Loaded every session. This file owns the global picture, the payment-rail facts, and the locked decisions. Per-piece detail lives in each piece's README: reference, never redeclare, state each fact once. Every claim here is true today; a thing is described as it works or it is absent.

**Suize is the publish button for the agentic web.** An agent (via `@suize/mcp` or raw x402) or a human (the suize.io dashboard, wallet-connect) pays one gasless x402 USDC payment on Sui and a static site goes live on Walrus, content-addressed and integrity-verified at serve time. Hosting is $0.25 per month, prepaid up to what Walrus can fund in one store (about two years per payment on mainnet); sealed (Seal-encrypted private) sites pay 2x; extend anytime at the same rate; custom domains are $19.99/year. Fully non-custodial: whoever pays owns the site (on-chain `Site.owner`); the MCP signs through the user's own Sui CLI by default. No account, no API key, no signup.

## Repo map

Bun workspace monorepo: `apps/* packages/* services/*`.

| Path                     | Package                | What it is                                                                                                                                                                            |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/suize`             | `@suize/suize`         | The product frontend (suize.io): landing + live gallery, `#/sites` dashboard, sealed-site viewer. React 19 + Vite.                                                                    |
| `services/deploy-worker` | `@suize/deploy-worker` | CF Worker, both faces: serves `*.suize.site` from Walrus with serve-time integrity, and the paid publish API on api.suize.site (`/deploy` `/extend` `/domains` `/preview` `/health`). |
| `services/facilitator`   | `@suize/facilitator`   | CF Worker: the open-source x402 facilitator for Sui (`/supported` `/verify` `/settle` `/build` `/health`). Keyless, stateless. Live at facilitator.suize.io.                          |
| `packages/shared`        | `@suize/shared`        | THE source of truth: network resolution, on-chain ids, prices, Walrus/Seal constants, wire types. Pure, no runtime deps.                                                              |
| `packages/x402`          | `@suize/x402`          | The x402 V2 `exact` Sui scheme: wire types, the gasless tx builder, the fee-split math, the verify enforcement.                                                                       |
| `packages/pay`           | `@suize/pay`           | DEPRECATED (owner 2026-07-19): merchant middleware, unlisted from every public surface; kept in-tree for history.                                                                     |
| `packages/mcp`           | `@suize/mcp`           | The local stdio MCP deploy client (`deploy_site` and friends). Signs via the user's Sui CLI, key file, or env key.                                                                   |
| `packages/move-deploy`   | `deploy_sui`           | The on-chain Move package: `site` (Site object, digest registry), `domain_registry`, `allowlist` (Seal access control), `version`.                                                    |

## The payment rail

- **x402 V2 `exact`, protocol-gasless.** No custom payment Move code: the payer signs a `0x2::balance::send_funds` PTB drawing from its USDC Address Balance, with `gasPayment: []` and the deterministic budget-0 election (`setGasBudget(0n)` forces the SDK's gasless branch; empirics in `packages/x402/src/build.ts`). No SUI needed, only USDC.
- **The facilitator recomputes and enforces the fee split at verify.** It simulates the signed tx (never broadcasts at verify), recomputes the canonical split from its own operator policy (`FEE_BPS`, `FEE_FLOOR`, `FEE_TREASURY`, optional `MERCHANT_RATES`, all env vars), and rejects any mismatched credit, undeclared recipient, or wrong payer debit. Declared outputs are never trusted. Settle broadcasts the payer-signed bytes keyless: the facilitator holds no key, the chain is the database.
- **Idempotency is an on-chain digest registry; replays recover.** The tx digest is the payment identity: `/settle` dedups by digest, and `create_site` / `extend_site` consume the settled digest in the shared `SiteDigestRegistry` (abort `EDigestUsed` on reuse). A retried `X-PAYMENT` after a mid-flight death re-drives the idempotent effect (the `alreadySettled` path) so paid funds always produce the paid work; it can never double-charge or double-mint.
- **Prices and caps live ONLY in `@suize/shared`:** `DEPLOY_PRICE_PER_MONTH_USDC = 250000` ($0.25), `DEPLOY_SEALED_MULTIPLIER = 2`, `DOMAIN_PRICE_PER_YEAR_USDC = 19990000` ($19.99). The prepay ceiling is DERIVED per network by `maxDeployMonths(net)` from `WALRUS_MAX_EPOCHS_AHEAD = 53` (Walrus funds storage in one shot at deploy/extend, no cron): about 24 months on mainnet, 1 on testnet. Quote and enforcement use the same helpers; a drifted copy is a billing bug.

## Locked decisions (do not relitigate)

1. **Non-custodial by construction; whoever pays, owns.** The payer signs locally (own key, key file, or the Sui CLI); no service ever holds a payer key or signs owner txs. The recovered payer becomes `Site.owner`: the payment IS the authentication, there is no second auth primitive for publishing.
2. **Network selection is ENV-ONLY.** `SUI_NETWORK` (workers), `VITE_SUI_NETWORK` (apps); only the exact string `mainnet` opts in, everything else is testnet (fail-safe). On-chain ids, endpoints, and constants live ONLY in `@suize/shared`; nothing else hardcodes an id, target, or network.
3. **Suize's own instances are LIVE ON MAINNET (2026-07-15 full cutover).** `facilitator.suize.io` and `api.suize.site` both run `SUI_NETWORK=mainnet`. `deploy_sui` is published on mainnet at `0xec2dcd65271127019351678ddd05287176a0b9b7fc59ef6ceef34fdbc36e87db`; `treasury@suize` resolves to `0x9036f4be5ca0d0c2b890f12b398c032a00952aa41c2776507db0d018002373a7` (also the Deploy merchant address, so Deploy's own 402 quotes collapse to a single output). Mainnet USDC is Circle's native `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC`. A fresh self-hosted clone still DEFAULTS to testnet (`wrangler deploy --env mainnet` opts in, never a code change); testnet stays available for dev via an explicit env override.
4. **Git follows the global git law (owner 2026-07-17):** commit and push verified work autonomously, granular and atomic. Pushing code is never deploying: mainnet/prod actions stay owner-gated.
5. **The lead session never edits code directly** (owner law 2026-07-12): every code change goes through a briefed subagent; the lead briefs, reviews, and verifies.

## Conventions

- **Bun workspaces, one toolchain.** `bun install` at root; per-package `bun run dev|build|test|typecheck`. No pnpm, no turbo.
- **ESM everywhere** (`"type": "module"`). Apps are React 19 + Vite; both services run on Cloudflare Workers (wrangler).
- **Move edition 2024.** Abort codes are a public contract, scoped per module, never renumbered. Cap possession IS the auth for admin fns.
- **Secrets are env-only, never committed, never in a frontend bundle.** Worker secrets via `wrangler secret put` (the deploy worker's only secret is `DEPLOY_WALLET_KEY`, plus optional `CF_API_TOKEN`); local dev via gitignored `.dev.vars` / `.env.local`. The facilitator holds no secrets at all.

## Copy laws (every public surface, docs included)

- **No em-dashes anywhere.** Commas, colons, periods.
- **Claim ladder (binding).** ALLOWED: "gasless", "x402-compatible by design", "open-source x402 facilitator for Sui", "spec + mechanism PRs opened upstream (#2615 #2616)". FORBIDDEN until the mechanism PR merges: "on x402", "official facilitator", "listed by x402", "merged upstream" as fact.
- **Zero status-talk.** No "coming soon", "roadmap", "not yet", "pending" on any public surface: a feature is described as it works today or it is absent.
- No invented numbers: every price, cap, or on-chain id quoted in copy comes from `@suize/shared`.

## Mainnet wallet operations

- Operational wallet management (keys, funding, WAL duties) lives in the private ops runbook outside the public tree.


## Pointers

- Per-piece READMEs: `services/facilitator/README.md`, `services/deploy-worker/README.md`, `apps/suize/README.md`, `packages/{mcp,x402}/README.md`. Root `README.md` is the public front door.
- `BACKLOG.md`: the ticket ledger. `DECISIONS.md`: the decision log. Fold stray facts into the owning README, never a new doc file.
