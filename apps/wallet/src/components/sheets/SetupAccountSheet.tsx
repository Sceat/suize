/**
 * SetupAccountSheet — create + fund ONE caged AI account (Spending or Investing).
 *
 * This is the REAL account-creation flow (replaces the inert "Not set up yet — fund
 * it from inside the wallet" copy). It drives `home.createAccount(role, opts)`, which
 * mints the on-chain Mandate, creates + (optionally) funds the Vault, and issues the
 * AgentCap to the configured agent — all sponsored over the WS. On success the
 * account goes LIVE (real budget, real vault balance, real kill-switch) and its refs
 * are persisted so pause / strategy / convert keep working across reloads.
 *
 * Inputs (all SUI-denominated — the mandate budget + the vault are SUI):
 *   - Budget: the mandate cap in SUI — the agent can NEVER spend past it (the cage).
 *   - Fund:   initial SUI deposited into the vault's idle pot (single-asset only;
 *             the RISKY swap vault funds via convert later, so fund is SUI-only here).
 *   - Strategy (INVESTING only): Safe (NAVI lend-as-is, multi-asset, single vault) or
 *             Risky (DeepBook spot SUI↔USDC swap vault). SPENDING is fixed pay/transfer.
 *
 * HONEST GATE: if VITE_AGENT_ADDRESS is unset there is no agent to issue the cap to,
 * so we show a calm OWNER-ACTION state ("agent not configured yet") with NO mint CTA
 * — never a fake button, never a cap minted to nobody.
 *
 * Amounts are parsed SUI → Mist with BigInt (no float drift): the deterministic core
 * owns every on-chain number (the number wall). Chrome + Secure footer come from <Sheet/>.
 */
import { useCallback, useMemo, useState } from 'react';
import { Sheet } from './Sheet';
import { Button, Field, Coins, ShieldCheck, Check, ICON_STROKE } from '../../system';
import type { AiRole, HomeApi, Strategy } from '../../data/types';
import { SUI } from '../../data/coins';
import { AGENT_ADDRESS } from '../../lib/env';

export interface SetupAccountSheetProps {
  /** which AI account to create. */
  role: AiRole;
  /** the data hook — drives the real createAccount flow + reports hasAccount. */
  home: HomeApi;
  onClose: () => void;
}

/**
 * Parse a human SUI amount string → Mist (bigint, 9 decimals) with NO float drift.
 * Returns null for empty/invalid/negative input (so the caller can gate the CTA).
 * Accepts an optional fractional part; extra fraction digits beyond 9 are truncated.
 */
function suiToMist(input: string): bigint | null {
  const s = input.trim();
  if (!s) return null;
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return null;
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '0'.repeat(SUI.decimals)).slice(0, SUI.decimals);
  try {
    const mist = BigInt(whole || '0') * 10n ** BigInt(SUI.decimals) + BigInt(fracPadded || '0');
    return mist;
  } catch {
    return null;
  }
}

const LABEL: Record<AiRole, string> = {
  spending: 'Spending',
  investing: 'Investing',
};

const STRATEGY_COPY: Record<Strategy, { label: string; blurb: string }> = {
  safe: { label: 'Safe', blurb: 'Lend-as-is on NAVI. Low, steady — never trades.' },
  risky: { label: 'Risky', blurb: 'Spot SUI↔USDC on signals via DeepBook. No leverage.' },
};

/** A small uppercase field label (matches the Send/Convert sheets). */
function FieldLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        fontFamily: 'var(--mono)',
        fontSize: 10.5,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: 'var(--ink-3)',
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

export function SetupAccountSheet({ role, home, onClose }: SetupAccountSheetProps) {
  const label = LABEL[role];
  const agentReady = AGENT_ADDRESS.length > 0;

  const [strategy, setStrategy] = useState<Strategy>('safe');
  const [budget, setBudget] = useState('');
  const [fund, setFund] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const budgetMist = useMemo(() => suiToMist(budget), [budget]);
  const fundMist = useMemo(() => suiToMist(fund), [fund]);

  // A budget is REQUIRED (the cage must have a cap > 0); fund is OPTIONAL but, when
  // present, must be valid and must not exceed the budget (the agent can never hold
  // more than its cap — fund > budget would be incoherent). For RISKY the swap vault
  // can't take a single-asset SUI deposit at creation, so fund is hidden there.
  const fundAllowed = !(role === 'investing' && strategy === 'risky');
  const budgetValid = budgetMist != null && budgetMist > 0n;
  const fundValid =
    fund.trim() === '' || (fundMist != null && fundMist >= 0n && (!budgetValid || fundMist <= budgetMist!));
  const canSubmit = agentReady && budgetValid && fundValid && !submitting && !done;

  const onSubmit = useCallback(async () => {
    if (!canSubmit || budgetMist == null) return;
    setSubmitting(true);
    setError(null);
    try {
      await home.createAccount(role, {
        strategy: role === 'investing' ? strategy : undefined,
        budgetMist,
        fundMist: fundAllowed && fundMist != null && fundMist > 0n ? fundMist : undefined,
      });
      setDone(true);
      // Brief success beat, then close — the home mirror re-reads the live refs.
      window.setTimeout(onClose, 1100);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set up the account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, budgetMist, fundMist, fundAllowed, home, role, strategy, onClose]);

  // ── OWNER-ACTION gate: no agent address configured → no cap recipient. ──
  if (!agentReady) {
    return (
      <Sheet
        title={`Set up ${label}`}
        sub="Your AI account isn't available yet."
        onClose={onClose}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            padding: '18px 18px 20px',
            borderRadius: 'var(--corner)',
            border: '1px solid var(--hair)',
            background: 'var(--paper)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--ink-2)' }}>
            <Coins size={18} strokeWidth={ICON_STROKE} aria-hidden style={{ color: 'var(--cyan)' }} />
            <span style={{ fontFamily: 'var(--sans)', fontSize: 15, color: 'var(--ink)' }}>
              Agent not configured yet
            </span>
          </span>
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--mono)',
              fontSize: 12,
              lineHeight: 1.7,
              color: 'var(--ink-3)',
              maxWidth: '40ch',
            }}
          >
            AI accounts mint an on-chain mandate and hand a tightly-scoped cap to the
            agent. That agent address isn't set up on this deployment yet, so there's
            nothing to leash. This is an owner action — once it's live, this screen
            creates your caged account for real.
          </p>
        </div>
      </Sheet>
    );
  }

  const buttonLabel = done
    ? `${label} is live`
    : submitting
      ? 'Setting up…'
      : `Create ${label} account`;

  return (
    <Sheet
      title={`Set up ${label}`}
      sub="Mint a caged AI account. Pick a budget it can never exceed, then fund it."
      onClose={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Strategy (INVESTING only) — Safe / Risky segmented choice */}
        {role === 'investing' ? (
          <div>
            <FieldLabel>Strategy</FieldLabel>
            <div
              role="radiogroup"
              aria-label="Investing strategy"
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              {(['safe', 'risky'] as const).map((s) => {
                const active = strategy === s;
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={submitting || done}
                    onClick={() => setStrategy(s)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                      textAlign: 'left',
                      padding: '13px 15px',
                      borderRadius: 'var(--corner)',
                      border: `1px solid ${active ? 'var(--cyan)' : 'var(--hair)'}`,
                      background: active ? 'var(--cyan-wash)' : 'var(--paper)',
                      cursor: submitting || done ? 'default' : 'pointer',
                      transition: 'border-color .3s var(--e-quart), background .3s var(--e-quart)',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 13,
                        letterSpacing: '0.04em',
                        color: active ? 'var(--cyan)' : 'var(--ink)',
                      }}
                    >
                      {STRATEGY_COPY[s].label}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 11,
                        lineHeight: 1.5,
                        color: 'var(--ink-3)',
                      }}
                    >
                      {STRATEGY_COPY[s].blurb}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Budget — the mandate cap (REQUIRED). The agent can never spend past it. */}
        <div>
          <FieldLabel>Budget</FieldLabel>
          <Field
            value={budget}
            onChange={(e) => {
              setBudget(e.currentTarget.value);
              setError(null);
            }}
            placeholder="0.00"
            inputMode="decimal"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            state={budget.trim() !== '' && !budgetValid ? 'bad' : 'idle'}
            suffix={SUI.sym}
          />
          <p
            style={{
              margin: '8px 0 0',
              fontFamily: 'var(--mono)',
              fontSize: 11,
              lineHeight: 1.6,
              color: 'var(--ink-3)',
            }}
          >
            The hard cap. Your AI physically can't construct a transaction over it.
          </p>
        </div>

        {/* Fund — initial SUI deposit (OPTIONAL; single-asset vaults only) */}
        {fundAllowed ? (
          <div>
            <FieldLabel>Fund now (optional)</FieldLabel>
            <Field
              value={fund}
              onChange={(e) => {
                setFund(e.currentTarget.value);
                setError(null);
              }}
              placeholder="0.00"
              inputMode="decimal"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              state={fund.trim() !== '' && !fundValid ? 'bad' : 'idle'}
              suffix={SUI.sym}
            />
            <p
              style={{
                margin: '8px 0 0',
                fontFamily: 'var(--mono)',
                fontSize: 11,
                lineHeight: 1.6,
                color: 'var(--ink-3)',
              }}
            >
              {budgetValid && fundMist != null && fundMist > budgetMist!
                ? 'Funding can’t exceed the budget cap.'
                : 'Deposit into the account now, or leave empty and fund it later.'}
            </p>
          </div>
        ) : (
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--mono)',
              fontSize: 11,
              lineHeight: 1.6,
              color: 'var(--ink-3)',
            }}
          >
            Risky accounts fund through Convert — create it empty here, then move SUI in.
          </p>
        )}

        {/* the cage reassurance — a structural truth, not a number */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '12px 14px',
            borderRadius: 'var(--corner)',
            border: '1px solid var(--hair-2)',
            background: 'var(--paper)',
          }}
        >
          <ShieldCheck
            size={16}
            strokeWidth={ICON_STROKE}
            aria-hidden
            style={{ color: 'var(--good)', flex: '0 0 auto', marginTop: 1 }}
          />
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 11.5,
              lineHeight: 1.6,
              color: 'var(--ink-3)',
            }}
          >
            Can’t touch your savings. The cage caps any loss to this account — kill it
            anytime and the next move reverts on-chain.
          </span>
        </div>

        {/* honest error surface */}
        {error ? (
          <p
            role="alert"
            style={{
              margin: 0,
              fontFamily: 'var(--mono)',
              fontSize: 11.5,
              lineHeight: 1.6,
              color: 'var(--warn)',
            }}
          >
            {error}
          </p>
        ) : null}

        <Button
          variant="primary"
          size="lg"
          onClick={() => void onSubmit()}
          disabled={!canSubmit}
          busy={submitting}
          icon={done ? <Check size={15} strokeWidth={ICON_STROKE} aria-hidden /> : undefined}
          style={
            done
              ? { color: '#fff', borderColor: 'var(--good)', background: 'var(--good)', boxShadow: 'none' }
              : undefined
          }
        >
          {buttonLabel}
        </Button>
      </div>
    </Sheet>
  );
}

export default SetupAccountSheet;
