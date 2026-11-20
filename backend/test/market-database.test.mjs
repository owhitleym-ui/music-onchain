import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const C='0x0e45cf9200c27af84ba175a8f6723ffd8dd8b083',V='0x'+'b'.repeat(40),A='0x'+'a'.repeat(40),HASH='a'.repeat(64);
test('migration 006 registers immutable deployments, isolates colliding IDs and preserves legacy reads/claims',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
 for(const file of ['001_account_approvals','002_atomic_payments','003_quicknode_events','004_live_contest_reads','005_results_and_claims','006_market_schedules'])await db.exec(await readFile(new URL('../supabase/'+file+'.sql',import.meta.url),'utf8'));
 const rpc=async(name,args=[])=>{const r=await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args.map(v=>v&&typeof v==='object'?JSON.stringify(v):v));return r.rows[0].value;};
 assert.equal(await rpc('music_market_schema_status'),2);
 const manifest={address:V,marketModelVersion:2,chainId:5042002,creationBlock:80000000,runtimeSha256:HASH};
 const register=(id='markets-v2',activate=false)=>rpc('music_register_market_deployment',[id,V,80000000,HASH,manifest,activate]);
 await assert.rejects(rpc('music_register_market_deployment',['markets-v2',V,80000000,HASH,{},false]),/BAD_DEPLOYMENT/);
 assert.equal((await register()).active,false);assert.equal((await register()).contract_address,V);
 await assert.rejects(register('conflicting-id',true),/DEPLOYMENT_IMMUTABLE/);
 const tx='0x'+'1'.repeat(64),blockHash='0x'+'2'.repeat(64);
 const event=(contract,block,args,name='RoundCreated')=>({contract_address:contract,block_number:String(block),block_hash:blockHash,transaction_hash:tx,log_index:0,event_name:name,args,raw_log:{topics:[],data:'0x'}});
 const ingest=(rows)=>rpc('music_ingest_chain_events',[randomUUID(),HASH,{},rows]);
 await ingest([event(C,73100560,{roundId:'1',songId:'0x'+'3'.repeat(64),musicId:'old',artist:A,start:'100'})]);
 await ingest([event(V,80000000,{roundId:'1',songId:'0x'+'3'.repeat(64),musicId:'new',artist:A,start:'200',deadline:'88400',cadence:1})]);
 assert.equal((await rpc('music_live_catalog',[C,90000000])).rounds[0].musicId,'old');
 const catalog=await rpc('music_market_catalog',[V,90000000]);assert.equal(catalog.rounds[0].musicId,'new');assert.equal(catalog.rounds[0].deadlineSeconds,'88400');assert.equal(catalog.rounds[0].cadence,'daily');
 await assert.rejects(ingest([event(V,79999999,{})]),/UNKNOWN_DEPLOYMENT/);await assert.rejects(ingest([event(A,90000000,{})]),/UNKNOWN_DEPLOYMENT/);
 const create=(contract,kind='purchase')=>rpc('music_wallet_action_create',['did:privy:market-test',A,contract,randomUUID(),kind==='purchase'?{roundId:'1',guess:'10',horizon:'24h',optionId:'single'}:{entryId:'1'},{nonce:0},new Date(Date.now()+120000).toISOString(),{},kind]);
 const old=await create(C);await assert.rejects(register('markets-v2',true),/OLD_DEPLOYMENT_PENDING/);
 await rpc('music_purchase_action',[old.id,'did:privy:market-test',A,C,'cancel',null,null]);assert.equal((await register('markets-v2',true)).active,true);
 await assert.rejects(create(C),/MARKET_CHANGED/);
 const claim=await create(C,'claim_entry');assert.equal(claim.contract_address,C);await rpc('music_purchase_action',[claim.id,'did:privy:market-test',A,C,'cancel',null,null]);
 const payload={start:100},job=await rpc('music_v2_operator_job',['create-hourly',null,A,V,payload]);assert.equal((await rpc('music_v2_operator_job',['create-hourly',null,A,V,payload])).id,job.id);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.exec('select * from music_deployments'),/permission denied/);await assert.rejects(rpc('music_market_schema_status'),/permission denied/);await db.exec('reset role');}
 await db.exec('set role service_role');assert.equal(await rpc('music_market_schema_status'),2);await assert.rejects(db.exec('update music_deployments set active=true'),/permission denied/);
 await db.exec('reset role');await db.exec(await readFile(new URL('../supabase/007_daily_markets.sql',import.meta.url),'utf8'));
 assert.equal(await rpc('music_market_schema_status'),3);
 const W='0x'+'c'.repeat(40),v3={...manifest,address:W,creationBlock:81000000,marketModelVersion:3};
 assert.equal((await rpc('music_register_market_deployment',['markets-v3',W,81000000,HASH,v3,false])).model_version,3);
 await assert.rejects(rpc('music_register_market_deployment',['markets-v3',W,81000000,HASH,{...v3,marketModelVersion:2},false]),/DEPLOYMENT_IMMUTABLE/);
 await db.exec("update music_admin_transactions set state='cancelled' where state='queued'");
 assert.equal((await rpc('music_register_market_deployment',['markets-v3',W,81000000,HASH,v3,true])).active,true);
 assert.equal((await rpc('music_register_market_deployment',['markets-v2',V,80000000,HASH,manifest,false])).model_version,2);
 await ingest([event(W,81000000,{roundId:'1',songId:'0x'+'3'.repeat(64),musicId:'daily-v3',artist:A,start:'300',deadline:'86700',cadence:1})]);
 assert.equal((await rpc('music_market_catalog',[W,90000000])).rounds[0].musicId,'daily-v3');
 assert.equal((await rpc('music_market_catalog',[V,90000000])).rounds[0].musicId,'new');
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(rpc('music_market_schema_status'),/permission denied/);await db.exec('reset role');}

});
