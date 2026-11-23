import { validIntent, type GameIntent } from "../../../../../functions/src/game.js";
import { parseLocator, type Locator } from "./locator";
import { assertCapabilityOffer } from "./profile";
export interface CommandDto { locator: Locator; intent: GameIntent }
/** Reject all unknown transport fields, including identity, role, namespace and audience. */
export function parseCommandDto(body: unknown): CommandDto {
 if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_REQUEST");
 const input=body as Record<string,unknown>;
 if (Object.keys(input).length !== 2 || !Object.hasOwn(input,"locator") || !Object.hasOwn(input,"intent") || !validIntent(input.intent)) throw new Error("INVALID_REQUEST");
 const locator=parseLocator(input.locator); if (locator.backend !== "pg") throw new Error("PG_LOCATOR_REQUIRED");
 return {locator,intent:input.intent};
}

import { validateDisplayName, type CanonicalRoom } from "../../../../../functions/src/game.js";
export interface CreateLobbyDto { intentId: string; displayName: string; config: CanonicalRoom["config"] }
/** Only the supported classic profile is accepted; release content is authorized separately at paid start. */
export function parseCreateLobbyDto(body: unknown): CreateLobbyDto {
 if(!body || typeof body!=="object" || Array.isArray(body)) throw new Error("INVALID_REQUEST");
 const input=body as Record<string,unknown>;
 if(Object.keys(input).sort().join("|")!=="config|displayName|intentId" || typeof input.intentId!=="string" || !/^[A-Za-z0-9_-]{1,120}$/.test(input.intentId) || typeof input.displayName!=="string" || !input.config || typeof input.config!=="object" || Array.isArray(input.config)) throw new Error("INVALID_REQUEST");
 const c=input.config as Record<string,unknown>; const allowed=["demo","releaseDemoFixture","policyVersion","mapPresentation","gameKind","modality","mode","releaseId","releaseRootSha256","categories","teams","questionSeconds","opponentSeconds","labelledColours","difficulty","showQuestionOnAudience"];
 if(Object.keys(c).some(key=>!allowed.includes(key)) || c.demo!==false || c.releaseDemoFixture!==false || c.policyVersion!==1 || c.mapPresentation!=="ordinary" || c.gameKind!=="huroof" || c.modality!=="classic" || c.mode!=="classic" || typeof c.releaseId!=="string" || !/^[A-Za-z0-9_-]{1,128}$/.test(c.releaseId) || typeof c.releaseRootSha256!=="string" || !/^[a-f0-9]{64}$/.test(c.releaseRootSha256) || !Array.isArray(c.categories) || c.categories.length<1 || c.categories.length>10 || c.categories.some(x=>typeof x!=="string" || !/^[A-Za-z0-9_-]{1,128}$/.test(x)) || new Set(c.categories).size!==c.categories.length || !c.teams || typeof c.teams!=="object" || Array.isArray(c.teams) || !Number.isInteger(c.questionSeconds) || (c.questionSeconds as number)<5 || (c.questionSeconds as number)>120 || !Number.isInteger(c.opponentSeconds) || (c.opponentSeconds as number)<5 || (c.opponentSeconds as number)>120 || typeof c.labelledColours!=="boolean" || c.difficulty!=="mixed" || (c.showQuestionOnAudience!==undefined && typeof c.showQuestionOnAudience!=="boolean")) throw new Error("INVALID_REQUEST");
 const teams=c.teams as Record<string,unknown>; if(Object.keys(teams).sort().join("|")!=="horizontal|vertical" || typeof teams.horizontal!=="string" || typeof teams.vertical!=="string" || !teams.horizontal.trim() || !teams.vertical.trim() || teams.horizontal.length>40 || teams.vertical.length>40 || /\p{Cc}/u.test(teams.horizontal+teams.vertical)) throw new Error("INVALID_REQUEST");
 const displayName=validateDisplayName(input.displayName); if(displayName!==input.displayName) throw new Error("INVALID_REQUEST");
 return {intentId:input.intentId,displayName,config:c as unknown as CanonicalRoom["config"]};
}

export interface PaidStartDto { locator: string; intentId: string; profileScope: string; expectedRevision: number; offer?:unknown }
export function parsePaidStartDto(body: unknown): PaidStartDto {
 if(!body || typeof body!=="object" || Array.isArray(body)) throw new Error("INVALID_REQUEST");
 const input=body as Record<string,unknown>;
 if(!["expectedRevision|intentId|locator|profileScope","expectedRevision|intentId|locator|offer|profileScope"].includes(Object.keys(input).sort().join("|")) || typeof input.locator!=="string" || parseLocator(input.locator).backend!=="pg" || typeof input.intentId!=="string" || !/^[A-Za-z0-9_-]{1,120}$/.test(input.intentId) || typeof input.profileScope!=="string" || !/^[A-Za-z0-9_-]{1,120}$/.test(input.profileScope) || !Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number)<0) throw new Error("INVALID_REQUEST");
 if(Object.hasOwn(input,"offer")) try {assertCapabilityOffer(null,input.offer);} catch {throw new Error("INVALID_REQUEST");}
 return {locator:input.locator,intentId:input.intentId,profileScope:input.profileScope,expectedRevision:input.expectedRevision as number,...(Object.hasOwn(input,"offer")?{offer:input.offer}:{})};
}

export type JoinIntent = {type:"JOIN_ROOM";intentId:string;expectedRevision:number;payload:{role:"player"|"audience";displayName:string;offer?:unknown}};
export interface LobbyCommandDto { locator:string; intent:GameIntent | JoinIntent }
export function parseLobbyCommandDto(body: unknown): LobbyCommandDto {
 if(!body || typeof body!=="object" || Array.isArray(body)) throw new Error("INVALID_REQUEST");
 const input=body as Record<string,unknown>;
 if(Object.keys(input).sort().join("|")!=="intent|locator" || typeof input.locator!=="string" || parseLocator(input.locator).backend!=="pg" || !input.intent || typeof input.intent!=="object" || Array.isArray(input.intent)) throw new Error("INVALID_REQUEST");
 const intent=input.intent as Record<string,unknown>;
 if(intent.type==="JOIN_ROOM") {
  if(Object.keys(intent).sort().join("|")!=="expectedRevision|intentId|payload|type" || typeof intent.intentId!=="string" || !/^[A-Za-z0-9_-]{1,120}$/.test(intent.intentId) || !Number.isSafeInteger(intent.expectedRevision) || (intent.expectedRevision as number)<0 || !intent.payload || typeof intent.payload!=="object" || Array.isArray(intent.payload)) throw new Error("INVALID_REQUEST");
  const payload=intent.payload as Record<string,unknown>;
  if(!["displayName|role","displayName|offer|role"].includes(Object.keys(payload).sort().join("|")) || (payload.role!=="player" && payload.role!=="audience") || typeof payload.displayName!=="string" || validateDisplayName(payload.displayName)!==payload.displayName) throw new Error("INVALID_REQUEST");
  if(Object.hasOwn(payload,"offer")) try {assertCapabilityOffer(null,payload.offer);} catch {throw new Error("INVALID_REQUEST");}
  return {locator:input.locator,intent:intent as unknown as JoinIntent};
 }
 if(!validIntent(intent) || !["LOBBY_SET_READY","LOBBY_ASSIGN_TEAM","LOBBY_ADD_MANUAL_PLAYER"].includes(intent.type)) throw new Error("INVALID_REQUEST");
 return {locator:input.locator,intent};
}
