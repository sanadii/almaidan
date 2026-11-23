import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../../scripts/firestore-release-canonical.js";
import { validIntent, type CanonicalMember, type CanonicalRoom, type GameIntent } from "../../../../../functions/src/game.js";
import type { CanonicalChallengeDefinition } from "../../../../../src/features/game/challenges/definition.js";
import { createChallengeState, reconcileChallengeDeadline, reduceChallenge, type ChallengeIntent, type Participant } from "../../../../../src/features/game/challenges/engine.js";
import { compactChallengeState, restoreChallengeState } from "../../../../../src/features/game/challenges/integration.js";
import { applyChallengeAward, applyChallengeContinuation, createChallengeBridgeContext } from "../../../../../src/features/game/challenges/award-bridge.js";
import { reduceGame } from "../../../../../src/features/game/domain/lifecycle.js";
import { assertChallengeDefinitionBinding } from "../../../../../src/features/game/challenges/integration.js";
import { readGameplayQuestions } from "./content-reader";
import { definitionForQuestion } from "./definition-reader";
import { projectForMember } from "./projection";
import { requireHosting, type AuthenticatedContext } from "./identity-policy";
import type { CommandRepository } from "./repository";
import { assertGameplayConfig } from "./profile";

export interface DeadlineFence {occurrence:string;challengeRevision:number;stage:string;observedDeadlineMs:number}
export interface DeadlineIntent {type:"SERVER_CHALLENGE_DEADLINE";intentId:string;expectedRevision:number;payload:DeadlineFence}

/** Called exactly once for a newly selected challenge occurrence after trusted content preparation. */
export function createChallengeOccurrence(room:CanonicalRoom,members:CanonicalMember[],definition:CanonicalChallengeDefinition,now:number):CanonicalRoom {
 const question=room.activeQuestion,occurrence=room.activeQuestionOccurrence,cell=room.game.activeCellId,team=room.game.entitledTeam,hosts=members.filter(m=>m.active && m.role==="host");
 if(!question?.challenge || !occurrence || !cell || !team || !room.config.challenge || hosts.length!==1 || !Number.isSafeInteger(now) || now<0 || room.challenge?.occurrence===occurrence || !room.config.challenge.mechanics.includes(definition.kind) || !room.config.challenge.definitionSchemas?.includes(definition.schemaVersion) || question.challenge.definition.id!==definition.id || question.challenge.definition.definitionSha256!==definition.definitionSha256 || question.challenge.definition.schemaVersion!==definition.schemaVersion) throw new Error("CHALLENGE_OCCURRENCE_UNAVAILABLE");
 assertChallengeDefinitionBinding(definition,question);
 if(definition.kind==="navigation" && !members.some(m=>m.active && m.role==="player" && m.team===team)) throw new Error("CHALLENGE_GUIDE_UNAVAILABLE");
 const challenge=createChallengeState(definition,occurrence,team,now,{hostUid:hosts[0].uid,protocolHash:room.config.challenge.protocolVersion,assignmentHash:`${occurrence}:${room.revision}`,stimulusHash:definition.definitionSha256});
 const {timer:_timer,buzzWinner:_buzzWinner,...withoutTimer}=room;
 return {...withoutTimer,game:reduceGame(room.game,{type:"BUZZ_ACCEPTED",team}),challenge:compactChallengeState(challenge),challengeBridge:createChallengeBridgeContext(occurrence,cell)};
}

/** Build the server-only CAS intent from the persisted occurrence, never transport input. */
export function challengeDeadlineIntent(namespace:string,roomId:string,matchId:string,room:CanonicalRoom,now:number):DeadlineIntent|null {
 if(!namespace || !roomId || !matchId || !Number.isSafeInteger(now) || now<0 || !Number.isSafeInteger(room.revision) || room.revision<0) throw new Error("CHALLENGE_DEADLINE_UNAVAILABLE");
 const challenge=room.challenge;
 if(!challenge || challenge.paused || challenge.deadlineAt===undefined || challenge.deadlineAt>now || challenge.result) return null;
 if(!Number.isSafeInteger(challenge.deadlineAt) || challenge.deadlineAt<0 || !room.challengeBridge || room.challengeBridge.activeOccurrence!==challenge.occurrence || room.challengeBridge.selectedCellId!==room.game.activeCellId) throw new Error("CHALLENGE_DEADLINE_UNAVAILABLE");
 const payload={occurrence:challenge.occurrence,challengeRevision:challenge.revision,stage:challenge.stage,observedDeadlineMs:challenge.deadlineAt};
 const digest=createHash("sha256").update(canonicalJson([namespace,roomId,matchId,payload.occurrence,payload.challengeRevision,payload.stage,payload.observedDeadlineMs,room.revision])).digest("hex");
 return {type:"SERVER_CHALLENGE_DEADLINE",intentId:`:challenge-expiry:${digest}`,expectedRevision:room.revision,payload};
}

/** Pure transition only; caller must commit via the existing authenticated CAS closure. */
export function reconcileChallengeObservation(room:CanonicalRoom,definition:CanonicalChallengeDefinition,fence:DeadlineFence,now:number):CanonicalRoom {
 const persisted=room.challenge, bridge=room.challengeBridge;
 if(!persisted || !bridge || persisted.paused || persisted.occurrence!==fence.occurrence || persisted.revision!==fence.challengeRevision || persisted.stage!==fence.stage || persisted.deadlineAt!==fence.observedDeadlineMs || !Number.isSafeInteger(now) || now<fence.observedDeadlineMs || bridge.activeOccurrence!==persisted.occurrence || bridge.selectedCellId!==room.game.activeCellId || definition.id!==persisted.definitionId || definition.definitionSha256!==persisted.definitionHash) throw new Error("CHALLENGE_DEADLINE_STALE");
 const current=restoreChallengeState(persisted), next=reconcileChallengeDeadline(definition,current,now);
 if(next===current) throw new Error("CHALLENGE_DEADLINE_STALE");
 let game=room.game, context=bridge, challenge=next;
 if(next.result==="correct") { const applied=applyChallengeAward(next,game,context);game=applied.game;context=applied.context;challenge=applied.challenge; }
 return {...room,revision:room.revision+1,game,challenge:compactChallengeState(challenge),challengeBridge:context};
}

/** Shared authenticated observation gate. SQL must independently deny any expired snapshot it reads. */
export async function reconcileForObservation(context:AuthenticatedContext,roomId:string,generation:number,repository:CommandRepository,clock:()=>number):Promise<void> {
 for(let attempt=0;attempt<3;attempt++) {
 const snapshot=await repository.loadCommand(context,roomId,generation,":observation:");
 if(snapshot.roomId!==roomId || snapshot.generation!==generation || snapshot.actor.uid!==context.principal.uid || !snapshot.actor.active || snapshot.members.filter(m=>m.active && m.uid===context.principal.uid).length!==1) throw new Error("OBSERVATION_UNAVAILABLE");
 if(snapshot.actor.role==="host") requireHosting(context);
 if(!snapshot.room.challenge || snapshot.room.challenge.continued) return;
 const pin=await repository.readPinnedContent(context,snapshot);
 if(pin.namespace!==context.policy.namespace || pin.projectId!==context.principal.projectId || pin.configReleaseId!==snapshot.room.config.releaseId || pin.configHuroofRoot!==snapshot.room.config.releaseRootSha256) throw new Error("OBSERVATION_UNAVAILABLE");
 const loaded=readGameplayQuestions(pin,snapshot.room.config.categories??[]),question=snapshot.room.activeQuestion;
 if(!loaded.supplement || !question?.challenge) throw new Error("OBSERVATION_UNAVAILABLE");assertGameplayConfig(loaded.profile,snapshot.room.config);
 const definition=definitionForQuestion(loaded.supplement,question),now=clock(),intent=challengeDeadlineIntent(context.policy.namespace,roomId,snapshot.matchId,snapshot.room,now);
 if(!intent) return;
 const next=reconcileChallengeObservation(snapshot.room,definition,intent.payload,now);
 const projections=snapshot.members.filter(member=>member.active).map(member=>({uid:member.uid,payload:projectForMember(roomId,next,snapshot.members,member.uid,now,{view:"member",definition})}));
 try {await repository.commitChallengeExpiry(context,snapshot,intent,next,projections);return;} catch(error) {
  const code=error && typeof error==="object" && "code" in error?(error as {code?:unknown}).code:undefined;
  const message=error instanceof Error?error.message:"";
  if(attempt===2 || !(code==="40001" || code==="40P01" || message.includes("command CAS unavailable"))) throw error;
 }
 }
}

/** Run an authenticated participant command against the exact loaded definition and durable bridge. */
export async function reduceChallengeCommand(room:CanonicalRoom,members:CanonicalMember[],actorUid:string,intent:GameIntent,definition:CanonicalChallengeDefinition,now:number,replaceFailed:(room:CanonicalRoom)=>Promise<CanonicalRoom>):Promise<CanonicalRoom> {
 if(!validIntent(intent) || !intent.type.startsWith("CHALLENGE_") || intent.expectedRevision!==room.revision || !Number.isSafeInteger(now) || now<0 || !room.challenge || !room.challengeBridge || !room.activeQuestionOccurrence || !room.activeQuestion?.challenge || !room.config.challenge) throw new Error("CHALLENGE_COMMAND_UNAVAILABLE");
 const active=members.filter(m=>m.active && m.uid===actorUid), hosts=members.filter(m=>m.active && m.role==="host");
 if(active.length!==1 || hosts.length!==1 || !active[0] || active[0].role==="audience" || room.challenge.occurrence!==room.activeQuestionOccurrence || room.challengeBridge.activeOccurrence!==room.challenge.occurrence || room.challengeBridge.selectedCellId!==room.game.activeCellId || definition.id!==room.challenge.definitionId || definition.definitionSha256!==room.challenge.definitionHash) throw new Error("CHALLENGE_COMMAND_UNAVAILABLE");
 const hostUid=hosts[0].uid;
 const participants:Participant[]=[...members.flatMap(m=>m.active && m.role==="player" && m.team ? [{kind:"member" as const,uid:`member:${m.uid}`,actorUid:m.uid,team:m.team}]:[]),...(room.manualParticipants??[]).map(p=>({kind:"manual" as const,id:`manual:${p.id}`,team:p.team,controllerUid:hostUid}))];
 const names:Record<string,ChallengeIntent["type"]>={CHALLENGE_ASSIGN:"ASSIGN",CHALLENGE_READY:"READY",CHALLENGE_START:"START",CHALLENGE_MOVE:"MOVE",CHALLENGE_SUBMIT:"SUBMIT",CHALLENGE_START_STEAL:"START_STEAL",CHALLENGE_DECLINE_STEAL:"DECLINE_STEAL",CHALLENGE_PAUSE:"PAUSE",CHALLENGE_RESUME:"RESUME",CHALLENGE_VOID:"VOID",CHALLENGE_REVEAL:"REVEAL",CHALLENGE_CONTINUE:"CONTINUE"};
 const type=names[intent.type],p=intent.payload; if(!type) throw new Error("CHALLENGE_COMMAND_UNAVAILABLE");
 const common={id:intent.intentId,actor:actorUid,payloadHash:createHash("sha256").update(canonicalJson(intent)).digest("hex"),occurrence:p.occurrence as string,revision:p.challengeRevision as number,expectedStage:p.stage as ChallengeIntent["expectedStage"],at:now};
 let command:ChallengeIntent;
 if(type==="ASSIGN") command={...common,type,assignment:p.assignment as "guide"|"mover"|"captain"|"stealCaptain",participantId:p.participantId as string};
 else if(type==="READY") command={...common,type,participantId:p.participantId as string,readiness:p.readiness as {protocolHash:string;assignmentHash:string;stimulusHash:string}};
 else if(type==="MOVE") command={...common,type,direction:p.direction as "north"|"east"|"south"|"west"};
 else if(type==="SUBMIT") command={...common,type,...(Array.isArray(p.answers)?{answers:p.answers as string[]}:{start:p.start as {row:number;column:number},end:p.end as {row:number;column:number}})};
 else command={...common,type} as ChallengeIntent;
 const current=restoreChallengeState(room.challenge);
 if(!current.paused && current.deadlineAt!==undefined && current.deadlineAt<=now) throw new Error("CHALLENGE_DEADLINE_RECONCILE_FIRST");
 const next=reduceChallenge(definition,current,command,participants,{hostUid,protocolHash:room.config.challenge.protocolVersion,assignmentHash:`${room.activeQuestionOccurrence}:${room.revision}`,stimulusHash:definition.definitionSha256});
 if(next===current || next.revision===current.revision) throw new Error("CHALLENGE_COMMAND_REJECTED");
 let working=room, game=room.game, bridge=room.challengeBridge, challenge=next;
 if(next.result==="correct") {const result=applyChallengeAward(next,game,bridge);game=result.game;bridge=result.context;challenge=result.challenge;}
 else if(next.continued) {
  if(room.config.gameKind==="categories") {working=await replaceFailed(structuredClone(room)); game=working.game;}
  const result=applyChallengeContinuation(next,game,bridge);game=result.game;bridge=result.context;challenge=result.challenge;
 }
 return {...working,revision:room.revision+1,game,challenge:compactChallengeState(challenge),challengeBridge:bridge};
}
