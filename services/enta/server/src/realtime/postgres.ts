import { requireHosting, type AuthenticatedContext } from '../huroof-pg/identity-policy';
import type { CommandRepository, QueryBoundary } from '../huroof-pg/repository';
import { projectForMember } from '../huroof-pg/projection';
import { exactEnum, parsePgFrame } from '../../../../../src/features/game/runtime/pg-recovery';
import { decimal } from './contracts';
import type { RealtimeRepository } from './repository';
import { canonicalJson } from '../../../../../scripts/firestore-release-canonical.js';
import { readGameplayQuestions, readPinnedGameplay, assertCategorySnapshot } from '../huroof-pg/content-reader';
import { definitionForQuestion } from '../huroof-pg/definition-reader';
import { assertCapabilityOffer, assertGameplayConfig, assertGameplayOffer } from '../huroof-pg/profile';
import { decodeStoredRoom } from '../huroof-pg/storage-codec';

const query = 'SELECT public.eng03_04_realtime_read($1,$2,$3,$4,$5,$6::bigint,$7,$8,$9::bigint,$10::bigint,$11::bigint) AS value';
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function postgresRealtimeRepository(db: QueryBoundary, commands?:CommandRepository): RealtimeRepository {
 return { async read(context, request) {
  if (!decimal(request.roomGeneration) || request.roomGeneration === '0' || (request.memberGeneration !== null && (!decimal(request.memberGeneration) || request.memberGeneration === '0')) || (request.afterSequence === null) !== (request.afterRevision === null) || (request.afterSequence !== null && (!decimal(request.afterSequence) || !decimal(request.afterRevision)))) throw new Error('INVALID_REQUEST');
  const args=[context.policy.namespace,context.identityId,context.principal.projectId,context.principal.uid,request.roomId,request.roomGeneration,context.policy.revision,context.policy.hash,request.memberGeneration,request.afterSequence,request.afterRevision];
  const rows=(await db.query<{value:unknown}>(query,args)).rows;
  if (rows.length !== 1 || !obj(rows[0].value)) throw new Error('READ_UNAVAILABLE');
  const value=rows[0].value; let observedReadAt=value.readAt;const keys=['schemaVersion','namespace','projectId','roomId','roomGeneration','memberGeneration','policyRevision','policyHash','principal','role','stage','revision','throughSequence','readAt','internalSnapshot','terminal','replay'];
  if (Object.keys(value).length!==keys.length || !keys.every(k=>Object.hasOwn(value,k)) || value.schemaVersion!=='huroof-realtime-internal-v1' || value.namespace!==context.policy.namespace || value.projectId!==context.principal.projectId || value.principal!==context.principal.uid || value.roomId!==request.roomId || value.roomGeneration!==request.roomGeneration || (request.memberGeneration!==null && value.memberGeneration!==request.memberGeneration) || value.policyRevision!==context.policy.revision || value.policyHash!==context.policy.hash || !exactEnum(value.role,['host','player','audience'])) throw new Error('READ_UNAVAILABLE');
  let snapshot: unknown=value.internalSnapshot;
  if (value.stage==='SETUP') {
   if (!obj(snapshot) || snapshot.schemaVersion!=='huroof-lobby-v1' || !obj(snapshot.room) || !Array.isArray(snapshot.members)) throw new Error('READ_UNAVAILABLE');
   const room=decodeStoredRoom(snapshot.room);assertCapabilityOffer(room.config.challenge??null,request.offer);
   snapshot=projectForMember(request.roomId,room,snapshot.members as never,context.principal.uid,Date.parse(String(value.readAt)));
  }
  if (!obj(snapshot) || !obj(snapshot.projection) || !obj(snapshot.projection.room)) throw new Error('READ_UNAVAILABLE');
  let projection=structuredClone(snapshot.projection);
  if(value.stage==='PAID') {
   if(!commands) throw new Error('READ_UNAVAILABLE');
   const current=await commands.loadCommand(context,request.roomId,Number(request.roomGeneration),':realtime:');
   if(current.actor.uid!==context.principal.uid || !current.actor.active || current.actor.role!==value.role || String(current.memberGeneration)!==value.memberGeneration || String(current.sequence)!==value.throughSequence || String(current.room.revision)!==value.revision) throw new Error('READ_UNAVAILABLE');
   const members=current.members.filter(m=>m.active && m.uid===context.principal.uid);if(members.length!==1 || members[0].role!==current.actor.role || members[0].team!==current.actor.team) throw new Error('READ_UNAVAILABLE');
   if(value.role==='player' && (!obj(projection.self) || projection.self.uid!==context.principal.uid || projection.self.team!==current.actor.team)) throw new Error('READ_UNAVAILABLE');
   const pin=await commands.readPinnedContent(context,current);let version:unknown;try {version=(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(pin.profileRawBytes)) as {schemaVersion?:unknown}).schemaVersion;}catch {throw new Error('READ_UNAVAILABLE');}
   if(typeof version==='string' && version.startsWith('huroof-gameplay-profile-')) {const loaded=readPinnedGameplay(pin);assertGameplayConfig(loaded.profile,current.room.config);assertGameplayOffer(loaded.profile,request.offer);}
   if(obj(projection.challenge) && (!current.room.challenge || current.room.challenge.continued)) throw new Error('READ_UNAVAILABLE');
   let definition:import('../../../../../src/features/game/challenges/definition').CanonicalChallengeDefinition|undefined;
   if(current.room.challenge && !current.room.challenge.continued) {
    const loaded=readGameplayQuestions(pin,current.room.config.categories??[]);assertGameplayConfig(loaded.profile,current.room.config);assertGameplayOffer(loaded.profile,request.offer);if(loaded.categorySnapshot) assertCategorySnapshot(loaded.categorySnapshot,current.room.config);
    if(!loaded.supplement || !current.room.activeQuestion?.challenge || !Number.isFinite(Date.parse(String(value.readAt)))) throw new Error('READ_UNAVAILABLE');
    definition=definitionForQuestion(loaded.supplement,current.room.activeQuestion);
   }
    if(typeof value.readAt!=='string' || !Number.isFinite(Date.parse(value.readAt))) throw new Error('READ_UNAVAILABLE');
    const canonical=projectForMember(request.roomId,current.room,current.members,context.principal.uid,Date.parse(value.readAt),{view:'member',definition});
    const normalized=(v:unknown)=>JSON.parse(JSON.stringify(v));
    // The stored timestamp is the commit-time observation; every other byte of
    // the transported snapshot must come from the current canonical projector.
    if(typeof snapshot.serverTime!=='string' || !/^(?:\+[0-9]{6}|[0-9]{4})-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(snapshot.serverTime) || !Number.isFinite(Date.parse(snapshot.serverTime)) || new Date(snapshot.serverTime).toISOString()!==snapshot.serverTime || canonicalJson(normalized({...snapshot,serverTime:canonical.serverTime}))!==canonicalJson(normalized(canonical))) throw new Error('READ_UNAVAILABLE');
    const again=(await db.query<{value:unknown}>(query,args)).rows;if(again.length!==1 || !obj(again[0].value)) throw new Error('READ_UNAVAILABLE');const fresh=again[0].value;
    if(Object.keys(fresh).length!==keys.length || !keys.every(k=>Object.hasOwn(fresh,k)) || keys.filter(k=>k!=='readAt').some(k=>canonicalJson(fresh[k])!==canonicalJson(value[k])) || typeof fresh.readAt!=='string' || !Number.isFinite(Date.parse(fresh.readAt)) || Date.parse(fresh.readAt)<Date.parse(value.readAt) || (current.room.challenge && !current.room.challenge.continued && !current.room.challenge.paused && current.room.challenge.deadlineAt!==undefined && current.room.challenge.deadlineAt<=Date.parse(fresh.readAt))) throw new Error('READ_UNAVAILABLE');
    observedReadAt=fresh.readAt;
    const observed=projectForMember(request.roomId,current.room,current.members,context.principal.uid,Date.parse(fresh.readAt),{view:'member',definition});
    snapshot=observed;projection=structuredClone(observed.projection);
  }
  if(value.stage==='SETUP' && obj(projection.room) && obj(projection.room.matchSettings)) delete projection.room.matchSettings.expectedRelease;
  snapshot={...snapshot,serverTime:observedReadAt,projection};
  const frame={ schemaVersion:'huroof-realtime-v1', namespace:value.namespace,projectId:value.projectId,roomId:value.roomId,roomGeneration:value.roomGeneration,memberGeneration:value.memberGeneration,policyRevision:value.policyRevision,policyHash:value.policyHash,principal:value.principal,role:value.role,stage:value.stage,revision:value.revision,throughSequence:value.throughSequence,readAt:observedReadAt,snapshot,terminal:value.terminal,replay:value.replay };
  const raw=JSON.stringify(frame);
  const parsed=parsePgFrame(raw,{backend:'pg',namespace:context.policy.namespace,engine:'huroof',profile:'classic',locator:'',roomId:request.roomId,roomGeneration:request.roomGeneration,principal:context.principal.uid,memberGeneration:String(value.memberGeneration),role:value.role as 'host'|'player'|'audience',view:'member',authEpoch:0,routeEpoch:0,viewEpoch:0},context.principal.projectId);
  if (parsed.snapshot.projection.room.state==='MATCH_COMPLETE' && !parsed.terminal) throw new Error('READ_UNAVAILABLE');
  return parsed;
 }, async readAudience(context,request) {
  if(!commands || !decimal(request.roomGeneration) || request.roomGeneration==='0' || (request.memberGeneration!==null && (!decimal(request.memberGeneration) || request.memberGeneration==='0')) || (request.afterSequence===null)!==(request.afterRevision===null) || (request.afterSequence!==null && (!decimal(request.afterSequence) || !decimal(request.afterRevision)))) throw new Error('READ_UNAVAILABLE');
  const args=[context.policy.namespace,context.identityId,context.principal.projectId,context.principal.uid,request.roomId,request.roomGeneration,context.policy.revision,context.policy.hash,request.memberGeneration,request.afterSequence,request.afterRevision];
  const rows=(await db.query<{value:unknown}>('SELECT public.pro273_audience_read($1,$2,$3,$4,$5,$6::bigint,$7,$8,$9::bigint,$10::bigint,$11::bigint) AS value',args)).rows;
  if(rows.length!==1 || !obj(rows[0].value)) throw new Error('READ_UNAVAILABLE');
  const v=rows[0].value,keys=['schemaVersion','namespace','projectId','principal','identityId','actualMemberRole','roomId','roomGeneration','memberGeneration','policyRevision','policyHash','matchId','profileRawId','profileHash','revision','throughSequence','canonicalState','members','readAt','terminal','replay'];
  if(Object.keys(v).length!==keys.length || !keys.every(k=>Object.hasOwn(v,k)) || v.schemaVersion!=='huroof-pro273-audience-internal-v1' || v.namespace!==context.policy.namespace || v.projectId!==context.principal.projectId || v.principal!==context.principal.uid || v.identityId!==context.identityId || v.roomId!==request.roomId || v.roomGeneration!==request.roomGeneration || (request.memberGeneration!==null && v.memberGeneration!==request.memberGeneration) || v.policyRevision!==context.policy.revision || v.policyHash!==context.policy.hash || !exactEnum(v.actualMemberRole,['host','audience']) || !decimal(v.memberGeneration) || v.memberGeneration==='0' || !decimal(v.revision) || !decimal(v.throughSequence) || typeof v.readAt!=='string' || !Number.isFinite(Date.parse(v.readAt)) || !obj(v.canonicalState) || !obj(v.canonicalState.room) || !Array.isArray(v.members) || new TextEncoder().encode(JSON.stringify(v.canonicalState)).length>262144) throw new Error('READ_UNAVAILABLE');
  if(v.actualMemberRole==='host') requireHosting(context);
  const room=decodeStoredRoom(v.canonicalState.room),members=v.members as import('../../../../../functions/src/game.js').CanonicalMember[];
  if(v.matchId===null) assertCapabilityOffer(room.config.challenge??null,request.offer);
  if(!Number.isSafeInteger(room.revision) || String(room.revision)!==v.revision || members.filter(m=>m && m.active && m.uid===context.principal.uid && m.role===v.actualMemberRole).length!==1 || canonicalJson(v.canonicalState.members)!==canonicalJson(v.members)) throw new Error('READ_UNAVAILABLE');
  let definition:import('../../../../../src/features/game/challenges/definition.js').CanonicalChallengeDefinition|undefined;
  if(v.matchId===null) {if(v.profileRawId!==null || v.profileHash!==null || v.throughSequence!=='0' || room.game?.lifecycle!=='LOBBY') throw new Error('READ_UNAVAILABLE');}
  else {
   if(typeof v.matchId!=='string' || typeof v.profileRawId!=='string' || typeof v.profileHash!=='string' || !/^[a-f0-9]{64}$/.test(v.profileHash)) throw new Error('READ_UNAVAILABLE');
   const snapshot=await commands.loadCommand(context,request.roomId,Number(request.roomGeneration),':audience:');
   if(snapshot.matchId!==v.matchId || String(snapshot.memberGeneration)!==v.memberGeneration || String(snapshot.sequence)!==v.throughSequence || snapshot.room.revision!==room.revision || canonicalJson(snapshot.room)!==canonicalJson(room) || canonicalJson(snapshot.members)!==canonicalJson(members)) throw new Error('READ_UNAVAILABLE');
   const pin=await commands.readPinnedContent(context,snapshot);if(pin.profileArtifactId!==v.profileRawId || pin.profileArtifactHash!==v.profileHash || pin.namespace!==context.policy.namespace || pin.projectId!==context.principal.projectId) throw new Error('READ_UNAVAILABLE');
   let version:unknown;try {version=(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(pin.profileRawBytes)) as {schemaVersion?:unknown}).schemaVersion;}catch {throw new Error('READ_UNAVAILABLE');}
   if(typeof version==='string' && version.startsWith('huroof-gameplay-profile-')) {const pinned=readPinnedGameplay(pin);assertGameplayConfig(pinned.profile,room.config);assertGameplayOffer(pinned.profile,request.offer);}
   if(room.challenge && !room.challenge.continued) {const loaded=readGameplayQuestions(pin,room.config.categories??[]);assertGameplayConfig(loaded.profile,room.config);assertGameplayOffer(loaded.profile,request.offer);if(!loaded.supplement || !room.activeQuestion?.challenge) throw new Error('READ_UNAVAILABLE');definition=definitionForQuestion(loaded.supplement,room.activeQuestion);if(!room.challenge.paused && room.challenge.deadlineAt!==undefined && room.challenge.deadlineAt<=Date.parse(v.readAt)) throw new Error('READ_UNAVAILABLE');}
  }
  const again=(await db.query<{value:unknown}>('SELECT public.pro273_audience_read($1,$2,$3,$4,$5,$6::bigint,$7,$8,$9::bigint,$10::bigint,$11::bigint) AS value',args)).rows;
  if(again.length!==1 || !obj(again[0].value)) throw new Error('READ_UNAVAILABLE');const fresh=again[0].value;
  if(Object.keys(fresh).length!==keys.length || !keys.every(k=>Object.hasOwn(fresh,k)) || keys.filter(k=>k!=='readAt').some(k=>canonicalJson(fresh[k])!==canonicalJson(v[k])) || typeof fresh.readAt!=='string' || !Number.isFinite(Date.parse(fresh.readAt)) || Date.parse(fresh.readAt)<Date.parse(v.readAt) || (room.challenge && !room.challenge.continued && !room.challenge.paused && room.challenge.deadlineAt!==undefined && room.challenge.deadlineAt<=Date.parse(fresh.readAt))) throw new Error('READ_UNAVAILABLE');
  const snapshot=projectForMember(request.roomId,room,members,context.principal.uid,Date.parse(fresh.readAt),{view:'audience',definition});
  if(v.matchId===null && obj(snapshot.projection.room) && obj(snapshot.projection.room.matchSettings)) delete snapshot.projection.room.matchSettings.expectedRelease;
  snapshot.serverTime=fresh.readAt;
  const frame={schemaVersion:'huroof-realtime-v1',namespace:v.namespace,projectId:v.projectId,roomId:v.roomId,roomGeneration:v.roomGeneration,memberGeneration:v.memberGeneration,policyRevision:v.policyRevision,policyHash:v.policyHash,principal:v.principal,role:'audience',stage:v.matchId===null?'SETUP':'PAID',revision:v.revision,throughSequence:v.throughSequence,readAt:fresh.readAt,snapshot,terminal:v.terminal,replay:v.replay};
  const parsed=parsePgFrame(JSON.stringify(frame),{backend:'pg',namespace:context.policy.namespace,engine:'huroof',profile:'pinned',locator:'',roomId:request.roomId,roomGeneration:request.roomGeneration,principal:context.principal.uid,memberGeneration:String(v.memberGeneration),role:'audience',view:'audience',authEpoch:0,routeEpoch:0,viewEpoch:0},context.principal.projectId);
  return {frame:parsed,actualMemberRole:v.actualMemberRole as 'host'|'audience'};
 } };
}


