import {studyExport} from '@/lib/study-store';
import {listInquiries} from '@/lib/inquiries-store';
import {boundedText} from '@/lib/body.mjs';
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { courses } from '@/lib/courses';
import { start, view, mutate } from '@/lib/engine.mjs';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const text = (v: unknown, max: number, empty=false) => {
  if(typeof v!=='string'||v.length>max||(!empty&&!v.trim())) throw Error('文本为空或超出长度限制');
  return v.trim();
};
async function workspace(owner: string) {
  const db=env.DB!;
  const [ss,ns,p,cs]=await Promise.all([
    db.prepare('SELECT id, course, state, revision, created, updated FROM sessions WHERE owner=? ORDER BY updated DESC LIMIT 100').bind(owner).all(),
    db.prepare('SELECT id,title,subject,body,updated FROM notes WHERE owner=? ORDER BY updated DESC LIMIT 100').bind(owner).all(),
    db.prepare('SELECT name,goal FROM profiles WHERE owner=?').bind(owner).first(),
    db.prepare('SELECT id,message,reply,"references",created,inquiry_id FROM conversations WHERE owner=? ORDER BY created DESC LIMIT 100').bind(owner).all(),
  ]);
  return {study:await studyExport(owner),inquiries:await listInquiries(owner),conversations:cs.results.map((r:any)=>({...r,reply:JSON.parse(r.reply),references:JSON.parse(r.references)})),sessions:ss.results.map((r:any)=>({id:r.id,revision:r.revision,created:r.created,updated:r.updated,...view(JSON.parse(r.state))})),notes:ns.results,profile:p||{name:'',goal:''}};
}
export async function GET() {
  const user=await getChatGPTUser();if(!user) return json({error:'请先登录，保存你的个人学习记录。'},401);
  try {return json(await workspace(user.userId));} catch {return json({error:'暂时无法读取学习空间，请稍后重试。'},503);}
}
export async function POST(req: Request) {
  const origin=req.headers.get('origin');
  if(!origin||origin!==new URL(req.url).origin) return json({error:'请求来源无效'},403);
  if(!req.headers.get('content-type')?.startsWith('application/json')) return json({error:'需要 JSON 请求'},415);
  const user=await getChatGPTUser();if(!user) return json({error:'登录已过期，请重新登录。'},401);
  const db=env.DB!, owner=user.userId;
  try {
    const raw=await boundedText(req);if(raw.length>65536) return json({error:'内容过大，请限制为 64KB'},413);
    const b=JSON.parse(raw), now=new Date().toISOString(); let feedback='已保存', sessionId;
    if(b.op==='start') {
      if(!Object.hasOwn(courses,b.course)) throw Error('课程不存在');
      const count=await db.prepare('SELECT count(*) AS n FROM sessions WHERE owner=?').bind(owner).first<{n:number}>();
      if((count?.n||0)>=100) throw Error('最多保存 100 次练习，请先导出并删除旧记录');
      sessionId=crypto.randomUUID();
      await db.prepare('INSERT INTO sessions(id,owner,course,state,created,updated) VALUES(?,?,?,?,?,?)')
        .bind(sessionId,owner,b.course,JSON.stringify(start(courses[b.course])),now,now).run();
      feedback='新的探索开始了。先观察，再预测。';
    } else if(b.op==='act') {
      const row=await db.prepare('SELECT state,revision FROM sessions WHERE id=? AND owner=?').bind(text(b.id,64),owner).first<{state:string,revision:number}>();
      if(!row) return json({error:'练习不存在或你没有访问权限'},404);
      if(b.revision!==row.revision) return json({error:'这次练习已在另一个页面更新，请刷新后继续。'},409);
      const state=JSON.parse(row.state);feedback=mutate(state,b);sessionId=b.id;
      const update=await db.prepare('UPDATE sessions SET state=?,updated=?,revision=revision+1 WHERE id=? AND owner=? AND revision=?')
        .bind(JSON.stringify(state),now,b.id,owner,row.revision).run();
      if(update.meta.changes!==1) return json({error:'记录已更新，请刷新后继续。'},409);
    } else if(b.op==='note') {
      const title=text(b.title,120),subject=text(b.subject,80),body=text(b.body,20000,true);
      if(b.id) {
        const update=await db.prepare('UPDATE notes SET title=?,subject=?,body=?,updated=? WHERE id=? AND owner=?').bind(title,subject,body,now,text(b.id,64),owner).run();
        if(!update.meta.changes) return json({error:'笔记不存在'},404);
      } else {
        const count=await db.prepare('SELECT count(*) AS n FROM notes WHERE owner=?').bind(owner).first<{n:number}>();
        if((count?.n||0)>=100) throw Error('最多保存 100 条笔记，请先导出旧笔记');
        await db.prepare('INSERT INTO notes(id,owner,title,subject,body,updated) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),owner,title,subject,body,now).run();
      }
      feedback='笔记已保存到你的学习空间。';
    } else if(b.op==='delete-note'||b.op==='delete-session') {
      const table=b.op==='delete-note'?'notes':'sessions';
      await db.prepare(`DELETE FROM ${table} WHERE id=? AND owner=?`).bind(text(b.id,64),owner).run();feedback='记录已删除。';
    } else if(b.op==='profile') {
      await db.prepare('INSERT INTO profiles(owner,name,goal) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET name=excluded.name,goal=excluded.goal')
        .bind(owner,text(b.name,60,true),text(b.goal,500,true)).run();feedback='学习目标已更新。';
    } else if(b.op==='erase') {
      if(b.confirm!=='DELETE') throw Error('请输入 DELETE 确认删除');
      await db.batch(['study_checks','study_memories','study_turns','study_documents','study_courses','sessions','notes','profiles','conversations','inquiries'].map(t=>db.prepare(`DELETE FROM ${t} WHERE owner=?`).bind(owner)));feedback='你的学习数据已删除。';
    } else throw Error('未知操作');
    return json({...await workspace(owner),feedback,sessionId});
  } catch(e) {
    if(e instanceof SyntaxError) return json({error:'请求格式无效'},400);
    const message=e instanceof Error?e.message:'请求失败';
    if(/D1_|SQLITE|database|binding/i.test(message)) return json({error:'保存暂时失败，请稍后重试；你的输入仍保留在页面。'},503);
    return json({error:message},400);
  }
}
