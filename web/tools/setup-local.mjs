// One-command setup for a fresh checkout. Only local D1; never remote credentials.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const stateArg=process.argv.find(s=>s.startsWith('--state='));
const state=stateArg?path.resolve(stateArg.slice(8)):path.join(root,'.wrangler/state');
function run(args,capture=false){const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',stdio:capture?'pipe':'inherit',env:{...process.env,CI:'1'}});if(r.error)throw r.error;if(r.status!==0)throw Error(capture?'Local database command failed; run npm run build and inspect your local configuration.':'Local setup failed.');return r.stdout;}
if(!process.argv.includes('--skip-build'))run(['scripts/run-framework.mjs','build']);
const config=JSON.parse(readFileSync('dist/server/wrangler.json','utf8'));
// Migration commands use a tiny local-only config, not a reusable production manifest.
const local={name:'causal-ta-local-migrations',compatibility_date:config.compatibility_date,d1_databases:config.d1_databases.map(d=>({...d,migrations_dir:path.join(root,'drizzle')}))};
mkdirSync('.wrangler',{recursive:true});const file=path.join(root,'.wrangler/migrations.json');writeFileSync(file,JSON.stringify(local));
const cmd=['--import',path.join(root,'scripts/sites-env.mjs'),path.join(root,'node_modules/wrangler/bin/wrangler.js')];
const common=['DB','--local','--config',file,'--persist-to',state];
const rows=JSON.parse(run([...cmd,'d1','execute',...common,'--command',"SELECT name FROM sqlite_master WHERE type='table'",'--json'],true)).flatMap(x=>x.results||[]).map(x=>x.name);
if(rows.includes('sessions')&&!rows.includes('d1_migrations'))throw Error('This pre-0.8 local database was initialized manually. It has been preserved. Apply only missing SQL files as described in README, or use --state=/absolute/path for a separate fresh test database. Do not replay old migrations.');
run([...cmd,'d1','migrations','apply',...common]);
console.log('Local schema ready at '+state);console.log(stateArg?'Custom state prepared for testing.':'Run npm run dev, then use local sign-in. No online model is required for the inquiry workflow.');
