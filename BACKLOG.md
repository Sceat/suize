# Suize — Backlog

> The global "later, not now" list. Owner-requested (a deliberate exception to the
> one-SPEC-per-piece docs law). Each item: WHY deferred + the trigger to build it +
> enough design to pick it up cold. Keep it honest — if it's built, delete it from here.

---

## 1. Decentralized order store — Walrus + Seal (the dropped-webhook + no-code-sink fix)

**Status:** designed, deferred. **Owner call (2026-06-17):** email is NOT the answer (centralized, off-thesis — Suize is decentralized); Walrus + Seal IS the go-to, **encrypted to the merchant account**. But it's not needed for the June-21 demo, so: capture here, ship later.

**The gap it closes:**
- *B6 (dropped webhook):* the buyer's order PII (shipping address — the opaque `order` blob) lives ONLY in the fire-and-forth webhook POST. If delivery fails (now retried ~15 min, see §webhook), the order data is lost — the payment is on-chain forever, but what-to-ship is gone. Fatal for physical goods.
- *B2 (no-code sink):* a truly serverless merchant has no webhook at all → needs orders delivered somewhere durable they can read.

**The design (the panel's correct version — NOT the naïve MemWal reuse):**
- **Trigger:** persist EVERY settled order, right after `doSettle` succeeds, BEFORE `fireChargeWebhook` (the webhook becomes a fast nudge over a durable store, not the system of record). Best-effort + time-boxed so a Walrus hiccup can NEVER fail a payment whose money already moved.
- **Encrypt-to-the-MERCHANT-ACCOUNT, not a backend key.** Seal access policy whose `seal_approve` authorizes the charge's `merchant` (= the payTo = the verified WS session at create-time). The backend ENCRYPTS-to but can NEVER decrypt — Suize stores ciphertext it cannot read (no PII honeypot, non-custodial intact). **DO NOT** reuse MemWal's `deriveDelegate(masterKey, addr)` — that derives a key the backend holds = a honeypot. Reuse MemWal's *shape* (stateless, `seal_approve`), flip the trust direction.
- **Store:** one Seal-encrypted Walrus blob per order (≤16KB), via the existing `deploy/walrus.ts` `storeBlob`. The deploy service wallet (`agent@suize 0xcc58bc…`, WAL+SUI funded) pays WAL + owns the Blob (so the renewal relayer can extend it). **Bind the blob bytes to the unique `txDigest`** — `storeBlob` treats `alreadyCertified` (Walrus dedup on identical bytes) as a hard 502, so identical orders would dedup-fail. Retention: SHORT (an order is a transient fulfilment record) — ~30–90 days, env-tunable; subs auto-renew does NOT apply. **OPEN: the retention window — let a real merchant define it.**
- **Index = an on-chain event per order** `{merchant, chargeRef, walrusBlobId, txDigest, paidAt}` (NO PII on-chain). Merchants self-index from chain (the subs/auction precedent) — replica-safe, no backend DB, no Redis. **Emit mechanism:** a thin `orders::record(...)` event-emitter Move fn called by the service wallet (one publish, ~`create_site` gas). **REJECT** a per-merchant Walrus index blob (read-modify-write races across replicas → corruption). **REJECT** WS-push-as-store (a serverless merchant is offline at settle → dropped like the webhook; WS push is a real-time *nudge* on top, never the store).
- **Recovery — pull:** `GET /charge/orders` (HTTP, per-request signed-nonce auth = the deploy `fetch_my_sites` precedent; the merchant's zkLogin signature IS the identity, no store). Reads the merchant's order events from chain → fetches each Walrus blob → returns ciphertext. Suize never decrypts. Cursor-paginate by `paidAt`.

**Owner's two design questions (answered, for when we build):**
- **SDK boot-time backfill (Node):** `@suize/pay` gains `fetchMissedOrders({ since })` — at server boot (or a cron), it calls `GET /charge/orders`, Seal-decrypts each blob with the merchant's account, and replays the orders the webhook missed while the server was down. The webhook stays the real-time path; the backfill is the catch-up. (Node merchant has the Seal decrypt capability via their key.)
- **Non-Node env:** three recovery surfaces — (1) any-language: the raw `GET /charge/orders` HTTP endpoint; (2) no-code: the **wallet Business console** order list (decrypts client-side via the merchant's local zkLogin session — keys never leave the machine); (3) the webhook itself (the primary). **OPEN FRICTION:** Seal decryption is TS-centric — a non-TS server can fetch the ciphertext but can't easily decrypt it. Resolutions to pick later: a tiny Seal-decrypt CLI/WASM, OR steer non-TS merchants to the console for recovery, OR a Suize decrypt endpoint (rejected — reintroduces custody). Decide when a non-TS merchant actually needs programmatic recovery.

**Trigger to build:** a real merchant (dropshipper / serverless creator) hits the wall — their webhook went dark >15 min AND they need the order back. Until then it's a PII store solving a delivery problem the ~15-min retry already softens.

---

## 2. Onboarding follow-ups (from the blind-merchant simulation, 2026-06-16)

- **Testnet-default footgun:** `@suize/pay` `DEFAULT_NETWORK = sui:testnet`; a copy-paste merchant omitting `network` is silently live on testnet (fake money). Add a loud one-time `console.warn` when unset + a bold README callout. (Quick.)
- **/business trust section + no-code beat:** the skeptic's questions (fraud/chargeback/"if Suize vanishes") are answered in the repo README but absent on `/business`; and the no-code charge door isn't surfaced there (only `/docs` got the Tier-0 card). Pull the trust contract onto `/business` + add a no-code beat. (Landing content pass.)
- **Payment-proof path for devs:** a dev can stand up a 402 but never *see* a payment settle. Ship `npx @suize/pay test --to … --price …` (a throwaway payer against a funded test key) OR a curl recipe + a testnet USDC faucet link, and surface the first real charge in the console ("you were paid"). (~half day.)

---

## 3. Misc deferred

- **PolySui "Be the House" vault sim curve** — the DeepBook track makes a backtested simulation a qualification for a vault strategy; we frame the vault as a live LP utility instead. Add the sim if pushing the vault story.
- **Walrus action-log for the PAY wallet agent** — SHIPPED 2026-06-17 as the Seal-encrypted "trace" stack (trace::trace published; backend /trace relay; wallet capture→encrypt→anchor→badge→auto cross-device restore). Remaining hardening in §4.

---

## 4. Trace stack — deferred hardening (post /review 2026-06-17)

The Seal-encrypted history shipped + most review findings fixed. Deferred (with reasons):

- **Trace blob durability/renewal** — trace blobs reuse the deploy `storeQuery` (`epochs=30, permanent=true`): after ~30 epochs the Walrus aggregator 404s the blob (the on-chain anchor survives forever but points at gone bytes → cross-device restore breaks past ~30 days), and permanent blobs accumulate non-deletably at WAL cost. FIX: a finite, *deletable* trace-storage tier + a renewal cron (mirror the deploy `extend_blob` relayer), OR delete the superseded rolling blob on each flush. NOT done now: it touches the deploy-critical shared `storeBlob` — regression risk to the flagship for zero demo benefit (the demo is days, not a month).
- **@mysten/seal ↔ @mysten/sui peer skew** — seal 1.2.0 declares `@mysten/sui ^2.18.0`; the wallet pins 2.17.0 (one copy tree-wide). Builds + typechecks + the docs API matched; seal uses stable SuiClient methods. NOT bumping sui pre-demo: a core-dep bump cascades through x402/dapp-kit/the whole wallet (regression risk > the skew risk). GATE: verify encrypt/decrypt live; bump sui calmly post-hackathon.
- **Trace failure UX** — flush/restore failures + the integrity hash-mismatch refusal are `console.warn` only (the "saving…" state + the badge are the success signals). Add a surfaced "couldn't save / couldn't unlock" state (esp. the tamper-refusal — a security signal shouldn't be silent).
- **`alreadyCertified` dedup → 502** — identical re-flushed bytes can dedup-hit Walrus → hard 502. Rare (Seal encryption is randomized, so ciphertext differs each flush); tolerate the dedup (resolve the existing blobId) if it bites.
- **Deck "MemWal action-log" still framed ROADMAP** — leave as roadmap until the live test passes (calibrated honesty — don't claim shipped until proven); update once verified.
- **Cosmetic** — the badge's inline style → an `.rd-asst__verify` class; IndexedDB connection caching (per-op open). Harmless.
