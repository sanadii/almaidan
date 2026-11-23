import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {localCatalogueCompatibility,COMPATIBILITY_MODES} from './compatibility';
import {applyLocalContentOverlays,realContent} from './real-content';
test('public compatibility matches exhaustive actual engine allocation with all original and authored categories',async()=>{
 const report=JSON.parse(await readFile('D:/projects/huroof_wa_oloof/local/almaidan/enta-allocation-coverage-1793839454866.json','utf8'));
 const metadata=localCatalogueCompatibility();assert.equal(metadata.categories.length,554);assert.equal(new Set(metadata.categories.map(c=>c.id)).size,554);assert.equal(metadata.categories.filter(c=>c.source==='saved-release').length,530);
 const mapping:Record<string,string>={classic:'classic:CLASSIC',kids:'kids:KIDS',roundList:'round:STANDALONE_LIST',roundActing:'round:STANDALONE_ACTING',roundMixed:'round:MIXED_BOARD',competitiveTier:'competitive:TIER_BOARD',competitiveList:'competitive:STANDALONE_LIST',competitiveActing:'competitive:STANDALONE_ACTING',competitiveMixed:'competitive:MIXED_BOARD'};
 for(const mode of COMPATIBILITY_MODES){const ready=metadata.categories.filter(c=>c.modes[mode].ready).map(c=>c.id).sort();if(mode==='drawing'){assert.equal(ready.length,6);continue;}assert.deepEqual(ready,report.rows.filter((r:any)=>r.engine+':'+r.mode===mapping[mode]).map((r:any)=>r.category).sort());}
 for(const c of metadata.categories){assert.deepEqual(Object.keys(c).sort(),['id','label','source','revision','inventory','modes'].sort());for(const mode of COMPATIBILITY_MODES){const state=c.modes[mode];assert.equal(state.reason===null,state.ready);if(state.reason)assert.ok(metadata.reasons[state.reason]);}}
 const serialized=JSON.stringify(metadata);for(const field of ['canonicalAnswer','promptAr','answers','target','token','sourceQuestionId'])assert.equal(serialized.includes('"'+field+'"'),false);
 assert.ok(Buffer.byteLength(serialized)<2*1024*1024);assert.equal(localCatalogueCompatibility(),metadata);
 const original=realContent().categories[0];try{applyLocalContentOverlays([{entity:'category',entityId:original.id,revisionId:'compatibility-test-revision',payload:{labelAr:'اسم اختبار محلي'}}]);const changed=localCatalogueCompatibility();assert.notEqual(changed.revision,metadata.revision);assert.equal(changed.categories.find(c=>c.id===original.id)?.label,'اسم اختبار محلي');}finally{applyLocalContentOverlays([]);}
});
