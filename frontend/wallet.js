export const ARC_TESTNET = Object.freeze({
  id: 5042002,
  chainId: '0x4cef52',
  chainName: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: ['https://rpc.testnet.arc.io'],
  blockExplorerUrls: ['https://explorer.testnet.arc.io'],
});

// Native Arc values have 18 decimals. Keep integer precision while formatting.
export function formatUSDC(raw) {
  const value = BigInt(raw);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = (absolute / 10n ** 18n).toLocaleString('en-US');
  const fraction = ((absolute % 10n ** 18n) / 10n ** 12n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '−' : ''}${whole}${fraction ? `.${fraction}` : ''} USDC`;
}

const PREFERENCE_KEY = 'music-prediction-wallet-v1';
const host = globalThis.window ?? globalThis;
const listeners = new Set();
let provider = null;
let discoveryPriority = 0;
let initialized = false;
let wanted = false;
let panelOpen = false;
let session = 0;
let readSequence = 0;
let reading = null;
let operation = null;
let providerHandlers = null;
let state = {
  available: false,
  status: 'disconnected',
  address: null,
  chainId: null,
  balance: null,
  balanceStatus: 'idle',
  busy: null,
  error: '',
  updatedAt: null,
};

function preference(value) {
  try {
    const storage = globalThis.localStorage ?? host.localStorage;
    if (value !== undefined) storage?.setItem(PREFERENCE_KEY, value ? 'true' : 'false');
    return storage?.getItem(PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
}

function publish(patch = {}) {
  state = { ...state, ...patch, busy: operation?.type ?? (reading ? 'refresh' : null) };
  for (const listener of listeners) {
    try { listener({ ...state }); } catch (error) { console.error('Wallet display update failed.', error); }
  }
}

function normalizeChain(value) {
  try { return `0x${BigInt(value).toString(16)}`; } catch { return null; }
}

function firstAddress(accounts) {
  return Array.isArray(accounts) && typeof accounts[0] === 'string' && /^0x[0-9a-f]{40}$/i.test(accounts[0]) ? accounts[0] : null;
}

function errorCode(error) {
  return Number(error?.code ?? error?.data?.originalError?.code);
}

function messageFor(error, task) {
  const code = errorCode(error);
  if (code === 4001) return task === 'switch' ? 'Network switch cancelled. Choose Switch to Arc Testnet to try again.' : 'Connection cancelled. Choose Connect MetaMask when you are ready.';
  if (code === -32002) return 'A request is already open in MetaMask. Open MetaMask to finish it, then try again.';
  if (code === 4100) return 'MetaMask has not granted access to this account. Connect MetaMask again.';
  if (code === 4900 || code === 4901) return 'MetaMask cannot reach the network. Check your connection and try again.';
  if (task === 'switch') return 'Could not switch networks. Open MetaMask, select Arc Testnet, then refresh.';
  if (task === 'connect') return 'Could not connect to MetaMask. Unlock your wallet and try again.';
  return 'Could not read your Arc Testnet balance. Check MetaMask and your connection, then refresh.';
}

function invalidateRead() {
  readSequence += 1;
  reading = null;
}

function readRPC(target, method, params = []) {
  let timeout;
  return Promise.race([
    Promise.resolve().then(() => target.request({ method, params })),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Wallet read timed out.')), 15000);
      timeout?.unref?.();
    }),
  ]).finally(() => clearTimeout(timeout));
}

async function synchronize({ silent = false } = {}) {
  if (!provider || !wanted) return;
  const target = provider;
  const token = { id: ++readSequence, session };
  reading = token;
  const current = () => reading === token && token.id === readSequence && token.session === session && provider === target && wanted;
  publish({ balance: null, balanceStatus: 'loading', updatedAt: null, error: '' });
  try {
    const address = firstAddress(await readRPC(target, 'eth_accounts'));
    if (!current()) return;
    if (!address) {
      publish({ status: 'disconnected', address: null, chainId: null, balance: null, balanceStatus: 'idle', error: silent ? '' : 'Unlock MetaMask or connect an account to continue.' });
      return;
    }
    publish({ status: 'connected', address });
    const chainId = normalizeChain(await readRPC(target, 'eth_chainId'));
    if (!current()) return;
    if (!chainId) throw new Error('Invalid network response.');
    publish({ chainId });
    if (chainId !== ARC_TESTNET.chainId) {
      publish({ balanceStatus: 'idle' });
      return;
    }
    const raw = await readRPC(target, 'eth_getBalance', [address, 'latest']);
    if (!current()) return;
    if (typeof raw !== 'string' || !/^0x[0-9a-f]+$/i.test(raw)) throw new Error('Invalid balance response.');
    publish({ balance: BigInt(raw), balanceStatus: 'ready', updatedAt: Date.now() });
  } catch (error) {
    if (current()) publish({ balance: null, balanceStatus: 'error', error: messageFor(error, 'read') });
  } finally {
    if (reading === token) { reading = null; publish(); }
  }
}

function detachProvider() {
  if (!provider || !providerHandlers) return;
  for (const [event, handler] of Object.entries(providerHandlers)) provider.removeListener?.(event, handler);
  providerHandlers = null;
}

function selectProvider(next, priority) {
  if (!next || typeof next.request !== 'function' || next === provider || priority < discoveryPriority) return;
  if (provider && (state.status === 'connected' || operation)) return;
  detachProvider();
  provider = next;
  discoveryPriority = priority;
  session += 1;
  invalidateRead();
  providerHandlers = {
    accountsChanged(accounts) {
      if (provider !== next || !wanted) return;
      invalidateRead();
      const address = firstAddress(accounts);
      publish({ status: address ? 'connected' : 'disconnected', address, chainId: null, balance: null, balanceStatus: 'idle', updatedAt: null, error: address ? '' : 'Unlock MetaMask or connect an account to continue.' });
      if (address) void synchronize();
    },
    chainChanged(chain) {
      if (provider !== next || !wanted) return;
      invalidateRead();
      publish({ chainId: normalizeChain(chain), balance: null, balanceStatus: 'idle', updatedAt: null, error: '' });
      void synchronize();
    },
    disconnect() {
      if (provider !== next || !wanted) return;
      session += 1;
      wanted = false;
      invalidateRead();
      publish({ status: 'disconnected', address: null, chainId: null, balance: null, balanceStatus: 'idle', updatedAt: null, error: 'MetaMask disconnected. Check your wallet and connect again.' });
    },
  };
  for (const [event, handler] of Object.entries(providerHandlers)) provider.on?.(event, handler);
  publish({ available: true });
  if (wanted) void synchronize({ silent: true });
}

function legacyDiscovery() {
  const injected = host.ethereum;
  const candidates = Array.isArray(injected?.providers) ? injected.providers : [injected];
  const metamask = candidates.find(item => item?.isMetaMask && !item?.isBraveWallet && !item?.isCoinbaseWallet);
  if (metamask) selectProvider(metamask, 1);
}

function init() {
  if (initialized) return;
  initialized = true;
  wanted = preference();
  host.addEventListener?.('eip6963:announceProvider', event => {
    if (event.detail?.info?.rdns === 'io.metamask') selectProvider(event.detail.provider, 2);
  });
  if (typeof Event === 'function') host.dispatchEvent?.(new Event('eip6963:requestProvider'));
  legacyDiscovery();
  host.addEventListener?.('ethereum#initialized', legacyDiscovery);
  host.addEventListener?.('focus', () => { if (wanted && !operation) void synchronize({ silent: true }); });
  globalThis.document?.addEventListener?.('visibilitychange', () => {
    if (!document.hidden && wanted && !operation) void synchronize({ silent: true });
  });
  const interval = setInterval(() => {
    if (panelOpen && !globalThis.document?.hidden && wanted && !operation && !reading) void synchronize();
  }, 30000);
  interval?.unref?.();
}

async function connect() {
  init();
  if (operation) return;
  if (!provider) {
    legacyDiscovery();
    if (!provider) { publish({ available: false, error: 'MetaMask was not found. Open this app in the browser where MetaMask is installed.' }); return; }
  }
  if (state.status === 'connected') { await synchronize(); return; }
  const op = { type: 'connect', session: ++session };
  const target = provider;
  operation = op;
  wanted = true;
  invalidateRead();
  publish({ status: 'connecting', address: null, chainId: null, balance: null, balanceStatus: 'idle', updatedAt: null, error: '' });
  try {
    const accounts = await target.request({ method: 'eth_requestAccounts' });
    if (op.session !== session || !wanted || provider !== target) return;
    if (!firstAddress(accounts)) throw new Error('No account returned.');
    preference(true);
    await synchronize();
  } catch (error) {
    if (op.session === session && wanted) {
      wanted = false;
      preference(false);
      invalidateRead();
      publish({ status: 'disconnected', address: null, chainId: null, balance: null, balanceStatus: 'idle', updatedAt: null, error: messageFor(error, 'connect') });
    }
  } finally {
    if (operation === op) {
      operation = null;
      publish({ status: state.address ? 'connected' : 'disconnected' });
    }
  }
}

async function switchToArc() {
  if (!provider || !wanted || !state.address || operation) return;
  const target = provider;
  const op = { type: 'switch', session };
  operation = op;
  invalidateRead();
  publish({ balance: null, balanceStatus: 'idle', updatedAt: null, error: '' });
  const current = () => op.session === session && wanted && target === provider;
  try {
    try {
      await target.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_TESTNET.chainId }] });
    } catch (error) {
      if (!current()) return;
      if (errorCode(error) !== 4902) throw error;
      const { id, ...network } = ARC_TESTNET;
      await target.request({ method: 'wallet_addEthereumChain', params: [network] });
      if (!current()) return;
      await target.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ARC_TESTNET.chainId }] });
    }
    if (current()) await synchronize();
  } catch (error) {
    if (current()) publish({ error: messageFor(error, 'switch') });
  } finally {
    if (operation === op) { operation = null; publish(); }
  }
}

async function refresh() {
  if (operation) return;
  await synchronize();
}

function disconnect() {
  wanted = false;
  preference(false);
  session += 1;
  invalidateRead();
  // An already-open MetaMask approval remains pending there, preventing duplicates.
  publish({ status: 'disconnected', address: null, chainId: null, balance: null, balanceStatus: 'idle', updatedAt: null, error: '' });
}

function setPanelOpen(open) {
  panelOpen = Boolean(open);
  if (panelOpen && wanted && !operation && !reading) void synchronize({ silent: true });
}

export const wallet = {
  init,
  getState: () => ({ ...state }),
  // The separate deployment tool uses this provider only after explicit clicks.
  getProvider: () => wanted && state.status === 'connected' ? provider : null,
  subscribe(listener) {
    listeners.add(listener);
    listener({ ...state });
    return () => listeners.delete(listener);
  },
  connect,
  switchToArc,
  refresh,
  disconnect,
  setPanelOpen,
};
