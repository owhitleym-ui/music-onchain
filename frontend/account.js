import { createApprovalClient, createApprovalController } from './approval.js';
// An SDK-independent account service for the existing JavaScript screens.
// Authentication, wallet creation and key storage belong to Privy, never localStorage here.
export const ACCOUNT_CHAIN = Object.freeze({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.io' } },
  testnet: true,
});

export async function readAccountBalance(address, { signal } = {}) {
  const response = await fetch(ACCOUNT_CHAIN.rpcUrls.default.http[0], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
    signal,
  });
  if (!response.ok) throw new Error('Balance service unavailable.');
  const result = await response.json();
  if (result.error || typeof result.result !== 'string' || !/^0x[\da-f]+$/i.test(result.result)) throw new Error('Invalid balance response.');
  return BigInt(result.result);
}

export function createAccount({ readBalance = readAccountBalance, timeoutMs = 15000, setupTimeoutMs = 30000, approvalClient = null, approvalOptions = {} } = {}) {
  let state = {
    configured: false, ready: false, authenticated: false,
    userId: null, email: null, address: null, busy: null,
    walletsReady: false, linkedWalletAddress: null, dialogOpen: false,
    setupStatus: 'idle', balance: null, balanceStatus: 'idle',
    error: '', balanceError: '', updatedAt: null,
    approvalStatus: 'idle', approvalError: '', approvalCanRetry: false,
  };
  const listeners = new Set();
  let runtime = null;
  let generation = 0;
  let readId = 0;
  let reading = null;
  let setupTimer = null;
  let initialTimer = null;
  let pollTimer = null;
  let panelOpen = false;
  let signingOut = false;
  let blockedUserId = null;
  let setupOperation = null;
  const approvals = approvalClient ? createApprovalController({
    ...approvalOptions, getSession: () => state, client: approvalClient, onChange: patch => publish(patch),
    getToken: async () => {
      if (!state.authenticated || signingOut || !runtime) return null;
      const session = generation;
      const token = await runtime.getAccessToken();
      return session === generation && state.authenticated && !signingOut ? token : null;
    },
  }) : null;

  function publish(patch) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener({ ...state });
  }

  function clearRead() {
    approvals?.cancel();
    state = { ...state, approvalStatus: 'idle', approvalError: '', approvalCanRetry: false };
    generation++;
    readId++;
    reading?.controller.abort();
    reading = null;
    setupOperation = null;
  }

  function clearSetup() {
    clearTimeout(setupTimer);
    setupTimer = null;
  }

  function trackSetup() {
    if (setupTimer || !['creating', 'restoring'].includes(state.setupStatus)) return;
    setupTimer = setTimeout(() => {
      setupTimer = null;
      if (state.authenticated && !state.address) publish({
        setupStatus: 'error', busy: setupOperation ? 'setup' : null,
        error: 'We couldn’t finish setting up your account. Please try again.',
      });
    }, setupTimeoutMs);
    setupTimer.unref?.();
  }

  async function refreshBalance() {
    if (!state.authenticated || !state.address || signingOut) return;
    if (reading) return reading.promise;
    const address = state.address;
    const session = generation;
    const requestId = ++readId;
    const controller = new AbortController();
    let timer;
    const pending = {};
    reading = pending;
    pending.controller = controller;
    publish({ balanceStatus: 'loading', balanceError: '' });
    pending.promise = (async () => {
      try {
        const balance = await Promise.race([
          Promise.resolve().then(() => readBalance(address, { signal: controller.signal })),
          new Promise((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error('Timed out')); }, timeoutMs);
          }),
        ]);
        if (session !== generation || requestId !== readId || signingOut) return;
        const value = BigInt(balance);
        if (value < 0n) throw new Error('Invalid balance');
        publish({ balance: value, balanceStatus: 'ready', balanceError: '', updatedAt: Date.now() });
      } catch {
        if (session !== generation || requestId !== readId || signingOut) return;
        publish({ balance: null, balanceStatus: 'error', balanceError: 'Your balance is unavailable. Please refresh to try again.', updatedAt: null });
      } finally {
        clearTimeout(timer);
        if (reading === pending) reading = null;
      }
    })();
    return pending.promise;
  }

  function attachRuntime(adapter) {
    runtime = adapter;
    if (!state.configured) {
      publish({ configured: true, error: '' });
      initialTimer = setTimeout(() => {
        if (!state.ready) publish({ error: 'Sign-in is taking longer than expected. Check your connection or reload the page.' });
      }, setupTimeoutMs);
      initialTimer.unref?.();
    }
  }

  function updateSession(snapshot) {
    if (!snapshot.ready) {
      if (state.ready || state.authenticated) {
        clearRead();
        clearSetup();
        publish({ ready: false, authenticated: false, userId: null, email: null, address: null,
          walletsReady: false, linkedWalletAddress: null, dialogOpen: Boolean(snapshot.dialogOpen),
          balance: null, balanceStatus: 'idle', balanceError: '', updatedAt: null, setupStatus: 'idle', busy: null, error: '' });
        schedulePoll();
      }
      return;
    }
    clearTimeout(initialTimer);
    const authenticated = Boolean(snapshot.authenticated && snapshot.userId);
    // Ignore an old SDK snapshot while logout is in flight; never restore the old balance.
    if ((signingOut || snapshot.userId === blockedUserId) && authenticated) return;
    if (!authenticated) blockedUserId = null;
    const walletsReady = authenticated && snapshot.walletsReady === true;
    const linkedWalletAddress = authenticated && /^0x[\da-f]{40}$/i.test(snapshot.linkedWalletAddress ?? '') ? snapshot.linkedWalletAddress : null;
    const address = walletsReady && linkedWalletAddress && /^0x[\da-f]{40}$/i.test(snapshot.address ?? '')
      && snapshot.address.toLowerCase() === linkedWalletAddress.toLowerCase() ? snapshot.address : null;
    const userId = authenticated ? snapshot.userId : null;
    const changed = userId !== state.userId || address?.toLowerCase() !== state.address?.toLowerCase();
    if (changed) clearRead();
    if (changed || !authenticated || address) clearSetup();
    const wasSetupError = authenticated && !address && state.setupStatus === 'error' && !changed;
    const setupStatus = !authenticated ? 'idle' : address ? 'ready' : wasSetupError ? 'error'
      : !walletsReady || linkedWalletAddress ? 'restoring' : 'creating';
    if (setupStatus !== state.setupStatus) clearSetup();
    const dialogOpen = Boolean(snapshot.dialogOpen);
    const cancelledDialog = state.dialogOpen && !dialogOpen && !authenticated && state.busy === 'login';
    publish({
      ready: true, authenticated, userId,
      email: authenticated ? snapshot.email ?? null : null, address,
      walletsReady, linkedWalletAddress, dialogOpen, setupStatus,
      busy: authenticated ? state.busy === 'setup' && !address ? 'setup' : null
        : signingOut ? 'logout' : cancelledDialog ? null : state.busy === 'login' ? 'login' : null,
      ...(changed || !authenticated ? { balance: null, balanceStatus: 'idle', balanceError: '', updatedAt: null } : {}),
      ...(!wasSetupError && state.busy !== 'login' ? { error: '' } : {}),
    });
    trackSetup();
    if (address && changed) { void refreshBalance(); void approvals?.start(); }
    schedulePoll();
  }

  async function signIn() {
    if (!state.configured || !runtime) {
      publish({ error: 'Sign-in is not configured yet. You can still explore the demo.' });
      return;
    }
    if (!state.ready || state.busy || state.authenticated || signingOut) return;
    publish({ busy: 'login', error: '' });
    try { await runtime.login(); } catch (error) { failLogin(error); }
  }

  function finishLogin() {
    if (signingOut) return;
    publish({ busy: state.busy === 'login' ? null : state.busy, error: '' });
  }

  function failLogin(error) {
    if (signingOut) return;
    const cancelled = /cancel|close|exit/i.test(String(error?.code ?? error));
    if (state.authenticated) {
      if (!state.address && !cancelled) publish({ setupStatus: 'error', error: 'You’re signed in, but account setup didn’t finish. Please try again.' });
      return;
    }
    publish({ busy: null, error: cancelled ? '' : 'We couldn’t sign you in. Please try again.' });
  }

  async function retrySetup() {
    if (!state.authenticated || state.address || state.busy || setupOperation || !runtime || signingOut) return;
    const session = generation;
    clearSetup();
    const operation = {};
    setupOperation = operation;
    const isCurrent = () => session === generation && setupOperation === operation && !signingOut && state.authenticated;
    publish({ setupStatus: !state.walletsReady || state.linkedWalletAddress ? 'restoring' : 'creating', busy: 'setup', error: '' });
    trackSetup();
    try {
      await runtime.ensureWallet({ isCurrent });
      // A creation result alone does not make a wallet usable. The SDK bridge must
      // report a connected wallet linked to this user before we expose its balance.
    } catch {
      if (isCurrent()) {
        clearSetup();
        publish({ setupStatus: 'error', busy: null, error: 'We couldn’t finish setting up your account. Please try again.' });
      }
    } finally {
      if (setupOperation === operation) {
        setupOperation = null;
        if (state.setupStatus === 'error' && state.busy === 'setup') publish({ busy: null });
      }
    }
  }

  async function signOut() {
    if (!state.authenticated || !runtime || signingOut) return;
    signingOut = true;
    const previous = { ...state };
    blockedUserId = previous.userId;
    clearRead();
    clearSetup();
    publish({ authenticated: false, userId: null, email: null, address: null,
      walletsReady: false, linkedWalletAddress: null, dialogOpen: false,
      balance: null, balanceStatus: 'idle', balanceError: '', updatedAt: null, setupStatus: 'idle', busy: 'logout', error: '' });
    schedulePoll();
    try {
      await runtime.logout();
      signingOut = false;
      publish({ busy: null });
    } catch {
      signingOut = false;
      blockedUserId = null;
      publish({ ...previous, balance: null, balanceStatus: 'idle', updatedAt: null, busy: null, error: 'Sign-out didn’t finish. Please try again.' });
      if (state.address) { void refreshBalance(); void approvals?.start(); }
      schedulePoll();
    }
  }

  function setUnavailable() {
    clearTimeout(initialTimer);
    clearRead();
    clearSetup();
    publish({ configured: false, ready: true, authenticated: false, userId: null, email: null, address: null,
      walletsReady: false, linkedWalletAddress: null, dialogOpen: false,
      balance: null, balanceStatus: 'idle', setupStatus: 'idle', busy: null, error: 'Sign-in is not configured yet. You can still explore the demo.' });
  }

  function failInitialization() {
    clearTimeout(initialTimer);
    clearRead();
    clearSetup();
    publish({ ready: false, authenticated: false, userId: null, email: null, address: null,
      walletsReady: false, linkedWalletAddress: null, dialogOpen: false,
      balance: null, balanceStatus: 'idle', balanceError: '', updatedAt: null, setupStatus: 'idle',
      busy: null, error: 'Sign-in is unavailable right now. Check your connection and reload to try again.' });
    schedulePoll();
  }

  function schedulePoll() {
    clearInterval(pollTimer);
    pollTimer = null;
    if (panelOpen && state.authenticated && state.address && !globalThis.document?.hidden) {
      pollTimer = setInterval(() => void refreshBalance(), 30000);
      pollTimer.unref?.();
    }
  }

  function setPanelOpen(open) { panelOpen = open; schedulePoll(); }
  function onVisibilityChange() {
    schedulePoll();
    if (!globalThis.document?.hidden && state.authenticated) { void refreshBalance(); void approvals?.refresh(); }
  }

  async function getProvider() {
    if (!state.authenticated || !state.address || signingOut || !runtime) throw new Error('Sign in and finish account setup first.');
    const session = generation;
    const provider = await runtime.getProvider();
    if (session !== generation || signingOut) throw new Error('Your account changed. Please try again.');
    return provider;
  }

  return {
    getState: () => ({ ...state }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    attachRuntime, updateSession, signIn, finishLogin, failLogin, retrySetup, signOut,
    refreshBalance, setPanelOpen, onVisibilityChange, setUnavailable, failInitialization, getProvider,
    refreshApproval: () => approvals?.refresh(), retryApproval: () => approvals?.retry(),
    async signTransaction(transaction) {
      if(!state.authenticated||!state.address||signingOut||!runtime?.signTransaction)throw Error('Sign in and finish account setup first.');
      const session=generation;
      if(transaction.from?.toLowerCase()!==state.address.toLowerCase()||transaction.chainId!==ACCOUNT_CHAIN.id)throw Error('The payment account changed.');
      const raw=await runtime.signTransaction(transaction);
      if(session!==generation||signingOut)throw Error('Your account changed. Please check My Purchases.');
      return raw;
    },
    async getAccessToken() {
      if (!state.authenticated || signingOut || !runtime) return null;
      const session = generation;
      const token = await runtime.getAccessToken();
      return session === generation && state.authenticated && !signingOut ? token : null;
    },
    dispose() { approvals?.dispose(); clearRead(); clearSetup(); clearTimeout(initialTimer); clearInterval(pollTimer); listeners.clear(); },
  };
}

export const account = createAccount({ approvalClient: createApprovalClient() });
