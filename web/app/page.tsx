import {env} from 'cloudflare:workers';
import { getChatGPTUser } from './chatgpt-auth';
import { courses } from '@/lib/courses';
import { coursePublic } from '@/lib/engine.mjs';
import Workspace from './workspace';
export const dynamic='force-dynamic';
export default async function Home() {
  const user=await getChatGPTUser();
  return <Workspace user={user?{name:user.fullName||'同学'}:null} courses={Object.values(courses).map(coursePublic)} modelEnabled={!!((env as any).OPENAI_API_KEY&&(env as any).CAUSALTA_MODEL)} />;
}
