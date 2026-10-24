// Isolated integration check. Never touches deployed data or the developer's preview DB.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
const root=process.cwd(),state=mkdtempSync(path.join(tmpdir(),'causal-ta-web-test-'));
const config=path.join(root,'dist/server/wrangler.json');
const wrangler=['--import',path.join(root,'scripts/sites-env.mjs'),path.join(root,'node_modules/wrangler/bin/wrangler.js')];
const run=(args,env=process.env)=>{const r=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});if(r.status!==0)throw Error('Check failed: '+args.at(-1));};
let server,output='';
try{
 const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
 for(const e of journal.entries)run([...wrangler,'d1','execute','DB','--local','--config',config,'--persist-to',state,'--file',path.join(root,'drizzle',e.tag+'.sql')]);
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const base=`http://127.0.0.1:${port}`;
 server=spawn(process.execPath,[...wrangler,'dev','--local','--config',config,'--persist-to',state,'--ip','127.0.0.1','--port',String(port),'--inspector-port','0'],{cwd:root,stdio:['ignore','pipe','pipe']});
 for(const stream of [server.stdout,server.stderr])stream.on('data',b=>{output=(output+b.toString()).slice(-12000);});
 let ready=false;
 for(let n=0;n<120;n++){if(server.exitCode!==null)throw Error('Server exited: '+output);try{const r=await fetch(base,{signal:AbortSignal.timeout(1000)});if(r.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
 if(!ready)throw Error('Server startup timed out: '+output);
 run(['tests/api.test.mjs'],{...process.env,TEST_BASE:base});
 console.log('Web integration passed against a fresh isolated D1 database.');
}finally{
 if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>{server.once('exit',resolve);setTimeout(()=>{if(server.exitCode===null)server.kill('SIGKILL');resolve();},4000).unref();});}
 rmSync(state,{recursive:true,force:true});
}
