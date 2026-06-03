# Suize Wallet — Product Spec (the single source of truth)

> **The wallet's vision, dual-dial, the cage, scope, and build status — one doc.** Pitch, branding, and UX are folded in (§14–§16). Deep technical detail lives in `ARCHITECTURE.md`; the threat model + exploit history + pre-mainnet gate live in `SECURITY.md`; the repo-wide overview lives in the root `CLAUDE.md`. Reference, don't redeclare.

> **Suize** = the **10x-autonomous consumer wallet** built for the Sui **Agentic Web** hackathon track (2-week build, playing to win) and intended as a real product after. It **out-autonomies the favored consumer-wallet incumbent ("Audric") by doing what they do, far better — genuine autonomy.** The soul is **calibrated honesty**: it never over-promises, and every reassurance must be true.

> **Build status (2026-06-02):** the Move package `suize` (`packages/move-wallet`) is **✅ built & tested — 65/65 green** across **four** modules: `mandate` (11) + `vault` (12) — the cage — **and the two adapters** `swap` (18, DeepBook spot SUI↔USDC) + `navi` (24, NAVI lend-as-is). ~47 of the 65 are `#[expected_failure]` refusal proofs. The gate + custody round-trips are fully unit-tested; the real DeepBook/NAVI calls are compile-verified behind a seam and need a live integration run (ARCHITECTURE §2). **PLANNED:** the guardian throttle, force-unwind, and the off-chain agent (a stub in `services/backend/agent`). SDK pins, the monorepo layout, the signing model, and the agent architecture are **locked** (see §3a, §4a, §7).

> **FINAL ARCHITECTURE — the cage is PURE.** DEGEN = **spot trading SUI↔USDC** on signals (contrarian sentiment + distance-from-MA), fully VM-caged via DeepBook **swaps** (the cageable Coin-in/Coin-out path). **No margin/leverage in the MVP:** DeepBook's `MarginManager` is a sender-owned shared object (`assert ctx.sender()==owner`; no `store`, no capability, no revoke — confirmed from source), so it **cannot be VM-caged** and would hand the agent un-caged custody. Margin → **roadmap only** (§12), labeled honestly as *"off-chain-policy-governed, NOT VM-caged."* The kill-move + revoke cover the **entire product, zero asterisk.**

> **Network: TESTNET** for the hackathon (one `NETWORK` const in `@suize/shared`; no real funds behind unaudited code). The testnet→mainnet flip is gated by `docs/MAINNET_CHECKLIST.md`.

---

## 1. Vision & Positioning (v3 — the autonomy pivot)

Most "AI wallet" pitches collapse under one question: *why would I hand an AI my money?* Suize's answer is to **never ask that question** — split the wallet into two balances and let the user dedicate only a conscious sandbox of risk capital to an autonomous agent leashed by an on-chain Move object it physically cannot escape.

**The 10x = AUTONOMY.** Audric's entire UX is **"Ask. Confirm. Done"** — every action needs a human tap, so it's a chatbot with confirm buttons that **can't act while you sleep.** **Suize OPERATES ITSELF 24/7.** We compete **head-on as a consumer wallet** and out-agentic the favored incumbent on the one axis the track is literally named after ("Agentic Web") — a **bias-proof axis**, because favoritism can't make a confirm-button app more agentic than an autonomous one.

**The cage is the ENABLER, not the pitch.** The VM-enforced Move mandate is **why** we can go fully autonomous when Audric structurally can't: it guarantees the agent can't touch the user's savings or break the rules, so **we don't need Audric's taps.** The pitch is autonomy + safety + the experience.

**What we are NOT:** not a payments neobank (Audric's turf), not a "beat-the-market" robo-advisor, and **NOT** repositioning as infra / an "agent-authority primitive." That primitive play is **crowded** (EIP-7702, Cobo, the guardrails race), Audric already bundles guardrails, and a standalone primitive doesn't beat a consumer wallet. We win as a **consumer wallet, on autonomy.**

**The one insight that makes it work:** the two-balance sandbox. You dedicate a sandbox, not your savings. That makes the trust ask *tractable* — and the cage makes the autonomy *safe*.

---

## 2. The Two-Balance Model

The wallet deliberately separates two value props that were in tension — "keep my money safe" and "grow my money with AI" — by holding two distinct balances.

| | **Main Vault** | **Agent Sandbox** |
|---|---|---|
| Whose | The user's money. Safe. | A portion the user consciously dedicates as risk capital |
| Mental model | The hard safety wall | "Here's $200, AI, go run it" — paper trading, but *real* |
| Agent access | **Never.** The agent cannot touch it. | The agent **works this balance 24/7**, bounded by the mandate |
| MVP behavior | Simply *held* | Actively, **autonomously** worked by the agent |
| Guardian | None needed (untouched) | In-scope (degen position-risk-throttle — trims to USDC) |

The sandbox being *real* (real funds, real on-chain moves) is what makes the trust ask tractable: it's the paper-trading mental model with real stakes, but bounded stakes the user chose — and **caged so the agent can run itself without a human in the loop.**

### Three "can't betray you" guarantees (all VM-enforced)
1. **Can't overspend** — every move is mandate-budget-capped (the 5 asserts).
2. **Can't touch savings** — the main vault holds no object reference the agent can reach.
3. **Can't swap your asset away (asset-scope)** — SAFE lends the user's deposited asset **as-is** on NAVI and **cannot** autonomously swap it for something else; DEGEN trades **SUI/USDC only.** (The cross-asset *upgrade* swap is **proposed**, never autonomous — §4a.)

### The Dual-Dial (the product's core interaction)

The user picks a **RISK LEVEL**; the agent autopilots a risk-tiered mandate. The dial = **which mandate is minted** (scope + caps + position sizing) — the **SAME agent loop, different bounds. NOT double the build.**

| Dial | Scope | Vault | Caps | Framing |
|---|---|---|---|---|
| **SAFE** | **lend-as-is** (NAVI supply/withdraw) | **multi-asset** (WAL/SUI/USDC/DEEP/…, each lent as-is) | tight | Effortless, low-risk, slow growth — *"park it."* |
| **DEGEN** | **NAVI + DeepBook spot swap** (SUI↔USDC) | **SUI/USDC only** | higher, position-sized | *"Let it rip with your play money; the chain guarantees it stops at the sandbox wall."* **No margin, no leverage.** |

**Honest framing of degen** = **"responsible degen / permission to gamble safely,"** **NOT** an alpha or market-beating claim. DEGEN is **spot SUI↔USDC trading on signals**, fully VM-caged via the swap path. The propose/MOVE wall (§4a) still hard-caps every amount, position size, and slippage — even here.

---

## 3. The Mandate (the cage) — the product's spine

The agent's authority is a **Move object** (the "mandate" / the agent's allowance). It carries:

- **Budget cap** — the sandbox ceiling
- **Allowed-protocol scope** — which protocols the agent may touch
- **Expiry** — after which the agent cannot act
- **Owner-revoke flag** — the kill switch

**Enforced at the Move VM level.** The agent is a **scoped keypair** that can only act *through functions that assert against this object*. It physically **cannot**:

- exceed its sandbox budget,
- touch a protocol outside scope,
- act after expiry, or
- be "jailbroken" out of its limits —

because Move's object model makes the over-limit transaction **impossible to construct**, not because a backend says "no." This is the **"why Sui makes AI safer"** thesis and our most novel/defensible asset.

### `mandate.move` — ✅ BUILT & TESTED (11/11 unit tests)

Lives at `packages/move-wallet/sources/mandate.move`. Shipped shape:

- **`Mandate`** — a **shared** object: `{ owner: address, budget_remaining: u64, allowed_scope: VecSet<u8>, expiry_ms: u64, allow_listed: VecSet<ID> }`.
- **`AgentCap`** — **key-only, non-transferable**: `{ mandate_id: ID }`. The agent holds it; it can't be transferred off the agent.
- **Owner-ADDRESS auth** (deliberately **not an `OwnerCap`**) — chosen because **zkLogin gives a stable owner address, so there's nothing to phish.** (This supersedes the earlier "model on `OwnerCap`" note.)
- **`consume_budget(mandate, cap, scope_tag, amount, clock)`** runs **5 asserts** → (1) cap↔mandate match · (2) cap allow-listed · (3) not expired · (4) `scope_tag` in scope · (5) within budget → then **debits the budget + emits `AgentActed`.**
- **Events:** `MandateCreated` · `AgentCapIssued` · `AgentCapRevoked` · `BudgetToppedUp` · `AgentActed` — these **are the on-chain activity-log signal the UI reads** (see §5, the hero log).
- **Read accessors** exposed for `devInspect`.

**Protocol-agnostic by design:** `allowed_scope` is an opaque `VecSet<u8>`; the **tag→protocol mapping is an off-chain convention**, so adapter swaps need **NO module change** — the built code, the 5 asserts, and the events are unchanged. This is also what lets the **dual-dial** mint different scope sets from the same module.

**Scope-tag convention (FINAL, locked):** `scope_tag` is **protocol + ACTION** granularity →

| Tag | Meaning | SAFE dial | DEGEN dial |
|---|---|---|---|
| `0` | NAVI **supply** | ✅ | ✅ |
| `1` | NAVI **withdraw** | ✅ | ✅ |
| `2` | DeepBook **spot swap** (SUI↔USDC) | — | ✅ |

SAFE mints `{0,1}` + tight caps (lend-as-is, no swap); DEGEN mints `{0,1,2}` + higher caps (SUI↔USDC spot). **No margin tags** — margin is un-cageable (sender-owned `MarginManager`), so it's roadmap-only (§12), not a scope the cage can govern.

---

## 3a. The Vault, the Adapters & the Guardian (Move modules)

### `vault.move` — ✅ BUILT & TESTED (12/12 unit tests) · `packages/move-wallet/sources/vault.move`
Per-user `Vault<T>` (`idle` + `deployed` `Balance<T>`, **never pooled**). Owner deposit / idle-withdraw; the **tight cage** `agent_consume` wraps `consume_budget` so the **budget debit is ATOMIC with the real coin movement** (one PTB, no way to move coins without debiting the mandate; funds never leave Move custody — the adapters below specialize the inner move with the real protocol call).

### `swap.move` (DeepBook spot adapter) — ✅ BUILT & TESTED (18 tests) · `packages/move-wallet/sources/swap.move`
The DEGEN dial's execution leg: **spot SUI↔USDC** via DeepBook v3 (`swap_exact_base_for_quote` / quote-for-base), `min_out`-gated. Because a swap is irreducibly two-sided (and DeepBook fees are paid in a third coin, `DEEP`), it uses a **`SwapVault<Base, Quote>`** that mirrors DeepBook's own `Pool<Base, Quote>` shape — a `base` pot + a `quote` pot + a `deep` fee pot, all `Balance<_>` in Move custody, all bound to **one** `Mandate`. `agent_swap_*` runs the same tight-cage pattern (own-mandate check → the 5 asserts → protocol round-trip → event), splits the input out of the vault, threads the DEEP fee, and **re-joins all three returned coins** straight back into the vault — **no `Coin` is ever returned to the caller**, so the agent has nothing to redirect. The gate + 3-coin custody round-trip are unit-tested against a same-shaped stub pool; the real `pool::swap_exact_*` call is compile-verified behind a `public(package)` seam and needs a live `Pool` run (ARCHITECTURE §2.4).

### `navi.move` (NAVI lending adapter) — ✅ BUILT & TESTED (24 tests) · `packages/move-wallet/sources/navi.move`
The SAFE dial's execution leg: supplies the user's deposited asset **AS-IS** to NAVI and redeems it back — **never swaps one asset for another** (asset-scope). A **`MultiAssetVault`** holds the SAFE tier's many assets (`idle: Bag` keyed by coin `TypeName`; `supplied: Bag` mirrors per-asset principal out at NAVI) and custodies NAVI's `AccountCap` in a generic `Option<AccountCapT: key+store>` slot, so the lending position belongs to the vault, not the agent. **Honest cage nuance (FLAGGED in-source):** because NAVI's package can't be imported as a Move dependency (old-style-vs-new-style `Move.toml` collision; details in `navi.move`'s header), the adapter uses the **PTB-release model** — the gate is fully VM-enforced on both legs, but the *destination* of the moved coin differs by leg: the **supply** leg (scope 0) is the **looser** leg (the gate runs and caps the amount, but the released `Coin` is handed to NAVI by the agent's PTB, so its destination isn't VM-enforced for that brief span), while the **withdraw** leg (scope 1) is **tight** — it returns a `WithdrawTicket` **hot potato** (no abilities), so the tx *cannot complete* without re-absorbing the redeemed coin back into the vault. The gate + custody are unit-tested against stub NAVI entrypoints; the real `incentive_v3` deposit/withdraw needs a live run (ARCHITECTURE §2.3).

**Vault asset model (FINAL):** the **SAFE** vault is **multi-asset** (the `navi.move` `MultiAssetVault`, lends each delegated asset as-is); the **DEGEN** vault is **SUI/USDC only** (the `swap.move` `SwapVault`) — on deposit of any other asset the UI prompts *"this vault holds SUI or USDC — swap now?"*.

- **STUBBED for the hackathon:** share-token accounting + the high-water-mark performance fee. *Why:* the HWM fee earns **zero demo points** (gauntlet), and **no audited first-party Sui vault exists** — we port ERC-4626 + OpenZeppelin inflation guards later and **audit before real funds**.
- **PLANNED — force-unwind:** the shipped owner exits are idle-only; a **force-unwind** owner exit (unwind the NAVI leg + return everything, even mid-flight) is the remaining Move work. *(Resolved: force-unwind, not idle-only-plus-wait. Much simpler with no margin leg to cancel→repay→withdraw — ARCHITECTURE §2.7.)*

### Guardian — PLANNED · **position-risk-throttle** (supersedes the old "watch protocol distress" / "liquidation defense" framing)
A **position-risk-throttle on the degen sandbox**, not a protocol-distress monitor and **not** liquidation-defense (there's no leverage). Reactive protocol-distress monitoring is **CUT** — it's **un-frontrunnable theater + a demo puppet** (an off-camera knob to fake an "event").

- **Honest role:** the **MA-distance signal** (§4a) flags an overextended SUI position → the agent autonomously **trims it back to USDC** (deterministically sized, **VM-caged via the swap path**, scope_tag `2`) → logged; owner can override.
- **Why it's honest:** it **fires for real, on demand** (no off-camera knob) and ticks sub-track **#1** (live feed + AI risk score + autonomous on-chain action + human override) honestly (see §6, §8).
- **Pricing path:** **Pyth-through-Hermes off-chain** for the freshness gate; minimize on-chain Pyth (§7).

---

## 4. What the Agent Does (the honest profit edge)

The agent **operates itself 24/7**, capturing **yield + incentives + rotations** the user won't chase:

- lend-as-is supply (**NAVI** — the **MVP lending leg**, the SAFE dial; **low single-digit %** USDC, **plumbing not the pitch**),
- points / airdrop farming,
- faster rebalancing / auto-compounding,
- (DEGEN dial) **spot trading SUI↔USDC on signals** via DeepBook swaps (`minOut`-gated) — **no margin, no leverage,**
- the **propose-swap optimization** — a quantified cross-asset yield-upgrade card the user taps to accept (§4a).

It's tiered by the **dual-dial** the user sets (SAFE → DEGEN). **No price prediction** — ever; **no leverage**; **magnitude is always mandate-capped** (§4a).

### Critical honesty constraint (the soul)

| We DO NOT claim | We DO deliver |
|---|---|
| "AI beats the market" / guaranteed alpha — the hardest, least-honest claim in finance | **Genuine 24/7 autonomy** — the agent acts while you sleep (the bias-proof 10x over Audric's confirm-button UX) |
| The APY as the pitch — NAVI supply is low single-digit % and **Audric advertises the same NAVI yield**, so % is a tie we lose | **"Diligence at machine speed"** + the **experience** + the **hard safety wall** — value is autonomy + safety, not the return |
| A backtested track record (for the hackathon) | **The mechanism, demoed live**: the **kill-move** (§9) — jailbreak → VM aborts → revoke → next move reverts |

The honest framing: a **modest, genuinely-positive edge over lazy holding** — not magic. Degen = **"gamble safely,"** not "win."

---

## 4a. How the Brain Works (the propose/move wall)

The agent's architecture is what makes calibrated honesty **enforceable in code**, not just a promise.

### The propose/MOVE wall (the soul, in code — governs ALL money movement, **even DEGEN mode**)
- A **deterministic core owns EVERY number** — every amount, **position sizing**, route, slippage, execution — and they're **mandate-capped**.
- **The two DEGEN signals** — **contrarian X/Twitter sentiment** + **distance-from-moving-average** (below) — **only inform STRATEGY/SIDE selection / ranking / proposals — NEVER the magnitude.** An **LLM only ranks ties and writes the human-readable rationale.** Those rationales **ARE the UX voice** — the log entries, the notifications.
- **The LLM/signals NEVER emit a number (or magnitude) that lands in a transaction** — including the optimization-card dollar figure, which is computed deterministically (below). The cage **hard-caps downside regardless of what any model "thinks."**

This dodges the **"algorithmic resonance"** cascade (an LLM rationalizing ever-larger moves) via a **`MIN_IMPROVEMENT_THRESHOLD`** (hysteresis): the agent only rotates when the net-of-cost gain clears a floor.
**Demo plan:** ship **templated rationale** first; **live LLM is polish** — and it stays **OFF the live critical path** on stage (§9).

### The two DEGEN signals (inform proposals; never the money)
1. **Contrarian X/Twitter sentiment** — euphoria ⇒ lean sell/de-risk; dead-calm + bottoming ⇒ lean buy. **PROPOSE/NARRATE side ONLY**, never a direct tweet→trade trigger (the AI-herd cascade trap, §12). An honest disciplined heuristic, **not** alpha.
2. **Distance-from-moving-average** across timeframes + the large-frame trend — far from MA ⇒ overextended/riskier ⇒ smaller size / trim; also the guardian's pre-emptive trim-to-USDC trigger.

Both feed proposals; **deterministic sizing + the mandate govern every coin.**

### Autonomous vs Proposed (the propose/move wall, applied to assets)
- **AUTONOMOUS (no tap):** lend-as-is (SAFE) / trade SUI↔USDC (DEGEN). Fully VM-caged.
- **PROPOSED (needs the user's tap):** swap-to-a-better-yielding-asset optimization — moving the user's asset across protocols never happens without their tap.

### Optimization-advice engine (the "agent proposes upgrades" idle-game loop, made concrete)
Each cycle the agent **SENSEs** (live NAVI APYs + utilization per asset + the user's holdings) → **SCOREs** (deterministic cross-asset yield delta) → **PROPOSEs** a quantified upgrade card, e.g. *"$DEEP yields X — that's $545/yr more than your WAL; swap & stake?"*. **The dollar figure is computed DETERMINISTICALLY from live APYs; the LLM only phrases it (never invents the number).** The user's tap accepts.

### Per-cycle loop
`SENSE` (poll **live NAVI APYs + pool utilization per asset** + user holdings + DeepBook depth; pull the two degen signals — *deterministic*) →
`SCORE` (net-APY-after-cost + cross-asset yield delta + per-position risk via MA-distance — *deterministic*) →
`RANK + PROPOSE` (**LLM + the two signals rank STRATEGY/SIDE only**, advisory — *never magnitude*) →
`CONSTRAIN` (the dial's risk tier + mandate caps + hysteresis `MIN_IMPROVEMENT_THRESHOLD` — *deterministic*) →
`BUILD PTB` (amounts + position sizing from the math, gated by the mandate) →
`SIMULATE` (`dryRun`/`devInspect` — assert **balance + health deltas**, not just "didn't revert") →
`GATE` (circuit breakers + mandate precheck) →
`SIGN` (scoped agent key) →
`LOG` (decision + rationale + sim + tx digest → **the hero log**).

### Honest profitability engine
NAVI lend-as-is supply + incentive/airdrop capture + (degen) **SUI↔USDC spot trading on signals** (DeepBook `minOut`) + auto-compounding + the propose-swap optimization. **NO price prediction; NO leverage; magnitude always mandate-capped.**

### Safety layers
The on-chain mandate is the **trustless floor**; everything below is **belt-and-suspenders**:
simulate-before-execute · circuit breakers (financial-velocity / repeat-call / max-iterations / confidence-floor) · position + slippage caps · HITL thresholds · rate limits · owner kill-switch (revoke) · anti-resonance jitter.

### USE vs BUILD vs SKIP
| | |
|---|---|
| **USE** | `@naviprotocol/lending` · `@mysten/deepbook-v3` (spot-swap surface) · (post-MVP) Suilend as a 2nd adapter · Turnkey (prod) · the **MCP tool pattern** |
| **BUILD** | the **deterministic orchestrator** + the Move `mandate` / `vault` (✅) + adapters + the guardian throttle + force-unwind |
| **SKIP** | **ElizaOS + community Sui agent kits as dependencies** — LLM-loop-first + env-var keys are the **wrong defaults for money**; **margin/leverage** (un-cageable — roadmap only, §12); any **"tweet → trade" trigger** (§12) |

---

## 5. UX (idle-game — *watch your machine hustle*)

**Vibe shift (v3):** from "Zen meditation app" → **"watch your machine hustle."** Keep the **idle-game loop + the decision LOG as the hero surface**; **lose the tranquilizer tone.** The real user is the **"responsible degen"** (crypto-curious, wants autonomous upside with a hard safety wall) — **not** the passive-normie-wants-safe-yield, which is an **empty set.**

**Aesthetic:** Revolut-clean meets an idle/incremental game (Universal Paperclips, Cookie Clicker, Factorio) — but the energy is **a machine working for you in real time**, not a meditation timer.

### Home
Two numbers — **main balance** (the safe wall) + **agent sandbox balance** (moving) — plus the dial state and a status line: **"agent active · last move Xs ago."** The agent **runs itself**; it speaks via push + the log.

### The Log — the hero surface
An **append-only feed** of every agent decision, proposal, and move. It does **three jobs on one surface**:

1. the satisfying **idle-game event feed** (your machine, hustling),
2. the trust **"show-your-work" receipts**,
3. the hackathon-required **on-chain activity log**.

Don't fragment it.

### Onboarding
**zkLogin via Enoki** — seedless Google login, no seed phrase. (Not raw zkLogin.)

### The "intent" — structured, NOT a chatbot, and the agent then AUTOPILOTS
We **explicitly dropped** natural-language "send X to Y." The user sets the dial **once**, then the agent runs unattended:

> **"here's my sandbox amount + RISK LEVEL, go"** → compiled to the **mandate via a PTB** → **human-readable preview** → **one confirm** → **agent operates 24/7** within the bounds.

**No per-action confirm tap** — that's Audric's cage, not ours.

### Notifications / "proposing upgrades"
Two voices, one log:
- **Autonomous moves** — the agent **narrates what it already did** (within the cage): *"trimmed 0.4 SUI → USDC · euphoria spike · within mandate · tap for the receipt."* The user reviews, not approves-each-step.
- **Proposed upgrades** — the optimization engine surfaces a **quantified, tappable card**: *"$DEEP yields X — that's $545/yr more than your WAL; swap & stake?"* (figure computed deterministically; LLM only phrases it). Cross-asset swaps move only on the user's tap.

**Buttons on top, the engine underneath, no chat.**

---

## 6. The Guardian (a position-risk-throttle)

Scope: **the degen sandbox only.** The main vault is untouched (and SAFE = NAVI supply has no position risk), so neither needs a guardian.

**What it is:** a **position-risk-throttle**, **NOT** liquidation-defense (there's no leverage) and **NOT** protocol-distress monitoring (KILLED — watching NAVI utilization / outflow limiters / TVL drain is **un-frontrunnable theater** + a **demo puppet** needing an off-camera knob). It **fires for real, on demand.**

**Honest, limited role:** the **MA-distance signal** flags an **overextended SUI position** → the agent autonomously **trims it back to USDC** (deterministically sized, **VM-caged via the swap path**, scope_tag `2`) until the position is back inside the tier's safe band. Logged; owner can override. Inputs:

- **distance-from-moving-average** across timeframes (the overextension trigger),
- **mandate budget / expiry headroom** (how close to the cage walls),
- **exit-liquidity via DeepBook depth** (can it actually get out),
- **oracle-freshness-as-a-gate** (stale price ⇒ don't act).

**Pricing path (locked):** **Pyth-through-Hermes off-chain** for the freshness gate; we **minimize on-chain Pyth** (see §7).

### Honesty constraint
Do **not** pitch the guardian as "dodges the next exploit." Instant logic-bug drains (e.g. **Cetus: $223M in 15 min**) are **un-frontrunnable** by a reactive loop. The guardian's honest value is a **position-risk-throttle on our own SUI exposure** (trim to USDC), not exploit clairvoyance and not liquidation-defense.

> **Why this is the honest sub-track #1:** live feed (DeepBook depth + Pyth freshness + the MA signal) + a visible **AI risk score** + an **autonomous on-chain trim** + **owner override** — all firing for real, no off-camera knob (see §8).

> **TBD:** exact MA-distance band + trim sizing + the tier's safe target. (Module role + pricing path locked — §3a.)

---

## 7. Architecture & Tech Stack

> Research has landed (2026-05-31). SDK pins, monorepo layout, signing model, and Move conventions are now **locked** (below). Remaining unknowns are explicitly marked **TBD**.

| Layer | Choice | Notes |
|---|---|---|
| **Chain** | Sui | **testnet** for the hackathon |
| **Auth** | **zkLogin via Enoki** | `registerEnokiWallets` + `@mysten/dapp-kit`. Seedless Google, no seed phrase. **Not raw zkLogin.** The stable owner address it yields drives the **owner-ADDRESS auth** in `mandate.move`. |
| **Frontend** | React + `@mysten/dapp-kit` | **Vite.** |
| **Transactions** | `@mysten/sui` `Transaction` (PTBs) | `dryRunTransactionBlock` → the preview; `devInspectTransactionBlock` → guardian/read view-function checks |
| **Lending (the SAFE dial)** | **NAVI** (new `@naviprotocol/lending` SDK) = the **MVP lending leg** | SAFE = **lend-as-is, multi-asset** (low single-digit % USDC — **plumbing, not the pitch**). Behind a thin **`LendingAdapter`** so a 2nd adapter (Suilend) can layer **post-MVP**. |
| **DEX (the DEGEN dial)** | **DeepBook v3** (`@mysten/deepbook-v3`) | **Spot swaps SUI↔USDC** (`minOut`-gated) — the cageable Coin-in/Coin-out path; this **is** the degen execution leg (**no margin**). Also powers the guardian's trim-to-USDC + the propose-swap optimization + the **exit-liquidity (depth)** read. |
| **Oracle** | **Pyth on Sui** | **Hermes** off-chain for the guardian's **oracle-freshness gate**. **Minimize on-chain Pyth** — likely **drop the direct `pyth-sui-js` dep** (see the Pyth landmine below). Never hardcode the Pyth package address. |
| **Signing** | **Hackathon:** a **simple scoped agent keypair** (env-isolated, separate from the owner). **Production:** **Turnkey** (AWS Nitro enclave + policy engine + `signRawPayload`). | The leash lives in **Move** (the `Mandate`), **not in a vendor** — keypair vs. Turnkey never weakens the trustless floor. Turnkey is the documented **post-hackathon** path. |
| **Move** | `mandate` + `vault` + `swap` + `navi` (✅ built, **65/65**) — the cage + both adapters; guardian throttle + force-unwind PLANNED | The package `suize` at `packages/move-wallet` (`edition = "2024"`), `Move.toml` pinned `framework/testnet`. Share-token accounting + HWM perf fee **STUBBED** for the hackathon. See §3 / §3a / §10. |
| **Logs** | Sui **events** (live, free) for the activity log | The `mandate` events **are** the log signal. **Optional** Walrus (via **publisher/aggregator**, not the raw SDK) for bulky AI-reasoning blobs — **checkbox, not critical path**. |

### MVP protocol scope (locked)
**NAVI (lend-as-is) + DeepBook v3 (spot swap SUI↔USDC) ONLY.** Maps to the dual-dial: SAFE = NAVI lend-as-is (multi-asset); DEGEN = SUI↔USDC spot trading via DeepBook swap. **No margin/leverage** — the `MarginManager` is un-cageable (sender-owned), so margin is roadmap-only (§12). Everything else is post-MVP.

**Explicitly skip:** Seal, raw zkLogin, raw Walrus SDK, natural-language intent engine, **ElizaOS + community Sui agent kits as dependencies**, **margin/leverage** (roadmap only), any **"tweet → trade" trigger** (§12).

### Architecture principles
1. **The Move mandate is the one non-negotiable primitive** — the VM-enforced cage that is the **autonomy enabler** (see §1, §3).
2. **The propose/MOVE wall governs ALL money movement — even DEGEN.** Deterministic core owns every number + position sizing; signals/LLM rank **strategy only, never magnitude**; the cage hard-caps downside (see §4a). This is what makes calibrated honesty *enforceable*.
3. **Simplicity-first / YAGNI.** The dual-dial is the SAME loop with different bounds, not a 2nd build. Add complexity when a real user hits a real limit.
4. **The agent AUTOPILOTS — the user sets the dial, not every action.** No per-action confirm tap (that's Audric's cage). Buttons + engine, no chat.
5. **One log surface, three jobs.** Don't fragment it.

### Monorepo layout (locked — Bun workspaces)

The wallet lives inside the Suize monorepo (root `CLAUDE.md`). Its pieces:

| Path | Role |
|---|---|
| `packages/move-wallet` | The Move package `suize` (`edition = "2024"`). `mandate` ✅ + `vault` ✅ + `swap` ✅ + `navi` ✅ (65/65); guardian throttle + force-unwind next. |
| `apps/wallet` | `@suize/wallet` — React + `@mysten/dapp-kit`, **Vite**. The Zen UI. |
| `services/backend/agent` | The off-chain brain. **Holds the scoped agent key — NEVER in the frontend.** Currently a STUB. |
| `packages/shared` | `@suize/shared` — network + package ids + sponsor wire types, **single source of truth.** |
| `services/backend` | The unified Bun backend (sponsor + waitlist + agent); the sponsor gas-sponsors the wallet's Move targets once `move-wallet` is published. |

**ESM-only everywhere** (`"type": "module"`). Move `edition = "2024"`. A deploy script writes the published package id + shared object ids into `@suize/shared` — never hand-copied.

### Version pins (2026-05-31)
`@mysten/sui` **2.17** · `@mysten/dapp-kit` **1.0.6** · `@mysten/enoki` **1.0.8** · `@naviprotocol/lending` **1.4.6** · `@mysten/deepbook-v3` **1.4.1** · `@suilend/sdk` **3.0.3** *(optional, post-MVP 2nd adapter)* · `@pythnetwork/pyth-sui-js` **3.0.0**.

### The Pyth landmine (read before installing)
- `pyth-sui-js@3` still depends on `@mysten/sui` **v1** while our stack is **v2**. → **Force a single `@mysten/sui` via Bun's workspace `overrides`** (`overrides` / `resolutions` in the relevant `package.json`). (If the Suilend adapter lands post-MVP, note it pins *yet another* Pyth.)
- **Minimize on-chain Pyth:** Hermes off-chain for the guardian's freshness gate. **Likely drop the direct `pyth-sui-js` dependency entirely.**
- **API renames to watch:** `TransactionBlock` → `Transaction`; `signAndExecuteTransactionBlock` → `signAndExecuteTransaction`; `@mysten/sui.js` → `@mysten/sui`.

---

## 8. Hackathon Sub-Track Mapping + Why Sui

The **Agentic Web** track has three sub-tracks. We **center on #2** and keep **thin** versions of #1 and #3.

> **OPEN QUESTION:** does the track require **all three** sub-tracks, or allow **pick-some**? Confirm with the rules.

| Sub-track | Our coverage | What satisfies it |
|---|---|---|
| **#2 — Autonomous Agent Wallet** (THE CENTERPIECE) | Full — this *is* the product, and the **bias-proof axis we beat Audric on** | dedicated budget (**sandbox**) · self-enforced ceiling (**VM-enforced mandate**, the 5 asserts) · **genuine 24/7 autonomy** (the agent runs itself, **no per-action tap**) · on-chain activity log (**`mandate` events + the hero log**) · owner revocation (**owner-address auth → `AgentCapRevoked`**). |
| **#1 — Risk Guardian** | Ticked **honestly** by the **position-risk-throttle** (§6) | live feed (**DeepBook depth + Pyth freshness + the MA signal**) + a visible **AI risk score on our own SUI position** + **autonomous on-chain trim-to-USDC** + **owner override** — all firing for real, **no off-camera knob.** |
| **#3 — Intent Engine** | Thin | **structured intent** (sandbox + **dial**) → **PTB** → **human-readable preview** → **one confirm**, then autopilot. **NOT** natural language. |

### Why Sui (the anti-"generic wrapper" thesis)

| Sui primitive | What it buys us |
|---|---|
| **zkLogin** | seedless onboarding |
| **Move objects** | the VM-enforced mandate cage — the leash you can't prompt-inject, **and the autonomy enabler** (why we can drop Audric's confirm taps) |
| **PTBs** | atomic execution + readable preview |
| **DeepBook** | the cageable spot-swap path (SUI↔USDC, the degen execution leg) + the guardian's trim-to-USDC + exit-liquidity (depth) read |
| **Pyth** | the guardian's oracle-freshness gate |
| **Walrus** | logs (optional) |

This is what makes Suize *not* a generic LLM-over-an-API wrapper.

---

## 9. The Demo (deterministic, ~3 min — the kill-move is the centerpiece)

A scripted, deterministic flow. The **un-ignorable beat** for the judge panel (15 Mysten engineers incl. **Sam Blackshear**, creator of Move) is the **kill-move** — it answers *"what stops the AI when it's wrong?"* and is the **trust unlock** that makes shipping full autonomy safe.

1. **zkLogin Google login.**
2. User **dedicates a sandbox amount** + **picks a dial (SAFE/DEGEN).**
3. The agent **autonomously makes a real move** (no human tap): **DeepBook swap SUI→USDC → NAVI supply.** The **log populates on-chain** — *the machine, hustling.*
4. **The kill-move (REHEARSED CENTERPIECE):** **jailbreak the agent live → the Move VM aborts the theft on-chain → show the FAILED tx hash → then REVOKE → the agent's next move reverts.** The cage is real; that's *why* autonomy is safe. **Now whole-product** — with no margin leg, this covers **both tiers, zero asterisk**, and needs only `mandate.move` + `vault.move` (no DeepBook dependency to break).
5. *(if time)* The **guardian position-risk-throttle** fires for real — the MA-distance signal flags an overextended SUI position and the agent **auto-trims it back to USDC** on a genuine breach (**no off-camera knob**), logged with the impact.

### Demo cuts (de-risk the live run)
- **LLM narrator OFF the live critical path** — use a **deterministic templated log** on stage; **live LLM is polish.**
- **Pre-stage ALL on-chain state.**
- The **kill-move (jailbreak-abort + revoke) is the rehearsed centerpiece** — drill it.

> **Favoritism is structural:** "Eman," who pitched Audric's thesis in Miami, = **Adeniyi Abiodun, co-founder/CPO of Mysten Labs.** So we **win on the technical/agentic axis**, never on consumer-payments polish — a confirm-button app can't out-score an autonomous one on "Agentic Web."

**Determinism is mandatory.** An **idempotent `setup.ts`** must:

- pre-fund **DEEP** for DeepBook fees,
- create a **fresh zkLogin session**,
- **pre-warm Pyth.**

> **Demo-state provisioning is the #1 risk.** Treat `setup.ts` as a first-class deliverable.

---

## 10. Monetization (footnote, not the pitch)

A **high-water-mark performance fee** on the **agent sandbox's PROFIT only**.

- For the hackathon this is a **one-line footnote, never the headline.**
- **Rate: TBD.** Research found **20% is double the falling incumbent** (Yearn = 10%) — **revisit the rate (likely 10%).**

---

## 11. The Gauntlet (why the design is what it is)

Five devil's-advocate agents stress-tested an earlier version. These lessons **shaped this design** — capture them so we don't regress:

| Don't | Because | Do instead |
|---|---|---|
| Claim AI alpha / guaranteed profit | Unprovable, liability | Pitch **"diligence at machine speed"**; degen = **"gamble safely"** |
| Pitch the fee as the headline | Thin economics, hidden-fee optics | One-line footnote only (§10) |
| Pretend the guardian dodges instant exploits | Un-frontrunnable (Cetus: $223M/15 min) | **Position-risk-throttle**: trim an overextended SUI position back to USDC on the MA signal, VM-caged via the swap path (§6) |
| Build natural-language "send from English" | Weak, unwanted | **Structured intent** only (§5) |
| Fight Audric on payments-neobank polish | Their turf — and favoritism is **structural** ("Eman" = Mysten CPO Adeniyi Abiodun) | **v3:** beat them on **AUTONOMY** — the bias-proof axis the track is named after (§1, §8) |

**The load-bearing insight:** the **two-balance sandbox** is what makes the trust ask tractable. **Protect it.** **(v3 corollary:** the cage is also the **autonomy enabler** — it's *why* we can drop Audric's confirm taps.)

---

## 12. Roadmap (post-MVP)

### Margin / leverage (DEGEN+) — explicitly OUT of the MVP
DeepBook native margin. **Cannot be VM-caged:** the `MarginManager` is a **sender-owned shared object** (`assert ctx.sender()==owner`; **no `store`, no capability, no revoke** — confirmed from source), so the agent — not a mandate the VM enforces — would be the custody authority. Shipping it would put **un-caged custody** in the agent's hands and break the whole-product kill-move.
- **If it ever ships it MUST be labeled honestly as "off-chain-policy-governed (Turnkey policy on the agent key), NOT VM-caged."** No "the chain stops it" claim on the margin leg.
- Keep the MVP cage **pure** (spot SUI↔USDC only). Margin is a deliberate, stated exclusion — not an oversight.

### Deeper signal feeds (the X/Twitter watcher)
Contrarian X/Twitter sentiment is **already an MVP DEGEN signal** (§4a.2) on the propose/narrate side; roadmap = richer feeds + more sources.
- **HONESTY GUARDRAIL (non-negotiable):** it stays **strictly on the PROPOSE/NARRATE side of the wall** — it **informs proposals + risk posture / side**, and is **NEVER a direct "tweet → trade" trigger.** That trigger is the **LLM-herd-trading resonance trap** that cascaded **~$400M in Feb 2026.**
- The **deterministic core + the mandate still govern ALL money movement** — sentiment can change *which* side ranks, **never the magnitude** (§4a).

### Other post-MVP
- **2nd `LendingAdapter`** (Suilend) behind the existing interface (§7).
- **Turnkey** signing for production (§7).
- **Share-token accounting + HWM performance fee** in `vault.move` — audited before real funds (§3a, §10).

---

## 13. Open Questions / To Revisit

**Resolved by research (now locked — see the sections):**
- ✅ Repo/project layout → Bun-workspace monorepo (§7; root `CLAUDE.md`).
- ✅ Agent architecture / signing model → the propose/move wall + scoped key (Turnkey for prod) (§4a, §7).
- ✅ Move module design (mandate shared, key-only caps, events schema, owner-address auth) → `mandate` + `vault` + the two adapters `swap` + `navi` **built, 65/65** (§3, §3a); guardian shape locked (§3a).
- ✅ **DEGEN venue** → **spot SUI↔USDC via DeepBook swaps** (cageable). Margin is un-cageable (sender-owned `MarginManager`) → roadmap only, "NOT VM-caged" (§12).
- ✅ SDK pins + Move 2024 conventions → (§7).
- ✅ **Positioning** → **10x-autonomous consumer wallet, beat Audric on autonomy** (the bias-proof axis) (§1).

**Still TBD:**
- **Vault unwind semantics** — funds already deployed in **NAVI** on owner withdraw/revoke: **force-unwind** chosen; `withdraw_idle` ships, full force-unwind PLANNED (§3a).
- **Degen sizing** — SUI↔USDC **position-size caps + slippage band** for the DEGEN mandate (SUI/USDC only; no margin) (§2, §4a).
- **Guardian thresholds** — exact MA-distance band + trim sizing + the tier's safe target (§6).
- **Performance fee rate** — revisit **20% → likely 10%** (stubbed for the hackathon regardless, §10).
- **Hackathon sub-track requirement** — all three required, or focus on **#2** allowed? (#1 now ticked honestly by the position-risk-throttle, §8).
- **Two TVL readouts** — product TVL (sum of all per-user vaults) + agentic/degen-vault TVL, **off-chain aggregation (NOT commingled funds)**, surfaced in-app.

---

## 14. Pitch, Branding & Polish-to-Win *(folded from PITCH)*

> The doc that decides whether the ~15-engineer Mysten judge panel (incl. **Sam Blackshear**, creator of Move, + the chief cryptographer) remembers us. Built for the Sui Overflow 2026 *Agentic Web* track. Playing to win.

### The one sentence
> **"Audric asks permission. Suize has a mandate."**

A *mandate* is a real on-chain object, it's the thing the incumbent structurally lacks, and "asks permission" is a precise, fair jab at *"Ask. Confirm. Done."* If the judges remember one line, make it this.

### The winning narrative (the wedge + the enabler)
The track is named **Agentic Web**; favoritism is structural ("Eman" who champions the incumbent's thesis = **Adeniyi Abiodun, Mysten co-founder/CPO** — strategy only, **never asserted on stage**). You don't beat structural favoritism on the axis the favorite owns (consumer-payments polish) — you beat it on the axis the favorite **structurally cannot win**, and the track is literally named after it:

> A confirm-button app **cannot be more agentic than an autonomous one.** It's a bias-proof axis.

The reason we *can* drop the confirm taps is the **on-chain Move mandate** — scoped + budget-capped + time-boxed + instantly revocable, **enforced by the Move VM**: an over-limit tx isn't "denied by a backend," it **aborts on-chain**. **The cage is the enabler, not the pitch.** We pitch *autonomy*; the cage is *why autonomy is safe to ship*. Frame Suize as the **autonomous completion** of the agentic-wallet thesis, not a fight against it.

**Discipline (enforce in every slide):** lead with autonomy + the on-chain abort + the failed-tx-hash; **show, don't claim** (click the failed tx, show `AgentCapRevoked`, show the refusal tests); **demote yield to plumbing** (never open on APY — it's a tie we lose); target the Move-author judges (speak to the VM, type system, abort semantics, capability objects); do **NOT** fight on payments or reposition as an "infra/guardrail primitive"; **calibrated honesty out loud** (§14, the honesty slide).

### Branding
- **Name:** **Suize = Sui + Zen** (pron. "suite"). The Zen isn't meditation-calm — it's **the calm of a machine that's handling it.**
- **Soul line:** **"Watch your machine hustle."** Big numbers, an almost-empty interface, the **decision LOG as the hero surface** — every line is a receipt (decision + rationale + simulation + tx digest).
- **Positioning:** **Responsible Degen** — *"permission to gamble safely."* Not a beat-the-market robo-advisor (never claim alpha), not a custodial yield farm (funds never leave Move custody). Dedicate play money; the chain caps the loss at the sandbox wall.
- **Visual system (locked, product-agnostic — full spec in `marketing/DIRECTION.md`):** the **Droplet** pixel-art mascot (canonical poses `hero`/`hello`/`rest`; render once, composite, don't redesign per asset); **blue-on-carbon** palette (never black/neon/warm; gold `#FACC15` is the only non-blue accent — "money happens here," used sparingly, ideally on the sandbox balance); **Space Grotesk** (display/UI) + **JetBrains Mono** (the log, tx digests, status chips — the mono log *is* the brand texture); tone = "receipts > vibes," numbers in every claim, no emojis except the droplet's flag. *(The `Droplet` component lives in `apps/landing/src/components/` — port the master PNG into the wallet UI; `apps/wallet` currently ships a clean inline-SVG stand-in, `TODO(brand)`.)*
- **Cover tagline:** **"Audric asks permission. Suize has a mandate."** Alternates for cards: *"It acts while you sleep. It can't act outside the cage." · "Dedicate play money. The chain holds the line." · "Watch your machine hustle."* **Avoid** anything claiming alpha, returns, or "world's first."

### The honesty slide (say it before they ask — the disarm)
One slide that pre-empts every adversarial question; on a panel with the Move author + chief cryptographer, listing your own threat model *earns* trust:
- **No alpha claims** — the agent doesn't beat the market; DEGEN = *"gamble safely."* The honest edge is **diligence at machine speed** + the experience, not the return.
- **Yield is plumbing** — low-single-digit NAVI supply, same as the incumbent. We don't compete on it.
- **The guardian is a position-risk-throttle**, not exploit-clairvoyance — it reacts to gradual, price-driven risk (DeepBook depth + MA-distance + Pyth freshness); it does **not** dodge instant logic-bug drains (Cetus ~$223M in ~15 min — un-frontrunnable).
- **The cage caps loss to the sandbox — not to zero** (DEGEN can still lose sandbox capital; markets move against a spot position) — and **never reaches the main wallet.** Per-user vaults = blast-radius containment; no commingled pool, ever.
- **No margin in the MVP** (un-cageable — `MarginManager` is address-owned; §12). The kill-move runs on the fully-VM-enforced mandate+vault path — **whole-product, zero asterisk.**
- **Signals inform, they never size** — a deterministic core owns every amount/route/size; the LLM only ranks + narrates (the log voice) and **never emits a tx amount.** Dodges the Feb-2026 AI-herd cascade dynamics (>$400M liquidated in 24h, with historical-data bots amplifying it in unfamiliar conditions).

> **Claims to keep honest (verified):** exploit figures — Cetus ~$223M, the DeepBook **margin** ~$239.7k undercollateralization (May 9 2026), the Feb-2026 cascade (>$400M/24h), ~7 Sui-linked exploits in ~12mo — are sourced (`SECURITY.md`). The "$400M LLM-herd cascade" is **not** a corroborated single named event — frame it as "the Feb-2026 liquidation cascade, with AI bots amplifying it," never a fabricated single-event stat.

### The demo (deterministic, ~3 min — the kill-move is the centerpiece)
The un-ignorable beat is the **kill-move**: it answers *"what stops the AI when it's wrong?"* with a **failed transaction hash you can click**, not a sentence.

1. **0:00–0:30** — Frame the category; show the two-balance UI (MAIN untouched / SANDBOX live).
2. **0:30–1:15** — The agent **acts autonomously** (a real `AgentActed` tx hits the log, no human tap). Point at the mandate: scope, budget, expiry, revoke. Line: *"65 tests; the suite mostly proves the cage refuses what it must."*
3. **1:15–2:15** — **KILL-MOVE.** Live jailbreak → agent tries to drain to an attacker / exceed budget → **Move VM aborts** → click the **failed tx hash** → then **revoke** → the agent's next move **reverts**. *Pause. Let it land.*
4. **2:15–2:50** — **Guardian position-trim save** *(if built)*: crash the staged price feed → MA-distance spikes → agent **auto-trims SUI→USDC on-chain** → exposure reduced. *(If not built: spend it on the per-user-cage / blast-radius story + the honesty slide. Never fake it with an off-camera knob.)*
5. **2:50–3:00** — Close on **"Watch your machine hustle"** + *"Audric asks permission. Suize has a mandate."*

> **The one un-fakeable proof (don't fumble it):** an over-budget action can fail at two layers — (A) the PTB **executes on-chain and `mandate`'s `assert!(amount <= budget_remaining, EOverBudget)` aborts it** → a real failed tx hash on the explorer (the gut-punch), or (B) the agent's own client-side guard catches it and never broadcasts → just a client error, indistinguishable from "our backend refused it" (the dud). **For the demo, deliberately bypass the client guard so the over-budget PTB IS submitted and aborts at the Move layer.** This path is **DeepBook-free** (mandate+vault only) — it can't be blocked by anything external. (Detail: `SECURITY.md` §1.2, §6.)

> **Pre-stage everything (zero live-chain roulette):** pre-deploy the package + a funded sandbox; pre-mint a SAFE and a DEGEN mandate; pre-stage the attacker address + the exact jailbreak prompt; pre-load explorer tabs (mandate object · the successful `AgentActed` · the failed jailbreak tx · `AgentCapRevoked`) one click each; have a **recorded backup** of the full arc; keep the **LLM narrator off the live critical path** (deterministic templated log on stage). **Demo-state provisioning is the #1 demo risk** — treat the setup script as a first-class deliverable.

---

## 15. UX — Design Law & the Zen Home *(folded from UX)*

> Owns the **surfaces the user touches**: onboarding, identity, funding, the home screen. Design law: **the machine does the work; the UI does almost nothing.** *(Current state: `apps/wallet` is a first visual cut — mock data, stubbed auth, real provider stack; see `apps/wallet/README.md`.)*

### Design law (read first)
| Principle | On screen |
|---|---|
| **The LOG is the hero** | Home is a live feed of what the agent just did, not a dashboard of charts. |
| **Two numbers, never more** | Main balance · sandbox balance. Everything else is one tap deeper. |
| **"Everything is good" is a state** | When nothing is wrong, the screen says so in plain language. Calm is default; alarm is the exception. |
| **Minimal taps to "go"** | ~5 taps from Google to a running agent — *honest about funding + sponsored gas (below).* |
| **Big numbers, empty space** | Whitespace is a feature. No 12-widget grid. |
| **Watch your machine hustle** | Register: *spectator-of-your-own-bot*, not meditation app. |
| **We never hold keys** | Every signing surface is zkLogin (Enoki, seedless) or the user's own wallet signing a publish tx. The copy says so. |
| **Three can't-betray-you guarantees** | Can't overspend · can't touch savings · can't swap your asset away. Surface them where the user decides. |
| **The cage is pure (no asterisk)** | Both dials route every move through the on-chain mandate; revoke is total on both. No margin/leverage — say it plainly. |

### Lean onboarding (5 taps, ~60s, zero seed phrases)
```
[1] Continue with Google   →  zkLogin (Enoki)         tap 1
[2] Pick your name         →  <name>@suize             tap 2  (+typing)
[3] Fund your sandbox      →  QR / address (or skip)   tap 3  (skippable)
[4] Pick a dial            →  Safe  /  Degen           tap 4
[5] Unleash it             →  mints mandate, agent on  tap 5
```
- **Google** → zkLogin via **Enoki** (seedless; the agent never touches this MAIN address). Honesty nit: zkLogin derives the address from the Google JWT + a salt + an ephemeral keypair — keep the seedless promise, **drop** "no keys leave Google" (inaccurate).
- **Name → `<name>@suize`** is the only identity step and doubles as the "wow" (a neobank gives an account number; we give `daniel@suize`). **SuiNS leaf subnames** (NFT-less, parent-controlled) + **Enoki's Identity Subnames** REST API (sponsored, one subname per user per domain on the public-key path) — issuance is async (`PENDING→ACTIVE`); **don't block on it**, advance and let it resolve. We must **own + keep-LIVE the parent `suize.sui`** and transfer it into Enoki's managed contract (**P0**). Degrades to a cosmetic label if not ready.
- **Fund (skippable)** → the real method is **QR + address hex** (deposit USDC/SUI to the sandbox vault); same component as the home onramp. Card/Bank/Apple Pay tabs are **"Coming soon."**
- **Dial → Safe/Degen** decides which mandate is minted (§2). Yield demoted on the card (don't hardcode an APY); Degen always shows *"spot SUI↔USDC on disciplined heuristics — not guaranteed alpha, no leverage; the most you can lose is your sandbox."*
- **Unleash it** mints the mandate via a PTB after a plain-English summary; **default the budget cap `$X` to the funded sandbox** (offer an optional lower sub-cap) — the moat's key parameter cannot be undefined here. Land on Home with the agent already moving.

> **Two things that make "5 taps" honest (don't gloss):** (1) **cold-start funding** — a fresh Google-zkLogin user holds zero USDC/SUI; the only working path is sending crypto they already have on Sui, so **pre-fund for the demo** and admit the gap until fiat onramp ships. (2) **Gas** — the mandate-mint, first deposit, and subname tx all cost gas a new address lacks; **Enoki sponsors them** — state plainly that those three are Enoki-sponsored, or onboarding dead-ends at "insufficient gas" on tap 5.

### The Zen Home (two balances + the LOG)
```
┌─────────────────────────────────────────────┐
│  daniel@suize                         ●live  │  identity + agent heartbeat
│        $ 4,210.00   main   🔒                 │  BALANCE ZONE (two numbers)
│        $ 1,000.00   sandbox   ↑ +2.1% today  │
│        ● Everything is good.                 │  STATUS LINE
│  ───────────────  THE LOG  ───────────────   │  HERO SURFACE
│  09:42  Lent 200 USDC as-is on NAVI          │
│  09:31  Sentiment euphoric → trimmed 0.4 SUI │
│  09:18  💡 $DEEP yields +$545/yr — swap? [tap]│
│  [ + Add funds ]            [ ⏸ Pause agent ]│  TWO ACTIONS
└─────────────────────────────────────────────┘
```
- **Balance** — MAIN big/calm/locked (agent never touches it); SANDBOX big/alive with today's delta. The hierarchy *teaches* the two-balance model: one number is still, one breathes.
- **Status line** — default *"● Everything is good"*; degrades **in place**, never as a scary modal (*"Trimming an overextended position back to USDC" · "Prices look stale. Sitting tight." · "Mandate renews in 2 days."*).
- **The LOG (the hero)** — reverse-chron feed of every decision/proposal/move; each row = time · plain-English action · outcome chip. The **narrator voice lives here** (the LLM narrates, never sizes — every number, incl. the upgrade card's "$545/yr", is deterministic). Proposed-upgrade cards (tap-to-accept) live here. The two demo gut-punches surface as LOG rows the audience reads live — **kill-move:** `⛔ Blocked: tx exceeded mandate → reverted on-chain (0x…)` (tappable failed-tx link); **guardian:** `🛡 Position overextended → trimmed SUI→USDC on-chain`. Honesty in copy: "trimmed an overextended position," never "saved you" or "I predicted." Don't fragment the log.
- **Two actions** — **+ Add funds** (the onramp sheet) and **⏸ Pause agent** (the human face of **revoke** — one tap kills the mandate on-chain; **total on both dials**, since there's no un-cageable margin leg). The kill switch is permanent furniture, never buried — that's *why* the user trusts the autonomy. Force-unwind/withdraw-all is the full-exit convenience.
- **Push, not poll** — the agent pings only on meaningful events; routine actions accumulate silently in the LOG. (Web-push is fragile on stage — **the LOG is the source of truth**, push is nice-to-have.)

## 16. Onramp UI — "Add funds"
One sheet, opened from onboarding **and** home (same component), real method first.
- **Tab 1 — Crypto (REAL, default):** big QR + copy-hex of the sandbox deposit address; *"Send USDC on Sui. Lands in your sandbox."* "I've sent it" polls for balance. The only method that moves money for the hackathon (still requires holding crypto on Sui — pre-fund for the demo).
- **DEGEN asset prompt (asset-scope, honest):** a DEGEN vault holds **SUI/USDC only** — depositing another asset surfaces *"This vault holds SUI or USDC — swap now?"* rather than silently swapping (the agent never swaps the user's asset away on its own). SAFE vaults are multi-asset, lend each as-is, no prompt.
- **Tabs 2–4 — Card / Bank / Apple Pay:** rendered clean and real-looking, each clearly stamped **"Coming soon"** (intended flow shown, CTA disabled). They signal product ambition + neobank parity **without** lying about what works — calibrated honesty, per-component. Lean: static, zero backend.
- **Discipline:** the sheet is short; **no fee-table headline** (the fee is not the pitch — if a deposit fee exists, it's a quiet line, never the hero).
