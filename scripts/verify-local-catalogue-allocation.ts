import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadLocalReleaseQuestionSource,localRealChallengeDefinitions,localMediaEntry} from '../server/local-release-question-source.js';
import {ChallengeDefinitionRepository} from '../server/challenge-definition-repository.js';
import {createCategoryQuestionSelection,selectCategoryQuestion,createMatchQuestionSelection,selectMatchQuestion} from '../src/features/game/runtime/question-selector.js';
import {createChallengeCategoryQuestionSelection,selectChallengeCategoryQuestion} from '../src/features/game/runtime/challenge-question-selector.js';

async function main(){
 const source=await loadLocalReleaseQuestionSource([]),questions=source.questions;
 const groups=new Map(source.inventory.categories.map(c=>[c.id,questions.filter(q=>q.categoryId===c.id)]));
 const ready=source.inventory.categories.filter(c=>c.categoryGameEligible);
 const report:any={snapshotId:source.snapshotId,sourceCategories:source.inventory.categories.length,sourceQuestions:questions.length,advertised:ready.length,categories:[],pairChecks:0,pairFailures:[],challengeChecks:[],mediaBindings:0};
 for(const c of source.inventory.categories){
  const rows=groups.get(c.id)!;if(!c.categoryGameEligible){report.categories.push({id:c.id,label:c.labelAr,advertised:false,questions:rows.length,reason:c.unavailableReason});continue;}
  const anchor=ready.find(a=>a.id!==c.id&&!groups.get(a.id)!.some(q=>'challenge' in q && !!q.challenge))!;
  const pool=[...rows,...groups.get(anchor.id)!],ids=[c.id,anchor.id];const failures:string[]=[];
  for(const seed of [1,17,129])try{let selection=createCategoryQuestionSelection(pool,{categories:ids,modality:'classic',seed});for(let n=0;n<14;n++)for(const id of ids)selection=selectCategoryQuestion(pool,selection,id).selection;}catch(e){failures.push(String(e));}
  report.categories.push({id:c.id,label:c.labelAr,advertised:true,questions:rows.length,anchor:anchor.id,seeds:3,allocatedPerSeed:28,failures});
 }
 // Pair checks use one representative per concept: selector allocation depends on these exact IDs,
 // not question multiplicity. Full-record selection/consumption above is tested separately.
 const reps=new Map(ready.map(c=>[c.id,[...new Map(groups.get(c.id)!.map(q=>[q.answerConceptId,q])).values()]]));
 for(let i=0;i<ready.length;i++){for(let j=i+1;j<ready.length;j++){
  const a=ready[i].id,b=ready[j].id;try{createCategoryQuestionSelection([...reps.get(a)!,...reps.get(b)!],{categories:[a,b],modality:'classic',seed:1});}catch(e){report.pairFailures.push({categories:[a,b],error:String(e)});}report.pairChecks++;
 }if(i%50===0)console.log(JSON.stringify({categoriesChecked:i,pairChecks:report.pairChecks}));}
 const definitions=new ChallengeDefinitionRepository(await localRealChallengeDefinitions());
 for(const q of questions)if('challenge' in q && q.challenge)definitions.resolveBound(q as Parameters<ChallengeDefinitionRepository['resolveBound']>[0]);
 for(const c of ready.filter(c=>groups.get(c.id)!.some(q=>'challenge' in q && !!q.challenge))){const anchor=ready.find(a=>a.id!==c.id&&!groups.get(a.id)!.some(q=>'challenge' in q && !!q.challenge))!;const ids=[c.id,anchor.id],pool=[...groups.get(c.id)!,...groups.get(anchor.id)!];
 const boardSlots=Array.from({length:25},(_,i)=>({slotId:`board-${i}`,categoryId:ids[i%2]})),reserveSlots=ids.map(id=>({slotId:`reserve-${id}`,categoryId:id})),slots=[...boardSlots,...reserveSlots];
 try{let selection=createChallengeCategoryQuestionSelection(pool as any,{categories:ids,modality:'classic',seed:1},{boardSlots,reserveSlots});for(let i=0;i<slots.length;i++)selection=selectChallengeCategoryQuestion(pool as any,selection,slots[i],slots.slice(i+1)).selection;report.challengeChecks.push({category:c.id,slots:slots.length,passed:true});}catch(e){report.challengeChecks.push({category:c.id,passed:false,error:String(e)});}
 }
 const recommended=source.inventory.recommendedHuroofCategoryIds ?? [];
 try{let selection=createMatchQuestionSelection(questions,{categories:recommended,modality:'classic',seed:1});const letters=Object.keys(selection.queues);for(let i=0;i<3;i++)for(const letter of letters)selection=selectMatchQuestion(questions,selection,letter).selection;report.huroof={recommended,letters:letters.length,allocated:selection.consumedQuestionIds.length,passed:true};}catch(e){report.huroof={recommended,passed:false,error:String(e)};}
 const media=JSON.parse(await readFile('D:/projects/huroof_wa_oloof/local/almaidan/media-index.json','utf8'));
 for(const entry of media.entries){const bytes=await readFile(entry.path);if(bytes.length!==entry.byteSize||createHash('sha256').update(bytes).digest('hex')!==entry.assetSha256)throw Error(`MEDIA_MISMATCH:${entry.mediaId}`);if(!await localMediaEntry(entry.mediaId,entry.assetSha256))throw Error('MEDIA_BINDING_MISSING');report.mediaBindings++;}
 report.passed=report.categories.every((c:any)=>!c.failures?.length)&&!report.pairFailures.length&&report.challengeChecks.every((c:any)=>c.passed)&&report.huroof.passed;
 const path=`D:/projects/huroof_wa_oloof/local/almaidan/catalogue-allocation-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({path,passed:report.passed,advertised:ready.length,pairs:report.pairChecks,pairFailures:report.pairFailures.length,categoryFailures:report.categories.filter((c:any)=>c.failures?.length),challenges:report.challengeChecks,huroof:report.huroof,media:report.mediaBindings}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
