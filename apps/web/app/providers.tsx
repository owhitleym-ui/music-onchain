"use client";

// Client-side providers, outermost first:
//   WalletProvider  - Privy login + embedded wallet (or the local test wallet in development)
//   AccountProvider - the signed-in fan's balance and the faucet button
//   ToastProvider   - bottom-right confirmations ("Entry recorded")
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui";
import { AccountProvider } from "@/lib/client/account";
import { WalletProvider } from "@/lib/client/wallet";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <AccountProvider>
        <ToastProvider>{children}</ToastProvider>
      </AccountProvider>
    </WalletProvider>
  );
}
