# @suize/mcp

Give your AI assistant a **Suize agent wallet** — a local stdio MCP server that
lets Claude (Code / Desktop) or any MCP client **pay HTTP 402 merchants, send
USDC, read balances, and one-tap kill**, all on Sui, all gas-free for you.

**Custody law:** keys never leave your machine. The only auth is a Google sign-in
(zkLogin) popup; the only signer is the zkLogin session it returns, used locally.
There is no raw-keypair signer and no server-side signing — Suize never signs for
you.

## Install

```sh
claude mcp add suize -- npx -y @suize/mcp
```

Then, in a chat:

```
authenticate                          → browser opens; sign in with Google
what's my suize balance?              → suize_balance (shows your agent address)
pay https://api.example.com/premium   → suize_pay (settles the 402, returns the body)
send 5 USDC to 0xabc…                 → suize_pay (a direct transfer, gas-free)
```

`authenticate` blocks until sign-in completes (up to 5 min). If your client
enforces a short tool timeout, raise it (Claude Code: `MCP_TOOL_TIMEOUT`).

## Tools

| Tool | What it does |
|---|---|
| `authenticate` | Opens the Suize wallet in your browser; sign in with Google. The address you get is your **agent's own** address — fund it from your main wallet. The session lands at `~/.suize/session.json` (0600). |
| `suize_pay` | Pay in USDC two ways: `{ url }` requests a 402 resource, settles it, and returns the served body + digest; `{ payTo, amount }` sends USDC to any address. Honors the confirm dial. |
| `suize_balance` | The agent wallet's USDC balance and its own address (read-only). |
| `suize_receipts` | The agent wallet's recent outgoing USDC payments, newest first (read-only). |
| `suize_subscriptions` | The agent wallet's on-chain subscriptions with renewal dates (read-only). |
| `suize_kill` | Emergency: sweep the agent's **entire** balance back to your main wallet and disarm it. |

This is a **wallet** — it pays, reads, and kills. It is not a deploy tool:
[Suize Deploy](https://deploy.suize.io) is a plain x402 endpoint you call directly
(see [its agent contract](https://deploy.suize.io/llms.txt)), no special tool needed.

Every payment is gasless: the payment transaction draws from your Address Balance
and needs no SUI. The confirm dial (`SUIZE_CONFIRM`) gates spending — by default it
asks before each payment; you approve, then the tool retries with `confirm: true`.

## Environment

| Var | Default | Notes |
|---|---|---|
| `SUIZE_DEV` | unset | `1` flips the URL defaults to local dev. |
| `WALLET_APP_URL` | `https://wallet.suize.io` | The Suize wallet origin the sign-in opens (`/agent-connect`). |
| `SUIZE_API` | `https://api.suize.io` | The Suize x402 facilitator. |
| `SUIZE_CONFIRM` | `each` | `each` \| `auto_under_<x>` (USDC) \| `auto`. Unknown values fail closed to `each`. |
| `SUI_RPC_URL` | network fullnode | Optional gRPC fullnode base-URL override for reads. |
| `SUIZE_SESSION_PATH` | `~/.suize/session.json` | Session store override. |

## License

MIT
