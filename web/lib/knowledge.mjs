// Bounded, bilingual lexical RAG. No embedding or inferred mastery claims.
export function field(value,max,label,optional=false){
 if(typeof value!=='string'||value.length>max||(!optional&&!value.trim()))throw Error(`${label}不能为空或超过 ${max} 字`);
 return value.trim();
}
export function tokenize(value){
 const s=value.toLowerCase().normalize('NFKC');
 const words=s.match(/[a-z0-9_]+/g)||[];
 for(const run of s.match(/[\p{Script=Han}]+/gu)||[])for(let i=0;i<run.length;i++)words.push(run.slice(i,i+2));
 return words;
}
export function chunkDocument(body,id,title){
 field(body,100000,'材料正文');
 const sections=body.split(/(?=\[第 \d+ 页\])/),chunks=[];let page=null,offset=0;
 for(const section of sections){
  const m=section.match(/^\[第 (\d+) 页\]/);if(m)page=Number(m[1]);
  for(let start=0;start<section.length;start+=1000){
   const text=section.slice(start,start+1200).trim();if(!text)continue;
   chunks.push({id:`${id}:${chunks.length+1}`,document_id:id,title,page,ordinal:chunks.length+1,offset:offset+start,text});
   if(start+1200>=section.length)break;
  }offset+=section.length;
 }
 return chunks;
}
export function retrieve(query,chunks,limit=5){
 const terms=[...new Set(tokenize(query))].slice(0,160);if(!terms.length||!chunks.length)return [];
 const wanted=new Set(terms);
 const corpus=chunks.map(c=>{const ts=tokenize(c.text+' '+c.title);const f=new Map();for(const t of ts)if(wanted.has(t))f.set(t,(f.get(t)||0)+1);return {c,f,len:ts.length};});
 const avg=corpus.reduce((n,c)=>n+c.len,0)/corpus.length||1;
 const df=new Map(terms.map(t=>[t,corpus.filter(c=>c.f.has(t)).length]));
 return corpus.map(({c,f,len})=>({ ...c,score:terms.reduce((score,t)=>{
  const tf=f.get(t)||0;if(!tf)return score;const idf=Math.log(1+(corpus.length-df.get(t)+.5)/(df.get(t)+.5));
  return score+idf*(tf*2.2)/(tf+1.2*(.25+.75*len/avg));
 },0)})).filter(c=>c.score>0).sort((a,b)=>b.score-a.score||a.ordinal-b.ordinal).slice(0,limit);
}
export function recall(query,memories,limit=5){
 const ranked=retrieve(query,memories.map((m,i)=>({...m,title:m.kind,text:m.content,ordinal:i})),limit);
 return ranked.map(m=>({id:m.id,kind:m.kind,content:m.content,evidence:m.evidence,updated:m.updated}));
}
export function checkAnswer(state,input,now){
 if(state.answer!==null)throw Error('首次作答已经保存，不能覆盖');
 return {...state,answer:field(input.answer,6000,'独立回答'),answered:now};
}
export function checkReview(state,input,now){
 if(state.answer===null)throw Error('请先独立作答');if(state.review)throw Error('核查已保存，请创建新的复测');
 if(!['independent','partial','retry'].includes(input.rating))throw Error('请选择核查结果');
 if(typeof input.usedHelp!=='boolean')throw Error('请记录是否使用帮助');
 return {...state,review:{rating:input.rating,usedHelp:input.usedHelp,basis:field(input.basis,3000,'核查依据'),at:now},due:new Date(Date.parse(now)+(input.rating==='independent'&&!input.usedHelp?7:1)*86400000).toISOString()};
}
