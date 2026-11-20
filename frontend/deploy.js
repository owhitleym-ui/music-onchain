import { wallet, ARC_TESTNET, formatUSDC } from './wallet.js';
import { verifyArtifact, prepareDeployment, sendDeployment, readDeploymentReceipt } from './deployment.js';

const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RECORD_KEY = 'music-prediction-deployment-v1';
let artifact = null;
let quote = null;
let busy = false;
let checking = false;
let generation = 0;
let previousAccount = null;
let previousChain = null;
let verifiedThisSession = false;
let record = null;
const addressPattern = /^0x[0-9a-f]{40}$/i;
const hashPattern = /^0x[0-9a-f]{64}$/i;

try {
  const saved = JSON.parse(localStorage.getItem(RECORD_KEY));
  if (saved?.chainId === ARC_TESTNET.chainId && (hashPattern.test(saved.transactionHash) || (saved.transactionHash === null && ['awaiting', 'unknown'].includes(saved.status)))
    && addressPattern.test(saved.from) && ['awaiting', 'unknown', 'pending', 'confirmed', 'failed'].includes(saved.status)
    && ['owner', 'oracle', 'platform'].every(role => addressPattern.test(saved.roles?.[role]))) record = saved;
} catch { /* Wallet/chain confirmation remains authoritative. */ }

function rememberRecord() {
  try { localStorage.setItem(RECORD_KEY, JSON.stringify(record)); return true; }
  catch { $('deployment-error').textContent = 'Your browser could not save the transaction. Keep this tab open and copy the transaction hash below.'; return false; }
}

function tracked() { return record && record.status !== 'failed'; }
function onArc(current = wallet.getState()) { return current.status === 'connected' && current.chainId?.toLowerCase() === ARC_TESTNET.chainId; }
function roles() { return Object.fromEntries(['owner', 'oracle', 'platform'].map(role => [role, $(role).value.trim()])); }
function invalidateQuote() {
  generation++;
  quote = null;
  $('review-panel').hidden = true;
  $('deploy').disabled = true;
}

function renderControls() {
  const current = wallet.getState();
  $('connect').disabled = Boolean(current.busy) || current.status === 'connected';
  $('connect').textContent = current.status === 'connecting' ? 'Waiting for MetaMask…' : current.status === 'connected' ? 'MetaMask connected' : 'Connect MetaMask';
  $('switch').hidden = current.status !== 'connected' || onArc(current);
  $('switch').disabled = Boolean(current.busy) || busy;
  $('use-wallet').disabled = !current.address || busy || Boolean(tracked());
  $('review').disabled = !artifact || !onArc(current) || busy || Boolean(tracked());
  $('review').textContent = busy && !record ? 'Preparing…' : 'Review deployment';
  for (const role of ['owner', 'oracle', 'platform']) $(role).disabled = busy || Boolean(tracked());
  $('deploy').disabled = !quote || busy || !onArc(current) || Boolean(tracked());
  $('check-status').disabled = checking || !onArc(current) || !record?.transactionHash;
}

function setConnectedRoles(address) {
  if (!address) return;
  for (const role of ['owner', 'oracle', 'platform']) $(role).value = address;
}

function renderWallet(current) {
  const changed = current.address !== previousAccount || current.chainId !== previousChain;
  if (changed) {
    invalidateQuote();
    if (!record && current.address && current.address !== previousAccount) setConnectedRoles(current.address);
    previousAccount = current.address;
    previousChain = current.chainId;
  }
  const address = current.address ? `<span class="deployment-address">${escape(current.address)}</span>` : '';
  const amount = current.balanceStatus === 'ready' && current.balance !== null ? formatUSDC(current.balance) : current.balanceStatus === 'loading' ? 'Loading balance…' : 'Balance unavailable';
  $('wallet-summary').innerHTML = current.status === 'connected'
    ? `${address}<span>${onArc(current) ? `Arc Testnet · ${escape(amount)}` : 'Select Arc Testnet to continue.'}</span>`
    : 'Connect MetaMask to choose the wallet that will pay the deployment fee.';
  $('wallet-error').textContent = current.error;
  renderControls();
}

function renderRecord() {
  if (!record) return;
  $('result-panel').hidden = false;
  if (!record.transactionHash) {
    $('deployment-result').innerHTML = '<p>An attempt is waiting for a MetaMask response, or the response was interrupted. Check MetaMask Activity before trying another deployment.</p><label for="recovery-hash">Deployment transaction hash<input id="recovery-hash" placeholder="0x…" autocomplete="off" spellcheck="false" /></label><div class="deployment-actions"><button class="button secondary" id="recover-transaction">Check this transaction</button><button class="text-button" id="clear-interrupted">I checked MetaMask: no transaction was sent</button></div>';
    $('recover-transaction').addEventListener('click', () => {
      const hash = $('recovery-hash').value.trim();
      if (!hashPattern.test(hash)) { $('deployment-error').textContent = 'Paste the full transaction hash from MetaMask Activity.'; return; }
      record.transactionHash = hash; record.status = 'pending'; rememberRecord(); renderRecord(); void checkReceipt();
    });
    $('clear-interrupted').addEventListener('click', () => {
      if (busy) return;
      record = null;
      try { localStorage.removeItem(RECORD_KEY); } catch { /* The page still requires another explicit review and wallet approval. */ }
      $('result-panel').hidden = true; $('deployment-error').textContent = ''; invalidateQuote(); renderControls();
    });
    renderControls();
    return;
  }
  const txLink = `${ARC_TESTNET.blockExplorerUrls[0]}/tx/${record.transactionHash}`;
  let message = 'Transaction submitted. Checking its status does not send it again.';
  if (record.status === 'confirmed' && verifiedThisSession) message = 'Deployment complete. The installed code matches the tested contract.';
  else if (record.status === 'confirmed') message = 'A deployment was saved previously. Connect MetaMask on Arc Testnet to verify it again.';
  else if (record.status === 'failed') message = 'This deployment transaction failed. No contract was created. You can review a new attempt; the failed transaction may have used gas.';
  const address = record.status === 'confirmed' && verifiedThisSession && record.contractAddress
    ? `<p class="deployment-success">Your contract address</p><code class="deployment-address">${escape(record.contractAddress)}</code><a href="${ARC_TESTNET.blockExplorerUrls[0]}/address/${encodeURIComponent(record.contractAddress)}" target="_blank" rel="noopener noreferrer">View contract in explorer</a>` : '';
  $('deployment-result').innerHTML = `<p>${message}</p>${address}<p>Transaction hash</p><code class="deployment-address">${escape(record.transactionHash)}</code><a href="${txLink}" target="_blank" rel="noopener noreferrer">View transaction in explorer</a>`;
  renderControls();
}

async function checkReceipt() {
  if (!record?.transactionHash || !artifact || checking || !onArc()) return;
  const provider = wallet.getProvider();
  if (!provider) return;
  checking = true;
  renderControls();
  try {
    if (record.bytecodeSha256 !== artifact.bytecodeSha256) throw new Error('The saved transaction belongs to a different contract build. Keep its hash and check the original build before continuing.');
    const result = await readDeploymentReceipt(provider, record.transactionHash, artifact, { from: record.from, platform: record.roles.platform, roles: record.roles });
    if (result.status === 'confirmed') {
      record.status = 'confirmed';
      record.contractAddress = result.address;
      verifiedThisSession = true;
      rememberRecord();
      $('deployment-error').textContent = '';
      void wallet.refresh();
    } else if (result.status === 'failed') {
      record.status = 'failed';
      rememberRecord();
    }
    renderRecord();
  } catch (error) {
    $('deployment-error').textContent = `${error.message} Your transaction has not been resent.`;
  } finally { checking = false; renderControls(); }
}

$('connect').addEventListener('click', () => { void wallet.connect().then(checkReceipt); });
$('switch').addEventListener('click', () => { void wallet.switchToArc().then(checkReceipt); });
$('use-wallet').addEventListener('click', () => { setConnectedRoles(wallet.getState().address); invalidateQuote(); renderControls(); });
for (const role of ['owner', 'oracle', 'platform']) $(role).addEventListener('input', () => { invalidateQuote(); $('deployment-error').textContent = ''; renderControls(); });

$('deployment-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || tracked() || !artifact || !onArc()) return;
  const provider = wallet.getProvider();
  if (!provider) return;
  invalidateQuote();
  const token = generation;
  busy = true;
  $('deployment-error').textContent = '';
  renderControls();
  try {
    const prepared = await prepareDeployment(provider, artifact, roles());
    if (token !== generation || !onArc() || wallet.getState().address?.toLowerCase() !== prepared.from.toLowerCase()) return;
    quote = prepared;
    const items = [['Network', 'Arc Testnet'], ['Deployment wallet', quote.from], ['Administrator', quote.roles.owner], ['Results sender', quote.roles.oracle], ['App fee recipient · fixed', quote.roles.platform], ['Amount sent to the contract', '0 USDC'], ['Estimated maximum network fee', formatUSDC(((quote.maxFee + 10n ** 12n - 1n) / 10n ** 12n) * 10n ** 12n)]];
    $('review-summary').innerHTML = `<dl class="deployment-details">${items.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
    $('review-panel').hidden = false;
  } catch (error) { $('deployment-error').textContent = error.message; }
  finally { busy = false; renderControls(); }
});

$('deploy').addEventListener('click', async () => {
  if (!quote || busy || tracked() || !onArc()) return;
  const provider = wallet.getProvider();
  if (!provider) return;
  const chosen = quote;
  busy = true;
  $('deploy').textContent = 'Review the request in MetaMask…';
  $('deployment-error').textContent = '';
  renderControls();
  try {
    record = { chainId: ARC_TESTNET.chainId, transactionHash: null, from: chosen.from, roles: { ...chosen.roles }, bytecodeSha256: artifact.bytecodeSha256, status: 'awaiting' };
    if (!rememberRecord()) {
      record = null;
      throw new Error('Enable browser storage before deploying so an interrupted request can be recovered safely.');
    }
    renderRecord();
    const transactionHash = await sendDeployment(provider, chosen);
    record.transactionHash = transactionHash;
    record.status = 'pending';
    rememberRecord();
    invalidateQuote();
    renderRecord();
    await checkReceipt();
  } catch (error) {
    // A rejected request is definitive. Other send errors can be ambiguous.
    if (Number(error.code) === 4001) {
      record = null;
      try { localStorage.removeItem(RECORD_KEY); } catch { /* No transaction was approved. */ }
      $('result-panel').hidden = true;
      $('deployment-error').textContent = 'Deployment cancelled in MetaMask. You can review it again when ready.';
    } else {
      if (record && !record.transactionHash) { record.status = 'unknown'; rememberRecord(); renderRecord(); }
      $('deployment-error').textContent = `${error.message} Check MetaMask Activity before making another attempt.`;
    }
    invalidateQuote();
  } finally {
    busy = false;
    $('deploy').textContent = 'Deploy with MetaMask';
    renderControls();
  }
});

$('check-status').addEventListener('click', checkReceipt);
setInterval(() => { if (!document.hidden && record?.status === 'pending') void checkReceipt(); }, 3000);
window.addEventListener('focus', () => { if (record) void checkReceipt(); });
wallet.subscribe(renderWallet);
wallet.init();
if (record) {
  for (const role of ['owner', 'oracle', 'platform']) $(role).value = record.roles[role];
  renderRecord();
}

try {
  const response = await fetch('./deploy-contract.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('The compiled contract file could not be loaded.');
  const loaded = await response.json();
  await verifyArtifact(loaded);
  artifact = loaded;
  $('build-info').textContent = `Tested build: MusicPredictionContest · Solidity ${artifact.compiler} · 5/50 USDC entries · No live TikTok feed connected.`;
  renderControls();
  await checkReceipt();
} catch (error) {
  $('build-info').textContent = 'Deployment is unavailable until the tested contract build can be loaded.';
  $('deployment-error').textContent = error.message;
}
