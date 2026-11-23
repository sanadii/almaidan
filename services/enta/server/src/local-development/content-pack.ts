import { admissionHash } from '../admission/huroof-protocol.cjs';
import type { FormatCatalog,PromptPin } from '../rounds/types';
import type {LocalCategory} from './real-content';
import {drawingData,actingData,listData,kidsData} from './content-pack-data';

export const SUPPLEMENT_RELEASE='almaidan-authored-2026-11-v1';
export const SUPPLEMENT_NAMESPACE='almaidan.local.authored';
export const SUPPLEMENT_ROOT=admissionHash({release:SUPPLEMENT_RELEASE,kidsData,listData,actingData,drawingData});
const points=(i:number)=>([200,400,600] as const)[Math.floor(i/6)];
const keyFor=(format:string,key:string)=>`authored-v1-${format}-${key}`;
/** Explicitly assigned local tiers, age 7–10, no assertion of school-curriculum certification. */
export const kidsCategories:LocalCategory[]=kidsData.map(([slug,label,rows])=>{
 const key=keyFor('kids',slug);return {key,label,revisionId:`${key}-v1`,questions:rows.map(([prompt,answer],i)=>{
 const id=`${key}-${i+1}`;const answers=[answer];
 // Numeric answers accept both Arabic-Indic and ASCII digits without changing question meaning.
 if(/^[0-9٠-٩]+$/.test(answer)){const ascii=answer.replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));answers.push(ascii,ascii.replace(/[0-9]/g,c=>'٠١٢٣٤٥٦٧٨٩'[Number(c)]));}
 const content={prompt,answers:[...new Set(answers)],points:points(i),ageBand:'7-10'};
 return {revisionId:`${id}-v1`,sourceQuestionId:id,categoryKey:key,contentHash:admissionHash(content),points:content.points,prompt,answers:content.answers.map(text=>({text,isCorrect:true,isTrap:false})),localGroups:[],localTierAssigned:true};
 })};
});
function pin(input:Omit<PromptPin,'formatHash'>):PromptPin{return {...input,formatHash:admissionHash({version:1,pin:input})};}
export const supplementalFormatCategories:FormatCatalog['categories']=[
 ...drawingData.map(([slug,label,words])=>{const key=keyFor('drawing',slug);return {key,label,format:'DRAWING_TARGET' as const,cover:null,prompts:words.split('|').map((target,i)=>{
 const id=`${key}-${i+1}`;return pin({ref:id,sourceNamespace:SUPPLEMENT_NAMESPACE,sourceId:id,revisionId:`${id}-v1`,hash:admissionHash({target,points:points(i)}),formatId:`format-${id}`,categoryKey:key,format:'DRAWING_TARGET',prompt:'ارسم الكلمة لفريقك دون كتابة حروف أو أرقام.',target,points:points(i),items:[],media:[],rules:{version:1,kind:'DRAWING_TARGET',target}});
 })};}),
 ...(['LIST_ITEMS','ACTING_ITEMS'] as const).flatMap(format=>(format==='LIST_ITEMS'?listData:actingData).map(([slug,label,data])=>{
 const key=keyFor(format==='LIST_ITEMS'?'list':'acting',slug);const rows=format==='LIST_ITEMS'?data.split(';'):data.split('|');return {key,label,format,cover:null,prompts:rows.map((row,i)=>{
 const id=`${key}-${i+1}`;const delimiter=row.lastIndexOf(':');const prompt=format==='LIST_ITEMS'?row.slice(0,delimiter):'مثّل الموقف لفريقك دون كلام أو كتابة.';const targets=format==='LIST_ITEMS'?row.slice(delimiter+1).split('،'):[row];
 return pin({ref:id,sourceNamespace:SUPPLEMENT_NAMESPACE,sourceId:id,revisionId:`${id}-v1`,hash:admissionHash({prompt,targets}),formatId:`format-${id}`,categoryKey:key,format,prompt,target:null,points:null,items:targets.map((text,j)=>({id:`${id}-item-${j}`,revisionId:`${id}-item-${j}-v1`,hash:admissionHash(text),ordinal:j,text,value:100,trap:false,mediaIds:[]})),media:[],rules:{version:1,kind:format,target:null}});
 })};})),
];
/** Drawing boards require exactly two pins per tier. Standalone pools retain all 18;
 * mixed-board clients receive unseen-first prompts so their default six advance. */
export function selectedSupplementalFormats(seen:ReadonlySet<string>=new Set()):FormatCatalog['categories']{
 return supplementalFormatCategories.map(c=>{const ordered=[...c.prompts].sort((a,b)=>Number(seen.has(a.sourceId))-Number(seen.has(b.sourceId))||a.ref.localeCompare(b.ref));return {...c,prompts:c.format==='DRAWING_TARGET'?[200,400,600].flatMap(p=>ordered.filter(q=>q.points===p).slice(0,2)):ordered};});
}
export function supplementalCoverage(){return {release:SUPPLEMENT_RELEASE,root:SUPPLEMENT_ROOT,provenance:'Original local supplemental content; saved catalogue unchanged',ageBand:'7-10',formats:[{format:'KIDS',categories:kidsCategories.map(c=>({key:c.key,count:c.questions.length,perMatch:6,nonRepeatingMatches:3}))},...(['LIST_ITEMS','ACTING_ITEMS','DRAWING_TARGET'] as const).map(format=>({format,categories:supplementalFormatCategories.filter(c=>c.format===format).map(c=>({key:c.key,count:c.prompts.length,perMatch:6,nonRepeatingMatches:3}))}))]};}
