/**
 * Provider stack — REAL dapp-kit + Enoki, wired for TESTNET (production keys).
 *
 * Production keys are present (`VITE_ENOKI_API_KEY` + `VITE_GOOGLE_CLIENT_ID`) and
 * the wallet Move package is LIVE on testnet (`@suize/shared` PACKAGE_IDS.WALLET),
 * so this is the real stack: the SuiClient (testnet), QueryClient, dapp-kit
 * Sui+Wallet providers, and a real `registerEnokiWallets` that injects the Google
 * zkLogin wallet. `autoConnect` restores the session after the /enoki round-trip,
 * and the backend sponsors gas on every mandate/vault write.
 *
 * Defensive fallback: if the Enoki creds are somehow absent at runtime, registration
 * is skipped and `useAuth.signInWithGoogle` THROWS (App.tsx redirects to suize.io) —
 * there is no fake-session path anymore.
 */

import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuiClientProvider, WalletProvider, createNetworkConfig } from '@mysten/dapp-kit';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { registerEnokiWallets, isEnokiNetwork } from '@mysten/enoki';
import { grpcUrl } from '@suize/shared';
import { ENOKI_API_KEY, GOOGLE_CLIENT_ID, NETWORK, RPC_URL } from '../lib/env';
import { ThemeProvider } from '../system';

import '@mysten/dapp-kit/dist/index.css';

// @mysten/sui@2.x: network config needs both a url and the network name. The
// env-selected network (NETWORK) carries the env RPC override (RPC_URL); the
// other keeps its public fullnode.
const { networkConfig } = createNetworkConfig({
  mainnet: { url: NETWORK === 'mainnet' ? RPC_URL : grpcUrl('mainnet'), network: 'mainnet' },
  testnet: { url: NETWORK === 'testnet' ? RPC_URL : grpcUrl('testnet'), network: 'testnet' },
});

const queryClient = new QueryClient();

/**
 * Registers Enoki's seedless Google wallet into dapp-kit. Production keys are
 * present, so this fires; the defensive credential check below only guards the
 * (unexpected) missing-key case, where registration is a no-op and sign-in throws.
 */
function RegisterEnoki() {
  // We deliberately read the network from our env constant; the SuiClient below
  // matches it. Enoki only supports a subset of networks (mainnet/testnet/devnet).
  useEffect(() => {
    if (!ENOKI_API_KEY || !GOOGLE_CLIENT_ID) return;
    if (!isEnokiNetwork(NETWORK)) return;

    const client = new SuiGrpcClient({
      baseUrl: RPC_URL,
      network: NETWORK,
    });
    const { unregister } = registerEnokiWallets({
      apiKey: ENOKI_API_KEY,
      providers: {
        google: {
          clientId: GOOGLE_CLIENT_ID,
          // Google returns the user to this EXACT uri after auth; it must be in the
          // OAuth client's "Authorized redirect URIs" or Google rejects with
          // redirect_uri_mismatch. `${origin}/enoki` is the path the shared OAuth
          // client whitelists (mirrors crashsui); main.tsx flushes it back to /.
          redirectUrl:
            typeof window !== 'undefined'
              ? `${window.location.origin}/enoki`
              : undefined,
        },
      },
      client,
      network: NETWORK,
    });
    return unregister;
  }, []);

  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const enokiConfigured = useMemo(() => Boolean(ENOKI_API_KEY && GOOGLE_CLIENT_ID), []);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SuiClientProvider networks={networkConfig} defaultNetwork={NETWORK}>
          {enokiConfigured && <RegisterEnoki />}
          <WalletProvider autoConnect>{children}</WalletProvider>
        </SuiClientProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
