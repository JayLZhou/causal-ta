// Opt-in live evaluation: public synthetic cases only; no learner data is loaded.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {askTutor,tutorRequest} from '../lib/tutor.mjs';
const args=process.argv.slice(2),live=args.includes('--live');
const limitArg=args.find(x=>x.startsWith('--limit='));
const cases=JSON.parse(readFileSync(new URL('../evals/tutorial-cases.json',import.meta.url),'utf8'));
const limit=limitArg?Number(limitArg.split('=')[1]):cases.length;
if(!Number.isInteger(limit)||limit<1||limit>cases.length)throw Error('Invalid --limit; choose 1–'+cases.length);
if(live&&(!process.env.OPENAI_API_KEY||!process.env.CAUSALTA_MODEL))throw Error('Live evaluation requires OPENAI_API_KEY and CAUSALTA_MODEL in the environment. Never put keys in command arguments.');
const report={mode:live?'live-human-review-required':'offline-request-validation',created:new Date().toISOString(),model:live?process.env.CAUSALTA_MODEL:null,learningEffectVerified:false,cases:[]};
for(const c of cases.slice(0,limit)) {
 const input={model:process.env.CAUSALTA_MODEL||'unconfigured',message:c.message,notes:c.note?[{id:'material-1',title:'测试材料',subject:c.subject,body:c.note}]:[],history:[],goal:'理解而非复制答案'};
 const req=tutorRequest(input);if(req.store!==false||req.tools||req.max_output_tokens!==1800)throw Error('Unexpected provider contract');
 const result={id:c.id,criteria:c.criteria,status:live?'awaiting-human-review':'request-valid',review:{correctness:null,minimalHint:null,discriminatingTest:null,transfer:null,grounding:null},reply:null};
 if(live){try{result.reply=await askTutor(input,process.env.OPENAI_API_KEY);}catch{result.status='provider-or-contract-failure';}}
 report.cases.push(result);
}
const out=path.resolve('outputs/evals');mkdirSync(out,{recursive:true});const file=path.join(out,`${Date.now()}-${live?'live':'offline'}.json`);writeFileSync(file,JSON.stringify(report,null,2)+'\n');
console.log(`${report.cases.length} cases: ${report.mode}. Report: ${file}`);
console.log('No teaching-quality score or learning-effect claim is produced automatically.');
if(report.cases.some(c=>c.status==='provider-or-contract-failure'))process.exitCode=1;
