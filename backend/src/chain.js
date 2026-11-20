import { createPublicClient, http, parseAbi, encodeFunctionData, keccak256, parseTransaction, recoverTransactionAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN_ID, CONTRACT, ORIGINAL_OWNER, address, sameAddress, deployment, sha256 } from './config.js';
import { AppError } from './errors.js';
import { createRpcReadGuard } from './rpc-reads.js';

export const ABI = parseAbi([
  'function owner() view returns (address)', 'function pendingOwner() view returns (address)',
  'function walletApproved(address) view returns (bool)',
  'function approveWallet(address wallet, bool approved)', 'function acceptOwnership()',
  'function transferOwnership(address newOwner)', 'function createRound(bytes32 songId,string musicId,address artist,uint64 roundStart) returns(uint256)', 'event RoundCreated(uint256 indexed roundId,bytes32 indexed songId,string musicId,address indexed artist,uint64 start)', 'event WalletApproval(address indexed wallet, bool approved)',
]);
const arc = { id:CHAIN_ID,name:'Arc Testnet',nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18},rpcUrls:{default:{http:['https://rpc.testnet.arc.io']}},testnet:true };
const inactive = error => /TransactionReceiptNotFoundError|TransactionNotFoundError/.test(error?.name ?? '');

export function createArcChain(config, overrides = {}) {
  const account = overrides.account ?? privateKeyToAccount(config.privateKey);
  const client = overrides.client ?? createPublicClient({ chain:arc,transport:http(config.rpc,{ timeout:10000,retryCount:0 }),cacheTime:0 });
  const target = overrides.contract ?? config.contract ?? CONTRACT;
  const expectedHash = overrides.runtimeHash ?? config.deployment?.runtimeSha256 ?? deployment.runtimeSha256;
  const creationBlock = overrides.creationBlock ?? BigInt(config.deployment?.creationBlock ?? 73067622);
  const signer = account.address.toLowerCase();
  const guard = overrides.readGuard ?? createRpcReadGuard();
  const read = (functionName,args=[],blockNumber) => guard.read(() => client.readContract({address:target,abi:ABI,functionName,args,...(blockNumber == null ? {} : {blockNumber})}));
  const history = new Map();
  const inspections = new Map();

  async function verifyDeployment() {
    if (await guard.read(() => client.getChainId()) !== CHAIN_ID) throw new AppError('RPC_UNAVAILABLE');
    const code = await guard.read(() => client.getCode({address:target}));
    if (!code || sha256(Buffer.from(code.slice(2),'hex')) !== expectedHash) throw new AppError('RPC_UNAVAILABLE');
  }

  async function owners() {
    const [owner,pendingOwner] = await Promise.all([read('owner'),read('pendingOwner')]);
    return {owner:owner.toLowerCase(),pendingOwner:pendingOwner.toLowerCase()};
  }

  async function inspectHistory(wallet) {
    await verifyDeployment();
    const block = await guard.read(() => client.getBlockNumber({cacheTime:0}));
    const approved = await read('walletApproved',[wallet],block);
    let revoked = false;
    if (!approved) {
      const previous = history.get(wallet);
      const incremental = previous && previous.block <= block;
      const fromBlock = incremental ? previous.block + 1n : creationBlock;
      revoked = incremental ? previous.revoked : false;
      // Newest-first bounded log windows also find revocations made before this backend existed.
      for (let end=block;end>=fromBlock;) {
        const start=end-4999n>fromBlock ? end-4999n : fromBlock;
        const logs=await guard.logs(() => client.getLogs({address:target,event:ABI.find(item=>item.type==='event'&&item.name==='WalletApproval'),args:{wallet},fromBlock:start,toBlock:end,strict:true}));
        if (logs.length) { revoked=logs.at(-1).args.approved === false;break; }
        if (start===fromBlock) break;
        end=start-1n;
      }
      // Commit only a complete scan. A failed scan never means "no revocation".
      if (history.size >= 200) history.delete(history.keys().next().value);
      history.set(wallet, { block, revoked });
    } else {
      history.set(wallet, { block, revoked: false });
    }
    return {approved,revoked,block:Number(block)};
  }

  function inspect(value) {
    const wallet = address(value);
    if (!wallet) return Promise.reject(new AppError('BAD_REQUEST'));
    const pending = inspections.get(wallet);
    if (pending) return pending;
    const result = inspectHistory(wallet).finally(() => inspections.delete(wallet));
    inspections.set(wallet, result);
    return result;
  }

  function callFor(job) {
    if (job.chain_id!==CHAIN_ID || job.contract_address!==(config.contract??CONTRACT).toLowerCase() || job.signer_address!==signer) throw new AppError('BAD_REQUEST');
    if (job.kind==='approve' || job.kind==='revoke') {
      if (!address(job.wallet_address)) throw new AppError('BAD_REQUEST');
      return {functionName:'approveWallet',args:[job.wallet_address,job.kind==='approve']};
    }
    if(job.kind==='create-round') {
      const p=job.payload;
      if(!config.atomic||p?.songId!==keccak256(new TextEncoder().encode('last-bus-home'))||p.musicId!=='demo:last-bus-home'||!sameAddress(p.artist,ORIGINAL_OWNER)||!Number.isSafeInteger(p.start)||p.start%3600)throw new AppError('BAD_REQUEST');
      return {functionName:'createRound',args:[p.songId,p.musicId,p.artist,BigInt(p.start)]};
    }
    if (job.kind==='accept-owner') return {functionName:'acceptOwnership',args:[]};
    if (job.kind==='return-owner') return {functionName:'transferOwnership',args:[ORIGINAL_OWNER]};
    throw new AppError('BAD_REQUEST');
  }

  async function authority(job) {
    await verifyDeployment();
    callFor(job);
    const current=await owners();
    if (job.kind==='accept-owner' ? !sameAddress(current.pendingOwner,signer) : !sameAddress(current.owner,signer)) throw new AppError('OWNER_NOT_READY');
  }

  async function preflight(job) {
    await authority(job);
    const call=callFor(job);
    await client.simulateContract({address:target,abi:ABI,account:signer,...call});
    const [estimated,suggested,balance]=await Promise.all([
      client.estimateContractGas({address:target,abi:ABI,account:signer,...call}),client.getGasPrice(),client.getBalance({address:signer}),
    ]);
    const gas=estimated*120n/100n+10000n;
    const gasPrice=suggested>20_000_000_000n?suggested:20_000_000_000n;
    if (balance<gas*gasPrice) throw new AppError('NO_GAS');
    return {gas,gasPrice,data:encodeFunctionData({abi:ABI,...call})};
  }

  return {
    signer, verifyDeployment, inspect, owners, authority,
    balance:()=>client.getBalance({address:signer}),
    nonces:async()=>({ latest:await client.getTransactionCount({address:signer,blockTag:'latest'}), pending:await client.getTransactionCount({address:signer,blockTag:'pending'}) }),
    preflight,
    async sign(job,nonce,quote) {
      callFor(job);
      const value=Number(nonce);
      if (!Number.isSafeInteger(value) || value<0) throw new AppError('NONCE_CONFLICT');
      const raw=await account.signTransaction({chainId:CHAIN_ID,to:target,value:0n,nonce:value,gas:quote.gas,gasPrice:quote.gasPrice,data:quote.data,type:'legacy'});
      return {raw,hash:keccak256(raw)};
    },
    async receipt(hash) { try {return await client.getTransactionReceipt({hash});}catch(error){if(inactive(error))return null;throw error;} },
    async validatePrepared(job) {
      const call=callFor(job);
      let tx,sender;
      try {tx=parseTransaction(job.raw_transaction);sender=await recoverTransactionAddress({serializedTransaction:job.raw_transaction});}catch{throw new AppError('BAD_REQUEST');}
      if(tx.chainId!==CHAIN_ID||!sameAddress(tx.to,target)||!sameAddress(sender,signer)||Number(tx.nonce)!==Number(job.nonce)
        ||(tx.value??0n)!==0n||tx.data!==encodeFunctionData({abi:ABI,...call})||keccak256(job.raw_transaction)!==job.transaction_hash)throw new AppError('BAD_REQUEST');
    },
    async known(hash) { try {await client.getTransaction({hash});return true;}catch(error){if(inactive(error))return false;throw error;} },
    async broadcast(raw) { return client.sendRawTransaction({serializedTransaction:raw}); },
    approved:wallet=>read('walletApproved',[wallet]),
  };
}
