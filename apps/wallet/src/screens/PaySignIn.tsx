/**
 * PaySignIn — the signed-out hero, in the locked broadsheet language.
 *
 * A two-beat editorial spread: the SUIZE wordmark lockup, a Newsreader headline with
 * "agent" taking the accent ONCE (the locked "accent used once" rule), a one-line
 * promise, the price-as-fact line (mono, BLUE numbers), and the single blue CTA — the
 * one gesture that opens the Google OAuth popup. Non-custodial framing under it.
 *
 * It is scoped under `.journal` so it inherits every broadsheet token + the custom
 * cursor. The CTA's onClick is the REQUIRED user gesture (a popup not opened from a
 * direct gesture is browser-blocked) — App wires it to `auth.signInWithGoogle`.
 */

import { SuizeWordmark } from '../system/Wordmark';
import { Logo } from '../system/Logo';
import { Button, ArrowRight, ICON_STROKE } from '../system';

export interface PaySignInProps {
  onContinue: () => void;
}

export function PaySignIn({ onContinue }: PaySignInProps) {
  return (
    <div className="journal">
      <div className="amb" aria-hidden="true" />
      <div className="pay-signin">
        <div className="pay-signin__col">
          {/* brand lockup */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            <Logo size={30} />
            <SuizeWordmark />
          </div>

          {/* eyebrow with the breathing dot */}
          <span className="pay-signin__eyebrow">
            <span className="dot" aria-hidden="true" />
            The Sui payments standard for AI agents
          </span>

          {/* headline — accent used ONCE on "agent" */}
          <h1 className="pay-signin__h">
            Give your <span className="grad">agent</span> a wallet.
          </h1>

          <p className="pay-signin__sub">
            Sign in with Google. Top it up in USDC. It can pay anywhere — with a receipt for
            everything, checkable on-chain.
          </p>

          {/* price-as-fact line */}
          <p className="pay-signin__facts">
            <span>
              <b>2%</b> on subscriptions
            </span>
            <span>
              <b>$0</b> to send
            </span>
            <span>
              <b>$0</b> to set up
            </span>
          </p>

          {/* the CTA — the click opens the sign-in popup */}
          <Button
            variant="primary"
            size="lg"
            onClick={onContinue}
            icon={<ArrowRight size={16} strokeWidth={ICON_STROKE} aria-hidden />}
            style={{ flexDirection: 'row-reverse', marginTop: 4 }}
          >
            Continue with Google
          </Button>

          <p
            style={{
              margin: 0,
              fontFamily: 'var(--mono)',
              fontSize: 11,
              lineHeight: 1.7,
              color: 'var(--ink-3)',
              maxWidth: '46ch',
            }}
          >
            Non-custodial — your keys never leave your machine. Gasless.
          </p>
        </div>
      </div>
    </div>
  );
}

export default PaySignIn;
