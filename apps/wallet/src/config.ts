import { grpcUrl, graphqlUrl, resolveNetwork, type SuiNetwork } from '@suize/shared'
import { SuiGrpcClient } from '@mysten/sui/grpc'

export const NETWORK: SuiNetwork = resolveNetwork(import.meta.env.VITE_SUI_NETWORK)
export const GRPC_URL = grpcUrl(NETWORK)
export const GRAPHQL_URL = graphqlUrl(NETWORK)

export const suiClient = new SuiGrpcClient({
  network: NETWORK,
  baseUrl: GRPC_URL,
})
