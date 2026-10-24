const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let session = null, courses = [], busy = false, studyCode = null, config = {tutor:{remote_available:false}};

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}
async function run(fn) {
  if (busy) return;
  busy = true; $('error').textContent = '';
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await fn(); } catch(error) { $('error').textContent = error.message; }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
function save(next, preserveForms=false) {
  const previous = preserveForms ? [...document.querySelectorAll('#experiment-form input, #diagnose-form select, input[name="action"]')].map(el=>({id:el.id,name:el.name,value:el.value,checked:el.checked,type:el.type})) : [];
  session = next;
  localStorage.setItem('causal-ta-session', session.id);
  render();
  for(const item of previous) {
    const target = item.id ? $(item.id) : [...document.querySelectorAll('input,select')].find(el=>el.name===item.name && (item.type!=='radio'||el.value===item.value));
    if(target) { target.value=item.value; if(item.type==='radio') target.checked=item.checked; }
  }
}
function renderCatalog() {
  $('catalog').innerHTML = courses.map(c => `<button class="course ${session?.course.id === c.id ? 'selected' : ''}" data-course="${esc(c.id)}"><span class="eyebrow">${esc(c.subject)}</span><h2>${esc(c.title)}</h2><p>${esc(c.description)}</p><strong>开始探索 ↗</strong></button>`).join('');
  document.querySelectorAll('[data-course]').forEach(button => button.addEventListener('click', () => run(async () => {
    save(await api('/api/start', {course:button.dataset.course}));
    $('workspace').scrollIntoView({behavior:'smooth', block:'start'});
  })));
}
function render() {
  renderCatalog();
  const s = session, c = s.course;
  $('workspace').hidden = false;
  $('lesson-name').textContent = c.title;
  $('restart').hidden = Boolean(s.study_assignment);
  $('forget-panel').hidden = true;
  $('study-session-note').hidden = !s.study_assignment;
  if(s.study_assignment) $('study-session-note').textContent = `${s.study_assignment.data_kind==='synthetic'?'软件演练数据 · 不代表真实学生':'研究会话'} · ${s.study_assignment.title} · 固定离线 TA，同一参与码恢复原进度。`;
  $('coach').textContent = s.coach;
  $('program-panel').hidden = !c.program || s.stage==='transfer';
  $('program').textContent = c.program;
  $('prediction-note').textContent = c.prediction_tolerance ? `支持小数预测，允许绝对误差 ${c.prediction_tolerance}；条件概率可保留四位小数。` : '';
  $('observation').textContent = `${c.outcome_label}：${s.observation}`;
  for (const stage of ['investigate','transfer','complete']) $('step-'+stage).classList.toggle('active', s.stage === stage);
  $('semantics').textContent = c.semantics === 'mechanistic_scm' ? '受控系统因果模型' : '数学依赖模型';
  $('graph').textContent = c.graph.join('\n');
  $('model-note').textContent = c.model_note;
  $('source').textContent = c.source.label;
  if (/^https:\/\//.test(c.source.url)) $('source').href = c.source.url;
  else $('source').removeAttribute('href');
  $('candidate-panel').hidden = s.stage !== 'investigate';
  $('candidate-count').textContent = `还剩 ${s.candidate_count} 个候选解释（完整空间 ${s.total_worlds} 个状态）`;
  const keys = Object.keys(c.variables);
  $('course-version').textContent = `课程版本 ${c.version.slice(0,12)} · ${s.course_provenance==='frozen_at_start'?'随本次会话固定':'旧会话来源未核验，建议重新开始'}`;
  $('learner-panel').hidden = !s.learner.objectives.length;
  $('learner-objectives').innerHTML = s.learner.objectives.map(o=>`<div class="objective"><strong>${esc(o.label)}</strong><small>${esc(o.status)} · ${o.correct}/${o.attempted} 次检查通过</small></div>`).join('');
  $('learner-hypotheses').innerHTML = s.learner.hypotheses.map(h=>`<p><strong>${esc(h.label)}</strong><br><small>${esc(h.status)}</small></p>`).join('');
  $('check-panel').hidden = !s.concept_check;
  if(s.concept_check) {
    $('check-prompt').textContent = s.concept_check.prompt;
    $('check-reason').textContent = '为什么问这道题：'+s.concept_check.selection.reason;
    $('check-options').innerHTML = s.concept_check.options.map((option,i)=>`<label class="action"><input type="radio" name="check-answer" value="${i}" required>${esc(option)}</label>`).join('');
  }
  const lastCheck = [...s.events].reverse().find(e=>e.type==='concept_check');
  $('check-feedback').textContent = lastCheck ? `上一次检查${lastCheck.correct?'通过':'需再看一遍'}：${lastCheck.question}\n${lastCheck.feedback}` : '';
  $('tutor-panel').hidden = s.stage==='transfer';
  $('history-panel').hidden = s.stage==='transfer';
  $('learning-sidebar').hidden = s.stage==='transfer';
  $('export').hidden = s.stage==='transfer';
  $('tutor-mode').textContent = s.study_assignment ? '研究会话固定使用课程预设追问；自由文字只保存在本机，不参与评分。' : config.tutor.notice || '离线预设追问';
  $('remote-choice').hidden = !config.tutor.remote_available || Boolean(s.study_assignment);
  const refs = new Map(c.references.map(r=>[r.id,r]));
  $('tutor-conversation').innerHTML = s.tutor_turns.map(t=>`<div class="dialogue"><p class="student">我：${esc(t.student)}</p><small>${t.mode==='openai'?'联网 TA · 生成内容需核查':'离线 TA · 课程预设追问'}</small>${t.fallback_notice?`<p class="wrong">${esc(t.fallback_notice)}</p>`:''}<p>${esc(t.message)}</p><strong>${esc(t.question)}</strong>${t.reference_ids.length?`<details><summary>查看课程依据</summary>${t.reference_ids.filter(id=>refs.has(id)).map(id=>`<p class="reference">${esc(refs.get(id).label)}：${esc(refs.get(id).text)}</p>`).join('')}</details>`:''}</div>`).join('');
  $('candidates').innerHTML = `<table><thead><tr>${keys.map(k=>`<th>${esc(c.variables[k].label)}</th>`).join('')}</tr></thead><tbody>${s.candidates.map(w=>`<tr>${keys.map(k=>`<td>${esc(w[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  $('experiment-panel').hidden = s.stage !== 'investigate' || !s.actions.length;
  $('diagnose-panel').hidden = s.stage !== 'investigate';
  $('actions').innerHTML = s.actions.map((a,i) => `<label class="action"><input type="radio" name="action" value="${esc(a.id)}" ${i===0?'checked':''}><strong>${esc(a.title)}</strong><em>${i===0 && a.information_gain>0?'建议尝试 · ':''}${a.information_gain} bits</em><small>${esc(a.description)}</small></label>`).join('');
  $('prediction').value = '';
  $('variables').innerHTML = keys.map(k => `<label>${esc(c.variables[k].label)}<select name="${esc(k)}" required><option value="">请选择</option>${c.variables[k].domain.map(v=>`<option value="${v}">${v}</option>`).join('')}</select></label>`).join('');
  const last = s.events.at(-1);
  $('diagnosis-feedback').textContent = last?.type === 'diagnosis' && !last.correct ? '这个解释还不正确。请回看实验结果，检查每一个变量。' : '';
  $('transfer-panel').hidden = s.stage !== 'transfer';
  if (s.transfer) {
    $('transfer-question').textContent = s.transfer.prompt;
    $('transfer-options').innerHTML = s.transfer.options.map((option,i)=>`<label class="action"><input type="radio" name="answer" value="${i}" required>${esc(option)}</label>`).join('');
  }
  $('complete-panel').hidden = s.stage !== 'complete';
  $('results').innerHTML = `<p><strong>${s.transfer_results.filter(r=>r.correct).length} / ${s.transfer_results.length}</strong> 道迁移题首次回答正确。</p>` + s.transfer_results.map(r=>`<div class="event"><strong class="${r.correct?'good':'wrong'}">${r.correct?'✓ 正确':'再看一遍'}</strong><p>${esc(r.question)}</p><p>${esc(r.explanation)}</p></div>`).join('');
  $('history').innerHTML = s.events.length ? [...s.events].reverse().map(e => {
    if(e.type==='experiment') return `<div class="event"><strong>${esc(e.title)}</strong><p>预测 ${esc(e.prediction)} → 观察到 ${esc(e.result)} <span class="${e.prediction_correct?'good':'wrong'}">${e.prediction_correct?'· 一致':'· 修正我的预测'}</span></p><small>候选解释：${e.before} → ${e.after}</small><p>${esc(e.explanation)}</p></div>`;
    if(e.type==='diagnosis') return `<div class="event"><strong>${e.correct?'✓ 原始状态解释正确':'解释尚不正确'}</strong><p>${Object.entries(e.values).map(([k,v])=>`${esc(c.variables[k].label)}=${esc(v)}`).join('，')}</p></div>`;
    if(e.type==='concept_check') return `<div class="event"><strong>理解检查 · ${e.correct?'通过':'待追问'}</strong><p>${esc(e.question)}</p><p>我的选择：${esc(e.chosen)}</p><p>${esc(e.feedback)}</p></div>`;
    return `<div class="event"><strong>迁移题 · ${e.correct?'正确':'需要复习'}</strong><p>${esc(e.question)}</p><p>${esc(e.explanation)}</p></div>`;
  }).join('') : '<p class="muted">还没有实验。第一条证据，从你的预测开始。</p>';
}
$('experiment-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const action = document.querySelector('input[name="action"]:checked')?.value;
    if(!action || $('prediction').value.trim()==='') throw new Error('请先选择实验并填写预测');
    save(await api('/api/experiment', {id:session.id, action, prediction:Number($('prediction').value)}));
  });
});
$('diagnose-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const values = Object.fromEntries([...new FormData(event.target)].map(([k,v])=>[k,Number(v)]));
    save(await api('/api/diagnose', {id:session.id, values}));
    if(session.stage==='transfer') $('transfer-panel').scrollIntoView({behavior:'smooth'});
  });
});
$('transfer-form').addEventListener('submit', event => {
  event.preventDefault();
  const answer = Number(new FormData(event.target).get('answer'));
  run(async () => save(await api('/api/transfer', {id:session.id, answer})));
});
$('check-form').addEventListener('submit', event => {
  event.preventDefault();
  const answer = new FormData(event.target).get('check-answer');
  if(answer===null) return;
  run(async () => save(await api('/api/check',{id:session.id,check_id:session.concept_check.id,answer:Number(answer)}),true));
});
$('tutor-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const message=$('tutor-message').value;
    save(await api('/api/tutor',{id:session.id,message,use_remote:!session.study_assignment && config.tutor.remote_available && $('use-remote').checked}),true);
    $('tutor-message').value='';
  });
});
$('restart').addEventListener('click', () => run(async () => save(await api('/api/start',{course:session.course.id}))));
$('export').addEventListener('click', () => {
  const record = {schema_version:3, course:session.course.id, course_version:session.course.version, semantics:session.course.semantics,
    teaching_policy:session.teaching_policy, study_assignment:session.study_assignment,
    stage:session.stage, events:session.events, transfer_results:session.transfer_results,
    learner:session.learner,tutor_turns:session.tutor_turns,
    note:'本地学习记录，可能含自由文字；分享前请检查个人信息。不构成学习效果的因果证据。'};
  const url = URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));
  const link = document.createElement('a'); link.href=url; link.download=`causal-ta-${session.course.id}.json`; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('study-code').addEventListener('input',()=>{studyCode=null;$('study-info').hidden=true;$('study-consent').checked=false;});
$('study-info-form').addEventListener('submit',event=>{
  event.preventDefault();run(async()=>{
    studyCode=null;$('study-info').hidden=true;$('study-consent').checked=false;
    const code=$('study-code').value.trim(),info=await api('/api/study/info',{code});
    if($('study-code').value.trim()!==code)throw new Error('参与码已变化，请重新查看说明');
    studyCode=code;$('study-info').hidden=false;
    $('study-title').textContent=info.title+' · '+info.course_title;
    $('study-purpose').textContent=info.purpose;
    $('study-contact').textContent='负责人：'+info.contact;
    $('study-kind').textContent=(info.data_kind==='synthetic'?'这是软件演练，不收集真实学生证据。':'本机教学研究。')+(info.closed?' 已停止新分配，已有会话仍可恢复。':' 两组各有 50% 的分配概率。');
    $('study-consent-text').textContent=info.consent;
  });
});
$('study-join').addEventListener('click',()=>run(async()=>{
  if(!studyCode||!$('study-consent').checked)throw new Error('请先查看说明并自愿勾选同意');
  save(await api('/api/study/join',{code:studyCode,consent:true}));
  studyCode=null;$('study-code').value='';$('study-consent').checked=false;$('study-info').hidden=true;
  $('workspace').scrollIntoView({behavior:'smooth'});
}));
$('forget').addEventListener('click',()=>{
  $('forget-panel').hidden=false;
  $('forget-notice').textContent=session.study_assignment?'将删除本机的答题、实验和对话记录并退出研究；保留最小分组与退出计数，用于报告缺失结果。参与码将失效，无法撤销。已下载的导出文件需自行删除。':'将永久删除本机的答题、实验和对话记录，无法撤销。已下载的导出文件需自行删除。';
});
$('forget-cancel').addEventListener('click',()=>{$('forget-panel').hidden=true;});
$('forget-confirm').addEventListener('click',()=>run(async()=>{
  await api('/api/forget',{id:session.id});localStorage.removeItem('causal-ta-session');session=null;
  $('workspace').hidden=true;$('forget-panel').hidden=true;renderCatalog();
}));
run(async () => {
  [courses,config] = await Promise.all([api('/api/courses'),api('/api/config')]); renderCatalog();
  $('study-entry').hidden=!config.studies;
  const id = localStorage.getItem('causal-ta-session');
  if(id) {
    try { save(await api('/api/sessions/'+encodeURIComponent(id))); }
    catch { localStorage.removeItem('causal-ta-session'); $('error').textContent='上次会话无法恢复，可以重新选择课程。'; }
  }
});
