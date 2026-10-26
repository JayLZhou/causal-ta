import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {boundedText} from '@/lib/body.mjs';
import {createInquiry,transition} from '@/lib/learning.mjs';
import {listInquiries} from '@/lib/inquiries-store';
export const dynamic='force-dynamic';
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(req:Request) {
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'请求来源无效'},403);
 if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'需要 JSON 请求'},415);
 const user=await getChatGPTUser();if(!user)return json({error:'请先登录。'},401);
 const db=env.DB!,owner=user.userId,now=new Date().toISOString();
 try {
  const b=JSON.parse(await boundedText(req));let id=b.id;
  if(b.op==='create') {
   if(!Array.isArray(b.notes)||b.notes.length>3||!b.notes.every((n:unknown)=>typeof n==='string'&&n.length<=64)||new Set(b.notes).size!==b.notes.length)throw Error('最多关联 3 份材料');
   const materials=[];
   for(const n of b.notes){const row=await db.prepare('SELECT id,title,subject,body FROM notes WHERE id=? AND owner=?').bind(n,owner).first();if(!row)return json({error:'材料不存在或无权访问'},404);materials.push(row);}
   const state=createInquiry(b,materials,now);id=crypto.randomUUID();
   const saved=await db.prepare('INSERT INTO inquiries(id,owner,state,created,updated) SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM inquiries WHERE owner=?)<100').bind(id,owner,JSON.stringify(state),now,now,owner).run();
   if(!saved.meta.changes)return json({error:'最多保存 100 道题，请先导出和清理旧题'},429);
  } else {
   if(typeof id!=='string'||id.length>64)throw Error('题目编号无效');
   const row=await db.prepare('SELECT state,revision FROM inquiries WHERE id=? AND owner=?').bind(id,owner).first<{state:string;revision:number}>();
   if(!row)return json({error:'题目不存在或无权访问'},404);
   if(row.revision!==b.revision)return json({error:'题目已更新，请刷新后继续；本次输入尚未保存'},409);
   if(b.op==='delete') {
    const deleted=await db.batch([
     db.prepare('DELETE FROM conversations WHERE owner=? AND inquiry_id=? AND EXISTS(SELECT 1 FROM inquiries WHERE id=? AND owner=? AND revision=?)').bind(owner,id,id,owner,row.revision),
     db.prepare('DELETE FROM inquiries WHERE id=? AND owner=? AND revision=?').bind(id,owner,row.revision),
    ]);
    if(!deleted[1].meta.changes)return json({error:'题目已更新，请刷新后重试'},409);
   } else if(b.op==='act') {
    const state=transition(JSON.parse(row.state),b,now);
    const saved=await db.prepare('UPDATE inquiries SET state=?,revision=revision+1,updated=? WHERE id=? AND owner=? AND revision=?').bind(JSON.stringify(state),now,id,owner,row.revision).run();
    if(!saved.meta.changes)return json({error:'题目已在其他页面更新，请刷新后继续'},409);
   } else throw Error('未知操作');
  }
  return json({inquiries:await listInquiries(owner),activeId:id,feedback:b.op==='delete'?'题目及其对话已删除。':'已保存这一步的学习证据。'});
 }catch(e){const m=e instanceof Error?e.message:'保存失败';return json({error:/D1_|SQLITE|database/i.test(m)?'保存暂时失败，请稍后重试。':m},400);}
}
