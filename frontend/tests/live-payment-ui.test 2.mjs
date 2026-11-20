import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
const next=()=>new Promise(r=>setTimeout(r,25));
test('desktop payment UI: four identical entries, explicit confirmation, account history and no sample mutation',async t=>{
 const w=new Window({url:'http://localhost:3000/#support?song=last-bus-home'});w.document.body.innerHTML='<div id="app"></div><div id="settings-root"></div><div id="modal-root"></div><div id="toast-root"></div>';
 const originals=new Map();for(const key of ['window','document','location','localStorage','navigator','MouseEvent']){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value:key==='window'?w:w[key],configurable:true});}
 const fetchBefore=globalThis.fetch,intervalBefore=globalThis.setInterval,intervals=[];globalThis.setInterval=(...args)=>{const id=intervalBefore(...args);id.unref?.();intervals.push(id);return id;};
 const wallet='0x'+'a'.repeat(40),contract='0x'+'c'.repeat(40),start=Math.floor(Date.now()/3600000)*3600000;let orders=[],signed=0,created=0;const id='10000000-0000-4000-8000-000000000001';
 globalThis.fetch=async(url,options={})=>{let value;
 if(url==='/api/account/approval')value={status:'approved',walletAddress:wallet};
 else if(url==='/api/contests')value={ready:true,contract,rounds:[{id:'1',songId:'last-bus-home',start,deadline:start+3600000}]};
 else if(String(url).includes('/pools/')){const h=String(url).split('/').at(-1),offset={'24h':0,'48h':24,week:144}[h];value={open:true,spotCount:'0',peopleCount:'0',totalDeposits:'0',mode:null,modeSpots:0,average:null,windowStart:start+offset*3600000,windowEnd:start+(offset+24)*3600000};}
 else if(url==='/api/purchases'&&options.method==='POST'){created++;value={id,request:JSON.parse(options.body),status:'awaiting_signature',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString(),entryIds:[],transaction:{chainId:5042002,from:wallet,to:contract,value:'20000000000000000000',gas:'900000',gasPrice:'20000000000',nonce:0,data:'0x12'}};orders=[value];}
 else if(String(url).endsWith('/signed')){signed++;value={...orders[0],status:'confirmed',entryIds:['1','2','3','4']};orders=[value];}
 else if(url==='/api/purchases/'+id)value=orders[0];
 else if(url==='/api/purchases')value={orders};else value={result:'0x'+(100n*10n**18n).toString(16)};
 return {ok:true,json:async()=>value};};
 const {account}=await import('../account.js');const {payments}=await import('../payments.js');
 t.after(()=>{payments.dispose();account.dispose();intervals.forEach(clearInterval);globalThis.setInterval=intervalBefore;globalThis.fetch=fetchBefore;for(const[k,v]of originals){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}w.happyDOM.abort();});
 account.attachRuntime({getAccessToken:async()=>'token',getProvider:async()=>({}),signTransaction:async()=> '0x1212'});
 account.updateSession({ready:true,authenticated:true,userId:'did:privy:one',email:'fan@example.com',walletsReady:true,address:wallet,linkedWalletAddress:wallet});
 await import('../app.js');await next();await payments.refresh();await next();
 const $=s=>w.document.querySelector(s);const click=s=>{assert.ok($(s),s);$(s).click();};
 assert.deepEqual([...w.document.querySelectorAll('.amount-top')].map(x=>x.textContent),['$5','$20','$50']);
 click('[data-amount="2000"]');const input=$('#prediction-guess');input.value='12345';input.dispatchEvent(new w.Event('input',{bubbles:true}));
 const saved=w.localStorage.getItem('music-prediction-demo-v1');
 assert.equal($('#prediction-form button[type="submit"]').disabled,false);
 $('#prediction-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await next();
 assert.equal(created,1);assert.equal(signed,0);assert.match($('#modal-root').textContent,/Four separate \$5 entries/);assert.match($('#modal-root').textContent,/Network fee/);
 click('[data-action="payment-confirm"]');await next();assert.equal(signed,1);assert.match($('#modal-root').textContent,/Entry #4/);assert.match($('#modal-root').textContent,/awaiting result/);
 click('[data-action="close-modal"]');w.location.hash='#purchases';w.dispatchEvent(new w.HashChangeEvent('hashchange'));await next();
 assert.match($('.live-purchases').textContent,/Last Bus Home · \$20/);assert.match($('.sample-history-notice').textContent,/sample records/);assert.equal(w.localStorage.getItem('music-prediction-demo-v1'),saved);
 assert.doesNotMatch($('.live-purchases').textContent,/USDC|MetaMask|0x[a-f0-9]{40}/i);
});
