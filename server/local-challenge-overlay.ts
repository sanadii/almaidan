import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalChallengeJson,definitionPayload,parseChallengeDefinitionEnvelope,assertChallengeDefinitionBinding,type ChallengeDefinitionEnvelope} from '../src/features/game/challenges/integration.js';

const digest=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
let original:ChallengeDefinitionEnvelope[]|undefined;
export function originalChallengeEnvelopes(){
 if(original)return original;
 const bytes=readFileSync('D:/projects/huroof_wa_oloof/local/almaidan/real-challenge-definitions.json');
 if(digest(bytes)!=='68ae1daf28e2b68ca46bd95948d75bbd21d44840fce3a654f1aa90372b6492e5')throw Error('LOCAL_CHALLENGE_SOURCE_HASH_MISMATCH');
 const value=JSON.parse(bytes.toString('utf8'));if(!Array.isArray(value))throw Error('LOCAL_CHALLENGE_SOURCE_INVALID');return original=value;
}
export function originalChallengeDefinition(question:any){
 const ref=question?.challenge?.definition;
 const envelope=originalChallengeEnvelopes().find(e=>e.id===ref?.id&&e.manifestSha256===ref?.manifestSha256&&e.definitionSha256===ref?.definitionSha256);
 if(!envelope)throw Error('CHALLENGE_DEFINITION_MISSING');
 const definition=parseChallengeDefinitionEnvelope(envelope,digest);assertChallengeDefinitionBinding(definition,question);return definition;
}
/** Only editable mechanics fields change; identity, source and media remain bound to the original. */
export function deriveChallengeEnvelope(question:any,payload:Record<string,unknown>):ChallengeDefinitionEnvelope{
 const original=originalChallengeDefinition(question);
 const definition={...original,publicData:payload.publicData,privateGrading:payload.privateGrading} as typeof original;
 definition.definitionSha256=digest(canonicalChallengeJson(definitionPayload(definition)));
 const canonicalJson=canonicalChallengeJson(definition);
 const envelope={manifestSha256:digest(canonicalJson),id:definition.id,schemaVersion:definition.schemaVersion,definitionSha256:definition.definitionSha256,canonicalJson};
 const verified=parseChallengeDefinitionEnvelope(envelope,digest);assertChallengeDefinitionBinding(verified,question);return envelope;
}
