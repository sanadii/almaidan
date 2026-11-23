import {admissionHash} from '../admission/huroof-protocol.cjs';
import {assertLocalDevelopment} from './guard';
import {realContent,realCategories} from './real-content';
import {localCompetitionCatalogue} from './competition-catalogue';
import {currentSupplement} from './supplement-overlay';
export const COMPATIBILITY_MODES=['classic','kids','drawing','roundList','roundActing','roundMixed','competitiveTier','competitiveList','competitiveActing','competitiveMixed'] as const;
export type CompatibilityMode=typeof COMPATIBILITY_MODES[number];
export const COMPATIBILITY_REASONS={
 NO_TEXT_QUESTIONS:'لا توجد أسئلة نصية مناسبة لهذا النمط في هذه الفئة.',
 TIER_SUPPLY:'لا تتوافر أسئلة مختلفة كافية لكل مستوى من مستويات النقاط.',
 FORMAT_CONTRACT:'محتوى هذه الفئة لا يطابق متطلبات هذا النمط.',
 KIDS_NOT_REVIEWED:'لم تُراجع هذه الفئة لهذا النمط المخصص للأطفال.',
 LIST_CONTENT_REQUIRED:'هذا النمط يحتاج أسئلة قوائم مع عناصر إجابة محددة.',
 DRAWING_CONTENT_REQUIRED:'هذا النمط يحتاج أهداف رسم مخصصة.',
 ACTING_CONTENT_REQUIRED:'هذا النمط يحتاج محتوى تمثيل مخصصاً.',
 AUTHORED_MODE_ONLY:'هذه الفئة مؤلفة محلياً لنمط مختلف.',
} as const;
let cache:{key:string;value:ReturnType<typeof build>}|undefined;
function build(){
 const {kids:kidsCategories,formats:supplementalFormatCategories,releaseId:SUPPLEMENT_RELEASE,root:SUPPLEMENT_ROOT}=currentSupplement();
 const content=realContent(),classic=new Map(realCategories().map(c=>[c.key,c])),format=localCompetitionCatalogue().base.categories,formats=new Map(format.map(c=>[c.key,c]));
 const rawCounts=new Map<string,{total:number;text:number;image:number;challenge:number}>();
 const countedIds=new Set<string>();
 for(const q of content.questions){if(countedIds.has(q.id))continue;countedIds.add(q.id);const count=rawCounts.get(q.categoryId)??{total:0,text:0,image:0,challenge:0};count.total++;if(q.challenge)count.challenge++;else if(q.modality==='classic')count.text++;else if(q.modality==='image')count.image++;rawCounts.set(q.categoryId,count);}
 const candidates=[...content.categories.map(c=>({id:c.id as string,label:c.labelAr as string,source:'saved-release' as const,revision:admissionHash(c),inventory:rawCounts.get(c.id)??{total:0,text:0,image:0,challenge:0}})),...kidsCategories.map(c=>({id:c.key,label:c.label,source:'local-authored' as const,revision:c.revisionId,inventory:{total:c.questions.length,text:c.questions.length,image:0,challenge:0}})),...supplementalFormatCategories.map(c=>({id:c.key,label:c.label,source:'local-authored' as const,revision:SUPPLEMENT_ROOT,inventory:{total:c.prompts.length,text:c.prompts.length,image:0,challenge:0}}))];
 const categories=candidates.map(c=>{
  const f=formats.get(c.id),kid=kidsCategories.find(k=>k.key===c.id),cl=classic.get(c.id),modes={} as Record<CompatibilityMode,{ready:boolean;count:number;reason:keyof typeof COMPATIBILITY_REASONS|null}>;
  for(const mode of COMPATIBILITY_MODES){let ready=false,count=0,reason:keyof typeof COMPATIBILITY_REASONS='FORMAT_CONTRACT';
   if(mode==='classic'){ready=!!cl;count=cl?.questions.length??0;reason=c.source==='local-authored'?'AUTHORED_MODE_ONLY':c.inventory.text?'TIER_SUPPLY':'NO_TEXT_QUESTIONS';}
   else if(mode==='kids'){ready=!!kid;count=kid?.questions.length??0;reason='KIDS_NOT_REVIEWED';}
   else if(mode==='drawing'){ready=f?.format==='DRAWING_TARGET';count=ready?f!.prompts.length:0;reason='DRAWING_CONTENT_REQUIRED';}
   else if(mode==='roundList'||mode==='competitiveList'){ready=f?.format==='LIST_ITEMS';count=ready?f!.prompts.length:0;reason='LIST_CONTENT_REQUIRED';}
   else if(mode==='roundActing'||mode==='competitiveActing'){ready=f?.format==='ACTING_ITEMS';count=ready?f!.prompts.length:0;reason='ACTING_CONTENT_REQUIRED';}
   else if(mode==='competitiveTier'){ready=f?.format==='ORDINARY_TIER';count=ready?f!.prompts.length:0;reason=!cl?(c.inventory.text?'TIER_SUPPLY':'NO_TEXT_QUESTIONS'):'FORMAT_CONTRACT';}
   else {ready=!!f;count=f?.prompts.length??0;reason=kid?'AUTHORED_MODE_ONLY':!cl?(c.inventory.text?'TIER_SUPPLY':'NO_TEXT_QUESTIONS'):'FORMAT_CONTRACT';}
   modes[mode]={ready,count,reason:ready?null:reason};
  }
  return {...c,modes};
 });
 const source={releaseId:content.source.releaseId,root:content.source.sha256,supplementRelease:SUPPLEMENT_RELEASE,supplementRoot:SUPPLEMENT_ROOT};
 return {version:1 as const,revision:admissionHash({source,categories}),source,reasons:COMPATIBILITY_REASONS,categories};
}
/** Public metadata only. Same factories as admission; no answers, targets, media capabilities or owner history. */
export function localCatalogueCompatibility(){assertLocalDevelopment();const key=realContent().source.sha256+currentSupplement().root;if(cache?.key===key)return cache.value;const value=build();cache={key,value};return value;}
