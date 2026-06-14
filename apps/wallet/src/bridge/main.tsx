/**
 * The /bridge iframe entry — a SEPARATE vite entry (bridge.html) so embedding
 * products load only the provider stack + the headless host, never the wallet
 * UI. Same origin as the wallet → the same Enoki session restores silently
 * (dapp-kit autoConnect), which is the whole point of the bridge.
 *
 * Served at wallet.suize.io/bridge (vercel rewrite → /bridge.html, with a
 * frame-ancestors CSP restricted to the suite's origins). The PWA service
 * worker denylists this path from its SPA navigation fallback.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from '../app/providers';
import { BridgeHost } from './BridgeHost';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <BridgeHost />
    </AppProviders>
  </StrictMode>,
);
