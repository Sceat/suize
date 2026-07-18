# Suize Deploy worker

The whole Suize product in one stateless [Cloudflare
Worker](https://developers.cloudflare.com/workers/), with two faces:

- **Serving.** Resolves `*.suize.site` (and linked custom domains) to an on-chain
  `deploy_sui::site::Site`, then streams the site's files from [Walrus](https://www.walrus.xyz)
  with serve-time integrity verification: the manifest's hash must match the on-chain
  `manifest_hash`, and every file is re-hashed against its manifest entry. A mismatch is a 502,
  never the bytes.
- **Charge.** The x402-paid publish API on `api.suize.site`: pay a gasless USDC payment and a
  static site goes live. The payment IS the authentication, the recovered payer becomes the
  on-chain `Site.owner`: whoever pays, owns. No account, no API key, no signup.

The worker is a normal merchant on the [open x402 facilitator](../facilitator): it never
verifies or settles a payment itself, it quotes terms with the shared split math and delegates
`/verify` + `/settle`. Its one secret is a service wallet that mints `Site` objects and pays
SUI gas + WAL storage, it never touches payer funds.

## Try it now

```bash
curl https://api.suize.site/health
# {"ok":true,"network":"mainnet","charge":true}
```

Price discovery is zero-shot, a bare POST answers 402 with the exact terms:

```bash
curl -X POST "https://api.suize.site/deploy?months=1"
```

```jsonc
// HTTP 402 (real, live response; error rider trimmed)
{
  "x402Version": 2,
  "resource": { "url": "https://api.suize.site/deploy?months=1" },
  "accepts": [{
    "scheme": "exact",
    "network": "sui:mainnet",
    "amount": "100000",
    "asset": "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    "payTo": "0x9036f4be5ca0d0c2b890f12b398c032a00952aa41c2776507db0d018002373a7",
    "maxTimeoutSeconds": 120,
    "extra": {
      "outputs": [
        { "to": "0x9036f4be5ca0d0c2b890f12b398c032a00952aa41c2776507db0d018002373a7", "amount": "100000" }
      ],
      "buildUrl": "https://facilitator.suize.io/build"
    }
  }],
  "extensions": { "payment-identifier": { "info": { "required": true, "id": "pay_…" } } }
}
```

That is $0.25 for one month of hosting. Deploy is Suize's own first-party merchant, so its
payTo IS the facilitator's fee treasury and the outputs collapse to a single leg (a
third-party merchant's quote splits into a merchant leg and a separate facilitator fee leg,
enforced identically at verify). The payer signs a gasless Sui transaction crediting those
exact outputs (build it yourself with [`@suize/x402`](../../packages/x402)
`buildGaslessOutputs`, or let the facilitator's `buildUrl` assemble the unsigned bytes) and
retries the same URL as `multipart/form-data`:

```bash
curl -X POST "https://api.suize.site/deploy?months=1" \
  -H "X-PAYMENT: <base64 PaymentPayload>" \
  -F "name=my-site" \
  -F "site.tar=@site.tar"
# 200 { siteId, subdomain, url, version, digest, months, paidUntilMs, storageEndEpoch, expiresAtMs, sealed }
```

The easiest client is the MCP: `claude mcp add suize -- npx -y @suize/mcp`, then ask your
assistant to publish `./dist` (see [`@suize/mcp`](../../packages/mcp)).

## The API

All on `API_HOST` (plus the base-domain apex). Every door is x402-priced except unlink and the
reads.

| Method + path | Purpose |
| --- | --- |
| `POST /deploy?months=&sealed=` | Publish: 402 quote → paid multipart retry (`name`, `site.tar`) → live site. `months` at $0.25/month, up to what Walrus can fund in one store (about two years on mainnet); `sealed=1` for a Seal-encrypted private site at 2x. One payment mints one site. |
| `POST /extend?site=&months=` | Buy more months for an existing site at its own rate. Open-payer: anyone may fund any site, it only ever adds paid time. |
| `POST /domains[?verify=1]` | `{siteId, domain}`: mint the DNS challenge (free), then verify + link on-chain ($19.99/year, owner-signed). |
| `DELETE /domains/<domain>` | `{ts, signature}`: owner-signed unlink. Free. |
| `GET /preview?site=<0x…>` | Site card metadata for the dashboard (title/description/image, or `{sealed:true}` / `{lapsed:true}`). Free. |
| `GET /health` | Liveness + config state. |

Live examples (real responses):

```bash
curl "https://api.suize.site/preview?site=0x7e67b6275058c096b6eaf2a0ad22ca8c903a5c60c461b6cea9189c2ed468be10"
# {"siteId":"0x7e67b627…","title":"Suize …","description":"An agent pays. A website
#  goes live…","image":null,"favicon":"https://35f29g989c02tyctlu7s2xfxhbz3zwlnpktl66dkqcajckxez4.suize.site/logo.png"}
# (this is suize.io's own frontend, deployed onto Walrus mainnet through this exact rail)

curl -X POST "https://api.suize.site/extend?site=0x7e67b6275058c096b6eaf2a0ad22ca8c903a5c60c461b6cea9189c2ed468be10&months=1"
# HTTP 402, the same single-output terms shape as /deploy: amount "100000", payTo/outputs to
# the merchant/treasury address, buildUrl

curl -X POST "https://api.suize.site/domains" -H "content-type: application/json" \
  -d '{"siteId":"0x7e67b6275058c096b6eaf2a0ad22ca8c903a5c60c461b6cea9189c2ed468be10","domain":"docs-example.org"}'
# {"domain":"docs-example.org","status":"pending","txtName":"_suize-verify.docs-example.org",
#  "txtValue":"90dea165…","cname":"35f29g989c02tyctlu7s2xfxhbz3zwlnpktl66dkqcajckxez4.suize.site"}
```

The money contract is fail-closed and idempotent: a facilitator outage answers 503, resend the
SAME `X-PAYMENT` header (settle is idempotent by digest). The settled digest is consumed
on-chain by `create_site` / `extend_site` through the `SiteDigestRegistry`, so a replay can
never mint or extend twice, and a retry after a mid-flight death recovers the already-paid work
instead of demanding a re-pay.

## How serving works

- **Resolution.** `<base36(siteId)>.suize.site` decodes straight to the Site object id; a
  custom domain resolves through the on-chain `DomainRegistry`. One chain read per site, cached
  hard (a `Site`'s content fields are immutable by construction, every deploy mints a fresh one).
- **Integrity, twice.** The manifest blob must hash to the on-chain `manifest_hash`; every file
  blob is re-hashed against its manifest entry `{patch, sha256, ct, size}` on every cache fill.
- **Blob cache: edge → R2 → aggregator.** Content-addressed by sha256, so a hit can never be
  stale and there is no invalidation path. R2 is the durable global layer that spares cold colos
  the multi-second Walrus sliver reconstruct; a cold manifest fill background-warms the whole
  site before the browser asks for its assets.
- **Sealed sites.** The URL serves a bootstrap into the suize.io viewer; the encrypted bytes are
  only ever decrypted client-side by wallets on the site's allowlist.
- **Storage funding is inline.** Each deploy stores the site's two blobs for the full purchased
  epochs, and each paid `/extend` funds the blobs toward the new paid-through in the same request
  (the service wallet pays WAL). There is no drip-funding cron, so a purchase is capped to what
  Walrus can fund in one store (roughly 53 epochs ahead, about two years of months on mainnet); an
  over-cap request is rejected before it can pay. If a post-settle WAL top-up hiccups, the paid time
  still moved on-chain and the response carries a `warning` a repeat extend re-drives.

## Run your own

```bash
git clone https://github.com/Sceat/suize && cd suize/services/deploy-worker
bun install
```

**1. `wrangler.toml`** is written for the suize.site zone; change these for yours:

| Field | What to set |
| --- | --- |
| `account_id` | Your Cloudflare account id. |
| `routes` | Your own zone: `{ pattern = "*/*", zone_name = "your-zone.example" }`. The `*/*` wildcard also serves Cloudflare-for-SaaS custom hostnames. |
| `BASE_DOMAIN` | The zone sites serve under (`<base36(siteId)>.<BASE_DOMAIN>`). |
| `API_HOST` | The hostname that answers the charge API (must be inside your route). |
| `SUIZE_MERCHANT` | YOUR merchant address, deploy revenue lands here. |
| `FACILITATOR_URL` | The x402 facilitator you settle through, run your own: [`services/facilitator`](../facilitator). |
| `VIEWER_URL` | The app origin sealed sites bootstrap into. |
| `[[r2_buckets]]` | Create an R2 bucket and put its name in `bucket_name` (the durable blob cache). |
| `CF_ZONE_ID` | Optional, your zone id, pairs with the `CF_API_TOKEN` secret for auto-SSL on custom domains; without it domains link with `sslStatus: "manual"`. |

On-chain ids are NOT vars: both faces read them from `@suize/shared` `packageIds(SUI_NETWORK)`.

**2. Secrets** (never in the toml):

```bash
wrangler secret put DEPLOY_WALLET_KEY   # suiprivkey1..., the service wallet
wrangler secret put CF_API_TOKEN        # optional, CF-for-SaaS auto-SSL
```

The service wallet signs `create_site` / `extend_site` / allowlist creation (it must hold the
`DeployerCap`) and pays SUI gas plus the WAL for storage. Fund it with both.

**3. Local dev**: copy `.dev.vars.example` to `.dev.vars` (gitignored), set
`DEPLOY_WALLET_KEY` and point `FACILITATOR_URL` at a local facilitator
(`cd ../facilitator && npx wrangler dev --port 8801`), then:

```bash
bun run dev        # wrangler dev; localhost always counts as the API host
```

**4. Ship it**:

```bash
npx wrangler deploy                # testnet (the default everywhere)
npx wrangler deploy --env mainnet  # mainnet: the ONLY flip, no code change
```

Until the charge face is fully configured (`DEPLOY_WALLET_KEY`, `FACILITATOR_URL`,
`SUIZE_MERCHANT`, `WALRUS_PUBLISHER`), paid routes answer 503 cleanly and the serving face
works on its own.

### Tests

```bash
bun test             # 18 passing, offline: payment gate + pricing math
bun run typecheck
```

---

Part of [Suize](https://suize.io). MIT licensed.
