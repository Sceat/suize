import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { AppProviders } from './app/providers';
import { App } from './app/App';
import './styles/index.css';

// OAuth return path. With Enoki configured (production keys ARE present), Google
// redirects to `${origin}/enoki` after sign-in (the uri registered in the OAuth
// client + set in providers.tsx). Enoki's wallet-standard provider parses the URL
// params internally on load; this single-page app has no router, so we give Enoki a
// moment to flush, then drop the user back on `/` — where autoConnect restores the
// connected zkLogin session, the identity gate runs, and the wallet (live testnet
// package) loads. Harmless if we ever land here without an Enoki redirect.
if (typeof window !== 'undefined' && window.location.pathname.startsWith('/enoki')) {
  window.setTimeout(() => {
    window.history.replaceState({}, '', '/');
  }, 600);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
    <Analytics />
  </StrictMode>,
);
