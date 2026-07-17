# @suize/suize

The Suize product frontend, served at [suize.io](https://suize.io). One React 19 + Vite app,
three surfaces:

- **Landing**: what Suize is, a live gallery of deployed sites, and the publish flow for
  humans (connect a wallet, pay the gasless x402 payment, drop a folder).
- **`#/sites` dashboard**: every site owned by the connected wallet, chain-derived, with
  extend, custom-domain, and allowlist management.
- **`#/view/<siteId>` viewer**: opens sealed (Seal-encrypted private) sites, decrypting
  client-side for wallets on the site's on-chain allowlist.

Everything on the page is chain-derived: the gallery and counters come from live
`deploy_sui` events, the dashboard from on-chain `Site` objects, previews from
the worker's `/preview` read. Nothing is fabricated; a read blip degrades to empty, never
to fake rows.

## Develop

```bash
bun install       # once, at the repo root
bun run dev       # vite
bun run build     # tsc -b && vite build
bun run typecheck
```

Configuration is env-only (see `src/config.ts`; ids and constants come from
[`@suize/shared`](../../packages/shared)):

| Var | Default | Meaning |
| --- | --- | --- |
| `VITE_SUI_NETWORK` | `testnet` | Only the exact string `mainnet` opts into mainnet. |
| `VITE_DEPLOY_API` | `https://api.suize.site` | The deploy worker's charge API (override for a self-hosted instance). |

## License

MIT
