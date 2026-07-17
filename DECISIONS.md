# DECISIONS — append-only ledger

- 2026-07-12 · The lean facilitator gets a `/build` back (the 2026-07-10 "/build /terms /tx DELETED"
  is AMENDED for /build ONLY): a spec-compatible payer convenience that returns the unsigned gasless
  PTB bytes — no money logic (verify/settle still recompute + enforce the split), keyless. Reason:
  every 402 advertises `extra.buildUrl` and a by-the-book x402 client / a judge probes it; it 404'd
  on the keeper host (qa-user MED). /terms stays DELETED — merchants read /supported + compute the
  split with splitOutputs (the worker's path). @suize/pay's internal /terms auto-resolve is a
  separate T-008 SDK fix (the deploy flow passes explicit outputs, so it never hits /terms) · lead + qa-user

- 2026-07-12 · suize.io shows ONLY real on-chain data (honesty law): the fabricated counters +
  fake gallery are deleted; src/live.ts derives the gallery + counters from SiteCreated/Extended
  events, receipts link to real suiscan txs, and a read blip shows an empty state — never a
  fabricated row. Small-but-real (5 sites today) beats big-but-fake (the survival-sprint law:
  faking = ecosystem-blacklist risk). More real demo deploys before Demo Day is legit polish · lead
- 2026-07-12 · T-008 (repo demolition: delete sunset apps + the k8s backend) is HELD FOR OWNER
  REVIEW — deletions on an unreviewed 50-file base repeat the exact T-000 mistake. The lead builds
  only non-destructive work until the owner reviews/commits the accumulated wave · lead

- 2026-07-12 · The MCP (packages/mcp) is now the DEPLOY client, not a wallet: an agent's local key
  (SUIZE_KEY, never leaves the machine) signs the gasless x402 payment and pays the live charge
  door — one tool call publishes a site to Walrus, non-custodial by construction. The old PAY-wallet
  MCP (Enoki zkLogin + suize_pay/balance/receipts/subs/kill) is DELETED with the PAY sunset. Tools:
  deploy_site · list_sites · extend_site · site_status. The hosted /mcp (services/backend) dies with
  the backend demolition (T-008) · lead (owner's "keep the mcp for deploy, rebrand Suize only")

- 2026-07-12 · MONEY-HAT HIGH fixed (settle-then-strand): a settled payment retried after a
  post-settle failure must RECOVER, never re-charge. gatePayment treats verify's already_executed
  as recover-and-proceed (structural payer recovery, no 402); create_site/extend_site are idempotent
  by the shared SiteDigestRegistry; a retry returns the ALREADY-PRODUCED result (deploy→same site via
  siteIdByDigest, extend→current paid_until). Live-proven: replay of both is idempotent 200 · lead + 2 hats
- 2026-07-12 · extend_site is RELATIVE on-chain (Clock + add_ms → max(now, paid_until)+add), NOT a
  worker-computed absolute target. Removes the concurrent-extend strand class (two honest extenders
  each stack their own duration; no shared target to find stale) AND gives a lapsed site the full
  purchased time. Republished as deploy_sui v4 (0x41cc6bab…, digest 4LLhhe1g…); v3 abandoned · lead + money hat
- 2026-07-12 · A Move abort can surface on the gRPC RESOLUTION throw (client simulates while
  building), not only as a FailedTransaction — the executor maps BOTH paths through the abort table
  so EDigestUsed is a 409 (recovery) not a 502. Caught live: the first recovery repro 502'd · lead
- 2026-07-12 · Chain writes read their result from the tx's OWN event (SiteCreated/SiteExtended),
  never a follow-up object read — a fresh shared object / a just-written field can lag the indexer
  (both live-caught: create returned "not found", extend returned the pre-extend value) · lead

- 2026-07-12 · CHARGE API HOST = api.suize.site (inside the worker's own wildcard zone — zero DNS
  work; the isApiHost check runs before site resolution and 'api' is a reserved subdomain).
  deploy.suize.io stays an OPTIONAL alias: its DNS still points at the retired Vercel dashboard —
  owner clears that record, then add the custom-domain route. The suize.site APEX also answers the
  API paths (/deploy /extend /domains /health) — one memorable door, previously a dead 404 · lead
- 2026-07-12 · facilitator.suize.io LIVE (wrangler env.suize of the OSS worker — the operator
  story dogfooded): FEE_BPS=200 + $0.01 floor pinned (T-012), FEE_TREASURY=treasury@suize resolved
  on-chain (0x37cf46b4…), custom domain auto-provisioned on the suize.io zone · lead
- 2026-07-12 · Owned-object contention (DeployerCap + gas coin serialize every mint): worker
  execute() rebuilds + retries ≤3 on version conflicts — absorbs demo-scale concurrency; a
  Durable-Object write lock is the known follow-up if deploy volume ever makes retries visible ·
  lead (surfaced by a live equivocation against a concurrent CLI tx)
- 2026-07-12 · create_site's minted id is read from the SiteCreated EVENT in the execution result,
  never from follow-up object reads (a fresh shared object may not be indexed yet — live-hit race) · lead

- 2026-07-10 · Deploy shortlisted (Walrus track, Demo Day Jul 18 11:10 PM PT); wallet/PAY, Crash/PolySui, agents directory, x402-as-standalone-product SUNSET · owner
- 2026-07-10 · Enoki removed everywhere (sponsorship + zkLogin); auth = wallet-connect only on latest dapp-kit v2 · owner
- 2026-07-10 · Rebrand: the product IS Suize; suize.io = the sole website (half landing, half live gallery of pushed sites) · owner
- 2026-07-10 · Architecture: two OSS products, ZERO k8s — open-source facilitator (CF-worker-shaped, OPERATOR-owned fee via FEE_BPS/FEE_TREASURY) + Suize merchant (publish/serve/domains/extend inside the CF worker); Suize consumes the facilitator as a normal merchant · owner + lead
- 2026-07-10 · MCP = local npm only (`npx @suize/mcp`); hosted /mcp dies — a remote MCP that pays would hold keys = custody · owner challenge, lead conceded
- 2026-07-10 · UPLOAD CAP (owner): a site's Walrus storage cost MUST NOT exceed **$0.05/month** → guarantees ≥50% margin on the largest allowed site (vs ~97% typical). Derived limit ≈ **400 MB raw** (encoded ~5× + ~64MB/blob metadata × 2 blobs, at $0.023/GB-encoded/mo). Today the CF-Worker ingress ceiling (~100 MB ≈ $0.014/mo) is the BINDING limit; the $0.05 rule binds only if chunked upload lands for >100MB sites. Enforce as a publish-path guard (reject before the WAL spend) + a `MAX_SITE_WAL_USD_PER_MONTH = 0.05` shared constant; supersedes the retired-subs `DEPLOY_RENEW_MAX_BYTES` (100 GiB, a different/old cap). Folds into T-004. · owner + lead
- 2026-07-10 · PRICING LOCKED (owner): Deploy = **$0.10 / month** of hosting, single flat rate — extend = buy more months at the same rate, **10-year max** (120mo=$12), NO "permanent" tier; **custom domain $19.99/year**; **Seal-encrypted (private) = 2× = $0.20/month**. Replaces the old $0.50 one-off + $19.99/mo-sub model. Margin over Walrus ≈ **96-97%** (Walrus storage ~$0.003/site/mo: 2 blobs × ~64MB metadata floor + 5× encoding × $0.023/GB-encoded/mo, USD-pegged so no WAL-price risk). Caveats for T-004: one-time write cost (~sub-cent, pin from costcalculator.wal.app), SUI gas/op, Walrus max-epochs-ahead (~2yr cap → the existing extend relayer re-ups a 10yr prepaid site from held balance), and it's a volume business ($1.20/site/yr). · owner + lead margin calc
- 2026-07-10 · subs RETIRED from the product path (renewals = user-signed push; the signer was the dead wallet's agent): prepaid epochs at deploy + extend-by-hash (priced 402 variant, agent points at site id/hash) + fundable storage pools; domains = yearly one-off; module stays published as rail history · owner
- 2026-07-10 · Privacy tiers: public / unlisted / private (site blobs Seal-encrypted; viewer decrypts client-side after wallet-sig passes on-chain seal_approve allowlist); premium per-deploy flag · lead (owner's creative mandate)
- 2026-07-10 · Latest deps everywhere is LAW (the dapp-kit-1.0.6 lesson) · owner
- 2026-07-10 · Open-source pass: marketing/ gitignored (+ rm --cached), sunset code deleted from tree, styled READMEs, repo stays public through judging · owner
- 2026-07-10 · Facilitator fee belongs to the facilitator operator, never hardcoded Suize; free-to-run OSS business · owner
- 2026-07-10 · NO TELEGRAM this team run (owner using it elsewhere); comms = terminal only · owner
- 2026-07-10 · Pre-team: gRPC/GraphQL migration deployed to prod as backend 0.3.0 (Mysten JSON-RPC retirement outage root-caused + fixed same night); tree uncommitted pending owner review (T-000) · lead
- 2026-07-10 · T-001 spike verdict: GO-direct ≈100MB — full publish path fits one CF Worker (Walrus 95MB single PUT, gRPC-web on workerd, cron OK); guardrail: stream/single-buffer, paid plan; ~13s Walrus latency floor is a UX fact · spike evidence
- 2026-07-10 · 🎨 OWNER PICK: suize.io ships **Option 1 — "The Dispatch"** (editorial broadsheet: masthead, serif lead-story gallery, dossier markers) — mockup at scratchpad/design-suize-io/option-1.html; T-005 builds from it faithfully (mockup-fidelity law) · owner
- 2026-07-10 · Seal private-sites spike: **PASS, buildable this week** — 2-of-2 testnet key servers, allowlist seal_approve module shape proven (spike pkg 0x98eb0b57…), browser decrypt ~0.7s payload-independent, denial is cryptographic (NoAccessError); build gaps: iframe-srcdoc sandbox for decrypted sites, allowlist module folded into move-deploy w/ Version gate + public abort codes, one SealClient per session (cache-poisoning gotcha), mainnet verified key servers + possible API tier must be checked BEFORE the flip · spike evidence
- 2026-07-10 · Facilitator settle is bound to (digest, payTo, amount), never the digest alone: an already-executed digest returns success ONLY when its on-chain balance changes satisfy the split recomputed for THOSE requirements (money-hat HIGH: a settle-only integrator could otherwise be shown success for a foreign digest). Inherited from the backend original — that instance is being demolished; no third-party settle-only integrator exists · lead + money hat
- 2026-07-10 · Failure taxonomy on the rail: TERMINAL (bad bytes/sig/outputs/already-executed) is cacheable; TRANSIENT (treasury name unresolved, chain unreadable) surfaces as `facilitator_unready` and is NEVER cached. Replay guard swallows NOT_FOUND only — any other chain-read error fails closed · lead + 2 hats
- 2026-07-10 · shadow-pass adjudication: (a) deploy-worker JSON-RPC breakage is real + disjoint → T-011, fix now (reverses my over-broad "T-000 gates everything"); (b) T-004's true blocker is the PRICING SEAM needing owner sign-off, NOT T-000 — escalate the seam as a clean decision; (c) Suize's own facilitator instance must pin nonzero FEE_BPS → T-012; (d) T-005a relabel renders✓/behavior⏳; (e) facilitator live-proof confirmed genuine (mis-attribution guard really fired) · shadow-pass
- 2026-07-10 · `splitOutputs` lives in @suize/x402 (one home): merchants compute declared outputs from GET /supported's published policy; the facilitator recomputes + enforces the identical math. /supported?payTo= returns the effective per-merchant rate · lead + correctness hat
- 2026-07-12 · Owner GO on everything ("ok proceed with everything"): T-000 diff approved (shipped
  as b2848de), T-004 build authorized, mainnet flip GO in principle (execution rides T-009), loop
  re-armed. Owner is low-bandwidth (aresrpg) — escalate only real decisions · owner
- 2026-07-12 · T-004 auth model: the PAYMENT is the ONE auth primitive — deploy owner = recovered
  payer (unchanged), DOMAIN LINK requires recovered payer == Site.owner, EXTEND is OPEN-payer
  (anyone may pay to extend any site — it only ADDS paid time). AMENDED same day: UNLINK keeps the
  stateless personal-message owner signature (a free destructive op has no payment to recover an
  identity from; an open unlink = domain griefing, the old M1 bug) · lead
- 2026-07-12 · Domain-link payments are OP-BOUND: the quote embeds extra.suize {op, domain, siteId}
  and the gate deep-compares it (domains have no on-chain digest registry; the terms binding is the
  replay wall — the unit test caught the gate missing this compare before it shipped) · lead
- 2026-07-12 · deploy_sui v3 published to testnet (0x437d0a29…, publisher = the `suize-deploy` CLI
  wallet 0x171a87c1…, which holds DeployerCap/AdminCap/UpgradeCap); v2 0x5cbf0ce0… abandoned in
  place (old backend keeps serving it until demolition). Worker merchant (testnet) =
  `suize-deploy-merchant-dev` 0x6a67f019… · lead
- 2026-07-12 · Walrus blobs stay `permanent=true` (not deletable): "not even Suize can remove your
  bytes before expiry" is the Walrus-track trust story; expiry (unpaid lapse) is the lifecycle · lead
- 2026-07-12 · Extend replay guard: the old backend's extend had NO digest dedup (a replayed
  X-PAYMENT double-extended for free — inherited bug). New `extend_site` Move fn consumes the
  payment digest through the SAME SiteDigestRegistry as create_site (chain is the database) · lead
- 2026-07-12 · Site struct gains `paid_until_ms: u64` + `sealed: bool` (republish, not upgrade):
  paid_until is the on-chain record a >2yr prepay tops up against (worker cron extends storage
  toward it — Walrus max-epochs-ahead ~53); sealed doubles the extend rate + is honest public
  metadata. Privacy blob/allowlist detail rides the MANIFEST (v2), not the Site · lead
- 2026-07-12 · One month = 30 days flat (2_592_000_000 ms) for all deploy pricing; epochs bought =
  ceil(months×30d / epoch duration), over-provision rounds UP in the buyer's favor · lead
- 2026-07-10 · Facilitator extraction contract (money seam, lead): spec-pure endpoints /verify /settle /supported /health; /build /terms /tx DELETED (fee policy published in /supported extra {feeBps, feeFloor, treasury, assetTransferMethod}; merchant middleware computes the split with the same published math; verify recomputes + enforces, declared outputs never trusted); FEE_TREASURY env = plain address OR SuiNS name (resolved hourly, fail-closed); FEE_BPS/FEE_FLOOR env (defaults 200/10000); optional MERCHANT_RATES registry; per-IP limits = CF-native; lives at services/facilitator/ (new dir, workspace-covered, extractable) · lead

2026-07-12 · Dashboard design = variant C "Page Two of the Dispatch" (filed-edition cards, composing desk, running head) + OpenGraph previews on site cards (worker GET /preview?site= parses og tags server-side; typographic fallback when absent) · owner pick over A ledger / B control-room

2026-07-12 · FULL MAINNET CUTOVER — owner GO ("yes full mainnet"): suize.site + api.suize.site + facilitator.suize.io + suize.io all flip to mainnet; testnet fixtures stop serving (testnet = dev-only via env override); demo fixtures re-run on mainnet with real USDC; treasury=merchant=0x9036f4be…73a7 via treasury@suize (mainnet SuiNS verified); mainnet deploy_sui = 0xec2dcd65… (publish 93E1S1Gb…)

2026-07-15 · MAINNET LIVE + DOGFOOD: facilitator.suize.io + api.suize.site flipped to mainnet (route handover done); suize.io FRONTEND deployed THROUGH Suize onto Walrus on mainnet (siteId 0x7e67b627…, url 35f29g98…suize.site, digest 9zeyJohB…, $0.30 real USDC, paid thru Oct13, integrity-verified serving). Payer/owner = service wallet 0x107d. First real mainnet deploy = our own site. REMAINING: link suize.io apex ($19.99, move off Vercel) + full diff review+commit.
2026-07-16 · Landing redesign: owner picked variant A "terminal hero" (living agent-conversation terminal as the first-viewport hook) over B action-hero and C compressed-editorial; one correction before port: desktop 1440 "too simple/centered, bad use of screen space" · the autotyping terminal demos the product without a demo and is the sharpest agent-first hook; mobile passed as-is. Mockups: marketing/mockups/2026-07-16-landing/.
2026-07-17 · Landing final call: KEEP the live v1 design (HeroShader ink smoke, editorial masthead system, live gallery) and transplant v2 WORDING into it (headline "Websites on Walrus, shipped by your agent.", kicker "From a folder to live in seconds.", monkey-simple ledger copy, humanized trust, ZERO prices on the landing) + the autotyping agent terminal joins the v1 hero · the week of mockup rounds converged on words, not structure; the Fable broadsheet mockup stays as reference for the terminal + copy. Prices-on-landing exception permanently revoked.
