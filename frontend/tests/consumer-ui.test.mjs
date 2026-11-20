import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { account } from '../account.js';

const next = () => new Promise(resolve => setImmediate(resolve));

test('consumer account UI preserves our original demo and accessible dialogs', async t => {
  const browser = new Window({ url: 'http://localhost:3000/' });
  browser.document.body.innerHTML = '<div id="app"></div><div id="settings-root"></div><div id="modal-root"></div><div id="toast-root"></div><div id="auth-root"></div>';
  const globals = new Map();
  for (const name of ['window', 'document', 'location', 'localStorage', 'navigator', 'MouseEvent']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value: browser[name] ?? (name === 'window' ? browser : undefined), configurable: true, writable: true });
  }
  const originalFetch = globalThis.fetch;
  let activationStatus = 'approved';
  globalThis.fetch = async url => ({ ok: true, json: async () => url === '/api/account/approval'
    ? { status: activationStatus, walletAddress: `0x${'a'.repeat(40)}`, ...(activationStatus === 'error' ? { message: 'Please try activation again.' } : {}) }
    : { result: `0x${(20n * 10n ** 18n).toString(16)}` } });
  const originalInterval = globalThis.setInterval;
  const intervals = [];
  globalThis.setInterval = (...args) => { const id = originalInterval(...args); id.unref?.(); intervals.push(id); return id; };
  t.after(() => {
    account.dispose();
    intervals.forEach(clearInterval);
    globalThis.setInterval = originalInterval;
    globalThis.fetch = originalFetch;
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    browser.happyDOM.abort();
  });
  const $ = selector => browser.document.querySelector(selector);
  const click = selector => {
    const element = $(selector);
    assert.ok(element, `Missing ${selector}`);
    element.click();
    return element;
  };
  const navigate = hash => {
    browser.location.hash = hash;
    browser.dispatchEvent(new browser.HashChangeEvent('hashchange'));
  };
  let loginCalls = 0;
  let logoutCalls = 0;
  account.attachRuntime({
    login: () => { loginCalls++; },
    logout: async () => { logoutCalls++; account.updateSession({ ready: true, authenticated: false }); },
    getAccessToken: async () => 'managed-by-sdk',
    ensureWallet: async () => {},
    getProvider: async () => ({}),
  });
  account.updateSession({ ready: true, authenticated: false });
  await import('../app.js');

  await t.test('guests can browse and search without seeing wallet setup', () => {
    assert.match(browser.document.body.textContent, /Demo — no real money/);
    assert.equal($('[data-action="account-login"]').textContent, 'Sign up / Log in');
    assert.equal($('[data-action="wallet-connect"]'), null);
    assert.doesNotMatch(browser.document.body.textContent, /USDC|MetaMask|onchain|connect wallet/i);
    const input = $('#song-search');
    input.value = 'no such artist 987';
    input.dispatchEvent(new browser.Event('input', { bubbles: true }));
    assert.match($('.discover-results').textContent, /No songs found/);
    click('[data-action="clear-filters"]');
    assert.ok($('.song-grid'));
  });

  await t.test('Settings is labelled Account and Escape restores keyboard focus', () => {
    const trigger = click('[data-action="settings"]');
    assert.ok($('#settings-panel'));
    assert.match($('#settings-panel').textContent, /Account/);
    assert.doesNotMatch($('#settings-panel').textContent, /wallet|USDC|MetaMask|network|explorer/i);
    assert.equal($('#app').inert, true);
    assert.equal(browser.document.activeElement.dataset.action, 'close-settings');
    browser.document.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal($('#settings-panel'), null);
    assert.equal(browser.document.activeElement, trigger);
  });

  await t.test('starting email login dismisses our panel before Privy opens', async () => {
    click('[data-action="settings"]');
    click('#settings-account [data-action="account-login"]');
    await next();
    assert.equal($('#settings-panel'), null);
    assert.equal($('#app').inert, false);
    assert.equal(browser.document.body.style.overflow, '');
    assert.equal(loginCalls, 1);
    assert.equal($('#header-account button').disabled, true);
    account.failLogin('exited_auth_flow');
    assert.equal($('#header-account button').disabled, false);
    await next();
    assert.equal(browser.document.activeElement, $('#header-account button'));
  });

  await t.test('a restored profile waits for its wallet and never exposes technical details', async () => {
    account.updateSession({ ready: true, authenticated: true, userId: 'fan-1', email: 'fan@example.com',
      walletsReady: false, linkedWalletAddress: `0x${'a'.repeat(40)}` });
    click('[data-action="settings"]');
    assert.match($('#settings-account').textContent, /Setting up/);
    assert.equal($('.account-balance').textContent, 'Setting up…');
    assert.doesNotMatch($('#settings-account').textContent, /wallet|USDC|MetaMask|0x[a-f0-9]{40}/i);
    assert.equal($('[data-action="account-refresh"]').disabled, true);
    click('[data-action="close-settings"]');
  });

  await t.test('verified account and live balance appear only in account settings', async () => {
    account.updateSession({ ready: true, authenticated: true, userId: 'fan-1', email: 'fan@example.com', address: `0x${'a'.repeat(40)}`,
      walletsReady: true, linkedWalletAddress: `0x${'a'.repeat(40)}` });
    await next();
    assert.match($('#header-account').textContent, /fan@example.com/);
    click('[data-action="settings"]');
    assert.match($('#settings-account').textContent, /Email verified/);
    assert.match($('#settings-account').textContent, /Account approved/);
    assert.equal($('.account-balance').textContent, '$20.00');
    assert.match($('#settings-account').textContent, /Demo dollars · no cash value/);
    assert.doesNotMatch($('#settings-account').textContent, /0x[a-f0-9]{40}|USDC|MetaMask|wallet/i);
    click('[data-action="theme"]');
    assert.equal(browser.document.documentElement.dataset.theme, 'dark');
    assert.equal(JSON.parse(browser.localStorage.getItem('music-prediction-demo-v1')).theme, 'dark');
    click('[data-action="reset"]');
    click('[data-action="confirm-reset"]');
    assert.equal(account.getState().authenticated, true);
    assert.equal(account.getState().balance, 20n * 10n ** 18n);
    assert.equal(logoutCalls, 0);
    click('[data-action="close-settings"]');
  });

  await t.test('activation failure is separate from balance, retries, and preserves keyboard focus', async () => {
    click('[data-action="settings"]');
    activationStatus = 'error';
    await account.retryApproval();
    assert.equal($('.account-balance').textContent, '$20.00');
    assert.match($('.account-activation').textContent, /needs attention/);
    const button = $('[data-action="account-retry-approval"]');
    assert.ok(button);
    button.focus();
    activationStatus = 'approved';
    button.click();
    await next();
    assert.match($('.account-activation').textContent, /Account approved/);
    assert.equal($('[data-action="account-retry-approval"]'), null);
    assert.ok($('#settings-account').contains(browser.document.activeElement));
    click('[data-action="close-settings"]');
  });

  await t.test('$5/$50 prediction controls preserve inputs while account data refreshes and cannot buy', async () => {
    navigate('#support?song=animals&horizon=24h');
    await next();
    assert.deepEqual([...browser.document.querySelectorAll('.amount-top')].map(node => node.textContent), ['$5', '$20', '$50']);
    const input = $('#prediction-guess');
    input.value = '12345';
    input.dispatchEvent(new browser.Event('input', { bubbles: true }));
    const before = browser.localStorage.getItem('music-prediction-demo-v1');
    await account.refreshBalance();
    assert.equal($('#prediction-guess').value, '12345');
    assert.equal($('#prediction-form button[type="submit"]').disabled, true);
    $('#prediction-form').dispatchEvent(new browser.Event('submit', { bubbles: true, cancelable: true }));
    assert.match($('#form-error').textContent, /Purchases are not available in this preview/);
    assert.equal(browser.localStorage.getItem('music-prediction-demo-v1'), before);
    click('[data-action="rules"]');
    assert.doesNotMatch($('#modal-root').textContent, /wallet|USDC|MetaMask|smart contract/i);
    assert.match($('#modal-root').textContent, /\$2\.50/);
    click('[data-action="close-modal"]');
  });

  await t.test('sample history and financial breakdown remain clearly separate from accounts', async () => {
    navigate('#purchases');
    await next();
    assert.match($('.sample-history-notice').textContent, /not purchases made by your signed-in account/);
    assert.doesNotMatch(browser.document.body.textContent, /wallet|USDC|onchain|smart contract/i);
    click('[data-action="purchase-detail"]');
    assert.match($('#modal-root').textContent, /\$101\.45/);
    assert.match($('#modal-root').textContent, /\$1\.05/);
    click('[data-action="close-modal"]');
  });

  await t.test('backdrop closes Settings and sign-out clears account displays without clearing samples', async () => {
    click('[data-action="settings"]');
    click('[data-action="settings-backdrop"]');
    assert.equal($('#settings-panel'), null);
    const before = browser.localStorage.getItem('music-prediction-demo-v1');
    click('[data-action="settings"]');
    click('[data-action="account-logout"]');
    await next();
    assert.equal(logoutCalls, 1);
    assert.doesNotMatch($('#settings-account').textContent, /fan@example.com|\$20/);
    assert.match($('#header-account').textContent, /Sign up \/ Log in/);
    assert.equal(browser.localStorage.getItem('music-prediction-demo-v1'), before);
  });
});
