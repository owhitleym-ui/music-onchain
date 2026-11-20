import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccessToken } from '@privy-io/node';
import { createAuthenticator,identityFromUser } from '../src/auth.js';
import { APP_ID } from '../src/config.js';
import { A,B } from './fixtures.mjs';

const USER='did:privy:fan-a';
const profile=(extra={})=>({id:USER,is_guest:false,linked_accounts:[
  {type:'email',address:'fan@example.com',verified_at:1700000000},
  {type:'wallet',address:A,chain_type:'ethereum',wallet_client_type:'privy',wallet_index:0},
],...extra});
const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
async function jwt(extra={},key=keys.privateKey) {
  const seconds=Math.floor(Date.now()/1000);
  const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const input=encode({alg:'ES256',typ:'JWT'})+'.'+encode({iss:'privy.io',aud:APP_ID,iat:seconds,exp:seconds+3600,sid:'session-a',sub:USER,...extra});
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(input));
  return input+'.'+Buffer.from(signature).toString('base64url');
}
const authenticator=(getUser=async()=>profile())=>createAuthenticator({
  verifyToken:access_token=>verifyAccessToken({access_token,app_id:APP_ID,verification_key:keys.publicKey}),getUser,
});

test('valid signed Privy token derives the embedded wallet from server-side user data',async()=>{
  assert.deepEqual(await authenticator()('Bearer '+await jwt()),{appId:APP_ID,userId:USER,wallet:A});
});
test('expired, wrong-app, wrong-issuer, forged and malformed tokens cannot reach profile lookup',async()=>{
  let lookups=0;const auth=authenticator(async()=>{lookups++;return profile();});
  const other=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  for(const token of [await jwt({exp:1}),await jwt({aud:'another-app'}),await jwt({iss:'other'}),await jwt({},other.privateKey),'fake-token']) {
    await assert.rejects(auth('Bearer '+token),{code:'AUTH_REQUIRED',status:401});
  }
  await assert.rejects(auth(undefined),{code:'AUTH_REQUIRED'});assert.equal(lookups,0);
});
test('unverified emails, guest users, frozen profiles and mismatched users are rejected',()=>{
  for(const p of [profile({is_guest:true}),profile({frozen_at:1}),profile({id:'did:privy:other'})])assert.throws(()=>identityFromUser(p,USER),{code:'ACCOUNT_UNAVAILABLE'});
  assert.throws(()=>identityFromUser(profile({linked_accounts:[{type:'email',address:'fan@example.com'}]}),USER),{code:'EMAIL_REQUIRED'});
});
test('missing embedded wallets remain pending; external and Solana wallets cannot be approved',()=>{
  const email={type:'email',address:'fan@example.com',verified_at:1};
  for(const wallet of [null,{type:'wallet',address:A,chain_type:'ethereum',wallet_client_type:'metamask'},
    {type:'wallet',address:A,chain_type:'solana',wallet_client_type:'privy'}]) {
    assert.throws(()=>identityFromUser(profile({linked_accounts:[email,...(wallet?[wallet]:[])]}),USER),{code:'WALLET_PENDING'});
  }
});
test('server and frontend share the first embedded HD-wallet selection rule',()=>{
  const p=profile();p.linked_accounts.push({type:'wallet',address:B,chain_type:'ethereum',wallet_client_type:'privy-v2',wallet_index:1});
  p.linked_accounts.reverse();assert.equal(identityFromUser(p,USER).wallet,A);
});
test('profile lookup failures are sanitized and no account fields are accepted from the client',async()=>{
  const auth=authenticator(async()=>{throw Error('private server settings');});
  await assert.rejects(auth('Bearer '+await jwt()),{code:'CONFIG_REQUIRED'});
});
