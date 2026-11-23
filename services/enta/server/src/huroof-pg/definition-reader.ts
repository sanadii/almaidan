import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../../scripts/firestore-release-canonical.js";
import { assertChallengeDefinitionBinding, parseChallengeDefinitionEnvelope, type ChallengeDefinitionEnvelope, type ChallengeQuestionBinding } from "../../../../../src/features/game/challenges/integration.js";
import type { CanonicalChallengeDefinition } from "../../../../../src/features/game/challenges/definition.js";
import { assertMapVariantBinding, materializeMapPresentation, type MapVariantBinding, type MapVariantQuestion } from "../../../../../src/features/game/runtime/map-variant-resolver.js";
import { runtimeQuestionProjection } from "../../../../../src/features/game/runtime/question-projection.js";
import { canonicalChallengeJson } from "../../../../../src/features/game/challenges/integration.js";
import type { GameplayProfile, GameplayRawRef } from "./profile";

const sha=(data:Uint8Array|string)=>createHash("sha256").update(data).digest("hex");
const record=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==="object" && !Array.isArray(v) && Object.getPrototypeOf(v)===Object.prototype;
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>record(v) && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
const unavailable=():never=>{throw new Error("GAMEPLAY_SUPPLEMENT_UNAVAILABLE");};
export interface StoredSupplement {ref:GameplayRawRef;raw:Uint8Array;provenance:Uint8Array}
export interface DefinitionEntry {questionId:string;categoryId:string;kind:string;factFamilies:string[];envelope:ChallengeDefinitionEnvelope}
export interface GameplaySupplement {definitions:DefinitionEntry[];maps:MapVariantBinding[];mapRootMaterial?:MapRootMaterial}

/** Private, untrusted representation only. Its hashes cannot authenticate their own source. */
export interface MapRootMaterial {raw:Uint8Array;wrapper:{path:string;data:Record<string,unknown>;fields:Record<string,unknown>};definitionSet:ChallengeDefinitionEnvelope[];maps:MapVariantBinding[]}
function encodeSourceField(value:unknown):Record<string,unknown> {
 if(value===null) return {nullValue:null};
 if(typeof value==="string") return {stringValue:value};
 if(typeof value==="boolean") return {booleanValue:value};
 if(typeof value==="number" && Number.isFinite(value)) return Number.isInteger(value)?{integerValue:String(value)}:{doubleValue:value};
 if(Array.isArray(value)) return value.length?{arrayValue:{values:value.map(encodeSourceField)}}:{arrayValue:{}};
 if(record(value)) return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,child])=>[key,encodeSourceField(child)]))}};
 return unavailable();
}
/** Reconstruct the producer's exact wrapper and complete commitments before scope filtering. */
export function validateMapRootMaterial(evidence:unknown,definitionSet:unknown,maps:unknown,commitment:unknown,overlay:unknown,sourceManifest:string):MapRootMaterial {
 if(!exact(evidence,["schemaVersion","sourceReleaseId","documentRootSha256","rootArtifactSha256","rootArtifactByteLength","rootArtifactBase64","sourceEvidenceManifestHash"]) || evidence.schemaVersion!=="huroof-source-release-root-evidence-v1" || typeof evidence.sourceReleaseId!=="string" || !/^[A-Za-z0-9_-]{1,120}$/.test(evidence.sourceReleaseId) || typeof evidence.documentRootSha256!=="string" || !/^[a-f0-9]{64}$/.test(evidence.documentRootSha256) || typeof evidence.rootArtifactSha256!=="string" || !/^[a-f0-9]{64}$/.test(evidence.rootArtifactSha256) || evidence.sourceEvidenceManifestHash!==sourceManifest || !Number.isSafeInteger(evidence.rootArtifactByteLength) || (evidence.rootArtifactByteLength as number)<1 || (evidence.rootArtifactByteLength as number)>67108864 || typeof evidence.rootArtifactBase64!=="string" || evidence.rootArtifactBase64.length>89478488 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(evidence.rootArtifactBase64)) return unavailable();
 const raw=Buffer.from(evidence.rootArtifactBase64,"base64");if(raw.length!==evidence.rootArtifactByteLength || raw.toString("base64")!==evidence.rootArtifactBase64 || sha(raw)!==evidence.rootArtifactSha256) return unavailable();
 let wrapper:unknown;try {const text=new TextDecoder("utf-8",{fatal:true}).decode(raw);wrapper=JSON.parse(text);if(canonicalChallengeJson(wrapper)+"\n"!==text) return unavailable();} catch {return unavailable();}
 if(!exact(wrapper,["path","data","fields"]) || wrapper.path!==`releases/${evidence.sourceReleaseId}` || !record(wrapper.data) || !record(wrapper.fields) || wrapper.data.schemaVersion!=="t36-premium-release-v1" || wrapper.data.immutable!==true || wrapper.data.releaseId!==evidence.sourceReleaseId || wrapper.data.documentRootSha256!==evidence.documentRootSha256 || canonicalChallengeJson(wrapper.fields)!==canonicalChallengeJson(Object.fromEntries(Object.entries(wrapper.data).map(([key,value])=>[key,encodeSourceField(value)])))) return unavailable();
 const premium=wrapper.data.t36Premium;if(!record(premium) || premium.immutable!==true || !record(premium.mapVariants) || premium.mapVariants.schemaVersion!=="t36-map-variant-v1" || premium.mapVariants.count!==300 || premium.mapVariants.reviewed!==205 || premium.mapVariants.held!==95 || premium.mapVariants.runtimeProjectionSchema!=="t36-runtime-question-projection-v1" || typeof overlay!=="string" || !/^[a-f0-9]{64}$/.test(overlay) || premium.geographicOverlaySha256!==overlay || !Array.isArray(definitionSet) || !Array.isArray(maps)) return unavailable();
 const expected={schemaVersion:"t36-map-variant-v1",definitionManifestSha256:premium.definitionManifestSha256,definitionEnvelopeRootSha256:premium.definitionEnvelopeRootSha256,sidecarSha256:premium.mapVariants.sidecarSha256,count:300,reviewed:205,held:95};
 if(canonicalChallengeJson(commitment)!==canonicalChallengeJson(expected) || maps.length!==300 || maps.filter(m=>record(m) && m.disposition==="reviewed").length!==205 || maps.filter(m=>record(m) && m.disposition==="held").length!==95 || maps.some(m=>!record(m) || m.geographicOverlaySha256!==overlay || m.runtimeProjectionSchema!=="t36-runtime-question-projection-v1") || sha(canonicalChallengeJson(maps))!==expected.sidecarSha256 || sha(canonicalChallengeJson(definitionSet))!==expected.definitionEnvelopeRootSha256) return unavailable();
 const ids=new Set<string>(),parsed=new Map<string,CanonicalChallengeDefinition>();for(const entry of definitionSet) {if(!exact(entry,["manifestSha256","id","schemaVersion","definitionSha256","canonicalJson"]) || typeof entry.id!=="string" || ids.has(entry.id) || entry.manifestSha256!==expected.definitionManifestSha256) return unavailable();parsed.set(entry.id,parseChallengeDefinitionEnvelope(entry as ChallengeDefinitionEnvelope,sha));ids.add(entry.id);}
 if(sha(canonicalChallengeJson(definitionSet.map(e=>({id:e.id,definitionSha256:e.definitionSha256}))))!==expected.definitionManifestSha256 || new Set(maps.map(m=>m.runtimeQuestionId)).size!==maps.length || new Set(maps.map(m=>m.m1SourceId)).size!==maps.length || [...parsed.values()].filter(item=>item.kind==="qatar_map").length!==maps.length) return unavailable();
 for(const binding of maps) {
  if(!exact(binding,["schemaVersion","runtimeQuestionId","predecessorQuestionCanonicalSha256","runtimeProjectionSchema","runtimeProjectionSha256","m1SourceId","m1SourceRawSha256","m1SourceContextsSha256","reconciliationSha256","definition","mechanic","factFamilies","disposition","geographicOverlaySha256"]) || binding.schemaVersion!=="t36-map-variant-v1" || typeof binding.runtimeQuestionId!=="string" || !/^[A-Za-z0-9_-]{1,120}$/.test(binding.runtimeQuestionId) || typeof binding.m1SourceId!=="string" || !exact(binding.definition,["manifestSha256","id","schemaVersion","definitionSha256"]) || binding.definition.id!==binding.m1SourceId || binding.definition.manifestSha256!==expected.definitionManifestSha256 || !Array.isArray(binding.factFamilies) || !binding.factFamilies.every(x=>typeof x==="string") || new Set(binding.factFamilies).size!==binding.factFamilies.length || ![binding.predecessorQuestionCanonicalSha256,binding.runtimeProjectionSha256,binding.m1SourceRawSha256,binding.m1SourceContextsSha256,binding.reconciliationSha256].every(x=>typeof x==="string" && /^[a-f0-9]{64}$/.test(x))) return unavailable();
  const definition=parsed.get(binding.m1SourceId);if(!definition || definition.kind!=="qatar_map" || binding.mechanic!=="qatar_map" || definition.schemaVersion!==binding.definition.schemaVersion || definition.definitionSha256!==binding.definition.definitionSha256 || definition.source.sourceId!==binding.m1SourceId || definition.source.sourceRawSha256!==binding.m1SourceRawSha256 || definition.source.sourceContextsSha256!==binding.m1SourceContextsSha256 || binding.reconciliationSha256!==premium.mapBindingsSha256 || (binding.disposition==="reviewed"?definition.disposition!=="ready":binding.disposition!=="held" || definition.disposition!=="held") || canonicalChallengeJson([...definition.factFamilies].sort())!==canonicalChallengeJson([...binding.factFamilies].sort())) return unavailable();
 }
 return {raw:new Uint8Array(raw),wrapper:structuredClone(wrapper) as MapRootMaterial["wrapper"],definitionSet:structuredClone(definitionSet) as ChallengeDefinitionEnvelope[],maps:structuredClone(maps) as MapVariantBinding[]};
}

/** Verify the historical pinned bytes before exposing any definition to an engine. */
export function readGameplaySupplement(profile:GameplayProfile, stored:StoredSupplement):GameplaySupplement {
 const ref=profile.supplement;
 if(!ref || !stored || canonicalJson(ref)!==canonicalJson(stored.ref) || !(stored.raw instanceof Uint8Array) || !(stored.provenance instanceof Uint8Array) || stored.raw.length!==ref.byteLength || sha(stored.raw)!==ref.hash || stored.provenance.length<1 || stored.provenance.length>67108864 || sha(stored.provenance)!==ref.provenanceHash) return unavailable();
 let value:unknown,provenance:unknown; try {const decode=(raw:Uint8Array)=>{const text=new TextDecoder("utf-8",{fatal:true}).decode(raw);const json:unknown=JSON.parse(text);if(canonicalJson(json)!==text) return unavailable();return json;}; value=decode(stored.raw);provenance=decode(stored.provenance);} catch {return unavailable();}
 const mapV2=ref.serialization==="huroof-gameplay-map-supplement-v2";
 const rawKeys=["schemaVersion","namespace","profileScope","profileSourceId","releaseId","releaseRootSha256","sourceManifestSha256","definitions","maps",...(mapV2?["definitionSet","mapCommitment","geographicOverlaySha256"]:[])];
 const provenanceKeys=["schemaVersion","namespace","profileScope","profileSourceId","releaseId","releaseRootSha256","receiptId","sourceManifestSha256","contentHash","contentSnapshot",...(mapV2?["mapRootEvidence"]:[])];
 if(!exact(value,rawKeys) || value.schemaVersion!==(mapV2?"huroof-gameplay-map-supplement-v2":"huroof-gameplay-supplement-v1") || value.namespace!==profile.namespace || value.profileScope!==profile.profileScope || value.profileSourceId!==profile.sourceId || value.releaseId!==profile.release.id || value.releaseRootSha256!==profile.release.rootSha256 || value.sourceManifestSha256!==profile.release.sourceManifestHash || !Array.isArray(value.definitions) || !Array.isArray(value.maps)) return unavailable();
 if(!exact(provenance,provenanceKeys) || provenance.schemaVersion!==(mapV2?"huroof-gameplay-map-supplement-provenance-v2":"huroof-gameplay-supplement-provenance-v1") || provenance.namespace!==profile.namespace || provenance.profileScope!==profile.profileScope || provenance.profileSourceId!==profile.sourceId || provenance.releaseId!==profile.release.id || provenance.releaseRootSha256!==profile.release.rootSha256 || provenance.receiptId!==profile.release.receiptId || provenance.sourceManifestSha256!==profile.release.sourceManifestHash || provenance.contentHash!==ref.hash || canonicalJson(provenance.contentSnapshot)!==canonicalJson(profile.contentSnapshot)) return unavailable();
 const mapRootMaterial=mapV2?validateMapRootMaterial(provenance.mapRootEvidence,value.definitionSet,value.maps,value.mapCommitment,value.geographicOverlaySha256,profile.release.sourceManifestHash):undefined;
 const seen=new Set<string>(),definitions:DefinitionEntry[]=[];
 for(const item of value.definitions) {
  if(!exact(item,["questionId","categoryId","kind","factFamilies","envelope"]) || typeof item.questionId!=="string" || !/^[A-Za-z0-9_-]{1,120}$/.test(item.questionId) || seen.has(item.questionId) || typeof item.categoryId!=="string" || typeof item.kind!=="string" || !Array.isArray(item.factFamilies) || !item.factFamilies.every(x=>typeof x==="string") || new Set(item.factFamilies).size!==item.factFamilies.length || !exact(item.envelope,["manifestSha256","id","schemaVersion","definitionSha256","canonicalJson"])) return unavailable();
  const definition=parseChallengeDefinitionEnvelope(item.envelope as ChallengeDefinitionEnvelope,sha);
  const requiresCapability=!mapV2 || (profile.categories.includes(item.categoryId as string) && (definition.kind!=="qatar_map" || profile.mapPresentation==="interactive"));
  if(requiresCapability && (!profile.challenge || !profile.challenge.mechanics.includes(definition.kind) || !profile.challenge.definitionSchemas.includes(definition.schemaVersion))) return unavailable();
  const binding:ChallengeQuestionBinding={categoryId:item.categoryId,challenge:{definition:{manifestSha256:(item.envelope as ChallengeDefinitionEnvelope).manifestSha256,id:definition.id,schemaVersion:definition.schemaVersion,definitionSha256:definition.definitionSha256},kind:definition.kind,factFamilies:item.factFamilies as string[]}};
  if(item.kind!==definition.kind || item.categoryId!==definition.categoryId || canonicalJson([...item.factFamilies].sort())!==canonicalJson([...definition.factFamilies].sort())) return unavailable();
  if(definition.disposition==="ready") assertChallengeDefinitionBinding(definition,binding);
  else if(definition.disposition!=="held") return unavailable();
  seen.add(item.questionId); definitions.push(item as unknown as DefinitionEntry);
 }
 const maps=value.maps as MapVariantBinding[];
 if(definitions.some((d,i)=>i>0 && definitions[i-1].questionId>=d.questionId) || maps.some((m,i)=>!record(m) || typeof m.runtimeQuestionId!=="string" || (!mapV2 && i>0 && maps[i-1].runtimeQuestionId>=m.runtimeQuestionId))) return unavailable();
 if(mapRootMaterial) {
  const entries=new Map(definitions.map(entry=>[entry.questionId,entry])),originals=new Map(mapRootMaterial.definitionSet.map(item=>[item.id,item]));
  for(const binding of maps) {
   const entry=entries.get(binding.runtimeQuestionId);
   if(!entry || entry.categoryId!=="tahadani-games-326" || entry.kind!=="qatar_map" || canonicalChallengeJson({manifestSha256:entry.envelope.manifestSha256,id:entry.envelope.id,schemaVersion:entry.envelope.schemaVersion,definitionSha256:entry.envelope.definitionSha256})!==canonicalChallengeJson(binding.definition) || canonicalChallengeJson([...entry.factFamilies].sort())!==canonicalChallengeJson([...binding.factFamilies].sort())) return unavailable();
   const original=originals.get(entry.envelope.id);
   if(!original || canonicalChallengeJson(original)!==canonicalChallengeJson(entry.envelope)) return unavailable();
  }
 }
 return {definitions,maps,...(mapRootMaterial?{mapRootMaterial}:{})};
}

/** Recheck the independent snapshot question reference, not just supplement metadata. */
export function definitionForQuestion(supplement:GameplaySupplement, question:ChallengeQuestionBinding & {id:string}):CanonicalChallengeDefinition {
 const entry=supplement.definitions.find(item=>item.questionId===question.id); if(!entry || !question.challenge) return unavailable();
 const ref=entry.envelope; if(canonicalJson(question.challenge.definition)!==canonicalJson({manifestSha256:ref.manifestSha256,id:ref.id,schemaVersion:ref.schemaVersion,definitionSha256:ref.definitionSha256})) return unavailable();
 const definition=parseChallengeDefinitionEnvelope(ref,sha); assertChallengeDefinitionBinding(definition,question); return definition;
}

/** The caller must separately authenticate this snapshot and its source lineage. */
export function validateMapSnapshot(supplement:GameplaySupplement, snapshot:unknown,releaseId:string):void {
 if(!supplement.mapRootMaterial || !record(snapshot) || !Array.isArray(snapshot.documents)) return unavailable();
 const maps=new Map(supplement.maps.map(binding=>[binding.runtimeQuestionId,binding]));
 const definitions=new Map(supplement.definitions.map(entry=>[entry.questionId,entry]));
 const seen=new Set<string>();
 for(const row of snapshot.documents) {
  if(!record(row) || typeof row.path!=="string" || !record(row.data)) return unavailable();
  const parts=row.path.split("/");if(parts.length!==4 || parts[0]!=="releases" || parts[1]!==releaseId || parts[2]!=="questions") continue;
  if(row.data.categoryId!=="tahadani-games-326") continue;
  const id=parts[3],binding=maps.get(id),entry=definitions.get(id);
  if(row.data.id!==id || seen.has(id) || !binding || !entry || sha(canonicalChallengeJson(row.data))!==binding.predecessorQuestionCanonicalSha256) return unavailable();
  const definition=parseChallengeDefinitionEnvelope(entry.envelope,sha);
  assertMapVariantBinding(binding,{id},sha(canonicalChallengeJson(runtimeQuestionProjection(row.data))),definition);
  seen.add(id);
 }
 if(seen.size!==maps.size) return unavailable();
}

/** Replay the actual map selector with the complete pinned cohort, including held bindings. */
export function materializePinnedMaps<T extends MapVariantQuestion>(supplement:GameplaySupplement,questions:readonly T[],presentation:"ordinary"|"interactive"):T[] {
 const ids=new Set(questions.map(question=>question.id));
 const bindings=supplement.maps.filter(binding=>ids.has(binding.runtimeQuestionId));
 const output=materializeMapPresentation(questions,presentation,bindings,
  question=>sha(canonicalChallengeJson(runtimeQuestionProjection(question as unknown as Record<string,unknown>))),
  binding=>{
   const entry=supplement.definitions.find(item=>item.questionId===binding.runtimeQuestionId);
   if(!entry || canonicalJson({manifestSha256:entry.envelope.manifestSha256,id:entry.envelope.id,schemaVersion:entry.envelope.schemaVersion,definitionSha256:entry.envelope.definitionSha256})!==canonicalJson(binding.definition)) return unavailable();
   return parseChallengeDefinitionEnvelope(entry.envelope,sha);
  });
 // The shared ordinary presentation deliberately retains historical held maps.
 // PostgreSQL's pinned wrapper validates those rows and excludes them in both
 // presentations; full source-cohort authentication remains a separate gate.
 const byQuestion=new Map(questions.map(question=>[question.id,question]));
 for(const binding of bindings) {
  const question=byQuestion.get(binding.runtimeQuestionId);
  const entry=supplement.definitions.find(item=>item.questionId===binding.runtimeQuestionId);
  if(!question || !entry) return unavailable();
  assertMapVariantBinding(binding,question,sha(canonicalChallengeJson(runtimeQuestionProjection(question as unknown as Record<string,unknown>))),parseChallengeDefinitionEnvelope(entry.envelope,sha));
 }
 const held=new Set(bindings.filter(binding=>binding.disposition==="held").map(binding=>binding.runtimeQuestionId));
 return output.filter(question=>!held.has(question.id));
}
