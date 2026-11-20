import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { encodeDeployment, verifyArtifact, prepareDeployment, sendDeployment, readDeploymentReceipt } from '../deployment.js';

const ARC = '0x4cef52';
const A = `0x${'1'.repeat(40)}`;
const B = `0x${'2'.repeat(40)}`;
const C = `0x${'3'.repeat(40)}`;
const D = `0x${'4'.repeat(40)}`;
const HASH = `0x${'a'.repeat(64)}`;
const UNIT = 10n ** 18n;
const roles = { owner: A, oracle: B, platform: C };

function fixture() {
  return {
    artifactVersion: 1,
    contractName: 'MusicPredictionContest',
    chainId: ARC,
    compiler: '0.8.28+commit.7893614a',
    bytecode: '0x6000600055',
    deployedBytecode: `0x60${'0'.repeat(64)}00`,
    bytecodeSha256: createHash('sha256').update(Buffer.from('6000600055', 'hex')).digest('hex'),
    immutableReferences: [{ start: 1, length: 32 }],
    immutableArgument: 'appRecipient',
    abi: [{ type: 'constructor', stateMutability: 'nonpayable', inputs: ['initialOwner', 'initialOracle', 'appRecipient'].map(name => ({ name, type: 'address' })) }],
  };
}

class Provider {
  calls = [];
  account = A;
  chain = ARC;
  estimate = '0x65';
  gasPrice = '0x1';
  balance = `0x${(20n * UNIT).toString(16)}`;
  receipt = null;
  transaction = { hash: HASH, from: A, to: null, value: '0x0', input: encodeDeployment(fixture().bytecode, roles), chainId: ARC };
  code = `0x60${C.slice(2).padStart(64, '0')}00`;
  overrides = {};
  async request(request) {
    this.calls.push(request);
    const { method, params } = request;
    if (this.overrides[method]) return this.overrides[method](params);
    switch (method) {
      case 'eth_accounts': return [this.account];
      case 'eth_chainId': return this.chain;
      case 'eth_estimateGas': return this.estimate;
      case 'eth_gasPrice': return this.gasPrice;
      case 'eth_getBalance': return this.balance;
      case 'eth_sendTransaction': return HASH;
      case 'eth_getTransactionReceipt': return this.receipt;
      case 'eth_getTransactionByHash': return this.transaction;
      case 'eth_getCode': return this.code;
      default: throw Error(`Unexpected wallet method ${method}`);
    }
  }
}

function successReceipt() {
  return { transactionHash: HASH, from: A, to: null, status: '0x1', contractAddress: D };
}

test('constructor encoding appends exactly three padded address arguments', () => {
  const bytecode = '0x6000';
  const encoded = encodeDeployment(bytecode, roles);
  assert.equal(encoded, bytecode + [A, B, C].map(item => item.slice(2).padStart(64, '0')).join(''));
  assert.equal(encoded.length, bytecode.length + 3 * 64);
});

test('constructor rejects zero/malformed addresses and unresolved or uneven bytecode', () => {
  for (const owner of ['', '0x1234', `0x${'0'.repeat(40)}`]) assert.throws(() => encodeDeployment('0x6000', { ...roles, owner }));
  for (const bytecode of ['0x', '0x0', '6000', '0x__$library$__']) assert.throws(() => encodeDeployment(bytecode, roles));
});

test('artifact integrity validates compiler, chain, constructor, and bytecode hash', async () => {
  assert.equal(await verifyArtifact(fixture()), true);
  for (const patch of [{ chainId: '0x1' }, { compiler: '0.8.27' }, { bytecode: '0x6001' }, { artifactVersion: 0 }, { abi: [] }]) {
    await assert.rejects(verifyArtifact({ ...fixture(), ...patch }));
  }
  const artifact = fixture(); artifact.abi[0].stateMutability = 'payable';
  await assert.rejects(verifyArtifact(artifact), /constructor/);
});

test('artifact rejects overlapping or out-of-bounds immutable references', async () => {
  for (const immutableReferences of [[{ start: 3, length: 32 }], [{ start: 1, length: 20 }], [{ start: 1, length: 32 }, { start: 1, length: 32 }]]) {
    await assert.rejects(verifyArtifact({ ...fixture(), immutableReferences }), /reference list/);
  }
});

test('preparation is read-only, uses native zero value, and rounds gas up with Arc price floor', async () => {
  const provider = new Provider();
  const quote = await prepareDeployment(provider, fixture(), roles);
  assert.equal(quote.from, A);
  assert.equal(quote.gas, '0x7a'); // ceil(101 * 1.20) = 122.
  assert.equal(BigInt(quote.gasPrice), 20_000_000_000n);
  assert.equal(quote.maxFee, 122n * 20_000_000_000n);
  assert.equal(quote.balance, 20n * UNIT);
  assert.deepEqual(quote.roles, roles);
  const estimated = provider.calls.find(item => item.method === 'eth_estimateGas').params[0];
  assert.equal(estimated.value, '0x0');
  assert.equal(estimated.from, A);
  assert.equal('to' in estimated, false);
  assert.equal(provider.calls.some(item => /send|sign|requestAccounts/i.test(item.method)), false);
  assert.equal(Object.isFrozen(quote), true);
  assert.equal(Object.isFrozen(quote.roles), true);
});

test('preparation preserves a higher suggested gas price and allows an independent owner', async () => {
  const provider = new Provider(); provider.gasPrice = '0x6fc23ac00';
  const quote = await prepareDeployment(provider, fixture(), { ...roles, owner: B });
  assert.equal(quote.gasPrice, provider.gasPrice);
  assert.equal(quote.roles.owner, B);
  assert.equal(quote.from, A);
});

test('preparation rejects wrong networks, missing accounts, low balance, and malformed gas reads', async () => {
  const wrong = new Provider(); wrong.chain = '0x1';
  await assert.rejects(prepareDeployment(wrong, fixture(), roles), /Arc Testnet/);
  assert.equal(wrong.calls.some(item => item.method === 'eth_estimateGas'), false);
  const locked = new Provider(); locked.overrides.eth_accounts = () => [];
  await assert.rejects(prepareDeployment(locked, fixture(), roles), /unlock MetaMask/);
  const poor = new Provider(); poor.balance = '0x0';
  await assert.rejects(prepareDeployment(poor, fixture(), roles), /too low/);
  const malformed = new Provider(); malformed.estimate = '20000';
  await assert.rejects(prepareDeployment(malformed, fixture(), roles), /Invalid gas estimate/);
});

test('preparation detects an account or network change while estimating', async () => {
  const changed = new Provider();
  changed.overrides.eth_estimateGas = () => { changed.account = B; return '0x100'; };
  await assert.rejects(prepareDeployment(changed, fixture(), roles), /account changed/);
  const switched = new Provider();
  switched.overrides.eth_getBalance = () => { switched.chain = '0x1'; return switched.balance; };
  await assert.rejects(prepareDeployment(switched, fixture(), roles), /Arc Testnet/);
});

test('send uses exactly one reviewed contract-creation transaction', async () => {
  const provider = new Provider();
  const quote = await prepareDeployment(provider, fixture(), roles);
  assert.equal(await sendDeployment(provider, quote), HASH);
  const sent = provider.calls.filter(item => item.method === 'eth_sendTransaction');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].params[0], { from: A, chainId: ARC, value: '0x0', data: quote.data, gas: quote.gas, gasPrice: quote.gasPrice });
  assert.equal('to' in sent[0].params[0], false);
});

test('send rechecks account/network and never retries a cancelled or ambiguous wallet request', async () => {
  const provider = new Provider();
  const quote = await prepareDeployment(provider, fixture(), roles);
  provider.account = B;
  await assert.rejects(sendDeployment(provider, quote), /account changed/);
  assert.equal(provider.calls.filter(item => item.method === 'eth_sendTransaction').length, 0);
  provider.account = A; provider.chain = '0x1';
  await assert.rejects(sendDeployment(provider, quote), /Arc Testnet/);
  provider.chain = ARC;
  provider.overrides.eth_sendTransaction = () => { throw Object.assign(Error('User rejected'), { code: 4001 }); };
  await assert.rejects(sendDeployment(provider, quote), { code: 4001 });
  assert.equal(provider.calls.filter(item => item.method === 'eth_sendTransaction').length, 1);
  provider.overrides.eth_sendTransaction = () => null;
  await assert.rejects(sendDeployment(provider, quote), /Activity before trying/);
  assert.equal(provider.calls.filter(item => item.method === 'eth_sendTransaction').length, 2);
});

test('pending and failed receipts remain distinct and do not read or claim deployed code', async () => {
  const provider = new Provider();
  assert.deepEqual(await readDeploymentReceipt(provider, HASH, fixture()), { status: 'pending', transactionHash: HASH });
  provider.receipt = { ...successReceipt(), status: '0x0', contractAddress: null };
  assert.deepEqual(await readDeploymentReceipt(provider, HASH, fixture(), { from: A }), { status: 'failed', transactionHash: HASH });
  assert.equal(provider.calls.some(item => item.method === 'eth_getCode'), false);
});

test('confirmed receipt verifies all constructor roles and immutable-patched runtime exactly', async () => {
  const provider = new Provider(); provider.receipt = successReceipt();
  assert.deepEqual(await readDeploymentReceipt(provider, HASH, fixture(), { from: A, platform: C, roles }), { status: 'confirmed', address: D, transactionHash: HASH });
  assert.equal(provider.calls.some(item => /send|sign/i.test(item.method)), false);
});

test('receipt rejects wrong hash, sender, deployment address, destination, and runtime', async () => {
  for (const patch of [{ transactionHash: `0x${'b'.repeat(64)}` }, { from: B }, { contractAddress: `0x${'0'.repeat(40)}` }, { to: B }]) {
    const provider = new Provider(); provider.receipt = { ...successReceipt(), ...patch };
    await assert.rejects(readDeploymentReceipt(provider, HASH, fixture(), { from: A, platform: C, roles }));
  }
  const wrongCode = new Provider(); wrongCode.receipt = successReceipt(); wrongCode.code = '0x6001';
  await assert.rejects(readDeploymentReceipt(wrongCode, HASH, fixture(), { from: A, platform: C, roles }), /does not match/);
  const wrongImmutable = new Provider(); wrongImmutable.receipt = successReceipt();
  await assert.rejects(readDeploymentReceipt(wrongImmutable, HASH, fixture(), { from: A, platform: B, roles }), /conflicts/);
});

test('confirmed receipts require saved constructor roles and reject changed owner or oracle', async () => {
  const missingRoles = new Provider(); missingRoles.receipt = successReceipt();
  await assert.rejects(readDeploymentReceipt(missingRoles, HASH, fixture(), { from: A, platform: C }), /three deployment wallet addresses/);
  for (const changedRoles of [{ ...roles, owner: D }, { ...roles, oracle: D }, { ...roles, platform: D }]) {
    const provider = new Provider(); provider.receipt = successReceipt();
    provider.transaction.input = encodeDeployment(fixture().bytecode, changedRoles);
    await assert.rejects(readDeploymentReceipt(provider, HASH, fixture(), { from: A, roles }), /does not match/);
  }
});

test('original transaction must be creation with zero value, exact input, sender, hash, and Arc chain', async () => {
  for (const patch of [{ hash: `0x${'b'.repeat(64)}` }, { from: B }, { to: B }, { value: '0x1' }, { input: '0x6001' }, { chainId: '0x1' }]) {
    const provider = new Provider(); provider.receipt = successReceipt();
    provider.transaction = { ...provider.transaction, ...patch };
    await assert.rejects(readDeploymentReceipt(provider, HASH, fixture(), { from: A, roles }));
  }
  const unavailable = new Provider(); unavailable.receipt = successReceipt(); unavailable.transaction = null;
  await assert.rejects(readDeploymentReceipt(unavailable, HASH, fixture(), { from: A, roles }), /does not match/);
});

test('receipt reads require Arc Testnet and a valid known transaction hash', async () => {
  const provider = new Provider(); provider.chain = '0x1';
  await assert.rejects(readDeploymentReceipt(provider, HASH, fixture()), /Arc Testnet/);
  assert.equal(provider.calls.some(item => item.method === 'eth_getTransactionReceipt'), false);
  await assert.rejects(readDeploymentReceipt(provider, '0x123', fixture()), /hash is invalid/);
});


test('the exported real contract artifact passes the deployment integrity check', async () => {
  const artifact = JSON.parse(await readFile(new URL('../deploy-contract.json', import.meta.url), 'utf8'));
  assert.equal(await verifyArtifact(artifact), true);
  assert.equal(artifact.immutableReferences.length, 2);
});
