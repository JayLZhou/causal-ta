// A learner-owned inquiry ledger. No model reply can award mastery or overwrite evidence.
export const stages = {hypothesize:'设计检验',observe:'记录结果',reflect:'解释与迁移设计',transfer:'独立作答',verify:'核查答案',review:'复习已安排'};
const DAY=86400000;
const value=(v,n,label)=>{if(typeof v!=='string'||!v.trim()||v.length>n)throw Error(`${label}需要 1–${n} 字`);return v.trim();};
const choice=(v,options)=>{if(!options.includes(v))throw Error('选项无效');return v;};
const norm=s=>s.trim().replace(/\s+/g,' ').toLowerCase();
export function createInquiry(input,materials=[],now=new Date().toISOString()) {
 return {version:1,title:value(input.title,120,'标题'),subject:value(input.subject,80,'课程'),concept:value(input.concept,120,'概念'),
  problem:value(input.problem,6000,'题目'),attempt:value(input.attempt,4000,'已有尝试'),stuck:value(input.stuck,2000,'卡点'),
  materials:materials.map(n=>({id:n.id,title:n.title,subject:n.subject,body:n.body.slice(0,6000)})),
  stage:'hypothesize',plans:[],events:[],checks:[],reflection:'',due:null,streak:0,created:now};
}
export function transition(original,input,now=new Date().toISOString()) {
 const s=structuredClone(original);if(s.events.length>=200)throw Error('本题记录已达上限，请导出后新建题目');
 const event={type:input.action,at:now};
 if(input.action==='plan'&&s.stage==='hypothesize') {
  const p={a:value(input.a,800,'解释 A'),b:value(input.b,800,'解释 B'),change:value(input.change,1200,'改变的条件'),control:value(input.control,1200,'保持不变的条件'),
   predictionA:value(input.predictionA,1200,'A 的预测'),predictionB:value(input.predictionB,1200,'B 的预测'),kind:choice(input.kind,['controlled','counterexample','comparison']),reason:value(input.reason,1200,'选择理由'),at:now};
  if(norm(p.a)===norm(p.b)||norm(p.predictionA)===norm(p.predictionB))throw Error('两个解释需要给出不同的预测，才能用结果区分它们');
  s.plans.push(p);event.plan=structuredClone(p);s.stage='observe';
 } else if(input.action==='observe'&&s.stage==='observe') {
  const observation={result:value(input.result,3000,'实际结果'),source:value(input.source,1000,'结果来源'),comparison:choice(input.comparison,['a','b','neither','unclear']),explanation:value(input.explanation,2000,'证据解释'),at:now};
  s.plans.at(-1).observation=observation;event.observation=observation;s.stage='reflect';
 } else if(input.action==='retry'&&s.stage==='reflect') {
  event.reason=value(input.reason,1200,'重新检验的理由');s.stage='hypothesize';
 } else if(input.action==='transfer'&&s.stage==='reflect') {
  s.reflection=value(input.reflection,3000,'更新后的解释');
  s.checks.push(newCheck(s,input,now));s.stage='transfer';event.question=s.checks.at(-1).question;event.reflection=s.reflection;
 } else if(input.action==='answer'&&s.stage==='transfer') {
  const c=s.checks.at(-1);c.answer=value(input.answer,4000,'独立答案');c.answeredAt=now;s.stage='verify';event.answer=c.answer;
 } else if(input.action==='verify'&&s.stage==='verify') {
  const c=s.checks.at(-1);c.rating=choice(input.rating,['independent','partial','again']);
  if(typeof input.usedHelp!=='boolean')throw Error('请选择作答时是否使用了帮助');
  c.usedHelp=input.usedHelp;c.basis=value(input.basis,3000,'核查依据');c.verifiedAt=now;c.provenance='learner-self-check';
  // A self-report remains a self-report, never a graded course result or a causal effect estimate.
  s.streak=c.rating==='independent'&&!c.usedHelp?s.streak+1:0;
  const days=c.rating==='again'||c.usedHelp?1:c.rating==='partial'?3:[7,14,30][Math.min(s.streak-1,2)];
  s.due=new Date(Date.parse(now)+days*DAY).toISOString();s.stage='review';Object.assign(event,{rating:c.rating,usedHelp:c.usedHelp,basis:c.basis,nextDue:s.due});
 } else if(input.action==='review'&&s.stage==='review') {
  if(Date.parse(now)<Date.parse(s.due))throw Error('复习尚未到期；可以先创建另一道题，保留这次间隔检验');
  s.checks.push(newCheck(s,input,now));s.stage='transfer';event.question=s.checks.at(-1).question;
 } else throw Error('当前步骤不支持这个操作，请刷新后继续');
 s.events.push(event);return s;
}
function newCheck(s,input,now) {
 const question=value(input.question,3000,'新题'),context=value(input.context,1000,'新情境');
 if([s.problem,...s.checks.map(c=>c.question)].some(q=>norm(q)===norm(question)))throw Error('请使用不同的新题，不能重复原题或已答题');
 return {question,context,created:now};
}
export function tutorContext(s) {
 if(['transfer','verify'].includes(s.stage))throw Error('独立作答与核查期间暂停这道题的模型提示，请先完成首次作答和核查');
 return {title:s.title,subject:s.subject,concept:s.concept,problem:s.problem,attempt:s.attempt,stuck:s.stuck,stage:s.stage,
  latest_plan:s.plans.at(-1)||null,reflection:s.reflection,
  instruction:'Provide a minimal next-step question for this stage. Competing explanations are provisional. Do not grade or certify mastery. Do not treat self-reported outcomes as causal effects.'};
}
export function learningOverview(inquiries,now=new Date().toISOString()) {
 const groups=new Map();
 for(const s of inquiries) {
  const key=norm(s.subject)+'::'+norm(s.concept);
  const g=groups.get(key)||{key,subject:s.subject,concept:s.concept,inquiries:0,checks:0,independent:0,needsReview:0,unresolved:0,contexts:[],sources:[]};
  g.inquiries++;g.sources.push({id:s.id,title:s.title});
  if(!s.plans.length||['neither','unclear'].includes(s.plans.at(-1)?.observation?.comparison)||!s.plans.at(-1)?.observation)g.unresolved++;
  for(const c of s.checks.filter(c=>c.verifiedAt)){g.checks++;if(c.rating==='independent'&&!c.usedHelp)g.independent++;if(!g.contexts.includes(c.context))g.contexts.push(c.context);}
  if(s.stage==='review'&&s.due<=now)g.needsReview++;
  groups.set(key,g);
 }
 return {concepts:[...groups.values()],due:inquiries.filter(s=>s.stage==='review'&&s.due<=now).sort((a,b)=>a.due.localeCompare(b.due)),
  scheduled:inquiries.filter(s=>s.stage==='review'&&s.due>now).sort((a,b)=>a.due.localeCompare(b.due))};
}
