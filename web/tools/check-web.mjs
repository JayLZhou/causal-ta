// Isolated integration check. Never touches deployed data or the developer's preview DB.
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
const root=process.cwd(),state=mkdtempSync(path.join(tmpdir(),'causal-ta-web-test-'));
const config=path.join(root,'dist/server/wrangler.json');
const wrangler=['--import',path.join(root,'scripts/sites-env.mjs'),path.join(root,'node_modules/wrangler/bin/wrangler.js')];
const run=(args,env=process.env)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,env,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Check failed: '+args.at(-1))));});
let server,output='';
try{
 const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
 for(const e of journal.entries)await run([...wrangler,'d1','execute','DB','--local','--config',config,'--persist-to',state,'--file',path.join(root,'drizzle',e.tag+'.sql')]);
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const base=`http://127.0.0.1:${port}`;
 // Freeze the built worker for integration tests; dev file watchers can restart mid-POST on Linux.
 await import('../scripts/sites-env.mjs');
 const {unstable_dev}=await import('wrangler');
 server=await unstable_dev(path.join(root,'dist/server/index.js'),{config,ip:'127.0.0.1',port,inspectorPort:0,local:true,persistTo:state,bundle:false,logLevel:'warn',experimental:{watch:false,disableDevRegistry:true,disableExperimentalWarning:true,showInteractiveDevSession:false}});
 let ready=false,stable=0;
 for(let n=0;n<120;n++){try{const r=await fetch(base,{signal:AbortSignal.timeout(1000)});const api=await fetch(base+'/api/workspace',{signal:AbortSignal.timeout(1000)});const body=await api.json();if(r.status===200&&api.status===401&&body.error){stable++;if(stable>=6){ready=true;break;}}else stable=0;}catch{stable=0;}await new Promise(r=>setTimeout(r,500));}
 if(!ready)throw Error('Server startup timed out: '+output);
 await run(['tests/api.test.mjs'],{...process.env,TEST_BASE:base});
 console.log('Web integration passed against a fresh isolated D1 database.');
}catch(e){console.error('Worker diagnostic output:\n'+output);throw e;}finally{
 if(server)await server.stop();
 rmSync(state,{recursive:true,force:true});
}
