import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {buildRealCategories,originalRealContent,applyLocalContentOverlays} from '../src/local-development/real-content';
import {retainedClassicCatalogue} from '../src/local-development/retained-classic-catalogue';
import {HOSTED_RUNTIME_MARKERS} from '../src/config-policy';
import type {MatchRecord} from '../src/gameplay/types';
import {CATEGORY_PROJECTION_V1,CATEGORY_PROJECTION_V2,CATEGORY_PROJECTION_V3,canonicalCategoryId} from '../src/local-development/category-projection';

const source={path:'fixture',sha256:'a'.repeat(64),capturedAt:'2026-11-16',releaseId:'fixture'};
function fixture(){
 const categories=['tahadani-047','tahadani-games-272','other'].map(id=>({id,labelAr:id==='other'?'أخرى':'عملات'}));
 const questions=categories.flatMap(c=>[200,400,600].flatMap(points=>[0,1].map(i=>({id:`${c.id}-${points}-${i}`,categoryId:c.id,modality:'classic',promptAr:`${c.id} سؤال ${points} ${i}`,canonicalAnswer:`جواب ${i}`,points}))));
 return {schemaVersion:1 as const,source,categories,questions,media:[]};
}
test('new currency category pools both sources, preserving original question identity and content hashes',()=>{
 const data=fixture(),before=JSON.stringify(data),raw=buildRealCategories(data),projected=buildRealCategories(data,CATEGORY_PROJECTION_V1);
 assert.equal(raw.length,3);assert.equal(projected.length,2);
 assert.deepEqual(projected.find(c=>c.key==='other'),raw.find(c=>c.key==='other'));
 const currency=projected.find(c=>c.key==='tahadani-047')!;
 assert.equal(currency.label,'عملات');assert.equal(currency.questions.length,12);
 const original=data.questions.find(q=>q.categoryId==='tahadani-games-272')!;
 const pin=currency.questions.find(q=>q.sourceQuestionId===original.id)!;
 assert.equal(pin.categoryKey,'tahadani-047');
 assert.equal(pin.contentHash,createHash('sha256').update(JSON.stringify(original)).digest('hex'));
 assert.equal(JSON.stringify(data),before);
 assert.equal(canonicalCategoryId('tahadani-games-272'),'tahadani-games-272');
 assert.equal(canonicalCategoryId('tahadani-games-272',CATEGORY_PROJECTION_V1),'tahadani-047');
});
test('projection deduplicates identical playable cards without counting alias supply twice',()=>{
 const data=fixture();const primary=data.questions.filter(q=>q.categoryId==='tahadani-047');
 for(const q of data.questions.filter(q=>q.categoryId==='tahadani-games-272')){const peer=primary.find(p=>p.points===q.points&&p.id.endsWith(q.id.slice(-1)))!;q.promptAr=peer.promptAr;q.canonicalAnswer=peer.canonicalAnswer;}
 assert.equal(buildRealCategories(data,CATEGORY_PROJECTION_V1).find(c=>c.key==='tahadani-047')!.questions.length,6);
 assert.equal(buildRealCategories(data).find(c=>c.key==='tahadani-games-272')!.questions.length,6);
});

test('v2 displays one card per selected pair and preserves physical content and v1 category revisions',()=>{
 const pairs=[['tahadani-068','tahadani-games-046'],['tahadani-004','tahadani-games-022'],['tahadani-005','tahadani-games-011'],['tahadani-028','tahadani-games-455'],['tahadani-029','tahadani-games-458']];
 const categories=pairs.flat().map(id=>({id,labelAr:id}));
 const questions=categories.flatMap(c=>[200,400,600].flatMap(points=>[0,1].map(i=>({id:`${c.id}-${points}-${i}`,categoryId:c.id,modality:'classic',promptAr:`${c.id} سؤال ${points} ${i}`,canonicalAnswer:`جواب ${i}`,points}))));
 const data={schemaVersion:1 as const,source,categories,questions,media:[]},before=JSON.stringify(data),v1=buildRealCategories(data,CATEGORY_PROJECTION_V1),v2=buildRealCategories(data,CATEGORY_PROJECTION_V2);
 assert.equal(v1.length,10);assert.equal(v2.length,5);
 for(const [leader,alias]of pairs){const group=v2.find(c=>c.key===leader)!;assert.equal(group.questions.length,12);assert(group.questions.some(q=>q.sourceQuestionId.startsWith(alias)));assert.equal(v1.find(c=>c.key===alias)!.questions.length,6);}
 assert.deepEqual(buildRealCategories(data,CATEGORY_PROJECTION_V1),v1);
 assert.equal(JSON.stringify(data),before);
});
test('v3 groups round-five pairs while v2 and unversioned pools retain their physical identities',()=>{
 const pairs=[['tahadani-058','tahadani-games-310'],['tahadani-043','tahadani-games-523'],['tahadani-011','tahadani-games-134'],['tahadani-012','tahadani-games-135'],['tahadani-014','tahadani-games-127'],['tahadani-020','tahadani-games-107']];
 const categories=pairs.flat().map(id=>({id,labelAr:id}));
 const questions=categories.flatMap(c=>[200,400,600].flatMap(points=>[0,1].map(i=>({id:`${c.id}-${points}-${i}`,categoryId:c.id,modality:'classic',promptAr:`سؤال ${c.id} ${points} ${i}`,canonicalAnswer:`${c.id}-${i}`,points}))));
 const data={schemaVersion:1 as const,source,categories,questions,media:[]},before=JSON.stringify(data);
 const v3=buildRealCategories(data,CATEGORY_PROJECTION_V3);
 assert.equal(v3.length,6);
 for(const [leader,alias]of pairs){
  const group=v3.find(c=>c.key===leader)!;
  assert.equal(group.questions.length,12);
  assert(group.questions.some(q=>q.sourceQuestionId.startsWith(alias)));
  for(const version of [undefined,CATEGORY_PROJECTION_V1,CATEGORY_PROJECTION_V2]){
   assert.equal(canonicalCategoryId(alias,version),alias);
   assert.equal(buildRealCategories(data,version).length,12);
  }
 }
 assert.equal(JSON.stringify(data),before);
 assert.equal(canonicalCategoryId('tahadani-games-046',CATEGORY_PROJECTION_V3),'tahadani-068');
});

test('legacy current-root and retained-root rematches retain physical pools; cache separates projection versions',()=>{
 const before={...process.env};
 try{
  for(const key of [...HOSTED_RUNTIME_MARKERS,'GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_SERVICE_ACCOUNT_JSON','TAP_SECRET_KEY','MYFATOORAH_API_KEY','PAYMENT_PROVIDER'])delete process.env[key];
  Object.assign(process.env,{NODE_ENV:'test',ALMAIDAN_LOCAL_ONLY:'true',ENTA_RUNTIME_MODE:'local',FIREBASE_PROJECT_ID:'demo-almaidan-local',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:19099',DATABASE_URL:'postgresql://test:fixture@127.0.0.1:15439/almaidan',ALMAIDAN_REAL_CONTENT_PATH:'D:/projects/huroof_wa_oloof/local/almaidan/real-content.json'});
  // These adapters read immutable local files only. No database adapter is constructed.
  const original=originalRealContent();
  const legacy={mode:'CLASSIC',releaseId:original.source.releaseId,releaseRootHash:original.source.sha256} as MatchRecord;
  const current={...legacy,localCategoryProjectionVersion:CATEGORY_PROJECTION_V1};
  const hasAlias=(rows:ReturnType<typeof retainedClassicCatalogue>)=>rows.find(c=>c.key==='tahadani-047')!.questions.some(q=>q.sourceQuestionId.startsWith('t38b2-'));
  assert.equal(hasAlias(retainedClassicCatalogue(legacy)),false);
  assert.equal(hasAlias(retainedClassicCatalogue(current)),true);
  applyLocalContentOverlays([{entity:'category',entityId:'tahadani-047',revisionId:'fixture',payload:{labelAr:'Fixture'}}]);
  assert.equal(hasAlias(retainedClassicCatalogue(legacy)),false);
  assert.equal(hasAlias(retainedClassicCatalogue(current)),true);
  assert.equal(hasAlias(retainedClassicCatalogue(legacy)),false);
 }finally{
  applyLocalContentOverlays([]);
  for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];
  Object.assign(process.env,before);
 }
});
