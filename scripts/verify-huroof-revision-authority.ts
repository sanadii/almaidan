import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {AuthoritativeGameService} from '../server/service.js';
import {loadLocalReleaseQuestionSource,localRealChallengeDefinitions} from '../server/local-release-question-source.js';
import {originalChallengeDefinition,deriveChallengeEnvelope} from '../server/local-challenge-overlay.js';
import {validateContentDraft} from '../services/enta/server/src/local-development/content-admin-store.js';
import {CLIENT_CHALLENGE_CAPABILITY as offer} from '../src/features/game/runtime/contracts.js';

// INDEPENDENT REVIEW REQUIRED BEFORE EXECUTION. Actual authority methods and
// locally verified source data; isolated temporary SQLite and deterministic board
// nonce. No admin DB, active heads, canonical room database or HTTP server writes.
const sourceRoot='D:/projects/huroof_wa_oloof/local/almaidan';
const sha=(x:Buffer)=>createHash('sha256').update(x).digest('hex');
const hashFile=async(p:string)=>sha(await readFile(p));
async function main(){
 process.env.ALMAIDAN_LOCAL_ONLY='true';process.env.FIREBASE_PROJECT_ID='demo-almaidan-local';process.env.GAME_HOST='127.0.0.1';process.env.LOCAL_DB_QUESTION_SOURCE='saved-release';
 const raw=JSON.parse(await readFile(`${sourceRoot}/real-content.json`,'utf8'));
 const paths=[`${sourceRoot}/real-content.json`,`${sourceRoot}/real-challenge-definitions.json`,`${sourceRoot}/media-index.json`,raw.source.path],beforeHashes=await Promise.all(paths.map(hashFile));assert.equal(beforeHashes[3],raw.source.sha256);
 const baseline=await loadLocalReleaseQuestionSource([]),definitions=await localRealChallengeDefinitions();
 const tempBase=resolve(tmpdir()),dir=await mkdtemp(join(tempBase,'huroof-revision-authority-'));assert.ok(resolve(dir).startsWith(tempBase+sep));
 let now=1000;
 const service=new AuthoritativeGameService({dbPath:join(dir,'fixture.sqlite'),secret:'bounded-fixture-only',clock:()=>new Date(now),boardNonce:()=> 'fixed-fixture-nonce',localFirestoreQuestionSource:baseline,challengeDefinitions:definitions,enabledChallengeMechanics:['navigation']});
 const checks:string[]=[];
 try{
  async function open(category:string,challenge:boolean){
   const options:any={gameKind:'categories',categories:[category,'tahadani-051'],...(challenge?{challenge:offer}:{})};
   const room=service.create('fixture-host',true,options),guide=await service.join(room.roomCode,'guide',challenge?offer:undefined),other=await service.join(room.roomCode,'other',challenge?offer:undefined);
   let revision=other.revision,sequence=0;
   const send=async(token:string,type:string,payload:Record<string,unknown>={})=>{const result=await service.intent(room.roomId,token,{type:type as never,intentId:`fixture-${++sequence}`,expectedRevision:revision,payload});revision=result.revision;return result;};
   await send(room.token,'LOBBY_ASSIGN_TEAM',{memberUid:service.verify(guide.token)!.uid,team:'horizontal'});
   await send(room.token,'LOBBY_ASSIGN_TEAM',{memberUid:service.verify(other.token)!.uid,team:'vertical'});
   await send(guide.token,'LOBBY_SET_READY',{ready:true});await send(other.token,'LOBBY_SET_READY',{ready:true});
   if(challenge)await send(room.token,'LOBBY_ADD_MANUAL_PLAYER',{displayName:'mover',team:'horizontal'});
   await send(room.token,'START_MATCH');await send(room.token,'ROUND_READY');const cell=service.metadata(room.roomId,room.token).projection.board!.find(c=>c.categoryId===category);assert.ok(cell);
   await send(room.token,'SELECT_CELL',{cellId:cell.id});return {room,guide,other,send,revision:()=>revision,setRevision:(v:number)=>{revision=v;}};
  }
  // First obtain a real selected navigation source question, then derive a valid
  // changed definition. Equal nonce/inputs reproduce the source selection.
  const oldChallenge=await open('tahadani-games-120',true),oldQuestion:any=service.store.load(oldChallenge.room.roomId)!.activeQuestion;assert.equal(oldQuestion.challenge?.kind,'navigation');
  const original=raw.questions.find((q:any)=>q.id===oldQuestion.id);assert.ok(original);const definition:any=originalChallengeDefinition(original),privateGrading=structuredClone(definition.privateGrading);
  const occupied=new Set([...privateGrading.blocked,...privateGrading.canonicalPath].map((p:number[])=>p.join(',')));let payload:any;
  for(let r=0;r<definition.publicData.rows&&!payload;r++)for(let c=0;c<definition.publicData.columns&&!payload;c++)if(!occupied.has(`${r},${c}`)){const candidate={promptAr:original.promptAr,publicData:definition.publicData,privateGrading:{...privateGrading,blocked:[...privateGrading.blocked,[r,c]]}};try{deriveChallengeEnvelope(original,candidate);payload=candidate;}catch{/* select a different off-path cell */}}
  assert.ok(payload,'valid changed navigation blocker');const draft=validateContentDraft('question',original.id,payload,raw),changed=await loadLocalReleaseQuestionSource([{...draft,revisionId:'fixture-challenge-revision'}]);
  const oldPin=structuredClone(service.store.load(oldChallenge.room.roomId)!.activeQuestion);service.replaceLocalQuestionSource(changed);
  const newChallenge=await open('tahadani-games-120',true),newQuestion:any=service.store.load(newChallenge.room.roomId)!.activeQuestion;assert.equal(newQuestion.id,oldQuestion.id);assert.notEqual(newQuestion.challenge.definition.definitionSha256,oldQuestion.challenge.definition.definitionSha256);assert.deepEqual(service.store.load(oldChallenge.room.roomId)!.activeQuestion,oldPin);assert.ok(service.metadata(oldChallenge.room.roomId,oldChallenge.room.token).projection.challenge);
  const ch=()=>service.metadata(newChallenge.room.roomId,newChallenge.room.token).projection.challenge!,data=()=>({occurrence:ch().occurrence,challengeRevision:ch().revision,stage:ch().stage});
  const manual=service.store.load(newChallenge.room.roomId)!.manualParticipants!.find(x=>x.team==='horizontal')!;const guideId=`member:${service.verify(newChallenge.guide.token)!.uid}`;
  await newChallenge.send(newChallenge.room.token,'CHALLENGE_ASSIGN',{...data(),assignment:'guide',participantId:guideId});await newChallenge.send(newChallenge.room.token,'CHALLENGE_ASSIGN',{...data(),assignment:'mover',participantId:`manual:${manual.id}`});
  const ready=()=>({protocolHash:ch().readiness.protocolHash,assignmentHash:ch().readiness.assignmentHash,stimulusHash:ch().readiness.stimulusHash});
  await newChallenge.send(newChallenge.guide.token,'CHALLENGE_READY',{...data(),participantId:guideId,readiness:ready()});await newChallenge.send(newChallenge.room.token,'CHALLENGE_READY',{...data(),participantId:`manual:${manual.id}`,readiness:ready()});await newChallenge.send(newChallenge.room.token,'CHALLENGE_START',data());now+=3001;await service.tick();newChallenge.setRevision(service.metadata(newChallenge.room.roomId,newChallenge.room.token).revision);
  const guideView:any=service.metadata(newChallenge.room.roomId,newChallenge.guide.token).projection.challenge,otherView:any=service.metadata(newChallenge.room.roomId,newChallenge.other.token).projection.challenge;
  assert.ok(guideView?.stimulus);assert.ok(Array.isArray(guideView.stimulus.blocked));assert.ok(guideView.stimulus.goal);assert.equal(otherView?.stimulus?.blocked,undefined);assert.equal(otherView?.stimulus?.goal,undefined);assert.ok(!JSON.stringify(otherView).includes('canonicalDirections'));assert.ok(!JSON.stringify(otherView).includes('privateGrading'));assert.notDeepEqual(guideView.stimulus,otherView?.stimulus);checks.push('changed navigation definition resolves in new authority room; prior pin retained; guide and opponent projections differ without private grading leakage');
  // Restore the original source for the first media room, then publish a fixture
  // question revision using its already verified source media binding.
  service.replaceLocalQuestionSource(baseline);const oldMedia=await open('tahadani-012',false),oldMediaQuestion:any=service.store.load(oldMedia.room.roomId)!.activeQuestion;assert.equal(oldMediaQuestion.modality,'image');
  const mediaSource=raw.questions.find((q:any)=>q.id===oldMediaQuestion.id);assert.ok(mediaSource);const mediaPayload={promptAr:mediaSource.promptAr+' مراجعة محلية',canonicalAnswer:mediaSource.canonicalAnswer,acceptedAnswers:mediaSource.acceptedAnswers,media:mediaSource.media,answerMedia:mediaSource.answerMedia??null};
  const mediaDraft=validateContentDraft('question',mediaSource.id,mediaPayload,raw),mediaChanged=await loadLocalReleaseQuestionSource([{...mediaDraft,revisionId:'fixture-media-revision'}]);const oldMediaPin=structuredClone(oldMediaQuestion);service.replaceLocalQuestionSource(mediaChanged);
  const newMedia=await open('tahadani-012',false),newMediaQuestion:any=service.store.load(newMedia.room.roomId)!.activeQuestion;assert.equal(newMediaQuestion.id,oldMediaQuestion.id);assert.equal(newMediaQuestion.promptAr,mediaPayload.promptAr);assert.notEqual(newMediaQuestion.sourceContentHash,oldMediaQuestion.sourceContentHash);assert.deepEqual(service.store.load(oldMedia.room.roomId)!.activeQuestion,oldMediaPin);
  const binding={mediaId:newMediaQuestion.media.mediaId,assetSha256:newMediaQuestion.media.assetSha256},ticket=service.issueCurrentQuestionMedia(newMedia.room.roomId,newMedia.room.token,binding),delivered=await service.readCurrentQuestionMedia(ticket.ticket,newMedia.room.token);assert.equal(sha(delivered.bytes),binding.assetSha256);assert.throws(()=>service.issueCurrentQuestionMedia(newMedia.room.roomId,newMedia.guide.token,binding),/FORBIDDEN_ROLE/);await assert.rejects(service.readCurrentQuestionMedia(ticket.ticket,newMedia.guide.token),/UNAUTHORIZED/);checks.push('changed media question reaches new authority room; old pin retained; authorized delivered bytes hash correctly and guest is denied');
  assert.deepEqual(await Promise.all(paths.map(hashFile)),beforeHashes);console.log(JSON.stringify({passed:true,scope:'deterministic isolated authority fixture; not live HTTP',checks}));
 }finally{service.close();const target=resolve(dir);if(!target.startsWith(tempBase+sep))throw Error('TEMP_PATH_INVALID');await rm(target,{recursive:true,force:true});}
}
main().catch(e=>{console.error(JSON.stringify({passed:false,error:e instanceof Error?e.message:'unknown failure'}));process.exitCode=1;});
