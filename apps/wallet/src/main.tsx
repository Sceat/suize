import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { AppProviders } from './app/providers';
import { App } from './app/App';
import { ConfirmPay } from './bridge/ConfirmPay';
import { ConfirmSubscribe } from './bridge/ConfirmSubscribe';
import { AgentConnect, hasPendingAgentConnect } from './bridge/AgentConnect';
import './styles/index.css';

// The SSO money gates other *.suize.io products open as a popup:
//   /confirm           — a one-off payment (bridge/ConfirmPay).
//   /confirm-subscribe — set up / cancel a subscription (bridge/ConfirmSubscribe).
// Sign-in inside these popups is the Enoki SDK's OWN popup — the window stays
// open and its session updates reactively, so there is no /enoki round-trip to
// resume here.
const isPath = (p: string) => typeof window !== 'undefined' && window.location.pathname.startsWith(p);

const showConfirm = isPath('/confirm') && !isPath('/confirm-subscribe');
const showSubscribe = isPath('/confirm-subscribe');
// /agent-connect — the agent sign-in door (in-app `?arm=1` + the MCP `?cb=&tok=`).
// Its OAuth reuses the registered `/enoki` redirect URI, so the agent return lands
// on `/enoki` while our stash is live — route THAT back here too.
const enokiResumesAgent = isPath('/enoki') && hasPendingAgentConnect();
const showAgentConnect = isPath('/agent-connect') || enokiResumesAgent;

// OAuth return path. Enoki's `registerEnokiWallets` login is a POPUP whose
// redirect_uri is `${origin}/enoki`; the opener reads the token and closes that
// popup. If a popup ever lingers on `/enoki`, tidy its URL back to `/` — the
// session is already restored by then. (Skip when an agent OAuth is resuming on
// `/enoki` — AgentConnect owns that return and will close/redirect itself.)
if (
  typeof window !== 'undefined' &&
  window.location.pathname.startsWith('/enoki') &&
  !enokiResumesAgent
) {
  window.setTimeout(() => {
    window.history.replaceState({}, '', '/');
  }, 600);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      {showAgentConnect ? (
        <AgentConnect />
      ) : showSubscribe ? (
        <ConfirmSubscribe />
      ) : showConfirm ? (
        <ConfirmPay />
      ) : (
        <App />
      )}
    </AppProviders>
    <Analytics />
  </StrictMode>,
);
