// Run against the built local Worker only, where headers emulate the trusted Sites gateway.
import assert from 'node:assert/strict';
const base=process.env.TEST_BASE||'http://127.0.0.1:5174';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw Error('Integration tests are local-only');
const a='test-a-'+crypto.randomUUID(),b='test-b-'+crypto.randomUUID();
const request=async(user,body,origin=base)=>{const headers={'Content-Type':'application/json',Origin:origin};if(user){headers['oai-authenticated-user-id']=user;headers['oai-authenticated-user-email']=user+'@example.test';}const r=await fetch(base+'/api/workspace',{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
try {
 assert.equal((await request(null)).status,401);
 const anonymousChat=await fetch(base+'/api/tutor');assert.equal(anonymousChat.status,401);
 const unavailable=await fetch(base+'/api/tutor',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','oai-authenticated-user-id':a,'oai-authenticated-user-email':a+'@example.test'},body:JSON.stringify({message:'Test',notes:[],consent:true})});assert.equal(unavailable.status,503);
 assert.equal((await request(a,{op:'start',course:'linear-functions'},'https://invalid.example')).status,403);
 const d=await request(a,{op:'start',course:'linear-functions'});assert.equal(d.status,200);const s=d.body.sessions[0];
 assert.equal(s.world,undefined);assert.equal(s.course.transfer,undefined);assert.equal(s.check.answer,undefined);
 assert.equal((await request(b)).body.sessions.length,0);
 assert.equal((await request(b,{op:'act',id:s.id,revision:0,action:'tutor',intent:'hint'})).status,404);
 const event={op:'act',id:s.id,revision:0,action:'experiment',experiment:s.actions[0].id,prediction:0};
 const concurrent=await Promise.all([request(a,event),request(a,event)]);
 assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 assert.equal((await request(a,event)).status,409);
 const n=await request(a,{op:'note',title:'Test note',subject:'Algebra',body:'Test evidence'});const note=n.body.notes[0];
 assert.equal((await request(b,{op:'note',id:note.id,title:'No',subject:'No',body:'No'})).status,404);
 await request(b,{op:'delete-note',id:note.id});assert.equal((await request(a)).body.notes[0].body,'Test evidence');
 await request(a,{op:'profile',name:'Test',goal:'Explain evidence'});assert.equal((await request(a)).body.profile.goal,'Explain evidence');
 assert.equal((await request(b)).body.profile.goal,'');
 assert.equal((await request(a,{op:'erase',confirm:'no'})).status,400);
 await request(a,{op:'delete-session',id:s.id});assert.equal((await request(a)).body.sessions.length,0);
 console.log('PASS: anonymous rejection, origin check, hidden-answer boundary, owner isolation, atomic concurrent updates, notes CRUD, profile isolation, deletion');
} finally {await request(a,{op:'erase',confirm:'DELETE'});await request(b,{op:'erase',confirm:'DELETE'});}
