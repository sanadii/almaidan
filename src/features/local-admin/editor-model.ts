type Row=Record<string,any>;
export function hasMediaDescriptor(value:unknown):boolean {
 return !!value && typeof value==='object' && !Array.isArray(value) && typeof (value as Row).mediaId==='string' && !!(value as Row).mediaId && typeof (value as Row).assetSha256==='string' && !!(value as Row).assetSha256;
}
export function hasQuestionMedia(row:Row):boolean {return hasMediaDescriptor(row.media)||hasMediaDescriptor(row.answerMedia);}
export function initialPayload(row:Row,kind:'question'|'category'):Row {
 if(kind==='category')return {labelAr:row.labelAr};
 if(row.challenge&&row.challengeDefinition)return {promptAr:row.promptAr,publicDataText:JSON.stringify(row.challengeDefinition.publicData,null,2),privateGradingText:JSON.stringify(row.challengeDefinition.privateGrading,null,2)};
 if(hasQuestionMedia(row))return {promptAr:row.promptAr,canonicalAnswer:row.canonicalAnswer,acceptedAnswers:row.acceptedAnswers??[row.canonicalAnswer],media:hasMediaDescriptor(row.media)?row.media:null,answerMedia:hasMediaDescriptor(row.answerMedia)?row.answerMedia:null};
 if(row.format==='LIST_ITEMS'||row.format==='ACTING_ITEMS')return {promptAr:row.promptAr,items:(row.items??[]).map((item:Row|string)=>typeof item==='string'?item:item.text)};
 if(row.format==='DRAWING_TARGET')return {promptAr:row.promptAr,target:row.target,points:row.points??200};
 return {promptAr:row.promptAr,canonicalAnswer:row.canonicalAnswer,acceptedAnswers:row.acceptedAnswers??[row.canonicalAnswer],points:row.points??row.sourceProvenance?.points??200};
}

export async function refreshedContent(api:(path:string)=>Promise<any>,selected:Row,entity:'question'|'category') {
 const list=await api('/categories');
 let row=entity==='category'?list.categories.find((c:Row)=>c.id===selected.id):(await api(`/questions?category=${encodeURIComponent(selected.categoryId??'')}&q=${encodeURIComponent(selected.id)}&offset=0`)).questions.find((q:Row)=>q.id===selected.id);
 if(row?.challenge){const challengeDefinition=await api(`/challenge-definition?questionId=${encodeURIComponent(row.id)}`);row={...row,challengeDefinition};}
 return {categories:list.categories,row,payload:row?initialPayload(row,entity):undefined};
}

// Challenge data must be an object; parsing never accepts arrays, primitives or malformed JSON.
export function parseChallengeObject(raw:string):Record<string,unknown> {
 let value:unknown;try{value=JSON.parse(raw);}catch{throw Error('INVALID_CHALLENGE_JSON');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_CHALLENGE_JSON');
 return value as Record<string,unknown>;
}
