import {boundedText} from '@/lib/body.mjs';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {askTutor,reserveQuota} from '@/lib/tutor.mjs';
import {tutorContext} from '@/lib/learning.mjs';
export const dynamic='force-dynamic';
const runtime=()=>env as typeof env & {OPENAI_API_KEY?:string;CAUSALTA_MODEL?:string};
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
async function inquiry(owner:string,id:unknown) {
 if(id===null||id===undefined||id==='')return null;
 if(typeof id!=='string'||id.length>64)throw Error('题目编号无效');
 const row=await env.DB!.prepare('SELECT state,revision FROM inquiries WHERE owner=? AND id=?').bind(owner,id).first<{state:string;revision:number}>();
 if(!row)throw Error('题目不存在或无权访问');
 return {id,revision:row.revision,state:JSON.parse(row.state)};
}
export async function GET(req:Request){
 const u=await getChatGPTUser();if(!u)return json({error:'请先登录。'},401);
 try {
  const task=await inquiry(u.userId,new URL(req.url).searchParams.get('inquiry'));
  const blocked=!!task&&['transfer','verify'].includes(task.state.stage);
  const {results}=await env.DB!.prepare('SELECT id,message,reply,"references",created,inquiry_id FROM conversations WHERE owner=? AND inquiry_id IS ? ORDER BY created DESC LIMIT 30').bind(u.userId,task?.id||null).all();
  return json({enabled:!!(runtime().OPENAI_API_KEY&&runtime().CAUSALTA_MODEL),blocked,turns:blocked?[]:results.reverse().map((r:any)=>({...r,reply:JSON.parse(r.reply),references:JSON.parse(r.references)}))});
 }catch{return json({error:'无法读取当前对话，请刷新后重试。'},400);}
}
export async function POST(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'请求来源无效'},403);
 if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'需要 JSON 请求'},415);
 const u=await getChatGPTUser();if(!u)return json({error:'请先登录。'},401);
 try{
  const b=JSON.parse(await boundedText(req,12000));
  if(b.consent!==true)return json({error:'请确认将问题及选中材料发送给 OpenAI。'},400);
  if(typeof b.message!=='string'||!b.message.trim()||b.message.length>3000)throw Error('问题需要 1–3000 字');
  if(!Array.isArray(b.notes)||b.notes.length>3||!b.notes.every((id:unknown)=>typeof id==='string'&&id.length<=64)||new Set(b.notes).size!==b.notes.length)throw Error('最多选择 3 份材料');
  const task=await inquiry(u.userId,b.inquiry),context=task?tutorContext(task.state):null;
  if(!runtime().OPENAI_API_KEY||!runtime().CAUSALTA_MODEL)return json({error:'在线语言模型尚未配置。我的题目、复习计划和课程实验仍可使用。'},503);
  const notes:any[]=[];
  for(const id of b.notes){const n=await env.DB!.prepare('SELECT id,title,subject,body FROM notes WHERE id=? AND owner=?').bind(id,u.userId).first();if(!n)return json({error:'材料不存在或无权访问'},404);notes.push(n);}
  const count=await env.DB!.prepare('SELECT count(*) AS n FROM conversations WHERE owner=?').bind(u.userId).first<{n:number}>();
  if((count?.n||0)>=100)return json({error:'已保存 100 条对话，请先导出，再删除旧对话。'},429);
  const day=new Date().toISOString().slice(0,10);
  await env.DB!.prepare('DELETE FROM usage WHERE substr(key,-10) < ?').bind(day).run();
  if(!await reserveQuota(env.DB!,u.userId,day))return json({error:'今日对话请求已达上限，请明天再试。'},429);
  const {results}=await env.DB!.prepare('SELECT message,reply FROM conversations WHERE owner=? AND inquiry_id IS ? ORDER BY created DESC LIMIT 6').bind(u.userId,task?.id||null).all();
  const profile=await env.DB!.prepare('SELECT goal FROM profiles WHERE owner=?').bind(u.userId).first<{goal:string}>();
  const reply=await askTutor({model:runtime().CAUSALTA_MODEL!,message:b.message,notes,history:results.reverse(),goal:profile?.goal||'',context},runtime().OPENAI_API_KEY!);
  const refs=notes.filter(n=>reply.reference_ids.includes(n.id)).map(n=>({id:n.id,title:n.title,excerpt:n.body.slice(0,6000)}));
  const values=[crypto.randomUUID(),u.userId,b.message,JSON.stringify(reply),JSON.stringify(refs),new Date().toISOString(),task?.id||null];
  const sql='INSERT INTO conversations(id,owner,message,reply,"references",created,inquiry_id) SELECT ?,?,?,?,?,?,?';
  const saved=await (task?env.DB!.prepare(sql+' WHERE EXISTS(SELECT 1 FROM inquiries WHERE id=? AND owner=? AND revision=?)').bind(...values,task.id,u.userId,task.revision):env.DB!.prepare(sql).bind(...values)).run();
  if(!saved.meta.changes)return json({error:'题目在等待回复期间已更新或删除，回复未保存。请回到题目查看当前步骤。'},409);
  const url=new URL(req.url);if(task)url.searchParams.set('inquiry',task.id);return GET(new Request(url));
 }catch(e){const m=e instanceof Error?e.message:'';return json({error:/D1_|SQLITE|database/i.test(m)?'对话暂时无法保存，请稍后重试。':/timeout|abort/i.test(m)?'模型响应超时，请稍后重试。':m||'请求失败。'},400);}
}
export async function DELETE(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'请求来源无效'},403);
 const u=await getChatGPTUser();if(!u)return json({error:'请先登录。'},401);
 try {
  const task=await inquiry(u.userId,new URL(req.url).searchParams.get('inquiry'));
  await env.DB!.prepare('DELETE FROM conversations WHERE owner=? AND inquiry_id IS ?').bind(u.userId,task?.id||null).run();return json({ok:true});
 }catch{return json({error:'删除失败，请刷新后重试。'},400);}
}
