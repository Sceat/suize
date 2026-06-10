/**
 * PayActionSheet — the ONE form behind Deposit / Spend / Withdraw / Subscribe.
 *
 * A single, calm bottom-sheet (reuses the shared `Sheet` chrome) configured per
 * action. Renders an amount field (always), a recipient + memo field (spend), and a
 * recurring "per month" framing (subscribe). On submit it calls the supplied
 * `onSubmit(amountRaw, { payee, memo, periodMs })` — the parent (PayDeck) holds the
 * `useAccount` mutation. Honest: the CTA disables when the amount is empty/zero or
 * exceeds the available balance, and surfaces the real error on failure (no fake
 * success). Money is Martian-Mono blue; words Space Grotesk; the title is serif.
 */

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from '../sheets/Sheet';
import { Field, Button, ArrowRight, ICON_STROKE } from '../../system';
import { resolveRecipient } from '../../data/suins';
import type { SuiClient } from '../../data/suins';

/** Which primitive this sheet drives — shapes the copy + which fields show. */
export type PayAction = 'deposit' | 'spend' | 'withdraw' | 'subscribe';

export interface PaySubmit {
  /** amount in USDC base units (1e-6). */
  amountRaw: bigint;
  /** resolved 0x payee (spend + subscribe). */
  payee?: string;
  /** free memo (spend). */
  memo?: string;
  /** period length in ms (subscribe). */
  periodMs?: number;
  /** human merchant label (subscribe). */
  label?: string;
}

const COPY: Record<PayAction, { title: string; sub: string; cta: string; amountLabel: string }> = {
  deposit: {
    title: 'Top up agent money',
    sub: 'Move USDC from your wallet into the agent balance. You can take it back any time.',
    cta: 'Top up',
    amountLabel: 'Amount to move in',
  },
  spend: {
    title: 'Pay someone',
    sub: 'Send USDC from your agent balance. Free — the full amount lands with them.',
    cta: 'Pay',
    amountLabel: 'Amount to pay',
  },
  withdraw: {
    title: 'Take money back',
    sub: 'Pull USDC from your agent balance back into your wallet.',
    cta: 'Withdraw',
    amountLabel: 'Amount to take back',
  },
  subscribe: {
    title: 'Set up a subscription',
    sub: 'Approve a recurring charge once. It can only ever take the capped amount, to this one payee, once per period.',
    cta: 'Approve subscription',
    amountLabel: 'Most it can charge per month',
  },
};

/** USDC has 6 decimals. */
const USDC_SCALE = 1_000_000;

/** Parse a human USDC string ("12.50") to base units (bigint), or null if invalid. */
function parseUsdc(input: string): bigint | null {
  const v = input.trim();
  if (!v) return null;
  if (!/^\d*\.?\d{0,6}$/.test(v)) return null;
  const [whole, frac = ''] = v.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  const combined = `${whole || '0'}${fracPadded}`;
  try {
    const n = BigInt(combined);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

export interface PayActionSheetProps {
  action: PayAction;
  /** the available balance for this action, in USDC base units (caps the amount). */
  availableRaw: bigint;
  /** the SuiClient for resolving a SuiNS/hex recipient (spend + subscribe). */
  client: SuiClient;
  busy: boolean;
  onClose: () => void;
  onSubmit: (s: PaySubmit) => Promise<void>;
}

export function PayActionSheet({
  action,
  availableRaw,
  client,
  busy,
  onClose,
  onSubmit,
}: PayActionSheetProps) {
  const copy = COPY[action];
  const needsRecipient = action === 'spend' || action === 'subscribe';

  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [memo, setMemo] = useState('');
  const [resolved, setResolved] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountRaw = useMemo(() => parseUsdc(amount), [amount]);
  const overBalance = amountRaw != null && amountRaw > availableRaw;
  const availableUi = Number(availableRaw) / USDC_SCALE;

  // Resolve the recipient (debounced-ish: on blur) for spend/subscribe.
  const onRecipientBlur = async () => {
    if (!needsRecipient || !recipient.trim()) {
      setResolved(null);
      return;
    }
    setResolving(true);
    try {
      const r = await resolveRecipient(recipient, client);
      setResolved(r.address);
    } finally {
      setResolving(false);
    }
  };

  const recipientOk = !needsRecipient || (resolved != null && resolved.length > 0);
  const canSubmit =
    !busy && amountRaw != null && !overBalance && recipientOk && !resolving;

  const submit = async () => {
    if (!canSubmit || amountRaw == null) return;
    setError(null);
    try {
      await onSubmit({
        amountRaw,
        payee: needsRecipient ? resolved ?? undefined : undefined,
        memo: action === 'spend' ? memo.trim() : undefined,
        periodMs: action === 'subscribe' ? 30 * 24 * 60 * 60 * 1000 : undefined,
        label: action === 'subscribe' ? recipient.trim() : undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    }
  };

  const body = (
    <Sheet title={copy.title} sub={copy.sub} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* amount */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span style={labelStyle}>{copy.amountLabel}</span>
          <Field
            prefix="$"
            suffix="USDC"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            state={overBalance ? 'bad' : 'idle'}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
          <span style={hintStyle}>
            {action === 'deposit'
              ? `Your wallet has ${availableUi.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC`
              : action === 'subscribe'
                ? 'A hard ceiling — it can never charge more than this in a month.'
                : `Agent money: ${availableUi.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC`}
            {overBalance ? <span style={{ color: 'var(--warn)' }}> · more than you have</span> : null}
          </span>
        </label>

        {/* recipient (spend + subscribe) */}
        {needsRecipient ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={labelStyle}>{action === 'spend' ? 'Pay to' : 'Charged by'}</span>
            <Field
              placeholder="@handle or 0x address"
              value={recipient}
              state={recipient && !resolving ? (resolved ? 'ok' : 'bad') : 'idle'}
              onChange={(e) => {
                setRecipient(e.target.value);
                setResolved(null);
              }}
              onBlur={onRecipientBlur}
            />
            <span style={hintStyle}>
              {resolving
                ? 'Looking it up…'
                : recipient && !resolved
                  ? 'Could not find that — check the handle or address.'
                  : 'The payee is fixed; it can never be redirected.'}
            </span>
          </label>
        ) : null}

        {/* memo (spend only) */}
        {action === 'spend' ? (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={labelStyle}>What for (optional)</span>
            <Field
              placeholder="e.g. weather API · invoice #42"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={120}
            />
            <span style={hintStyle}>Written into the on-chain receipt.</span>
          </label>
        ) : null}

        {error ? <p style={{ ...hintStyle, color: 'var(--warn)' }}>{error}</p> : null}

        <Button
          variant="primary"
          size="lg"
          busy={busy}
          disabled={!canSubmit}
          onClick={submit}
          icon={<ArrowRight size={16} strokeWidth={ICON_STROKE} aria-hidden />}
          style={{ flexDirection: 'row-reverse', marginTop: 4 }}
        >
          {busy ? 'Working…' : copy.cta}
        </Button>
      </div>
    </Sheet>
  );

  return createPortal(body, document.body);
}

const labelStyle = {
  fontFamily: 'var(--sans)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const,
  color: 'var(--ink-3)',
};

const hintStyle = {
  fontFamily: 'var(--mono)',
  fontSize: 11,
  lineHeight: 1.6,
  color: 'var(--ink-3)',
};
