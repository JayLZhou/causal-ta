import {env} from 'cloudflare:workers';
export async function studyExport(owner:string){
 const out:Record<string,unknown>={};for(const table of ['study_courses','study_documents','study_turns','study_memories','study_checks'])out[table]=(await env.DB!.prepare(`SELECT * FROM ${table} WHERE owner=?`).bind(owner).all()).results;return out;
}
export async function studyState(owner:string,id:string|null){
 const db=env.DB!;
 const courses=(await db.prepare('SELECT * FROM study_courses WHERE owner=? ORDER BY updated DESC').bind(owner).all()).results;
 if(!id)return {courses,documents:[],turns:[],memories:[],checks:[]};
 if(!courses.some((c:any)=>c.id===id))throw Error('课程不存在或无权访问');
 const [docs,turns,memories,checks]=await Promise.all([
  db.prepare('SELECT id,title,length(body) AS size,created FROM study_documents WHERE owner=? AND course_id=? ORDER BY created DESC').bind(owner,id).all(),
  db.prepare('SELECT * FROM study_turns WHERE owner=? AND course_id=? ORDER BY created DESC LIMIT 50').bind(owner,id).all(),
  db.prepare('SELECT * FROM study_memories WHERE owner=? AND course_id=? ORDER BY updated DESC').bind(owner,id).all(),
  db.prepare('SELECT * FROM study_checks WHERE owner=? AND course_id=? ORDER BY created DESC').bind(owner,id).all(),
 ]);
 return {courses,documents:docs.results,turns:turns.results.reverse().map((r:any)=>({...r,reply:JSON.parse(r.reply),sources:JSON.parse(r.sources),memory:JSON.parse(r.memory)})),memories:memories.results,checks:checks.results.map((r:any)=>({...r,...JSON.parse(r.state),state:undefined}))};
}
