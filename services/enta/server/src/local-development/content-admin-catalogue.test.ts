import test from 'node:test';
import assert from 'node:assert/strict';
import {adminCategories,adminQuestionPage,authoredAdminCategories,authoredAdminQuestions} from './content-admin-catalogue';
import {SUPPLEMENT_RELEASE,SUPPLEMENT_ROOT} from './content-pack';
import {validateContentDraft} from './content-admin-store';
import {deriveSupplement,currentSupplement} from './supplement-overlay';
import {applyLocalContentOverlays} from './real-content';
import {localCompetitionCatalogue} from './competition-catalogue';
import {kidsCategories,supplementalFormatCategories} from './content-pack';

test('all authored formats have inspectable immutable admin projections',()=>{
 const categories=authoredAdminCategories(),questions=authoredAdminQuestions();assert.equal(categories.length,24);assert.equal(questions.length,432);assert.equal(new Set(questions.map(q=>q.id)).size,432);
 for(const c of categories){assert.equal(c.editable,true);assert.equal(c.releaseId,SUPPLEMENT_RELEASE);assert.equal(c.releaseRootHash,SUPPLEMENT_ROOT);assert.equal(questions.filter(q=>q.categoryId===c.id).length,18);assert.equal(validateContentDraft('category',c.id,{labelAr:'بديل'}).payload.labelAr,'بديل');}
 for(const q of questions){assert.equal(q.editable,true);assert.throws(()=>validateContentDraft('question',q.id,{promptAr:'بديل'}),/INVALID_QUESTION_CONTENT/);assert.ok(q.revisionId);assert.ok(q.contentHash);if(q.format==='DRAWING_TARGET')assert.ok('target'in q&&q.target);if(q.format==='ACTING_ITEMS'||q.format==='LIST_ITEMS')assert.ok('items'in q&&q.items.length);if(q.format==='KIDS')assert.equal('ageBand'in q&&q.ageBand,'7-10');}
});
test('combined admin search and pagination preserve source IDs across the release boundary',()=>{
 const all=adminCategories();assert.equal(all.length,554);assert.equal(new Set(all.map(c=>c.id)).size,554);
 const page=adminQuestionPage('','',115620);assert.equal(page.total,116068);assert.equal(page.questions.length,30);assert.equal(page.questions.filter(q=>q.sourceKind==='saved-release').length,16);assert.equal(page.questions.filter(q=>q.sourceKind==='local-authored').length,14);
 const category=authoredAdminCategories()[0];assert.equal(adminQuestionPage('',category.id).total,18);const question=authoredAdminQuestions()[0];const exact=adminQuestionPage(question.id);assert.ok(exact.questions.some(q=>'id'in q&&q.id===question.id));assert.equal(adminQuestionPage('','',116068).questions.length,0);
});

test('supplemental revisions validate and derive immutable published pins',()=>{
 const kid=kidsCategories[0].questions[0], category=supplementalFormatCategories.find(c=>c.format==='LIST_ITEMS')!, prompt=category.prompts[0];
 const kp={promptAr:'سؤال جديد',canonicalAnswer:'جواب',acceptedAnswers:['بديل','جواب'],points:kid.points};
 const fp={promptAr:'قائمة جديدة',items:prompt.items.map((_,i)=>`عنصر ${i}`)};
 const a=validateContentDraft('question',kid.sourceQuestionId,kp), b=validateContentDraft('question',prompt.sourceId,fp);
 assert.throws(()=>validateContentDraft('question',prompt.sourceId,{...fp,items:[]}),/INVALID_QUESTION_CONTENT/);
 assert.throws(()=>validateContentDraft('question',kid.sourceQuestionId,{...kp,points:kid.points===200?400:200}),/INVALID_QUESTION_CONTENT/);
 const rows=[{...a,revisionId:'revision-a'},{...b,revisionId:'revision-b'}];const changed=deriveSupplement(rows), original=deriveSupplement([]);
 assert.notEqual(changed.root,original.root);assert.equal(original.kids[0].questions[0].prompt,kid.prompt);assert.equal(changed.kids[0].questions[0].prompt,kp.promptAr);assert.equal(changed.kids[0].questions[0].answers[0].text,kp.canonicalAnswer);
 const pin=changed.formats.find(c=>c.key===category.key)!.prompts[0];assert.equal(pin.items[0].text,fp.items[0]);assert.equal(pin.items[0].value,prompt.items[0].value);assert.equal(pin.items[0].id,prompt.items[0].id);assert.notEqual(pin.formatHash,prompt.formatHash);assert.deepEqual(deriveSupplement(rows),changed);
});

test('published supplemental revisions reach current kids and format allocation',()=>{
 const kid=kidsCategories[0].questions[0],category=supplementalFormatCategories.find(c=>c.format==='LIST_ITEMS')!,prompt=category.prompts[0];
 const rows=[{entity:'question' as const,entityId:kid.sourceQuestionId,revisionId:'rev-kid',payload:{promptAr:'جديد',canonicalAnswer:'جواب',acceptedAnswers:['جواب'],points:kid.points}},{entity:'question' as const,entityId:prompt.sourceId,revisionId:'rev-list',payload:{promptAr:'قائمة جديدة',items:prompt.items.map((_,i)=>`عنصر ${i}`)}}];
 try{applyLocalContentOverlays(rows);assert.equal(currentSupplement().kids[0].questions[0].revisionId,'rev-kid');const catalogue=localCompetitionCatalogue();const pin=catalogue.base.categories.find(c=>c.key===category.key)!.prompts.find(q=>q.sourceId===prompt.sourceId)!;assert.equal(pin.prompt,'قائمة جديدة');assert.equal(pin.revisionId,'rev-list');assert.equal(authoredAdminQuestions().find(q=>q.id===kid.sourceQuestionId)!.releaseId,currentSupplement().releaseId);}finally{applyLocalContentOverlays([]);}
});
