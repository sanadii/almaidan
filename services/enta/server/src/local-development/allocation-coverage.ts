import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {admissionHash} from '../admission/huroof-protocol.cjs';
import {assertLocalDevelopment} from './guard';
import {realContent,realCategories,selectLocalQuestions} from './real-content';
import {kidsCategories,SUPPLEMENT_ROOT} from './content-pack';
import {localCompetitionCatalogue} from './competition-catalogue';
import {selectRoundPins} from '../rounds/selection';
import {selectCompetition} from '../rounds/competition-selection';
import type {RequestBinding,PromptPin} from '../rounds/types';
import type {CompetitionRequest} from '../rounds/competition-types';
async function main(){
assertLocalDevelopment();
const catalogue=localCompetitionCatalogue(),rows:any[]=[],failures:any[]=[];
function record(engine:string,mode:string,category:string,work:()=>PromptPin[]|any[]){try{const pins=work();assert.equal(new Set(pins.map(p=>p.sourceId??p.sourceQuestionId)).size,pins.length);rows.push({engine,mode,category,count:pins.length,pinsHash:admissionHash(pins.map(p=>[p.sourceId??p.sourceQuestionId,p.hash??p.contentHash]))});}catch(error){failures.push({engine,mode,category,error:error instanceof Error?error.message:String(error)});}}
for(const c of realCategories())record('classic','CLASSIC',c.key,()=>{const pins=selectLocalQuestions(c,new Set(),true);for(const points of [200,400,600])assert.equal(pins.filter(p=>p.points===points).length,2);const groups=pins.flatMap(p=>p.localGroups);assert.equal(new Set(groups).size,groups.length);return pins;});
for(const c of kidsCategories)record('kids','KIDS',c.key,()=>selectLocalQuestions(c,new Set(),true));
const teams=[{name:'الفريق الأول',players:['أ','ب']},{name:'الفريق الثاني',players:['ج','د']}];
for(const engine of ['round','competitive'])for(const mode of engine==='round'?['MIXED_BOARD','STANDALONE_LIST','STANDALONE_ACTING']:['TIER_BOARD','MIXED_BOARD','STANDALONE_LIST','STANDALONE_ACTING']){
 const standalone=mode.startsWith('STANDALONE'),eligible=catalogue.base.categories.filter(c=>mode==='TIER_BOARD'?c.format==='ORDINARY_TIER':mode==='STANDALONE_LIST'?c.format==='LIST_ITEMS':mode==='STANDALONE_ACTING'?c.format==='ACTING_ITEMS':true);
 for(let i=0;i<eligible.length;i+=standalone?1:6){const batch=eligible.slice(i,i+(standalone?1:6));if(!standalone)for(const c of eligible)if(batch.length<6&&!batch.some(b=>b.key===c.key))batch.push(c);
  const categories=batch.map(c=>({key:c.key,promptRefs:!standalone&&['LIST_ITEMS','ACTING_ITEMS'].includes(c.format)?c.prompts.slice(0,6).map(p=>p.ref):[]}));
  const request:any={version:engine==='round'?4:5,operation:'START',predecessor:null,requestKey:'allocation-review',logicalMatchId:'allocation-review',executionFormat:mode,setup:{version:engine==='round'?4:5,categories,teams:teams.map((t,j)=>({...t,...(engine==='competitive'?{colorKey:j?'SKY':'CORAL',aids:[]}:{} )})),rules:{turnSeconds:45,overallSeconds:standalone?600:null,questionSeconds:120,...(engine==='competitive'?{version:'enta-competitive-1',paletteVersion:'enta-team-palette-1',stealSeconds:10,phoneSeconds:60,embeddedStealCap:200}:{})}}};
  try{const selected=engine==='round'?selectRoundPins(request as RequestBinding,catalogue.base,[],'a'.repeat(64)):selectCompetition(request as CompetitionRequest,catalogue,[],'a'.repeat(64));assert.equal(selected.pins.length,standalone?4:36);assert.equal(new Set(selected.pins.map(p=>p.sourceId)).size,selected.pins.length);
   for(const c of batch)record(engine,mode,c.key,()=>{const pins=selected.pins.filter(p=>p.categoryKey===c.key);assert.equal(pins.length,standalone?4:6);assert.ok(pins.every(p=>p.format===c.format));if(['ORDINARY_TIER','DRAWING_TARGET'].includes(c.format))for(const points of [200,400,600])assert.equal(pins.filter(p=>p.points===points).length,2);return pins;});
  }catch(error){for(const c of batch)failures.push({engine,mode,category:c.key,error:error instanceof Error?error.message:String(error)});}
 }
 console.log(JSON.stringify({engine,mode,advertisedCategories:eligible.length}));
}
const unique=[...new Map(rows.map(r=>[[r.engine,r.mode,r.category].join(':'),r])).values()];
const report={at:new Date().toISOString(),scope:'Actual pure engine selectors, no durable matches or runtime restart',source:{releaseId:realContent().source.releaseId,sha256:realContent().source.sha256,supplementRoot:SUPPLEMENT_ROOT},catalogueCategories:catalogue.base.categories.length,checks:unique.length,failures,summary:[...new Set(unique.map(r=>r.engine+':'+r.mode))].map(key=>({mode:key,categories:unique.filter(r=>r.engine+':'+r.mode===key).length})),rows:unique};
const path=`D:/projects/huroof_wa_oloof/local/almaidan/enta-allocation-coverage-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({path,checks:report.checks,failures}));if(failures.length)process.exitCode=1;

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
