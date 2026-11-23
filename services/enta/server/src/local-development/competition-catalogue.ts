import { admissionHash } from '../admission/huroof-protocol.cjs';
import { competitionProofRoot, PALETTE_ROOT, validateCompetitionCatalog } from '../rounds/competition-rules';
import type { CompetitionCatalog } from '../rounds/competition-types';
import type { FormatCatalog, PromptPin } from '../rounds/types';
import {currentSupplement} from './supplement-overlay';
import { selectedLocalCategories } from './catalogue';
import {realContentEnabled,realContent} from './real-content';

/** Local authored practice content only. Hashes bind local bytes; they are not production acceptance receipts. */
export function localCompetitionCatalogue(seen:ReadonlySet<string>=new Set()):CompetitionCatalog {
 const localCategories=selectedLocalCategories(seen);const real=realContentEnabled();
 const categories:FormatCatalog['categories']=localCategories.map(c=>({key:c.key,label:c.label,format:'ORDINARY_TIER',cover:null,prompts:c.questions.map(q=>pin({ref:q.sourceQuestionId,sourceNamespace:real?'almaidan.local.source':'almaidan.local.practice',sourceId:q.sourceQuestionId,revisionId:q.revisionId,hash:q.contentHash,formatId:`format-${q.sourceQuestionId}`,categoryKey:c.key,format:'ORDINARY_TIER',prompt:q.prompt,target:q.answers[0].text,points:q.points,items:[],media:[],rules:{version:1,kind:'ORDINARY_TIER',target:q.answers[0].text}}))}));
 if(!real){for(const format of ['LIST_ITEMS','ACTING_ITEMS'] as const){const key=format==='LIST_ITEMS'?'local-list':'local-acting';const groups=[['تفاحة','موز','برتقال'],['قطة','كلب','حصان'],['أحمر','أزرق','أخضر'],['قلم','كتاب','دفتر'],['سيارة','قطار','طائرة']];const titles=['الفواكه','الحيوانات','الألوان','أدوات المدرسة','وسائل النقل'];categories.push({key,label:`${format==='LIST_ITEMS'?'قوائم':'تمثيل'} · تدريب محلي`,format,cover:null,prompts:groups.map((words,i)=>pin({ref:`${key}-${i}`,sourceNamespace:real?'almaidan.local.source':'almaidan.local.practice',sourceId:`${key}-${i}`,revisionId:`${key}-${i}-v1`,hash:admissionHash(words),formatId:`format-${key}-${i}`,categoryKey:key,format,prompt:`${format==='LIST_ITEMS'?'اذكر من':'مثّل كلمات'} ${titles[i]}`,target:null,points:null,items:words.map((text,j)=>({id:`${key}-${i}-${j}`,revisionId:`answer-${key}-${i}-${j}`,hash:admissionHash(text),ordinal:j,text,value:100,trap:false,mediaIds:[]})),media:[],rules:{version:1,kind:format,target:null}}))});}
 const drawKey='local-drawing';categories.push({key:drawKey,label:'الرسم · تدريب محلي',format:'DRAWING_TARGET',cover:null,prompts:['بيت','شجرة','شمس','قارب','ساعة','طائرة'].map((target,i)=>pin({ref:`drawing-${i}`,sourceNamespace:real?'almaidan.local.source':'almaidan.local.practice',sourceId:`drawing-${i}`,revisionId:`drawing-${i}-v1`,hash:admissionHash(target),formatId:`format-drawing-${i}`,categoryKey:drawKey,format:'DRAWING_TARGET',prompt:'ارسم الكلمة لفريقك دون كتابتها',target,points:([200,200,400,400,600,600] as const)[i],items:[],media:[],rules:{version:1,kind:'DRAWING_TARGET',target}}))});
 }
 const supplement=currentSupplement();categories.push(...supplement.formats.map(c=>{const ordered=[...c.prompts].sort((a,b)=>Number(seen.has(a.sourceId))-Number(seen.has(b.sourceId))||a.ref.localeCompare(b.ref));return {...c,prompts:c.format==='DRAWING_TARGET'?[200,400,600].flatMap(p=>ordered.filter(q=>q.points===p).slice(0,2)):ordered};}));
 const base:FormatCatalog={baseReleaseId:real?realContent().source.releaseId:'local-practice-v1',baseRoot:real?realContent().source.sha256:admissionHash(localCategories),receiptId:'local-content-binding-not-production',formatReleaseId:supplement.releaseId,formatRoot:admissionHash({categories,supplementRoot:supplement.root}),mediaRoot:admissionHash([]),policyVersion:'enta-format-1',categories};
 const catalog:CompetitionCatalog={base,policyVersion:'enta-competitive-1',competitiveReleaseId:'local-competition-v1',paletteRoot:PALETTE_ROOT,proofRoot:'',prompts:categories.flatMap(c=>c.prompts).map(p=>{
   const hints=real?[]:[{id:`hint-${p.formatId}`,revisionId:p.revisionId,revisionHash:p.hash,ordinal:0,text:'فكروا معاً في عنوان الفئة.',contentHash:admissionHash({ordinal:0,text:'فكروا معاً في عنوان الفئة.'}),safeDrawing:true}];
   const graphemes=p.items.map(item=>{const proof={answerRevisionId:item.revisionId,answerHash:item.hash,segmentationVersion:`unicode-${process.versions.unicode}-icu-${process.versions.icu}`,grapheme:[...new Intl.Segmenter('und',{granularity:'grapheme'}).segment(item.text)][0].segment};return {id:`grapheme-${item.id}`,...proof,proofHash:admissionHash(proof)};});
   const hintRoot=admissionHash({hints,graphemes}),effectValue=p.points??200,effectValueSource=p.points===null?'OWNER_EMBEDDED_200' as const:'PINNED_TIER' as const;
   return {...p,hints,graphemes,hintRoot,effectValue,effectValueSource,proofHash:admissionHash({version:'enta-competitive-1',baseHash:admissionHash(p),hints,graphemes,hintRoot,effectValue,effectValueSource})};
 })};catalog.proofRoot=competitionProofRoot(catalog);validateCompetitionCatalog(catalog);return catalog;
}
function pin(input:Omit<PromptPin,'formatHash'>):PromptPin{return {...input,formatHash:admissionHash({version:1,pin:input})};}


