import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {AuthoritativeGameService,deriveBoardSeed} from '../../server/service.js';
import {availableLocalQuestionMedia} from '../../server/local-release-question-source.js';
import {createCategoryQuestionSelection} from '../../src/features/game/runtime/question-selector.js';
import {CURRENT_CATEGORY_PROJECTION} from '../../src/features/game/runtime/category-projection.js';
import {youtubeDescriptorBytes} from '../../src/features/game/runtime/youtube-media.js';
import {checkedLocalMedia} from '../../services/enta/server/src/local-development/content-admin-media-options.js';
import {validateContentDraft} from '../../services/enta/server/src/local-development/content-admin-store.js';

test('isolated reviewed Hunter source reaches active question and authorized visible-video grant',async()=>{
 const saved=Object.fromEntries(['ALMAIDAN_LOCAL_ONLY','FIREBASE_PROJECT_ID','GAME_HOST'].map(k=>[k,process.env[k]]));
 Object.assign(process.env,{ALMAIDAN_LOCAL_ONLY:'true',FIREBASE_PROJECT_ID:'demo-almaidan-local',GAME_HOST:'127.0.0.1'});
 const dir=await mkdtemp(join(tmpdir(),'hunter-youtube-fixture-'));
 try{
  const youtube={provider:'youtube' as const,videoId:'JOz8CVQjTuA',startSeconds:30,endSeconds:45};
  const media={mediaId:'fixture-hunter',assetSha256:createHash('sha256').update(youtubeDescriptorBytes(youtube)).digest('hex'),altAr:'فيديو السؤال',type:'video' as const,contentType:'application/vnd.huroof.youtube+json',youtube};
  assert.equal(await availableLocalQuestionMedia(media),true);
  assert.equal(await availableLocalQuestionMedia({...media,youtube:{...youtube,endSeconds:46}}),false);
  assert.equal(await availableLocalQuestionMedia({...media,youtube:{...youtube,videoId:'bad'}}),false);
  const trustedFixture={questions:[{media}]} as never;
  assert.deepEqual(checkedLocalMedia(media,'video',trustedFixture),media);
  assert.equal(checkedLocalMedia({...media,youtube:{...youtube,endSeconds:46}},'video',trustedFixture),undefined);
  assert.equal(checkedLocalMedia(media,'video',{questions:[]} as never),undefined);
  const trustedSource={questions:[{id:'fixture-hunter',modality:'video',media}],categories:[]} as never;
  const overlay={promptAr:'من المغنية التي أدت شارة البداية الأصلية المسموعة في هذا المقطع؟',canonicalAnswer:'رشا رزق',acceptedAnswers:['رشا رزق','Rasha Rizk'],media,answerMedia:null};
  assert.deepEqual(validateContentDraft('question','fixture-hunter',overlay,trustedSource).payload,overlay);
  assert.throws(()=>validateContentDraft('question','fixture-hunter',{...overlay,media:{...media,youtube:{...youtube,endSeconds:46}}},trustedSource),/INVALID_MEDIA_BINDING/);
  const categories=['tahadani-games-543','tahadani-007'];
  const questions=categories.flatMap((categoryId,group)=>Array.from({length:14},(_,i)=>({id:group===0&&i===0?'fixture-hunter':`fixture-${group}-${i}`,categoryId,modality:group===0&&i===0?'video' as const:'classic' as const,answerConceptId:`fixture-concept-${group}-${i}`,headerAr:group===0?'أغاني كرتون':'تجريبي',promptAr:group===0&&i===0?'من المغنية التي أدت شارة البداية الأصلية المسموعة في هذا المقطع؟':`سؤال تجريبي ${group}-${i}`,canonicalAnswer:group===0&&i===0?'رشا رزق':`إجابة ${group}-${i}`,acceptedAnswers:group===0&&i===0?['رشا رزق','Rasha Rizk']:[`إجابة ${group}-${i}`],...(group===0&&i===0?{media}:{}),status:'draft_test_import' as const,sourceContentHash:'a'.repeat(64),difficulty:'medium'})));
  let nonce='';for(let i=0;i<1000;i++){const n=`hunter-fixture-${i}`,selection=createCategoryQuestionSelection(questions,{categories,modality:'classic',seed:deriveBoardSeed(n,0),categoryProjectionVersion:CURRENT_CATEGORY_PROJECTION});if(selection.queues[categories[0]]?.[0]==='fixture-hunter'){nonce=n;break}}assert.ok(nonce);
  const source={snapshotId:'isolated-hunter-fixture',questions,inventory:{source:'local_saved_release' as const,snapshotId:'isolated-hunter-fixture',bundleSha256:'b'.repeat(64),boundedReadCount:28,sourceCandidateCount:28,usableQuestionCount:28,heldQuestionCount:0,huroofAvailable:false,categories:categories.map(id=>({id,labelAr:id,sourceOnly:false,questionCount:14,heldQuestionCount:0,classicQuestionCount:13,huroofQuestionCount:0,categoryGameEligible:true,availability:'ready' as const}))}};
  const service=new AuthoritativeGameService({dbPath:join(dir,'room.sqlite'),secret:'fixture-only',boardNonce:()=>nonce,localFirestoreQuestionSource:source});
  try{const host=service.create('fixture-host',true,{gameKind:'categories',categories});let revision=host.revision;const send=async(type:string,payload:Record<string,unknown>={})=>{const r=await service.intent(host.roomId,host.token,{type:type as never,intentId:`${type}-${revision}`,expectedRevision:revision,payload});revision=r.revision;return r};await send('START_MATCH');await send('ROUND_READY');const cell=service.metadata(host.roomId,host.token).projection.board!.find(c=>c.categoryId===categories[0])!;const result=await send('SELECT_CELL',{cellId:cell.id});assert.equal(result.projection.projection.question?.promptAr,questions[0].promptAr);const projected=result.projection.projection.question!;assert.equal('youtube' in (projected.media??{}),false);const audience=service.createAudienceCapability(host.roomId);assert.equal(service.metadata(host.roomId,audience).projection.question?.revealedAnswer,undefined);const ticket=service.issueCurrentQuestionMedia(host.roomId,host.token,{mediaId:media.mediaId,assetSha256:media.assetSha256});const got=await service.readCurrentQuestionMedia(ticket.ticket,host.token);assert.equal(got.contentType,'application/vnd.huroof.youtube+json');assert.deepEqual(JSON.parse(got.bytes.toString()),youtube);await send('REVEAL_ANSWER',{occurrence:projected.occurrence});assert.equal(service.metadata(host.roomId,audience).projection.question?.revealedAnswer,'رشا رزق');}finally{service.close()}
 }finally{for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v}await rm(dir,{recursive:true,force:true})}
});
