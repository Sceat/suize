// E2E test setup — REAL TESTNET, real keys, real coins. Gated on SUIZE_E2E=1
// (see E2E_ENABLED): without the explicit opt-in every e2e suite skips cleanly,
// so a plain `bun test` can never accidentally spend testnet funds.
//
// PAYER KEY RESOLUTION (never printed, never logged — only the derived address):
//   1. SUIZE_E2E_PAYER_KEY / AGENT_KEY env — a bech32 `suiprivkey…`, the same
//      convention as scripts/deploy-as-agent.ts.
//   2. The Sui CLI keystore (~/.sui/sui_config): the `active_address` from
//      client.yaml matched against the ed25519 entries of sui.keystore — i.e.
//      "whatever `sui client active-address` says", the dev wallet the rail was
//      published from.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { grpcUrl } from "@suize/shared";

/** The explicit opt-in. Anything but the literal "1" keeps e2e suites skipped. */
export const E2E_ENABLED = process.env.SUIZE_E2E === "1";

/** The rail under test is the TESTNET publish (mainnet is the v1 gate) — the
 * e2e is network-PINNED so a suite-wide env flip can never point it at mainnet
 * funds. Env override for the RPC endpoint only. */
export const E2E_NETWORK = "testnet" as const;

// NOTE: the e2e suites (opt-in via SUIZE_E2E=1, funded keys) still use the
// JSON-RPC client + shapes. The public JSON-RPC fullnode is retired, so they need a
// transport migration to gRPC to run live again — DEFERRED per the "do not run them"
// directive; the `grpcUrl` host string below is identical to the old fullnode host.
export const e2eClient = (): SuiJsonRpcClient =>
  new SuiJsonRpcClient({
    url: process.env.SUI_RPC_URL ?? grpcUrl(E2E_NETWORK),
    network: E2E_NETWORK,
  });

const SUI_CONFIG_DIR = join(homedir(), ".sui", "sui_config");

/** Decode one base64 keystore entry (33 bytes: scheme flag ‖ 32-byte secret).
 * Returns null for non-ed25519 schemes (flag != 0x00). */
const keypairFromKeystoreEntry = (entry: string): Ed25519Keypair | null => {
  const raw = Buffer.from(entry, "base64");
  if (raw.length !== 33 || raw[0] !== 0x00) return null;
  return Ed25519Keypair.fromSecretKey(new Uint8Array(raw.subarray(1)));
};

/**
 * Load the payer keypair — env key first, CLI keystore second (see header).
 * Throws with an ACTIONABLE message when neither yields a key. NEVER prints or
 * returns raw key material beyond the keypair object itself.
 */
export const loadPayerKeypair = (): Ed25519Keypair => {
  const envKey = process.env.SUIZE_E2E_PAYER_KEY ?? process.env.AGENT_KEY;
  if (envKey) return Ed25519Keypair.fromSecretKey(envKey.trim());

  let activeAddress: string | undefined;
  let entries: string[] = [];
  try {
    const clientYaml = readFileSync(join(SUI_CONFIG_DIR, "client.yaml"), "utf8");
    activeAddress = /active_address:\s*"?(0x[0-9a-fA-F]+)"?/.exec(clientYaml)?.[1];
    entries = JSON.parse(readFileSync(join(SUI_CONFIG_DIR, "sui.keystore"), "utf8")) as string[];
  } catch {
    // fall through to the throw below with the full how-to.
  }

  for (const entry of entries) {
    try {
      const kp = keypairFromKeystoreEntry(entry);
      if (!kp) continue;
      if (!activeAddress || kp.toSuiAddress().toLowerCase() === activeAddress.toLowerCase()) {
        return kp;
      }
    } catch {
      // skip undecodable entries
    }
  }

  throw new Error(
    "e2e payer key not found: set SUIZE_E2E_PAYER_KEY=suiprivkey1… (or AGENT_KEY), " +
      "or configure the Sui CLI keystore (~/.sui/sui_config) with an ed25519 active address",
  );
};

/** USDC balance (base units) of `owner` for the given coin type. */
export const coinBalance = async (
  client: SuiJsonRpcClient,
  owner: string,
  coinType: string,
): Promise<bigint> => {
  const b = await client.getBalance({ owner, coinType });
  return BigInt(b.totalBalance);
};

/** The crisp manual step when the payer holds no testnet USDC — the Circle
 * faucet's GraphQL endpoint is reCAPTCHA-gated server-side (verified 2026-06-10:
 * POST /api/graphql without a token → RECAPTCHA_ERROR), so funding is a human
 * step. One 10-USDC drip funds ~100 runs of this suite. */
export const faucetHelp = (address: string): string =>
  `\nNO TESTNET USDC — the e2e payer holds none of the settlement coin.\n` +
  `  fund ${address}\n` +
  `  at https://faucet.circle.com → select network "Sui Testnet" → paste the address → submit\n` +
  `  (programmatic path is reCAPTCHA-gated; one manual 10-USDC drip funds ~100 runs)\n` +
  `then re-run: SUIZE_E2E=1 bun test ./test/e2e/facilitator.x402.e2e.ts\n`;
