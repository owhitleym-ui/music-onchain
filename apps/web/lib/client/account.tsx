"use client";

// The signed-in fan's money: their test USDC balance and the "Get test USDC" faucet button.
// Wraps the wallet so the header, the entry form and the review dialog all share one balance.
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { api, usePoll } from "./api";
import type { Money } from "./types";
import { useWallet } from "./wallet";

type FaucetResult = { ok: true; alreadyFunded: boolean; txHash: string | null; amount?: Money; balance: Money };

type Account = {
  balance: Money | null;
  refreshBalance: () => Promise<void>;
  /** Calls /api/faucet with the Privy token (or no token for the local test wallet). */
  requestTestUsdc: () => Promise<FaucetResult>;
};

const AccountContext = createContext<Account | null>(null);

export function useAccount(): Account {
  const account = useContext(AccountContext);
  if (!account) throw new Error("useAccount must be used inside <AccountProvider>");
  return account;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  // Poll the balance while signed in; 10s is plenty since we refresh right after every transaction.
  const { data, refresh } = usePoll<{ ok: true; balance: Money }>(
    wallet.address ? `/api/me/balance?address=${wallet.address}` : null,
    10_000,
  );

  const requestTestUsdc = useCallback(async () => {
    const token = await wallet.getAccessToken();
    const result = await api<FaucetResult>("/api/faucet", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      // The address is only read by the faucet's local-development mode. With Privy, the server
      // ignores it and uses the wallet attached to the verified login.
      body: JSON.stringify({ address: wallet.address }),
    });
    await refresh();
    return result;
  }, [wallet, refresh]);

  const value = useMemo<Account>(
    () => ({ balance: wallet.address ? (data?.balance ?? null) : null, refreshBalance: refresh, requestTestUsdc }),
    [wallet.address, data, refresh, requestTestUsdc],
  );
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
