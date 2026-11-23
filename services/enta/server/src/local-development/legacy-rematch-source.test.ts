import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createLocalEntaService} from './service';
import {emptyOwnerState,type OwnerState} from './store';
import {applyLocalContentOverlays,realCategories,realContent,originalRealContent,type Overlay} from './real-content';
import {archiveContentOverlays} from './content-admin-snapshot';
import {LOCAL_PROJECT} from './guard';
const p={projectId:LOCAL_PROJECT,uid:'local-rematch-'+randomUUID(),email:'rematch@example.test',verifiedAccount:true,anonymous:false};
function fixture(){let state:OwnerState=emptyOwnerState();const service=createLocalEntaService({async transaction(_uid,work){const next=structuredClone(state),result=await work(next);state=next;return result;}});return {service,saved:()=>structuredClone(state)};}
const newKey=()=>randomUUID();
async function begin(service:ReturnType<typeof createLocalEntaService>){const setup={version:2,categoryKeys:realCategories().slice(0,6).map(c=>c.key),teams:[{name:'الفريق الأول',players:['نور'],lifelines:[]},{name:'الفريق الثاني',players:['عمر'],lifelines:[]}],rules:{questionSeconds:60}};const start=await service.start(p,{requestKey:newKey(),logicalMatchId:newKey(),setup});const finished=await service.command(p,start.match.id,{commandId:newKey(),expectedVersion:start.match.version,type:'FINISH',confirmEarly:true});return {id:start.match.id,version:finished.match.version,setup:{...setup,version:3}};}
test('classic rematch retains the original release after an active overlay changes the same category ID',async()=>{
 applyLocalContentOverlays([]);const {service,saved}=fixture(),parent=await begin(service),before=saved().matches[parent.id];
 const overlay:Overlay[]=[{entity:'category',entityId:parent.setup.categoryKeys[0],revisionId:newKey(),payload:{labelAr:'فئة المراجعة المحلية'}}];
 applyLocalContentOverlays(overlay);assert.notEqual(realContent().source.sha256,before.releaseRootHash);
 try{const body={requestKey:newKey(),logicalMatchId:newKey(),predecessorVersion:parent.version,setup:parent.setup},next=await service.rematch(p,parent.id,body),after=saved().matches[next.match.id];assert.equal(after.releaseId,before.releaseId);assert.equal(after.releaseRootHash,before.releaseRootHash);assert.deepEqual(after.categories,before.categories);assert.deepEqual(saved().matches[parent.id],before);assert.equal((await service.rematch(p,parent.id,body)).match.id,next.match.id);assert.equal(realContent().source.releaseId.startsWith('local-overlay-'),true);}finally{applyLocalContentOverlays([]);}
});
test('archived overlay is reconstructed exactly without replacing the active head; unknown roots reject without creating a game',async()=>{
 applyLocalContentOverlays([]);const category=realCategories()[0],rows:Overlay[]=[{entity:'category',entityId:category.key,revisionId:newKey(),payload:{labelAr:'نسخة محفوظة للاختبار'}}];await archiveContentOverlays(rows);applyLocalContentOverlays(rows);
 const {service,saved}=fixture(),parent=await begin(service),before=saved().matches[parent.id];applyLocalContentOverlays([]);
 const body={requestKey:newKey(),logicalMatchId:newKey(),predecessorVersion:parent.version,setup:parent.setup};const next=await service.rematch(p,parent.id,body),after=saved().matches[next.match.id];assert.equal(after.releaseId,before.releaseId);assert.equal(after.releaseRootHash,before.releaseRootHash);assert.equal(after.categories[0].label,'نسخة محفوظة للاختبار');assert.equal(realContent().source.sha256,originalRealContent().source.sha256);assert.deepEqual(saved().matches[parent.id],before);
 const unknown=structuredClone(before);unknown.releaseRootHash='f'.repeat(64);const badState=emptyOwnerState();badState.matches[unknown.id]=unknown;const bad=createLocalEntaService({async transaction(_uid,work){return work(badState);}});
 await assert.rejects(bad.rematch(p,unknown.id,{...body,requestKey:newKey(),logicalMatchId:newKey()}),/REMATCH_SOURCE_UNAVAILABLE/);assert.equal(Object.keys(badState.matches).length,1);assert.equal(Object.keys(badState.starts).length,0);
});
