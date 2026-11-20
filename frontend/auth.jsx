import React, { Component, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useWallets, useLogin, useCreateWallet, useUser, useSignTransaction } from '@privy-io/react-auth';
import { account, ACCOUNT_CHAIN } from './account.js';
import { connectedEmbeddedWallet, createWalletEnsurer, privySessionSnapshot } from './privy-session.js';

// Adapted from the team's small Privy bridge, not its Next.js app or backend.
function AccountBridge() {
  const { ready, authenticated, logout, getAccessToken, isModalOpen } = usePrivy();
  const { user, refreshUser } = useUser();
  const { wallets, ready: walletsReady } = useWallets();
  const { login } = useLogin({ onComplete: account.finishLogin, onError: account.failLogin });
  const { createWallet } = useCreateWallet();
  const { signTransaction } = useSignTransaction();
  const latest = useRef(null);
  latest.current = { ready, authenticated, user, wallets, walletsReady, refreshUser, createWallet, signTransaction };
  const ensurer = useRef(null);
  if (!ensurer.current) ensurer.current = createWalletEnsurer({
    getContext: () => latest.current,
    refreshUser: () => latest.current.refreshUser(),
    createWallet: () => latest.current.createWallet(),
  });

  useEffect(() => {
    account.attachRuntime({
      login, logout, getAccessToken, ensureWallet: ensurer.current,
      signTransaction: async tx => {
        const current=latest.current;
        const embedded=connectedEmbeddedWallet(current.user,current.wallets,current.walletsReady);
        if(!embedded||embedded.address.toLowerCase()!==tx.from.toLowerCase())throw Error('Your account changed. Please try again.');
        await embedded.switchChain(ACCOUNT_CHAIN.id);
        const fresh=latest.current;
        if(fresh.user?.id!==current.user?.id||!connectedEmbeddedWallet(fresh.user,fresh.wallets,fresh.walletsReady))throw Error('Your account changed. Please try again.');
        const {signature}=await fresh.signTransaction({chainId:ACCOUNT_CHAIN.id,to:tx.to,from:tx.from,data:tx.data,value:BigInt(tx.value),nonce:Number(tx.nonce),gasLimit:BigInt(tx.gas),gasPrice:BigInt(tx.gasPrice),type:0},{address:embedded.address,uiOptions:{showWalletUIs:false}});
        return signature;
      },
      getProvider: async () => {
        const current = latest.current;
        const embedded = connectedEmbeddedWallet(current.user, current.wallets, current.walletsReady);
        if (!embedded) throw new Error('Your account is still being set up.');
        return embedded.getEthereumProvider();
      },
    });
    account.updateSession(privySessionSnapshot({ ready, authenticated, user, wallets, walletsReady, dialogOpen: isModalOpen }));
  }, [ready, authenticated, user, wallets, walletsReady, isModalOpen, login, logout, getAccessToken, signTransaction]);
  return null;
}

class AccountBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { account.failInitialization(); }
  render() { return this.state.failed ? null : this.props.children; }
}

const appId = import.meta.env.VITE_PRIVY_APP_ID?.trim();
if (!appId) {
  account.setUnavailable();
} else {
  createRoot(document.querySelector('#auth-root')).render(
    <AccountBoundary>
      <PrivyProvider appId={appId} config={{
        loginMethods: ['email'],
        defaultChain: ACCOUNT_CHAIN,
        supportedChains: [ACCOUNT_CHAIN],
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' }, showWalletUIs: false },
        appearance: { theme: 'light', accentColor: '#3974e6', landingHeader: 'Your music intuition starts here', loginMessage: 'Sign up or log in with your email.' },
      }}>
        <AccountBridge />
      </PrivyProvider>
    </AccountBoundary>,
  );
}
