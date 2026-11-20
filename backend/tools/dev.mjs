import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const children=[];
let closing=false;
function close(code=0) {
  if(closing)return;closing=true;
  for(const child of children)if(!child.killed)child.kill('SIGTERM');
  setTimeout(()=>process.exit(code),1600).unref();
}
function start(args,cwd) {
  const child=spawn(process.execPath,args,{cwd,stdio:'inherit'});
  children.push(child);
  child.on('error',()=>close(1));
  child.on('exit',code=>close(code??1));
}
start(['--env-file-if-exists=.env.local','src/server.js'],root+'backend');
start(['node_modules/vite/bin/vite.js'],root+'frontend');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>close());
