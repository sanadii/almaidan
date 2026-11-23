import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../../scripts/firestore-release-canonical.js";

export interface GameplayRawRef {
 namespace:string; id:string; hash:string; byteLength:number; mediaType:string; serialization:string; provenanceHash:string;
}
export interface GameplayProfile {
 schemaVersion:"huroof-gameplay-profile-v1"; namespace:string; profileScope:string; sourceId:string;
 gameKind:"huroof"|"categories"; mode:"classic"|"fast"|"custom"; modality:"classic"|"image"|"video"|"charades";
 categories:string[]; questionSeconds:number; opponentSeconds:number; mapPresentation:"ordinary"|"interactive";
 challenge:null|{protocolVersion:"t36-challenge-runtime-v1";mechanics:string[];definitionSchemas:string[]};
 release:{id:string;rootSha256:string;receiptId:string;catalogId:string;catalogRoot:string;sealHash:string;sourceManifestHash:string};
 contentSnapshot:GameplayRawRef; supplement:GameplayRawRef|null;
 selector:{version:string;capabilityStateHash:string}; readiness:{policyVersion:string}; custody:{policyRevision:string;policyHash:string};
}
const id=(v:unknown):v is string=>typeof v==="string" && /^[A-Za-z0-9_-]{1,120}$/.test(v);
const token=(v:unknown):v is string=>typeof v==="string" && /^[A-Za-z0-9._:-]{1,200}$/.test(v);
const hash=(v:unknown):v is string=>typeof v==="string" && /^[a-f0-9]{64}$/.test(v);
const obj=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==="object" && !Array.isArray(v) && Object.getPrototypeOf(v)===Object.prototype;
const keys=(v:unknown,names:string[]):v is Record<string,unknown>=>obj(v) && Object.keys(v).length===names.length && names.every(k=>Object.hasOwn(v,k));
const list=(v:unknown,allowed:readonly string[])=>Array.isArray(v) && v.length>0 && new Set(v).size===v.length && v.every(x=>typeof x==="string" && allowed.includes(x));
const fail=():never=>{throw new Error("GAMEPLAY_PROFILE_UNAVAILABLE");};
export function validateRawRef(value:unknown,namespace:string,serialization:string):GameplayRawRef {
 if(!keys(value,["namespace","id","hash","byteLength","mediaType","serialization","provenanceHash"]) || value.namespace!==namespace || !id(value.id) || !hash(value.hash) || !Number.isSafeInteger(value.byteLength) || (value.byteLength as number)<1 || (value.byteLength as number)>67108864 || value.mediaType!=="application/json" || value.serialization!==serialization || !hash(value.provenanceHash)) return fail();
 return value as unknown as GameplayRawRef;
}
export function parseGameplayProfile(raw:Uint8Array, expectedHash:string):GameplayProfile {
 if(!(raw instanceof Uint8Array) || raw.byteLength<1 || raw.byteLength>67108864 || !hash(expectedHash) || createHash("sha256").update(raw).digest("hex")!==expectedHash) return fail();
 let text:string,value:unknown; try {text=new TextDecoder("utf-8",{fatal:true}).decode(raw); value=JSON.parse(text); if(canonicalJson(value)!==text) return fail();} catch {return fail();}
 if(!keys(value,["schemaVersion","namespace","profileScope","sourceId","gameKind","mode","modality","categories","questionSeconds","opponentSeconds","mapPresentation","challenge","release","contentSnapshot","supplement","selector","readiness","custody"]) || value.schemaVersion!=="huroof-gameplay-profile-v1" || !id(value.namespace) || !id(value.profileScope) || !id(value.sourceId) || !["huroof","categories"].includes(String(value.gameKind)) || !["classic","fast","custom"].includes(String(value.mode)) || !["classic","image","video","charades"].includes(String(value.modality)) || !Array.isArray(value.categories) || value.categories.length<1 || value.categories.length>10 || new Set(value.categories).size!==value.categories.length || !value.categories.every(id) || !Number.isInteger(value.questionSeconds) || (value.questionSeconds as number)<5 || (value.questionSeconds as number)>120 || !Number.isInteger(value.opponentSeconds) || (value.opponentSeconds as number)<5 || (value.opponentSeconds as number)>120 || !["ordinary","interactive"].includes(String(value.mapPresentation))) return fail();
 if(value.challenge!==null && (!keys(value.challenge,["protocolVersion","mechanics","definitionSchemas"]) || value.challenge.protocolVersion!=="t36-challenge-runtime-v1" || !list(value.challenge.mechanics,["navigation","missing_tile","memory","qatar_map","word_search"]) || !list(value.challenge.definitionSchemas,["t36-challenge-definition-v1","t37-clean70-challenge-definition-v1","t37-topup-word-search-definition-v1"]))) return fail();
 if(value.modality==="charades" && value.challenge!==null) return fail();
 if(value.mapPresentation==="interactive" && (!value.challenge || !(value.challenge as {mechanics:string[]}).mechanics.includes("qatar_map"))) return fail();
 if(!keys(value.release,["id","rootSha256","receiptId","catalogId","catalogRoot","sealHash","sourceManifestHash"]) || !id(value.release.id) || !hash(value.release.rootSha256) || !token(value.release.receiptId) || !token(value.release.catalogId) || !hash(value.release.catalogRoot) || !hash(value.release.sealHash) || !hash(value.release.sourceManifestHash)) return fail();
 validateRawRef(value.contentSnapshot,value.namespace,"huroof-release-snapshot-v1");
 if(value.supplement!==null) {
  if(!obj(value.supplement) || !["huroof-gameplay-supplement-v1","huroof-gameplay-map-supplement-v2"].includes(String(value.supplement.serialization))) return fail();
  validateRawRef(value.supplement,value.namespace,value.supplement.serialization as string);
 }
 if(value.supplement===null && (value.challenge!==null || value.mapPresentation!=="ordinary")) return fail();
 if(!keys(value.selector,["version","capabilityStateHash"]) || !token(value.selector.version) || !hash(value.selector.capabilityStateHash) || !keys(value.readiness,["policyVersion"]) || !token(value.readiness.policyVersion) || !keys(value.custody,["policyRevision","policyHash"]) || typeof value.custody.policyRevision!=="string" || !/^[1-9][0-9]*$/.test(value.custody.policyRevision) || !hash(value.custody.policyHash)) return fail();
 return value as unknown as GameplayProfile;
}

/** A provenance hash alone is not enough: bind the authenticated raw subject and both immutable references. */
export function validateGameplayProfileProvenance(profile:GameplayProfile,profileRef:GameplayRawRef,provenance:Uint8Array):void {
 validateRawRef(profileRef,profile.namespace,"huroof-gameplay-profile-v1");
 if(!(provenance instanceof Uint8Array) || provenance.byteLength<1 || provenance.byteLength>67108864 || createHash("sha256").update(provenance).digest("hex")!==profileRef.provenanceHash) return fail();
 let value:unknown;try {const text=new TextDecoder("utf-8",{fatal:true}).decode(provenance);value=JSON.parse(text);if(canonicalJson(value)!==text) return fail();} catch {return fail();}
 if(!keys(value,["schemaVersion","namespace","profileScope","profileSourceId","contentHash","contentSnapshot","supplement","sourceManifestSha256"]) || value.schemaVersion!=="huroof-gameplay-profile-provenance-v1" || value.namespace!==profile.namespace || value.profileScope!==profile.profileScope || value.profileSourceId!==profile.sourceId || value.contentHash!==profileRef.hash || value.sourceManifestSha256!==profile.release.sourceManifestHash || canonicalJson(value.contentSnapshot)!==canonicalJson(profile.contentSnapshot) || canonicalJson(value.supplement)!==canonicalJson(profile.supplement)) return fail();
}

export function assertGameplayConfig(profile:GameplayProfile,config:import("../../../../../functions/src/game.js").CanonicalRoom["config"]):void {
 if(profile.gameKind!==(config.gameKind??"huroof") || profile.mode!==(config.mode??"classic") || profile.modality!==(config.modality??"classic") || profile.mapPresentation!==(config.mapPresentation??"ordinary") || profile.questionSeconds!==config.questionSeconds || profile.opponentSeconds!==config.opponentSeconds || canonicalJson(profile.categories)!==canonicalJson(config.categories??[]) || canonicalJson(profile.challenge)!==canonicalJson(config.challenge??null)) return fail();
}

/** Capability offers are untrusted client declarations, not mode-selection authority. */
export function assertGameplayOffer(profile:GameplayProfile,offer:unknown):void {
 assertCapabilityOffer(profile.challenge,offer);
}
export function assertCapabilityOffer(required:{protocolVersion:string;mechanics:readonly string[];definitionSchemas?:readonly string[]}|null,offer:unknown):void {
 if(required && (required.protocolVersion!=="t36-challenge-runtime-v1" || !list(required.mechanics,["navigation","missing_tile","memory","qatar_map","word_search"]) || !list(required.definitionSchemas,["t36-challenge-definition-v1","t37-clean70-challenge-definition-v1","t37-topup-word-search-definition-v1"]))) return fail();
 if(offer===undefined || offer===null) {if(required!==null) return fail();return;}
 if(!keys(offer,["protocolVersion","mechanics","definitionSchemas"]) || offer.protocolVersion!=="t36-challenge-runtime-v1" || !list(offer.mechanics,["navigation","missing_tile","memory","qatar_map","word_search"]) || !list(offer.definitionSchemas,["t36-challenge-definition-v1","t37-clean70-challenge-definition-v1","t37-topup-word-search-definition-v1"])) return fail();
 if(required && (required.mechanics.some(mechanic=>!(offer.mechanics as string[]).includes(mechanic)) || required.definitionSchemas!.some(schema=>!(offer.definitionSchemas as string[]).includes(schema)))) return fail();
}
