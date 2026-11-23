import test from 'node:test';
import assert from 'node:assert/strict';
import {kidsCategories,supplementalFormatCategories,selectedSupplementalFormats,supplementalCoverage,SUPPLEMENT_ROOT} from './content-pack';
import {selectLocalQuestions} from './real-content';
import {localCompetitionCatalogue} from './competition-catalogue';
import {selectRoundPins,validateFormatCatalog} from '../rounds/selection';
import type {Exposure,RequestBinding} from '../rounds/types';
import {createLocalEntaService} from './service';
import {emptyOwnerState,type OwnerState} from './store';
import {LOCAL_PROJECT} from './guard';

test('versioned original supplement supplies 24 categories and 432 unique question/prompt pins',()=>{
 assert.match(SUPPLEMENT_ROOT,/^[a-f0-9]{64}$/);const report=supplementalCoverage();assert.equal(report.formats.length,4);
 for(const f of report.formats){assert.equal(f.categories.length,6);assert.ok(f.categories.every(c=>c.count===18));}
 const ids=[...kidsCategories.flatMap(c=>c.questions.map(q=>q.sourceQuestionId)),...supplementalFormatCategories.flatMap(c=>c.prompts.map(p=>p.sourceId))];assert.equal(ids.length,432);assert.equal(new Set(ids).size,432);
 assert.equal(new Set(supplementalFormatCategories.filter(c=>c.format==='DRAWING_TARGET').flatMap(c=>c.prompts.map(p=>p.target))).size,108);
 for(const c of kidsCategories)for(const tier of [200,400,600])assert.equal(c.questions.filter(q=>q.points===tier).length,6);
 validateFormatCatalog(localCompetitionCatalogue().base);
});
test('kids and drawing select three disjoint complete boards for the same category choices',()=>{
 const seen=new Set<string>();for(let n=0;n<3;n++){
 for(const c of kidsCategories){const selected=selectLocalQuestions(c,seen);assert.equal(selected.length,6);for(const q of selected){assert.equal(seen.has(q.sourceQuestionId),false);seen.add(q.sourceQuestionId);}}
 for(const c of selectedSupplementalFormats(seen).filter(c=>c.format==='DRAWING_TARGET')){assert.equal(c.prompts.length,6);for(const p of c.prompts){assert.equal(seen.has(p.sourceId),false);seen.add(p.sourceId);}}
 }assert.equal(seen.size,216);
});
test('actual standalone selector gives three disjoint matches for every list and acting category',()=>{
 const catalog=localCompetitionCatalogue().base;
 for(const c of supplementalFormatCategories.filter(c=>c.format!=='DRAWING_TARGET')){
 const exposures:Exposure[]=[];const seen=new Set<string>();
 for(let n=0;n<3;n++){
 const request={executionFormat:c.format==='LIST_ITEMS'?'STANDALONE_LIST':'STANDALONE_ACTING',setup:{categories:[{key:c.key,promptRefs:[]}]}} as unknown as RequestBinding;
 const result=selectRoundPins(request,catalog,exposures,'1'.repeat(64));assert.equal(result.pins.length,4);
 result.pins.forEach((p,i)=>{assert.equal(seen.has(p.sourceId),false);seen.add(p.sourceId);exposures.push({categoryKey:c.key,...result.intent.selection[i]});});
 }assert.equal(seen.size,12);
 }
});
test('actual mixed selector gives three disjoint six-prompt choices across supplemental formats',()=>{
 const seen=new Set<string>();for(let n=0;n<3;n++){
 const catalog=localCompetitionCatalogue(seen).base;const cats=catalog.categories.filter(c=>c.key.startsWith('authored-')).filter((c,i)=>i%3===0);
 const request={executionFormat:'MIXED_BOARD',setup:{categories:cats.map(c=>({key:c.key,promptRefs:c.format==='DRAWING_TARGET'?[]:c.prompts.slice(0,6).map(p=>p.ref)}))}} as unknown as RequestBinding;
 const result=selectRoundPins(request,catalog,[],'2'.repeat(64));assert.equal(result.pins.length,36);for(const p of result.pins){assert.equal(seen.has(p.sourceId),false);seen.add(p.sourceId);}
 }assert.equal(seen.size,108);
});
test('kids service pins distinct content and local supplement release across three same-category starts',async()=>{
 let state:OwnerState=emptyOwnerState();const service=createLocalEntaService({async transaction(_uid,fn){const next=structuredClone(state);const out=await fn(next);state=structuredClone(next);return out;}});
 const p={projectId:LOCAL_PROJECT,uid:'pack-review',email:'pack@example.test',verifiedAccount:true,anonymous:false};
 assert.equal((await service.kidsCatalog(p)).categories.length,6);const seen=new Set<string>();
 for(const category of kidsCategories)for(let n=0;n<3;n++){
 const {match}=await service.startKids(p,{requestKey:`${category.key}-${n}`,logicalMatchId:`${category.key}-${n}`,setup:{version:3,categoryKeys:[category.key],teams:[{name:'الأول',players:['علي'],lifelines:[]},{name:'الثاني',players:['ريم'],lifelines:[]}],rules:{questionSeconds:30}}});
 const saved=state.matches[match.id];assert.equal(saved.questions.length,6);assert.equal(saved.releaseRootHash,SUPPLEMENT_ROOT);for(const q of saved.questions){assert.equal(seen.has(q.sourceQuestionId),false);seen.add(q.sourceQuestionId);}
 }assert.equal(seen.size,108);
});
test('each six-category supplemental board supports three full actual selector matches',()=>{
 for(const format of ['LIST_ITEMS','ACTING_ITEMS','DRAWING_TARGET']){const seen=new Set<string>();for(let n=0;n<3;n++){
 const catalog=localCompetitionCatalogue(seen).base;const cats=catalog.categories.filter(c=>c.key.startsWith('authored-')&&c.format===format);assert.equal(cats.length,6);
 const request={executionFormat:'MIXED_BOARD',setup:{categories:cats.map(c=>({key:c.key,promptRefs:format==='DRAWING_TARGET'?[]:c.prompts.slice(0,6).map(p=>p.ref)}))}} as unknown as RequestBinding;
 const result=selectRoundPins(request,catalog,[],'3'.repeat(64));assert.equal(result.pins.length,36);for(const p of result.pins){assert.equal(seen.has(p.sourceId),false);seen.add(p.sourceId);}
 }assert.equal(seen.size,108);}
});
