const $=id=>document.getElementById(id);
let draft=null, validated=null, busy=false, rawDirty=false;
function focusContent(element){element.tabIndex=-1;element.focus({preventScroll:true});element.scrollIntoView({block:'start',behavior:'instant'});}
async function api(path,body){
  const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const value=await r.json(); if(!r.ok) throw new Error(value.error||'请求失败'); return value;
}
function invalidate(){validated=null;$('save').disabled=true;$('validation').textContent='草稿已修改，请重新校验。';$('saved').textContent='';}
function sync(){ $('raw').value=JSON.stringify(draft,null,2);rawDirty=false;$('raw-note').textContent='表单与 JSON 已同步。'; }
function lockForms(value){document.querySelectorAll('#metadata input,#metadata textarea,#pedagogy input,#pedagogy textarea,#checks input,#checks textarea,#transfer input,#transfer textarea').forEach(el=>el.disabled=value);}
function field(parent,label,value,write,multiline=false){
  const box=document.createElement('label');box.textContent=label;
  const input=document.createElement(multiline?'textarea':'input');input.value=value??'';
  if(multiline)input.rows=3;else input.type='text';
  input.addEventListener('input',()=>{write(input.value);invalidate();sync();});box.append(input);parent.append(box);return input;
}
function group(parent,title){const el=document.createElement('details');const summary=document.createElement('summary');summary.textContent=title;el.append(summary);parent.append(el);return el;}
function questions(parent,questions,isCheck){
  questions.forEach((q,i)=>{
    const box=group(parent,`${i+1} · ${q.prompt}`);
    field(box,'问题',q.prompt,v=>q.prompt=v,true);
    q.options.forEach((option,j)=>field(box,`选项 ${j}`,option,v=>q.options[j]=v));
    const answer=field(box,'正确答案序号',q.answer,v=>q.answer=v.trim()===''?null:Number(v));answer.type='number';answer.min=0;answer.max=q.options.length-1;answer.step=1;
    const key=isCheck?'feedback':'explanation';field(box,'作答后反馈',q[key],v=>q[key]=v,true);
    if(isCheck){const note=document.createElement('p');note.className='muted';note.textContent=`误解映射（选项序号 → 假设 ID）：${JSON.stringify(q.wrong_map||{})}。在完整 JSON 中调整；正确选项不能有误解映射。`;box.append(note);}
  });
}
function render(){
  if(!draft||typeof draft!=='object'||Array.isArray(draft))throw new Error('课程需要 JSON 对象');
  for(const id of ['metadata','pedagogy','checks','transfer'])$(id).replaceChildren();
  for(const [key,label] of [['id','课程 ID（新版本请使用新 ID）'],['title','课程标题'],['subject','课程分类'],['description','课程简介']])field($('metadata'),label,draft[key],v=>draft[key]=v,key==='description');
  for(const o of draft.pedagogy?.objectives||[])field($('pedagogy'),`学习目标 ${o.id}`,o.label,v=>o.label=v);
  for(const m of draft.pedagogy?.misconceptions||[]){const box=group($('pedagogy'),m.id);for(const [key,label] of [['label','待核查的误解'],['hint','最小提示'],['question','追问']])field(box,label,m[key],v=>m[key]=v,true);}
  questions($('checks'),draft.pedagogy?.checks||[],true);questions($('transfer'),draft.transfer||[],false);
  $('editor').hidden=false;lockForms(false);
}
function applyRaw(){
  const parsed=JSON.parse($('raw').value);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('课程需要 JSON 对象');
  // 结构不完整的 JSON 仍可校验；只有格式完整的草稿渲染到引导表单。
  draft=parsed;rawDirty=false;invalidate();
  try{render();}catch{lockForms(true);$('raw-note').textContent='草稿结构不完整，请用校验结果修复 JSON。';}
}
async function run(fn){
  if(busy)return;busy=true;$('error').textContent='';
  const previousFocus=document.activeElement;
  const buttons=[...document.querySelectorAll('button')],before=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);
  try{await fn();}catch(e){$('error').textContent=e.message;focusContent($('error'));}
  finally{busy=false;buttons.forEach((b,i)=>b.disabled=before[i]);$('save').disabled=!validated;
    if(document.activeElement===document.body&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
}
$('load').onclick=()=>run(async()=>{draft=await api('/api/authoring/templates/'+encodeURIComponent($('template').value));draft.id=draft.id.slice(0,56)+'-custom';draft.title+=' · 我的课程';invalidate();render();sync();$('metadata').querySelector('input').focus();});
$('raw').oninput=()=>{rawDirty=true;invalidate();lockForms(true);$('raw-note').textContent='JSON 有未应用的编辑；校验时将使用这里的内容。';};
$('apply').onclick=()=>run(async()=>{applyRaw();sync();focusContent($('raw-note'));});
$('validate').onclick=()=>run(async()=>{
  if(rawDirty)applyRaw();
  const text=JSON.stringify(draft),result=await api('/api/authoring/validate',{course:draft});
  if(text!==JSON.stringify(draft)||rawDirty)throw new Error('校验期间草稿有变化，请重新校验。');
  validated={version:result.version,text};
  $('validation').textContent=`通过：${result.states} 个可区分状态，${result.actions} 个实验，${result.checks} 道理解检查，${result.transfer} 道迁移题。版本 ${result.version.slice(0,12)}。请人工审核题目、反馈和映射后保存。`;
  focusContent($('validation'));
});
$('save').onclick=()=>run(async()=>{
  if(!validated||rawDirty||validated.text!==JSON.stringify(draft))throw new Error('请先校验当前草稿');
  const result=await api('/api/authoring/save',{course:JSON.parse(validated.text),version:validated.version});
  validated=null;const link=document.createElement('a');link.href='/';link.textContent='前往学习入口试用 ↗';$('saved').textContent=`已保存「${result.course.title}」。`; $('saved').append(link);
  focusContent($('saved'));
});
$('download').onclick=()=>run(async()=>{
  const value=rawDirty?JSON.parse($('raw').value):draft;
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='causal-ta-course.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
run(async()=>{
  const config=await api('/api/config');
  if(!config.authoring){$('mode').textContent='教师模式尚未启用。请用 python3 -m causal_ta.server --authoring 启动，然后刷新本页。';return;}
  $('mode').textContent='教师模式已启用 · 本机课程库';
  const courses=await api('/api/courses');for(const c of courses){const o=document.createElement('option');o.value=c.id;o.textContent=c.title;$('template').append(o);}
  $('template').disabled=false;
}).then(()=>{if(!$('template').disabled)$('load').disabled=false;});
