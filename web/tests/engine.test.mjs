import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {evaluate,worlds,result,start,choices,view,mutate,nextCheck,learner} from '../lib/engine.mjs';
const courses=fs.readdirSync(new URL('../lib/coursepacks/',import.meta.url)).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(fs.readFileSync(new URL('../lib/coursepacks/'+f,import.meta.url))));
for(const c of courses) {
 test(c.id+': all eligible worlds complete and no answer leakage',()=>{
  const eligible=worlds(c).filter(w=>evaluate(c.start_filter??1,{...c.context,...w}));
  for(let i=0;i<eligible.length;i++) {
   const s=start(c,()=>i/eligible.length),v=view(s);
   assert.equal('world' in v,false);assert.equal('answer' in v.check,false);assert.equal('actions' in v.course,false);assert.equal('transfer' in v.course,false);
   assert.throws(()=>mutate(s,{action:'diagnose',values:s.world}));
   while(choices(s).length) {
    const a=choices(s)[0], actual=result(c,s.world,c.actions.find(x=>x.id===a.id));
    mutate(s,{action:'experiment',experiment:a.id,prediction:actual});
    assert(s.candidates.some(w=>JSON.stringify(w)===JSON.stringify(s.world)));
   }
   assert.equal(s.candidates.length,1);
   mutate(s,{action:'diagnose',values:s.world});assert.equal(s.stage,'transfer');
   assert.equal('answer' in view(s).transfer,false);
   assert.throws(()=>mutate(s,{action:'tutor',intent:'hint'}));
   assert.throws(()=>mutate(s,{action:'check',check:c.pedagogy.checks[0].id,answer:0}));
   for(let n=0;n<c.transfer.length;n++) {assert.throws(()=>mutate(s,{action:'transfer',index:n+1,answer:0}));mutate(s,{action:'transfer',index:n,answer:c.transfer[n].answer});}
   assert.equal(s.stage,'complete');assert(s.transferResults.every(r=>r.correct));
   assert.throws(()=>mutate(s,{action:'transfer',index:0,answer:0}));
  }
 });
 test(c.id+': wrong answer triggers targeted follow-up without erasing evidence',()=>{
  const s=start(c,()=>0),q=nextCheck(s),wrong=Number(Object.keys(q.wrong_map)[0]);
  mutate(s,{action:'check',check:q.id,answer:wrong});
  const follow=nextCheck(s);assert.equal(follow.target,q.wrong_map[wrong]);
  mutate(s,{action:'check',check:follow.id,answer:follow.answer});
  assert.equal(learner(s).hypotheses.length,1);assert.equal(learner(s).hypotheses[0].followed,true);
  assert.throws(()=>mutate(s,{action:'check',check:q.id,answer:wrong}));
 });
}
const fixture=JSON.parse(fs.readFileSync(new URL('./python-parity.json',import.meta.url)));
test('all observations and interventions match Python reference engine',()=>{
 let n=0;for(const row of fixture){const c=courses.find(c=>c.id===row.course);assert.equal(evaluate(c.observation,{...c.context,...row.world}),row.observation);for(const [id,expected] of Object.entries(row.results)){assert.equal(result(c,row.world,c.actions.find(a=>a.id===id)),expected);n++;}}assert(n>200);
});
test('invalid numeric predictions and repeated experiments do not change state',()=>{
 const s=start(courses[0]),a=choices(s)[0];
 for(const v of [NaN,Infinity,'1',null,1e9])assert.throws(()=>mutate(s,{action:'experiment',experiment:a.id,prediction:v}));
 assert.equal(s.events.length,0);mutate(s,{action:'experiment',experiment:a.id,prediction:0});
 assert.throws(()=>mutate(s,{action:'experiment',experiment:a.id,prediction:0}));assert.equal(s.events.length,1);
});
