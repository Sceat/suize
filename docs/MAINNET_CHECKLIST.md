# Suize — Testnet → Mainnet Checklist

> The "later" gate. **Everything in this repo targets TESTNET today** (one `NETWORK` const in `@suize/shared`; the backend sponsor hard-rejects anything but `testnet`; `Move.toml` pins `framework/testnet`). This is the ordered, owner-actionable sequence to flip to mainnet — **do not start it until the owner signals real-funds intent.** No step here runs on its own; the owner drives each gate.

**Why a gate at all:** unaudited Move + a young agent stack must not sit behind real funds. The hard prerequisite is the **audit** (step 1); the rest is the mechanical network flip + the real-money sign-off. The security source for the contract/ops items is `docs/wallet/SECURITY.md` §5 (keep both in sync); the deploy mechanism is `docs/wallet/ARCHITECTURE.md` §7.

**Order matters.** Each phase gates the next. Do not flip the network const before the contracts are audited + redeployed, or you'll point a live mainnet frontend at a non-existent package.

---

## Phase 0 — AUDIT (the non-negotiable prerequisite)

**Real funds do not move until this phase is done.** Cetus proved audited Move still breaks; unaudited is strictly worse.

- [ ] **Third-party audit (or external Move review) of all four modules** — `mandate`, `vault`, `swap`, `navi`. Non-negotiable before non-trivial real funds.
- [ ] **Arithmetic review** of every overflow/underflow surface: budgets, balances, the per-asset `supplied` bookkeeping, swap amounts (the Cetus lesson — math is the attack surface).
- [ ] **Mandate-mint boundary tests** (the Aftermath lesson): reject negative/zero budget, missing/zero expiry, out-of-enum scope.
- [ ] **Live integration run of the real protocol calls** — the DeepBook `pool::swap_exact_*` spot swap and NAVI `incentive_v3` deposit/withdraw are **compile-verified only**; exercise them against live objects on localnet/testnet before trusting them with real money (ARCHITECTURE §2.3–§2.4).
- [ ] **Resolve or formally accept the NAVI supply-leg destination caveat** (SECURITY §1.6): a localnet integration that asserts the released supply coin lands at NAVI, or import NAVI once feasible. Document the residual if accepted.
- [ ] **On-chain revocation test** — confirm a revoke reverts the agent's *next* action on-chain (not just the unit test `test_consume_after_revoke_aborts`).
- [ ] **Cosmetic, before judges/auditors read the tests:** rename the legacy `SCOPE_SUILEND`/`SCOPE_DEEPBOOK` constants in `tests/mandate_tests.move` to the NAVI/DeepBook convention (`0`=NAVI supply, `1`=NAVI withdraw, `2`=DeepBook swap).

---

## Phase 1 — Move contracts → mainnet

- [ ] **Flip the framework rev** in `packages/move-wallet/Move.toml`: `framework/testnet` → `framework/mainnet` (the `MoveStdlib` + `Sui` deps; keep the `override = true` that forces a single framework version across the DeepBook-pinned graph). **P0 — the whole mainnet plan dies without it.**
- [ ] **Rebuild + re-run the 65 tests** (`sui move build && sui move test`) on the mainnet framework. They must stay 65/65 green.
- [ ] **Verify the DeepBook dep's mainnet published-at id** is the one the agent's PTBs will use at runtime (the mainnet id is recorded in `Move.toml`'s notes; it is a runtime input, not a compile-time one). Confirm the live SUI/USDC `Pool` + the live DEEP coin package on mainnet.
- [ ] **Verify the NAVI mainnet `lending_core` package id** (NAVI rotates ids on upgrades — read the current one; never hardcode a stale id; the Scallop lesson).
- [ ] **Publish to mainnet via the sign-the-publish page** — the user connects a mainnet wallet, signs + executes the publish `Transaction` for the `suize` package from *their own* wallet (they pay gas; **we never handle keys**). The page is static, source-visible, HTTPS, dependency-minimal, and requests **only** the publish signature.
- [ ] **Capture the package id + shared object ids** → the deploy script writes them into **`@suize/shared`** (`PACKAGE_IDS.WALLET.PACKAGE` + `TARGETS` — currently a placeholder). Never hand-copied.

---

## Phase 2 — `@suize/shared` + the sponsor: flip the network (the single-source switch)

This is the one place the whole stack reads from — flip it here and every app/service follows.

- [ ] **Set `NETWORK = 'mainnet'`** in `packages/shared/src/index.ts`. (Every app + service imports it; nothing hardcodes a network elsewhere.)
- [ ] **Populate `PACKAGE_IDS.WALLET`** with the mainnet package id + the wallet's sponsorable Move targets (`mandate::*` / `vault::*` / `swap::*` / `navi::*` as applicable). This auto-extends `WALLET_MOVE_TARGETS` → the sponsor's allow-list (it's the union of Crash + wallet targets).
- [ ] **Stand up a MAINNET Enoki app** in the Enoki Portal: a mainnet app + its **PRIVATE** API key (server-side sponsoring) + the **public** key + Google client id for the wallet frontend's zkLogin.
- [ ] **Flip the sponsor's network guard** — the backend currently rejects `network !== "testnet"` (`services/backend/src/sponsor/index.ts`) and constructs its Enoki + Sui clients for testnet (`SuiJsonRpcClient({ network: "testnet" })`, `SUI_RPC_URL` default `fullnode.testnet`). Update the guard + the RPC url + the client network to mainnet, and swap `ENOKI_PRIVATE_API_KEY` (SOPS) to the mainnet private key.
- [ ] **Widen the sponsor's wallet Move-targets POST-DEPLOY** — the wallet targets only exist once Phase 1 publishes and Phase 2 populates `PACKAGE_IDS.WALLET`; confirm `sponsorInfo.walletTargetCount > 0` at boot. (`allowedAddresses` stays pinned to the sender so sponsored txs can't redirect funds.)
- [ ] **Keep `crash.suize.io` + the localhost dev origins** in CORS if Crash is also live; add the mainnet wallet origin (`https://suize.io`).
- [ ] **Redeploy the backend** (SOPS secret rotation + `helmfile sync`; force a rollout if only the secret changed) — `services/backend/DEPLOY.md`. Verify `/ready/sponsor` is green against the mainnet fullnode + mainnet Enoki key.

---

## Phase 3 — Wallet frontend → mainnet

- [ ] **`apps/wallet` provider stack to mainnet** — `SuiClientProvider` + `registerEnokiWallets` configured for mainnet, using the mainnet Enoki public key + Google client id (`VITE_ENOKI_API_KEY` / `VITE_GOOGLE_CLIENT_ID`). *(The README's "Network = mainnet" note becomes true here; today the app is a testnet/mock cut.)*
- [ ] **Replace mock/stubbed seams with real chain wiring** (the clean path is already laid out in `apps/wallet/README.md`): `useHome` → real `mandate`/`vault`/`swap`/`navi` event subscriptions + RPC balance reads; `useAuth` → real Enoki Google connect; stubbed actions → `dryRun`-previewed, agent-signed PTBs; point sponsored txs at the mainnet `sponsor.suize.io`.
- [ ] **SuiNS `<name>@suize` on mainnet** — **register + verify + transfer the parent `suize.sui`** into Enoki's managed contract (P0; the identity flow + a minor key surface depend on it). Confirm the sponsored leaf-subname issuance end-to-end. Degrades to a cosmetic label if not ready — must not block onboarding.
- [ ] **Mainnet DeepBook + NAVI addresses verified in the agent/PTB layer** — the live `Pool<SUI,USDC>` + DEEP-fee path (or a gasless/whitelisted-pool path), and NAVI's live `Storage`/`Pool`/`Oracle`/`Incentive` + published-at id, all supplied at PTB-build time.

---

## Phase 4 — Infra / domains

- [ ] **Vercel** — `apps/wallet` deployed to the apex **`suize.io`** (retarget from whatever currently serves it; landing moves to a marketing subdomain or is retired). `apps/landing` build stays Vercel.
- [ ] **Cloudflare Tunnel** routes confirmed for `sponsor.suize.io` + `api.suize.io` → the unified backend service (DEPLOY.md §4).
- [ ] **DNS / domain** — `suize.io` (wallet), `crash.suize.io` (Crash, when migrated), marketing subdomain. Confirm HTTPS everywhere.

---

## Phase 5 — Real-funds risk sign-off (the owner's explicit gate)

The last gate. Nothing custodies real user money until the owner signs this off.

- [ ] **Turnkey enclave live** as the agent signing path before scaling funds (the Volo lesson — no raw operator key on a hot server). Until then the agent host is an attack surface.
- [ ] **Confirm the three secrets are separate** (SOPS-only, never in a frontend bundle): the **agent** scoped key ≠ the **sponsor** Enoki private key ≠ the **SuiNS** issuing key.
- [ ] **Pyth staleness/confidence check** implemented + the agent **fails closed** on stale/low-confidence data.
- [ ] **Guardian trim band** set + tested against a simulated price crash (deterministic MA-distance band + trim sizing; no leverage/registry to read).
- [ ] **Cap-leverage / handle-margin-pause is N/A by design** — margin is **excluded** (un-cageable `MarginManager`; SECURITY §2.5). DEGEN is spot SUI↔USDC: no leverage cap to enforce, no "margin paused" state to handle, no liquidation line. **If margin is ever added (roadmap), it MUST be labeled "off-chain-policy-governed, NOT VM-caged"** and re-open this item with a 3x cap + paused-state handling.
- [ ] **Batched-PTB per-user failure isolation** tested (one user's abort must not strand/mis-account another's funds).
- [ ] **Security hardening:** revocation runbook verified live (total on both tiers); monitoring/alerts on oracle staleness, mandate-abort events, and per-asset `supplied`-vs-on-chain drift; **per-user sandbox size caps** kept small during early mainnet.
- [ ] **Owner real-funds sign-off** — the explicit go/no-go after every box above is checked. Start with small sandbox caps; scale only after live behavior is observed.

---

*Sources: `docs/wallet/SECURITY.md` §5 (contract/custody/ops items) · `docs/wallet/ARCHITECTURE.md` §7 (deploy mechanism) · `packages/shared/src/index.ts` (the `NETWORK` + `PACKAGE_IDS` switch) · `services/backend/{src/sponsor,DEPLOY.md}` (the sponsor network guard + redeploy).*
