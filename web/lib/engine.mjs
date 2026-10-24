// Server-side finite-model tutorial engine. No arbitrary code evaluation.
export function evaluate(expr, state) {
  if (typeof expr === 'number' || typeof expr === 'boolean') return expr;
  if (typeof expr === 'string') return state[expr];
  const [op, ...children] = expr, a = children.map(v => evaluate(v, state));
  if (op === 'all') return Number(a.every(Boolean));
  if (op === 'add') return a.reduce((s, v) => s + v, 0);
  if (op === 'mul') return a.reduce((s, v) => s * v, 1);
  if (op === 'div') { if (!a[1]) throw Error('分母不能为零'); return a[0] / a[1]; }
  if (op === 'loop_sum' || op === 'loop_count') {
    let result = 0;
    for (let i = a[0]; i < a[2] + a[1]; i++) result += op === 'loop_sum' ? i : 1;
    return result;
  }
  if (op === 'binary_search') {
    const [closed, advance, values, target] = a;
    let low = 0, high = values.length - 1; const seen = new Set();
    while (closed ? low <= high : low < high) {
      const key = `${low}:${high}`; if (seen.has(key)) return -2; seen.add(key);
      const mid = Math.floor((low + high) / 2);
      if (values[mid] === target) return mid;
      if (values[mid] < target) low = mid + advance; else high = mid - 1;
    }
    return -1;
  }
  throw Error('不支持的表达式');
}
export function worlds(course) {
  return Object.entries(course.variables).reduce((rows, [key, v]) => rows.flatMap(w => v.domain.map(n => ({...w, [key]: n}))), [{}]);
}
export function result(c, w, a) { return evaluate(a.measure, {...c.context, ...w, ...a.do}); }
export function start(c, random = Math.random) {
  const eligible = worlds(c).filter(w => evaluate(c.start_filter ?? 1, {...c.context, ...w}));
  const world = eligible[Math.floor(random() * eligible.length)];
  const observation = evaluate(c.observation, {...c.context, ...world});
  return {course: c, world, observation, candidates: eligible.filter(w => evaluate(c.observation, {...c.context, ...w}) === observation),
    stage: 'investigate', events: [], used: [], transferResults: [], tutorTurns: []};
}
export function choices(s) {
  return s.course.actions.filter(a => !s.used.includes(a.id)).map(a => {
    const counts = new Map();
    s.candidates.forEach(w => { const v = result(s.course,w,a); counts.set(v,(counts.get(v) || 0)+1); });
    const n = s.candidates.length;
    const gain = Math.log2(n) - [...counts.values()].reduce((v,k) => v+k/n*Math.log2(k),0);
    return {id:a.id,title:a.title,description:a.description,kind:a.kind,information_gain:Math.round(gain*1000)/1000};
  }).sort((a,b) => b.information_gain-a.information_gain || a.id.localeCompare(b.id));
}
export function learner(s) {
  const p = s.course.pedagogy, events=s.events.filter(e => e.type==='check');
  return {
    objectives:p.objectives.map(o => {
      const es=events.filter(e => p.checks.find(q => q.id===e.check)?.objective===o.id);
      return {...o,attempted:es.length,correct:es.filter(e=>e.correct).length,status:!es.length?'尚无证据':es.at(-1).correct?'本次检查通过':'需再检查'};
    }),
    hypotheses:p.misconceptions.flatMap(m => {
      const last=events.findLastIndex(e=>e.hypothesis===m.id); if(last<0) return [];
      const followed=events.slice(last+1).some(e=>e.correct&&p.checks.find(q=>q.id===e.check)?.target===m.id);
      return [{id:m.id,label:m.label,hint:m.hint,question:m.question,followed}];
    })
  };
}
export function nextCheck(s) {
  if(s.stage!=='investigate') return null;
  const available=s.course.pedagogy.checks.filter(q=>!s.events.some(e=>e.type==='check'&&e.check===q.id));
  const pending=learner(s).hypotheses.filter(h=>!h.followed).reverse();
  return pending.map(h=>available.find(q=>q.target===h.id)).find(Boolean) || available[0] || null;
}
export function coursePublic(c) {
  const {id,title,subject,description,semantics,model_note,variables,context,graph,outcome_label,program,source,prediction_tolerance} = c;
  return {id,title,subject,description,semantics,model_note,variables,context,graph,outcome_label,program,source,prediction_tolerance,
    objectives:c.pedagogy.objectives,references:c.pedagogy.references};
}
export function view(s) {
  const q=nextCheck(s), t=s.stage==='transfer'?s.course.transfer[s.transferResults.length]:null;
  return {course:coursePublic(s.course),stage:s.stage,observation:s.observation,candidates:s.candidates,
    actions:s.stage==='investigate'?choices(s):[],events:s.events,learner:learner(s),tutorTurns:s.tutorTurns,
    check:q?{id:q.id,prompt:q.prompt,options:q.options}:null,
    transfer:t?{prompt:t.prompt,options:t.options}:null,transferResults:s.transferResults};
}
function option(q, answer) {
  if(!q || !Number.isInteger(answer) || answer<0 || answer>=q.options.length) throw Error('请选择当前题目的有效选项');
}
export function mutate(s, input) {
  const c=s.course; let feedback='';
  if(input.action==='experiment') {
    const a=c.actions.find(a=>a.id===input.experiment);
    if(s.stage!=='investigate'||!a||s.used.includes(a.id)) throw Error('该实验当前不可用');
    if(typeof input.prediction!=='number'||!Number.isFinite(input.prediction)||Math.abs(input.prediction)>1e6) throw Error('请输入有效数值预测');
    const actual=result(c,s.world,a), before=s.candidates.length;
    s.candidates=s.candidates.filter(w=>result(c,w,a)===actual);s.used.push(a.id);
    s.events.push({type:'experiment',title:a.title,prediction:input.prediction,result:actual,before,after:s.candidates.length,
      correct:Math.abs(actual-input.prediction)<=(c.prediction_tolerance||0),explanation:a.explanation});
    feedback=`实验结果：${actual}。${a.explanation}`;
  } else if(input.action==='diagnose') {
    if(s.stage!=='investigate'||!s.used.length) throw Error('先完成至少一次预测与实验');
    const v=input.values;
    if(!v||Object.keys(v).length!==Object.keys(c.variables).length||!Object.entries(c.variables).every(([k,d])=>typeof v[k]==='number'&&d.domain.includes(v[k]))) throw Error('请填写每个变量');
    const correct=Object.keys(c.variables).every(k=>v[k]===s.world[k]);
    s.events.push({type:'diagnosis',values:v,correct});
    if(correct) s.stage='transfer';
    feedback=correct?'解释与原始状态一致。现在用新问题检验能否迁移。':'这个解释还不符合原始状态。回看实验结果，再找能区分解释的证据。';
  } else if(input.action==='check') {
    const q=nextCheck(s);option(q,input.answer);
    if(input.check!==q.id) throw Error('题目已更新，请刷新后作答');
    s.events.push({type:'check',check:q.id,title:q.prompt,chosen:q.options[input.answer],correct:input.answer===q.answer,
      hypothesis:q.wrong_map?.[String(input.answer)],feedback:q.feedback,references:q.references});
    feedback=`${input.answer===q.answer?'本次检查通过。':'需要再想一想。'}${q.feedback}`;
  } else if(input.action==='transfer') {
    if(s.stage!=='transfer') throw Error('当前没有迁移题');
    const q=c.transfer[s.transferResults.length];option(q,input.answer);
    // Question index prevents a double-submit from answering the following question.
    if(input.index!==s.transferResults.length) throw Error('题目已更新，请刷新后作答');
    const e={type:'transfer',title:q.prompt,chosen:q.options[input.answer],correct:input.answer===q.answer,explanation:q.explanation};
    s.transferResults.push(e);s.events.push(e);
    if(s.transferResults.length===c.transfer.length) s.stage='complete';
    feedback=`${e.correct?'回答正确。':'这道题需要复习。'}${q.explanation}`;
  } else if(input.action==='tutor') {
    if(s.stage!=='investigate') throw Error('独立迁移和结题阶段不提供提示');
    if(s.tutorTurns.length>=30) throw Error('本轮提示已达 30 次，请先完成实验或检查');
    if(!['hint','question','reference'].includes(input.intent)) throw Error('请选择提示类型');
    const h=learner(s).hypotheses.filter(h=>!h.followed).at(-1), a=choices(s)[0];
    const message=input.intent==='reference'?c.pedagogy.references.map(r=>`${r.label}：${r.text}`).join('\n\n'):
      h?(input.intent==='hint'?h.hint:h.question):input.intent==='question'?
      '当前至少两个候选解释有什么不同？你能设计一个让它们产生不同结果的实验吗？':
      a?`考虑「${a.title}」。${a.description} 先写下自己的预测，再对照实验结果；这条推荐只依据候选解释的信息量。`:'实验已用完。把每条结果代回模型，检查哪个解释与所有结果相容。';
    s.tutorTurns.push({intent:input.intent,message,at:new Date().toISOString()});feedback='已根据本轮证据生成课程提示。';
  } else throw Error('不支持的学习操作');
  if(s.events.length>200) throw Error('本轮记录已达上限，请新建练习');
  return feedback;
}
