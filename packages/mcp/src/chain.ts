// One place builds the read-only RPC client. The network comes from the
// PERSISTED SESSION (the /agent-connect payload carries it) — never hardcoded
// here. `fullnodeUrl` + `SuiNetwork` are the zero-dep inlined mirrors in config.ts.
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { fullnodeUrl, RPC_URL_OVERRIDE, type SuiNetwork } from './config'

export const rpcClient = (network: SuiNetwork): SuiJsonRpcClient =>
  new SuiJsonRpcClient({ url: RPC_URL_OVERRIDE ?? fullnodeUrl(network), network })
