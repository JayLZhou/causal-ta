import test from 'node:test';
import assert from 'node:assert/strict';
import {chunkDocument,retrieve,recall,checkAnswer,checkReview} from '../lib/knowledge.mjs';
import {tutorRequest} from '../lib/tutor.mjs';
import {visionRequest,extractImage} from '../lib/vision.mjs';
test('retrieval finds evidence beyond the former 6000-character cutoff, preserving pages',()=>{
 const chunks=chunkDocument('[第 1 页]\n'+('unrelated '.repeat(800))+'\n[第 8 页]\nThe Treaty of Versailles was signed in 1919.','doc','History');
 const result=retrieve('Treaty Versailles',chunks);assert.equal(result[0].page,8);assert.match(result[0].text,/1919/);assert.equal(result[0].document_id,'doc');
 assert.ok(chunks.every(c=>c.text.length<=1200));assert.deepEqual(retrieve('photosynthesis',chunks),[]);
});
test('Chinese retrieval and course-bounded recall keep evidence provenance',()=>{
 const docs=[...chunkDocument('光合作用将光能转化为化学能。','biology','生物'),...chunkDocument('供给与需求决定价格的变化。','econ','经济')];
 assert.equal(retrieve('光合作用',docs)[0].document_id,'biology');
 const memory=[{id:'a',kind:'hypothesis',content:'光合作用中混淆能量来源',evidence:'TA 猜测',updated:'today'},{id:'b',kind:'self-check',content:'供给需求',evidence:'自评'}];
 const r=recall('光合作用',memory);assert.equal(r[0].id,'a');assert.equal(r[0].evidence,'TA 猜测');assert.equal(r[0].kind,'hypothesis');assert.deepEqual(recall('unrelated',memory),[]);
});
test('first answer is immutable and self-assessment never turns into objective mastery',()=>{
 const state={question:'Explain a historical source',answer:null,review:null};const answered=checkAnswer(state,{answer:'My first explanation'},'2026-10-29T00:00:00Z');
 assert.throws(()=>checkAnswer(answered,{answer:'overwrite'},'now'));assert.throws(()=>checkReview(state,{rating:'independent',usedHelp:false,basis:'source'},'now'));
 const reviewed=checkReview(answered,{rating:'independent',usedHelp:true,basis:'source p4'},'2026-10-29T00:00:00Z');assert.equal(reviewed.due,'2026-10-30T00:00:00.000Z');assert.equal(reviewed.answer,'My first explanation');assert.equal(reviewed.mastered,undefined);
});
test('retrieved chunks and labelled memory reach the model without pretending to prove causality',()=>{
 const r=tutorRequest({model:'mock',message:'why',notes:[{id:'doc:8',body:'Evidence',page:8,ordinal:9}],history:[],goal:'History',context:{learner_memory:[{kind:'hypothesis',content:'tentative'}]}});
 const c=JSON.parse(r.input[0].content);assert.equal(c.selected_materials[0].page,8);assert.equal(c.current_inquiry.learner_memory[0].kind,'hypothesis');assert.match(r.instructions,/any academic discipline/);assert.match(r.instructions,/fallible/);
});
test('vision accepts inline supported images, rejects external URLs and hides provider secrets',async()=>{
 assert.throws(()=>visionRequest('mock','https://example.com/image.png'));assert.throws(()=>visionRequest('mock','data:image/svg+xml;base64,abcd'));
 const r=visionRequest('mock','data:image/png;base64,aGVsbG8=');assert.equal(r.store,false);assert.equal(r.input[0].content[1].type,'input_image');
 await assert.rejects(extractImage('mock','data:image/png;base64,aGVsbG8=','secret',async()=>new Response('secret',{status:400})),e=>!e.message.includes('secret'));
});
