/**
 * The ONE gRPC client for the wallet's GASLESS send path.
 *
 * The vanilla-x402 'exact' scheme settles a P2P USDC transfer as a gasless
 * Address-Balance `send_funds` PTB (`@suize/x402` buildGaslessOutputs) — the
 * transport that bakes in the gasless params (gasPrice=0, gasPayment=[]) is the
 * SuiGrpcClient, not the JSON-RPC client dapp-kit hands out. We keep a single
 * lazily-built client (mirrors the backend facilitator's singleton) so building
 * + executing the gasless send share one connection.
 *
 * NOTE: this is ONLY for the gasless send/agent-fund path. Reads (balances, subs,
 * events) stay on dapp-kit's JSON-RPC `useSuiClient()`; subscription writes ride
 * the WS sponsor path (`sponsored.ts`). The split is deliberate — one transport
 * per concern.
 */

import { grpcClient as makeGrpcClient } from '@suize/x402';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { caip2 } from '@suize/shared';
import { NETWORK } from '../lib/env';

let _client: SuiGrpcClient | null = null;

/** The gasless-transport gRPC client for the wallet's network (testnet today). */
export function grpc(): SuiGrpcClient {
  if (!_client) _client = makeGrpcClient(caip2(NETWORK));
  return _client;
}
