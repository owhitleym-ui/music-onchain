// This module prepares a contract-creation transaction. Only sendDeployment asks
// MetaMask to send it, and callers must invoke that action after user review.
const CHAIN_ID = '0x4cef52';
const MIN_GAS_PRICE = 20_000_000_000n;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const HEX_DATA = /^0x(?:[0-9a-f]{2})+$/i;
const HEX_QUANTITY = /^0x[0-9a-f]+$/i;

function address(value, label) {
  if (typeof value !== 'string' || !ADDRESS.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${label} must be a nonzero wallet address beginning with 0x.`);
  }
  return value;
}

function quantity(value, label) {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value)) throw new Error(`Invalid ${label} from MetaMask.`);
  return BigInt(value);
}

function hex(value) { return `0x${value.toString(16)}`; }

function rolesFor(roles) {
  if (!roles || typeof roles !== 'object') throw new Error('Choose the three deployment wallet addresses.');
  return {
    owner: address(roles.owner, 'Administrator'),
    oracle: address(roles.oracle, 'Result operator'),
    platform: address(roles.platform, 'App fee recipient'),
  };
}

function checkProvider(provider) {
  if (!provider || typeof provider.request !== 'function') throw new Error('Connect MetaMask first.');
}

function rpc(provider, method, params = []) {
  checkProvider(provider);
  let timeout;
  return Promise.race([
    Promise.resolve().then(() => provider.request({ method, params })),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('MetaMask read timed out. Check your connection and try again.')), 15000);
      timeout?.unref?.();
    }),
  ]).finally(() => clearTimeout(timeout));
}

async function network(provider) {
  const chain = await rpc(provider, 'eth_chainId');
  if (quantity(chain, 'network') !== BigInt(CHAIN_ID)) throw new Error('Switch MetaMask to Arc Testnet before deploying.');
  return CHAIN_ID;
}

async function account(provider) {
  const accounts = await rpc(provider, 'eth_accounts');
  if (!Array.isArray(accounts) || !accounts.length) throw new Error('Connect and unlock MetaMask first.');
  return address(accounts[0], 'Connected account');
}

async function requireSession(provider, from) {
  const current = await account(provider);
  await network(provider);
  if (current.toLowerCase() !== from.toLowerCase()) throw new Error('Your MetaMask account changed. Review deployment again.');
}

export function encodeDeployment(bytecode, roles) {
  if (typeof bytecode !== 'string' || !HEX_DATA.test(bytecode)) throw new Error('The compiled contract bytecode is invalid.');
  const checked = rolesFor(roles);
  return bytecode + [checked.owner, checked.oracle, checked.platform]
    .map(value => value.slice(2).toLowerCase().padStart(64, '0')).join('');
}

function validateArtifact(artifact) {
  if (!artifact || artifact.artifactVersion !== 1 || artifact.contractName !== 'MusicPredictionContest'
    || artifact.chainId !== CHAIN_ID || artifact.compiler !== '0.8.28+commit.7893614a') {
    throw new Error('The deployment artifact does not match this Arc Testnet contract.');
  }
  if (!HEX_DATA.test(artifact.bytecode ?? '') || !HEX_DATA.test(artifact.deployedBytecode ?? '')
    || !/^[0-9a-f]{64}$/i.test(artifact.bytecodeSha256 ?? '')) {
    throw new Error('The compiled deployment artifact is invalid.');
  }
  const constructors = Array.isArray(artifact.abi) ? artifact.abi.filter(item => item.type === 'constructor') : [];
  if (constructors.length !== 1 || constructors[0].stateMutability !== 'nonpayable'
    || constructors[0].inputs?.length !== 3 || constructors[0].inputs.some(input => input.type !== 'address')) {
    throw new Error('The contract constructor must accept three wallet addresses and no payment.');
  }
  if (!Array.isArray(artifact.immutableReferences)) throw new Error('The compiled runtime reference list is missing.');
  const ranges = [...artifact.immutableReferences].sort((a, b) => a.start - b.start);
  let previousEnd = 0;
  for (const reference of ranges) {
    if (!Number.isSafeInteger(reference.start) || reference.start < previousEnd || reference.length !== 32
      || (reference.start + reference.length) * 2 > artifact.deployedBytecode.length - 2) {
      throw new Error('The compiled runtime reference list is invalid.');
    }
    previousEnd = reference.start + reference.length;
  }
  if (ranges.length && artifact.immutableArgument !== 'appRecipient') throw new Error('Unexpected runtime constructor reference.');
}

export async function verifyArtifact(artifact) {
  validateArtifact(artifact);
  if (!globalThis.crypto?.subtle) throw new Error('Open this page over localhost or HTTPS to check the compiled contract.');
  const bytes = Uint8Array.from(artifact.bytecode.slice(2).match(/../g), pair => Number.parseInt(pair, 16));
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const digest = Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== artifact.bytecodeSha256.toLowerCase()) throw new Error('The compiled contract failed its integrity check. Reload the prepared artifact.');
  return true;
}

export async function prepareDeployment(provider, artifact, roles) {
  await verifyArtifact(artifact);
  const checkedRoles = rolesFor(roles);
  const from = await account(provider);
  await network(provider);
  const data = encodeDeployment(artifact.bytecode, checkedRoles);
  const transaction = { from, value: '0x0', data };
  const estimate = quantity(await rpc(provider, 'eth_estimateGas', [transaction]), 'gas estimate');
  if (estimate === 0n) throw new Error('MetaMask returned an empty gas estimate.');
  const suggestedPrice = quantity(await rpc(provider, 'eth_gasPrice'), 'gas price');
  const gasPrice = suggestedPrice < MIN_GAS_PRICE ? MIN_GAS_PRICE : suggestedPrice;
  const gas = (estimate * 120n + 99n) / 100n;
  const balance = quantity(await rpc(provider, 'eth_getBalance', [from, 'latest']), 'USDC balance');
  const maxFee = gas * gasPrice;
  await requireSession(provider, from);
  if (balance < maxFee) throw new Error('Your test USDC balance is too low for the estimated deployment fee.');
  return Object.freeze({ from, chainId: CHAIN_ID, data, gas: hex(gas), gasPrice: hex(gasPrice), maxFee, balance, roles: Object.freeze(checkedRoles) });
}

export async function sendDeployment(provider, quote) {
  checkProvider(provider);
  if (!quote || quote.chainId !== CHAIN_ID || !HEX_DATA.test(quote.data ?? '')) throw new Error('Review deployment before sending it.');
  const from = address(quote.from, 'Connected account');
  const gas = quantity(quote.gas, 'reviewed gas limit');
  const gasPrice = quantity(quote.gasPrice, 'reviewed gas price');
  if (gas === 0n || gasPrice < MIN_GAS_PRICE) throw new Error('The reviewed deployment fee is invalid. Review it again.');
  await requireSession(provider, from);
  // No timeout or retry here: a wallet approval can remain open, and resending
  // after an ambiguous response could create a second deployment.
  const hash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from, chainId: CHAIN_ID, value: '0x0', data: quote.data, gas: quote.gas, gasPrice: quote.gasPrice }],
  });
  if (typeof hash !== 'string' || !HASH.test(hash)) throw new Error('MetaMask returned no valid transaction hash. Check its Activity before trying another deployment.');
  return hash;
}

function expectedRuntime(artifact, platform) {
  let code = artifact.deployedBytecode.slice(2).toLowerCase();
  if (artifact.immutableReferences.length) {
    const replacement = address(platform, 'App fee recipient').slice(2).toLowerCase().padStart(64, '0');
    for (const reference of artifact.immutableReferences) {
      const start = reference.start * 2;
      code = code.slice(0, start) + replacement + code.slice(start + reference.length * 2);
    }
  }
  return `0x${code}`;
}

export async function readDeploymentReceipt(provider, txHash, artifact, expected = {}) {
  if (typeof txHash !== 'string' || !HASH.test(txHash)) throw new Error('The deployment transaction hash is invalid.');
  await verifyArtifact(artifact);
  await network(provider);
  const receipt = await rpc(provider, 'eth_getTransactionReceipt', [txHash]);
  if (receipt === null) return { status: 'pending', transactionHash: txHash };
  if (!receipt || typeof receipt.transactionHash !== 'string' || receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) {
    throw new Error('MetaMask returned a receipt for another transaction.');
  }
  if (expected.from && (typeof receipt.from !== 'string' || receipt.from.toLowerCase() !== address(expected.from, 'Deployer').toLowerCase())) {
    throw new Error('The deployment receipt belongs to another wallet.');
  }
  const status = quantity(receipt.status, 'transaction status');
  if (status === 0n) return { status: 'failed', transactionHash: txHash };
  if (status !== 1n || receipt.to != null) throw new Error('The receipt does not describe a successful contract deployment.');
  const reviewedRoles = rolesFor(expected.roles);
  const reviewedSender = address(expected.from, 'Reviewed deployer');
  if (expected.platform && address(expected.platform, 'App fee recipient').toLowerCase() !== reviewedRoles.platform.toLowerCase()) {
    throw new Error('The saved app fee recipient conflicts with the reviewed constructor settings.');
  }
  const transaction = await rpc(provider, 'eth_getTransactionByHash', [txHash]);
  if (!transaction || typeof transaction.hash !== 'string' || transaction.hash.toLowerCase() !== txHash.toLowerCase()
    || typeof transaction.from !== 'string' || transaction.from.toLowerCase() !== reviewedSender.toLowerCase()
    || typeof receipt.from !== 'string' || transaction.from.toLowerCase() !== receipt.from.toLowerCase()
    || transaction.to !== null || quantity(transaction.value, 'deployment payment') !== 0n
    || typeof transaction.input !== 'string'
    || transaction.input.toLowerCase() !== encodeDeployment(artifact.bytecode, reviewedRoles).toLowerCase()) {
    throw new Error('The deployment transaction does not match the reviewed contract and constructor addresses.');
  }
  if (transaction.chainId != null && quantity(transaction.chainId, 'deployment network') !== BigInt(CHAIN_ID)) {
    throw new Error('The deployment transaction belongs to another network.');
  }
  const contractAddress = address(receipt.contractAddress, 'Deployed contract');
  const code = await rpc(provider, 'eth_getCode', [contractAddress, 'latest']);
  if (typeof code !== 'string' || code.toLowerCase() !== expectedRuntime(artifact, reviewedRoles.platform)) {
    throw new Error('The deployed code does not match the reviewed contract. Do not use this address until it has been checked.');
  }
  await network(provider);
  return { status: 'confirmed', address: contractAddress, transactionHash: txHash };
}
