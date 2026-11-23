import type { GameIntent } from "../../../../../functions/src/game.js";
import { canonicalJson } from "../../../../../scripts/firestore-release-canonical.js";
import { authenticate, type IdentityDependencies } from "./identity-policy";
import { resolvePgLocator, parseLocator } from "./locator";
import { parseCommandDto } from "./types";
import { ChallengeDeadlineDue } from "./repository";
import { readPinnedQuestions, readPinnedGameplay, readGameplayQuestions, assertCategorySnapshot, requireCustody, parseCustodyPolicy, type CustodyEvidenceVerifier, type VerifiedCustody } from "./content-reader";
import { definitionForQuestion } from "./definition-reader";
import { challengeDeadlineIntent, reconcileChallengeObservation, reconcileForObservation, reduceChallengeCommand, createChallengeOccurrence } from "./challenge";
import { replaceFailedCell } from "../../../../../functions/src/content-preparation.js";
import { assertCapabilityOffer, assertGameplayConfig, assertGameplayOffer, parseGameplayProfile } from "./profile";
import { reduceCommand, reduceExpiry, sameResult } from "./reducer";
import { projectForMember } from "./projection";
import type { CommandRepository, SealedCommandOutcome } from "./repository";

const setupAndStart = new Set(["START_MATCH","LOBBY_SET_READY","LOBBY_ASSIGN_TEAM","LOBBY_ADD_MANUAL_PLAYER"]);
function equivalentIntent(a: GameIntent, b: GameIntent) { return canonicalJson(a)===canonicalJson(b); }
/** Dependencies are server-owned; neither transport body nor token claims select a repository or policy. */
export function createCommandService(identity: IdentityDependencies, repository: CommandRepository, clock: () => number, verifier?: CustodyEvidenceVerifier) {
 return async function command(token: string, body: unknown): Promise<SealedCommandOutcome> {
  const context=await authenticate(identity,token);
  const dto=parseCommandDto(body);
  const locator=await resolvePgLocator(context.policy.namespace,dto.locator,(namespace,code)=>repository.resolveLocator(namespace,code));
  const snapshot=await repository.loadCommand(context,locator.roomId,locator.roomGeneration,dto.intent.intentId);
  const actors=snapshot.members.filter(member=>member.uid===context.principal.uid && member.active);
  if(snapshot.roomId!==locator.roomId || snapshot.generation!==locator.roomGeneration || snapshot.room.roomCode!==locator.code || snapshot.actor.uid!==context.principal.uid || !snapshot.actor.active || actors.length!==1 || actors[0].role!==snapshot.actor.role || actors[0].team!==snapshot.actor.team || actors[0].ready!==snapshot.actor.ready) throw new Error("COMMAND_FORBIDDEN");
  if(snapshot.actor.role==="host") requireHosting(context);
  // Current authentication/member authority precedes replay; mutable phase and content checks do not.
  if(snapshot.receipt) { if(!equivalentIntent(snapshot.receipt.intent,dto.intent)) throw new Error("COMMAND_INTENT_CONFLICT"); const saved=snapshot.receipt.outcome; if(!Number.isSafeInteger(saved.revision) || !Number.isSafeInteger(saved.sequence)) throw new Error("DATABASE_RESPONSE_INVALID"); return {revision:saved.revision,sequence:saved.sequence,replayed:true}; }
  if(setupAndStart.has(dto.intent.type)) throw new Error("COMMAND_UNAVAILABLE");
  const now=clock(); if(!Number.isSafeInteger(now) || now<0) throw new Error("INVALID_SERVER_TIME");
  let pinPromise:ReturnType<CommandRepository["readPinnedContent"]>|undefined;
  let gameplay:ReturnType<typeof readGameplayQuestions>|undefined;
  const getPin=async()=>{pinPromise??=repository.readPinnedContent(context,snapshot);const pin=await pinPromise;if(pin.namespace!==context.policy.namespace || pin.projectId!==context.principal.projectId || pin.configReleaseId!==snapshot.room.config.releaseId || pin.configHuroofRoot!==snapshot.room.config.releaseRootSha256) throw new Error("PINNED_CONTENT_UNAVAILABLE");return pin;};
  const getGameplay=async()=>{if(gameplay) return gameplay;const pin=await getPin();gameplay=readGameplayQuestions(pin,snapshot.room.config.categories??[]);assertGameplayConfig(gameplay.profile,snapshot.room.config);if(gameplay.categorySnapshot) assertCategorySnapshot(gameplay.categorySnapshot,snapshot.room.config);return gameplay;};
  const getCustody=async()=>{const pin=await getPin();if(!verifier) throw new Error("CUSTODY_AUTHORITY_UNAVAILABLE");const policyRow=await repository.readCustodyPolicy(context.policy.namespace);if(!policyRow) throw new Error("CUSTODY_AUTHORITY_UNAVAILABLE");const trust=parseCustodyPolicy(policyRow,context.policy.namespace,context.principal.projectId,verifier.supportedEvidenceVersions);if(gameplay && (gameplay.profile.custody.policyRevision!==trust.authorityPolicyRevision || gameplay.profile.custody.policyHash!==trust.authorityPolicyHash)) throw new Error("CUSTODY_AUTHORITY_UNAVAILABLE");return requireCustody(pin,context.policy.revision,context.policy.hash,clock(),trust,verifier);};
  if(snapshot.room.challenge && !snapshot.room.challenge.continued) {
   const loaded=await getGameplay(),question=snapshot.room.activeQuestion;
   if(!loaded.supplement || !question?.challenge) throw new Error("PINNED_CONTENT_UNAVAILABLE");
   const definition=definitionForQuestion(loaded.supplement,question),expiry=challengeDeadlineIntent(context.policy.namespace,snapshot.roomId,snapshot.matchId,snapshot.room,now);
   if(expiry) {const next=reconcileChallengeObservation(snapshot.room,definition,expiry.payload,now),projections=snapshot.members.filter(member=>member.active).map(member=>({uid:member.uid,payload:projectForMember(snapshot.roomId,next,snapshot.members,member.uid,now,{view:"member",definition})}));const result=await repository.commitChallengeExpiry(context,snapshot,expiry,next,projections);return {...result,stale:true};}
   if(dto.intent.type.startsWith("CHALLENGE_")) {
    const next=await reduceChallengeCommand(snapshot.room,snapshot.members,context.principal.uid,dto.intent,definition,now,room=>replaceFailedCell(async()=>loaded.questions,room));
    const projections=snapshot.members.filter(member=>member.active).map(member=>({uid:member.uid,payload:projectForMember(snapshot.roomId,next,snapshot.members,member.uid,now,{view:"member",definition})}));
    const changed=Boolean(snapshot.previousTerminalRoom && next.game.lifecycle==="MATCH_COMPLETE" && !sameResult(snapshot.previousTerminalRoom,next));
    const custody=dto.intent.type==="CHALLENGE_CONTINUE" && snapshot.room.config.gameKind==="categories" && snapshot.room.challenge.result!=="correct"?await getCustody():undefined;
    try { return await repository.commitCommand(context,snapshot,dto.intent,next,snapshot.actor,undefined,dto.intent.type,changed,custody,snapshot.members,projections); }
    catch(error) {
     if(!(error instanceof ChallengeDeadlineDue)) throw error;
     // The fixed SQL transaction rejected the fresh attempt before effects. Reconcile once, then resolve the same request identity.
     try { await reconcileForObservation(context,snapshot.roomId,snapshot.generation,repository,clock); } catch { throw error; }
     let fresh:Awaited<ReturnType<CommandRepository["loadCommand"]>>;
     try { fresh=await repository.loadCommand(context,snapshot.roomId,snapshot.generation,dto.intent.intentId); } catch { throw error; }
     const current=fresh.members.filter(member=>member.uid===context.principal.uid && member.active);
     if(fresh.roomId!==snapshot.roomId || fresh.generation!==snapshot.generation || fresh.memberGeneration!==snapshot.memberGeneration || fresh.matchId!==snapshot.matchId || fresh.room.roomCode!==locator.code || fresh.actor.uid!==context.principal.uid || !fresh.actor.active || current.length!==1 || current[0].role!==fresh.actor.role || current[0].team!==fresh.actor.team || current[0].ready!==fresh.actor.ready) throw error;
     if(fresh.actor.role==="host") requireHosting(context);
     if(fresh.receipt) {
      if(!equivalentIntent(fresh.receipt.intent,dto.intent)) throw new Error("COMMAND_INTENT_CONFLICT");
      const saved=fresh.receipt.outcome;if(!Number.isSafeInteger(saved.revision) || !Number.isSafeInteger(saved.sequence)) throw new Error("DATABASE_RESPONSE_INVALID");
      return {revision:saved.revision,sequence:saved.sequence,replayed:true};
     }
     if(Number.isSafeInteger(fresh.room.revision) && Number.isSafeInteger(fresh.sequence) && fresh.room.revision>snapshot.room.revision && fresh.sequence>snapshot.sequence) return {revision:fresh.room.revision,sequence:fresh.sequence,replayed:false,stale:true};
     throw error;
    }
   }
   // An unresolved challenge owns the active occurrence and bridge. Ordinary
   // judge/award commands must not bypass its reducer or close the match early.
   throw new Error("CHALLENGE_COMMAND_REQUIRED");
  } else if(dto.intent.type.startsWith("CHALLENGE_")) throw new Error("COMMAND_UNAVAILABLE");
  const expired=reduceExpiry(snapshot.room,now);
  if(expired.revision!==snapshot.room.revision) {
   const projections=snapshot.members.filter(member=>member.active).map(member=>({uid:member.uid,payload:projectForMember(snapshot.roomId,expired,snapshot.members,member.uid,now)}));
   const result=await repository.commitExpiry(context,snapshot,expired,projections);
   return {revision:result.revision,sequence:result.sequence,replayed:result.replayed,stale:true};
  }
  if(snapshot.room.revision!==dto.intent.expectedRevision) throw new Error("STALE_REVISION");
  let admission: VerifiedCustody | undefined;
  const reader=async () => {
   const pin=await getPin();let version:unknown;try {version=(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(pin.profileRawBytes)) as {schemaVersion?:unknown}).schemaVersion;}catch {throw new Error("PINNED_CONTENT_UNAVAILABLE");}
   const questions=typeof version==="string" && version.startsWith("huroof-gameplay-profile-")?(await getGameplay()).questions:readPinnedQuestions(pin,snapshot.room.config.categories ?? []);
   admission=await getCustody();
   return questions;
  };
  const transition=await reduceCommand(snapshot.room,actors[0],dto.intent,now,snapshot.members,reader);
  if(["SELECT_CELL","LETTER_REVEALED","RETRY_CELL","RETURN_CELL","START_NEXT_ROUND"].includes(dto.intent.type) && !admission) await reader();
  let definition:import("../../../../../src/features/game/challenges/definition.js").CanonicalChallengeDefinition|undefined;
  if(transition.room.activeQuestion?.challenge && transition.room.activeQuestionOccurrence!==snapshot.room.challenge?.occurrence) {const loaded=await getGameplay();if(!loaded.supplement) throw new Error("PINNED_CONTENT_UNAVAILABLE");definition=definitionForQuestion(loaded.supplement,transition.room.activeQuestion);transition.room=createChallengeOccurrence(transition.room,snapshot.members,definition,now);}
  const resultChanged=Boolean(snapshot.previousTerminalRoom && transition.room.game.lifecycle==="MATCH_COMPLETE" && !sameResult(snapshot.previousTerminalRoom,transition.room));
  const members=snapshot.members.map(member=>member.uid===transition.member.uid ? transition.member : member.uid===transition.targetMember?.uid ? transition.targetMember : member);
  if(new Set(members.map(member=>member.uid)).size!==members.length) throw new Error("MEMBER_STATE_INVALID");
  const projections=members.filter(member=>member.active).map(member=>({uid:member.uid,payload:projectForMember(snapshot.roomId,transition.room,members,member.uid,now,definition?{view:"member",definition}:undefined)}));
  return repository.commitCommand(context,snapshot,dto.intent,transition.room,transition.member,transition.targetMember,transition.eventType,resultChanged,admission,members,projections);
 };
}

import { initialGameState } from "../../../../../src/features/game/domain/lifecycle.js";
import { requireHosting } from "./identity-policy";
import { parseCreateLobbyDto } from "./types";
import type { LobbyRepository, LobbyCreateOutcome, LobbyCreateIntent, LobbyState } from "./repository";
/** Free create stores only nonplayable setup. Client release values are expectations, not content authority. */
export function createLobbyService(identity: IdentityDependencies, repository: LobbyRepository) {
 return async function create(token: string, body: unknown): Promise<LobbyCreateOutcome> {
  const context=await authenticate(identity,token);
  const dto=parseCreateLobbyDto(body);
  const intent: LobbyCreateIntent={type:"CREATE_ROOM",intentId:dto.intentId,displayName:dto.displayName,config:dto.config};
  const saved=await repository.findCreate(context,intent);
  if(saved) return saved;
  requireHosting(context);
  const derived=await repository.deriveCreateIdentity(context,dto.intentId);
  const host={uid:context.principal.uid,role:"host" as const,displayName:dto.displayName,ready:true,active:true};
  const state: LobbyState={schemaVersion:"huroof-lobby-v1",room:{schemaVersion:2,roomCode:derived.code,revision:0,game:initialGameState(),config:dto.config,manualParticipants:[],questionCursor:0},members:[host],memberBindings:[{identityId:context.identityId,uid:context.principal.uid,generation:"1",version:"0"}]};
  return repository.createLobby(context,intent,state);
 };
}

import { admissionHash } from "../admission/huroof-protocol.cjs";
import { parsePaidStartDto } from "./types";
import type { PaidRepository, PaidOutcome } from "./repository";
/** First paid start only. Same-room post-terminal successor is unavailable before finance. */
export function createPaidStartService(identity: IdentityDependencies, repository: PaidRepository, clock: () => number, verifier?: CustodyEvidenceVerifier) {
 return async function start(token: string, body: unknown): Promise<PaidOutcome> {
  const context=await authenticate(identity,token);
  const client=parsePaidStartDto(body);
  const locator=await resolvePgLocator(context.policy.namespace,parseLocator(client.locator),(namespace,code)=>repository.resolveLocator(namespace,code));
  const ids=await repository.derivePaidIdentity(context,locator.roomId,client.intentId);
  const prior=await repository.findPaid(context,locator.roomId,ids,client);
  if(prior) return prior;
  requireHosting(context);
  const lobby=await repository.loadLobby(context,locator.roomId,locator.roomGeneration);
  if(lobby.actor.uid!==context.principal.uid || lobby.actor.role!=="host" || !lobby.actor.active || lobby.state.room.roomCode!==locator.code || lobby.state.room.revision!==client.expectedRevision || lobby.state.room.game.lifecycle!=="LOBBY") throw new Error("LOBBY_UNAVAILABLE");
  if(lobby.state.room.config.challenge != null) throw new Error("GAMEPLAY_PROFILE_UNAVAILABLE");
  const pin=await repository.readLobbyContent(context,lobby,client.profileScope);
  if(pin.namespace!==context.policy.namespace || pin.projectId!==context.principal.projectId || pin.profileScope!==client.profileScope || pin.configReleaseId!==lobby.state.room.config.releaseId || pin.configHuroofRoot!==lobby.state.room.config.releaseRootSha256) throw new Error("PINNED_CONTENT_UNAVAILABLE");
  let version:unknown;try {version=(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(pin.profileRawBytes)) as {schemaVersion?:unknown}).schemaVersion;}catch {throw new Error("PINNED_CONTENT_UNAVAILABLE");}
  if(typeof version==="string" && version.startsWith("huroof-gameplay-profile-") && parseGameplayProfile(pin.profileRawBytes,pin.profileArtifactHash).challenge!==null) throw new Error("GAMEPLAY_PROFILE_UNAVAILABLE");
  const gameplay=typeof version==="string" && version.startsWith("huroof-gameplay-profile-")?readGameplayQuestions(pin,lobby.state.room.config.categories??[]):null;
  if(gameplay) {assertGameplayConfig(gameplay.profile,lobby.state.room.config);assertGameplayOffer(gameplay.profile,client.offer);}
  const questions=gameplay?.questions??readPinnedQuestions(pin,lobby.state.room.config.categories ?? []);
  if(!verifier) throw new Error("CUSTODY_AUTHORITY_UNAVAILABLE");
  const policyRow=await repository.readCustodyPolicy(context.policy.namespace);
  if(!policyRow) throw new Error("CUSTODY_AUTHORITY_UNAVAILABLE");
  const trust=parseCustodyPolicy(policyRow,context.policy.namespace,context.principal.projectId,verifier.supportedEvidenceVersions);
  if(gameplay && (gameplay.profile.custody.policyRevision!==trust.authorityPolicyRevision || gameplay.profile.custody.policyHash!==trust.authorityPolicyHash)) throw new Error("CUSTODY_AUTHORITY_UNAVAILABLE");
  const custody=await requireCustody(pin,context.policy.revision,context.policy.hash,clock(),trust,verifier);
  const gameIntent={type:"START_MATCH" as const,intentId:client.intentId,expectedRevision:client.expectedRevision,payload:{}};
  const now=clock();
  let resolvedRoom=lobby.state.room;
  if(gameplay?.profile.gameKind==='categories') {if(!gameplay.categorySnapshot || Object.hasOwn(lobby.state.room.config,'categorySnapshot')) throw new Error('PINNED_CONTENT_UNAVAILABLE');resolvedRoom=structuredClone(lobby.state.room);resolvedRoom.config.categorySnapshot=structuredClone(gameplay.categorySnapshot);}
  const transition=await reduceCommand(resolvedRoom,lobby.actor,gameIntent,now,lobby.state.members,async()=>questions);
  const projections=lobby.state.members.filter(member=>member.active).map(member=>({uid:member.uid,payload:projectForMember(lobby.roomId,transition.room,lobby.state.members,member.uid,now)}));
  const config=transition.room.config;
  if(gameplay?.profile.gameKind==='categories' && (new TextEncoder().encode(JSON.stringify(config)).length>262144 || new TextEncoder().encode(JSON.stringify(transition.room)).length>262144 || projections.some(p=>new TextEncoder().encode(JSON.stringify(p.payload)).length>262144))) throw new Error('PINNED_CONTENT_UNAVAILABLE');
  const intent={namespace:context.policy.namespace,roomId:lobby.roomId,requestKey:client.intentId,logicalMatchId:ids.logicalMatchId,profileScope:client.profileScope,policyRevision:context.policy.revision,policyHash:context.policy.hash,selectorVersion:pin.selectorVersion,readinessPolicyVersion:pin.readinessPolicyVersion,admissionId:ids.admissionId,matchId:ids.matchId,roomGeneration:String(lobby.generation),lobbyRevision:String(lobby.state.room.revision),lobbyStateHash:lobby.stateHash,preparedRoom:transition.room,preparedMembers:lobby.state.members,custody,clientIntent:client};
  const initial={config,configHash:admissionHash(config)};
  for(let attempt=0;attempt<3;attempt++) {
   try { return await repository.startPaid(context,ids,intent,initial,projections); }
   catch(error) {
    const code=error && typeof error==="object" && "code" in error ? (error as {code?:unknown}).code : undefined;
    if(code==="08006" || code==="08007") { const resolved=await repository.findPaid(context,lobby.roomId,ids,client); if(resolved) return resolved; throw new Error("COMMIT_UNKNOWN"); }
    if((code==="40001" || code==="40P01") && attempt<2) continue;
    throw error;
   }
  }
  throw new Error("START_RETRY_EXHAUSTED");
 };
}

import { MAX_AUDIENCE, MAX_PLAYERS, validateDisplayName } from "../../../../../functions/src/game.js";
import { parseLobbyCommandDto } from "./types";
export function createLobbyCommandService(identity: IdentityDependencies, repository: LobbyRepository, clock: () => number) {
 return async function lobbyCommand(token: string, body: unknown): Promise<import("./repository").LobbyOutcome> {
  const context=await authenticate(identity,token), dto=parseLobbyCommandDto(body);
  const locator=await resolvePgLocator(context.policy.namespace,parseLocator(dto.locator),(namespace,code)=>repository.resolveLocator(namespace,code));
  const receipt=await repository.findLobbyReceipt(context,locator.roomId,dto.intent);
  if(receipt) return receipt;
  const snapshot=dto.intent.type==="JOIN_ROOM" ? await repository.loadJoinLobby(context,locator.roomId,locator.roomGeneration) : await repository.loadLobby(context,locator.roomId,locator.roomGeneration);
  const state=structuredClone(snapshot.state);
  if(state.room.roomCode!==locator.code || state.room.revision!==dto.intent.expectedRevision || state.room.game.lifecycle!=="LOBBY") throw new Error("LOBBY_UNAVAILABLE");
  if(dto.intent.type==="JOIN_ROOM") {
   const payload=dto.intent.payload, players=state.members.filter(member=>member.active && member.role==="player"), manual=state.room.manualParticipants ?? [];
   assertCapabilityOffer(state.room.config.challenge??null,payload.offer);
   if(state.members.some(member=>member.uid===context.principal.uid) || (payload.role==="player" && players.length+manual.length>=MAX_PLAYERS) || (payload.role==="audience" && state.members.filter(member=>member.active && member.role==="audience").length>=MAX_AUDIENCE)) throw new Error("LOBBY_UNAVAILABLE");
   const horizontal=players.filter(member=>member.team==="horizontal").length+manual.filter(member=>member.team==="horizontal").length;
   const vertical=players.filter(member=>member.team==="vertical").length+manual.filter(member=>member.team==="vertical").length;
   const member={uid:context.principal.uid,role:payload.role,displayName:payload.displayName,ready:false,active:true,...(payload.role==="player" ? {team:horizontal<=vertical ? "horizontal" as const : "vertical" as const} : {})};
   state.members.push(member); state.memberBindings.push({identityId:context.identityId,uid:context.principal.uid,generation:"1",version:"0"}); state.room.revision++;
  } else {
   const actor=(snapshot as import("./repository").LobbySnapshot).actor;
   if(!actor || actor.uid!==context.principal.uid || !actor.active) throw new Error("LOBBY_UNAVAILABLE");
   if(actor.role==="host") requireHosting(context);
   if(dto.intent.type==="LOBBY_ADD_MANUAL_PLAYER" && validateDisplayName(dto.intent.payload.displayName)!==dto.intent.payload.displayName) throw new Error("INVALID_REQUEST");
   const manualId=dto.intent.type==="LOBBY_ADD_MANUAL_PLAYER" ? await repository.deriveManualIdentity(context,locator.roomId,dto.intent.intentId) : undefined;
   const reduced=await reduceCommand(state.room,actor,dto.intent,clock(),state.members,async()=>{throw new Error("UNEXPECTED_CONTENT_READ");},manualId);
   state.room=reduced.room;
   state.members=state.members.map(member=>member.uid===reduced.member.uid ? reduced.member : member.uid===reduced.targetMember?.uid ? reduced.targetMember : member);
  }
  return repository.commitLobby(context,snapshot,dto.intent,state);
 };
}

export function createProjectionService(identity: IdentityDependencies, repository: CommandRepository, memberRead: import("../realtime/repository").RealtimeRepository["read"], clock: () => number) {
 return async function projection(token: string, body: unknown) {
  const context=await authenticate(identity,token);
  if(!body || typeof body!=="object" || Array.isArray(body) || !["locator","locator|offer"].includes(Object.keys(body).sort().join("|")) || typeof (body as {locator?:unknown}).locator!=="string") throw new Error("INVALID_REQUEST");
  const offer=(body as {offer?:unknown}).offer;if(Object.hasOwn(body,"offer")) try {assertCapabilityOffer(null,offer);} catch {throw new Error("INVALID_REQUEST");}
  const locator=await resolvePgLocator(context.policy.namespace,parseLocator((body as {locator:string}).locator),(namespace,code)=>repository.resolveLocator(namespace,code));
  const snapshot=await repository.loadCommand(context,locator.roomId,locator.roomGeneration,":view:");
  const actors=snapshot.members.filter(member=>member.uid===context.principal.uid && member.active);
  if(snapshot.roomId!==locator.roomId || snapshot.generation!==locator.roomGeneration || snapshot.room.roomCode!==locator.code || actors.length!==1 || snapshot.actor.uid!==context.principal.uid || !snapshot.actor.active || actors[0].role!==snapshot.actor.role || !Number.isSafeInteger(snapshot.memberGeneration) || snapshot.memberGeneration<1) throw new Error("PROJECTION_FORBIDDEN");
  if(snapshot.actor.role==="host") requireHosting(context);
  const deliver=async()=>{const fresh=await authenticate(identity,token);if(fresh.identityId!==context.identityId || fresh.principal.uid!==context.principal.uid || fresh.principal.projectId!==context.principal.projectId || fresh.policy.namespace!==context.policy.namespace || fresh.policy.revision!==context.policy.revision || fresh.policy.hash!==context.policy.hash) throw new Error("AUTH_CHANGED");const frame=await memberRead(fresh,{roomId:locator.roomId,roomGeneration:String(locator.roomGeneration),memberGeneration:String(snapshot.memberGeneration),afterSequence:null,afterRevision:null,...(offer===undefined?{}:{offer})});if(frame.roomId!==locator.roomId || frame.roomGeneration!==String(locator.roomGeneration) || frame.memberGeneration!==String(snapshot.memberGeneration) || frame.role!==snapshot.actor.role || frame.snapshot.roomId!==locator.roomId || frame.snapshot.projection.room.roomCode!==locator.code) throw new Error("PROJECTION_FORBIDDEN");if(frame.role==="host") requireHosting(fresh);return {...frame.snapshot,projection:{...frame.snapshot.projection}};};
  const pin=await repository.readPinnedContent(context,snapshot);let version:unknown;try {version=(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(pin.profileRawBytes)) as {schemaVersion?:unknown}).schemaVersion;}catch {throw new Error("PINNED_CONTENT_UNAVAILABLE");}
  if(typeof version==="string" && version.startsWith("huroof-gameplay-profile-")) {const loaded=readPinnedGameplay(pin);assertGameplayConfig(loaded.profile,snapshot.room.config);assertGameplayOffer(loaded.profile,offer);}
  if(snapshot.room.challenge && !snapshot.room.challenge.continued) {await reconcileForObservation(context,snapshot.roomId,snapshot.generation,repository,clock);return deliver();}
  const now=clock(); if(!Number.isSafeInteger(now) || now<0) throw new Error("INVALID_SERVER_TIME");
  const expired=reduceExpiry(snapshot.room,now);
  if(expired.revision!==snapshot.room.revision) {
   const projections=snapshot.members.filter(member=>member.active).map(member=>({uid:member.uid,payload:projectForMember(snapshot.roomId,expired,snapshot.members,member.uid,now)}));
   await repository.commitExpiry(context,snapshot,expired,projections);
  }
  return deliver();
 };
}
