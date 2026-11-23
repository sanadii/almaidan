import test from 'node:test';
import assert from 'node:assert/strict';
import {originalRealContent} from '../services/enta/server/src/local-development/real-content.js';
import {validateContentDraft} from '../services/enta/server/src/local-development/content-admin-store.js';
import {originalChallengeDefinition,deriveChallengeEnvelope} from './local-challenge-overlay.js';
import {ChallengeDefinitionRepository} from './challenge-definition-repository.js';
import {loadLocalReleaseQuestionSource,localRealChallengeDefinitions} from './local-release-question-source.js';

test('media drafts accept only verified source bindings',()=>{
 const q=originalRealContent().questions.find(q=>q.media&&q.modality==='image'&&!q.challenge)!;
 const payload={promptAr:q.promptAr,canonicalAnswer:q.canonicalAnswer,acceptedAnswers:q.acceptedAnswers,media:q.media,answerMedia:q.answerMedia??null};
 assert.equal(validateContentDraft('question',q.id,payload).payload.media?.mediaId,q.media.mediaId);
 assert.throws(()=>validateContentDraft('question',q.id,{...payload,media:{...q.media,assetSha256:'0'.repeat(64)}}),/INVALID_MEDIA_BINDING/);
});
test('challenge overlays bind new definitions and retain original pins',async()=>{
 const q=originalRealContent().questions.find(q=>q.challenge)!,original=originalChallengeDefinition(q);
 const payload={promptAr:q.promptAr,publicData:original.publicData,privateGrading:{...original.privateGrading,recallData:{...(original.privateGrading as any).recallData,promptAr:"سؤال الذاكرة الجديد"}}};
 const validated=validateContentDraft('question',q.id,payload);
 assert.throws(()=>validateContentDraft('question',q.id,{...payload,privateGrading:{}}),/INVALID_CHALLENGE_CONTENT/);
 const envelope=deriveChallengeEnvelope(q,validated.payload),repo=new ChallengeDefinitionRepository(await localRealChallengeDefinitions());
 const originalPin=repo.resolveBound(q);repo.add([envelope]);
 const revised={...q,challenge:{...q.challenge,definition:{id:envelope.id,schemaVersion:envelope.schemaVersion,definitionSha256:envelope.definitionSha256,manifestSha256:envelope.manifestSha256}}};
 assert.deepEqual(repo.resolveBound(q),originalPin);assert.notEqual(envelope.definitionSha256,originalPin.definitionSha256);assert.equal(repo.resolveBound(revised).definitionSha256,envelope.definitionSha256);
 assert.throws(()=>repo.add([{...envelope,canonicalJson:envelope.canonicalJson+' '}]),/CHALLENGE_DEFINITION/);
 const source=await loadLocalReleaseQuestionSource([{...validated,revisionId:'test-revision'}]);
 assert.equal(source.challengeDefinitions?.[0].manifestSha256,envelope.manifestSha256);
 assert.equal((source.questions.find(x=>x.id===q.id) as any)?.challenge?.definition.manifestSha256,envelope.manifestSha256);
});
