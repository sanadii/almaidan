import test from 'node:test';
import assert from 'node:assert/strict';
import { applyIntent, join, newRoom, normalizeGuess, reconcile } from '../../src/features/imposter/engine.js';
import { project } from '../../src/features/imposter/projection.js';
import { LocalImposterService } from '../../server/imposter-service.js';
import { pack } from '../../functions/src/imposter/pack.js';
import type { Intent, Room } from '../../src/features/imposter/contracts.js';
const select=()=>({word:{category:'اختبار',word:'تفاح',aliases:['تفاحة']},imposter:'b',order:['a','b','c']});
const act=(r:Room,uid:string,body:Record<string,unknown>,now=100)=>applyIntent(r,uid,{requestId:`${uid}-${r.phaseId}-${JSON.stringify(body)}`,phaseId:r.phaseId,...body} as Intent,now,select);
function started(){ let r=newRoom('ABCD','a','أحمد',0); r=join(r,'b','بدر',0); r=join(r,'c','خالد',0); for(const id of ['a','b','c']) r=act(r,id,{type:'ready',ready:true}); return act(r,'a',{type:'start'}); }
test('private roles, timed phases and blind ballots',()=>{ let r=started(); assert.equal(project(r,'a',100).word,'تفاح'); const spy=JSON.stringify(project(r,'b',100)); assert.ok(!spy.includes('تفاح')); assert.ok(!spy.includes('تفاحة')); for(const id of ['a','b','c']) r=act(r,id,{type:'ack'}); for(const id of ['a','b','c','a','b','c']) r=act(r,id,{type:'clue'}); assert.equal(r.phase,'discussion'); r=reconcile(r,r.deadline!); assert.equal(r.phase,'vote'); r=act(r,'a',{type:'vote',target:'b'},r.deadline!-1); r=act(r,'b',{type:'vote',target:'c'},r.deadline!-1); assert.ok(!JSON.stringify(project(r,'c',r.deadline!-1)).includes('votes')); r=reconcile(r,r.deadline!); assert.equal(r.phase,'runoff'); for(const [id,target] of [['a','b'],['b','c'],['c','b']]) r=act(r,id,{type:'vote',target},r.deadline!-1); r=reconcile(r,r.deadline!); assert.equal(r.phase,'guess'); r=act(r,'b',{type:'guess',text:'تفاحة'},r.deadline!-1); assert.equal(r.result?.winner,'imposter'); assert.equal(r.result?.abstentions,1); });
test('deadlines are strict, replay bound, timeout reveal consumes content',()=>{ let r=started(); const phase=r.phaseId; r=reconcile(r,r.deadline!); assert.equal(r.phase,'cancelled'); assert.equal(r.word,undefined); assert.deepEqual(r.used,['تفاح']); assert.throws(()=>applyIntent(r,'a',{requestId:'x',phaseId:phase,type:'ack'},60000,select)); let x=newRoom('ABCD','a','أحمد',0); const i:Intent={type:'ready',ready:true,requestId:'r',phaseId:'0'}; x=applyIntent(x,'a',i,1,select); assert.deepEqual(applyIntent(x,'a',i,2,select),x); assert.throws(()=>applyIntent(x,'a',{...i,ready:false},2,select)); });
test('normalization preserves important distinctions and validates content',()=>{ assert.equal(normalizeGuess('إِ  أ'), 'ا ا'); assert.notEqual(normalizeGuess('ه'),normalizeGuess('ة')); assert.notEqual(normalizeGuess('ي'),normalizeGuess('ى')); assert.equal(pack.length,360); });
test('local capabilities cannot be forged and shared code lookup works',()=>{ const service=new LocalImposterService(':memory:'); const a=service.create('أحمد'); assert.match(a.roomCode,/^D1-[A-F0-9]{8}$/); const b=service.join(a.roomCode,'بدر'); assert.equal(service.resolve(a.roomCode)?.gameKind,'imposter'); assert.equal(b.projection.me,b.uid); assert.throws(()=>service.read(a.roomId,b.token.slice(0,-1)+'x')); assert.throws(()=>service.read(a.roomId,'')); });


test('eight players play two circuits with organizer as imposter and exact timeout catch-up',()=>{ let r=newRoom('ABCD','a','أحمد',0); const ids=['a','b','c','d','e','f','g','h']; for (const id of ids.slice(1)) r=join(r,id,`لاعب${id}`,0); for(const id of ids) r=act(r,id,{type:'ready',ready:true}); const choose=()=>({word:{category:'اختبار',word:'برتقال',aliases:[]},imposter:'a',order:ids}); r=applyIntent(r,'a',{type:'start',requestId:'start',phaseId:r.phaseId},100,choose); assert.equal(project(r,'a',100).role,'imposter'); assert.equal(project(r,'a',100).word,undefined); for(const id of ids) r=act(r,id,{type:'ack'},100); const initial=r.deadline!; r=reconcile(r,initial+15*30000+90000+30000); assert.equal(r.phase,'results'); assert.equal(r.result?.winner,'imposter'); assert.equal(r.result?.abstentions,8); assert.equal(r.clues.length,16); });
test('ballots: wrong accusation, runoff tie, guess timeout, self vote and duplicate vote',()=>{ const voting=()=>{let r=started(); for(const id of ['a','b','c']) r=act(r,id,{type:'ack'}); for(const id of ['a','b','c','a','b','c']) r=act(r,id,{type:'clue'}); return reconcile(r,r.deadline!);}; let r=voting(); assert.throws(()=>act(r,'a',{type:'vote',target:'a'},r.deadline!-1)); r=act(r,'a',{type:'vote',target:'c'},r.deadline!-1); assert.throws(()=>act(r,'a',{type:'vote',target:null},r.deadline!-1)); r=reconcile(r,r.deadline!); assert.equal(r.result?.winner,'imposter'); r=voting(); r=act(r,'a',{type:'vote',target:'b'},r.deadline!-1); r=act(r,'b',{type:'vote',target:'c'},r.deadline!-1); r=reconcile(r,r.deadline!); r=act(r,'a',{type:'vote',target:'b'},r.deadline!-1); r=act(r,'b',{type:'vote',target:'c'},r.deadline!-1); r=reconcile(r,r.deadline!); assert.equal(r.result?.winner,'imposter'); assert.ok(r.result?.runoffTotals); r=voting(); r=act(r,'a',{type:'vote',target:'b'},r.deadline!-1); r=reconcile(r,r.deadline!); assert.equal(r.phase,'guess'); r=reconcile(r,r.deadline!); assert.equal(r.result?.winner,'insiders'); });
test('private revision never changes for another voter; organizer transfers after lease', async()=>{ const {refreshViews}=await import('../../src/features/imposter/projection.js'); let r=started(); for(const id of ['a','b','c']) r=act(r,id,{type:'ack'}); for(const id of ['a','b','c','a','b','c']) r=act(r,id,{type:'clue'}); r=reconcile(r,r.deadline!); refreshViews(r,r.deadline!-1); const prior=project(r,'c',r.deadline!-1).revision; r=act(r,'a',{type:'vote',target:'b'},r.deadline!-1); refreshViews(r,r.deadline!-1); assert.equal(project(r,'c',r.deadline!-1).revision,prior); let presence=newRoom('CODE','a','أحمد',0); presence=join(presence,'b','بدر',1000); presence=act(presence,'b',{type:'heartbeat'},44000); presence=reconcile(presence,45000); assert.equal(presence.organizer,'b'); });
test('eight local members fill room, names unique, settings reset readiness',()=>{ const service=new LocalImposterService(':memory:'); const a=service.create('أحمد'); const members=[a]; for(let i=1;i<8;i++) members.push(service.join(a.roomCode,`لاعب${i}`)); assert.throws(()=>service.join(a.roomCode,'تاسع')); const a0=service.read(a.roomId,a.token).projection; service.intent(a.roomId,a.token,{type:'ready',ready:true,requestId:'r1',phaseId:a0.phaseId}); const updated=service.intent(a.roomId,a.token,{type:'settings',settings:{mode:'typed',pace:'fast',categories:['الفواكه']},requestId:'s1',phaseId:a0.phaseId}); assert.ok('projection' in updated); assert.equal(updated.projection.players.find(p=>p.uid===a.uid)?.ready,false); assert.equal(members.length,8); });

test('replay clears secrets and readiness, preserves settings and consumed word; closed room stays closed',()=>{ let r=started(); r=reconcile(r,r.deadline!); const used=r.used.slice(),settings=structuredClone(r.settings); r=act(r,'a',{type:'replay'},r.deadline ?? 60100); assert.equal(r.phase,'lobby'); assert.deepEqual(r.used,used); assert.deepEqual(r.settings,settings); assert.equal(r.word,undefined); assert.ok(r.players.every(p=>!p.ready)); r=act(r,'a',{type:'close'},60100); assert.equal(r.phase,'closed'); assert.throws(()=>act(r,'a',{type:'cancel'},60100)); assert.throws(()=>join(r,'d','دلال',60100)); });
test('local capability survives server restart', async()=>{ const fs=await import('node:fs'); const os=await import('node:os'); const path=await import('node:path'); const dir=fs.mkdtempSync(path.join(os.tmpdir(),'imposter-test-')); const db=path.join(dir,'rooms.sqlite'); try { const first=new LocalImposterService(db); const created=first.create('أحمد'); first.close(); const next=new LocalImposterService(db); assert.equal(next.read(created.roomId,created.token).projection.me,created.uid); next.close(); } finally { fs.rmSync(dir,{recursive:true,force:true}); } });
test('three and eight player local service rounds complete with persisted deadlines',()=>{ for(const count of [3,8]) { let now=1000; const service=new LocalImposterService(':memory:',()=>now); const members=[service.create('أحمد')]; for(let i=1;i<count;i++) members.push(service.join(members[0].roomCode,`لاعب${i}`)); const id=members[0].roomId; const send=(i:number,type:Record<string,unknown>,n:string)=>{const current=service.read(id,members[i].token).projection; return service.intent(id,members[i].token,{...type,phaseId:current.phaseId,requestId:n} as Intent);}; for(let i=0;i<count;i++) send(i,{type:'ready',ready:true},`ready${i}`); send(0,{type:'start'},'start'); for(let i=0;i<count;i++) send(i,{type:'ack'},`ack${i}`); let snapshot=service.read(id,members[0].token); while(snapshot.projection.phase==='clues') { now=snapshot.projection.deadline!; snapshot=service.read(id,members[0].token); } assert.equal(snapshot.projection.phase,'discussion'); now=snapshot.projection.deadline!; snapshot=service.read(id,members[0].token); assert.equal(snapshot.projection.phase,'vote'); now=snapshot.projection.deadline!; snapshot=service.read(id,members[0].token); assert.equal(snapshot.projection.phase,'results'); assert.equal(snapshot.projection.result?.winner,'imposter'); assert.equal(snapshot.projection.result?.abstentions,count); service.close(); } });
test('server pack entries have version-bound reviewed identities that stay out of projections',()=>{ assert.equal(new Set(pack.map(entry=>entry.id)).size,360); for(const entry of pack) { assert.match(entry.id,/^imposter-v1-[a-f0-9]{24}$/); assert.equal(entry.packVersion,'imposter-starter-v1'); assert.equal(entry.reviewStatus,'agent-reviewed-local'); } const room=started(); room.word=pack[0]; for(const uid of ['a','b','c']) { const snapshot=JSON.stringify(project(room,uid,100)); assert.ok(!snapshot.includes(pack[0].id)); assert.ok(!snapshot.includes('agent-reviewed-local')); assert.ok(!snapshot.includes('imposter-starter-v1')); } });


test('final guess tolerates common spelling variants but not a different word', async()=>{
 const { guessMatches } = await import('../../src/features/imposter/engine.js');
 const word={category:'فواكه',word:'فراولة',aliases:[]};
 assert.equal(guessMatches('فراوله',word),true);
 assert.equal(guessMatches('الفراولة',word),true);
 assert.equal(guessMatches(' فَراولة ',word),true);
 assert.equal(guessMatches('مستشفي',{category:'أماكن',word:'مستشفى',aliases:[]}),true);
 assert.equal(guessMatches('تفاحة',word),false);
 assert.equal(guessMatches('',word),false);
 let r=started(); for(const id of ['a','b','c']) r=act(r,id,{type:'ack'}); for(const id of ['a','b','c','a','b','c']) r=act(r,id,{type:'clue'});
 r=reconcile(r,r.deadline!); for(const id of ['a','c']) r=act(r,id,{type:'vote',target:'b'},r.deadline!-1); r=reconcile(r,r.deadline!);
 assert.equal(r.phase,'guess'); r=act(r,'b',{type:'guess',text:'تفاحه'},r.deadline!-1); assert.equal(r.result?.winner,'imposter');
});

test('a departed player no longer stalls the reveal or burns clue turns; losing the imposter cancels', ()=>{
 const four=()=>{ let r=newRoom('ABCD','a','أحمد',0); for(const [id,name] of [['b','بدر'],['c','خالد'],['d','دانة']]) r=join(r,id,name,0); for(const id of ['a','b','c','d']) r=act(r,id,{type:'ready',ready:true}); return applyIntent(r,'a',{requestId:'start',phaseId:r.phaseId,type:'start'},100,()=>({word:{category:'اختبار',word:'تفاح',aliases:[]},imposter:'b',order:['a','b','c','d']})); };
 let r=four(); for(const id of ['a','b','c']) r=act(r,id,{type:'ack'}); assert.equal(r.phase,'reveal');
 r=act(r,'d',{type:'leave'}); assert.equal(r.phase,'clues','remaining players already acknowledged');
 for(const id of ['a','b','c']) r=act(r,id,{type:'clue'}); assert.equal(r.clues.at(-1)?.uid,'d'); assert.equal(r.clues.at(-1)?.text,null); assert.equal(r.order[r.turn % 4],'a','departed speaker skipped without waiting');
 for(const id of ['a','b','c']) r=act(r,id,{type:'clue'}); assert.equal(r.phase,'discussion');
 r=reconcile(r,r.deadline!); assert.deepEqual(r.candidates,['a','b','c'],'departed players are not vote candidates');
 let s=four(); s=act(s,'b',{type:'leave'}); assert.equal(s.phase,'cancelled'); assert.equal(s.word,undefined); assert.equal(s.imposter,undefined);
 let t=started(); t=act(t,'c',{type:'leave'}); assert.equal(t.phase,'cancelled','fewer than three players cannot continue');
});

test('heartbeats do not accumulate receipts and results keep departed players visible', ()=>{
 let r=started(); for(let i=0;i<20;i++) r=applyIntent(r,'a',{requestId:`hb-${i}`,phaseId:r.phaseId,type:'heartbeat'},100+i,select);
 assert.equal(Object.keys(r.receipts).some(key=>key.startsWith('a:hb-')),false);
 let s=newRoom('ABCD','a','أحمد',0); for(const [id,name] of [['b','بدر'],['c','خالد'],['d','دانة']]) s=join(s,id,name,0); for(const id of ['a','b','c','d']) s=act(s,id,{type:'ready',ready:true});
 s=applyIntent(s,'a',{requestId:'start',phaseId:s.phaseId,type:'start'},100,()=>({word:{category:'اختبار',word:'تفاح',aliases:[]},imposter:'b',order:['a','b','c','d']}));
 for(const id of ['a','b','c','d']) s=act(s,id,{type:'ack'}); for(const id of ['a','b','c','d']) s=act(s,id,{type:'clue'});
 s=act(s,'d',{type:'leave'}); for(const id of ['a','b','c']) s=act(s,id,{type:'clue'}); s=reconcile(s,s.deadline!); s=reconcile(s,s.deadline!);
 assert.equal(s.phase,'results'); assert.ok(project(s,'a',s.deadline ?? 1e9).players.some(player=>player.uid==='d'));
});

test('local service keeps background readers connected and lets a closed tab reclaim its seat by name', ()=>{
 let now=1000; const service=new LocalImposterService(':memory:',()=>now);
 const host=service.create('أحمد'); const guest=service.join(host.roomCode,'بدر');
 now+=40_000; service.read(guest.roomId,guest.token); now+=40_000;
 assert.equal(service.read(host.roomId,host.token).projection.players.find(p=>p.uid===guest.uid)?.connected,true,'an open socket read refreshes the lease');
 now+=50_000; service.read(host.roomId,host.token);
 assert.equal(service.read(host.roomId,host.token).projection.players.find(p=>p.uid===guest.uid)?.connected,false);
 const back=service.join(host.roomCode,'بدر'); assert.equal(back.uid,guest.uid,'same seat reclaimed'); assert.equal(back.projection.players.length,2);
 assert.throws(()=>service.join(host.roomCode,'بدر'),/DUPLICATE_NAME/,'a connected seat cannot be taken over');
 service.close();
});
