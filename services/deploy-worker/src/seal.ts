// Seal encryption for SEALED (private) deploys — the publish-side half of the
// private-sites feature. Every file's bytes are encrypted under ONE identity,
//   id = <allowlist object id hex> + "01"
// (the allowlist id bytes are the on-chain namespace `seal_approve` checks;
// the trailing 0x01 byte is a format-version nonce). The viewer decrypts
// client-side after a wallet-signed session key passes `seal_approve` — this
// worker can encrypt but never decrypt (it is not on anyone's allowlist).
//
// Threshold is the per-network SEAL_THRESHOLD (shared) — the SAME number the
// viewer fetches keys with: 2-of-2 on testnet, 2-of-3 on the live mainnet
// committee. The fail-closed guard below stays for any network with an empty
// server list: sealed deploys there are rejected with a clear reason, never
// encrypted against a nonexistent committee.

import { SealClient } from "@mysten/seal";
import { SEAL_KEY_SERVERS, SEAL_THRESHOLD } from "@suize/shared";
import { suiClient } from "./chain";
import { network, type Env } from "./env";

export class SealUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealUnavailableError";
  }
}

// One SealClient per isolate+network (construction is cheap but its internal
// key-server state benefits from reuse; the ENCRYPT side holds no viewer keys).
let _seal: SealClient | null = null;
let _sealKey = "";

const sealClient = (env: Env): SealClient => {
  const net = network(env);
  const servers = SEAL_KEY_SERVERS[net];
  if (servers.length === 0) {
    throw new SealUnavailableError(
      `private sites are not yet available on ${net} (no verified Seal key servers)`,
    );
  }
  if (!_seal || _sealKey !== net) {
    _seal = new SealClient({
      suiClient: suiClient(env) as never,
      serverConfigs: servers.map((objectId) => ({ objectId, weight: 1 })),
      verifyKeyServers: false,
    });
    _sealKey = net;
  }
  return _seal;
};

/** The full Seal identity (hex, no 0x) for a site's allowlist. */
export const sealIdentity = (allowlistId: string): string =>
  allowlistId.replace(/^0x/, "").toLowerCase() + "01";

/**
 * Encrypt one file's bytes under the site's allowlist identity. The Seal
 * package id is the deploy_sui package (the allowlist module lives there —
 * key servers dry-run `deploy_sui::allowlist::seal_approve`).
 */
export const sealEncrypt = async (
  env: Env,
  deployPackageId: string,
  allowlistId: string,
  data: Uint8Array,
): Promise<Uint8Array> => {
  const { encryptedObject } = await sealClient(env).encrypt({
    threshold: SEAL_THRESHOLD[network(env)],
    packageId: deployPackageId,
    id: sealIdentity(allowlistId),
    data,
  });
  return encryptedObject;
};
