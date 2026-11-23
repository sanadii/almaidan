import {describe,it,expect,vi} from 'vitest';
import {initialPayload,refreshedContent,parseChallengeObject,hasQuestionMedia} from '../../src/features/local-admin/editor-model';

describe('local admin editor payloads',()=>{
 it('initializes kids with answers and points',()=>expect(initialPayload({format:'KIDS',promptAr:'س',canonicalAnswer:'ج',acceptedAnswers:['ج'],points:400},'question')).toEqual({promptAr:'س',canonicalAnswer:'ج',acceptedAnswers:['ج'],points:400}));
 it.each(['LIST_ITEMS','ACTING_ITEMS'])('extracts ordered text for %s while retaining item positions',format=>expect(initialPayload({format,promptAr:'س',items:[{id:'a',text:'أ',value:3},{id:'b',text:'ب',trap:true}]},'question')).toEqual({promptAr:'س',items:['أ','ب']}));
 it('initializes a drawing target and points',()=>expect(initialPayload({format:'DRAWING_TARGET',promptAr:'ارسم',target:'بيت',points:600},'question')).toEqual({promptAr:'ارسم',target:'بيت',points:600}));
 it.each(['LIST_ITEMS','ACTING_ITEMS','DRAWING_TARGET'])('ignores authored empty media arrays for %s',format=>{const row={format,promptAr:'س',items:[{text:'أ'}],target:'باب',points:400,media:[],answerMedia:[]};expect(hasQuestionMedia(row)).toBe(false);expect(initialPayload(row,'question')).toEqual(format==='DRAWING_TARGET'?{promptAr:'س',target:'باب',points:400}:{promptAr:'س',items:['أ']});});
 it('ignores empty or malformed media descriptors',()=>{for(const media of [null,[],{}, {mediaId:'m'}, {mediaId:'m',assetSha256:''}])expect(hasQuestionMedia({media})).toBe(false);});
 it('initializes a category label',()=>expect(initialPayload({labelAr:'فئة'},'category')).toEqual({labelAr:'فئة'}));
 it('refreshes the selected active row and payload from the authoritative response',async()=>{const api=vi.fn(async(path:string)=>path==='/categories'?{categories:[{id:'cat',labelAr:'جديد'}]}:{questions:[{id:'other'},{id:'q1',categoryId:'cat',format:'DRAWING_TARGET',promptAr:'جديد',target:'شجرة',points:400}]});const result=await refreshedContent(api,{id:'q1',categoryId:'cat'},'question');expect(result.categories[0].labelAr).toBe('جديد');expect(result.payload).toEqual({promptAr:'جديد',target:'شجرة',points:400});expect(api).toHaveBeenCalledWith('/questions?category=cat&q=q1&offset=0');});
 it('accepts only JSON objects for challenge fields',()=>{expect(parseChallengeObject('{"answer":"ok"}')).toEqual({answer:'ok'});for(const value of ['{','[]','null','3'])expect(()=>parseChallengeObject(value)).toThrow('INVALID_CHALLENGE_JSON');});
 it('keeps source media descriptors in a media draft',()=>{const media={type:'image',mediaId:'m',assetSha256:'abc',contentType:'image/png',altAr:'صورة'};expect(initialPayload({promptAr:'س',canonicalAnswer:'ج',media},'question')).toEqual({promptAr:'س',canonicalAnswer:'ج',acceptedAnswers:['ج'],media,answerMedia:null});});
 it('initializes challenge fields from the authenticated definition',()=>{const payload=initialPayload({promptAr:'س',challenge:{id:'c'},challengeDefinition:{publicData:{clue:'أ'},privateGrading:{answer:'ب'}}},'question');expect(parseChallengeObject(payload.publicDataText)).toEqual({clue:'أ'});expect(parseChallengeObject(payload.privateGradingText)).toEqual({answer:'ب'});expect(payload.promptAr).toBe('س');});
});


