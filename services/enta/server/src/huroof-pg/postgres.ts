import type { BootstrapRepository, QueryBoundary } from "./repository";
import type { PolicyRow } from "./identity-policy";
import type { LocatorRecord } from "./locator";
type Result<T> = { value: T | null };
function one<T>(rows: Result<T>[]): T | null { if (rows.length !== 1) throw new Error("DATABASE_RESPONSE_INVALID"); return rows[0].value; }
/** Fixed restricted bootstrap operations; the service supplies trusted context. */
export function postgresBootstrap(db: QueryBoundary): BootstrapRepository {
 return {
  async readActivePolicy(namespace) {
   const raw = one((await db.query<Result<Omit<PolicyRow, "raw"> & {rawBase64: string}>>("SELECT public.eng03_03_policy_read($1) AS value",[namespace])).rows);
   if (!raw) return null;
   const bytes = decodeBounded(raw.rawBase64,65536);
   return {namespace:raw.namespace,revision:raw.revision,hash:raw.hash,raw:bytes,projectId:raw.projectId,issuer:raw.issuer,audience:raw.audience};
  },
  async resolveIdentity(projectId,uid) { return one((await db.query<Result<string>>("SELECT public.eng03_03_identity_find($1,$2) AS value",[projectId,uid])).rows); },
  async resolveLocator(namespace,code) { return one((await db.query<Result<LocatorRecord>>("SELECT public.eng03_03_locator_find($1,$2) AS value",[namespace,code])).rows); },
 };
}

import type { CommandRepository, CommandSnapshot } from "./repository";
import { ChallengeDeadlineDue } from "./repository";
import type { PinnedSnapshot } from "./content-reader";
import { resultSemantics } from "./reducer";
import { decodeStoredRoom, encodeStoredRoom } from "./storage-codec";
export type ReadRepository = BootstrapRepository & Pick<CommandRepository,"loadCommand" | "readPinnedContent" | "readCustodyPolicy">;
function decodeBounded(value: unknown, max: number): Uint8Array {
 if (typeof value!=="string" || value.length>Math.ceil(max/3)*4+Math.ceil(max/57)*2) throw new Error("DATABASE_RESPONSE_INVALID");
 const compact=value.replace(/\s/g,""); const bytes=Buffer.from(compact,"base64");
 if(bytes.length>max || bytes.toString("base64")!==compact) throw new Error("DATABASE_RESPONSE_INVALID"); return bytes;
}
type PinnedWire = Omit<PinnedSnapshot,"snapshotBytes"|"profileRawBytes"|"provenanceBytes"|"profileProvenanceBytes"|"supplement"> & {snapshotBase64:string;profileRawBase64:string;provenanceBase64:string;profileProvenanceBase64?:string;supplement?:null|{ref:import("./profile").GameplayRawRef;rawBase64:string;provenanceBase64:string}};
function unpackPinned(value: PinnedWire | null): PinnedSnapshot {
 if(!value || !Number.isSafeInteger(value.snapshotLength) || value.snapshotLength<1 || value.snapshotLength>64*1024*1024 || !Number.isSafeInteger(value.profileArtifactLength) || value.profileArtifactLength<1 || value.profileArtifactLength>64*1024*1024) throw new Error("DATABASE_RESPONSE_INVALID");
 const {snapshotBase64,profileRawBase64,provenanceBase64,profileProvenanceBase64,supplement,...fields}=value;
 return {...fields,snapshotBytes:decodeBounded(snapshotBase64,64*1024*1024),profileRawBytes:decodeBounded(profileRawBase64,64*1024*1024),provenanceBytes:decodeBounded(provenanceBase64,64*1024*1024),...(profileProvenanceBase64!==undefined?{profileProvenanceBytes:decodeBounded(profileProvenanceBase64,64*1024*1024)}:{}),...(supplement===undefined?{}:{supplement:supplement===null?null:{ref:supplement.ref,raw:decodeBounded(supplement.rawBase64,64*1024*1024),provenance:decodeBounded(supplement.provenanceBase64,64*1024*1024)}})};
}
/** Read-only operations are fixed SQL calls; no raw table SELECT is exposed to runtime. */
export function postgresReadRepository(db: QueryBoundary): ReadRepository {
 const bootstrap=postgresBootstrap(db);
 return {
  ...bootstrap,
  async loadCommand(context,roomId,generation,intentId) {
   const value=one((await db.query<Result<CommandSnapshot>>("SELECT public.eng03_03_command_load($1,$2,$3,$4,$5) AS value",[context.policy.namespace,context.identityId,roomId,generation,intentId])).rows);
   if(!value || value.roomId!==roomId || value.generation!==generation || !Number.isSafeInteger(value.sequence) || value.sequence<0 || !Number.isSafeInteger(value.memberGeneration) || value.memberGeneration<1 || !value.matchId || !value.room || !value.actor || !Array.isArray(value.members)) throw new Error("DATABASE_RESPONSE_INVALID");
   return {...value,room:decodeStoredRoom(value.room),...(value.previousTerminalRoom?{previousTerminalRoom:decodeStoredRoom(value.previousTerminalRoom)}:{})};
  },
  async readCustodyPolicy(namespace) {
   type Wire = Omit<import("./content-reader").CustodyPolicyRow,"raw"> & {rawBase64:string};
   const value=one((await db.query<Result<Wire>>("SELECT public.eng03_03_custody_policy($1) AS value",[namespace])).rows);
   if(!value) return null;
   if(!Number.isSafeInteger(value.length) || value.length<1 || value.length>65536) throw new Error("DATABASE_RESPONSE_INVALID");
   const {rawBase64,...fields}=value; return {...fields,raw:decodeBounded(rawBase64,65536)};
  },
  async readPinnedContent(context,snapshot) {
   return unpackPinned(one((await db.query<Result<PinnedWire>>("SELECT public.eng03_03_content_load($1,$2,$3,$4,$5,$6) AS value",[context.policy.namespace,context.identityId,snapshot.roomId,snapshot.generation,null,snapshot.matchId])).rows));
  },
 };
}

/** Fixed command transaction; the SQL boundary rechecks receipt, authority, state and pinned evidence. */
export function postgresCommandRepository(db: QueryBoundary): CommandRepository {
 const reads=postgresReadRepository(db);
 return {
  ...reads,
  async commitChallengeExpiry(context,snapshot,intent,next,projections) {
   const args=[context.policy.namespace,context.identityId,snapshot.roomId,snapshot.generation,snapshot.memberGeneration,snapshot.room.revision,snapshot.sequence,context.policy.revision,context.policy.hash,JSON.stringify(intent),JSON.stringify(encodeStoredRoom(next)),JSON.stringify(snapshot.members),JSON.stringify(projections),JSON.stringify(resultSemantics(next)),null];
   const value=one((await db.query<Result<import("./repository").SealedCommandOutcome>>("SELECT public.eng03_03_command_commit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb) AS value",args)).rows);
   if(!value || !Number.isSafeInteger(value.revision) || !Number.isSafeInteger(value.sequence) || typeof value.replayed!=="boolean") throw new Error("DATABASE_RESPONSE_INVALID");return value;
  },
  async commitExpiry(context,snapshot,next,projections) {
   const key=`:expiry:${snapshot.matchId}:${snapshot.sequence+1}`;
   const intent={type:"SERVER_TIME_EXPIRED",intentId:key,expectedRevision:snapshot.room.revision,payload:{}};
   const args=[context.policy.namespace,context.identityId,snapshot.roomId,snapshot.generation,snapshot.memberGeneration,snapshot.room.revision,snapshot.sequence,context.policy.revision,context.policy.hash,JSON.stringify(intent),JSON.stringify(encodeStoredRoom(next)),JSON.stringify(snapshot.members),JSON.stringify(projections),JSON.stringify(resultSemantics(next)),null];
   const value=one((await db.query<Result<import("./repository").SealedCommandOutcome>>("SELECT public.eng03_03_command_commit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb) AS value",args)).rows);
   if(!value || !Number.isSafeInteger(value.revision) || !Number.isSafeInteger(value.sequence) || typeof value.replayed!=="boolean") throw new Error("DATABASE_RESPONSE_INVALID"); return {revision:value.revision,sequence:value.sequence,replayed:value.replayed};
  },
  async commitCommand(context,snapshot,intent,next,_member,_target,_eventType,resultChanged,custody,members,projections) {
   if(_eventType!==intent.type) throw new Error("COMMAND_EVENT_MISMATCH");
   const args=[context.policy.namespace,context.identityId,snapshot.roomId,snapshot.generation,snapshot.memberGeneration,snapshot.room.revision,snapshot.sequence,context.policy.revision,context.policy.hash,JSON.stringify(intent),JSON.stringify(encodeStoredRoom(next)),JSON.stringify(members),JSON.stringify(projections),JSON.stringify(resultSemantics(next)),custody ? JSON.stringify(custody) : null];
   let value:import("./repository").SealedCommandOutcome | null;
   try { value=one((await db.query<Result<import("./repository").SealedCommandOutcome>>("SELECT public.eng03_03_command_commit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb) AS value",args)).rows); }
   catch(error) {
    const e=error && typeof error==="object" ? error as {code?:unknown;meta?:unknown} : null;
    const meta=e?.meta && typeof e.meta==="object" ? e.meta as {code?:unknown} : null;
    if(intent.type.startsWith("CHALLENGE_") && (e?.code==="P2731" || (e?.code==="P2010" && meta?.code==="P2731"))) throw new ChallengeDeadlineDue();
    throw error;
   }
   if(!value || !Number.isSafeInteger(value.revision) || !Number.isSafeInteger(value.sequence) || typeof value.replayed!=="boolean") throw new Error("DATABASE_RESPONSE_INVALID");
   return {revision:value.revision,sequence:value.sequence,replayed:value.replayed};
  },
 };
}

export function postgresLobbyRepository(db: QueryBoundary): import("./repository").LobbyRepository {
 const bootstrap=postgresBootstrap(db);
 return {...bootstrap,
  async findCreate(context,intent) {
   const value=one((await db.query<Result<import("./repository").LobbyCreateOutcome>>("SELECT public.eng03_03_find_create($1,$2,$3,$4::jsonb) AS value",[context.policy.namespace,context.identityId,intent.intentId,JSON.stringify(intent)])).rows);
   if(!value) return null;
   if(!/^l_[a-f0-9]{64}$/.test(value.roomId) || !/^M2-[A-Za-z0-9]{8}$/.test(value.locator) || value.revision!==0 || value.replayed!==true) throw new Error("DATABASE_RESPONSE_INVALID");
   return {roomId:value.roomId,locator:value.locator,revision:0,replayed:true};
  },
  async findLobbyReceipt(context,roomId,intent) {
   const value=one((await db.query<Result<import("./repository").LobbyOutcome>>("SELECT public.eng03_03_lobby_receipt($1,$2,$3,$4,$5::jsonb) AS value",[context.policy.namespace,context.identityId,roomId,intent.intentId,JSON.stringify(intent)])).rows);
   if(!value) return null; if(value.roomId!==roomId || !Number.isSafeInteger(value.revision) || value.revision<0 || value.replayed!==true) throw new Error("DATABASE_RESPONSE_INVALID"); return {roomId,revision:value.revision,replayed:true};
  },
  async loadLobby(context,roomId,generation) {
   const value=one((await db.query<Result<import("./repository").LobbySnapshot>>("SELECT public.eng03_03_lobby_load($1,$2,$3,$4) AS value",[context.policy.namespace,context.identityId,roomId,generation])).rows);
   if(!value || value.roomId!==roomId || value.generation!==generation || !Number.isSafeInteger(value.memberGeneration) || !/^[a-f0-9]{64}$/.test(value.stateHash) || !value.state || !value.actor || !Array.isArray(value.state.members)) throw new Error("DATABASE_RESPONSE_INVALID"); return {...value,state:{...value.state,room:decodeStoredRoom(value.state.room)}};
  },
  async loadJoinLobby(context,roomId,generation) {
   const value=one((await db.query<Result<import("./repository").LobbyJoinSnapshot>>("SELECT public.eng03_03_lobby_join_prepare($1,$2,$3,$4) AS value",[context.policy.namespace,context.identityId,roomId,generation])).rows);
   if(!value || value.roomId!==roomId || value.generation!==generation || !/^[a-f0-9]{64}$/.test(value.stateHash) || !value.state || !Array.isArray(value.state.members)) throw new Error("DATABASE_RESPONSE_INVALID"); return {...value,state:{...value.state,room:decodeStoredRoom(value.state.room)}};
  },
  async deriveManualIdentity(context,roomId,key) {
   const value=one((await db.query<Result<string>>("SELECT public.eng03_03_manual_identity($1,$2,$3,$4) AS value",[context.policy.namespace,roomId,context.identityId,key])).rows);
   if(!value || !/^manual_[a-f0-9]{64}$/.test(value)) throw new Error("DATABASE_RESPONSE_INVALID"); return value;
  },
  async commitLobby(context,snapshot,intent,state) {
   const value=one((await db.query<Result<import("./repository").LobbyOutcome>>("SELECT public.eng03_03_lobby_commit($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) AS value",[context.policy.namespace,context.identityId,snapshot.roomId,snapshot.generation,snapshot.state.room.revision,context.policy.revision,context.policy.hash,JSON.stringify(intent),JSON.stringify({...state,room:encodeStoredRoom(state.room)})])).rows);
   if(!value || value.roomId!==snapshot.roomId || !Number.isSafeInteger(value.revision) || typeof value.replayed!=="boolean") throw new Error("DATABASE_RESPONSE_INVALID"); return {roomId:value.roomId,revision:value.revision,replayed:value.replayed};
  },
  async deriveCreateIdentity(context,key) {
   const value=one((await db.query<Result<{roomId:string;code:string}>>("SELECT public.eng03_03_create_identity($1,$2,$3,$4) AS value",[context.policy.namespace,context.principal.projectId,context.identityId,key])).rows);
   if(!value || !/^l_[a-f0-9]{64}$/.test(value.roomId) || !/^[A-Za-z0-9]{8}$/.test(value.code)) throw new Error("DATABASE_RESPONSE_INVALID"); return value;
  },
  async createLobby(context,intent,state) {
   const value=one((await db.query<Result<import("./repository").LobbyCreateOutcome>>("SELECT public.eng03_03_setup_create($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) AS value",[context.policy.namespace,context.identityId,context.policy.revision,context.policy.hash,intent.intentId,JSON.stringify(intent),JSON.stringify({...state,room:encodeStoredRoom(state.room)})])).rows);
   if(!value || !/^l_[a-f0-9]{64}$/.test(value.roomId) || !/^M2-[A-Za-z0-9]{8}$/.test(value.locator) || value.revision!==0 || typeof value.replayed!=="boolean") throw new Error("DATABASE_RESPONSE_INVALID"); return {roomId:value.roomId,locator:value.locator,revision:0,replayed:value.replayed};
  },
 };
}

function paidOutcome(value: import("./repository").PaidOutcome | null): import("./repository").PaidOutcome {
 if(!value || !/^ha_[a-f0-9]{64}$/.test(value.admissionId) || !/^hm_[a-f0-9]{64}$/.test(value.matchId) || !/^l_[a-f0-9]{64}$/.test(value.roomId) || value.status!=="STARTED" || value.state!=="COMMITTED" || !Number.isSafeInteger(value.revision) || !Number.isSafeInteger(value.sequence) || typeof value.replayed!=="boolean") throw new Error("DATABASE_RESPONSE_INVALID");
 return {admissionId:value.admissionId,matchId:value.matchId,roomId:value.roomId,status:"STARTED",state:"COMMITTED",revision:value.revision,sequence:value.sequence,replayed:value.replayed};
}
export function postgresPaidRepository(db: QueryBoundary): import("./repository").PaidRepository {
 const lobby=postgresLobbyRepository(db), reads=postgresReadRepository(db);
 return {...lobby, readCustodyPolicy:reads.readCustodyPolicy,
  async derivePaidIdentity(context,roomId,key) {
   const value=one((await db.query<Result<import("./repository").PaidIds>>("SELECT public.eng03_03_paid_identity($1,$2,$3,$4,$5) AS value",[context.policy.namespace,context.principal.projectId,context.identityId,roomId,key])).rows);
   if(!value || !/^ha_[a-f0-9]{64}$/.test(value.admissionId) || !/^hm_[a-f0-9]{64}$/.test(value.matchId) || !/^hl_[a-f0-9]{64}$/.test(value.logicalMatchId)) throw new Error("DATABASE_RESPONSE_INVALID"); return value;
  },
  async findPaid(context,roomId,ids,client) {
   const value=one((await db.query<Result<import("./repository").PaidOutcome>>("SELECT public.eng03_03_find_paid($1,$2,$3,$4,$5,$6::jsonb) AS value",[context.policy.namespace,context.identityId,roomId,client.intentId,ids.logicalMatchId,JSON.stringify(client)])).rows);
   if(!value) return null;
   const result=paidOutcome(value); if(result.roomId!==roomId || result.admissionId!==ids.admissionId || result.matchId!==ids.matchId || !result.replayed) throw new Error("DATABASE_RESPONSE_INVALID"); return result;
  },
  async loadLobby(context,roomId,generation) {
   const value=one((await db.query<Result<import("./repository").LobbySnapshot>>("SELECT public.eng03_03_lobby_load($1,$2,$3,$4) AS value",[context.policy.namespace,context.identityId,roomId,generation])).rows);
   if(!value || value.roomId!==roomId || value.generation!==generation || !Number.isSafeInteger(value.memberGeneration) || !/^[a-f0-9]{64}$/.test(value.stateHash) || !value.state || !value.actor || !Array.isArray(value.state.members)) throw new Error("DATABASE_RESPONSE_INVALID"); return {...value,state:{...value.state,room:decodeStoredRoom(value.state.room)}};
  },
  async readLobbyContent(context,lobby,profileScope) {
   return unpackPinned(one((await db.query<Result<PinnedWire>>("SELECT public.eng03_03_content_load($1,$2,$3,$4,$5,$6) AS value",[context.policy.namespace,context.identityId,lobby.roomId,lobby.generation,profileScope,null])).rows));
  },
  async startPaid(context,ids,intent,initial,projections) {
   const storedIntent=Object.hasOwn(intent,"preparedRoom")?{...intent,preparedRoom:encodeStoredRoom(intent.preparedRoom as import("../../../../../functions/src/game.js").CanonicalRoom)}:intent;
   const value=one((await db.query<Result<import("./repository").PaidOutcome>>("SELECT public.eng03_03_paid_start($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb) AS value",[context.identityId,intent.requestKey,ids.logicalMatchId,JSON.stringify(storedIntent),JSON.stringify(initial),JSON.stringify(projections)])).rows);
   const result=paidOutcome(value), prepared=intent.preparedRoom as {revision?:unknown} | undefined;
   if(result.roomId!==intent.roomId || result.admissionId!==ids.admissionId || result.matchId!==ids.matchId || result.revision!==prepared?.revision || result.sequence!==1) throw new Error("DATABASE_RESPONSE_INVALID"); return result;
  },
 };
}
