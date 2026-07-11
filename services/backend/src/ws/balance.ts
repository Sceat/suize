// WS balance helper — the ONE real on-chain read the WS server performs on
// connect. Reuses the sponsor module's SuiGrpcClient (one gRPC client for the
// whole backend) to fetch the address's native SUI balance and shape it into the
// shared `BalanceUpdate` push body.
//
// Today we only report the `main` account (the user's on-chain SUI balance). The
// `sandbox` account is the agent's caged vault balance; until the wallet Move
// package's vault objects are wired into the agent loop, the sandbox push is
// produced by the (stubbed) agent loop, not here. So this helper returns ONLY
// the main-account update — the push PLUMBING (sendToAddress) is real regardless.
import type { BalanceUpdate } from "@suize/shared/protocol";
import { suiClient } from "../sponsor";

/**
 * Fetch the address's native SUI balance (in MIST) and shape it into a
 * `BalanceUpdate` for the `main` account. Returns `null` on an RPC failure so
 * the caller can simply skip the initial push rather than tear down the socket
 * (a transient fullnode hiccup must not fail an otherwise-good auth).
 */
export const fetchMainBalanceUpdate = async (address: string): Promise<BalanceUpdate | null> => {
  try {
    // gRPC GetBalance → { balance: { balance, coinType, ... } }; `.balance.balance`
    // is the address's total SUI in MIST as a decimal string (the JSON-RPC
    // `totalBalance` equivalent). Default coinType is 0x2::sui::SUI.
    const { balance } = await suiClient.getBalance({ owner: address });
    return {
      account: "main",
      balanceMist: balance.balance, // decimal MIST string
      updatedAt: Date.now(),
    };
  } catch (err) {
    console.error("[ws/balance]", (err as Error).message);
    return null;
  }
};
