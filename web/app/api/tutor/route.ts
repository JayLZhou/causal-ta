import {boundedText} from '@/lib/body.mjs';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {askTutor} from '@/lib/tutor.mjs';
export const dynamic='force-dynamic';
const runtime=()=>env as typeof env & {OPENAI_API_KEY?:string;CAUSALTA_MODEL?:string};
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(){
 const u=await getChatGPTUser();if(!u)return json({error:'请先登录。'},401);
 const {results}=await env.DB!.prepare('SELECT id,message,reply,"references",created FROM conversations WHERE owner=? ORDER BY created DESC LIMIT 30').bind(u.userId).all();
 return json({enabled:!!(runtime().OPENAI_API_KEY&&runtime().CAUSALTA_MODEL),turns:results.reverse().map((r:any)=>({...r,reply:JSON.parse(r.reply),references:JSON.parse(r.references)}))});
}
export async function POST(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'请求来源无效'},403);
 if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'需要 JSON 请求'},415);
 const u=await getChatGPTUser();if(!u)return json({error:'请先登录。'},401);
 if(!runtime().OPENAI_API_KEY||!runtime().CAUSALTA_MODEL)return json({error:'在线语言模型尚未配置。你仍可使用课程实验与针对性提示。'},503);
 try{
  const raw=await boundedText(req,12000);if(raw.length>12000)return json({error:'问题过长'},413);
  const b=JSON.parse(raw);
  if(b.consent!==true)return json({error:'请确认将问题及选中材料发送给 OpenAI。'},400);
  if(typeof b.message!=='string'||!b.message.trim()||b.message.length>3000)throw Error('问题需要 1–3000 字');
  if(!Array.isArray(b.notes)||b.notes.length>3||!b.notes.every((id:unknown)=>typeof id==='string'&&id.length<=64)||new Set(b.notes).size!==b.notes.length)throw Error('最多选择 3 份材料');
  const notes:any[]=[];
  for(const id of b.notes){const n=await env.DB!.prepare('SELECT id,title,subject,body FROM notes WHERE id=? AND owner=?').bind(id,u.userId).first();if(!n)return json({error:'材料不存在或无权访问'},404);notes.push(n);}
  const count=await env.DB!.prepare('SELECT count(*) AS n FROM conversations WHERE owner=?').bind(u.userId).first<{n:number}>();
  if((count?.n||0)>=100)return json({error:'已保存 100 条对话，请先导出，再删除旧对话。'},429);
  const day=new Date().toISOString().slice(0,10);
  await env.DB!.prepare('DELETE FROM usage WHERE substr(key,-10) < ?').bind(day).run();
  // Atomic counters cap provider attempts, including failures; no automatic paid retry.
  for(const [key,limit] of [[`global:${day}`,100],[`user:${u.userId}:${day}`,20]] as const){
   const r=await env.DB!.prepare('INSERT INTO usage(key,count) VALUES(?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<?').bind(key,limit).run();
   if(!r.meta.changes)return json({error:'今日对话请求已达上限，请明天再试。'},429);
  }
  // Context is independent of quiz sessions: no hidden worlds, answers or grading tools.
  const {results}=await env.DB!.prepare('SELECT message,reply FROM conversations WHERE owner=? ORDER BY created DESC LIMIT 6').bind(u.userId).all();
  const profile=await env.DB!.prepare('SELECT goal FROM profiles WHERE owner=?').bind(u.userId).first<{goal:string}>();
  const reply=await askTutor({model:runtime().CAUSALTA_MODEL!,message:b.message,notes,history:results.reverse(),goal:profile?.goal||''},runtime().OPENAI_API_KEY!);
  const refs=notes.filter(n=>reply.reference_ids.includes(n.id)).map(n=>({id:n.id,title:n.title,excerpt:n.body.slice(0,6000)}));
  await env.DB!.prepare('INSERT INTO conversations(id,owner,message,reply,"references",created) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),u.userId,b.message,JSON.stringify(reply),JSON.stringify(refs),new Date().toISOString()).run();
  return GET();
 }catch(e){const m=e instanceof Error?e.message:'';return json({error:/D1_|SQLITE|database/i.test(m)?'对话暂时无法保存，请稍后重试。':/timeout|abort/i.test(m)?'模型响应超时，请稍后重试。':m||'请求失败。'},400);}
}
export async function DELETE(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'请求来源无效'},403);
 const u=await getChatGPTUser();if(!u)return json({error:'请先登录。'},401);
 await env.DB!.prepare('DELETE FROM conversations WHERE owner=?').bind(u.userId).run();return json({ok:true});
}
