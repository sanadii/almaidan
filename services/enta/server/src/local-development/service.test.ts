import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalEntaService } from './service';
import { emptyOwnerState, type OwnerState } from './store';
import { assertLocalDevelopment, LOCAL_PROJECT } from './guard';
import {kidsCategories} from './content-pack';
import { localCategories } from './catalogue';
const principal={projectId:LOCAL_PROJECT,uid:'owner',email:'owner@example.test',verifiedAccount:true,anonymous:false};
function fixture() {const owners=new Map<string,OwnerState>();return createLocalEntaService({async transaction(uid,work){const draft=JSON.parse(JSON.stringify(owners.get(uid)??emptyOwnerState())) as OwnerState;const value=await work(draft);owners.set(uid,JSON.parse(JSON.stringify(draft)) as OwnerState);return value;}});}
const setup={version:2 as const,categoryKeys:localCategories.map(c=>c.key),teams:[{name:'الفريق الأول',players:['أحمد'],lifelines:[]},{name:'الفريق الثاني',players:['سارة'],lifelines:[]}],rules:{questionSeconds:30}};
test('classic local match preserves answer secrecy, scoring, retries, owner isolation and history',async()=>{
 const service=fixture(),input={requestKey:'start-key-1',logicalMatchId:'match-1',setup};const started=await service.start(principal,input);assert.equal(started.match.tiles.length,36);assert.equal(started.match.currentQuestion,null);
 assert.equal((await service.start(principal,input)).match.id,started.match.id);
 await assert.rejects(service.start(principal,{...input,setup:{...setup,rules:{questionSeconds:40}}}),/IDEMPOTENCY_KEY_CONFLICT/);
 await assert.rejects(service.get({...principal,uid:'other'},started.match.id),/MATCH_NOT_FOUND/);
 const id=started.match.id,q=started.match.tiles[0].id;
 const open={commandId:'command-open',expectedVersion:1,type:'OPEN_QUESTION',questionId:q};
 const opened=await service.command(principal,id,open);assert.equal(opened.match.currentQuestion?.answers,undefined);
 assert.equal((await service.command(principal,id,open)).idempotent,true);
 const revealed=await service.command(principal,id,{commandId:'command-reveal',expectedVersion:2,type:'REVEAL_ANSWER',questionId:q});assert.ok(revealed.match.currentQuestion?.answers?.length);
 const scored=await service.command(principal,id,{commandId:'command-score',expectedVersion:3,type:'ADJUDICATE',questionId:q,ruling:'CORRECT',teamId:started.match.teams[0].id});assert.equal(scored.match.teams[0].score,200);
 const done=await service.command(principal,id,{commandId:'command-finish',expectedVersion:4,type:'FINISH',confirmEarly:true});assert.equal(done.match.phase,'FINISHED');
 assert.equal((await service.history(principal,{})).matches[0].id,id);
 const rematch=await service.rematchSetup(principal,id);const next=await service.rematch(principal,id,{requestKey:'rematch-key',logicalMatchId:'match-2',predecessorVersion:rematch.predecessorVersion,setup:rematch.setup});assert.notEqual(next.match.id,id);
});
test('kids uses one category with six tiles; unverified accounts cannot start',async()=>{const service=fixture();const input={requestKey:'kids-key-1',logicalMatchId:'kids-1',setup:{...setup,version:3,categoryKeys:[kidsCategories[0].key]}};assert.equal((await service.startKids(principal,input)).match.tiles.length,6);await assert.rejects(service.startKids({...principal,verifiedAccount:false},input),/VERIFIED_ACCOUNT_REQUIRED/);});
test('prototype-named idempotency keys survive JSON storage and prevent duplicate matches',async()=>{const service=fixture(),input={requestKey:'__proto__',logicalMatchId:'__proto__',setup};const first=await service.start(principal,input);const replay=await service.start(principal,input);assert.equal(replay.match.id,first.match.id);assert.equal(replay.idempotent,true);await assert.rejects(service.start(principal,{...input,requestKey:'new-key-1'}),/LOGICAL_MATCH_ALREADY_CHARGED/);assert.equal((await service.history(principal,{})).matches.length,1);});
test('local guard rejects hosted execution, remote databases, credentials and wrong emulator',()=>{const env={ALMAIDAN_LOCAL_ONLY:'true',ENTA_RUNTIME_MODE:'local',NODE_ENV:'development',FIREBASE_PROJECT_ID:LOCAL_PROJECT,FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:19099',DATABASE_URL:'postgresql://local:local@127.0.0.1:15439/almaidan'};assert.equal(assertLocalDevelopment(env),env.DATABASE_URL);for(const delta of [{NODE_ENV:'production'},{VERCEL:'1'},{DATABASE_URL:'postgresql://local:local@remote:15439/almaidan'},{DATABASE_URL:env.DATABASE_URL+'?schema=public'},{FIREBASE_AUTH_EMULATOR_HOST:'remote:19099'},{TAP_SECRET_KEY:'forbidden'}])assert.throws(()=>assertLocalDevelopment({...env,...delta}));});
