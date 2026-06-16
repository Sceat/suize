/**
 * MemWal MEMORY onboarding (client side). The agent's memory lives in MemWal
 * (Walrus's agent-memory SDK), driven SERVER-SIDE by the brain. The wallet's only
 * job is the ONE-TIME on-chain authorization: register the backend's DERIVED
 * delegate key on a MemWalAccount the USER owns, so the brain can read/write that
 * user's memory without ever holding the user's key.
 *
 * Flow (best-effort, idempotent):
 *   1. ask the backend for the user's derived delegate PUBLIC key + the MemWal
 *      contract ids (`wsMemwalDelegate` — the private key stays server-side).
 *   2. the user's zkLogin wallet signs a SPONSORED `createAccount` + `addDelegateKey`
 *      (reuses the proven `runSponsored` path; the MemWal targets are allow-listed).
 *   3. cache the resulting `accountId` (NOT a secret) in localStorage; the brain
 *      receives it on each chat turn and recalls/stores memory under it.
 *
 * Memory is OPTIONAL + best-effort: any failure just leaves the agent stateless for
 * the session — it never blocks the wallet or the chat.
 */
import { createAccount, addDelegateKey } from '@mysten-incubation/memwal/account';
import { runSponsored, type SignTransaction, type BuildClient } from './sponsored';
import { wsMemwalDelegate } from './ws';

const ACCOUNT_KEY = (owner: string) => `suize:memwal:account:${owner.toLowerCase()}`;

/** The cached MemWal account id for `owner`, or null until onboarded. */
export function getStoredAccountId(owner: string): string | null {
  if (!owner) return null;
  try {
    return localStorage.getItem(ACCOUNT_KEY(owner));
  } catch {
    return null;
  }
}

function setStoredAccountId(owner: string, accountId: string): void {
  try {
    localStorage.setItem(ACCOUNT_KEY(owner), accountId);
  } catch {
    /* private mode — memory just re-onboards next session */
  }
}

// De-dupe concurrent onboards (the deck mounts once, but guard against re-entry).
let inflight: Promise<string | null> | null = null;

/**
 * Ensure the user has a MemWal memory account, running the one-time onboarding if
 * not. Returns the accountId, or null when memory is off on the backend / it fails.
 */
export async function ensureMemwalAccount(opts: {
  owner: string;
  client: BuildClient;
  signTransaction: SignTransaction;
  /** dapp-kit SuiClient instance the MemWal account fns use to build the txs. */
  suiClient: unknown;
}): Promise<string | null> {
  const { owner } = opts;
  if (!owner) return null;
  const cached = getStoredAccountId(owner);
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async (): Promise<string | null> => {
    try {
      const info = await wsMemwalDelegate();
      if (!info.enabled || !info.publicKey || !info.packageId || !info.registryId) return null;
      const network = info.network === 'mainnet' ? 'mainnet' : 'testnet';

      // Adapter: the SDK builds a Transaction + hands it to signAndExecuteTransaction;
      // we route it through our SPONSORED path (the user signs, the backend pays gas).
      const walletSigner = {
        address: owner,
        signAndExecuteTransaction: async ({ transaction }: { transaction: unknown }) => {
          const digest = await runSponsored({
            tx: transaction as Parameters<typeof runSponsored>[0]['tx'],
            owner,
            client: opts.client,
            signTransaction: opts.signTransaction,
          });
          return { digest };
        },
        // Not used in default-mode onboarding (only createAccount/addDelegateKey, which
        // sign+execute). Provided to satisfy the WalletSigner shape.
        signPersonalMessage: async () => {
          throw new Error('signPersonalMessage is not used in MemWal onboarding');
        },
      };

      const acct = await createAccount({
        packageId: info.packageId,
        registryId: info.registryId,
        walletSigner,
        suiClient: opts.suiClient,
        suiNetwork: network,
      });
      await addDelegateKey({
        packageId: info.packageId,
        accountId: acct.accountId,
        publicKey: info.publicKey,
        label: 'Suize agent',
        walletSigner,
        suiClient: opts.suiClient,
        suiNetwork: network,
      });
      setStoredAccountId(owner, acct.accountId);
      return acct.accountId;
    } catch (e) {
      // Best-effort: a failure (relayer/contract/already-exists) just leaves memory
      // off for the session — never surfaced as a blocking error.
      console.warn('[memwal] onboarding skipped:', (e as Error).message);
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
