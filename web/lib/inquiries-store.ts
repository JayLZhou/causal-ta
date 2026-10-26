import {env} from 'cloudflare:workers';
export async function listInquiries(owner:string) {
 const rows=await env.DB!.prepare('SELECT id,state,revision,created,updated FROM inquiries WHERE owner=? ORDER BY updated DESC LIMIT 100').bind(owner).all();
 return rows.results.map((r:any)=>({...JSON.parse(r.state),id:r.id,revision:r.revision,created:r.created,updated:r.updated}));
}
