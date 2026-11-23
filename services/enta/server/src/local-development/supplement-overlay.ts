import {admissionHash} from '../admission/huroof-protocol.cjs';
import {kidsCategories,supplementalFormatCategories,SUPPLEMENT_RELEASE,SUPPLEMENT_ROOT} from './content-pack';
import {localContentOverlays,type Overlay} from './real-content';

export function currentSupplement(){return deriveSupplement(localContentOverlays());}

/** Pure derivation: never changes the authored sources or previously pinned matches. */
export function deriveSupplement(overlays:Overlay[]){
 const relevant=overlays.filter(r=>kidsCategories.some(c=>c.key===r.entityId||c.questions.some(q=>q.sourceQuestionId===r.entityId))||supplementalFormatCategories.some(c=>c.key===r.entityId||c.prompts.some(p=>p.sourceId===r.entityId)));
 const byId=new Map(relevant.map(r=>[`${r.entity}:${r.entityId}`,r]));
 const kids=kidsCategories.map(c=>{
  const category=byId.get(`category:${c.key}`);
  return {...c,label:category?category.payload.labelAr as string:c.label,revisionId:category?category.revisionId:c.revisionId,questions:c.questions.map(q=>{
   const row=byId.get(`question:${q.sourceQuestionId}`);if(!row)return q;
   const p=row.payload;const answers=[p.canonicalAnswer as string,...(p.acceptedAnswers as string[]).filter(a=>a!==p.canonicalAnswer)];const content={prompt:p.promptAr,answers,points:p.points,ageBand:'7-10'};
   return {...q,revisionId:row.revisionId,contentHash:admissionHash(content),prompt:p.promptAr as string,points:p.points as typeof q.points,answers:answers.map(text=>({text,isCorrect:true,isTrap:false}))};
  })};
 });
 const formats=supplementalFormatCategories.map(c=>{
  const category=byId.get(`category:${c.key}`);
  return {...c,label:category?category.payload.labelAr as string:c.label,prompts:c.prompts.map(q=>{
   const row=byId.get(`question:${q.sourceId}`);if(!row)return q;
   const p=row.payload,items=q.items.map((item,i)=>{const value=(p.items as string[]|undefined)?.[i]??item.text;return {...item,text:value,revisionId:`${row.revisionId}-${i}`,hash:admissionHash(value)};});
   const target=q.format==='DRAWING_TARGET'?p.target as string:q.target;
   const updated={...q,revisionId:row.revisionId,prompt:p.promptAr as string,target,points:q.format==='DRAWING_TARGET'?p.points as typeof q.points:q.points,items,rules:{...q.rules,target}};
   const {formatHash:_,hash:__,...base}=updated;
   const hash=admissionHash({prompt:base.prompt,target:base.target,points:base.points,items:base.items});
   const pin={...base,hash};return {...pin,formatHash:admissionHash({version:1,pin})};
  })};
 });
 const digest=admissionHash(relevant);
 return {kids,formats,releaseId:relevant.length?`local-supplement-${digest.slice(0,32)}`:SUPPLEMENT_RELEASE,root:relevant.length?admissionHash({original:SUPPLEMENT_ROOT,digest}):SUPPLEMENT_ROOT};
}
