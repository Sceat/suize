# Suize — BACKLOG (team ticket store)

> Single ticket store for the Demo-Day sprint (register: `marketing/DEMO-DAY-PLAN.md`).
> Row shape: `[T-nnn] intent — accept: … · constraints: …`. DONE rows carry `keys:` + `proof:`.

## IN PROGRESS

- [T-000] Owner reviews + /ships the gRPC/GraphQL migration wave (37 files, +858/−676, 2 new) —
  accept: owner approves diff; git-operator commits+pushes · constraints: NOTHING else lands in
  the suize tree until shipped (demolition would pile on an unreviewed base) · state: prod-proven
  (backend 0.3.0 live, smoke all-200), presented to owner this wave

## OPEN (ordered by value ÷ blast-radius)

- [T-012] (shadow #3) Suize's OWN facilitator instance must pin a NONZERO FEE_BPS in its wrangler
  vars (operator-reachable-to-zero is by-design, but the business must not run free by accident) ·
  cheap · rides the facilitator.suize.io deploy config (with T-009)
- [T-005b carries] the DATA-dependent ux findings: real receipt explorer links + real footer URLs
  (currently href="#" — contradicts the "everything to check" trust copy) + live metrics/gallery
  (honesty law) + masthead copy "permanent"→ephemeral-first · with T-005b
- [T-004] (T2) Charge door → CF worker: settle-then-publish, extend-by-hash 402 variant, prepaid-
  epoch pricing ($0.10/mo × N months, 10yr max; $0.20/mo Seal; $19.99/yr domain), **upload cap
  = reject any site whose Walrus cost > $0.05/mo (~400MB raw; CF ~100MB binds today) BEFORE the
  WAL spend**; then backend demolition (sponsor/brain/WS/directory/auction/
  trace/relayer deleted; k8s release retired) — money seam: lead reviews · blocked-by: T-000,
  T-001, T-003 contract + the PRICING SEAM (owner decision) · MUST fix the domain-parent bug —
  CONFIRMED on-chain by T-011: `resolveCustomDomain`/`siteForDomain` pass the registry id
  (0xec05…) but the `Table<String,ID>` entries live under the Table's INNER UID
  (`0x1f33b6639322653779a6b5173d39b6904f8f4de4716f75ecaf9320d998c5119c`); Table currently size 0
  (no DomainLinked events) so no domain resolves regardless — custom domains are demo-load-bearing
- [T-007b] (T5 build) Private sites productionized — allowlist module into move-deploy (Version
  gate, public abort codes, one-Allowlist-per-site, creation gated behind the paid private flag);
  viewer shell hardened (iframe-srcdoc sandbox, per-session SealClient, outage-vs-denied UX);
  publish path stores {blobId, allowlistId, fullId} in the manifest; allowlist add/remove UI
  (Cap-gated); wallet-connect session sig via dapp-kit useSignPersonalMessage · spike artifacts:
  scratchpad/spike-seal-sites (pkg 0x98eb0b57…) · blocked-by: T-000; Move publish rides T-009 ·
  MAINNET GATE: verify Seal mainnet key servers/API tier before the flip
- [T-005b] (T3b-data) Wire the suize.io gallery + counters to LIVE chain reads (facilitator
  /supported, on-chain SiteCreated/manifest events, epoch countdowns from real expiry) ·
  blocked-by: T-005a, T-004 (site/manifest read shape), T-000
- [T-005] (T3b) — SUPERSEDED by T-005a + T-005b (split shell/data). Original note: build from the
  owner-picked option (**Option 1 — The Dispatch**, mockup-fidelity law): gallery + wallet dashboard
  (latest dapp-kit v2 createDAppKit, wallet-connect only) + epoch countdowns + die/extend/
  make-permanent + live counters + explorer deep-links · blocked-by: T-002 pick, T-000
- [T-006] (T4) MCP local-only: delete hosted /mcp; tools = deploy_site · list_sites (chain-derived
  by payer address) · extend_site(site_id, epochs) · site_status; `install cursor|claude|codex`
  one-liners; styled README · blocked-by: T-000; extend tool needs T-004 contract
- [T-008] (T6) Repo open-source pass: delete sunset apps (wallet/crash/agents/old landing) +
  retired move packages from tree; gitignore marketing/ (+ git rm --cached); styled READMEs
  (root · facilitator · mcp · pay); llms.txt consolidation; latest-deps sweep; CLAUDE.md + SPECs
  rewritten · blocked-by: T-000
- [T-009] (T7) Mainnet flip: deploy_sui republish ONLY (subs retired, not republished); treasury
  on native USDC; demo script + ≤5-min video · owner GO pending (call by Jul 16)
- [T-010] x402 upstream lane — REMAINING: owner pastes the #2616 gRPC note
  (scratchpad/comment-2616-grpc.md); DrVelvetFog suggestion-block round on #2615 (accept in UI
  when posted) · background · DONE so far: live integration 7/7 with payer 0x087 (coin-object
  settle digest 6Gzx6Cyw…), signer migration pushed as d8f9cfec

## BLOCKED
(none)

## ICEBOX (pre-pivot backlog — kept for history; most obsoleted by the 2026-07-10 sunset)

- Decentralized order store (Walrus+Seal) — external-merchant business sunset; revisit only if
  third-party charge-door webhooks return as a product
- Onboarding follow-ups (blind-merchant sim 2026-06-16) — external-merchant onboarding sunset
- PolySui "Be the House" vault sim — PolySui sunset
- Trace-stack hardening (2026-06-17 review) — trace deleted with the wallet
- move-subs verify-testnet.ts full gRPC migration — folds into T-009 (env-gated stopgap in place)

## DONE

- [T-013] (ux-hat polish) apps/suize 6 data-independent fixes — keys: behavior✓ (lead viewed
  390px mobile shot — overflow gone, command ellipsizes) quality✓ (worker measured each:
  scrollWidth 390===390, 7/8 cards now `<a>` + private row guarded, focus-ring computed-style
  = --blue, one-H1 heading tree, Copy aria-live, 2 contrast labels → --blue-deep) · +23 LoC ·
  closes T-005a's quality key; data-dependent findings remain → T-005b
- [T-011] (shadow TIER-1) deploy-worker JSON-RPC → zero-dep Sui GraphQL (site read + domain read;
  base64 vector<u8>→hex decode; hand-rolled BCS key byte-identical to backend) — keys: behavior✓
  (LIVE testnet: Site 0x855e…f384 hex decode MATCHED end-to-end; both networks wrangler dry-run
  green) quality✓ (lead reviewed the money-critical decode — collision-free for 32-byte sha256)
  · proof: +73 LoC, 0 new deps, task output · domain-parent bug confirmed on-chain → T-004 accept
- [T-005a] (T3b-shell) suize.io app scaffolded at apps/suize/ — "The Dispatch" ported 1:1
  (React 19 + Vite, self-hosted fonts, CSS verbatim) + **dapp-kit v2 wired clean**
  (`createDAppKit`/`DAppKitProvider`/`ConnectButton` + `SuiGrpcClient` reads — de-risks de-Enoki)
  + typed DeploySite gallery w/ T-005b live-data seam · keys: renders✓ (lead viewed screenshot —
  faithful) behavior⏳ (Copy / wallet-modal / 390px UNVERIFIED — ux-real hat is the closer, do NOT
  ride "behavior✓" into DONE) quality✓ (ux-real hat drove it live: 7 findings — 2 CRITICAL mobile-
  overflow + dead-cards, HIGH focus-ring, 3 MED a11y/contrast; data-independent 6 → T-013 now,
  data-dependent → T-005b; honesty-metrics blocker reconfirmed) · proof: scratchpad/suize-fullpage.png,
  build `✓ 497 modules … exit 0` · HARD CARRY to T-005b: placeholder figures (1,284/3,910/…) &
  fake receipts MUST wire to live chain or be removed before public (honesty law) · MINOR copy:
  masthead "THE PERMANENT AGENTIC WEB" undersells the ephemeral-first wedge — revisit in T-005b
- [T-003] (T1) Open-source facilitator → `services/facilitator/` CF Worker (spec-pure /health
  /supported /verify /settle; operator-owned FEE_BPS/FEE_FLOOR/FEE_TREASURY/MERCHANT_RATES;
  `splitOutputs` promoted to @suize/x402 as the ONE shared implementation) —
  keys: behavior✓ (LIVE testnet proof vs wrangler-dev: merchant computed its own split from
  /supported → payer signed gasless PTB → verify VALID → settle digest
  `HUxgHje7TEXm5SKPGBgYi2GazwXkTgfTK8QPjXzUNsd9` → replay-settle IDEMPOTENT → **tampered-
  requirements settle REJECTED** → replay-verify REJECTED already-executed)
  quality✓ (2 hats + lead: **HIGH mis-attribution fixed** — executed-first settle now binds
  success to on-chain balance changes recomputed for THOSE requirements; **MED replay-guard
  fail-open fixed** — NOT_FOUND-only classifier, all other chain-read errors fail closed;
  transient-vs-terminal failure taxonomy added (`facilitator_unready`, never cached; idempotency
  key = digest|payTo|amount so no cross-requirements poisoning); /supported?payTo= effective
  rate for MERCHANT_RATES merchants; CORS'd top-level 500; 3 limiter LOWs dismissed — WAF owns
  real limiting) · tests 26/26 facilitator + 39/39 x402 · OPEN NOD: operator CAN configure a
  zero fee (FEE_BPS=0/FEE_FLOOR=0) — intended for an OSS rail; payer/merchant still cannot
  bypass the operator's policy
- [T-002] (T3a) suize.io design options — keys: behavior✓ (3 options + 9 verified shots)
  quality✓ (ban-clean, DNA-faithful) · proof: scratchpad/design-suize-io · 🎨 OWNER PICKED
  **Option 1 "The Dispatch"** (in DECISIONS.md); T-005 builds from it
- [T-007] (T5) Seal private-sites spike — **VERDICT: PASS, buildable this week** (browser decrypt
  ~0.7s, cryptographic denial proven, 0.019 SUI spent) — keys: behavior✓ (full matrix green,
  shot-allowed/denied.png) quality n/a (spike) · proof: scratchpad/spike-seal-sites, ./run-all.sh ·
  build gaps → T-007b
- [T-001] (T0) CF-worker publish spike — **VERDICT: GO-direct, N≈100MB** (95MB single Walrus PUT
  from deployed Worker; @mysten/sui gRPC-web on workerd proven; cron validated; guardrail: never
  double-buffer >~60MB; paid plan required — already are; ~13s Walrus latency floor → UX designs
  for it) — keys: behavior✓ (real-edge matrix, all PASS) quality n/a (spike) · proof: scratchpad/
  spike-cf-publish + limits table in task output · throwaway worker deleted (API-confirmed)
- [T-M1] JSON-RPC → gRPC/GraphQL migration (shared · backend · pay · mcp · apps-Enoki-side) —
  keys: gates✓ (tsc clean ×3, tests 6+35+21 green, builds green) behavior✓ (prod 0.3.0 smoke
  all-200 incl. resurrected /feed) · proof: api.suize.io on Mysten gRPC host, publicnode stopgap
  removed · awaiting T-000 ship
