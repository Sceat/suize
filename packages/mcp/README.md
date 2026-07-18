# @suize/mcp

A local stdio MCP server that gives your coding assistant (Claude Code / Cursor /
Codex) a **`deploy_site` tool**: point it at a built static folder and it publishes
to [Walrus](https://www.walrus.xyz) through [Suize](https://suize.io), returning a
live URL. It pays a flat rate in USDC over an x402-compatible HTTP 402 challenge.
By default **your Sui CLI holds the key and does the signing** (Suize just asks it
to sign a payment), so the key never enters this process. Whoever pays owns the
site: there's no account, no signup, no hosted login.

The rail is **gasless**: the payment draws from your USDC Address Balance and pays
no gas, so you need **no SUI, only USDC**.

## Install

```sh
claude mcp add suize -- npx -y @suize/mcp
```

That sets no environment, so the MCP signs through your **Sui CLI** by default:
it resolves the key aliased `suize` and asks `sui keytool sign` to sign each
payment. If you don't already have that alias, create a dedicated key (your coding
agent can run this for you):

```sh
sui client new-address ed25519 suize
```

Fund the address it prints with USDC on Sui mainnet (the hosted charge door is
mainnet). Then just ask your assistant to deploy:

```
publish ./dist
```

It answers the 402, pays $0.25 for a month of hosting, and returns the live URL.

## Tools

| Tool | What it does |
|---|---|
| `deploy_site` | Publish a built static folder (`{ dir }`, e.g. `./dist`) to Walrus and return a live URL + Site ID. `{ months }` prepays hosting (default 1, $0.25/month, up to about two years per payment on mainnet); `{ private: true }` deploys a Seal-encrypted site only wallets you allow can open (2x rate); `{ name }` labels it. The payer is the on-chain owner. |
| `list_sites` | List every site you've deployed (found on-chain by your key's address), newest first, each with its name, Site ID, and URL. |
| `extend_site` | Buy more hosting time for a site you own: `{ siteId }` + `{ months }`. Pays $0.25/month (2x for private). |
| `site_status` | Show a site's current state: URL, owner, size, and how long its hosting is paid through (active or lapsed). Pass `{ siteId }`. |
| `link_domain` | Link a custom domain to a site you own: `{ siteId, domain }`. First run returns the DNS records to set (TXT + CNAME); once DNS verifies, the same call pays $19.99/year and links the domain on-chain with automatic SSL. Re-runs are free and idempotent; only the final link charges, signed by the site owner's key. |
| `repoint_domain` | Move an already-linked domain onto another site you own: `{ domain, newSiteId }`. Free, no new charge. Auth is a personal message signed by the key that owns both sites, so it needs `SUIZE_KEY` / `SUIZE_KEY_FILE` (the Sui CLI signer cannot sign personal messages). |
| `domain_status` | A domain's link state for a site: linked, waiting on DNS (with the exact records still missing), or verified-but-unlinked. Free, never pays. |

## Non-custodial by construction

The Sui CLI keeps your key; Suize just asks it to sign. The key never enters this
process, never leaves your machine, and Suize never holds it or signs for you. The
address that pays is the address that owns every site it deploys: **whoever pays,
owns.**

## Overrides

The keystore default fits most users. For CI or a self-hosted setup, override the
signer or the network at install time:

```sh
# preferred: a key in a file, kept out of shell history and process env dumps
claude mcp add suize -e SUIZE_KEY_FILE=~/.suize/key -- npx -y @suize/mcp
```

Or in `.mcp.json`:

```jsonc
{
  "mcpServers": {
    "suize": {
      "command": "npx",
      "args": ["-y", "@suize/mcp"],
      "env": {
        "SUIZE_KEY_FILE": "~/.suize/key",
        "SUIZE_NETWORK": "mainnet"
      }
    }
  }
}
```

| Var | Default | Notes |
|---|---|---|
| `SUIZE_CLI_ALIAS` | `suize` | Which Sui CLI alias to sign with. |
| `SUIZE_SUI_BIN` | `sui` | Path to the `sui` binary, if it isn't on PATH. |
| `SUIZE_SUI_CONFIG_DIR` | CLI default | Sui config dir; passed to the CLI as `SUI_CONFIG_DIR`. |
| `SUIZE_KEY_FILE` | unset | Path to a file holding a `suiprivkey1…` key, signed in-process. **Preferred over `SUIZE_KEY`**: keeps the key out of shell history and env dumps. |
| `SUIZE_KEY` | unset | A `suiprivkey1…` key directly, signed in-process. Avoid inline values (they land in shell history); use a placeholder and a file where you can. |
| `SUIZE_NETWORK` | `mainnet` | `mainnet` or `testnet` (pair with `SUIZE_API` pointed at a self-hosted testnet instance). |
| `SUIZE_API` | `https://api.suize.site` | The charge door (override for a self-hosted / testnet instance). |
| `SUIZE_GRAPHQL` | per-network | Sui GraphQL endpoint override for reads. |

Resolution order for the signer: `SUIZE_KEY` → `SUIZE_KEY_FILE` → the Sui CLI
external signer. Never paste a raw `suiprivkey1…` on a command line in a shared or
recorded shell; use `SUIZE_KEY_FILE`.

## License

MIT
