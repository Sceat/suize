# Suize

A Sui product suite, shipped as one **Bun-workspace monorepo** for Sui Overflow 2026. Two products, one backend, one shared-constants package, one network (**testnet**):

- **the agentic wallet** — dedicate a risk-capital *sandbox* to an AI agent leashed by an on-chain Move **mandate** it physically cannot escape.
- **Crash** *(migration pending)* — a betting game wrapping DeepBook Predict with a 3% on-chain rake, gasless via the shared sponsor.

---

## Workspace layout

```
apps/
  wallet/         @suize/wallet      React 19 + Vite — the Zen wallet UI            → suize.io
  landing/        @suize/landing     Vite marketing + waitlist                     → marketing
  (crash/         PLANNED — migrate from ~/dev/sui/crashsui)                        → crash.suize.io
packages/
  shared/         @suize/shared      network + package ids + sponsor wire types — single source of truth
  move-wallet/    @suize/move-wallet mandate · vault · swap · navi  (Move, 65/65 tests)
  (move-crash/    PLANNED — Crash Move contracts)
services/
  backend/        @suize/backend     ONE Bun service: sponsor + waitlist(api) + agent(stub)
```

| Path | What |
|---|---|
| [`apps/wallet`](apps/wallet/) | The agentic wallet frontend — two-balance home + the decision LOG, 5-step onboarding. First visual cut (mock data, stubbed auth). See its [README](apps/wallet/README.md). |
| [`apps/landing`](apps/landing/) | Marketing + waitlist page (React 19 · Vite 7 · Tailwind v4 · OGL shader). Posts to the backend `/waitlist`. |
| [`packages/shared`](packages/shared/) | Pure types + constants — `NETWORK`, on-chain `PACKAGE_IDS`, sponsor wire types. **Imported by every app + service.** |
| [`packages/move-wallet`](packages/move-wallet/) | The Move package (`edition = "2024"`): `mandate` · `vault` · `swap` · `navi`. **65/65 tests.** |
| [`services/backend`](services/backend/) | The unified Bun backend (sponsor + waitlist + agent-stub). Deploy: [`DEPLOY.md`](services/backend/DEPLOY.md). |
| [`docs/`](docs/) | [Wallet spec/architecture/security](docs/wallet/) · the [mainnet checklist](docs/MAINNET_CHECKLIST.md) · merge history. |
| [`CLAUDE.md`](CLAUDE.md) | The repo-wide overview + locked decisions. Start here. |

---

## Develop

The whole repo is one [Bun](https://bun.sh) workspace — install once at the root, run per-package with `--filter`.

```bash
bun install            # install all workspaces from the root

bun run dev            # run every package's dev script (fan-out via --filter '*')
bun run build          # build every package

# or target one workspace:
bun run --filter '@suize/wallet'  dev    # the wallet UI    → http://localhost:5180
bun run --filter '@suize/landing' dev    # the landing page → http://localhost:5173
bun run --filter '@suize/backend' dev    # the backend      → http://localhost:8080
```

**Move contracts** (`packages/move-wallet`) use the Sui CLI:

```bash
cd packages/move-wallet
sui move build
sui move test          # 65/65
```

**Network is testnet, in one place** — `NETWORK` in [`packages/shared/src/index.ts`](packages/shared/src/index.ts). Apps and services import it; nothing hardcodes a network or package id elsewhere. The testnet→mainnet flip is gated by [`docs/MAINNET_CHECKLIST.md`](docs/MAINNET_CHECKLIST.md).

---

## The two products

**The wallet.** You dedicate a *sandbox* of risk capital to an AI agent that operates it 24/7, bounded by an on-chain Move **mandate** the VM enforces (budget + scope + expiry + instant revoke). Two balances — **MAIN** (savings, untouched) and the caged **SANDBOX**. A dual dial picks the mandate: **SAFE** (NAVI lend-as-is) or **DEGEN** (spot SUI↔USDC on signals, no leverage). The kill-move — jailbreak → the Move VM aborts on-chain → revoke — is the centerpiece. Full detail in [`docs/wallet/SPEC.md`](docs/wallet/SPEC.md).

**Crash** *(pending migration).* A betting game: DeepBook Predict wrapped by `crash_sui::router` with a 3% on-chain rake, gasless via the shared Enoki sponsor. Its router targets live in [`@suize/shared`](packages/shared/src/index.ts). Currently standalone at `~/dev/sui/crashsui`.

---

## Deploy

- **`apps/landing`** → Vercel (its `apps/landing/` is the project root, `vite build`, `dist/` output).
- **`apps/wallet`** → static host (Vercel), `suize.io`.
- **`services/backend`** → self-hosted k8s (Talos + Helmfile + SOPS + Cloudflare Tunnel), serving `sponsor.suize.io` + `api.suize.io`. Full runbook in [`services/backend/DEPLOY.md`](services/backend/DEPLOY.md).

---

*Built for Sui Overflow 2026.*
