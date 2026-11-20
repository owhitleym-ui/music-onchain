import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,cp,mkdir,symlink,readFile,stat,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/config.js';

test('private setup generates once, preserves the administrator and prints no private values',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'music-private-setup-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const backend=join(folder,'backend');await mkdir(backend);
  for(const name of ['tools','src'])await cp(fileURLToPath(new URL('../'+name,import.meta.url)),join(backend,name),{recursive:true});
  // Configuration reads deployment manifests; copying compilers and build caches
  // makes this private-settings test depend on unrelated local tool downloads.
  await mkdir(join(folder,'contracts'));
  await cp(fileURLToPath(new URL('../../contracts/deployments',import.meta.url)),join(folder,'contracts','deployments'),{recursive:true});
  await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(backend,'node_modules'),'dir');
  const command=()=>spawnSync(process.execPath,['tools/setup.mjs','--init'],{cwd:backend,encoding:'utf8'});
  const first=command();assert.equal(first.status,0,first.stderr);
  const path=join(backend,'.env.local'),before=await readFile(path,'utf8');
  const secret=JSON.parse(before.split('\n').find(l=>l.startsWith('ADMIN_PRIVATE_KEY=')).split('=')[1]);
  assert.match(secret,/^0x[\da-f]{64}$/);
  assert.equal((await stat(path)).mode&0o777,0o600);
  assert.doesNotMatch(first.stdout,new RegExp(secret));
  const second=command();assert.equal(second.status,0);assert.equal(await readFile(path,'utf8'),before);
  assert.equal(first.stdout.match(/0x[\da-f]{40}/i)[0],second.stdout.match(/0x[\da-f]{40}/i)[0]);
  await writeFile(path,before.replace('ADMIN_PRIVATE_KEY='+JSON.stringify(secret),'ADMIN_PRIVATE_KEY="invalid"'));
  const invalid=command();assert.equal(invalid.status,1);assert.match(await readFile(path,'utf8'),/ADMIN_PRIVATE_KEY="invalid"/);
});
test('configuration pins the test app and requires proper server/RPC settings',()=>{
  const config=loadConfig({});assert.deepEqual(config.missing,['PRIVY_APP_SECRET','SUPABASE_URL','SUPABASE_SECRET_KEY','ADMIN_PRIVATE_KEY']);
  assert.throws(()=>loadConfig({PRIVY_APP_ID:'wrong'}));
  assert.throws(()=>loadConfig({ADMIN_PRIVATE_KEY:'0x123'}));
  assert.throws(()=>loadConfig({APPROVAL_HOURLY_LIMIT:'0'}));
  assert.throws(()=>loadConfig({ARC_RPC_URL:'http://untrusted'}));
  assert.throws(()=>loadConfig({SUPABASE_URL:'https://unrelated.example'}));
});
