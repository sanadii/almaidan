import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalStore } from './store';
import { createLocalEntaService } from './service';
import { LOCAL_PROJECT } from './guard';
import { localCategories } from './catalogue';

test('isolated PostgreSQL serializes duplicate starts and commands and persists replay across connections',async()=>{
 const firstStore=createLocalStore();await firstStore.initialize();
 const p={projectId:LOCAL_PROJECT,uid:`qualification-${randomUUID()}`,email:'qualification@example.test',verifiedAccount:true,anonymous:false};
 const input={requestKey:'__proto__',logicalMatchId:'__proto__',setup:{version:2,categoryKeys:localCategories.map(c=>c.key),teams:[{name:'الفريق الأول',players:['أحمد'],lifelines:[]},{name:'الفريق الثاني',players:['سارة'],lifelines:[]}],rules:{questionSeconds:30}}};
 let id='',questionId='';
 try {const service=createLocalEntaService(firstStore);const starts=await Promise.all(Array.from({length:4},()=>service.start(p,input)));assert.equal(new Set(starts.map(s=>s.match.id)).size,1);assert.equal(starts.filter(s=>!s.idempotent).length,1);id=starts[0].match.id;questionId=starts[0].match.tiles[0].id;
 const command={commandId:'concurrent-open',expectedVersion:1,type:'OPEN_QUESTION',questionId};const replies=await Promise.all(Array.from({length:4},()=>service.command(p,id,command)));assert.equal(replies.filter(r=>!r.idempotent).length,1);assert.ok(replies.every(r=>r.match.version===2));
 await assert.rejects(service.get({...p,uid:`other-${randomUUID()}`},id),/MATCH_NOT_FOUND/);
 }finally{await firstStore.close();}
 const reopened=createLocalStore();try{const service=createLocalEntaService(reopened);const retry=await service.start(p,input);assert.equal(retry.match.id,id);assert.equal(retry.idempotent,true);assert.equal(retry.match.version,2);assert.equal(retry.match.currentQuestion?.id,questionId);assert.equal(retry.match.currentQuestion?.answers,undefined);assert.equal((await service.history(p,{})).matches.length,1);}finally{await reopened.close();}
});
