// Small, SDK-independent helpers so account restoration can be tested without a login.
const validAddress = value => typeof value === 'string' && /^0x[\da-f]{40}$/i.test(value);
const sameAddress = (a, b) => validAddress(a) && validAddress(b) && a.toLowerCase() === b.toLowerCase();
const isEmbedded = wallet => ['privy', 'privy-v2'].includes(wallet?.walletClientType);

export function linkedEmbeddedWallet(user) {
  const linked = (user?.linkedAccounts ?? []).filter(item => item.type === 'wallet'
    && item.chainType === 'ethereum' && isEmbedded(item) && validAddress(item.address));
  // If a profile ever has several wallets, consistently reuse its first HD account.
  return linked.sort((a, b) => (a.walletIndex ?? Number.MAX_SAFE_INTEGER) - (b.walletIndex ?? Number.MAX_SAFE_INTEGER)
    || a.address.toLowerCase().localeCompare(b.address.toLowerCase()))[0] ?? null;
}

export function connectedEmbeddedWallet(user, wallets, walletsReady) {
  if (!walletsReady) return null;
  const linked = linkedEmbeddedWallet(user);
  return (wallets ?? []).find(item => isEmbedded(item) && sameAddress(item.address, linked?.address)) ?? null;
}

export function privySessionSnapshot({ ready, authenticated, user, wallets = [], walletsReady, dialogOpen = false }) {
  const signedIn = Boolean(ready && authenticated && user?.id);
  const linked = signedIn ? linkedEmbeddedWallet(user) : null;
  const connected = signedIn ? connectedEmbeddedWallet(user, wallets, walletsReady) : null;
  return {
    ready: Boolean(ready), authenticated: signedIn,
    userId: signedIn ? user.id : null, email: signedIn ? user.email?.address ?? null : null,
    walletsReady: Boolean(signedIn && walletsReady),
    linkedWalletAddress: linked?.address ?? null, address: connected?.address ?? null,
    dialogOpen: Boolean(dialogOpen),
  };
}

export function createWalletEnsurer({ getContext, refreshUser, createWallet }) {
  let pending = null;
  return function ensureWallet({ isCurrent = () => true } = {}) {
    if (pending) return pending;
    const initial = getContext();
    if (!initial.ready || !initial.authenticated || !initial.user?.id || !isCurrent()) {
      return Promise.reject(new Error('Account changed. Please try again.'));
    }
    const userId = initial.user.id;
    function check() {
      const current = getContext();
      if (!isCurrent() || !current.ready || !current.authenticated || current.user?.id !== userId) {
        throw new Error('Account changed. Please try again.');
      }
      return current;
    }
    pending = (async () => {
      // Always refresh the authoritative profile before deciding that no wallet exists.
      const fresh = await refreshUser();
      const current = check();
      if (fresh?.id !== userId) throw new Error('Account changed. Please try again.');
      if (linkedEmbeddedWallet(fresh) || linkedEmbeddedWallet(current.user)) return { reused: true };
      if (!current.walletsReady) return { waiting: true };
      check();
      try {
        await createWallet();
      } catch (error) {
        // The SDK's automatic creation can finish while a retry is refreshing. Recheck
        // instead of treating "already exists" as permission to create another wallet.
        check();
        const refreshed = await refreshUser();
        check();
        if (refreshed?.id === userId && linkedEmbeddedWallet(refreshed)) return { reused: true };
        throw error;
      }
      check();
      await refreshUser();
      check();
      return { created: true };
    })().finally(() => { pending = null; });
    return pending;
  };
}
