export type SelectedCategory={key:string;promptRefs:string[]};
export const validSelectedCategories=(value:unknown):value is SelectedCategory[]=>Array.isArray(value)&&value.length<=6&&value.every(c=>c&&typeof c==='object'&&typeof c.key==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(c.key)&&Array.isArray(c.promptRefs)&&c.promptRefs.length<=6&&c.promptRefs.every((ref:unknown)=>typeof ref==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(ref))&&new Set(c.promptRefs).size===c.promptRefs.length)&&new Set(value.map(c=>c.key)).size===value.length;
export const validQuestionSeconds=(value:unknown)=>typeof value==='number'&&Number.isInteger(value)&&value>=5&&value<=120;
export const validTurnSeconds=(value:unknown)=>value===15||value===30||value===45;
export const validOverallSeconds=(value:unknown)=>value===null||value===300||value===600;
export const normalizeCategorySearch=(value:string)=>value.normalize('NFKC').replace(/[\u064b-\u065f\u0670ـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').toLocaleLowerCase().trim();
export const categoryMatches=(category:{key:string;label:string;format?:string},query:string)=>{const needle=normalizeCategorySearch(query);return !needle||normalizeCategorySearch(category.label+' '+({DRAWING_TARGET:'رسم',ACTING_ITEMS:'تمثيل',LIST_ITEMS:'قائمة قوائم',ORDINARY_TIER:'اسئلة'}[category.format??'']??'')).includes(needle)||category.key.toLocaleLowerCase().includes(needle);};

