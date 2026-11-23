import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContentAdminStore,validateContentDraft} from './content-admin-store';
import {originalRealContent,realContent,applyLocalContentOverlays,realCategories} from './real-content';
import {assertContentAdmin} from './content-admin-identity';
import {LOCAL_PROJECT} from './guard';
test('local content drafts, reviews, concurrent activation, reconnect, restore and immutable original',async()=>{
 const store=createContentAdminStore();await store.initialize();let current:string|null=null;
 const initial=await store.overlays(),row=originalRealContent().questions.find(q=>q.modality==='classic'&&!q.challenge&&!q.media&&!q.answerMedia&&!initial.some(o=>o.entity==='question'&&o.entityId===q.id))!;
 const before=JSON.stringify(row),payload={promptAr:row.promptAr+' (مراجعة محلية)',canonicalAnswer:row.canonicalAnswer,acceptedAnswers:[...new Set([row.canonicalAnswer,...row.acceptedAnswers])],points:200};
 try{
  assert.throws(()=>validateContentDraft('question',row.id,{...payload,media:'external'}),/INVALID_QUESTION_CONTENT/);
  assert.throws(()=>validateContentDraft('question',row.id,{...payload,promptAr:'x'.repeat(2001)}),/INVALID_QUESTION_CONTENT/);
  assert.throws(()=>validateContentDraft('question',row.id,{...payload,promptAr:'unsafe\nline'}),/INVALID_QUESTION_CONTENT/);
  assert.throws(()=>validateContentDraft('question',row.id,{...payload,canonicalAnswer:'<tag>'}),/INVALID_QUESTION_CONTENT/);
  assert.throws(()=>validateContentDraft('category',originalRealContent().categories[0].id,{labelAr:'x'.repeat(101)}),/INVALID_CATEGORY_LABEL/);
  assert.throws(()=>validateContentDraft('question',row.id,{...payload,acceptedAnswers:['incorrect']}),/CANONICAL_ANSWER_REQUIRED/);
  const draft=await store.draft('isolated-test-reviewer',{entity:'question',entityId:row.id,payload});
  await assert.rejects(store.activate('isolated-test-reviewer',draft.id,null),/REVIEW_REQUIRED/);
  await store.review('isolated-test-reviewer',draft.id);
  const other=await store.draft('isolated-test-reviewer',{entity:'question',entityId:row.id,payload:{...payload,promptAr:payload.promptAr+' 2'}});await store.review('isolated-test-reviewer',other.id);
  const results=await Promise.allSettled([store.activate('isolated-test-reviewer',draft.id,null),store.activate('isolated-test-reviewer',other.id,null)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const active=(await store.overlays()).find(o=>o.entityId===row.id)!;current=active.revisionId;
  const reconnect=createContentAdminStore();try{assert.deepEqual(await reconnect.overlays(),await store.overlays());}finally{await reconnect.close();}
  const oldPin=structuredClone(realCategories().flatMap(c=>c.questions).find(q=>q.sourceQuestionId===row.id));
  applyLocalContentOverlays(await store.overlays());assert.notEqual(realContent().source.sha256,originalRealContent().source.sha256);assert.match(realContent().source.releaseId,/^local-overlay-/);
  assert.equal(realContent().questions.find(q=>q.id===row.id)!.promptAr,active.payload.promptAr);assert.equal(JSON.stringify(row),before);
  if(oldPin){assert.notEqual(realCategories().flatMap(c=>c.questions).find(q=>q.sourceQuestionId===row.id)?.contentHash,oldPin.contentHash);assert.equal(oldPin.prompt,JSON.parse(before).promptAr);}
  const revisions=await store.revisions('question',row.id) as any[];assert.equal(revisions.find(r=>r.id===draft.id).payload.promptAr,payload.promptAr);
 }finally{if(current)await store.restoreOriginal('isolated-test-reviewer','question',row.id,current);applyLocalContentOverlays(initial);await store.close();}
});
test('only the separate verified local admin identity is authorized',async()=>{
 const identity=JSON.parse(await readFile('D:/projects/huroof_wa_oloof/local/almaidan/admin-identity.private.json','utf8'));
 const p={projectId:LOCAL_PROJECT,uid:identity.uid,email:identity.email,anonymous:false,verifiedAccount:true};
 await assertContentAdmin(p);await assert.rejects(assertContentAdmin({...p,uid:'existing-player'}),/LOCAL_ADMIN_REQUIRED/);await assert.rejects(assertContentAdmin({...p,verifiedAccount:false}),/LOCAL_ADMIN_REQUIRED/);await assert.rejects(assertContentAdmin({...p,projectId:'production'}),/LOCAL_ADMIN_REQUIRED/);
});
