import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeploymentRouter} from '../src/deployment-router.js';
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),C='0x'+'c'.repeat(40),identity={userId:'did:privy:one',wallet:A},id='10000000-0000-4000-8000-000000000001';
test('saved actions and colliding entry IDs route by authenticated owner plus pinned deployment',async()=>{
 const called=[],filters=[];
 const service=(name,contract)=>({config:{contract},purchases:{create:async()=>name,get:async()=>name,signed:async()=>name,cancel:async()=>name},claims:{list:async()=>({claims:[{entryId:'1',contract}]}),create:async(_i,body)=>{called.push([name,body]);return {entryId:body.entryId,contract};},get:async()=>name,signed:async()=>name,cancel:async()=>name},live:{entries:async()=>name}});
 const services=new Map([['atomic-v1',service('old',B)],['markets-v2',service('new',C)]]);
 const client={from:()=>({select:()=>{const q={eq:(key,value)=>{filters.push([key,value]);return q;},maybeSingle:async()=>({data:{contract_address:B}})};return q;}})};
 const r=createDeploymentRouter({client,services,activeId:'markets-v2'});
 assert.equal(await r.purchases.create(),'new');assert.equal(await r.purchases.get(id,identity),'old');assert.deepEqual(filters,[['id',id],['privy_user_id',identity.userId],['wallet_address',A]]);
 assert.deepEqual((await r.claims.list(identity)).claims.map(c=>c.deploymentId),['atomic-v1','markets-v2']);
 await r.claims.create(identity,{entryId:'1',deploymentId:'atomic-v1'},id);await r.claims.create(identity,{entryId:'1',deploymentId:'markets-v2'},id);
 assert.deepEqual(called,[['old',{entryId:'1'}],['new',{entryId:'1'}]]);await assert.rejects(r.claims.create(identity,{entryId:'1'},id),/MARKET_CHANGED/);
 assert.equal(await r.entries(identity,null,'atomic-v1'),'old');assert.equal(await r.entries(identity,null,'markets-v2'),'new');await assert.rejects(async()=>r.entries(identity,null,'unknown'),/ROUND_UNAVAILABLE/);
});
