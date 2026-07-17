import { useState, type FormEvent } from 'react'
import { useDAppKit } from '@mysten/dapp-kit-react'
import { coinWithBalance, Transaction } from '@mysten/sui/transactions'
import { suiClient } from '../config'
import { resolveRecipient } from '../data/wallet'
import {
  balanceToInput,
  formatBalance,
  messageFromError,
  parseAmount,
  SUI_TYPE,
} from '../lib/format'
import { ArrowIcon, CheckIcon, CloseIcon, ExternalIcon, SendIcon } from './Icons'

const SUI_GAS_RESERVE = 10_000_000n

type SendTarget =
  | {
      kind: 'token'
      coinType: string
      balance: string
      decimals: number
      symbol: string
    }
  | {
      kind: 'object'
      objectId: string
      label: string
    }

interface SendFormProps {
  target: SendTarget
  onSent: (digest: string, amount?: bigint) => void
  compact?: boolean
}

export function SendForm({ target, onSent, compact = false }: SendFormProps) {
  const dAppKit = useDAppKit()
  const [open, setOpen] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [digest, setDigest] = useState<string | null>(null)

  const total = target.kind === 'token' ? BigInt(target.balance) : 0n
  const reserve = target.kind === 'token' && target.coinType === SUI_TYPE ? SUI_GAS_RESERVE : 0n
  const spendable = total > reserve ? total - reserve : 0n

  function close() {
    if (pending) return
    setOpen(false)
    setError(null)
    setDigest(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setDigest(null)
    setPending(true)
    try {
      const resolvedRecipient = await resolveRecipient(suiClient, recipient)
      const transaction = new Transaction()
      let units: bigint | undefined
      if (target.kind === 'token') {
        units = parseAmount(amount, target.decimals)
        if (units > spendable) {
          throw new Error(
            target.coinType === SUI_TYPE
              ? 'Leave at least 0.01 SUI for network fees'
              : `Amount exceeds your ${target.symbol} balance`,
          )
        }
        transaction.transferObjects(
          [coinWithBalance({ type: target.coinType, balance: units })],
          resolvedRecipient,
        )
      } else {
        transaction.transferObjects([target.objectId], resolvedRecipient)
      }

      const result = await dAppKit.signAndExecuteTransaction({ transaction })
      if (result.$kind === 'FailedTransaction') {
        throw new Error(result.FailedTransaction.status.error?.message ?? 'Transaction failed')
      }
      const nextDigest = result.Transaction.digest
      setDigest(nextDigest)
      setRecipient('')
      setAmount('')
      onSent(nextDigest, units)
    } catch (caught) {
      setError(messageFromError(caught))
    } finally {
      setPending(false)
    }
  }

  if (!open) {
    return (
      <button className={`send-trigger${compact ? ' send-trigger-compact' : ''}`} onClick={() => setOpen(true)}>
        <SendIcon width={16} height={16} />
        Send
      </button>
    )
  }

  return (
    <form className={`send-form${compact ? ' send-form-compact' : ''}`} onSubmit={submit}>
      <div className="send-form-heading">
        <div>
          <span className="eyebrow">Send</span>
          <strong>{target.kind === 'token' ? target.symbol : target.label}</strong>
        </div>
        <button className="icon-button" type="button" onClick={close} aria-label="Close send form">
          <CloseIcon width={17} height={17} />
        </button>
      </div>

      <label className="field">
        <span>Recipient</span>
        <input
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          placeholder="0x… or name.sui"
          autoComplete="off"
          spellCheck={false}
          required
          disabled={pending}
        />
      </label>

      {target.kind === 'token' ? (
        <label className="field">
          <span className="field-label-row">
            <span>Amount</span>
            <span className="available-balance">
              Available {formatBalance(spendable.toString(), target.decimals)} {target.symbol}
            </span>
          </span>
          <span className="amount-input-wrap">
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              autoComplete="off"
              required
              disabled={pending}
            />
            <button
              className="max-button"
              type="button"
              onClick={() => setAmount(balanceToInput(spendable.toString(), target.decimals))}
              disabled={pending || spendable === 0n}
            >
              MAX
            </button>
          </span>
          {target.coinType === SUI_TYPE ? (
            <small>MAX keeps 0.01 SUI for network fees.</small>
          ) : null}
        </label>
      ) : null}

      {error ? <p className="form-message form-error">{error}</p> : null}
      {digest ? (
        <a
          className="form-message form-success"
          href={`https://suiscan.xyz/mainnet/tx/${digest}`}
          target="_blank"
          rel="noreferrer"
        >
          <CheckIcon width={16} height={16} />
          Sent successfully
          <ExternalIcon width={14} height={14} />
        </a>
      ) : null}

      <button className="confirm-button" type="submit" disabled={pending}>
        <span>{pending ? 'Confirm in wallet…' : 'Continue to wallet'}</span>
        <ArrowIcon width={17} height={17} />
      </button>
    </form>
  )
}
