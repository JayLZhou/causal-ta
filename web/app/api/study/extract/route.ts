import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {boundedText} from '@/lib/body.mjs';
import {field} from '@/lib/knowledge.mjs';
import {visionRequest,extractImage} from '@/lib/vision.mjs';
import {reserveQuota} from '@/lib/tutor.mjs';
export const dynamic='force-dynamic';
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(req:Request){
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'请求来源无效'},403);
 if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'需要 JSON 请求'},415);
 const user=await getChatGPTUser();if(!user)return json({error:'请先登录'},401);
 try{
  const b=JSON.parse(await boundedText(req,2850000));if(b.consent!==true)throw Error('需要同意将图片发送给 OpenAI 识别');
  const runtime=env as any,key=b.key?field(b.key,512,'API Key'):runtime.OPENAI_API_KEY,model=b.key?field(b.model,120,'模型名'):runtime.CAUSALTA_MODEL;
  if(!key||!model)return json({error:'请先在「与 TA 学习 → 连接模型」配置支持视觉的模型'},503);
  visionRequest(model,b.image);
  if(!await reserveQuota(env.DB!,user.userId,new Date().toISOString().slice(0,10)))return json({error:'今日模型请求已达上限'},429);
  return json({text:await extractImage(model,b.image,key)});
 }catch(e){return json({error:e instanceof Error?e.message:'识别失败'},400);}
}
