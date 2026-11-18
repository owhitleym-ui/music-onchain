"use client";

// One wallet interface for the whole UI, with two implementations:
//
//  1. Privy (production): email login creates an embedded wallet with no seed phrase.
//     Used whenever NEXT_PUBLIC_PRIVY_APP_ID is set.
//  2. Local test wallet (development only): when there's no Privy app ID yet, "Sign in" makes a
//     throwaway private key and keeps it in this browser's localStorage. That lets the team click
//     through the whole flow against local anvil or testnet before Privy is configured.
//     Never hold real funds with it.
//
// Components only ever call useWallet(); they don't know which one is active.
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { createWalletClient, custom, http, type Address, type Hex, type WalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { chain, config } from "./config";

export type Wallet = {
  mode: "privy" | "local";
  /** False until the wallet SDK has finished loading; hide sign-in buttons until then. */
  ready: boolean;
  authenticated: boolean;
  address: Address | null;
  /** What to show in the profile menu: the user's email, or "Local test wallet". */
  label: string | null;
  login: () => void;
  logout: () => Promise<void>;
  /** Bearer token for /api/faucet. Null for the local test wallet (the faucet's dev mode accepts that). */
  getAccessToken: () => Promise<string | null>;
  /** A viem wallet client on the right chain, used to send approve/enter. */
  getWalletClient: () => Promise<WalletClient>;
};

const WalletContext = createContext<Wallet | null>(null);

export function useWallet(): Wallet {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("useWallet must be used inside <WalletProvider>");
  return wallet;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!config.privyAppId) return <LocalWalletProvider>{children}</LocalWalletProvider>;
  return (
    <PrivyProvider
      appId={config.privyAppId}
      config={{
        loginMethods: ["email"],
        defaultChain: chain,
        supportedChains: [chain],
        // Create the embedded wallet during sign-up so "Sign in" is the only step.
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
        appearance: { theme: "light", accentColor: "#245ee6" },
      }}
    >
      <PrivyWalletBridge>{children}</PrivyWalletBridge>
    </PrivyProvider>
  );
}

/** Adapts Privy's hooks to the Wallet interface. */
function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  // The Privy-made embedded wallet (not an external wallet the user might have linked).
  const embedded = wallets.find((w) => w.walletClientType === "privy");

  const getWalletClient = useCallback(async () => {
    if (!embedded) throw new Error("Your wallet is still being created. Try again in a moment.");
    await embedded.switchChain(chain.id);
    const provider = await embedded.getEthereumProvider();
    return createWalletClient({ account: embedded.address as Address, chain, transport: custom(provider) });
  }, [embedded]);

  const value = useMemo<Wallet>(
    () => ({
      mode: "privy",
      ready,
      authenticated,
      address: authenticated && embedded ? (embedded.address as Address) : null,
      label: user?.email?.address ?? null,
      login,
      logout,
      getAccessToken,
      getWalletClient,
    }),
    [ready, authenticated, embedded, user, login, logout, getAccessToken, getWalletClient],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

// --- Local test wallet -------------------------------------------------------------------
// The key lives in localStorage. useSyncExternalStore reads it in a hydration-safe way:
// the server render sees "no key, not ready", the browser then reads the real value.

const LOCAL_KEY = "local-test-wallet-key";
const listeners = new Set<() => void>();

function readLocalKey(): Hex | null {
  try {
    return (localStorage.getItem(LOCAL_KEY) as Hex | null) ?? null;
  } catch {
    return null; // storage blocked (private mode etc.): behave as signed out
  }
}

function writeLocalKey(key: Hex | null) {
  try {
    if (key) localStorage.setItem(LOCAL_KEY, key);
    else localStorage.removeItem(LOCAL_KEY);
  } catch {}
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** Development stand-in for Privy. See the note at the top of this file. */
function LocalWalletProvider({ children }: { children: ReactNode }) {
  const key = useSyncExternalStore(subscribe, readLocalKey, () => null);
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const account = useMemo(() => (key ? privateKeyToAccount(key) : null), [key]);

  const value = useMemo<Wallet>(
    () => ({
      mode: "local",
      ready,
      authenticated: account !== null,
      address: account?.address ?? null,
      label: "Local test wallet",
      login: () => writeLocalKey(readLocalKey() ?? generatePrivateKey()),
      // Forget the key entirely, like signing out on a lost device. The next sign-in is a new wallet.
      logout: async () => writeLocalKey(null),
      getAccessToken: async () => null,
      getWalletClient: async () => {
        if (!account) throw new Error("Sign in first");
        return createWalletClient({ account, chain, transport: http(config.rpcUrl) });
      },
    }),
    [account, ready],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
