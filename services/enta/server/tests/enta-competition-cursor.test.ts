import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { admissionHash, canonicalJson } from '../src/admission/huroof-protocol.cjs';
import { createCompetitionPager, parseCompetitionPageRequest, type PageScope } from '../src/rounds/competition-pages';
import { createCompetitionService } from '../src/rounds/competition-service';
import { fixturePrincipal, fixtureCompetitionGame } from './enta-competition-fixture';
import type { CompetitionRepository } from '../src/rounds/competition-types';
import { fail } from '../src/gameplay/types';
const key = Buffer.alloc(32, 19), pager = createCompetitionPager(key);
const scope: PageScope = { principal: 'owner', project: 'project', gameId: 'game', collection: 'pending', roundId: 'round', effectId: null, purpose: 'OWNER', visibility: 'a'.repeat(64), snapshot: 513 };
const sign = (bytes: Buffer | string) => { const payload = Buffer.from(bytes).toString('base64url'); return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`; };
test('v2 cursor binds every complete scope field and stays202 characters at largest offset', () => {
  const catalog: PageScope = { ...scope, gameId: '\u0001'.repeat(480), collection: 'catalog-categories', roundId: null, snapshot: 'a'.repeat(64) };
  const aligned = Math.floor(Number.MAX_SAFE_INTEGER / 32) * 32, cursor = pager.encode(catalog, aligned);
  assert.equal(cursor.length, 202); assert.equal(pager.offset(catalog, cursor), aligned);
  const decoded = JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url').toString('utf8')); assert.deepEqual(decoded, { offset: aligned, scopeHash: admissionHash(catalog), version: 2 });
  const canvas: PageScope = { ...scope, collection: 'canvas', canvasRevision: 512 }, bound = pager.encode(canvas, 16);
  for (const change of [{ principal: 'foreign' }, { project: 'foreign' }, { gameId: 'foreign' }, { collection: 'feedback' as const }, { roundId: 'foreign' }, { effectId: 'foreign' }, { purpose: 'JUDGE' as const }, { visibility: 'b'.repeat(64) }, { snapshot: 514 }, { canvasRevision: 511 }]) assert.throws(() => pager.offset({ ...canvas, ...change }, bound), /PAGE_SNAPSHOT_RESTART|PAGE_PROOF_UNAVAILABLE/);
  assert.throws(() => createCompetitionPager(Buffer.alloc(32, 20)).offset(canvas, bound), /PAGE_SNAPSHOT_RESTART/);
});
test('valid-MAC malformed/noncanonical wire cannot become an offset', () => {
  const hash = admissionHash(scope), valid = canonicalJson({ version: 2, scopeHash: hash, offset: 64 });
  const invalid = [valid.replace('"offset":64', '"offset":64,"offset":64'), `{"version":2,"scopeHash":"${hash}","offset":64}`, valid.replace('"offset":64', '"offset":6.4e1'), valid.replace('"offset":64', '"offset":-0'), valid.replace('"offset":64', '"offset":1'), valid.replace('"offset":64', '"offset":-64'), valid.replace('"offset":64', '"offset":64.5'), valid.replace('"offset":64', '"offset":9007199254740992'), valid.replace('"version":2', '"version":1'), valid.replace('"scopeHash"', '"scope\\u0048ash"'), valid.replace(hash, hash.toUpperCase()), `{"offset":64,"scopeHash":"${hash}","version":2,"x":null}`, '{"offset":64,"version":2}', 'null', '[]', valid.replace('"offset":64', '"offset":"64"'), valid.replace('"scopeHash":"'+hash+'"', '"scopeHash":null'), valid.replace('{', '{ '), Buffer.from([0xff, 0xfe])];
  for (const bytes of invalid) assert.throws(() => pager.offset(scope, sign(bytes)), /PAGE_SNAPSHOT_RESTART/);
  const token = pager.encode(scope, 64); for (const changed of [token+'x', token+'=', token+'.x', 'x'.repeat(203), token.replace('.', '..'), token.slice(0,-1)+(token.endsWith('a')?'b':'a')]) assert.throws(() => pager.offset(scope, changed), /PAGE_SNAPSHOT_RESTART/);
  const payload = token.split('.')[0], tail = payload.at(-1)!, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  if (payload.length % 4 !== 0) { const changed = payload.slice(0,-1)+alphabet[alphabet.indexOf(tail)^1]; const forged = `${changed}.${createHmac('sha256', key).update(changed).digest('base64url')}`; assert.throws(() => pager.offset(scope, forged), /PAGE_SNAPSHOT_RESTART/); }
});
test('scope closure and total/alignment checks reject before selection', () => {
  assert.equal(pager.offset(scope, null), 0);
  for (const token of ['', undefined, 0, false, {}, []]) {
    assert.throws(() => pager.offset(scope, token as string | null), /PAGE_SNAPSHOT_RESTART/);
    assert.throws(() => parseCompetitionPageRequest({ collection: 'pending', roundId: 'round', effectId: null, snapshot: 513, cursor: token }), /INVALID_PAGE_REQUEST/);
  }
  for (const change of [{ principal: undefined }, { project: null }, { snapshot: NaN }, { roundId: undefined }, { extra: undefined }, { collection: 'unknown' }, { purpose: 1 }]) assert.throws(() => pager.encode({ ...scope, ...change } as PageScope,64), /PAGE_PROOF_UNAVAILABLE/);
  assert.throws(() => pager.encode(null as unknown as PageScope,64), /PAGE_PROOF_UNAVAILABLE/);
  for (const collection of ['pending','feedback','rulings','correction','media','grading','canvas','catalog-categories','catalog-prompts'] as const) {
    const s = { ...scope, collection, ...(collection==='canvas'?{canvasRevision:1}:{}) } as PageScope;
    assert.throws(() => pager.encode(s,1), /PAGE_SNAPSHOT_RESTART/); assert.throws(() => pager.start(s,null,-1), /PAGE_PROOF_UNAVAILABLE/);
  }
  const token=pager.encode(scope,512); assert.throws(()=>pager.start(scope,token,511),/PAGE_PROOF_UNAVAILABLE/);
});
test('native catalog consumer resumes480-byte source marker and rejects total/snapshot drift', async () => {
  const offsets:number[]=[]; let drift:'none'|'total'|'snapshot'='none'; const releaseId='\u0001'.repeat(480), snapshot='b'.repeat(64);
  const tx={ lockWallet:async()=>({identityId:'identity',available:1n,debt:0n}), nativeCatalog:async(_p:unknown,_f:unknown,_c:unknown,_s:unknown,offset:number)=>{offsets.push(offset);return {releaseId,snapshot:offset&&drift==='snapshot'?'c'.repeat(64):snapshot,total:offset&&drift==='total'?34:33,rows:Array.from({length:offset?1:32},(_,n)=>({key:'category_'+(offset+n),label:'فئة',format:'ORDINARY_TIER',prompts:[],cover:null}))};},loadOwner:async()=>{throw Error('WHOLE_GAME_FALLBACK');},catalog:async()=>{throw Error('WHOLE_CATALOG_FALLBACK');} };
  const repository={source:'postgres',projectId:fixturePrincipal.projectId,transaction:async(fn:(t:typeof tx)=>unknown)=>fn(tx)} as unknown as CompetitionRepository;
  const service=createCompetitionService(repository), first=await service.catalog(fixturePrincipal,'MIXED_BOARD'), token=first.catalogPage!.nextCursor!; assert.ok(token.length<=202);
  offsets.length=0; const next=await service.catalogPage(fixturePrincipal,'MIXED_BOARD',{categoryKey:null,snapshot,cursor:token}); assert.deepEqual(offsets,[0,32]); assert.equal(next.complete,true); assert.equal(next.returned,1);
  for(const mode of ['total','snapshot'] as const){drift=mode;await assert.rejects(()=>service.catalogPage(fixturePrincipal,'MIXED_BOARD',{categoryKey:null,snapshot,cursor:token}),/PAGE_SNAPSHOT_RESTART/);}
});
test('native generic page consumer reauthorizes/counts before continuation and restarts drift', async()=>{
  const game=fixtureCompetitionGame(),rid=game.rounds[0].id,calls:string[]=[];let total=512,revision=game.version;
  const tx={nativeScope:async()=>{calls.push('scope');return {gameId:game.id,projectId:fixturePrincipal.projectId,principal:fixturePrincipal.uid,purpose:'OWNER',visibility:'d'.repeat(64),snapshot:revision,roundId:null,roundVersion:null,format:null,itemTotal:0,canvasRevision:null,assignmentGeneration:null,grant:null};},nativePage:async(_p:unknown,_h:unknown,_g:unknown,_q:unknown,offset:number)=>{calls.push('page:'+offset);return {total:offset?total:512,rows:Array.from({length:64},(_,n)=>({id:'row_'+(offset+n)}))};},loadOwner:async()=>{throw Error('WHOLE_GAME_FALLBACK');},loadGrant:async()=>{throw Error('WHOLE_GAME_FALLBACK');}};
  const repository={source:'postgres',projectId:fixturePrincipal.projectId,transaction:async(fn:(t:typeof tx)=>unknown)=>fn(tx)} as unknown as CompetitionRepository;
  const service=createCompetitionService(repository),query={collection:'pending',roundId:rid,effectId:null,snapshot:game.version,cursor:null};const first=await service.page(fixturePrincipal,null,game.id,query);assert.ok(!('restart'in first));const token=first.nextCursor!;
  calls.length=0;const next=await service.page(fixturePrincipal,null,game.id,{...query,cursor:token});assert.ok(!('restart'in next));assert.deepEqual(calls,['scope','page:0','page:64']);
  total=513;await assert.rejects(()=>service.page(fixturePrincipal,null,game.id,{...query,cursor:token}),/PAGE_SNAPSHOT_RESTART/);revision++;calls.length=0;await assert.rejects(()=>service.page(fixturePrincipal,null,game.id,{...query,cursor:token}),/PAGE_SNAPSHOT_RESTART/);assert.deepEqual(calls,['scope']);
});
test('native canvas consumer pages16+1 with fresh owner/actor scope and rejects judge/revoke/drift', async()=>{
  const game=fixtureCompetitionGame(),rid=game.rounds.find(r=>r.pin.format==='DRAWING_TARGET')!.id,grantId='00000000-0000-4000-8000-000000000001',scopeId='00000000-0000-4000-8000-000000000002',calls:string[]=[];
  let role:'OWNER'|'ACTOR'|'JUDGE'='OWNER',revoked=false,drift:'none'|'total'|'visibility'='none';
  const authority=()=>({gameId:game.id,projectId:fixturePrincipal.projectId,principal:role==='OWNER'?fixturePrincipal.uid:grantId,purpose:role,visibility:'e'.repeat(64),snapshot:2,roundId:rid,roundVersion:1,format:role==='JUDGE'?'LIST_ITEMS':'DRAWING_TARGET',itemTotal:role==='JUDGE'?128:0,canvasRevision:role==='JUDGE'?null:17,assignmentGeneration:role==='ACTOR'?1:null,grant:role==='OWNER'?null:{id:grantId,scopeId,roundId:rid,role,generation:1,expiresAt:9007199254740991,revoked:false}});
  const strokes=Array.from({length:17},(_,n)=>({id:'stroke_'+n,color:'#191615',width:2,erase:false,points:[[0,0],[10000,10000]]}));
  const tx={nativeScope:async()=>{calls.push('scope');if(revoked)return fail(403,'GRANT_DENIED');return authority();},locateGrant:async()=>({gameId:game.id}),nativeDisclose:async()=>{calls.push('disclose');if(revoked)return fail(403,'GRANT_DENIED');return {scope:authority(),data:{}};},nativeCanvasPage:async(_p:unknown,_h:unknown,_g:unknown,_r:unknown,_s:unknown,_v:unknown,offset:number)=>{calls.push('canvas:'+offset);return {scope:{...authority(),visibility:offset&&drift==='visibility'?'f'.repeat(64):'e'.repeat(64)},canvasRevision:17,total:offset&&drift==='total'?18:17,rows:strokes.slice(offset,offset+16)};},loadOwner:async()=>{throw Error('WHOLE_GAME_FALLBACK');},loadGrant:async()=>{throw Error('WHOLE_GAME_FALLBACK');}};
  const repository={source:'postgres',projectId:fixturePrincipal.projectId,transaction:async(fn:(t:typeof tx)=>unknown)=>fn(tx)} as unknown as CompetitionRepository,service=createCompetitionService(repository),empty={snapshot:null,revision:null,cursor:null};
  for(const purpose of ['OWNER','ACTOR'] as const){role=purpose;const p=role==='OWNER'?fixturePrincipal:null,token=role==='OWNER'?null:'t'.repeat(43);const first=await service.canvas(p,token,game.id,rid,empty);assert.ok('page'in first);assert.equal(first.page.strokes.length,16);calls.length=0;const last=await service.canvas(p,token,game.id,rid,{snapshot:2,revision:17,cursor:first.page.nextCursor});assert.ok('page'in last);assert.equal(last.page.strokes.length,1);assert.equal(last.page.nextCursor,null);assert.ok(calls.indexOf('scope')<calls.indexOf('canvas:0'));assert.ok(calls.indexOf('canvas:0')<calls.indexOf('canvas:16'));
    for(const mode of ['total','visibility'] as const){drift=mode;await assert.rejects(()=>service.canvas(p,token,game.id,rid,{snapshot:2,revision:17,cursor:first.page.nextCursor}),/PAGE_SNAPSHOT_RESTART/);}drift='none';}
  role='JUDGE';calls.length=0;await assert.rejects(()=>service.canvas(null,'t'.repeat(43),game.id,rid,empty),/CANVAS_DENIED/);assert.ok(!calls.some(c=>c.startsWith('canvas:')));role='ACTOR';revoked=true;await assert.rejects(()=>service.canvas(null,'t'.repeat(43),game.id,rid,empty),/GRANT_DENIED/);
});
