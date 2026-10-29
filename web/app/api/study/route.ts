import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {boundedText} from '@/lib/body.mjs';
import {field,chunkDocument,retrieve,recall,checkAnswer,checkReview} from '@/lib/knowledge.mjs';
import {studyState} from '@/lib/study-store';
import {askTutor,reserveQuota} from '@/lib/tutor.mjs';
export const dynamic='force-dynamic';
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
const runtime=()=>env as typeof env & {OPENAI_API_KEY?:string;CAUSALTA_MODEL?:string};
export async function GET(req:Request){
 const u=await getChatGPTUser();if(!u)return json({error:'请登录以保存自己的课程。'},401);
 try{
  const url=new URL(req.url),id=url.searchParams.get('course');
  if(url.searchParams.has('document')){
   const doc=await env.DB!.prepare('SELECT id,title,body FROM study_documents WHERE owner=? AND id=?').bind(u.userId,url.searchParams.get('document')).first();
   return doc?json(doc):json({error:'资料不存在'},404);
  }
  return json({...await studyState(u.userId,id),enabled:!!(runtime().OPENAI_API_KEY&&runtime().CAUSALTA_MODEL)});
 }catch{return json({error:'课程不存在或暂时无法读取。'},404);}
}
export async function POST(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'请求来源无效'},403);
 if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'需要 JSON 请求'},415);
 const u=await getChatGPTUser();if(!u)return json({error:'请先登录。'},401);
 const owner=u.userId,db=env.DB!,now=new Date().toISOString();
 try{
  const b=JSON.parse(await boundedText(req,450000));let id=b.course;let extra:Record<string,unknown>={};
  if(b.op==='create'){
   id=crypto.randomUUID();
   const inserted=await db.prepare('INSERT INTO study_courses(id,owner,title,subject,goal,created,updated) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM study_courses WHERE owner=?)<30').bind(id,owner,field(b.title,120,'课程名'),field(b.subject||'未分类',80,'学科'),field(b.goal||'',500,'目标',true),now,now,owner).run();
   if(!inserted.meta.changes)throw Error('最多创建 30 门课程，请先导出并清理旧课程');
  }else{
   field(id,64,'课程编号');
   const course=await db.prepare('SELECT * FROM study_courses WHERE id=? AND owner=?').bind(id,owner).first<any>();
   if(!course)return json({error:'课程不存在或无权访问'},404);
   if(b.op==='rename'){
    await db.prepare('UPDATE study_courses SET title=?,subject=?,goal=?,updated=? WHERE id=? AND owner=?').bind(field(b.title,120,'课程名'),field(b.subject,80,'学科'),field(b.goal||'',500,'目标',true),now,id,owner).run();
   }else if(b.op==='delete-course'){
    await db.batch(['study_documents','study_turns','study_memories','study_checks'].map(t=>db.prepare(`DELETE FROM ${t} WHERE owner=? AND course_id=?`).bind(owner,id)).concat([db.prepare('DELETE FROM study_courses WHERE owner=? AND id=?').bind(owner,id)]));id=null;
   }else if(b.op==='document'){
    const title=field(b.title,160,'资料标题'),body=field(b.body,100000,'正文'),docId=crypto.randomUUID();
    const chunks=chunkDocument(body,docId,title);
    const saved=await db.prepare('INSERT INTO study_documents(id,owner,course_id,title,body,chunks,created) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM study_courses WHERE owner=? AND id=?) AND (SELECT count(*) FROM study_documents WHERE owner=? AND course_id=?)<30 AND (SELECT COALESCE(SUM(length(body)),0) FROM study_documents WHERE owner=?) + ? <= 2000000').bind(docId,owner,id,title,body,JSON.stringify(chunks),now,owner,id,owner,id,owner,body.length).run();
    if(!saved.meta.changes)throw Error('课程不存在或资料已满（每课 30 份，全账户 200 万字）');
    extra={indexed:chunks.length};
   }else if(b.op==='delete-document'){
    await db.prepare('DELETE FROM study_documents WHERE id=? AND owner=? AND course_id=?').bind(field(b.id,64,'资料编号'),owner,id).run();
   }else if(b.op==='memory'){
    const kind='learner-note',content=field(b.content,3000,'记忆内容');
    if(b.id){
     const saved=await db.prepare("UPDATE study_memories SET content=?,kind='learner-note',evidence='学习者手动修订，未经独立验证',updated=? WHERE id=? AND owner=? AND course_id=?").bind(content,now,field(b.id,64,'记忆编号'),owner,id).run();if(!saved.meta.changes)return json({error:'记忆不存在'},404);
    }else{
     const saved=await db.prepare('INSERT INTO study_memories(id,owner,course_id,kind,content,evidence,updated) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM study_courses WHERE owner=? AND id=?) AND (SELECT count(*) FROM study_memories WHERE owner=? AND course_id=?)<100').bind(crypto.randomUUID(),owner,id,kind,content,'学习者主动记录，未经独立验证',now,owner,id,owner,id).run();if(!saved.meta.changes)throw Error('本课记忆达到 100 条，请整理后继续');
    }
   }else if(b.op==='delete-memory'){
    await db.prepare('DELETE FROM study_memories WHERE id=? AND owner=? AND course_id=?').bind(field(b.id,64,'记忆编号'),owner,id).run();
   }else if(b.op==='check'){
    const state={question:field(b.question,3000,'复测问题'),origin:field(b.origin||'学习者创建',120,'来源'),answer:null,review:null,due:null};
    const saved=await db.prepare('INSERT INTO study_checks(id,owner,course_id,state,created) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM study_courses WHERE owner=? AND id=?) AND (SELECT count(*) FROM study_checks WHERE owner=? AND course_id=?)<100').bind(crypto.randomUUID(),owner,id,JSON.stringify(state),now,owner,id,owner,id).run();if(!saved.meta.changes)throw Error('本课最多保留 100 次复测');
   }else if(b.op==='answer'||b.op==='review'){
    const row=await db.prepare('SELECT state,revision FROM study_checks WHERE id=? AND owner=? AND course_id=?').bind(field(b.id,64,'复测编号'),owner,id).first<any>();
    if(!row)return json({error:'复测不存在'},404);if(row.revision!==b.revision)return json({error:'复测已更新，请刷新'},409);
    const state=b.op==='answer'?checkAnswer(JSON.parse(row.state),b,now):checkReview(JSON.parse(row.state),b,now);
    const writes=[db.prepare('UPDATE study_checks SET state=?,revision=revision+1 WHERE id=? AND owner=? AND revision=?').bind(JSON.stringify(state),b.id,owner,b.revision)];
    // Memory is attached to the immutable answer and explicitly marked as self-assessment.
    if(b.op==='review')writes.unshift(db.prepare('INSERT OR IGNORE INTO study_memories(id,owner,course_id,kind,content,evidence,updated) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM study_checks WHERE id=? AND owner=? AND revision=?)').bind('check:'+b.id,owner,id,'self-check',`${state.question}\n首次作答：${state.answer}\n自评：${({independent:'能够独立解释',partial:'部分理解',retry:'需要重学'} as Record<string,string>)[state.review.rating]}；使用帮助：${state.review.usedHelp?'是':'否'}\n依据：${state.review.basis}`.slice(0,2500),'复测 '+b.id+'；学习者自评，不代表客观掌握',now,b.id,owner,b.revision));
    const saved=await db.batch(writes);if(!saved.at(-1)?.meta.changes)return json({error:'复测已更新，请刷新'},409);
   }else if(b.op==='search'||b.op==='ask'){
    const message=field(b.message,3000,'问题');
    if(!Array.isArray(b.documents)||b.documents.length>30||!b.documents.every((v:unknown)=>typeof v==='string'&&v.length<=64))throw Error('请选择有效资料');
    const all=(await db.prepare('SELECT id,chunks FROM study_documents WHERE owner=? AND course_id=?').bind(owner,id).all()).results as any[];
    if(b.documents.some((doc:string)=>!all.some(d=>d.id===doc)))return json({error:'资料已删除或不属于这门课'},404);
    const sources=retrieve(message,all.filter(d=>b.documents.includes(d.id)).flatMap(d=>JSON.parse(d.chunks)),5);
    if(b.op==='search')return json({sources});
    if(b.consent!==true)throw Error('请同意发送本次学习上下文');
    const pending=await db.prepare('SELECT state FROM study_checks WHERE owner=? AND course_id=?').bind(owner,id).all();
    if(pending.results.some((r:any)=>JSON.parse(r.state).answer===null))throw Error('请先完成独立复测，再继续获得提示');
    const key=b.key?field(b.key,512,'API Key'):runtime().OPENAI_API_KEY;
    const model=b.key?field(b.model,120,'模型名称'):runtime().CAUSALTA_MODEL;
    if(!key||!model)return json({error:'请在「连接模型」中填写本次会话的 OpenAI API Key 和模型名，或由维护者配置服务。资料检索不需要模型。'},503);
    if(!await reserveQuota(db,owner,now.slice(0,10)))return json({error:'今日请求上限已达，请明天继续。'},429);
    const memories=(await db.prepare('SELECT id,kind,content,evidence,updated FROM study_memories WHERE owner=? AND course_id=? ORDER BY updated DESC').bind(owner,id).all()).results;
    const recalled=b.useMemory===false?[]:recall(message,memories,5);
    const history=(await db.prepare('SELECT message,reply FROM study_turns WHERE owner=? AND course_id=? ORDER BY created DESC LIMIT 6').bind(owner,id).all()).results.reverse();
    const reply=await askTutor({model,message,notes:sources.map((s:any)=>({...s,subject:course.subject,body:s.text})),history,goal:course.goal,context:{course:course.title,subject:course.subject,learner_memory:recalled,source_scope:b.documents.length,retrieved_chunks:sources.length}},key);
    const turnId=crypto.randomUUID();
    const saved=await db.prepare('INSERT INTO study_turns(id,owner,course_id,message,reply,sources,memory,created) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM study_courses WHERE id=? AND owner=?) AND NOT EXISTS(SELECT 1 FROM study_checks WHERE owner=? AND course_id=? AND json_extract(state,"$.answer") IS NULL) AND (SELECT count(*) FROM study_turns WHERE owner=? AND course_id=?)<100').bind(turnId,owner,id,message,JSON.stringify(reply),JSON.stringify(sources.filter((s:any)=>reply.reference_ids.includes(s.id))),JSON.stringify(recalled),now,id,owner,owner,id,owner,id).run();
    if(!saved.meta.changes)return json({error:'课程已删除、正在独立复测，或对话达到 100 轮；回复未保存'},409);
    if(reply.hypotheses.length)await db.prepare('INSERT INTO study_memories(id,owner,course_id,kind,content,evidence,updated) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM study_turns WHERE id=? AND owner=?) AND (SELECT count(*) FROM study_memories WHERE owner=? AND course_id=?)<100').bind('turn:'+turnId,owner,id,'hypothesis',('问题：'+message+'\n待验证解释：'+reply.hypotheses.join('；')).slice(0,2500),'TA 建议，尚未证实；对话 '+turnId,now,turnId,owner,owner,id).run();
   }else throw Error('未知操作');
  }
  return json({...await studyState(owner,id),active:id,...extra});
 }catch(e){const m=e instanceof Error?e.message:'';return json({error:/D1_|SQLITE|database/i.test(m)?'数据暂时无法保存，请保留输入并重试。':m||'请求失败'},400);}
}
