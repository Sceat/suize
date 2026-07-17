# Suize — BACKLOG (team ticket store)

> Single ticket store for the Demo-Day sprint (register: `marketing/DEMO-DAY-PLAN.md`).
> Row shape: `[T-nnn] intent — accept: … · constraints: …`. DONE rows carry `keys:` + `proof:`.

## IN PROGRESS

- [T-014] Wallet dashboard + browser publish (#/sites) — owner: "current state nowhere near 1st
  place; many iterations". Wave 1 BUILT by lead (money seam stays inline per routing law): nav
  login top-right (Folio), chain-derived My Sites (SiteCreated+SiteExtended by owner address),
  browser 402 pay flow (deploy/extend, folder→tar client-side, wallet signs the gasless bytes;
  dev-keypair path for E2E) on the MCP-proven rail; price on the button from @suize/shared.
  accept: connect→publish→live URL→card→extend, all real · keys: gates✓ (tsc 0, vite build exit 0,
  mobile 355px overflow-free measured) behavior⏳ (BLOCKED on funded USDC key — owner fauceting
  0x377b4b4d…1da7 at faucet.circle.com) quality✓ (2 hats, SHIP×2 0 blockers; adopted+fixed: 402-vs-
  shared price guard before signing [closes misleading-button + dev-blind-signer], root-index-only
  tar check [nested dist/ = paid 404], truthful pay stages, sync double-submit latches [deploy+
  extend], stale-resolve run token + loading reset on account switch, real folder drag-drop,
  router/NaN LOWs; dismissed: dev-key-in-URL [DEV-gated], mid-payment account switch [fails safe],
  400-event cap [commented, scale item]; re-gated tsc 0 + build ✓)
- [T-020] Production-readiness audit — VERDICT SHIP (no CRIT/HIGH; 17/17 gates green; no secret
  leaks, dev key proven tree-shaken from prod bundle; money core re-verified under challenge).
  3 findings: MED shared stale comments + 2 dead wire fields, LOW env.ts "0x0" merchant guard →
  sonnet fix worker in flight · LOW domains.ts link lacks digest-recovery + pre-charge
  taken-domain check → T-024 · proof: scratchpad/prod-readiness.md
- [T-024] Domain-link hardening (audit LOW): mirror deploy/extend's digest-registry recovery on
  link + reject already-registered domain BEFORE charging (rare mid-migration state charges
  $19.99 then aborts EDomainTaken, no refund) — opus, money path, lead reviews; after T-022
- [T-022] LIVE domain-link demo rehearsal (test.suize.io) — worker deploying "Hello sui" ($0.10,
  test key) + opening the /domains challenge; owner: faucet +20 USDC to 0x377b (link = $19.99 >
  balance) + paste TXT/CNAME into the suize.io zone (grey-cloud first for verify, flip CNAME to
  Proxied after link for TLS via the suize.io cert; same-account cross-zone CNAME serves the
  worker) · then verify → pay → https://test.suize.io serves
- [T-023] MCP `link_domain` + `domain_status` tools — DEMO GAP: "Claude links a custom domain"
  is the demo script but the MCP has no domain tool; add both over the existing domains.ts
  contract (challenge → records → verify → 402 pay → linked), same CLI signer; then npm publish
  rides the owner's 0.3.0 publish
- [T-019] Docs wave — opus worker in flight: CLAUDE.md rewritten ≤140 lines for the final tree,
  deploy-worker README + self-hosting guide, apps/suize README, root README alignment, stale-md
  sweep; live-curl-verified examples; then production-readiness audit + Vercel suize.io deploy
- [T-014→behavior] qa-user VERDICT 5/6 PASS, money rail SOUND (real testnet money, $0.50 spent,
  ledger reconciles exactly): golden publish→live URL→card w/ og cut (Evw7Wdxc…) · extend +30.0d
  (3Gk1hDx3…) · sad path zero-charge · double-click = ONE settle (4jfYiCnc…, inFlight holds) ·
  sealed $0.20 wallet-gated no plaintext (Gpvhsxh3…) · FAIL: mobile 390 overflow + 3 cosmetics →
  ALL 3 frontend items FIXED by worker (minmax(0,1fr)+560px host fallback, og cut eager, sealed
  done-card "private site ready"+viewer link), gates 0/0, scrollWidth MEASURED 390 (was 503) w/
  real chain cards, lead viewed 1440 shot (og cuts render, all reconciles) · worker file_count +1
  over-count still queued (worker-side batch) · test key 0x377b owns 3 real sites (fixture)
- [T-017] MCP key UX: sui CLI as INLINE SIGNER, zero-config default — owner laws 2026-07-12: no
  raw keys to manage AND never read ~/.sui keystore files (reading another tool's key store is
  banned; first spec draft did this — corrected mid-flight). The `sui` binary signs via subprocess
  (`sui keytool sign --address <suize-alias-addr> --data <b64>`); the key never enters the MCP
  process. Resolution SUIZE_KEY → SUIZE_KEY_FILE (CI overrides, in-process) → CLI alias `suize`
  (SUIZE_CLI_ALIAS, NEVER the active address) → actionable error proposing
  `sui client new-address ed25519 suize`; signer interface seam in config.ts, deploy.ts swaps
  keypair() minimal; agent.txt fixes ride along (gasless = USDC-only [the "little SUI" line was
  false], months-cap phrasing) + packages/mcp README rewrite (closes a T-008 sub-item) · opus
  worker in flight (redirected) · lead reviews (key-handling)
  · DONE inline by lead (5 lines, sub-brief-size): devSigner ?dev-key now ALIAS-ONLY (raw
  suiprivkey in URL rejected; keys live in gitignored .env.local) — owner correction

## OPEN (ordered by value ÷ blast-radius)

- [T-032] GPT full audit (2026-07-15) verdict NOT-READY — rail real, gap is copy/config + guards.
  Lead CONFIRMED the 2 scariest: SEAL_KEY_SERVERS.mainnet=[] → sealed deploy pays-then-fails (real
  fund loss); index.html:14 still "fifty cents"+"publish button". FIX WAVE (3 opus/sonnet workers,
  disjoint): (1) frontend — hide Private on mainnet, honesty copy (Trust fabricated receipt links,
  "no server can take it down"/"funds never touch Suize"/"nobody can read private"/"unlisted" all
  overclaims → true versions), durable .env.production=mainnet + bundle-grep proof; (2) worker —
  sealed-mainnet reject-before-402 (or wire mainnet Seal servers if they now exist), extend-lapsed
  preflight, F3 concurrency durable reservation + fail-closed-on-RPC; (3) mcp+docs — MCP default→
  mainnet (else F2 guard kills the agent path), agent.txt owner-field+mainnet-USDC, claim-ladder
  (README "over x402"→"x402-compatible"), README/CLAUDE.md testnet→mainnet. OWNER: npm publish
  @suize/mcp 0.3.0 (hero cmd installs OLD wallet pkg) after worker 3; apex = DON'T migrate (audit),
  showcase *.suize.site dogfood. proof: scratchpad/gpt-full-audit.md (via codex result log)
  · SEAL MAINNET WIRED 2026-07-15 (owner: "don't delete Private", no Enoki $70/mo, no new
  backends): lead enumerated all 105 on-chain mainnet KeyServer objects → 3 FREE keyless
  Open-mode servers live-probed (pop-verified): NodeInfra 0x1afb3a57…, Overclock 0x145540d9…,
  Studio Mirai 0xe0eb52eb… → shared SEAL_KEY_SERVERS.mainnet + new SEAL_THRESHOLD (2-of-3
  mainnet / 2-of-2 testnet, ONE home; encrypt==fetchKeys invariant); killed viewer's hardcoded
  testnet-id copy (would've bricked mainnet sealed sites); UI gates re-keyed off shared list
  (Private toggle + Privacy aside auto-unlock); worker guard stays fail-closed for empty-list
  nets. keys: gates✓ (lead re-ran: 68/68 worker tests, tsc 0, app build 0) quality✓ (lead
  line-by-line, ids byte-exact vs probes) behavior✓ (2026-07-15 LIVE mainnet, real $0.20:
  sealed site 0x691170cb… minted, cold-wallet payer owns, allowed wallet decrypts via the
  2-of-3 committee, stranger NoAccessError, manifest hash verified; same-payment re-POST
  returned the SAME site = no double-mint) · proof: scratchpad/sealed-e2e-v4.ts ALL GREEN

- [T-033] Settle-timeout false-failure FIXED + DEPLOYED (facilitator d3de5415, worker f7ed96a8):
  reproduced live double-charge (landed tx reported "broadcast failed"); 4 idempotent layers:
  facilitator pollExecuted 5 reads/~8s, worker single /settle re-POST on transient, MCP postPaid
  same-header x2, browser pay.ts twin. gates: fac 28/28 (+2), worker 68/68, mcp 19/19 (+2), tsc 0
  x3; lead line-by-line. keys: gates✓ quality✓ behavior✓ (v4 recovery run exercised settle dedup
  live). REMAINING GAP (new ticket): LATE recovery dies at /verify (simulation can't see the
  consumed input coin) before settle's executed fast path — /verify needs an executed-digest
  check mirroring settle's; MCP should also persist X-PAYMENT headers (or just digests — the
  header is RECONSTRUCTIBLE from chain via rawTransaction, proven) for cross-process resume.
- [T-034] Mainnet infra events survived (2026-07-15): publisher gas-starved (refill 0.5 SUI >
  balance; +1.2 SUI from service, needs 3-5 SUI owner top-up for demo week) AND
  fullnode.mainnet.sui.io served hour-stale reads (publisher store 500s "object not found" on
  live objects) → publisher rpcUrl now sui-rpc.publicnode.com (helm values + sync). CF vantage
  stayed fresh = live product unaffected. Playbook in memory.
- [T-035] suize.io = FULL DOGFOOD (owner: "we deploy on suize with the domain, we don't use
  vercel"): fresh mainnet frontend (seal wired, bundle-proven 0xec2dcd65+0x1afb3a57) deployed
  through the rail $0.10 → site 0xa3842ee9…, live 42pt2739….suize.site, digest EkNGyenu….
  Domain challenge ISSUED for suize.io: OWNER adds TXT _suize-verify.suize.io =
  853e8f63184e2d1f5132e1ec832dbdfb0e1533378749dc5f2fe74df2f560ceec + apex CNAME suize.io →
  42pt2739pm5nt4b05g1k74ynkxr19jci3l6gnrpsq18mn0zug6.suize.site (grey-cloud for verify, flip
  Proxied after link; replaces the Vercel A records) · then lead verifies + pays $19.99 link
  (service holds 19.90 — needs +$0.10 from treasury 0x9036 [1.11] or Circle) · future updates =
  deploy new site + FREE repoint. www.suize.io: CF redirect rule to apex, not a second link.
  Ledger 2026-07-15: service $19.90 · treasury $1.11 · stranded $0.20 (lost ephemeral key,
  lesson persisted) · settled-unclaimed digests from the incident recovered or absorbed.

- [T-037] LANDING FINAL + LIVE (2026-07-17): week-long design saga closed — owner call: v1
  design (shader/masthead/gallery) + v2 wording (Walrus-first headline, monkey ledger copy,
  humanized trust, ZERO prices) + agent terminal in hero + mobile rebuilt (masthead hidden
  <900px, hook+terminal+CTAs first screens, scrollWidth==390 measured). Build worker gates all
  green (tsc 0, build 0, price-grep 0 outside checkout, em-dash sweep incl. 2 legacy strings);
  lead fixed 3 strings inline (2 em-dash law hits + terminal payoff URL → real https://suize.io).
  SHIPPED: new site 0xdef9c5af… ($0.10, digest 29GLnMra…) → FREE REPOINT of suize.io (digest
  2Hsn72m7…, prod debut of the feature) → LIVE: new bundle + new title + og.png 200. Re-run of
  the deploy script returned the SAME site (byte-identical payment → digest dedup) = double-mint
  impossibility proven in prod. Mockup archive: marketing/mockups/2026-07-16-landing/ (Fable
  broadsheet kept as reference). Film: marketing/film/suize-demo-35s.mp4 (36s 1080p, Remotion
  source + README). Riders: WalletCta module now dead (cleanup), old sites 0xa384/42pt +
  0x7e67/35f2 remain paid-through as rollback targets.
  · LINKED 2026-07-16: suize.io LIVE FROM WALRUS (link digest 37HNQRqv…, $19.99 paid through
  our own rail, cert auto-provisioned, https 200, bundle verified). Unblocked by [T-036]:
  apex-CNAME verification bug (CF flattens apex CNAMEs; proxied target = no visible chain →
  cnameOk never true) FIXED via A-record intersection path (72/72 tests, worker b0a33bce).
  Next frontend update = deploy new site + FREE repoint (the repoint live demo). Cleanup
  riders: domains.ts rider copy has an em-dash; www.suize.io still → Vercel (CF redirect
  rule to apex when owner has a minute); old Vercel suize-landing project retire later;
  live site's OG/title ship with the redesign deploy (og.png + meta are in the working tree).

- [T-030] THREE money bugs (dead GPT review caught them; verifier reproduced each) — ALL FIXED +
  lead-reviewed line-by-line; deploy-worker redeployed testnet prod (0a764ef0). F3 (WAL-replay
  BLOCKER): settle-first → siteIdByDigest recovery gate BEFORE salt/allowlist/store → replay burns
  0 WAL, recovers same site (mirrors /extend). F2 (MCP blind-sign): assertQuote guard — asset==
  USDC + outputs-total + top-line all == deployPriceUsdc before sign; extend learns sealed from
  chain not the env API; +asset-substitution check the browser lacks. F1 (serve gate): paid_until_ms
  read → 410 +5min grace before any blob fetch → mutable field TTL 1yr→60s. gates: 55 worker +17
  mcp tests green, dry-runs both envs. behavior-key PASS (independent qa-user, LIVE testnet: same
  X-PAYMENT + different bytes → same siteId recovered:true, content unchanged, replay spent $0 —
  WAL blocker proven dead; F1 unverifiable-today [no lapsed site exists] but deployed + unit-proven
  + regression-200). CUTOVER UN-HELD. proof: scratchpad/{gpt-findings-verify,qa-replay/result.json}
- [T-031] backport the MCP's asset-substitution check to the browser pay.ts guard (browser asserts
  amount but not asset==USDC) — LOW (wallet shows balance change), tidy for parity
- [T-038] DONE 2026-07-17 (escalated same day: the flap became 404s on the apex). Fix SHIPPED
  (worker 1509153b): siteForDomain = 3-rung ladder (gRPC primary → PublicNode JSON-RPC fallback
  → last-known-good via Workers Cache, 7d, newest-wins, true-miss never persisted) — a linked
  domain can never 404 again. 79/79 tests (+7), tsc 0, lead-reviewed; live proof 8/8 non-404 +
  newest build after two days of Mysten replica staleness. RIDER (flagged, unfixed): unlink
  during a full RPC brownout keeps serving from LKG up to 7d; cheap fix = delete the LKG entry
  in handleUnlink after on-chain unlink.

- [T-027] MAINNET CUTOVER — DONE so far: 3 money bugs fixed+proven, mainnet ids wired, publisher
  LIVE on k8s + funded, both wallets funded, all 3 worker mainnet secrets set, DeployerCap
  0x235e… NOW ON the service wallet 0x107d (owner sent it via the glass wallet; lead's earlier
  "never moved" call was a stale-read during propagation lag — CORRECTED, cap confirmed at 0x107d
  v…108). CONFIG-PREP worker in flight (add mainnet routes to deploy-worker [env.mainnet],
  WALRUS_PUBLISHER=walrus-publisher.suize.io, SUIZE_MERCHANT=0x9036…; flip facilitator [env.suize]
  to mainnet keeping treasury@suize; writes cutover-runbook.md; NO deploys). AWAITING OWNER GO on
  the FLIP itself (route handover + real-money fixtures = irreversible/outward). Then lead executes
  runbook: facilitator→mainnet, worker route handover (retire testnet worker), suize.io Vercel
  VITE_SUI_NETWORK=mainnet, re-run hello-sui + test.suize.io fixtures real USDC, $0.10 smoke.
- [T-028] e2e-live.ts rework (billing-cap fallout, flagged by worker): script deploys months=2 +
  extends fresh sites — both 400 under the testnet 1-month cap; needs months=1 + decay-aware
  extend; excluded from gates so non-blocking

- [T-008] (T6) Repo open-source pass — DESTRUCTIVE, HOLD FOR OWNER REVIEW (don't pile deletions on
  an unreviewed base — the T-000 lesson): delete sunset apps (wallet/crash/agents/old landing) +
  retired move packages + the k8s backend (services/backend, the OLD deploy path — its /mcp +
  charge routes are superseded by the worker); llms.txt consolidation; latest-deps sweep;
  CLAUDE.md + per-piece SPECs rewritten. READMEs (root/facilitator/pay) DONE via T-010's worker;
  still-TODO here: rewrite packages/mcp/README (old wallet flow) + packages/x402/README (says
  `npm install` but unpublished). ⚠️ README-worker found 6 stale refs to fix in this pass:
  (1) @suize/pay hardcodes DEFAULT_FACILITATOR=api.suize.io (old backend) not facilitator.suize.io;
  (2) @suize/pay's auto-split calls the DELETED /terms + /build (404 on the new facilitator) — a
  real third-party-merchant bug (Deploy itself is safe, it uses the worker's /supported+splitOutputs
  path); (3) @suize/mcp npm is 0.2.3 (old), tree is 0.3.0 unpublished — needs npm publish;
  (4) root package.json deploy:* scripts target sunset apps; (5) github.com/suize → github.com/Sceat/suize.
- [T-009] (T7) Mainnet flip + demo video — owner-gated. Mainnet: deploy_sui republish ONLY (subs
  not republished); treasury on native USDC; flip the worker (`wrangler deploy --env mainnet`) +
  facilitator to mainnet. Demo SCRIPT drafted → marketing/DEMO-SCRIPT.md (real commands/URLs, timed
  shot-list, honest guardrails); the VIDEO needs the owner's voice/screen. Owner GO pending.
  → ENABLER DONE (owner asks 07-12): dev-only #/publish page — one-click flow (vite dev middleware
  auto-runs the Move build; connect → auto dry-run via client.simulateTransaction showing gas
  [live-proven 0.0525 SUI testnet] + every to-be-created object → Publish only after clean dry
  run → created ids as copy-all JSON for shared) · lazy()-gated, grep-proven absent from prod
  bundles · runbook: VITE_SUI_NETWORK=mainnet bun run dev → #/publish → connect → publish
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

- [T-029] Billing → one-shot Walrus cap, CRON DELETED (owner decision 07-13; lead triple-checked
  the ceiling ON-CHAIN: ring_buffer len = 53 epochs → 24mo mainnet / 1mo testnet via
  maxDeployMonths(net)) — 400 fires BEFORE any 402 (publish.ts:130, extend.ts:256+270 incl.
  resulting-end-epoch guard), initial store funds full purchase (old clamp-50 would have shorted
  a paid 24mo deploy — caught), paid extend funds storage inline post-settle w/ warning-not-fail
  semantics, runStorageCron + triggers + dead helpers deleted both envs, copy swept (agent.txt/
  CLAUDE.md/READMEs/MCP/DeployPanel [1,3,6,12,24]·"2 yr") · keys: gates✓ (49 worker tests incl.
  cap-boundary + no-facilitator-call-before-400 + cron-gone; all 6 pillars green) quality✓ (lead
  reviewed the money hunks: 400-before-quote verified, rider states cap honestly) · behavioral
  note: freshly-maxed sites can't extend until they age (protocol truth, clear 400) · NOT yet
  deployed (rides the T-027 cutover)
- [T-022+T-026] LIVE custom-domain rehearsal test.suize.io — FULL LOOP GREEN, lead-verified:
  https://test.suize.io → 200 "Hello sui", TLS active, base36 URL no-regression. Deploy $0.10
  (AdmabZ…) → DNS challenge → owner records → verify → link $19.99 EXACT (F63wCZ…, split
  19.59/0.40) → CF-for-SaaS cert active → serving. THREE REAL PROD BUGS found+fixed+deployed by
  the rehearsal (worker 94f74dcf): (1) already-linked branch never re-provisioned CF SSL (paid
  customer unrepairable via free re-verify) + sslStatus dropped; (2) CF duplicate code is 1406
  (not 1407) — misclassification flapped SSL to "manual", now reads the existing hostname's true
  state; (3) serving-face resolveCustomDomain used a GraphQL inner-table-UID read that is ALWAYS
  null → every custom domain 404'd — swapped to the proven gRPC siteForDomain, cache semantics
  preserved · keys: behavior✓ (live money, live DNS, live cert, lead-probed 200) quality✓ (35
  worker tests incl. 1406 + linked-branch cases) · CF-for-SaaS one-time setup done (fallback
  origin, DCV delegation, token secret, zone id) · owner side-note: accidental ACM $10/mo sub is
  cancellable in Billing
- [T-025] Vercel-style auto-DNS — DONE: POST /domains/assist {siteId,domain,cfToken} upserts
  TXT+CNAME grey-cloud in the USER'S CF zone (registrable-domain walk, dup→PATCH, one auto-verify
  pass) + DomainRow "Add records via Cloudflare" (token in component state, wiped on fire/change,
  POST body only) · keys: gates✓ (worker tsc 0 + 28 tests + dry-run 0; app tsc 0 + build 0;
  scrollWidth 390) quality✓ (lead reviewed token hygiene at the source: single cf() helper,
  Authorization-only, mechanical scrub() on every surfaced message, fixed 403 string) renders✓
  (lead viewed desktop shot) · NOT live-called (no CF token existed for the worker; stubbed-fetch
  unit tests) — first real use = the owner's token during demo prep · worker fence note: it
  deleted apps/suize/.env.local during cleanup (outside fence) — lead restored; add "never delete
  files you did not create" to future briefs
- [T-016] Custom-domain UI — DONE by worker against the live domains.ts contract: DomainRow on
  every card (challenge → copyable TXT/CNAME + waiting states → verify → 402 pay $19.99/yr
  NUMBER-WALL-asserted → linked/unlink), PaySigner gains signMessage (personal-message unlink,
  ±60min window, two-click armed), linked state chain-derived from DomainLinked/Unlinked events ·
  keys: gates✓ (tsc 0, build 0, scrollWidth 390 measured) renders✓ (lead viewed desktop+mobile
  expanded shots) · zero paid actions in verification · NOT live-verified (needs a real domain +
  $19.99): ready-state button, paid link round-trip, linked UI, signed unlink round-trip — all
  straight-line off the contract; candidate for a one-shot live test when the owner links a real
  domain · proof: scratchpad/t016/
- [T-008] Open-source cleanup pass — DONE (owner-greenlit). Deleted: 5 sunset apps + services/
  backend + 6 retired move pkgs (incl. move-trace) + overflow-tracks/ + scripts/deploy.sh +
  .dockerignore + root logo/marketing images + pay webhook/subs subpaths + shared protocol/bridge
  (~460 tracked deletions). packages/shared 1208→646 lines (dead exports proven-unused first).
  REAL BUG FIXED: @suize/pay called the deleted backend's /terms → now computes the split locally
  from the live facilitator's /supported (fail-closed kept); its README + x402 README de-falsified
  (npm claims). llms.txt consolidated to one nav file. keys: gates✓ 13/13 invocations green across
  all 6 pillars post-delete (pay 21/21, x402 39/39, facilitator 26/26, mcp 11/11, both wrangler
  dry-runs, apps/suize build) · proof: scratchpad/t008-report.md · REMAINING elsewhere: CLAUDE.md
  + READMEs ride T-019; npm publish of @suize/mcp 0.3.0 owner-gated
- [T-018] Worker GET /preview?site= og-metadata endpoint — DONE + DEPLOYED LIVE (version 685ef676).
  Direct chain+Walrus read (sealed decided BEFORE any content fetch, zero bytes touched), manifest
  hash-verified, bounded reads (1MiB wire/64KiB parse), HTMLRewriter og/twitter/title/favicon with
  absolutized URLs, edge cache keyed by manifest blob id (content version), lapsed short-TTL ·
  keys: gates✓ (tsc 0, dry-run both envs) behavior✓ (worker: local matrix incl. HTMLRewriter
  precedence harness; lead: LIVE probes — mcp-live meta ✓, sealed {sealed:true} ✓, bogus 404 ✓)
  quality✓ (lead reviewed: read path never touches charge secrets, sealed short-circuit, no
  unverified content parse) · accepted wart: transient Walrus failure serves all-null meta with
  1h browser TTL (edge not poisoned; revisit if cards show blank cuts)
- [T-015] Dashboard design options + port — 3 designers (A ledger · B control room · C page-two),
  🎨 OWNER PICKED **C "Page Two of the Dispatch"** (DECISIONS.md) + og-preview cuts on cards;
  ported into apps/suize by a worker over the lead's review-hardened logic (filed-edition cards,
  composing desk, page-two masthead; C's .filed box-shadow dropped — hairline+shadow ban) ·
  keys: gates✓ (tsc 0, build 0) renders✓ (lead viewed port shots: gate + connected-empty 1440/390,
  faithful to C, no overflow) · populated-card + og-cut visuals pend T-018 endpoint + funded key ·
  proof: scratchpad/port-C/ + design-{A,B,C}/
- [T-017] MCP key UX: sui CLI as inline signer — DONE. Zero-config default: `sui keytool list/sign`
  subprocess (alias `suize`), key NEVER enters the process; SUIZE_KEY/KEY_FILE stay as in-process
  CI overrides; ed25519-gated; stderr scrubbed; actionable no-key error (new-address one-liner +
  Circle faucet + gasless-no-SUI). agent.txt rewritten (zero-config story; fixed false "little
  SUI" + "10 years" phrasing; 0 em-dashes, claim-ladder clean) + packages/mcp README rewritten
  (closes a T-008 sub-item) · keys: gates✓ (tsc 0, 11/11 tests incl real sandboxed CLI sign
  round-trip verified via verifyTransaction vs sui 1.75.1, build 0) quality✓ (lead reviewed the
  key-handling diff: no key material on the CLI path, scrubbed errors, one-line deploy.ts seam) ·
  ⚠️ npm publish still pending (rides T-008: npm has 0.2.3)
- [T-QA] Owner-handoff behavior key — independent qa-user (opus, never the builder) drove the LIVE
  product adversarially. VERDICT: SHIP-READY on money/auth. Every reachable attack correctly
  REJECTED on the deployed product: underpay · fee→self · fee→3rd-party · fee-omitted ·
  treasury-starved · skim-extra-leg (all `outputs_mismatch`); forged sig; wrong network/scheme;
  no-payment→402; `/settle` of an unverified underpay→success:false; deploy replay→recovered same
  siteId (no 2nd mint); CROSS-ENDPOINT double-spend blocked (deploy payment replayed at /extend →
  paid_until unchanged, shared on-chain digest registry); param-confusion re-quotes; owner==payer
  (public+sealed); extend +1mo exact + idempotent replay; sealed URL serves the bootstrap NOT
  plaintext, bytes Seal-encrypted at rest; serving byte-exact + traversal neutralized. Found ONE
  MED (non-money): the 402 advertised `buildUrl=facilitator.suize.io/build` which 404'd (the lean
  facilitator lacked /build). FIXED: ported a spec-compatible `/build` (payer convenience — builds
  the unsigned gasless PTB, no money logic, re-runs assertUnsignedBytesSafe) to services/facilitator;
  deployed env.suize; LIVE-PROVEN end-to-end (facilitator /build → payer signs → /verify VALID).
  proof: scratchpad/qa/t1-t5 + probe-tar.ts · coverage gaps (owner-note): domain link/unlink E2E
  (needs DNS + 2nd funded key — code-verified), >100MB upload 413 (bandwidth — guard code-verified)
- [T-005b] (T3b-data) suize.io front page wired to LIVE chain data — HONESTY LAW satisfied.
  Fabricated FIGURES (1284 sites / 3910 payments, random-drift ticker) + the 8 fake gallery rows
  (fake digests, href="#" receipts) DELETED; src/live.ts fetches real SiteCreated + SiteExtended
  events → the gallery (newest-first, public only on the front page) + honest counters
  (sitesLive/paymentsSettled/epochsFunded), each receipt now a REAL suiscan tx link; empty/loading/
  error states show a neutral note, never fake rows. keys: behavior✓ (LIVE: fetchLive replicated
  vs testnet GraphQL → 5 real sites, 7 payments [5 deploys+2 extends], 210 epochs funded, lead =
  the real "mcp-live" deploy w/ suiscan receipt) gates✓ (app build exit 0). ALSO fixed the T-005a-
  carry ux findings: every footer/CTA href="#" → real reachable URL (github.com/Sceat/suize, the
  x402 repo, Walrus, Seal); Trust copy "permanent site"→"funded site"; masthead already honest
  ("keep, extend, or let expire")
- [T-010b] Styled open-source READMEs (root · @suize/pay · services/facilitator) — DONE by a worker:
  zero em-dashes, claim-ladder-clean, live-curl-verified. root README (the two live products +
  402 curl + arch map), pay README (~60-line middleware), facilitator README (run-your-own in 2min).
  Surfaced 6 stale-ref findings → folded into T-008 above
- [T-006] (T4) MCP = local deploy client — BUILT + LIVE-PROVEN. packages/mcp rewritten from the
  SUNSET PAY wallet (Enoki + suize_pay/balance/receipts/subs/kill DELETED) to 4 deploy tools:
  deploy_site (tar a dir → pay the live api.suize.site door with a LOCAL key → site on Walrus) ·
  list_sites (chain-derived by the key's address) · extend_site · site_status. Non-custodial by
  construction: SUIZE_KEY/SUIZE_KEY_FILE stays local, the MCP signs the gasless x402 payment
  itself; the deployed site's on-chain owner = the local key. keys: behavior✓ (LIVE: the built bin
  driven over stdio deployed "mcp-live" → 0x87fc6b85… for $0.10, SERVES at its *.suize.site url,
  list_sites + site_status both read it back) gates✓ (tsc 0, 4/4 stdio tests, tsup build 29.9KB
  single ESM bin) · deps: @mysten/enoki dropped; nanotar + @suize/shared added (bundled) · proof:
  scratchpad/mcp-live.mjs · styled README rides the README worker/T-008
- [T-004] (T2) Charge door — BUILT, LIVE IN PROD (testnet), TWO-KEY DONE. keys: behavior✓
  (services/deploy-worker/scripts/e2e-live.ts ALL GREEN vs https://api.suize.site — 402 quote
  $0.20/2mo w/ $0.19+$0.01 split → paid deploy → site SERVES at its *.suize.site url → paid
  extend +1mo exact → **replayed extend IDEMPOTENT (200, unchanged)** → **replayed deploy RECOVERS
  the same site (200, recovered)**) quality✓ (3 hats: money+correctness CONSENSUS HIGH = settle-
  then-strand → FIXED at root: gatePayment recovers on already_executed [no 402], Move extend_site
  made RELATIVE [Clock+add_ms, computed on-chain — kills the concurrent-extend strand + gives a
  lapsed site full time], deploy EDigestUsed→siteIdByDigest recovery, domain link/unlink through
  executeWithRetry + post-settle re-check; correctness MED gunzip-before-hash → FIXED [hash-first
  matchOrDecompress]; 5 deletion/seam findings → FIXED [ids single-sourced from shared, dead vars
  dropped, Site-type assert, honest comments]; 2 LOW → FIXED [ephemeral test key, owner doc]) ·
  MOVE v4 published testnet 0x41cc6bab… (23/23 tests) · shipped live: facilitator.suize.io
  (env.suize FEE_BPS=200 → T-012 DONE, treasury@suize) + suize-deploy-worker (api.suize.site +
  suize.site serving + hourly cron) · self-caught during fix: extend response used a lagging read
  (→ SiteExtended-event value) + MoveAbort-on-RESOLUTION unmapped (→ EDigestUsed 409 both paths) ·
  NOTED scale follow-ups (not demo-blocking): Durable-Object lock for concurrent same-payment
  fan-out; cron event-window >~1000 deploys; unlink ±60min replay window · REMAINING: backend
  demolition (rides T-008) + dogfood suize.io through the door (with T-005b)
- [T-007b] (T5 viewer) Private-site viewer + allowlist manager productionized in apps/suize —
  keys: behavior✓ (independent agent drove a REAL testnet E2E: created allowlist
  0xde1bd4f2…, Seal-encrypted a 3-file site, quilt+manifest to Walrus, decrypted through the
  viewer's EXACT module — allowed renders, denied → NoAccessError; on-chain add/remove member
  count 2→3→2 GREEN) quality: iframe-srcdoc sandbox="allow-scripts" (NO allow-same-origin —
  confirmed at runtime), per-session SealClient, denied-vs-outage split, cap-gated manager ·
  proof: scratchpad/t007b/shot-1..6 + headless decrypt log · +~1460 LoC apps/suize/src/{seal,
  viewer}/ · dev-only ?dev-key scaffolding is import.meta.env.DEV-guarded (tree-shaken) · MAINNET
  GATE (rides T-009): SEAL_KEY_SERVERS.mainnet empty until servers/API tier verified — sealed
  deploys fail closed there by construction
- [T-000] Owner approved + shipped demo-day wave 1 — keys: owner✓ ("ok proceed with everything",
  2026-07-12) · proof: commit b2848de pushed to origin/master, tree clean; marketing/ gitignored
  + rm --cached (strategy docs never in the public tree); BACKLOG/DECISIONS tracked
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
