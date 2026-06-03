# Suize Wallet — Security, Precautions & Exploits

> **The threat model + Sui exploit history + the pre-mainnet gate.** Product vision lives in `SPEC.md`; deep Move/agent detail in `ARCHITECTURE.md`; the repo-wide overview in the root `CLAUDE.md`. The pre-mainnet checklist here (§5) is the source for `docs/MAINNET_CHECKLIST.md`.

**Status (2026-06-02):** Pre-mainnet, on **testnet**. Contracts built + tested: `mandate` (11), `vault` (12), `swap` (18, DeepBook spot SUI↔USDC), `navi` (24, NAVI lend-as-is) — **65/65 green, ~47 of them `#[expected_failure]` abort proofs** (the suite mostly proves the cage *refuses*). The gate + custody round-trips are unit-tested against stubs; the real DeepBook/NAVI calls are compile-verified behind a seam and need a live integration run (ARCHITECTURE §2.3–§2.4). The guardian throttle, force-unwind, and the off-chain agent are **PLANNED** (the agent is a stub at `services/backend/agent`). **No third-party audit yet.** This document is the honest account of what protects user funds, what has broken elsewhere on Sui, and where we are still exposed.

**Brand commitment — calibrated honesty:** We never claim AI alpha or guaranteed profit. Yield is plumbing, not the pitch. The guardian is a **position-risk-throttle** (trim an overextended SUI position back to USDC), **not** liquidation-defense (there is no leverage) and not exploit clairvoyance. **The cage is PURE across both MVP tiers** — every money move routes through `consume_budget`, because both venues are cageable Coin-in/Coin-out compositions (NAVI lend-as-is + DeepBook spot swap); **margin is excluded precisely because it can't be caged** (§1.6). The cage caps loss to the sandbox regardless of venue risk — **but it does not cap loss to zero** (§4). Everything below is written to that standard.

---

## 1. Security Model — The Per-User Cage

The design exists so that **a compromised, jailbroken, or buggy agent cannot lose more than the risk capital a user explicitly dedicated.** On both MVP tiers (idle/NAVI lend-as-is + DeepBook spot swap) this safety is enforced by the Move VM, not by prompts, not by off-chain checks — because we excluded the one venue (margin) that would have broken it. The single honest cage-tightness caveat in the *shipped* code is the NAVI **supply** leg's PTB-release model (§1.3, §1.6); the withdraw leg and the whole DeepBook spot leg are tight.

### 1.1 Two balances, one hard wall

| Balance | Where it lives | Agent access |
|---|---|---|
| **MAIN funds** (savings / peace of mind) | The user's own zkLogin wallet (Enoki/Google, seedless) | **Never.** No object reference to the owner's wallet exists in any agent code path. |
| **AGENT SANDBOX** (dedicated risk capital) | Per-user `vault` / `swap::SwapVault` / `navi::MultiAssetVault` objects under Move custody | Only within the active mandate's scope/budget/expiry, via the gated `agent_*` fns. |

The pitch is literally *"dedicate play money, not your savings."* The main wallet's safety is not a promise — there is no on-chain authority that lets the agent reach it.

> **Recovery surface (honest note):** the zkLogin owner address is derived from the Google JWT + a user salt managed by Enoki. "No seed phrase" is true; the recovery/loss surface is **the Google account + the Enoki-managed salt**, not a mnemonic.

### 1.2 The Mandate — a capability the VM enforces

`mandate.move` mints a per-user **shared `Mandate`** + a **key-only, non-transferable `AgentCap`**. Authority is **continued membership in the mandate's allow-list**, not mere possession of the cap — so revocation is instant and total without clawing the object back. Auth root is the **owner ADDRESS** (zkLogin gives a stable address; nothing to phish), not an `OwnerCap`.

`Mandate` encodes:
- **Scope** — an opaque `VecSet<u8>` of action tags (the tag→venue map is an off-chain convention: `0`=NAVI supply, `1`=NAVI withdraw, `2`=DeepBook spot swap).
- **Budget cap** — a hard ceiling (`budget_remaining`) on capital the agent can deploy.
- **Expiry** — a time-box (`expiry_ms`); after it the mandate is dead weight.
- **Instant revocation** — owner removes the cap's ID from the allow-list in one tx; the agent's *next* gated move aborts.

`consume_budget(mandate, cap, scope_tag, amount, clock)` runs **5 asserts, in this exact order** (verified against source — the order is contract; tests assert which fires first):

1. `cap.mandate_id == id(mandate)` → `ECapMandateMismatch` (5)
2. `allow_listed.contains(cap_id)` → `ECapNotAllowed` (2)  ← **the kill switch**
3. `clock.timestamp_ms() < expiry_ms` (strict `<`) → `EExpired` (0)
4. `allowed_scope.contains(scope_tag)` → `EOutOfScope` (4)
5. `amount <= budget_remaining` (`<=`, full-drain allowed) → `EOverBudget` (3)

The agent's signing key **cannot construct a transaction that exceeds these bounds** — the Move VM **aborts the tx on-chain** if it tries. This is the structural difference from a confirm-button wallet: we don't need a human tap because the chain is the leash. (The one shipped looseness — the NAVI supply leg's released coin destination — is §1.6; it does not touch budget/scope/expiry enforcement.)

> **In-flight revocation has no escape window.** Revocation mutates the shared on-chain `Mandate` object (removes the cap from the allow-list). Any tx the agent already signed re-reads the mandate's *current* state at execution; if the cap is no longer allow-listed it aborts `ECapNotAllowed`. There is no "signed-before / lands-after" bypass on the gated path.

> **Kill-move demo (provable — DeepBook-free):** jailbreak our own agent → it attempts an **over-budget / out-of-scope consume against the vault**, submitted raw so the VM (not a client pre-check) is what says no → **the Move VM aborts the tx; we show the failed tx hash on an explorer** → owner revokes → the agent's next legitimate move reverts (`ECapNotAllowed`). Two on-chain receipts. This demo needs only `mandate` + `vault` — **zero DeepBook dependency**, so it cannot be blocked by anything external. See §6 for the demo-construction caveat that makes the failed hash real rather than a client-side error. **Now whole-product** — with no un-cageable margin leg, the kill-move + revoke cover both tiers, zero asterisk.

### 1.3 Tight custody — funds stay in Move (the cage pattern, per venue)

Every adapter follows the same invariant: **vault↔mandate check → `consume_budget` 5-assert gate → real protocol round-trip → emit the log event.** Only the protocol step differs. Per-user objects, **never pooled** (one user, one mandate).

- **Core proof — `vault::agent_consume<T>`** (the internal-move proof): gate, then `idle.split → deployed.join` **inside** the vault — no `Coin` returned, funds never leave custody. Order of walls: over-budget → `EOverBudget`; within-budget-but-over-idle → `EInsufficientBalance` (the vault wall, *after* the budget gate); foreign-but-valid mandate → `EVaultMandateMismatch` (*before* the gate).
- **DEGEN / DeepBook spot — `swap.move` (tight, VM-enforced):** the agent splits the input out of the `SwapVault`, threads the DEEP fee from the vault's own pot, calls `pool::swap_exact_*` (`min_out`-gated), and **re-joins all three returned coins** (leftover input, output, leftover DEEP) straight back into the vault. **No `Coin` is ever returned to the caller** — the agent has nothing to redirect through the entire round-trip. Spot SUI↔USDC is a clean Coin-in/Coin-out path with no custody hole and no pause risk.
- **SAFE / NAVI — `navi.move` (mixed, FLAGGED):** the vault custodies NAVI's `AccountCap`, so the lending position belongs to the vault. The **withdraw** leg (scope 1) is **tight** — a `WithdrawTicket` **hot potato** (no abilities) forces the redeemed coin back into custody (the tx cannot complete otherwise). The **supply** leg (scope 0) is the **looser** leg — see §1.6.

**No commingled pool — deliberately.** Pooling would be more capital-efficient and would kill the thesis: it breaks the per-user cage, widens blast radius to everyone, and destroys the kill-move demo. Scale comes from a *central brain* + *batched PTBs*, never shared custody (ARCHITECTURE §3.4).

### 1.4 Signing model — scoped agent key, separate from owner

- The owner authenticates via **zkLogin (Enoki, Google)** — seedless; **we never handle the user's main key.**
- The agent server holds a **scoped agent key per user**, distinct from the owner key **and** from the sponsor's Enoki private key (a separate secret — never reuse it; root `CLAUDE.md`).
- **Production signing path: Turnkey enclave** (AWS Nitro + policy engine). Agent keys live hardware-isolated so a breach of the agent host does not directly expose raw keys. **Until the enclave path is live, the agent host is a real attack surface** (§4).

**The cage bounds *what* the key can do on-chain; key custody is a separate trust boundary we do not overclaim.** A leaked agent key still cannot exceed budget/scope/expiry on any gated call, and is killable by revocation — on **both** MVP tiers, because there is no margin manager the key would own outright. (The leash is the Move mandate, not the vendor; Turnkey is defense-in-depth, never the floor.)

### 1.5 Deploy precautions

- **Deploy now is on TESTNET** (the locked network; one `NETWORK` const in `@suize/shared`). The mainnet flip is a later, gated step (§5; `docs/MAINNET_CHECKLIST.md`).
- The **user signs the publish transaction** themselves via a minimal "connect wallet & sign" page. **We handle no private keys at deploy time.** That page must be: static, dependency-minimal, source-visible, served over HTTPS, and request *only* the publish signature — never a broad approval.
- **For the mainnet cut only:** flip `Move.toml` `framework/testnet` → `framework/mainnet` and re-run the 65 tests before publishing (the shipped `Move.toml` is correctly testnet-pinned today).

### 1.6 The one honest cage caveat in the shipped code — the NAVI supply leg

This is the boundary of the "the Move VM enforces the leash" claim, stated plainly — and the first thing a Mysten engineer will probe.

**On the DeepBook spot leg and the NAVI withdraw leg, the cage is tight: no `Coin` is left free-floating for the agent.** The exception is the **NAVI supply leg** (`agent_supply`, scope 0). NAVI's Move package **cannot be imported as a `Move.toml` dependency** (old-style-vs-new-style manifest collision + a mainnet-pinned oracle graph that fights our testnet framework override — full reasoning in `navi.move`'s header and ARCHITECTURE §2.3), so that leg uses a **PTB-release model**: the gate runs and caps the **amount** (mandate budget) and **scope**, but the released `Coin<CoinType>` is handed to NAVI by the **agent's PTB**, so for that brief span the coin's **destination is not VM-enforced** by us.

Stated honestly:
- **The amount and scope are VM-enforced everywhere; the NAVI supply leg's *destination* is not.** The agent holds an `AgentCap` (not arbitrary transfer rights) and the budget hard-caps the size, but a malicious PTB could in principle route that one released coin elsewhere. This is the realistic cage boundary — narrow, single-leg, supply-only.
- **The NAVI withdraw leg closes the loop tightly** via the `WithdrawTicket` hot potato (no `drop`/`store` → the tx can't complete without re-absorbing into the vault).
- **Revocation is still total on both tiers** — it disables `consume_budget`, and there is no agent-owned external object (no margin manager) that survives a revoke. The kill-move is whole-product.

**Mitigation posture, honest:** treat the NAVI supply leg's floor as **"the agent can only release a mandate-sized, in-scope coin, which the PTB hands to NAVI"** + **Turnkey policy on the agent key** + a tight off-chain allow-list on what the agent's PTB may construct. Tighten it the moment NAVI is importable (or via a localnet integration that asserts the coin lands at NAVI). Do **not** claim the supply leg's coin-destination is VM-enforced — it isn't.

> **What we did NOT ship (and why):** the obvious "headline degen venue," DeepBook **margin**, is **excluded** because its `MarginManager` is **address-owned** (`ctx.sender()==self.owner`; no `store`, no capability, no revoke), which means the agent — not a mandate the VM enforces — would be the custody authority, `consume_budget` would have nothing to hook onto, and revoke would **not** stop margin withdrawals. That would be an *un-caged* leg, far worse than the narrow supply-destination caveat above. We chose spot SUI↔USDC precisely so the cage stays pure. Detail: ARCHITECTURE §2.5; the exploit that vindicates it: §2.5 below.

---

## 2. Sui Exploit History — What Broke, and How Suize Responds

Roughly **seven Sui-linked exploits in ~12 months** (April 2026 alone saw >$600M across ~12 incidents). Each is a real lesson encoded into the design. We claim no immunity — we claim we learned the specific failure modes.

### 2.1 Cetus — ~$223M, May 22 2025 (logic bug: flawed overflow check)

- **What:** The biggest DEX on Sui drained of ~$223M in **under 15 minutes**. The `checked_shlw` function compared against `0xFFFFFFFF…FFFF << 192` instead of `0x1 << 192`, letting overflowing values pass; an attacker minted a huge liquidity position for ~1 token ([Halborn](https://www.halborn.com/blog/post/explained-the-cetus-hack-may-2025), [Cyfrin](https://www.cyfrin.io/blog/inside-the-223m-cetus-exploit-root-cause-and-impact-analysis)).
- **Lesson:** A single arithmetic line in audited Move emptied a protocol in minutes. **Audits ≠ safety; math is the attack surface.**
- **Our response:** Our Move surface is deliberately tiny (mandate + vault + the two adapters) and **writes no AMM/curve math** — we compose with first-party Mysten primitives (DeepBook) and NAVI. The cage bounds a bug in *our* sizing logic to the mandate budget — it cannot mint value. (We still owe a focused arithmetic review of all four modules — §5.)

### 2.2 Scallop — ~$142k (~150k SUI), April 26 2026 (deprecated + uninitialized variable)

- **What:** A flash-loan attack drained ~$142k via a **deprecated sSUI rewards contract (a V2 contract from Nov 2023) left reachable.** Root cause: an **uninitialized `last_index`** let the attacker claim rewards against the full historical index, combined with oracle price manipulation ([CryptoTimes](https://www.cryptotimes.io/2026/04/27/scallop-loses-142k-in-flash-loan-attack-on-deprecated-contract/)).
- **Lesson:** **Orphaned code you forgot to disable is live attack surface** — and uninitialized state is the hole inside it.
- **Our response:** Mandate **expiry** means stale authority dies by default. On any upgrade we explicitly **revoke/disable superseded mandate + vault versions** and confirm no orphaned capability objects remain callable (§5). Also relevant: we **VERIFY the NAVI `lending_core` package id at build** (NAVI rotated ids in a Nov-2025 upgrade) so the agent never points a PTB at a stale package.

### 2.3 Volo — ~$3.5M, April 22 2026 (compromised admin key — *not* a contract bug)

- **What:** ~$3.5M drained from three vaults (WBTC, XAUm, USDC). GoPlus/ExVul confirmed a **compromised privileged operator key — not a flaw in the audited contracts** (~$3.44M later clawed back) ([CoinDesk](https://www.coindesk.com/markets/2026/04/22/another-defi-protocol-loses-millions-in-hack-days-after-kelpdao-breach)).
- **Lesson:** **Key management is the breach even when the Move is perfect.** A broad-authority privileged key is a single point of catastrophic failure.
- **Our response:** The exploit our architecture answers most directly. The agent key is **not privileged** — it is scoped by the mandate; a stolen key cannot drain everything because budget/scope/expiry bound it and the owner can revoke, on **both** MVP tiers (no un-cageable margin manager exists). **Turnkey enclave** (prod) avoids a raw operator key on a hot server. *(Caveat: §1.6 — the NAVI supply leg's released-coin destination isn't VM-enforced, so a stolen key + a malicious PTB could misroute one mandate-sized supply coin; the budget still caps the size and the withdraw/spot legs are tight.)*

### 2.4 Aftermath — ~$1.14M, April 29 2026 (parameter/accounting misconfiguration)

- **What:** Aftermath **Perps** exploited for ~$1.14M when contract logic allowed a **negative builder-code fee** — an admin/parameter validation gap turned a rebate into a drain (~11 txs / ~36 min; Mysten + Sui Foundation covered losses) ([CryptoTimes](https://www.cryptotimes.io/2026/04/29/aftermath-finance-perps-on-sui-exploited-for-1-14m/)).
- **Lesson:** **Unvalidated admin/config parameters are exploitable.**
- **Our response:** Mandate parameters (budget, scope, expiry) must be **validated at mint time with hard bounds** — no negative/zero budget, no zero/absent expiry, no out-of-enum scope. A tested invariant, not an assumption (add explicit boundary tests — §5).

### 2.5 DeepBook Margin — ~$239.7k, **May 9 2026** (undercollateralization in the USDC margin pool) — *the venue we excluded*

- **What:** At ~**03:18 UTC on May 9 2026**, the **USDC margin pool became undercollateralized**, accruing **~$239.7k bad debt** when collateral deteriorated **faster than the liquidation engine could react** during volatility. Margin trading was **paused**; the **DeepBook Insurance Fund covered the bad debt** (**no user losses**); deposits/withdrawals resumed shortly after ([AMBCrypto](https://ambcrypto.com/deepbook-suffers-239-7k-bad-debt-what-it-means-for-leveraged-defi/)).
- **Lesson:** This is the venue we **deliberately do not use.** Native, first-party, and *still* it broke: liquidation engines lag in fast markets, leverage destabilizes shared pools, and **"margin paused" is a real operating state** — a venue that can be paused out from under you, where the agent would also hold **un-caged** authority (§1.6), is the wrong place to send autonomous money. It compounds the un-cageability reason: a reactive guardian could be **frozen out exactly when it's needed**.
- **Our response (the decision):** **Margin is excluded from the MVP** — roadmap only, and if it ever ships it is labeled *"off-chain-policy-governed (Turnkey policy on the agent key), NOT VM-caged"* with no "the chain stops it" claim. The DEGEN venue is **spot SUI↔USDC**, which has **no margin manager, no leverage, no liquidation line, and no pause risk** — a clean Coin-in/Coin-out path the VM fully cages. The guardian becomes an honest **position-risk-throttle** (trim overextended SUI → USDC on the MA-distance signal), not liquidation-defense.

> **Why this strengthens, not weakens, the pitch:** the one venue whose authority model breaks the cage is also the one with a live undercollateralization + pause incident. Excluding it makes the "VM-enforced cage" claim **whole-product** *and* removes a real operational hazard. Two birds.

---

## 3. Things To Watch (live exposures we are tracking)

| # | Risk | Why it matters | Mitigation / status |
|---|---|---|---|
| 1 | **NAVI supply-leg released-coin destination (§1.6)** | The one shipped looseness: the supply leg's coin destination isn't VM-enforced (NAVI isn't importable). A malicious PTB could misroute one mandate-sized supply coin. | Budget caps the size; withdraw + spot legs are tight; tight off-chain allow-list on the agent's PTB. **Tighten via localnet integration (assert the coin lands at NAVI) or when NAVI becomes importable.** |
| 2 | **Pyth oracle lag / staleness** | The guardian reads MA-distance + a price; a stale price = wrong risk read = late or wrong trim. | Hermes (off-chain) for fast polling; enforce staleness/confidence check; on stale/low-confidence price **fail closed** (don't act; prefer holding / de-risking). |
| 3 | **`@mysten/sui` v1-vs-v2 Pyth dependency conflict** | `@pythnetwork/pyth-sui-js@3` depends on `@mysten/sui` v1 while our stack is v2 — a build-time hazard. Bad resolution = subtle serialization/signing breakage. | **Bun workspace `overrides`/`resolutions`** to a single `@mysten/sui`; likely **drop the direct `pyth-sui-js` dep** and read Hermes over plain HTTP. *Our own build-config risk — verify the pinned resolution end-to-end.* |
| 4 | **NAVI `lending_core` package-id rotation** | NAVI rotated `lending_core` ids in a Nov-2025 upgrade; a stale hardcoded id = the agent's supply/withdraw PTB calls a dead package (the Scallop "orphaned code" shape, inverted). | **Read the current package id at build/PTB time; never hardcode.** The agent supplies the live `Storage`/`Pool`/`Oracle`/`Incentive` + published-at id at PTB-build time. |
| 5 | **DeepBook spot DEEP-fee + Pool object handling** | The spot swap needs the live `Pool<Base,Quote>` + real DEEP coins at PTB-build time (the source `token::deep::DEEP` is a compile placeholder). Wrong Pool/DEEP wiring = a failing or mis-priced swap. | The `SwapVault` keeps a DEEP pot (safe default); the agent supplies the real Pool + DEEP at runtime. `VERIFY` gasless/whitelisted-pool paths against the pinned SDK. |
| 6 | **Agent host compromise (pre-enclave)** | Until Turnkey is the signing path, a scoped agent key may sit on a server. | Authority is mandate-bounded + revocable even if stolen (both tiers); the only extra exposure is the §1.6 supply-destination caveat. **Move to enclave before scaling.** |
| 7 | **LLM-driven trade herding** | Feb 2026 "Black Sunday II" saw **>$400M liquidated in 24h** (part of ~$2.56B that day), with documented historical-data AI bots failing in unfamiliar conditions and amplifying the cascade ([OpenPR](https://www.openpr.com/news/4440737/crypto-fear-index-crashes-to-11-as-400m-liquidated-in-24-hours), [CoinDesk](https://www.coindesk.com/business/2026/02/11/in-unfamiliar-market-conditions-today-s-historical-data-driven-ai-trading-bots-will-falter)). | **Propose/move wall:** the LLM only **ranks/narrates**; a **deterministic core owns every amount/route/size.** The LLM **never emits a tx amount**; sentiment **never directly triggers a trade.** *(The "$400M single LLM-herd event" is not corroborated — frame as "the Feb-2026 cascade, with AI bots amplifying it," never a fabricated single-event stat.)* |
| 8 | **Batched-PTB failure isolation** | One malformed/oversized PTB touching N users' vaults is a new failure surface (one user's revert aborting the batch; gas-bomb DoS; partial-fill mis-accounting). Cetus + Aftermath were both *accounting* bugs in otherwise-fine systems. | **Batched PTBs must isolate per-user failure** (one user's abort must not strand or mis-account another's funds) — tested before batched execution ships. Every action is cap-gated `agent_consume`, so there's **no `ctx.sender()==owner` per-manager tension** (that was a margin-only problem, now gone). |
| 9 | **SuiNS parent-name + key handling** | Programmatic `<name>@suize` subname issuance requires we **own + transfer the parent `suize.sui` into Enoki's managed contract**. A leaked private API key could mint subnames under our parent. | Register + verify + transfer `suize.sui` (P0, §5). Keep the issuing key server-side; public-key path is one-subname-per-user. Degrades to a cosmetic label if not ready. |

---

## 4. Where We Are Honestly Exposed

No spin. The real soft spots today:

1. **No third-party audit yet.** 65/65 of *our own* tests pass; that is not an external audit. Cetus proves audited code still breaks — unaudited is strictly worse. **Single biggest gap.**
2. **The real protocol calls aren't exercised against live venues yet.** The gate + custody round-trips are tested against stubs; the real DeepBook `pool::swap_exact_*` and NAVI `incentive_v3` deposit/withdraw are **compile-verified only** and need a localnet/testnet integration run before real funds (ARCHITECTURE §2.3–§2.4).
3. **The cage caps loss to the sandbox, NOT to zero.** On DEGEN, a fast gap or an oracle outage can move a spot SUI position against the user before the guardian trims — **the user loses real sandbox capital.** **Stated plainly: the cage guarantees the loss stops at the sandbox, never the main wallet — it does not guarantee the sandbox is preserved.** (No leverage/liquidation, so no forced wipeout — but spot can still fall.)
4. **The NAVI supply leg's coin destination isn't VM-enforced (§1.6).** The narrow, single-leg, supply-only caveat — amount + scope are caged, destination isn't, until NAVI is importable or a localnet integration asserts it. The withdraw + spot legs are tight; revoke is total.
5. **Pre-enclave agent key is a hot key.** Until Turnkey, the agent host is a genuine attack surface (damage mandate-bounded + revocable; the only extra is the §1.6 supply caveat).
6. **Oracle dependence.** Pyth staleness degrades the guardian's read. We fail closed, but a fail-closed guardian still can't act on data it doesn't have.
7. **Mandate-mint parameter validation must be airtight.** Aftermath fell to one unbounded parameter. The cage is only as strong as its weakest bound.

---

## 5. Pre-Mainnet Checklist (before real funds)

> This is the source list for `docs/MAINNET_CHECKLIST.md` (which adds the network-flip/ops sequencing). Both must stay in sync.

**Contracts**
- [ ] Third-party audit (or external Move review) of all four modules (`mandate`, `vault`, `swap`, `navi`). **Non-negotiable before non-trivial real funds.**
- [ ] **Audit every arithmetic operation** in the modules (Cetus): overflow/underflow on budgets, balances, the per-asset `supplied` bookkeeping, swap amounts.
- [ ] **Boundary tests on mandate-mint** (Aftermath): reject negative/zero budget, missing/zero expiry, out-of-enum scope.
- [ ] Confirm **revocation reverts the agent's next action** in an on-chain integration test, not just a unit test (the `test_consume_after_revoke_aborts` path proves the unit case).
- [ ] Confirm **no orphaned/deprecated capability objects** remain callable after any upgrade (Scallop).
- [ ] **Tighten or accept the NAVI supply-leg destination caveat (§1.6):** a localnet integration that asserts the released supply coin lands at NAVI (or import NAVI once feasible); document the residual if accepted.
- [ ] **Live integration run** of the real DeepBook spot swap + NAVI deposit/withdraw against live objects (the seams are compile-verified only).

**Custody & keys**
- [ ] **Turnkey enclave** live as the agent signing path before scaling funds (Volo).
- [ ] Verify the agent key has **zero authority outside the mandate** (attempt an out-of-scope / over-budget tx → expect on-chain abort) on both tiers.
- [ ] Verify **main/owner funds are unreachable** by any agent code path.
- [ ] Confirm the **agent key, sponsor Enoki key, and SuiNS issuing key are three separate secrets** (SOPS-only, never in a frontend bundle).

**Deploy page + build**
- [ ] **Flip `Move.toml` `framework/testnet` → `framework/mainnet`; rebuild; re-run the 65 tests** before publishing.
- [ ] Connect-wallet-and-sign-publish page is **static, source-visible, HTTPS, dependency-minimal**, requests **only** the publish signature, **handles no private keys.**
- [ ] **Register + verify + transfer `suize.sui`** into Enoki's managed contract (P0 — the identity flow and a minor key surface both depend on it).

**DEGEN / oracle / venue**
- [ ] **Pyth staleness/confidence check** implemented; agent **fails closed** on stale/low-confidence data.
- [ ] **Guardian trim band** set + tested against a simulated price crash (deterministic MA-distance band + trim sizing; no leverage/registry to read).
- [ ] **DeepBook spot wiring verified:** live `Pool<SUI,USDC>` + DEEP-fee path (or a gasless/whitelisted-pool path) confirmed against the pinned SDK; `min_out` slippage bounds enforced by the deterministic core.
- [ ] **Resolve `@mysten/sui` v1-vs-v2 Pyth conflict** via Bun overrides; verify signing/serialization end-to-end.

**Operational**
- [ ] **Revocation runbook** — owner kills a mandate in one tx; verified live (total on both tiers).
- [ ] **Monitoring/alerts** on oracle staleness, mandate-abort events, and per-asset `supplied` vs on-chain NAVI position drift.
- [ ] **Per-user sandbox size caps** during early mainnet — start small (DEGEN spot is the higher-variance tier).

---

### Bottom line

Suize's safety is **structural, not procedural**: the Move VM enforces a per-user, budget-capped, time-boxed, revocable cage the agent physically cannot exceed on **either** MVP tier — that's why we can be autonomous where a confirm-button wallet can't. Every Sui exploit of the past year maps to a design choice — **Cetus → minimal own-math; Scallop → expiry kills stale authority + verified package ids; Volo → scoped non-privileged keys + enclave; Aftermath → validated mandate parameters; DeepBook May 9 → we excluded the un-cageable margin venue entirely.** And we are honest about the rest: **no audit yet, real protocol calls not yet run against live venues, a narrow NAVI-supply destination caveat (§1.6), a reactive (not clairvoyant) guardian, and an oracle we don't control.** The cage caps the loss to the sandbox — never the main wallet — but it does not guarantee the sandbox is preserved. That is the promise we can actually keep.
