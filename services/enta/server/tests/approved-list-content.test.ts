import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { admissionHash } from '../src/admission/huroof-protocol.cjs';
import { produceApprovedListContent, CONTENT01_ANCHORS, type ApprovedListInputs, type BoundRaw } from '../src/rounds/approved-list-content';
import { fixtureCompetitionCatalog, fixtureCompetitionStart, fixturePrincipal } from './enta-competition-fixture';
import { validateFormatCatalog } from '../src/rounds/selection';
import { validateCompetitionCatalog, productionCompetitionPolicy, PALETTE_ROOT, parseCompetitionStart, competitionProofRoot } from '../src/rounds/competition-rules';
import { validateNew5Descriptor } from '../src/rounds/competition-content';
import { selectCompetition, newCompetitionGame } from '../src/rounds/competition-selection';
import { reduceCompetitionCommand } from '../src/rounds/competition-engine';
import { randomUUID } from 'node:crypto';
import { productionFormatPolicy } from '../src/rounds/selection';
import { projectCompetition } from '../src/rounds/competition-projection';

const project = 'D:/projects/huroof_wa_oloof';
function bound(path:string,sha256:string):BoundRaw { const raw=readFileSync(resolve(project,path),'utf8'); return {raw,sha256}; }
function inputs():ApprovedListInputs { return {
 approval:bound('output/content-owner-review-20261025/private/OWNER-AUTHORING-APPROVAL.json',CONTENT01_ANCHORS.approval),
 bindings:bound('output/pro259-content-20261025/private/ROOT-REVIEW-BINDINGS.json',CONTENT01_ANCHORS.bindings),
 contentReview:bound('output/comp02-prerequisites-20261022/package/private/CONTENT-REVIEW-CARDS.md',CONTENT01_ANCHORS.contentReview),
 draft:bound('output/comp02-prerequisites-20261022/package/private/content/LIST-DRAFT.json',CONTENT01_ANCHORS.draft),
 expansion:bound('output/comp02-prerequisites-20261022/package/private/content/LIST-EXPANSION.json',CONTENT01_ANCHORS.expansion),
 settingsJson:bound('output/content-owner-review-20261025/private/REVIEW-SETTINGS-PROPOSAL.json',CONTENT01_ANCHORS.settingsJson),
 settingsMarkdown:bound('output/content-owner-review-20261025/private/REVIEW-SETTINGS-PROPOSAL.md',CONTENT01_ANCHORS.settingsMarkdown),
 }; }
const rehash=(raw:string)=>createHash('sha256').update(raw,'utf8').digest('hex');
const hash=(value:unknown)=>admissionHash(value);
function fixture(output:ReturnType<typeof produceApprovedListContent>) {
 const catalog=fixtureCompetitionCatalog(), category=catalog.base.categories.find(c=>c.format==='LIST_ITEMS')!;
 category.key=output.categoryKey; category.label='قوائم معرفية'; category.prompts=structuredClone(output.pins); category.cover=null;
 catalog.prompts=catalog.prompts.filter(p=>p.format!=='LIST_ITEMS'); catalog.prompts.push(...structuredClone(output.descriptors)); catalog.paletteRoot=PALETTE_ROOT; catalog.proofRoot=competitionProofRoot(catalog);
 return catalog;
}
function request() { const start=fixtureCompetitionStart('STANDALONE_LIST',['HINT','PASS','FREEZE']); start.setup.categories[0].key='approved_list_12'; start.setup.rules.turnSeconds=45; start.setup.rules.overallSeconds=300; return parseCompetitionStart(start,'STANDALONE_LIST'); }

test('C01-PINS builds an anchored deterministic 12/65/12 private successor and immutable revision lookup',()=>{
 const source=inputs(), before=JSON.stringify(source); const one=produceApprovedListContent(source), two=produceApprovedListContent(source);
 assert.equal(JSON.stringify({ ...one, lookup: undefined }),JSON.stringify({ ...two, lookup: undefined })); assert.equal(one.revisionId,'approved_list_content01_r2'); assert.notEqual(one.revisionHash,JSON.parse(readFileSync(resolve(project,'output/pro259-content-20261025/forge/pre-repair-r0/09-approved-list-successor.json'),'utf8')).revisionHash); const oldPack=JSON.parse(readFileSync(resolve(project,'output/pro259-content-20261025/forge/pre-repair-r0/09-approved-list-successor.json'),'utf8'));
 for(const current of one.pins){ const previous=oldPack.pins.find((p:any)=>p.sourceId===current.sourceId); assert.ok(previous); assert.equal(current.revisionId,previous.revisionId); assert.equal(current.prompt,previous.prompt); assert.deepEqual(current.items.map((i:any)=>[i.id,i.revisionId,i.ordinal,i.value,i.trap,i.mediaIds]),previous.items.map((i:any)=>[i.id,i.revisionId,i.ordinal,i.value,i.trap,i.mediaIds])); for(const item of current.items){const prior=previous.items.find((i:any)=>i.id===item.id); if(current.sourceId==='int4-list-draft-012'&&prior.text==='القعري') assert.equal(item.text,'القاعي'); else {assert.equal(item.text,prior.text); assert.equal(item.hash,prior.hash);} } } assert.equal(one.pins.length,12); assert.equal(one.pins.reduce((n,p)=>n+p.items.length,0),65); assert.equal(one.descriptors.reduce((n,p)=>n+p.hints.length,0),12);
 assert.ok(one.pins.every(p=>p.format==='LIST_ITEMS'&&p.target===null&&p.points===null&&p.media.length===0&&p.items.every(i=>i.value===100&&!i.trap&&i.mediaIds.length===0))); const draft=JSON.parse(source.draft.raw), expansion=JSON.parse(source.expansion.raw), bindings=JSON.parse(source.bindings.raw), approval=JSON.parse(source.approval.raw), settings=JSON.parse(source.settingsJson.raw);
 const rows=[...draft.candidates,...expansion.candidates];
 for (let index=0; index<12; index++) { const row=rows[index], card=one.metadata[index], auth=approval.cardApprovalBindings.find((x:any)=>x.cardId===row.id), binding=bindings.cards.find((x:any)=>x.cardId===row.id), hint=settings.cardTextHints.find((x:any)=>x.cardId===row.id); assert.equal(card.cardId,row.id); assert.equal(card.sourceUrl,row.source); assert.equal(card.sourceObservedAt,row.sourceObservedAt??null); assert.equal(card.sourceRevisionSha256,auth.sourceRevisionSha256); assert.equal(card.sourceRowHash,auth.queueDeclaredRowHash); assert.equal(card.ownerApproval.sha256,CONTENT01_ANCHORS.approval); assert.equal(card.ownerApproval.reviewer,approval.reviewer.displayName); assert.equal(card.ownerApproval.recordedAtKuwait,approval.recordedAtKuwait); assert.deepEqual(card.ownerApproval.cardBinding,{cardId:row.id,sourceRevisionSha256:auth.sourceRevisionSha256,queueDeclaredRowHash:auth.queueDeclaredRowHash}); assert.deepEqual(card.rules,binding.approvedJudgingRules); assert.equal(card.rights.decision,auth.rights.decision); assert.equal(card.rights.scope,auth.rights.scope); assert.equal(card.rights.externalMediaRightsGranted,false); assert.equal(card.historicalSource.status,'HELD'); assert.equal(card.historicalSource.rightsStatus,'UNREVIEWED'); assert.equal(card.historicalSource.editorialHold,row.editorialHold); assert.equal(card.authoringDecision,'APPROVED_BY_OWNER'); assert.deepEqual(card.sourceVerification,approval.sourceVerificationUpdates.find((u:any)=>u.cardId===row.id)??null); assert.equal(card.rootBinding.path,'output/pro259-content-20261025/private/ROOT-REVIEW-BINDINGS.json'); assert.equal(card.rootBinding.sha256,CONTENT01_ANCHORS.bindings); assert.deepEqual(card.rootBinding.cardAuthorizationEvidence,binding.authorizationEvidence); assert.equal(card.settingsApproval.decisionId,approval.settingsDecision.decisionId); assert.equal(card.settingsApproval.proposalId,approval.settingsDecision.proposalId); assert.equal(card.settingsApproval.jsonSha256,CONTENT01_ANCHORS.settingsJson); assert.equal(card.settingsApproval.markdownSha256,CONTENT01_ANCHORS.settingsMarkdown); assert.deepEqual(card.settingsApproval.approvedComponents,approval.settingsDecision.approvedComponents); assert.deepEqual(card.settingsApproval.authorizationEvidence,approval.settingsDecision.authorizationEvidence); assert.equal(one.descriptors[index].hints[0].text,hint.text.normalize('NFC')); assert.equal(card.ageRecommendation.suggestedAge,[1,2,4,7,8,10].includes(index+1)?12:16); assert.equal(card.orderRequired,index===5); assert.deepEqual(card.parents.map((p:any)=>p.sha256),[CONTENT01_ANCHORS.draft,CONTENT01_ANCHORS.expansion,CONTENT01_ANCHORS.contentReview,CONTENT01_ANCHORS.approval,CONTENT01_ANCHORS.bindings,CONTENT01_ANCHORS.settingsJson,CONTENT01_ANCHORS.settingsMarkdown]); }
 assert.equal(one.metadata[0].aliasConvenienceCoverage,'PARTIAL_CONVENIENCE_ONLY'); assert.equal(one.metadata[0].exclusionConvenienceCoverage,'PARTIAL_CONVENIENCE_ONLY'); assert.equal(one.pins.reduce((n,p)=>n+p.items.length,0),65); assert.equal(one.metadata[0].aliases['الأرض'].includes('الارض'),true); assert.ok(one.metadata[11].aliases['#english'].includes('bottom')); assert.ok(one.metadata[11].aliases['#english'].includes('beauty')); assert.equal((one.metadata[11].rules as any).acceptedEnglishNames.join(','),'up,down,charm,strange,top,bottom,beauty');
 assert.equal(one.settings.standaloneTurnSeconds,45); assert.equal(one.settings.standaloneOverallSeconds,300); assert.equal(one.settings.embeddedSharedSeconds,40); assert.deepEqual(one.settings.embeddedAids,['PHONE_A_FRIEND','MORE_HINT','PICK_ANSWERER','STEAL_POINTS']); assert.equal(one.settings.standaloneHintRequiresExternalGrapheme,true);
 assert.equal(one.descriptors.find(p=>p.sourceId==='int4-list-draft-012')?.items.at(-1)?.text,'القاعي');
 assert.ok(one.lookup({revisionId:one.revisionId,revisionHash:one.revisionHash,cardId:'int4-list-draft-012'})?.aliases['#english']?.includes('bottom'));
 assert.equal(one.lookup({revisionId:'wrong-revision',revisionHash:one.revisionHash,cardId:'int4-list-draft-012'}),null); assert.equal(one.lookup({revisionId:one.revisionId,revisionHash:'0'.repeat(64),cardId:'int4-list-draft-012'}),null); assert.equal(one.lookup({revisionId:one.revisionId,revisionHash:one.revisionHash,cardId:'missing-card'}),null); assert.equal(one.lookup({revisionId:one.revisionId,revisionHash:one.revisionHash,cardId:'int4-list-draft-001',answerId:''}),null);
 assert.equal(one.lookup({revisionId:one.revisionId,revisionHash:one.revisionHash,cardId:'int4-list-draft-001',answerId:one.pins[0].items[0].id})?.cardId,'int4-list-draft-001');
 assert.equal(one.lookup({revisionId:one.revisionId,revisionHash:one.revisionHash,cardId:'int4-list-draft-001',answerId:one.pins[1].items[0].id}),null);
 const row=one.lookup({revisionId:one.revisionId,revisionHash:one.revisionHash,cardId:'int4-list-draft-001'})!; assert.equal(Object.isFrozen(row),true); assert.throws(()=>Object.defineProperty(row.aliases,'bad',{value:['x']})); assert.equal(one.lookup({revisionId:one.revisionId,revisionHash:one.revisionHash,cardId:'int4-list-draft-001'})?.aliases.bad,undefined); assert.equal(Object.isFrozen(one.pins[0]),true); assert.equal(Object.isFrozen(one.pins[0].items[0]),true);
 const changed={...source,draft:{...source.draft,raw:source.draft.raw.replace('اذكر كواكب','اذكر نجوم')}}; assert.throws(()=>produceApprovedListContent(changed),/CONTENT01_TRUST_ANCHOR_MISMATCH/);
 const mutatedBindings=JSON.parse(source.bindings.raw); mutatedBindings.cards[0].approvedJudgingRules.orderRequired=true; const bindingRaw=JSON.stringify(mutatedBindings); const aliasChange={...source,bindings:{...source.bindings,raw:bindingRaw,sha256:rehash(bindingRaw)}}; assert.throws(()=>produceApprovedListContent(aliasChange),/CONTENT01_TRUST_ANCHOR_MISMATCH/);
 const exclusionBindings=JSON.parse(source.bindings.raw); exclusionBindings.cards[0].approvedJudgingRules.exclude.push('غير معتمد'); const exclusionRaw=JSON.stringify(exclusionBindings); assert.throws(()=>produceApprovedListContent({...source,bindings:{...source.bindings,raw:exclusionRaw,sha256:rehash(exclusionRaw)}}),/CONTENT01_TRUST_ANCHOR_MISMATCH/);
 const changedApproval=JSON.parse(source.approval.raw), changedMeta=JSON.parse(source.bindings.raw); changedApproval.cardApprovalBindings[0].rights.decision='NOT_APPROVED'; changedMeta.cards[0].approvedJudgingRules.acceptedVariants={'الأرض':['تغيير']}; const approvalRaw=JSON.stringify(changedApproval), metadataRaw=JSON.stringify(changedMeta); assert.throws(()=>produceApprovedListContent({...source,approval:{...source.approval,raw:approvalRaw,sha256:rehash(approvalRaw)},bindings:{...source.bindings,raw:metadataRaw,sha256:rehash(metadataRaw)}}),/CONTENT01_TRUST_ANCHOR_MISMATCH/);
 const missingDraft=JSON.parse(source.draft.raw); missingDraft.candidates.pop(); const missingRaw=JSON.stringify(missingDraft); assert.throws(()=>produceApprovedListContent({...source,draft:{...source.draft,raw:missingRaw,sha256:rehash(missingRaw)}}),/CONTENT01_TRUST_ANCHOR_MISMATCH/);
 const duplicateDraft=JSON.parse(source.draft.raw); duplicateDraft.candidates[1].id=duplicateDraft.candidates[0].id; const duplicateRaw=JSON.stringify(duplicateDraft); assert.throws(()=>produceApprovedListContent({...source,draft:{...source.draft,raw:duplicateRaw,sha256:rehash(duplicateRaw)}}),/CONTENT01_TRUST_ANCHOR_MISMATCH/);
 const duplicateAnswer=JSON.parse(source.draft.raw); duplicateAnswer.candidates[0].answers[1]=duplicateAnswer.candidates[0].answers[0]; const duplicateAnswerRaw=JSON.stringify(duplicateAnswer); assert.throws(()=>produceApprovedListContent({...source,draft:{...source.draft,raw:duplicateAnswerRaw,sha256:rehash(duplicateAnswerRaw)}}),/CONTENT01_TRUST_ANCHOR_MISMATCH/);
 const changedProposal=JSON.parse(source.settingsJson.raw); changedProposal.cardTextHints[0].text+=' غير'; const proposalRaw=JSON.stringify(changedProposal); assert.throws(()=>produceApprovedListContent({...source,settingsJson:{...source.settingsJson,raw:proposalRaw,sha256:rehash(proposalRaw)}}),/CONTENT01_TRUST_ANCHOR_MISMATCH/);
 const privateOutput=resolve(project,'output/content-owner-review-20261025/private/successors/content01/approved-list-successor-r2.json'); mkdirSync(dirname(privateOutput),{recursive:true}); writeFileSync(privateOutput,JSON.stringify({revisionId:one.revisionId,revisionHash:one.revisionHash,categoryKey:one.categoryKey,settings:one.settings,pins:one.pins,descriptors:one.descriptors,metadata:one.metadata},null,2));
 assert.equal(JSON.stringify(source),before);
});

test('C01-FORMAT targets produced descriptors, exercises exact semantic guards, and rejects stale hash material',()=>{
 const output=produceApprovedListContent(inputs()), baseline=fixture(output), sourceId='int4-list-draft-001';
 const descriptor=baseline.prompts.find(p=>p.sourceId===sourceId)!; const basePin=baseline.base.categories.flatMap(c=>c.prompts).find(p=>p.sourceId===sourceId)!;
 assert.ok(descriptor&&basePin); validateFormatCatalog(baseline.base); validateNew5Descriptor(descriptor); validateCompetitionCatalog(baseline);
 const expectCode=(fn:()=>unknown,code:string)=>assert.throws(fn,(error:any)=>error?.code===code,`expected ${code}`);
 for(const field of ['text','value','ordinal'] as const){ const changed=structuredClone(baseline); const pin=changed.base.categories.flatMap(c=>c.prompts).find(p=>p.sourceId===sourceId)!; if(field==='text') pin.items[0].text+=' tamper'; else if(field==='value') pin.items[0].value++; else pin.items[0].ordinal++; expectCode(()=>validateFormatCatalog(changed.base),'FORMAT_CATALOG_UNAVAILABLE'); }
 const widened=structuredClone(descriptor) as any; widened.authoringAliases={}; expectCode(()=>validateNew5Descriptor(widened),'INVALID_REQUEST');
 const rebind=(catalog:any,p:any)=>{ p.hintRoot=hash({hints:p.hints,graphemes:p.graphemes}); const {hints,graphemes,hintRoot,effectValue,effectValueSource,proofHash,...base}=p; p.proofHash=hash({version:'enta-competitive-1',baseHash:hash(base),hints,graphemes,hintRoot,effectValue,effectValueSource}); catalog.proofRoot=competitionProofRoot(catalog); };
 for(const mutate of [(p:any)=>p.hints[0].revisionId='wrong-revision',(p:any)=>p.hints[0].revisionHash='0'.repeat(64),(p:any)=>p.hints[0].contentHash='0'.repeat(64)]) { const changed=structuredClone(baseline); const p=changed.prompts.find((x:any)=>x.sourceId===sourceId)!; mutate(p); rebind(changed,p); expectCode(()=>validateCompetitionCatalog(changed),'HINT_PROOF_UNAVAILABLE'); }
 const foreign=structuredClone(baseline); const pin=foreign.base.categories.flatMap((c:any)=>c.prompts).find((p:any)=>p.sourceId===sourceId)!; pin.prompt+=' changed'; const {formatHash,...payload}=pin; pin.formatHash=hash({version:1,pin:payload}); foreign.proofRoot=competitionProofRoot(foreign); expectCode(()=>validateCompetitionCatalog(foreign),'COMPETITIVE_PROOF_UNAVAILABLE');
 const foreignDescriptor=structuredClone(baseline); const d=foreignDescriptor.prompts.find((p:any)=>p.sourceId===sourceId)!; d.items[0].value++; const {hints,graphemes,hintRoot,effectValue,effectValueSource,proofHash,...base}=d; d.proofHash=hash({version:'enta-competitive-1',baseHash:hash(base),hints,graphemes,hintRoot,effectValue,effectValueSource}); foreignDescriptor.proofRoot=competitionProofRoot(foreignDescriptor); expectCode(()=>validateCompetitionCatalog(foreignDescriptor),'COMPETITIVE_PROOF_UNAVAILABLE');
});

test('C01-SELECT real selector consumes approved list pins across fresh draws and rollover',()=>{
 const output=produceApprovedListContent(inputs()), catalog=fixture(output), req=request();
 const draws=[] as ReturnType<typeof selectCompetition>[], exposures=[] as {categoryKey:string;sourceNamespace:string;sourceId:string;cycle:number}[];
 for(let i=0;i<4;i++){const selected=selectCompetition(req,catalog,exposures,String(i).padStart(64,'0')); draws.push(selected); exposures.push(...selected.intent.selection.map(s=>({categoryKey:'approved_list_12',sourceNamespace:s.sourceNamespace,sourceId:s.sourceId,cycle:s.cycle})));}
 assert.ok(draws.slice(0,3).every(d=>d.pins.length===4));
 assert.equal(new Set(draws.slice(0,3).flatMap(d=>d.pins.map(p=>p.sourceId))).size,12);
 assert.equal(new Set(draws[3].pins.map(p=>p.sourceId)).size,4); assert.ok(draws[3].intent.selection.every(s=>s.cycle===2));
 assert.throws(()=>selectCompetition(req,catalog,[{categoryKey:'approved_list_12',sourceNamespace:'huroof-approved-list',sourceId:'not-a-card',cycle:-1}],String(9).padStart(64,'0')));
 const boundary=output.pins.slice(0,10).map(p=>({categoryKey:'approved_list_12',sourceNamespace:p.sourceNamespace,sourceId:p.sourceId,cycle:1}));
 const edge=selectCompetition(req,catalog,boundary,String(8).padStart(64,'0')); assert.equal(new Set(edge.pins.map(p=>p.sourceId)).size,4); assert.equal(edge.intent.selection.filter(s=>s.cycle===1).length,2); assert.equal(edge.intent.selection.filter(s=>s.cycle===2).length,2);
});

test('C01-CONSUME uses approved authored MORE_HINT and denies standalone grapheme hint without evidence',()=>{
 const output=produceApprovedListContent(inputs()), catalog=fixture(output), now=1000;
 const boardStart=fixtureCompetitionStart('MIXED_BOARD',['PHONE_A_FRIEND','MORE_HINT','STEAL_POINTS']); boardStart.setup.categories[0]={key:output.categoryKey,promptRefs:['int4-list-draft-001_prompt']};
 const boardRequest=parseCompetitionStart(boardStart,'MIXED_BOARD'), selected=selectCompetition(boardRequest,catalog,[],String(11).padStart(64,'0'));
 assert.deepEqual(selected.pins.filter(p=>p.format==='LIST_ITEMS').map(p=>p.sourceId),['int4-list-draft-001']);
 const game=newCompetitionGame(fixturePrincipal,'fixture-host-identity',boardRequest,selected.intent,selected.pins,catalog), round=game.rounds.find(r=>r.pin.sourceId==='int4-list-draft-001')!;
 let reduced=reduceCompetitionCommand(game,{type:'OPEN_ROUND',roundId:round.id,commandId:randomUUID(),expectedVersion:game.version},now);
 assert.equal(reduced.next.rounds.find(r=>r.id===round.id)?.deadline,now+40000); const beforeProjection=projectCompetition(reduced.next,now); assert.deepEqual(beforeProjection.currentRound?.hints,[]); assert.equal(JSON.stringify(beforeProjection).includes(round.pin.hints[0].text),false); assert.equal(JSON.stringify(beforeProjection).includes(round.pin.items[0].text),false);
 reduced=reduceCompetitionCommand(reduced.next,{type:'USE_AID',roundId:round.id,teamId:reduced.next.rounds.find(r=>r.id===round.id)!.currentTeamId!,aid:'MORE_HINT',commandId:randomUUID(),expectedVersion:reduced.next.version},now+1);
 assert.deepEqual(reduced.next.rounds.find(r=>r.id===round.id)?.revealedHintIds,[round.pin.hints[0].id]); const afterProjection=projectCompetition(reduced.next,now+1); assert.deepEqual(afterProjection.currentRound?.hints,[{id:round.pin.hints[0].id,text:output.descriptors[0].hints[0].text}]); assert.ok(round.pin.items.every(item=>!JSON.stringify(afterProjection).includes(item.text)),'all answer text remains private after hint disclosure'); assert.equal(round.pin.hints[0].text,output.descriptors[0].hints[0].text);
 const standaloneRequest=request(), standaloneSelection=selectCompetition(standaloneRequest,catalog,[],String(12).padStart(64,'0'));
 const standaloneGame=newCompetitionGame(fixturePrincipal,'fixture-host-identity',standaloneRequest,standaloneSelection.intent,standaloneSelection.pins,catalog), listRound=standaloneGame.rounds[0];
 const opened=reduceCompetitionCommand(standaloneGame,{type:'OPEN_ROUND',roundId:listRound.id,commandId:randomUUID(),expectedVersion:standaloneGame.version},now);
 assert.equal(opened.next.rounds[0].deadline,now+45000); assert.equal(opened.next.rounds[0].overallDeadline,now+300000);
 assert.throws(()=>reduceCompetitionCommand(opened.next,{type:'USE_AID',roundId:listRound.id,teamId:opened.next.rounds[0].currentTeamId!,aid:'HINT',commandId:randomUUID(),expectedVersion:opened.next.version},now+1),/HINT_UNAVAILABLE/);
 const timeout=reduceCompetitionCommand(opened.next,{type:'USE_AID',roundId:listRound.id,teamId:opened.next.rounds[0].currentTeamId!,aid:'HINT',commandId:randomUUID(),expectedVersion:opened.next.version},now+45001); assert.equal(timeout.rejection,'ROUND_TIME_EXPIRED'); assert.equal(timeout.next.rounds[0].phase,'TURN'); assert.equal(timeout.next.activeRoundId,listRound.id); assert.notEqual(timeout.next.rounds[0].currentTeamId,opened.next.rounds[0].currentTeamId); assert.equal(timeout.next.rounds[0].deadline,now+90000); assert.equal(timeout.next.rounds[0].overallDeadline,now+300000);
 const scoringGame=newCompetitionGame(fixturePrincipal,'fixture-host-identity',standaloneRequest,standaloneSelection.intent,standaloneSelection.pins,catalog), scoringRound=scoringGame.rounds[0];
 let scored=reduceCompetitionCommand(scoringGame,{type:'OPEN_ROUND',roundId:scoringRound.id,commandId:randomUUID(),expectedVersion:scoringGame.version},now);
 const scoringTeam=scored.next.teams.find(t=>t.id===scored.next.rounds[0].currentTeamId)!, answer=scored.next.rounds[0].pin.items[0];
 scored=reduceCompetitionCommand(scored.next,{type:'RECORD_ATTEMPT',roundId:scoringRound.id,teamId:scoringTeam.id,playerId:scoringTeam.players[0].id,itemId:answer.id,commandId:randomUUID(),expectedVersion:scored.next.version},now+1);
 const firstAttempt=scored.next.attempts[0]; scored=reduceCompetitionCommand(scored.next,{type:'PUBLIC_REVEAL',roundId:scoringRound.id,itemId:answer.id,commandId:randomUUID(),expectedVersion:scored.next.version},now+2); scored=reduceCompetitionCommand(scored.next,{type:'FINAL_RULING',roundId:scoringRound.id,itemId:answer.id,classifications:[[firstAttempt.id,true]],commandId:randomUUID(),expectedVersion:scored.next.version},now+2);
 assert.equal(scored.next.teams.find(t=>t.id===scoringTeam.id)?.score,100);
 assert.equal(scored.next.rounds[0].deadline,now+2+45000);
 assert.throws(()=>reduceCompetitionCommand(scored.next,{type:'RECORD_ATTEMPT',roundId:scoringRound.id,teamId:scoringTeam.id,playerId:scoringTeam.players[0].id,itemId:answer.id,commandId:randomUUID(),expectedVersion:scored.next.version},now+3),/ATTEMPT_UNAVAILABLE/);
 assert.throws(()=>reduceCompetitionCommand(scored.next,{type:'RECORD_ATTEMPT',roundId:scoringRound.id,teamId:scoringTeam.id,playerId:scoringTeam.players[0].id,itemId:'unlisted-answer-id',commandId:randomUUID(),expectedVersion:scored.next.version},now+3),/MATCH_NOT_FOUND/);
 const nextAnswer=scored.next.rounds[0].pin.items[1]; scored=reduceCompetitionCommand(scored.next,{type:'RECORD_ATTEMPT',roundId:scoringRound.id,teamId:scoringTeam.id,playerId:scoringTeam.players[0].id,itemId:nextAnswer.id,commandId:randomUUID(),expectedVersion:scored.next.version},now+3);
 const wrongAttempt=scored.next.attempts.at(-1)!; scored=reduceCompetitionCommand(scored.next,{type:'PUBLIC_REVEAL',roundId:scoringRound.id,itemId:nextAnswer.id,commandId:randomUUID(),expectedVersion:scored.next.version},now+4); scored=reduceCompetitionCommand(scored.next,{type:'FINAL_RULING',roundId:scoringRound.id,itemId:nextAnswer.id,classifications:[[wrongAttempt.id,false]],commandId:randomUUID(),expectedVersion:scored.next.version},now+4);
 assert.equal(scored.next.teams.find(t=>t.id===scoringTeam.id)?.score,100); assert.equal(standaloneRequest.setup.rules.embeddedStealCap,200);
 const capGame=newCompetitionGame(fixturePrincipal,'fixture-host-identity',standaloneRequest,standaloneSelection.intent,standaloneSelection.pins,catalog), capRound=capGame.rounds[0]; const capOpen=reduceCompetitionCommand(capGame,{type:'OPEN_ROUND',roundId:capRound.id,commandId:randomUUID(),expectedVersion:capGame.version},now); const capped=reduceCompetitionCommand(capOpen.next,{type:'USE_AID',roundId:capRound.id,teamId:capOpen.next.rounds[0].currentTeamId!,aid:'HINT',commandId:randomUUID(),expectedVersion:capOpen.next.version},now+300001); assert.equal(capped.rejection,'ROUND_TIME_EXPIRED'); assert.equal(capped.next.rounds[0].phase,'RESOLVED'); assert.equal(capped.next.rounds[0].reason,'TIME_EXPIRED'); assert.equal(capped.next.rounds[0].deadline,null); assert.equal(capped.next.rounds[0].overallDeadline,null); assert.equal(capped.next.activeRoundId,null);
});

test('C01-DENY preserves current production policy denials',()=>{
 const output=produceApprovedListContent(inputs()), catalog=fixture(output);
 assert.throws(()=>productionFormatPolicy(catalog.base),(e:any)=>e?.code==='FORMAT_RECEIPT_POLICY_UNAVAILABLE'); assert.throws(()=>productionCompetitionPolicy(catalog),(e:any)=>e?.code==='COMPETITIVE_RECEIPT_POLICY_UNAVAILABLE');
});














