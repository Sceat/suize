# `apps/agents` — the agent-commerce directory (SPEC)

> `agents.suize.io` — a public, **merchant-agnostic** directory of live AI-agent
> commerce on Suize: a live purchase feed, per-merchant volume rankings, an on-chain
> ad-slot auction, and a "visited today" counter. The "find" half of the rail — the
> seed of the Google-arc (directory → the index of agent commerce). Owns its own piece;
> the rail, the two primitives, the honesty + claim-ladder laws, and the network live in
> the root `CLAUDE.md` — this SPEC references, never redeclares. The on-chain auction is
> `packages/move-auction/SPEC.md`; the read/x402 endpoints are `services/backend/SPEC.md`
> (the directory route group).

**One job:** make the rail *visible* — show the world (and other agents) that agents are
paying merchants on Suize, let them discover who's payable, and sell ad placement on the
attention. CHARGE/dev-facing, so the technical x402 framing is allowed (not bound by the
consumer PAY vocabulary) — but money wears the house gradient and addresses show resolved
`@suize` handles, never raw hex.

## 0. Stack + where things live

- React 19 + Vite, Bun workspace (`@suize/agents-app`). **Scaffold mirrors `apps/pay`**
  exactly — `config.ts` (re-exports network/USDC from `@suize/shared`, resolves
  `API_BASE` from `VITE_SUIZE_API`: dev `localhost:8099` / prod `api.suize.io`),
  `auth.ts` (Enoki Google zkLogin + standard wallet `useAuth`), `suins.ts`, `ui.tsx`
  (`Shell` wordmark `Suize Agents`, `useReverseName`, `shortAddr`). Own `styles.css`
  (light glass; money = blue gradient, `@suize` handles = red/orange gradient; no
  mockups, no diode dots). Build gate: `bun run build` (tsc + vite) green.
- **No router** — one `routes/DirectoryPage.tsx` owns the polled queries (feed ~3s,
  slots ~4s) + the once-per-session visit POST; components `Hero` / `LiveFeed` /
  `Rankings` / `AdSlots`.
- `src/api.ts` is the thin client over the backend directory endpoints + the ONE write
  (`buildBidTx`). Amounts on the wire are **base-unit USDC strings** (`formatUsdc` from
  `@suize/x402`, re-exported).

## 1. The four surfaces

1. **Live feed** (`LiveFeed`) — `GET /feed`: every recent on-chain x402 payment, newest
   first, `payer → merchant` (resolved handles, hex fallback), gross in blue, the **real
   fee/feeBps** (read from chain, never assumed 2%), relative time → explorer link. The
   feed is **merchant-agnostic** (the backend enumerates it from the treasury fee-leg —
   `services/backend/SPEC.md`). Sparse on testnet until merchants pay; **never faked**.
2. **Rankings** (`Rankings`) — `GET /rankings`: per-merchant volume leaderboard.
3. **Ad slots** (`AdSlots`) — `GET /ads/slots`: each slot's current price + holder +
   creative, cheapest highlighted; a **Bid** dialog (sign in → amount `>` price + a
   creative → sign) that takes the slot. `packages/move-auction`.
4. **Visited today** — `GET /stats` + `POST /stats/visit` (dedup via `localStorage`).

## 2. The bid (the only write)

The bid signs `auction::bid<USDC>` and is the dogfood loop — a winning bid is itself a
payment that appears in this page's own feed. **v1 is NON-sponsored** (dapp-kit
`useSignAndExecuteTransaction`; the bidder pays their own gas). `buildBidTx` (`api.ts`)
materializes `Balance<USDC>` via the SDK `CoinWithBalance` intent (`tx.balance({ type,
balance })` — the same recipe `apps/wallet` uses for `subs::create`), then move-calls
`bid` with `[slot, config, payment, creative, clock]`. Defence-in-depth: it asserts the
slot's `coinType == USDC_TYPES[NETWORK]` and the bid `target == PACKAGE_IDS.AUCTION.BID`
before signing — never signs a foreign target; all ids come from `@suize/shared` / the
backend, none hardcoded. **Gasless bids are sponsor-ready** (the backend allow-lists
`AUCTION_MOVE_TARGETS`) — wiring the WS sponsor (the wallet's transport) is the later
flip; not required for the bid to work.

## 3. Honesty laws on this surface (calibrated honesty is LAW)

- **No faked rows / demo data.** The feed/rankings render ONLY what the backend returns
  (real on-chain). Graceful empty states; never invent a transaction.
- **Zero status-talk** (no "coming soon / soon / roadmap / not yet"). Describe only what
  works today. Claim ladder (CLAUDE.md LOCKED #7): ALLOWED "gasless / x402-compatible by
  design / we run a live x402 facilitator for Sui"; FORBIDDEN "on x402 / official /
  default Sui facilitator" as fact. No platform names.
- `@suize` handles wherever they resolve (backend pre-resolves → client reverse-resolve
  → short-hex fallback); money figures wear the gradient.
- `public/llms.txt` — final-production nav doc, claim-ladder-safe, points back to
  `suize.io/llms.txt`. No internals, no testnet labels.

## 4. Deploy state

- **Vercel** (`suize-agents`, aresrpg team — the house pattern: build LOCALLY + deploy
  `--prebuilt` because Vercel's cloud build can't resolve `workspace:*`). Production
  deploy LIVE; protection `all_except_custom_domains` (matches the other apps — custom
  domain public). Env: `VITE_SUI_NETWORK=testnet`, `VITE_SUIZE_API=https://api.suize.io`,
  shared `VITE_ENOKI_API_KEY` + `VITE_GOOGLE_CLIENT_ID`. `.vercel/` is gitignored (each
  dev re-links, like every app).
- **Testnet** (the auction + the treasury-inbound feed are testnet; the prod backend runs
  `sui:testnet`).
- **Pending before the page is fully live** (owner/credential-gated):
  1. **DNS** — `agents.suize.io` needs `A → 76.76.21.21` (or CNAME `cname.vercel-dns.com`)
     at Cloudflare (the `suize.io` DNS provider); the domain is already added to the project.
  2. **Backend** — the directory route group (`/feed` `/rankings` `/stats` `/ads/*`
     `/directory.json|okf`) is built but not yet deployed to `api.suize.io`; until then
     those endpoints 404 and the page shows empty states.
  3. **Sign-in/bid** — `agents.suize.io` must be authorized on the shared Google OAuth
     client + the Enoki portal origin (the read-only surfaces need no auth).
