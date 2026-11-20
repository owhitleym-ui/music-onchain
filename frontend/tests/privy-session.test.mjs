import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedEmbeddedWallet, createWalletEnsurer, linkedEmbeddedWallet, privySessionSnapshot } from '../privy-session.js';

const A = `0x${'a'.repeat(40)}`;
const B = `0x${'b'.repeat(40)}`;
const linked = (address = A, extra = {}) => ({ type: 'wallet', chainType: 'ethereum', walletClientType: 'privy', address, walletIndex: 0, ...extra });
const user = (accounts = [], id = 'fan-a') => ({ id, email: { address: `${id}@example.com` }, linkedAccounts: accounts });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

test('only a current user’s linked embedded Ethereum wallet can become connected', () => {
  const profile = user([linked(A)]);
  const external = { address: A, walletClientType: 'metamask' };
  const previousUserWallet = { address: B, walletClientType: 'privy' };
  assert.equal(connectedEmbeddedWallet(profile, [external, previousUserWallet], true), null);
  const current = { address: A.toUpperCase().replace('0X', '0x'), walletClientType: 'privy' };
  assert.equal(connectedEmbeddedWallet(profile, [current], false), null);
  assert.equal(connectedEmbeddedWallet(profile, [current], true), current);
});

test('wallet selection is stable when the profile contains more than one HD account', () => {
  const first = linked(A, { walletIndex: 0 });
  const later = linked(B, { walletIndex: 1 });
  assert.equal(linkedEmbeddedWallet(user([later, first])), first);
  assert.equal(linkedEmbeddedWallet(user([first, later])), first);
  assert.equal(linkedEmbeddedWallet(user([linked(A, { chainType: 'solana' })])), null);
});

test('session snapshots separate authentication, linked wallets, and connection readiness', () => {
  const input = { ready: true, authenticated: true, user: user([linked()]), wallets: [{ address: A, walletClientType: 'privy' }], walletsReady: false };
  const restoring = privySessionSnapshot(input);
  assert.equal(restoring.authenticated, true);
  assert.equal(restoring.linkedWalletAddress, A);
  assert.equal(restoring.address, null);
  assert.equal(privySessionSnapshot({ ...input, walletsReady: true }).address, A);
  const signedOut = privySessionSnapshot({ ...input, authenticated: false, walletsReady: true });
  assert.equal(signedOut.address, null);
  assert.equal(signedOut.linkedWalletAddress, null);
  assert.equal(signedOut.email, null);
});

test('a refreshed profile with an existing wallet is reused without creation', async () => {
  let creates = 0;
  let refreshes = 0;
  const context = { ready: true, authenticated: true, walletsReady: true, user: user() };
  const ensure = createWalletEnsurer({
    getContext: () => context,
    refreshUser: async () => { refreshes++; return user([linked()]); },
    createWallet: async () => { creates++; },
  });
  assert.deepEqual(await ensure(), { reused: true });
  assert.equal(creates, 0);
  assert.equal(refreshes, 1);
});

test('waiting for SDK wallets does not trigger creation', async () => {
  let creates = 0;
  const context = { ready: true, authenticated: true, walletsReady: false, user: user() };
  const ensure = createWalletEnsurer({ getContext: () => context, refreshUser: async () => user(), createWallet: async () => { creates++; } });
  assert.deepEqual(await ensure(), { waiting: true });
  assert.equal(creates, 0);
});

test('concurrent retries share one creation and refresh the profile afterward', async () => {
  let creates = 0;
  let refreshes = 0;
  const pending = deferred();
  const context = { ready: true, authenticated: true, walletsReady: true, user: user() };
  const ensure = createWalletEnsurer({
    getContext: () => context,
    refreshUser: async () => { refreshes++; return context.user; },
    createWallet: async () => { creates++; await pending.promise; context.user = user([linked()]); },
  });
  const first = ensure();
  const second = ensure();
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(creates, 1);
  pending.resolve();
  assert.deepEqual(await first, { created: true });
  assert.equal(refreshes, 2);
  assert.deepEqual(await ensure(), { reused: true });
  assert.equal(creates, 1);
});

test('a logout during profile refresh prevents creation', async () => {
  const pending = deferred();
  let current = true;
  let creates = 0;
  const context = { ready: true, authenticated: true, walletsReady: true, user: user() };
  const ensure = createWalletEnsurer({ getContext: () => context, refreshUser: () => pending.promise, createWallet: async () => { creates++; } });
  const result = ensure({ isCurrent: () => current });
  current = false;
  pending.resolve(user());
  await assert.rejects(result, /Account changed/);
  assert.equal(creates, 0);
});

test('a profile or context for a different user prevents creation', async () => {
  let creates = 0;
  const context = { ready: true, authenticated: true, walletsReady: true, user: user() };
  const ensure = createWalletEnsurer({ getContext: () => context, refreshUser: async () => user([], 'fan-b'), createWallet: async () => { creates++; } });
  await assert.rejects(ensure(), /Account changed/);
  assert.equal(creates, 0);
});

test('automatic creation racing with a retry is recovered from the refreshed profile', async () => {
  let refreshes = 0;
  let creates = 0;
  const context = { ready: true, authenticated: true, walletsReady: true, user: user() };
  const ensure = createWalletEnsurer({
    getContext: () => context,
    refreshUser: async () => ++refreshes === 1 ? user() : user([linked()]),
    createWallet: async () => { creates++; throw Error('Already exists'); },
  });
  assert.deepEqual(await ensure(), { reused: true });
  assert.equal(creates, 1);
});

test('real creation failure is retryable and does not invent an account address', async () => {
  let creates = 0;
  const context = { ready: true, authenticated: true, walletsReady: true, user: user() };
  const ensure = createWalletEnsurer({ getContext: () => context, refreshUser: async () => context.user, createWallet: async () => { creates++; throw Error('Network down'); } });
  await assert.rejects(ensure(), /Network down/);
  await assert.rejects(ensure(), /Network down/);
  assert.equal(creates, 2);
  assert.equal(linkedEmbeddedWallet(context.user), null);
});
