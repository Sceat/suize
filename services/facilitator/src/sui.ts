// The Sui transport for the Worker — ONE gRPC client + SuiNS forward-resolution.
//
// Mysten retired the public JSON-RPC fullnode; the transport is gRPC (gRPC-web over
// fetch), which is exactly what runs on Cloudflare's `workerd` runtime — the
// simulate/execute/read round-trips the facilitator needs all work here (proven on
// workerd during the T-001 spike). We build ONE client per isolate, keyed on the
// configured base url (a deployment has a single url), so the transport is created
// lazily and reused across requests.

import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { SuiNetwork } from "@suize/shared";

let _client: SuiGrpcClient | null = null;
let _clientUrl = "";

/** The one gRPC client for this isolate. Rebuilt only if the base url changes
 * (never, in a normal deployment). */
export const grpcClient = (network: SuiNetwork, baseUrl: string): SuiGrpcClient => {
  if (!_client || _clientUrl !== baseUrl) {
    _client = new SuiGrpcClient({ network, baseUrl });
    _clientUrl = baseUrl;
  }
  return _client;
};

/**
 * Forward-resolve a SuiNS name → its target address over gRPC. `name` is the dotted
 * `name.sui` form (see fees.ts `dottedName`). Returns null on a miss / any error —
 * the treasury path fails closed on null (it never falls back to a literal address).
 */
export const resolveNameAddress = async (
  client: SuiGrpcClient,
  name: string,
): Promise<string | null> => {
  try {
    const rec = (await client.nameService.lookupName({ name })).response.record;
    return rec?.targetAddress ?? null;
  } catch {
    return null;
  }
};
