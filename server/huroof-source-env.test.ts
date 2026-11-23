import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadLocalReleaseQuestionSource} from './local-release-question-source.js';
import {originalChallengeDefinition} from './local-challenge-overlay.js';
import {kidsCategories} from '../services/enta/server/src/local-development/content-pack.js';

test('Huroof-only launcher validates mixed overlays without Enta environment',async()=>{
 delete process.env.ENTA_RUNTIME_MODE;delete process.env.DATABASE_URL;delete process.env.ALMAIDAN_REAL_CONTENT_PATH;delete process.env.FIREBASE_AUTH_EMULATOR_HOST;delete process.env.NODE_ENV;
 process.env.ALMAIDAN_LOCAL_ONLY='true';process.env.FIREBASE_PROJECT_ID='demo-almaidan-local';process.env.GAME_HOST='127.0.0.1';
 const raw=JSON.parse(readFileSync('D:/projects/huroof_wa_oloof/local/almaidan/real-content.json','utf8'));
 const text=raw.questions.find((q:any)=>q.modality==='classic'&&!q.challenge&&!q.media&&!q.answerMedia);
 const media=raw.questions.find((q:any)=>q.modality==='image'&&q.media&&!q.challenge);
 const challenge=raw.questions.find((q:any)=>q.challenge);const def=originalChallengeDefinition(challenge);const kid=kidsCategories[0].questions[0];
 const rows=[
  {entity:'question',entityId:text.id,revisionId:'test-text',payload:{promptAr:text.promptAr,canonicalAnswer:text.canonicalAnswer,acceptedAnswers:text.acceptedAnswers,points:200}},
  {entity:'question',entityId:media.id,revisionId:'test-media',payload:{promptAr:media.promptAr,canonicalAnswer:media.canonicalAnswer,acceptedAnswers:media.acceptedAnswers,media:media.media,answerMedia:media.answerMedia??null}},
  {entity:'question',entityId:challenge.id,revisionId:'test-challenge',payload:{promptAr:challenge.promptAr,publicData:def.publicData,privateGrading:def.privateGrading}},
  {entity:'question',entityId:kid.sourceQuestionId,revisionId:'test-kid',payload:{promptAr:kid.prompt,canonicalAnswer:kid.answers[0].text,acceptedAnswers:kid.answers.map(a=>a.text),points:kid.points}},
 ];
 const result=await loadLocalReleaseQuestionSource(rows);assert.ok(result.questions.some(q=>q.id===text.id));assert.equal(result.challengeDefinitions?.length,1);
});
