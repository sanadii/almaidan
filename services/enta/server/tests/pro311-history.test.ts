import assert from 'node:assert/strict';
import test from 'node:test';
import { issue, type Keyring } from '../src/history-rematch/cursor';
import { readHistoryRematchPage, type TrustedHistoryOwnerContext } from '../src/history-rematch/service';
import type { OneStatementOwnedHistorySource } from '../src/history-rematch/reader';

const now = 1_700_000_000_000;
const owner: TrustedHistoryOwnerContext = { cursor: { namespaceId: 'ns', projectId: 'project', uid: 'user' }, authenticatedOwner: { namespaceId: 'ns', projectId: 'project', uid: 'user' }, session: { namespaceId: 'ns', projectId: 'project', uid: 'user', ownerUid: 'user' } };
const filters = { mode: null, format: null, rules: null, status: null };
const keyring: Keyring = { active: 'k', keys: new Map([['k', { bytes: Buffer.alloc(32, 7), issueUntil: now + 1_000_000, verifyUntil: now + 2_000_000 }]]) };
const upper = { createdAt: '2023-11-14T22:13:22.000Z', id: 'u' }, before = { createdAt: '2023-11-14T22:13:21.000Z', id: 'b' };
function row(a: typeof upper) { return { id: a.id, createdAt: a.createdAt, admissionProtocol: 3, mode: 'CLASSIC', executionFormat: 'TIER_BOARD', retainedRulesProfile: 'enta-classic-3', status: 'ACTIVE', finishedAt: null, teams: [{ name: 'Team A', score: 0 }, { name: 'Team B', score: 0 }], summary: null }; }
const source: OneStatementOwnedHistorySource = { async readOneSnapshot() { return { outcome: 'OK', upper, resolvedUpper: upper, resolvedBefore: before, rows: [], anchorRows: [{ kind: 'upper', row: row(upper) }, { kind: 'before', row: row(before) }] }; } };
test('final continuation cannot return after expiry during the source await', async () => {
 const cursor = issue(owner.cursor, keyring, now, filters, 1, upper, before);
 let call = 0;
 await assert.rejects(readHistoryRematchPage({ cursor, limit: '1' }, { owner, source, keyring, now: () => call++ === 0 ? now : now + 900_000 }), { message: 'INVALID_CURSOR' });
});
test('final continuation fails if its key retires during the source await', async () => {
 const cursor = issue(owner.cursor, keyring, now, filters, 1, upper, before);
 const rotated: Keyring = { active: 'k', keys: new Map(keyring.keys) };
 const retiring: OneStatementOwnedHistorySource = { async readOneSnapshot(window) { (rotated.keys as Map<string, unknown>).delete('k'); return source.readOneSnapshot(window); } };
 await assert.rejects(readHistoryRematchPage({ cursor, limit: '1' }, { owner, source: retiring, keyring: rotated, now: () => now }));
});

test('owned history adapter issues one fixed parameterized query', async () => {
 const { postgresOwnedHistory } = await import('../src/history-rematch/postgres');
 const calls: Array<{sql:string;params:readonly unknown[]}> = [];
 const db = { async query<T>(sql:string, params:readonly unknown[]) { calls.push({sql,params}); return { rows: [{ value: { outcome: 'DATA_UNAVAILABLE' } }] as T[] }; } };
 const adapter = postgresOwnedHistory(db);
 const result = await adapter.readOneSnapshot({ context: owner.cursor, filters, limit: 1, upper: null, before: null });
 assert.equal(result.outcome, 'DATA_UNAVAILABLE');
 assert.equal(calls.length, 1);
 assert.equal(calls[0].sql, 'SELECT public.pro311_enta_history($1,$2,$3,$4::jsonb) AS value');
 assert.deepEqual(calls[0].params.slice(0, 3), ['ns', 'project', 'user']);
});

test('history router terminates unavailable before legacy and applies authentication', async () => {
 const { createHistoryRouter } = await import('../src/history-rematch/history-router');
 const auth = (_req:unknown,_res:unknown,next:()=>void) => next();
 const router = createHistoryRouter(auth as never);
 const stack = (router as unknown as {stack:Array<{route?:{path:string;stack:Array<{handle:Function}>}}>}).stack;
 const route = stack.find(item=>item.route?.path==='/matches/history')?.route;
 assert.ok(route); const handler=route.stack[2].handle;
 let status=0, value:unknown, cache='';
 const response={setHeader:(name:string,v:string)=>{if(name==='cache-control')cache=v;},status:(n:number)=>{status=n;return response;},json:(v:unknown)=>{value=v;return response;}};
 await handler({principal:{uid:'user',projectId:'project',verifiedAccount:true},query:{}},response);
 assert.equal(status,503);assert.deepEqual(value,{error:'HISTORY_UNAVAILABLE'});assert.equal(cache,'no-store');
});

test('PG history uses current policy and preserves BIGINT sequence text', async () => {
 const { createHash } = await import('node:crypto');
 const { createPgHistory } = await import('../src/huroof-pg/history');
 const raw=Buffer.from(JSON.stringify({schema:'huroof-identity-policy-v1',namespace:'ns',projectId:'project',issuer:'https://securetoken.google.com/project',audience:'project',clientProjectId:'project'}));
 const identity={namespace:'ns',clientProjectId:'project',async readActivePolicy(){return {namespace:'ns',revision:'1',hash:createHash('sha256').update(raw).digest('hex'),raw,projectId:'project',issuer:'https://securetoken.google.com/project',audience:{projectId:'project'}};},async verifyToken(){return {aud:'project',iss:'https://securetoken.google.com/project',sub:'user',uid:'user',currentUser:{disabled:false,emailVerified:true,email:'a@example.test'},firebase:{sign_in_provider:'password'}};},async resolveIdentity(){return 'identity';}};
 const calls:Array<{sql:string;params:readonly unknown[]}>=[];
 const db={async query<T>(sql:string,params:readonly unknown[]){calls.push({sql,params});return {rows:[{value:{rows:[{sequence:'9007199254740993',matchId:'match',resultVersion:'1',occurredAt:'2023-11-14T22:13:20.000Z'}],upper:'9007199254740993',hasMore:false}}] as T[]};}};
 const service=createPgHistory(identity,db,{active:'k',keys:new Map([['k',{bytes:Buffer.alloc(32,7),issueUntil:now+1000,verifyUntil:now+1_000_000}]])},()=>now);
 const page=await service.page('token',{limit:1,cursor:null});assert.equal(page.rows[0].sequence,'9007199254740993');assert.equal(calls.length,1);assert.equal(calls[0].params[1],'identity');
});

test('original result projection rejects competitive winner inheritance', async () => {
 const {parseOriginalResult}=await import('../src/history-rematch/result');
 const base={schemaVersion:1,id:'g',physicalProtocol:5,mode:'CLASSIC',executionFormat:'TIER_BOARD',retainedRulesProfile:'enta-competitive-1',reason:'HOST_ENDED',unplayedCount:1,isTie:false,teams:[{name:'Team A',score:100,winner:false},{name:'Team B',score:100,winner:false}]};
 assert.equal(parseOriginalResult(base,'g').teams.length,2);
 assert.throws(()=>parseOriginalResult({...base,teams:[{...base.teams[0],winner:true},base.teams[1]]},'g'));
 assert.throws(()=>parseOriginalResult({...base,id:'other'},'g'));
});

test('actual injected history composition flows through parameterized adapter and reader', async () => {
 const {composeHistory}=await import('../src/history-rematch/history-composition');
 const {createHistoryRouter}=await import('../src/history-rematch/history-router');
 const calls:Array<{sql:string;params:readonly unknown[]}>=[];
 const db={async query<T>(sql:string,params:readonly unknown[]){calls.push({sql,params});return {rows:[{value:{outcome:'OK',upper:null,resolvedUpper:null,resolvedBefore:null,rows:[],anchorRows:[]}}] as T[]};}};
 const handlers=composeHistory(db,'ns','project',keyring,()=>now);
 const router=createHistoryRouter(((_request:unknown,_response:unknown,next:()=>void)=>next()) as never,handlers);
 const route=(router as unknown as {stack:Array<{route?:{path:string;stack:Array<{handle:Function}>}}>}).stack.find(x=>x.route?.path==='/matches/history')!.route!;
 let status=0,output:unknown; const response={setHeader:()=>{},status:(n:number)=>{status=n;return response;},json:(v:unknown)=>{output=v;return response;}};
 await route.stack[2].handle({principal:{uid:'user',projectId:'project',verifiedAccount:true},query:{}},response);
 assert.equal(status,200);assert.deepEqual(output,{registryVersion:1,queryVersion:2,matches:[],nextCursor:null});assert.equal(calls.length,1);assert.equal(calls[0].sql,'SELECT public.pro311_enta_history($1,$2,$3,$4::jsonb) AS value');
});

test('all ten persisted profiles select their fixed route in the real DTO', async () => {
 const {projectMetadata, tuples}=await import('../src/history-rematch/dto');
 for(const [admissionProtocol,mode,executionFormat,retainedRulesProfile,route] of tuples){
  const item={id:'g',admissionProtocol,mode,executionFormat,retainedRulesProfile,status:'ACTIVE',createdAt:'2023-11-14T22:13:20.000Z',finishedAt:null,teams:[{name:'Team A',score:0},{name:'Team B',score:0}],summary:null};
  assert.equal(projectMetadata(item).route,route);
  assert.throws(()=>projectMetadata({...item,retainedRulesProfile:'unapproved'}));
 }
});

test('actual app mounts exact history route before legacy gameplay', async () => {
 const {createApp}=await import('../src/app');
 const app=createApp({config:{environment:'test',firebaseProjectId:'project',namespaceId:'ns',allowDevMocks:false},verifyIdToken:async()=>{throw Error('unused')},identityStore:{async assertDeploymentNamespace(){},async upsertIdentity(){},async getAdminScopes(){return[]}},entaService:{} as never,roundService:{} as never,competitionService:{} as never,mediaReader:{source:'firebase-storage',async read(){throw Error('unused');}}});
 const root=(app as unknown as {_router:{stack:Array<{handle?:{stack?:unknown[]}}>} })._router.stack;
 const paths:string[]=[];
 const visit=(stack:unknown[])=>{for(const raw of stack){const layer=raw as {route?:{path?:string};handle?:{stack?:unknown[]}};if(layer.route?.path)paths.push(layer.route.path);if(layer.handle?.stack)visit(layer.handle.stack);}};
 visit(root);const positions=paths.map((path,index)=>path==='/matches/history'?index:-1).filter(index=>index>=0);assert.equal(positions.length,2);assert.ok(positions[0]<positions[1]);
});


test('actual app auth feeds the injected reader without initializing runtime services', async () => {
 const {createApp}=await import('../src/app');const {composeHistory}=await import('../src/history-rematch/history-composition');
 let sqlCalls=0;const db={async query<T>(_sql:string,_params:readonly unknown[]){sqlCalls++;return {rows:[{value:{outcome:'OK',upper:null,resolvedUpper:null,resolvedBefore:null,rows:[],anchorRows:[]}}] as T[]};}};
 const app=createApp({config:{environment:'test',firebaseProjectId:'project',namespaceId:'ns',allowDevMocks:false},verifyIdToken:async token=>{if(token==='bad')throw Error('invalid');return {aud:'project',iss:'https://securetoken.google.com/project',sub:'user',uid:'user',firebase:{sign_in_provider:token==='anonymous'?'anonymous':'password'},currentUser:{disabled:false,emailVerified:true,email:'u@example.invalid'}};},identityStore:{async assertDeploymentNamespace(){},async upsertIdentity(){},async getAdminScopes(){return[]}},entaService:{} as never,roundService:{} as never,competitionService:{} as never,mediaReader:{source:'firebase-storage',async read(){throw Error('unused');}},historyHandlers:composeHistory(db,'ns','project',keyring,()=>now)});
 type Layer={route?:{path:string;stack:Array<{handle:Function}>};handle?:{stack?:Layer[]}};
 const routes:NonNullable<Layer['route']>[]=[];const visit=(stack:Layer[])=>{for(const l of stack){if(l.route)routes.push(l.route);if(l.handle?.stack)visit(l.handle.stack);}};visit((app as unknown as {_router:{stack:Layer[]}})._router.stack);
 const route=routes.find(r=>r.path==='/matches/history')!;const req={query:{},get:(name:string)=>name==='authorization'?'Bearer token':undefined};let status=0,body:unknown,cache='';const res={setHeader:(n:string,v:string)=>{if(n==='cache-control')cache=v;},status:(v:number)=>{status=v;return res;},json:(v:unknown)=>{body=v;return res;}};
 let advanced=false;route.stack[0].handle(req,res,()=>{});await route.stack[1].handle(req,res,()=>{advanced=true;});assert.equal(advanced,true);await route.stack[2].handle(req,res);assert.equal(status,200);assert.equal(cache,'no-store');assert.equal(sqlCalls,1);assert.deepEqual(body,{registryVersion:1,queryVersion:2,matches:[],nextCursor:null});
 for(const [token,expected] of [['bad',401],['anonymous',403]] as const) { const denied={query:{},get:()=>`Bearer ${token}`};status=0;advanced=false;route.stack[0].handle(denied,res,()=>{});await route.stack[1].handle(denied,res,()=>{advanced=true;});if(advanced)await route.stack[2].handle(denied,res);assert.equal(status,expected);assert.equal(cache,'no-store');assert.equal(sqlCalls,1); }
});

test('PG result capability denies before auth or database access', async () => {
 const {createPgHistory}=await import('../src/huroof-pg/history');let reads=0;
 const identity={namespace:'ns',clientProjectId:'project',async readActivePolicy(){reads++;throw Error('unexpected');},async verifyToken(){reads++;throw Error('unexpected');},async resolveIdentity(){reads++;throw Error('unexpected');}};
 const db={async query<T>(){reads++;return {rows:[] as T[]};}};
 const history=createPgHistory(identity,db,{active:'k',keys:new Map()},()=>now);
 await assert.rejects(history.result('token','match','1'),{message:'RESULT_RESOURCE_UNAVAILABLE'});assert.equal(reads,0);
});

test('PG result SQL draft places unconditional resource denial before artifact read', async () => {
 const {readFile}=await import('node:fs/promises');const sql=await readFile(new URL('../prisma/migrations/20261028000000_pro311_history/migration.sql',import.meta.url),'utf8');
 const start=sql.indexOf('CREATE FUNCTION public.pro311_huroof_result('), end=sql.indexOf('END $$;',start);assert.ok(start>=0&&end>start);
 const body=sql.slice(start,end), guard=body.indexOf("RAISE EXCEPTION 'RESULT_RESOURCE_UNAVAILABLE'");assert.ok(guard>body.indexOf('BEGIN'));for(const marker of ['eng03_03_assert_current','HuroofRawArtifact','int4_crypto.digest','convert_from'])assert.ok(body.indexOf(marker)>guard,marker);assert.ok(!body.includes('262144'));
});

test('both actual result parsers enforce competitive maxima and all ten strict tuples', async () => {
 const {parseOriginalResult:server}=await import('../src/history-rematch/result');const {parseOriginalResult:client}=await import('../../../../src/features/enta/original-result');const {tuples}=await import('../src/history-rematch/dto');
 const readers=[server,client];
 for(const [physicalProtocol,mode,executionFormat,retainedRulesProfile] of tuples){
  const valid={schemaVersion:1,id:'g',physicalProtocol,mode,executionFormat,retainedRulesProfile,reason:physicalProtocol<4?'ALL_QUESTIONS_PLAYED':'ALL_ROUNDS',unplayedCount:0,isTie:false,teams:[{name:'Team A',score:100,winner:true},{name:'Team B',score:0,winner:false}]};
  for(const parse of readers){assert.equal(parse(valid,'g').physicalProtocol,physicalProtocol);for(const value of [String(physicalProtocol),[physicalProtocol],{value:physicalProtocol}])assert.throws(()=>parse({...valid,physicalProtocol:value},'g'));for(const field of ['mode','executionFormat','retainedRulesProfile'] as const){assert.throws(()=>parse({...valid,[field]:[valid[field]]},'g'));assert.throws(()=>parse({...valid,[field]:{value:valid[field]}},'g'));}}
 }
 const base={schemaVersion:1,id:'g',physicalProtocol:5,mode:'CLASSIC',executionFormat:'TIER_BOARD',retainedRulesProfile:'enta-competitive-1',reason:'ALL_ROUNDS',unplayedCount:0,isTie:false,teams:[{name:'Team A',score:100,winner:true},{name:'Team B',score:0,winner:false}]};
 for(const parse of readers){
  assert.doesNotThrow(()=>parse(base,'g'));
  assert.throws(()=>parse({...base,teams:[{...base.teams[0],winner:false},{...base.teams[1],winner:true}]},'g'));
  assert.throws(()=>parse({...base,teams:[base.teams[0],{...base.teams[1],score:100}]},'g'));
  assert.throws(()=>parse({...base,isTie:true,teams:base.teams.map(t=>({...t,winner:false}))},'g'));
  assert.doesNotThrow(()=>parse({...base,isTie:true,teams:base.teams.map(t=>({...t,score:100,winner:false}))},'g'));
  assert.doesNotThrow(()=>parse({...base,reason:'HOST_ENDED',unplayedCount:1,teams:base.teams.map(t=>({...t,score:100,winner:false}))},'g'));
 }
});

test('SQL draft has explicit anchor and native4 round-fault guards before dependent casts/counts', async () => {
 const {readFile}=await import('node:fs/promises');const sql=await readFile(new URL('../prisma/migrations/20261028000000_pro311_history/migration.sql',import.meta.url),'utf8');
 const start=sql.indexOf('CREATE FUNCTION public.pro311_enta_history('), body=sql.slice(start);assert.ok(start>=0);
 const upper=body.indexOf("jsonb_typeof(p_window->'upper'->'createdAt') IS DISTINCT FROM 'string'"),before=body.indexOf("jsonb_typeof(p_window->'before'->'id') IS DISTINCT FROM 'string'"),cast=body.indexOf("::TIMESTAMPTZ AT TIME ZONE 'UTC'");assert.ok(upper>=0&&before>=0&&upper<cast&&before<cast);
 for(const marker of ["jsonb_typeof(rr.\"state\"->'state') IS DISTINCT FROM 'string'","rr.\"state\"->>'id' IS DISTINCT FROM rr.\"id\"","rr.\"state\"->>'questionId' IS DISTINCT FROM rr.\"gameQuestionId\"","rr.\"state\"->'ordinal' IS DISTINCT FROM to_jsonb(rr.\"ordinal\")","rr.\"state\"->'pin' IS DISTINCT FROM rr.\"pin\""]){assert.equal(sql.split(marker).length-1,2,marker);}
});

test('independent native4 round shape examples reject malformed state and identity', () => {
 const fields=['id','questionId','ordinal','pin','state','version','scoringTeamId','turnDeadline','overallDeadline','remainingTurn','remainingOverall','revealed','assignment','consumed','reason'];
 const valid=(x:Record<string,unknown>)=>Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k))&&x.id==='r'&&x.questionId==='q'&&x.ordinal===0&&JSON.stringify(x.pin)===JSON.stringify({format:'LIST_ITEMS'})&&typeof x.state==='string'&&['READY','RUNNING','PAUSED','RESOLVED'].includes(x.state)&&Number.isInteger(x.version)&&typeof x.revealed==='boolean'&&Array.isArray(x.consumed)&&['turnDeadline','overallDeadline','remainingTurn','remainingOverall'].every(k=>x[k]===null||typeof x[k]==='number');
 const row={id:'r',questionId:'q',ordinal:0,pin:{format:'LIST_ITEMS'},state:'RESOLVED',version:1,scoringTeamId:null,turnDeadline:null,overallDeadline:null,remainingTurn:null,remainingOverall:null,revealed:false,assignment:null,consumed:[],reason:null};assert.equal(valid(row),true);
 for(const change of [{state:null},{state:'OTHER'},{id:'foreign'},{id:1},{questionId:'foreign'},{questionId:1},{ordinal:1},{pin:{}},{pin:null},{consumed:null},{revealed:'false'}])assert.equal(valid({...row,...change}),false);
 const missing={...row} as Record<string,unknown>;delete missing.state;assert.equal(valid(missing),false);
});

