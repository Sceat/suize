/**
 * /agent-connect — the agent sign-in door. TWO entries, ONE identity:
 *
 *   • IN-APP (`?arm=1`) — the wallet's own "Create sub-account" button. No MCP, no
 *     callback: we just mint the agent identity and persist the members locally.
 *   • MCP (`?cb=<loopback>&tok=<one-time>`) — the CHARGE-side / dev integration:
 *     the `@suize/mcp` on the user's machine also POSTs the session to its loopback.
 *
 * BOTH sign in with Google under a SECOND, DISTINCT zkLogin client
 * (`VITE_GOOGLE_AGENT_CLIENT_ID`) — NEVER the main wallet session — so the AGENT key
 * is its OWN identity (a different `aud`). Because zkLogin addresses are
 * deterministic from (Google account + client), the in-app wallet and the MCP, each
 * signing into the SAME agent identity, derive the IDENTICAL agent key → the
 * IDENTICAL sub-account. That is what lets ONE sub-account work from both surfaces.
 *
 * The agent's spendable balance is NOT this bare address: it is the 1-of-2 MULTISIG
 * sub-account over { MAIN wallet key, AGENT key } (`@suize/x402` formAgentSubaccount),
 * so EITHER member can sign alone — the AI spends, and the human withdraws in one tap.
 * Because this page runs in the wallet origin, the MAIN session is present here: we
 * capture the MAIN public key (on the entry leg, before the agent OAuth navigates
 * away) and, on return, persist { mainPubKey, agentPubKey } to the wallet store so the
 * wallet derives the identical address with no shared trusted state. The MCP entry
 * ALSO POSTs `mainPubKey` to its callback so the MCP re-derives the same sub-account.
 *
 * The POSTed v1 session payload is the EXACT shape `@suize/mcp`'s
 * `validateSessionPayload` expects (address, network, maxEpoch, expiresAt,
 * randomness, ephemeralKeyPair, publicKey, proof) — now additively carrying
 * `mainPubKey`; the MCP persists it locally (~/.suize/session.json) to sign 402
 * payments locally.
 *
 * WHY THE LOW-LEVEL EnokiFlow (not the dapp-kit wallet): capturing the SERIALIZABLE
 * session material (the ephemeral secret + the zk proof) is only possible through
 * the Enoki SDK's own flow — the dapp-kit wallet wrapper deliberately hides it. We
 * keep this flow ISOLATED to this page so the rest of the wallet stays on dapp-kit.
 *
 * STATUS — STUB(agent-connect): the SECOND Enoki OAuth client is not registered in
 * the Enoki dashboard yet, so `GOOGLE_AGENT_CLIENT_ID` is empty in this build and
 * the page renders the not-configured state. Everything ELSE (the cb/tok parse, the
 * EnokiFlow auth round-trip, the v1-payload assembly + POST) is wired and runs the
 * moment the client id is set + registered — no code change needed.
 */

import { useEffect, useRef, useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { EnokiFlow } from '@mysten/enoki';
import { toBase64 } from '@mysten/sui/utils';
import { publicKeyFromRawBytes, publicKeyFromSuiBytes } from '@mysten/sui/verify';
import { ENOKI_API_KEY, GOOGLE_AGENT_CLIENT_ID, NETWORK } from '../lib/env';
import { setAgentMembers } from '../data/payStore';
import { Loader } from '../system';
import '../ui/rd.css';

/** Where we stash cb+tok across the OAuth full-page redirect (this origin). */
const STASH_KEY = 'suize:agent-connect-pending';

interface Pending {
  /** MCP callback + correlation token — ABSENT for the in-app arm (`inApp`). */
  cb?: string;
  tok?: string;
  /** true = the wallet's own "Create sub-account" arm (persist members, return home;
   *  no MCP POST). false/absent = the MCP door (also POSTs the session to `cb`). */
  inApp?: boolean;
  /** The MAIN wallet owner address (the per-owner key for the wallet's members store),
   *  captured on the entry leg before the agent OAuth navigates away. */
  mainAddress: string;
  /** The MAIN session's zkLogin public key, Sui-serialized (`toSuiPublicKey()`) — the
   *  OTHER member of the agent's 1-of-2 sub-account multisig. */
  mainPubKey: string;
}

/** True once BOTH the agent client id and the Enoki key are present (else the
 *  not-configured state). The dashboard registration of the 2nd client is the
 *  remaining external step — STUB(agent-connect). */
const AGENT_ENABLED = Boolean(GOOGLE_AGENT_CLIENT_ID && ENOKI_API_KEY);

/** Read + validate `?cb=&tok=`. `cb` must be a loopback http(s) URL (the MCP's
 *  local callback); `tok` is the one-time correlation token. The MAIN member is
 *  added by the caller (it needs the live wallet session). */
function readParams(): Pick<Pending, 'cb' | 'tok'> | null {
  const q = new URLSearchParams(window.location.search);
  const cb = (q.get('cb') ?? '').trim();
  const tok = (q.get('tok') ?? '').trim();
  if (!cb || !tok) return null;
  try {
    const u = new URL(cb);
    const isLoopback =
      u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (!isLoopback || (u.protocol !== 'http:' && u.protocol !== 'https:')) return null;
  } catch {
    return null;
  }
  return { cb, tok };
}

const readStash = (): Pending | null => {
  try {
    const raw = sessionStorage.getItem(STASH_KEY);
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
};
const writeStash = (p: Pending) => {
  try {
    sessionStorage.setItem(STASH_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
};
const clearStash = () => {
  try {
    sessionStorage.removeItem(STASH_KEY);
  } catch {
    /* nothing stashed */
  }
};

/** True while an agent OAuth is mid-flight (entry stashed, awaiting the /enoki
 *  return). The agent flow redirects to the SAME registered `/enoki` URI as the
 *  main login (no separate redirect URI to authorize), so main.tsx uses this to
 *  route that return to AgentConnect instead of booting the wallet. */
export function hasPendingAgentConnect(): boolean {
  try {
    return sessionStorage.getItem(STASH_KEY) != null;
  } catch {
    return false;
  }
}

type Stage =
  | { step: 'idle' }
  | { step: 'authing' }
  | { step: 'finishing' }
  | { step: 'done'; address: string; inApp?: boolean }
  | { step: 'error'; message: string }
  | { step: 'not-configured' }
  | { step: 'no-params' }
  | { step: 'need-wallet' };

/** How long the entry leg waits for the MAIN wallet session (autoConnect) before it
 *  tells the user to sign into the wallet first — the MAIN key is a required member. */
const ACCOUNT_WAIT_MS = 4_000;

export function AgentConnect() {
  const [stage, setStage] = useState<Stage>({ step: 'idle' });
  const flowRef = useRef<EnokiFlow | null>(null);
  // The MAIN wallet session (this page runs in the wallet origin, under AppProviders),
  // restored async by autoConnect — it is the OTHER member of the agent sub-account.
  const account = useCurrentAccount();

  // One EnokiFlow under the AGENT client (a fresh sessionStorage-backed store, so
  // it NEVER touches the main wallet's session). Built lazily, once.
  const flow = (): EnokiFlow => {
    if (!flowRef.current) {
      flowRef.current = new EnokiFlow({ apiKey: ENOKI_API_KEY });
    }
    return flowRef.current;
  };

  // IN-APP arm: derive the agent identity from the just-completed OAuth session and
  // persist BOTH members so the wallet derives the sub-account. No MCP callback.
  const persistInApp = async (p: Pending): Promise<string> => {
    const f = flow();
    const session = await f.getSession();
    if (!session) throw new Error('No agent session — sign-in did not complete.');
    const keypair = await f.getKeypair({ network: NETWORK });
    const agentPublic = keypair.getPublicKey();
    setAgentMembers(p.mainAddress, {
      mainPubKey: p.mainPubKey,
      agentPubKey: agentPublic.toSuiPublicKey(),
    });
    return keypair.toSuiAddress();
  };

  // POST the assembled v1 session payload to the MCP's loopback callback, AND
  // persist the sub-account members so the wallet derives the same multisig.
  const postToCallback = async (p: Pending): Promise<string> => {
    if (!p.cb || !p.tok) throw new Error('Missing agent callback.'); // MCP-only path
    const f = flow();
    const session = await f.getSession();
    if (!session) throw new Error('No agent session — sign-in did not complete.');
    const proof = session.proof ?? (await f.getProof({ network: NETWORK }));
    const keypair = await f.getKeypair({ network: NETWORK });
    const address = keypair.toSuiAddress();
    const agentPublic = keypair.getPublicKey();
    const publicKey = toBase64(agentPublic.toRawBytes());

    // The EXACT v1 shape @suize/mcp's validateSessionPayload requires, additively
    // carrying `mainPubKey` (the MAIN member of the agent's 1-of-2 sub-account).
    const payload = {
      version: 1 as const,
      provider: 'google' as const,
      network: NETWORK,
      address,
      publicKey,
      maxEpoch: session.maxEpoch,
      expiresAt: session.expiresAt,
      randomness: session.randomness,
      ephemeralKeyPair: session.ephemeralKeyPair,
      proof,
      mainPubKey: p.mainPubKey,
    };

    // FLAT shape: the MCP loopback reads `tok` (CSRF) AND validates the v1 session
    // fields on the SAME top-level object (`validateSessionPayload(parsed)`), so the
    // session fields must sit alongside `tok`, NOT nested under `session` (a nested
    // shape made `parsed.version` undefined → "unsupported payload version: undefined").
    const res = await fetch(p.cb, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tok: p.tok, ...payload }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || `the agent rejected the session (${res.status})`);
    }

    // Persist BOTH members (Sui-serialized) under the MAIN owner so the wallet
    // re-derives the identical sub-account address. The agent is now armed.
    if (p.mainAddress) {
      setAgentMembers(p.mainAddress, {
        mainPubKey: p.mainPubKey,
        agentPubKey: agentPublic.toSuiPublicKey(),
      });
    }
    return address;
  };

  // Run-once guards (each leg fires a single time despite the account-arrival re-run).
  const ranRef = useRef(false);
  const waitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (ranRef.current) return;
    if (!AGENT_ENABLED) {
      ranRef.current = true;
      setStage({ step: 'not-configured' });
      return;
    }
    const hasHash = window.location.hash.length > 1;
    const stashed = readStash();

    // RETURN leg: we came back from Google with a hash AND a stashed payload (which
    // already carries the MAIN member captured on the entry leg).
    if (hasHash && stashed) {
      ranRef.current = true;
      setStage({ step: 'finishing' });
      void (async () => {
        try {
          await flow().handleAuthCallback();
          // IN-APP: persist members, then CLOSE this arm popup — the wallet deck
          // polls `popup.closed` and re-reads the now-persisted members, so the
          // sub-account appears with no page takeover. If arming was opened
          // full-page (popup blocked → fallback), window.close() no-ops and we
          // return home after a beat instead.
          if (stashed.inApp) {
            const address = await persistInApp(stashed);
            clearStash();
            setStage({ step: 'done', address, inApp: true });
            // Signal the opener COOP-IMMUNELY. Google's OAuth pages send
            // Cross-Origin-Opener-Policy, which SEVERS the window.opener/closed link for
            // good once this popup has visited Google — so the deck can't poll
            // popup.closed. BroadcastChannel is origin-scoped (not window-reference
            // based), so it crosses the severed link and the deck re-reads the members.
            try {
              const ch = new BroadcastChannel('suize-agent-arm');
              ch.postMessage({ type: 'armed', address });
              ch.close();
            } catch {
              /* no BroadcastChannel (old browser) → the deck's storage/closed fallback covers it */
            }
            window.close();
            window.setTimeout(() => window.location.replace('/'), 600);
            return;
          }
          const address = await postToCallback(stashed);
          clearStash();
          // Clean the hash so a reload doesn't re-run the callback.
          window.history.replaceState({}, '', '/agent-connect');
          setStage({ step: 'done', address });
        } catch (e) {
          clearStash();
          setStage({ step: 'error', message: (e as Error).message || 'Could not connect your agent.' });
        }
      })();
      return;
    }

    // ENTRY leg: either the in-app `?arm=1` or a fresh MCP `?cb=&tok=`. The MAIN
    // session is the OTHER multisig member, so we must capture it BEFORE the agent
    // OAuth navigates the page away. autoConnect restores it async — wait (don't set
    // ranRef) until `account` arrives.
    const inAppEntry = new URLSearchParams(window.location.search).get('arm') === '1';
    const params = inAppEntry ? null : readParams();
    if (!inAppEntry && !params) {
      ranRef.current = true;
      setStage({ step: 'no-params' });
      return;
    }
    if (!account) {
      setStage({ step: 'authing' }); // "opening agent sign-in" — show progress while we wait
      // autoConnect restores the MAIN session async; if it never arrives, the user
      // isn't signed into the wallet — tell them (the MAIN key is a required member).
      if (waitTimerRef.current == null) {
        waitTimerRef.current = window.setTimeout(() => {
          if (!ranRef.current) setStage({ step: 'need-wallet' });
        }, ACCOUNT_WAIT_MS);
      }
      return; // re-runs when `account` lands (effect deps include it)
    }
    if (waitTimerRef.current != null) {
      window.clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
    ranRef.current = true;
    // The MAIN member is THIS wallet session's zkLogin public key. dapp-kit/Enoki
    // serializes `account.publicKey` FLAG-PREFIXED, so it must be parsed flag-aware
    // (`publicKeyFromSuiBytes`); `publicKeyFromRawBytes` treats the flag byte as
    // identifier data and silently CORRUPTS the key — the cause of withdraw's
    // "unknown public key" (a truncated/mangled member got stored, so the owner's
    // real signature was never in the committee). We try both parses and keep ONLY
    // the one that derives back to `account.address` — never persist a member that
    // doesn't, or the sub-account is unspendable.
    const mainPk =
      [
        () => publicKeyFromSuiBytes(new Uint8Array(account.publicKey)),
        () => publicKeyFromRawBytes('ZkLogin', new Uint8Array(account.publicKey)),
      ]
        .map((f) => {
          try {
            return f();
          } catch {
            return null;
          }
        })
        .find((pk) => pk?.toSuiAddress() === account.address) ?? null;
    if (!mainPk) {
      setStage({ step: 'error', message: 'Could not read your wallet key — please reopen and try again.' });
      return;
    }
    const mainPubKey = mainPk.toSuiPublicKey();
    setStage({ step: 'authing' });
    writeStash(
      inAppEntry
        ? { inApp: true, mainAddress: account.address, mainPubKey }
        : { ...(params as Pick<Pending, 'cb' | 'tok'>), mainAddress: account.address, mainPubKey },
    );
    void (async () => {
      try {
        const url = await flow().createAuthorizationURL({
          provider: 'google',
          clientId: GOOGLE_AGENT_CLIENT_ID,
          // Reuse the SAME registered redirect URI as the main login (`/enoki`) —
          // the agent client need not authorize a separate `/agent-connect` URI.
          // main.tsx routes the `/enoki` return back here while our stash is live.
          redirectUrl: `${window.location.origin}/enoki`,
          network: NETWORK,
        });
        window.location.href = url;
      } catch (e) {
        clearStash();
        ranRef.current = false;
        setStage({ step: 'error', message: (e as Error).message || 'Could not start agent sign-in.' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  // Don't leak the account-wait timer if the page unmounts mid-wait.
  useEffect(
    () => () => {
      if (waitTimerRef.current != null) window.clearTimeout(waitTimerRef.current);
    },
    [],
  );

  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  const [copied, setCopied] = useState(false);
  const copyAddr = (full: string) => {
    navigator.clipboard
      ?.writeText(full)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  };

  return (
    <div className="rd">
      <div className="rd-amb" aria-hidden="true">
        <i />
      </div>
      <div className="rd-stage" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        {stage.step === 'not-configured' ? (
          <article className="rd-confirm rd-glass" style={{ maxWidth: 360, textAlign: 'center' }}>
            <div className="rd-confirm__head">Agent sign-in</div>
            <p className="rd-confirm__source">
              Agent connections aren’t switched on yet — this is the door your assistant uses to get
              its own Suize address. It goes live shortly.
            </p>
          </article>
        ) : stage.step === 'no-params' ? (
          <article className="rd-confirm rd-glass" style={{ maxWidth: 360, textAlign: 'center' }}>
            <div className="rd-confirm__head">Agent sign-in</div>
            <p className="rd-confirm__source">
              Open this page from your assistant (the Suize MCP) — it adds the details needed to
              connect your agent.
            </p>
          </article>
        ) : stage.step === 'need-wallet' ? (
          <article className="rd-confirm rd-glass" style={{ maxWidth: 360, textAlign: 'center' }}>
            <div className="rd-confirm__head">Sign into Suize first</div>
            <p className="rd-confirm__source">
              Your agent shares a sub-account with your wallet, so open Suize and sign in with
              Google first — then create the sub-account again.
            </p>
          </article>
        ) : stage.step === 'done' ? (
          <article className="rd-confirm rd-glass rd-ac" style={{ maxWidth: 340 }}>
            <div className="rd-confirm__head rd-ac__head">
              <span className="rd-ac__check" aria-hidden="true">✓</span>
              Agent armed
            </div>
            <div className="rd-ac__body">
              {stage.address ? (
                <button
                  type="button"
                  className="rd-ac__addr"
                  onClick={() => copyAddr(stage.address!)}
                  title="Copy the full address"
                >
                  <span className="rd-ac__mono">{shortAddr(stage.address)}</span>
                  <span className="rd-ac__copy">{copied ? 'copied ✓' : 'copy'}</span>
                </button>
              ) : null}
              <p className="rd-ac__cap">Its balance is its cap.</p>
              <p className="rd-ac__note">
                {stage.inApp
                  ? 'It’s in your Suize wallet — returning now, where you can fund it and withdraw any time.'
                  : 'It’s in your Suize wallet — fund it and withdraw any time. Safe to close this tab and return to your assistant.'}
              </p>
            </div>
          </article>
        ) : stage.step === 'error' ? (
          <article className="rd-confirm rd-glass" style={{ maxWidth: 360, textAlign: 'center' }}>
            <div className="rd-confirm__head">Couldn’t connect</div>
            <p className="rd-confirm__source rd-confirm__msg--bear">{stage.message}</p>
          </article>
        ) : (
          <Loader
            eyebrow="Suize"
            label={stage.step === 'finishing' ? 'connecting your agent' : 'opening agent sign-in'}
          />
        )}
      </div>
    </div>
  );
}
