# @suize/wallet

The Zen wallet UI — Home (the altar) + the lean onboarding flow. **First visual cut.**
Built with mock data; the contracts aren't deployed yet. The goal is something the
founder can look at and react to. (Product + UX spec: `docs/wallet/SPEC.md`; the repo-wide
overview: the root `CLAUDE.md`.)

## Run

This is a Bun workspace package — install once at the repo root, then run here:

```bash
bun install                                 # from the repo root (~/dev/sui/suize)
bun run --filter '@suize/wallet' dev        # http://localhost:5180
bun run --filter '@suize/wallet' build      # tsc -b && vite build
bun run --filter '@suize/wallet' typecheck
```

Deep-links for review:
- `/` — onboarding (default)
- `/?screen=home` — jump straight to Home (live feed ticks)
- `/?screen=home&static` — Home with the live ticker frozen (used for screenshots)

## Screenshots

```bash
node scripts/screenshots.mjs   # needs the dev server up; writes ./screenshots/*.png
```

Captured at a 420px phone viewport: Home, the kill-move row expanded, the Add-funds
and Pause sheets, and every onboarding step.

## Stack (pins match docs/ARCHITECTURE.md §6)

| | version |
|---|---|
| Vite | 8.0.16 |
| React | 19.2.6 |
| TypeScript | 5.9.3 (ESM, bundler resolution) |
| @mysten/dapp-kit | 1.0.6 |
| @mysten/sui | 2.17.0 |
| @mysten/enoki | 1.0.8 |
| @tanstack/react-query | 5.100.14 |
| tailwindcss | 4.3.0 (CSS-first, via @tailwindcss/vite) |

Network = **testnet** (the locked network for the whole monorepo — one `NETWORK` const in `@suize/shared`; no real funds behind unaudited code). The mainnet flip is a later, gated step (`docs/MAINNET_CHECKLIST.md`).

> Note: `@mysten/sui@2.x` moved the JSON-RPC client — `SuiClient`/`getFullnodeUrl`
> are now `SuiJsonRpcClient`/`getJsonRpcFullnodeUrl` from `@mysten/sui/jsonRpc`, and
> network config needs `{ url, network }`. dapp-kit 1.0.6 expects exactly this.

## Structure

```
src/
  app/
    providers.tsx     REAL dapp-kit + Enoki provider stack (testnet)
    App.tsx           top-level route: onboarding -> home (no router lib)
  data/               THE DATA LAYER (the chain seam)
    types.ts          shapes mirror the on-chain mandate/vault events
    mock.ts           ⚠️ all mock state — the only place fake data lives
    useHome.ts        the hook screens call; mock now, RPC/events later
    useAuth.ts        zkLogin seam — stubbed Google sign-in
    format.ts         pure formatters (usd, pct, clock, shortHash, …)
  components/         Droplet, icons, ui primitives, LogRow, UpgradeCard, sheets
  screens/
    Home.tsx          the altar: balances + status + THE LOG + two actions
    onboarding/       5 steps: Google -> name -> fund -> dial -> unleash
  styles/index.css    the design system (blue-on-carbon, gold = money)
```

## What's REAL vs MOCK vs NEEDS WIRING

**Real (production-shaped):**
- Provider stack: `SuiClientProvider` (testnet) + `WalletProvider` + React Query.
- `registerEnokiWallets` is called *if* `VITE_ENOKI_API_KEY` + `VITE_GOOGLE_CLIENT_ID`
  are set; otherwise skipped and auth falls back to the stub. Nothing makes a chain write.
- The whole UI, design system, component architecture, and the data-layer seam.

**Mock (isolated in `data/mock.ts`):**
- Balances, the LOG entries, identity handle, mandate params, deposit address,
  name-availability set. Every fake value lives here and nowhere else.

**Stubbed actions (clearly marked `STUB` in code):**
- `signInWithGoogle()` — fakes the OAuth round-trip, returns a mock owner address.
- `acceptProposal` / `declineProposal` / `togglePause` — local state only.
- Onboarding "Unleash it" — would build the mandate PTB; here it just routes to Home.
- Add-funds "I've sent it" / Copy address — no real deposit or balance poll.

**Deliberately NOT built yet (left as clean TODOs — later follow-ups):**
- The full onramp coming-soon UI (only a lean version exists — `AddFundsSheet`,
  `TODO(onramp)`). Real zkLogin/Enoki OAuth + SuiNS subname issuance. The real chain
  data layer (events + RPC). The two-TVL admin readout. The Droplet master PNG
  (`TODO(brand)` — using a clean inline-SVG stand-in for now).

## Wiring it to chain later (the clean path)

1. Deploy the package; `deploy.ts` writes IDs into `packages/shared`.
2. Replace `useHome.ts` internals with `useSuiClientQuery` event subscriptions
   (`mandate::AgentActed` / `vault::AgentDeployed` / `mandate::AgentCapRevoked`) +
   RPC balance reads. The `HomeApi` signature stays identical — no screen changes.
3. Replace `useAuth.ts` with the real Enoki Google connect (already registered in
   `providers.tsx`).
4. Replace the stubbed actions with `dryRun`-previewed, agent-signed PTBs.
