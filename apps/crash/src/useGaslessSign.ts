import { useCallback, useEffect } from 'react'
import {
  useSignAndExecuteTransaction,
  useSignPersonalMessage,
  useSignTransaction,
  useSuiClient,
} from '@mysten/dapp-kit'
import type { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { useAuth } from './auth'
import {
  connect_ws,
  disconnect_ws,
  register_signer,
} from './ws'
import { execute_sponsored, request_sponsorship } from './sponsor'
import type { ReadClient } from './sui'

// ============================================================================
// useGaslessSign — the ONE sponsored-write path, reused verbatim off the Play
// screen. App.tsx owns the canonical implementation for the bet loop; the House
// tab is a SEPARATE route (never mounted at the same time as App), so it stands
// up its own copy of the exact same lifecycle to drive router::supply /
// redeem_lp gaslessly. Branches on wallet kind exactly like App:
//   • self-paying wallet (e.g. Slush): dapp-kit signAndExecute, wallet pays gas
//   • sponsored (Enoki/zkLogin): WS sponsor → sign the sponsored bytes → execute
// Returns the same `{ transaction } -> { digest }` shape useHouse expects, plus
// the live client + address it reads with. The WS singleton (ws.ts) is shared
// process-wide; registering the personal-message signer is last-write-wins and
// the thunk shape is identical to App's, so there is no contention.
// ============================================================================
export function useGaslessSign(): {
  address: string | null
  sponsored: boolean
  client: ReadClient
  signAndExecute: (args: {
    transaction: Transaction
  }) => Promise<{ digest: string }>
} {
  const { address, sponsored } = useAuth()
  const client = useSuiClient()
  const { mutateAsync: signAndExecuteRaw } = useSignAndExecuteTransaction()
  const { mutateAsync: signTransactionRaw } = useSignTransaction()
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()

  // Register the personal-message signer the WS auth handshake calls.
  useEffect(() => {
    register_signer(async (message: Uint8Array) => {
      const { bytes, signature } = await signPersonalMessage({ message })
      return { bytes, signature }
    })
    return () => register_signer(null)
  }, [signPersonalMessage])

  // Open + authenticate the sponsor socket for a sponsored zkLogin address;
  // tear down on sign-out / a switch to a self-paying wallet. No-op when open.
  useEffect(() => {
    if (sponsored && address) connect_ws(address)
    else disconnect_ws()
  }, [sponsored, address])

  const signAndExecute = useCallback(
    async (args: { transaction: Transaction }): Promise<{ digest: string }> => {
      // Self-paid path (normal wallet): unchanged dapp-kit behaviour.
      if (!sponsored || !address) {
        return signAndExecuteRaw({
          transaction: args.transaction as unknown as Parameters<
            typeof signAndExecuteRaw
          >[0]['transaction'],
        })
      }

      // Gasless path (zkLogin via Enoki) — sponsor through the backend.
      type BuildOpts = NonNullable<Parameters<Transaction['build']>[0]>
      const kind_bytes = await args.transaction.build({
        client: client as unknown as BuildOpts['client'],
        onlyTransactionKind: true,
      })
      const kind_bytes_b64 = toBase64(kind_bytes)

      const { bytes, digest } = await request_sponsorship({
        kind_bytes_b64,
        sender: address,
      })
      const { signature } = await signTransactionRaw({ transaction: bytes })
      const executed = await execute_sponsored({ digest, signature })
      return { digest: executed.digest }
    },
    [sponsored, address, signAndExecuteRaw, signTransactionRaw, client],
  )

  return {
    address,
    sponsored,
    client: client as unknown as ReadClient,
    signAndExecute,
  }
}
