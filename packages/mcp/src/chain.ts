// One place builds the read clients. The network comes from the PERSISTED SESSION
// (the /agent-connect payload carries it) — never hardcoded here. `grpcUrl`,
// `graphqlUrl`, and `SuiNetwork` are the zero-dep inlined mirrors in config.ts.
//
// Ledger reads (balance, owned objects, system state) go over gRPC — the SDK's
// recommended transport, and the one the public fullnode host now speaks after
// retiring JSON-RPC. Indexer-style reads gRPC does not serve (the agent's own tx
// history) go over the Sui GraphQL RPC via a tiny raw-fetch helper — no extra dep.
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { graphqlUrl, grpcUrl, RPC_URL_OVERRIDE, type SuiNetwork } from './config'

export const grpcClient = (network: SuiNetwork): SuiGrpcClient =>
  new SuiGrpcClient({ network, baseUrl: RPC_URL_OVERRIDE ?? grpcUrl(network) })

/** One Sui GraphQL RPC query (raw fetch — JSON over HTTP, no SDK client dep). Throws
 * on a GraphQL `errors` body so a failed read propagates to the caller (fail closed). */
export const graphqlQuery = async <T>(
  network: SuiNetwork,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> => {
  const res = await fetch(graphqlUrl(network), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const body = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> }
  if (body.errors?.length) throw new Error(`graphql: ${body.errors[0]?.message ?? 'query error'}`)
  return body.data as T
}
