// =============================================================================
// The VIEWER-LIST manager (#/access/<allowlistId>). Lists who can open a private
// site, and — when the connected wallet holds this list's AllowlistCap — lets
// the owner add or remove a wallet address. Every change is a wallet-signed tx
// (add/remove on-chain); the list itself is read straight from the shared
// Allowlist object. Denial to a non-owner is by construction: no cap, no controls.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCurrentAccount, useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react'
import { ConnectButton } from '@mysten/dapp-kit-react/ui'
import { SUI_ADDRESS_RE } from '@suize/shared'
import { NETWORK } from '../config'
import { readAllowlistMembers, findAllowlistCap, buildMembershipTx } from '../seal/chain'
import { ViewerBar } from './Chrome'
import { getDevSigner } from './devSigner'

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`

export function AccessPage({ allowlistId }: { allowlistId: string }) {
  const account = useCurrentAccount()
  const client = useCurrentClient()
  const dAppKit = useDAppKit()
  // DEV-only keypair signer (see devSigner.ts) — lets the E2E manage the list
  // without a wallet extension. Falls back to the connected wallet in prod.
  const dev = useMemo(() => getDevSigner(), [])
  const ownerAddress = dev?.address ?? account?.address ?? null

  const [members, setMembers] = useState<string[] | null>(null)
  const [capId, setCapId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [addr, setAddr] = useState('')
  const [busy, setBusy] = useState<string | null>(null) // the address being changed
  const [txError, setTxError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoadError(false)
    try {
      const list = await readAllowlistMembers(client as never, allowlistId)
      setMembers(list)
    } catch {
      setMembers(null)
      setLoadError(true)
      return
    }
    if (ownerAddress) {
      try {
        setCapId(await findAllowlistCap(client as never, ownerAddress, NETWORK, allowlistId))
      } catch {
        setCapId(null)
      }
    } else {
      setCapId(null)
    }
  }, [client, allowlistId, ownerAddress])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runTx = useCallback(
    async (kind: 'add' | 'remove', target: string) => {
      if (!capId) return
      setTxError(null)
      setBusy(target)
      try {
        const transaction = buildMembershipTx({
          kind,
          network: NETWORK,
          allowlistId,
          capId,
          account: target,
        })
        // Prod: the connected wallet signs+executes. Dev E2E: the keypair does,
        // straight over the gRPC client (no wallet extension needed). The client's
        // narrowed core type doesn't surface signAndExecuteTransaction, so cast.
        if (dev) {
          const exec = client as unknown as {
            signAndExecuteTransaction: (i: { transaction: unknown; signer: unknown }) => Promise<unknown>
          }
          await exec.signAndExecuteTransaction({ transaction, signer: dev.keypair })
        } else {
          await dAppKit.signAndExecuteTransaction({ transaction })
        }
        if (kind === 'add') setAddr('')
        // Chain state lags a beat behind execution; a short wait then re-read.
        await new Promise((r) => setTimeout(r, 800))
        await refresh()
      } catch (e) {
        const msg = (e as Error)?.message ?? ''
        setTxError(
          /reject|denied|cancel/i.test(msg)
            ? 'You cancelled the change.'
            : kind === 'add'
              ? "Couldn't add that address. It may already be on the list."
              : "Couldn't remove that address. Please try again.",
        )
      } finally {
        setBusy(null)
      }
    },
    [capId, allowlistId, dAppKit, refresh, dev, client],
  )

  const normAddr = addr.trim().toLowerCase()
  const addrValid = SUI_ADDRESS_RE.test(normAddr)
  const alreadyMember = !!members?.some((m) => m.toLowerCase() === normAddr)

  return (
    <div className="vshell">
      <ViewerBar status="Viewer list" tone="muted" />
      <div className="vpanel">
        <div className="vpanel__card vpanel__card--wide">
          <span className="kicker">Private site</span>
          <h1 className="vpanel__title">Who can open this site</h1>
          <p className="vpanel__body">
            These wallets can open the private site. {capId ? 'Add or remove anyone below.' : 'Only the owner can change the list.'}
          </p>

          {loadError && (
            <p className="vmsg vmsg--err">We couldn’t load the list. Check your connection and retry.</p>
          )}

          {members === null && !loadError && <p className="vspin">Loading…</p>}

          {members && (
            <ul className="vlist">
              {members.length === 0 && <li className="vlist__empty">No one yet.</li>}
              {members.map((m) => (
                <li className="vlist__row" key={m}>
                  <span className="mono vlist__addr">{short(m)}</span>
                  {ownerAddress && m.toLowerCase() === ownerAddress.toLowerCase() && (
                    <span className="vlist__you">you</span>
                  )}
                  {capId && (
                    <button
                      className="vlist__rm"
                      disabled={busy !== null}
                      onClick={() => void runTx('remove', m)}
                    >
                      {busy === m ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!ownerAddress && (
            <div className="vpanel__actions">
              <ConnectButton />
              <span className="vmsg">Sign in with the owner wallet to manage the list.</span>
            </div>
          )}

          {ownerAddress && !capId && members && (
            <p className="vmsg">This wallet doesn’t own this site, so the list is read-only here.</p>
          )}

          {capId && (
            <div className="vadd">
              <input
                className="vadd__input mono"
                placeholder="Wallet address (0x…)"
                value={addr}
                spellCheck={false}
                onChange={(e) => setAddr(e.target.value)}
              />
              <button
                className="btn btn--primary"
                disabled={!addrValid || alreadyMember || busy !== null}
                onClick={() => void runTx('add', normAddr)}
              >
                {busy === normAddr ? 'Adding…' : 'Add'}
              </button>
            </div>
          )}
          {capId && addr.trim() !== '' && !addrValid && (
            <p className="vmsg vmsg--err">That doesn’t look like a wallet address.</p>
          )}
          {capId && addrValid && alreadyMember && (
            <p className="vmsg">That wallet is already on the list.</p>
          )}
          {txError && <p className="vmsg vmsg--err">{txError}</p>}
        </div>
      </div>
    </div>
  )
}
