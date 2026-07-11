// The ONE Sui client layer for the backend.
//
// Mysten retired the public JSON-RPC fullnode (mid-2026); the official transports
// are now gRPC and GraphQL. Every backend module builds its Sui client HERE so the
// transport + network resolution live in a single place (the single-source-of-truth
// rule) instead of six `new SuiJsonRpcClient` constructions.
//
//   • gRPC (SuiGrpcClient) is the default for ALL core reads/writes: object reads,
//     balances, coins, owned objects, name resolution, tx execution + wait.
//   • GraphQL (SuiGraphQLClient) is used ONLY for the genuinely indexer-shaped reads
//     gRPC core cannot express — transaction-by-address listing (the directory feed)
//     and event-by-type queries (the deploy SiteCreated/Domain* scans). Both were
//     verified live against the network's official GraphQL endpoint.
//
// The facilitator SETTLE path (packages/x402 + facilitator) already speaks gRPC; this
// module mirrors its call shapes for the rest of the backend.
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { graphqlUrl, type TreasuryResolver } from "@suize/shared";
import { config } from "./config";

/**
 * A gRPC client for the configured network. `url` defaults to the primary gRPC base
 * (config.suiRpcUrl, from SUI_RPC_URL[S] or the shared grpcUrl default); pass a
 * specific base for the directory's multi-endpoint fallback. One client per url is
 * the caller's concern (modules memoize their own).
 */
export const grpcClient = (url: string = config.suiRpcUrl): SuiGrpcClient =>
  new SuiGrpcClient({ network: config.suiNetwork, baseUrl: url });

/**
 * The GraphQL client for the configured network — for the indexer-shaped reads ONLY
 * (transaction-by-address, event-by-type). Host from `@suize/shared` graphqlUrl().
 */
export const graphqlClient = (): SuiGraphQLClient =>
  new SuiGraphQLClient({ url: graphqlUrl(config.suiNetwork), network: config.suiNetwork });

// ── SuiNS name resolution ─────────────────────────────────────────────────────
// gRPC exposes forward (name→address) via NameService.lookupName and reverse
// (address→default name) via defaultNameServiceName; the JSON-RPC
// `resolveNameServiceAddress` / `resolveNameServiceNames` no longer exist.

/**
 * Forward-resolve a SuiNS name → its target address over gRPC. `name` accepts the
 * dotted `name.sui` or the `@name` form. Null on miss / any error (callers of the
 * treasury path fail-closed on null).
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

/**
 * Reverse-resolve an address → its DEFAULT SuiNS name (dotted form) over gRPC. Null
 * when the address has no reverse record (gRPC throws NOT_FOUND) or on any error.
 * (The JSON-RPC path returned every name; the gRPC reverse returns only the default,
 * which — after a `set_reverse_lookup` — is exactly the user's chosen handle.)
 */
export const reverseName = async (
  client: SuiGrpcClient,
  address: string,
): Promise<string | null> => {
  try {
    return (await client.defaultNameServiceName({ address })).data.name;
  } catch {
    return null;
  }
};

/**
 * Adapt a gRPC client to the shared `TreasuryResolver` (which expects a
 * `resolveNameServiceAddress`, present on the browser's dapp-kit client but not on
 * the gRPC client). Lets `resolveTreasury(treasuryResolver(client))` keep working
 * unchanged across both runtimes.
 */
export const treasuryResolver = (client: SuiGrpcClient): TreasuryResolver => ({
  resolveNameServiceAddress: async ({ name }) => resolveNameAddress(client, name),
});

// ── GraphQL: event-by-type paging (gRPC core has no queryEvents) ───────────────
// One page of a Move-event-type query, NEWEST-FIRST — the replacement for the old
// `queryEvents({ query: { MoveEventType }, order: 'descending', cursor })`. The
// deploy module's SiteCreated / Domain* scans page through these.

/** A chain event distilled to what the deploy scans read: the Move struct as JSON,
 *  the emitter, and the checkpoint timestamp (ms). */
export interface ChainEvent {
  json: Record<string, unknown>;
  sender: string | null;
  timestampMs: number;
}

const EVENTS_QUERY = `query($type: String!, $before: String) {
  events(last: 50, before: $before, filter: { type: $type }) {
    pageInfo { hasPreviousPage startCursor }
    nodes { timestamp sender { address } contents { json } }
  }
}`;

/**
 * One NEWEST-FIRST page of events of a given Move type. `before` pages further back
 * (older); pass the returned `cursor`. `hasMore` is true when older pages remain.
 * Throws on a GraphQL error (the caller surfaces a 502, matching the old queryEvents
 * failure semantics).
 */
export const queryEventPage = async (
  gql: SuiGraphQLClient,
  type: string,
  before?: string | null,
): Promise<{ events: ChainEvent[]; hasMore: boolean; cursor: string | null }> => {
  const res = (await gql.query({
    query: EVENTS_QUERY as never,
    variables: { type, before: before ?? null },
  })) as {
    errors?: { message: string }[];
    data?: {
      events?: {
        pageInfo?: { hasPreviousPage?: boolean; startCursor?: string | null };
        nodes?: {
          timestamp?: string | null;
          sender?: { address?: string | null } | null;
          contents?: { json?: Record<string, unknown> | null } | null;
        }[];
      } | null;
    };
  };
  if (res.errors?.length) throw new Error(`graphql events: ${res.errors[0].message}`);
  const conn = res.data?.events;
  // GraphQL returns the `last: N` window oldest→newest; reverse for newest-first.
  const nodes = (conn?.nodes ?? []).slice().reverse();
  return {
    events: nodes.map((n) => ({
      json: (n.contents?.json ?? {}) as Record<string, unknown>,
      sender: n.sender?.address ?? null,
      timestampMs: n.timestamp ? Date.parse(n.timestamp) : 0,
    })),
    hasMore: Boolean(conn?.pageInfo?.hasPreviousPage),
    cursor: conn?.pageInfo?.startCursor ?? null,
  };
};
