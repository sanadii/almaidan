import { createHash } from "node:crypto";
import { canonicalJson, documentsHash, SAFE_DOCUMENT_ID, type ReleaseDocument } from "../../../../../scripts/firestore-release-canonical.js";
import { questionRows } from "../../../../../functions/src/content-preparation.js";
import { runtimeQuestionProjection } from "../../../../../src/features/game/runtime/question-projection.js";
import type { CanonicalQuestion } from "../../../../../functions/src/game.js";
import { parseGameplayProfile, validateGameplayProfileProvenance, type GameplayRawRef } from "./profile";
import { definitionForQuestion, readGameplaySupplement, type GameplaySupplement, type StoredSupplement } from "./definition-reader";

const MAX_BYTES=64*1024*1024, MAX_DOCUMENTS=100000, MAX_DEPTH=64, MAX_SCOPE=10, MAX_QUESTIONS=10000;
const sha=(bytes: Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
export interface PinnedSnapshot {
 namespace: string; matchNamespace: string; projectId: string; profileRevision: string; receiptId: string; selectorVersion: string; readinessPolicyVersion: string; releaseId: string; huroofRoot: string; configReleaseId: string; configHuroofRoot: string;
 profileScope: string; profileFamily: string; profileSourceId: string; profileArtifactId: string; profileArtifactHash: string; profileArtifactLength: number; profileRawBytes: Uint8Array; profileSnapshotId: string; profileSnapshotHash: string; profileSnapshotLength: number; profileSnapshotMediaType: string; profileSnapshotSerialization: string; profileSnapshotProvenanceHash: string;
 snapshotId: string; snapshotHash: string; snapshotLength: number; snapshotMediaType: string; snapshotSerialization: string; snapshotProvenanceHash: string; snapshotBytes: Uint8Array; provenanceBytes: Uint8Array;
 receiptCatalogId: string; profileCatalogId: string; receiptCatalogRoot: string; profileCatalogRoot: string; receiptSealHash: string; sealHash: string; sourceEvidenceManifestHash: string;
 profileProvenanceHash?:string; profileProvenanceBytes?:Uint8Array; selectorCapabilityStateHash?:string; supplement?:StoredSupplement|null;
}
function deny(): never { throw new Error("PINNED_CONTENT_UNAVAILABLE"); }
function plain(value: unknown): value is Record<string,unknown> { return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function bounded(value: unknown): void {
 const stack: Array<[unknown,number]>=[[value,0]];
 while(stack.length) { const [node,depth]=stack.pop()!; if(depth>MAX_DEPTH) deny(); if(Array.isArray(node)) for(const child of node) stack.push([child,depth+1]); else if(plain(node)) for(const child of Object.values(node)) stack.push([child,depth+1]); else if(node!==null && typeof node!=="string" && typeof node!=="boolean" && !(typeof node==="number" && Number.isFinite(node))) deny(); }
}
/** New profiles use their full historical raw and supplement identities; legacy callers retain the old path. */
export function readPinnedGameplay(pin:PinnedSnapshot):{profile:import("./profile").GameplayProfile;supplement:GameplaySupplement|null} {
 const profile=parseGameplayProfile(pin.profileRawBytes,pin.profileArtifactHash);
 // The root artifact is not itself evidence of receipt-bound inclusion.
 // Keep every v2 pin unavailable until admitted historical authority exists.
 if(profile.supplement?.serialization==="huroof-gameplay-map-supplement-v2") return deny();
 const ref:GameplayRawRef={namespace:pin.namespace,id:pin.profileArtifactId,hash:pin.profileArtifactHash,byteLength:pin.profileArtifactLength,mediaType:"application/json",serialization:"huroof-gameplay-profile-v1",provenanceHash:pin.profileProvenanceHash??""};
 if(!pin.profileProvenanceBytes) return deny();validateGameplayProfileProvenance(profile,ref,pin.profileProvenanceBytes);
 if(profile.namespace!==pin.namespace || profile.profileScope!==pin.profileScope || profile.sourceId!==pin.profileSourceId || profile.release.id!==pin.releaseId || profile.release.rootSha256!==pin.huroofRoot || profile.release.receiptId!==pin.receiptId || profile.release.catalogId!==pin.receiptCatalogId || profile.release.catalogRoot!==pin.receiptCatalogRoot || profile.release.sealHash!==pin.receiptSealHash || profile.release.sourceManifestHash!==pin.sourceEvidenceManifestHash || profile.selector.version!==pin.selectorVersion || profile.selector.capabilityStateHash!==pin.selectorCapabilityStateHash || profile.readiness.policyVersion!==pin.readinessPolicyVersion || profile.contentSnapshot.id!==pin.snapshotId || profile.contentSnapshot.hash!==pin.snapshotHash || profile.contentSnapshot.byteLength!==pin.snapshotLength || profile.contentSnapshot.provenanceHash!==pin.snapshotProvenanceHash || profile.contentSnapshot.serialization!==pin.snapshotSerialization || profile.contentSnapshot.mediaType!==pin.snapshotMediaType) return deny();
 if(profile.supplement===null) {if(pin.supplement!==null) return deny();return {profile,supplement:null};}
 if(!pin.supplement) return deny();return {profile,supplement:readGameplaySupplement(profile,pin.supplement)};
}
/** Caller obtains this exact join from the restricted, authenticated PG reader, not HTTP. */
function readPinnedQuestionData(pin: PinnedSnapshot, requestedCategories: readonly string[]): {questions:CanonicalQuestion[];categoryDocuments:Map<string,Record<string,unknown>>} {
 if (!pin || !pin.namespace || pin.namespace!==pin.matchNamespace || !SAFE_DOCUMENT_ID.test(pin.releaseId) || pin.configReleaseId!==pin.releaseId || pin.configHuroofRoot!==pin.huroofRoot || !/^[a-f0-9]{64}$/.test(pin.huroofRoot) || !pin.profileScope || pin.profileFamily!=="profile" || !pin.profileSourceId || !pin.profileArtifactId || !/^[a-f0-9]{64}$/.test(pin.profileArtifactHash)) deny();
 if (!(pin.profileRawBytes instanceof Uint8Array) || !Number.isSafeInteger(pin.profileArtifactLength) || pin.profileArtifactLength<1 || pin.profileArtifactLength>MAX_BYTES || pin.profileRawBytes.byteLength!==pin.profileArtifactLength || sha(pin.profileRawBytes)!==pin.profileArtifactHash) deny();
 let profile: unknown; try { profile=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(pin.profileRawBytes)); } catch { return deny(); }
 if (!plain(profile) || !plain(profile.contentSnapshot)) deny();
 const ref=profile.contentSnapshot;
 if (ref.namespace!==pin.namespace || ref.id!==pin.profileSnapshotId || ref.hash!==pin.profileSnapshotHash || ref.byteLength!==pin.profileSnapshotLength || ref.mediaType!==pin.profileSnapshotMediaType || ref.serialization!==pin.profileSnapshotSerialization || ref.provenanceHash!==pin.profileSnapshotProvenanceHash) deny();
 if (!pin.snapshotId || pin.snapshotId!==pin.profileSnapshotId || pin.snapshotHash!==pin.profileSnapshotHash || pin.snapshotLength!==pin.profileSnapshotLength || pin.snapshotMediaType!==pin.profileSnapshotMediaType || pin.snapshotSerialization!==pin.profileSnapshotSerialization || pin.snapshotProvenanceHash!==pin.profileSnapshotProvenanceHash || pin.snapshotMediaType!=="application/json" || pin.snapshotSerialization!=="huroof-release-snapshot-v1" || !pin.receiptCatalogId || pin.profileCatalogId!==pin.receiptCatalogId || pin.profileCatalogRoot!==pin.receiptCatalogRoot || pin.receiptSealHash!==pin.sealHash) deny();
 if (!(pin.snapshotBytes instanceof Uint8Array) || !(pin.provenanceBytes instanceof Uint8Array) || pin.provenanceBytes.byteLength>MAX_BYTES || !/^[a-f0-9]{64}$/.test(pin.snapshotHash) || !/^[a-f0-9]{64}$/.test(pin.snapshotProvenanceHash) || !/^[a-f0-9]{64}$/.test(pin.receiptCatalogRoot) || !/^[a-f0-9]{64}$/.test(pin.sealHash) || !Number.isSafeInteger(pin.snapshotLength) || pin.snapshotLength<1 || pin.snapshotLength>MAX_BYTES || pin.snapshotBytes.byteLength!==pin.snapshotLength || sha(pin.snapshotBytes)!==pin.snapshotHash || sha(pin.provenanceBytes)!==pin.snapshotProvenanceHash) deny();
 let text: string, value: unknown; try { text=new TextDecoder("utf-8",{fatal:true}).decode(pin.snapshotBytes); value=JSON.parse(text); } catch { return deny(); }
 bounded(value); if(!plain(value) || Object.keys(value).sort().join("|")!=="documents|releaseId|schemaVersion" || value.schemaVersion!=="huroof-release-snapshot-v1" || value.releaseId!==pin.releaseId || !Array.isArray(value.documents) || value.documents.length>MAX_DOCUMENTS || canonicalJson(value)!==text) deny();
 const docs: ReleaseDocument[]=[], seen=new Set<string>(), categories=new Set<string>(), categoryDocuments=new Map<string,Record<string,unknown>>(), inventory=new Map<string,number>(), counts=new Map<string,number>();
 const questions: Array<{id:string; data:Record<string,unknown>}> = [];
 for(const item of value.documents) {
  if(!plain(item) || Object.keys(item).sort().join("|")!=="data|path" || typeof item.path!=="string" || !plain(item.data) || seen.has(item.path)) deny();
  const segments=item.path.split("/"); if(segments.length!==4 || segments[0]!=="releases" || segments[1]!==pin.releaseId || !SAFE_DOCUMENT_ID.test(segments[3]) || !["catalogCategories","questions","inventory"].includes(segments[2])) deny();
  seen.add(item.path); docs.push({path:item.path,data:item.data}); const id=segments[3], data=item.data;
  if(segments[2]==="catalogCategories") { if(data.id!==id) deny(); categories.add(id); categoryDocuments.set(id,data); }
  else if(segments[2]==="inventory") { if(data.categoryId!==id || !Number.isSafeInteger(data.approvedCount) || (data.approvedCount as number)<=0) deny(); inventory.set(id,data.approvedCount as number); }
  else { if(data.id!==id || typeof data.categoryId!=="string" || !SAFE_DOCUMENT_ID.test(data.categoryId)) deny(); questions.push({id,data}); counts.set(data.categoryId,(counts.get(data.categoryId)??0)+1); }
 }
 if(documentsHash(docs)!==pin.huroofRoot || categories.size!==counts.size || categories.size!==inventory.size || [...categories].some(id=>!counts.has(id)||!inventory.has(id)) || [...counts].some(([id,count])=>!categories.has(id)||inventory.get(id)!==count) || [...inventory].some(([id,count])=>!categories.has(id)||counts.get(id)!==count)) deny();
 if (!Array.isArray(requestedCategories)) deny();
 const scope=[...requestedCategories]; if(scope.length<1 || scope.length>MAX_SCOPE || new Set(scope).size!==scope.length || scope.some(id=>!SAFE_DOCUMENT_ID.test(id)||!categories.has(id)||!inventory.has(id))) deny();
 const selected=questions.filter(q=>scope.includes(q.data.categoryId as string)); if(selected.length>MAX_QUESTIONS) deny();
 return {questions:questionRows(selected.map(({id,data})=>({id,data:()=>runtimeQuestionProjection(data)}))),categoryDocuments};
}
export function readPinnedQuestions(pin:PinnedSnapshot,requestedCategories:readonly string[]):CanonicalQuestion[] {return readPinnedQuestionData(pin,requestedCategories).questions;}

/** Exact ECMAScript WhiteSpace and LineTerminator set; labels remain unmodified. */
const CATEGORY_BLANK=/^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/u;
const INVALID_CATEGORY_SCALAR=/\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u;
export function assertCategorySnapshot(expected:readonly {id:string;labelAr:string}[],config:Pick<import("../../../../../functions/src/game.js").CanonicalRoom["config"],"categorySnapshot">):void {
 if(canonicalJson(config.categorySnapshot??null)!==canonicalJson(expected)) deny();
}

export function readGameplayQuestions(pin:PinnedSnapshot,requestedCategories:readonly string[]):{profile:import("./profile").GameplayProfile;supplement:GameplaySupplement|null;questions:CanonicalQuestion[];categorySnapshot:null|{id:string;labelAr:string}[]} {
 const {questions,categoryDocuments}=readPinnedQuestionData(pin,requestedCategories),{profile,supplement}=readPinnedGameplay(pin);
 if(canonicalJson(profile.categories)!==canonicalJson(requestedCategories)) return deny();
 let categorySnapshot:null|{id:string;labelAr:string}[]=null;
 if(profile.gameKind==='categories') {
  if(profile.categories.length<2 || profile.categories.length>10) return deny();
  categorySnapshot=profile.categories.map(id=>{const data=categoryDocuments.get(id);if(!data)return deny();const label=data.labelAr??data.displayNameAr;if(typeof label!=='string' || CATEGORY_BLANK.test(label) || INVALID_CATEGORY_SCALAR.test(label)) return deny();return {id,labelAr:label};});
  if(new TextEncoder().encode(canonicalJson(categorySnapshot)).length>262144) return deny();
 }
 if(!supplement) {if(questions.some(q=>q.challenge)) return deny();return {profile,supplement,questions,categorySnapshot};}
 const byId=new Map(questions.map(question=>[question.id,question]));
 for(const entry of supplement.definitions) {
  if(!profile.categories.includes(entry.categoryId)) continue;
  const question=byId.get(entry.questionId);if(!question || question.categoryId!==entry.categoryId) return deny();
  if(question.challenge) definitionForQuestion(supplement,question);
  else if(!supplement.maps.some(binding=>binding.runtimeQuestionId===entry.questionId)) return deny();
 }
 const containsMap=questions.some(q=>q.categoryId==="tahadani-games-326");
 // The current supplement format has not yet bound the independently attested release-root map cohort.
 if(containsMap) return deny();
 const effective=questions;
 if(profile.mapPresentation==="interactive" && !containsMap) return deny();
 for(const question of effective) if(question.challenge) definitionForQuestion(supplement,question);
 return {profile,supplement,questions:effective,categorySnapshot};
}

/** An external verifier owns signature/issuer validation. No verifier or trust policy is installed by this module. */
export interface CustodySubject {
 namespace: string; projectId: string; profileScope: string; profileFamily: string; profileSourceId: string; profileId: string; profileHash: string; profileRevision: string;
 snapshotId: string; snapshotHash: string; snapshotLength: number; snapshotSerialization: string; provenanceHash: string;
 releaseId: string; huroofRoot: string; catalogId: string; catalogRoot: string; sealHash: string; receiptId: string;
 selectorVersion: string; readinessPolicyVersion: string; identityPolicyRevision: string; identityPolicyHash: string;
}
export interface CustodyPolicyRow { namespace: string; projectId: string; policyId: string; revision: string; generation: string; hash: string; mediaType: string; serialization: string; length: number; raw: Uint8Array }
export interface CustodyTrustPolicy { authorityPolicyId: string; authorityPolicyRevision: string; authorityPolicyHash: string; authorityGeneration: string; validFrom: number; validUntil: number; maxAgeMs: number; issuers: Array<{issuerId:string;trustRootId:string;keyId:string}>; evidenceVersions: string[]; revokedEvidenceIds: string[] }
export interface CustodyEvidenceVerifier {
 /** Implemented by a separately provisioned signature/custody verifier; no implementation is installed by 03. */
 readonly supportedEvidenceVersions: readonly string[];
 verify(subject: CustodySubject, provenance: Uint8Array): Promise<unknown>;
}
export interface VerifiedCustody { status: "verified"; evidenceVersion: string; evidenceId: string; evidenceHash: string; issuerId: string; keyId: string; trustRootId: string; authorityPolicyId: string; authorityPolicyRevision: string; authorityPolicyHash: string; authorityGeneration: string; subject: CustodySubject; validatedAt: number; validUntil: number }
const evidenceIdPattern=/^[A-Za-z0-9._:-]{1,200}$/;
function decimal(value: unknown, positive=false): number {
 if(typeof value!=="string" || !(positive?/^[1-9][0-9]*$/:/^(0|[1-9][0-9]*)$/).test(value)) deny();
 const parsed=Number(value); if(!Number.isSafeInteger(parsed) || parsed<0) deny(); return parsed;
}
function idArray(value: unknown): string[] {
 if(!Array.isArray(value) || value.some(x=>typeof x!=="string" || !evidenceIdPattern.test(x)) || new Set(value).size!==value.length) deny();
 return value as string[];
}
/** Exact reserved head and immutable raw policy; this validates structure, not policy provisioning authority. */
export function parseCustodyPolicy(row: CustodyPolicyRow, namespace: string, projectId: string, supportedVersions: readonly string[]): CustodyTrustPolicy {
 if(!row || row.namespace!==namespace || row.projectId!==projectId || row.policyId!=="eng03.custody-authority.v1" || !/^[1-9][0-9]*$/.test(row.revision) || !/^(0|[1-9][0-9]*)$/.test(row.generation) || !/^[a-f0-9]{64}$/.test(row.hash) || row.mediaType!=="application/json" || row.serialization!=="huroof-custody-authority-policy-v1" || !(row.raw instanceof Uint8Array) || !Number.isSafeInteger(row.length) || row.length<1 || row.length>65536 || row.raw.byteLength!==row.length || sha(row.raw)!==row.hash) deny();
 let text: string, value: unknown; try {text=new TextDecoder("utf-8",{fatal:true}).decode(row.raw);value=JSON.parse(text);} catch {return deny();}
 bounded(value);
 if(!plain(value) || Object.keys(value).sort().join("|")!=="acceptedEvidenceVersions|enabled|firebaseProjectId|issuers|maxEvidenceAgeMs|namespace|policyId|revision|revokedEvidenceIds|schemaVersion|validFromEpochMs|validUntilEpochMs" || canonicalJson(value)!==text || value.schemaVersion!=="huroof-custody-authority-policy-v1" || value.namespace!==namespace || value.firebaseProjectId!==projectId || value.policyId!==row.policyId || value.revision!==row.revision || value.enabled!==true) deny();
 const validFrom=decimal(value.validFromEpochMs), validUntil=decimal(value.validUntilEpochMs), maxAgeMs=decimal(value.maxEvidenceAgeMs,true);
 if(validUntil<=validFrom) deny();
 const versions=idArray(value.acceptedEvidenceVersions), revoked=idArray(value.revokedEvidenceIds);
 if(!versions.length || versions.some(version=>!supportedVersions.includes(version)) || !Array.isArray(value.issuers) || !value.issuers.length) deny();
 const seen=new Set<string>(); const issuers: CustodyTrustPolicy["issuers"]=[];
 for(const item of value.issuers) {
  if(!plain(item) || Object.keys(item).sort().join("|")!=="enabled|issuerId|keyId|trustRootId" || typeof item.enabled!=="boolean" || typeof item.issuerId!=="string" || typeof item.keyId!=="string" || typeof item.trustRootId!=="string" || !evidenceIdPattern.test(item.issuerId) || !evidenceIdPattern.test(item.keyId) || !evidenceIdPattern.test(item.trustRootId)) deny();
  const key=`${item.issuerId}\0${item.keyId}\0${item.trustRootId}`; if(seen.has(key)) deny(); seen.add(key);
  if(item.enabled) issuers.push({issuerId:item.issuerId,keyId:item.keyId,trustRootId:item.trustRootId});
 }
 if(!issuers.length) deny();
 return {authorityPolicyId:row.policyId,authorityPolicyRevision:row.revision,authorityPolicyHash:row.hash,authorityGeneration:row.generation,validFrom,validUntil,maxAgeMs,issuers,evidenceVersions:versions,revokedEvidenceIds:revoked};
}
export function custodySubject(pin: PinnedSnapshot, identityPolicyRevision: string, identityPolicyHash: string): CustodySubject {
 if (!pin.projectId || !pin.receiptId || !pin.selectorVersion || !pin.readinessPolicyVersion || !/^[1-9][0-9]*$/.test(pin.profileRevision) || !/^[1-9][0-9]*$/.test(identityPolicyRevision) || !/^[a-f0-9]{64}$/.test(identityPolicyHash)) deny();
 return {namespace:pin.namespace,projectId:pin.projectId,profileScope:pin.profileScope,profileFamily:pin.profileFamily,profileSourceId:pin.profileSourceId,profileId:pin.profileArtifactId,profileHash:pin.profileArtifactHash,profileRevision:pin.profileRevision,snapshotId:pin.snapshotId,snapshotHash:pin.snapshotHash,snapshotLength:pin.snapshotLength,snapshotSerialization:pin.snapshotSerialization,provenanceHash:pin.snapshotProvenanceHash,releaseId:pin.releaseId,huroofRoot:pin.huroofRoot,catalogId:pin.receiptCatalogId,catalogRoot:pin.receiptCatalogRoot,sealHash:pin.sealHash,receiptId:pin.receiptId,selectorVersion:pin.selectorVersion,readinessPolicyVersion:pin.readinessPolicyVersion,identityPolicyRevision,identityPolicyHash};
}
/** Validates the complete authenticated verifier response against an independently read policy. */
export async function requireCustody(pin: PinnedSnapshot, identityPolicyRevision: string, identityPolicyHash: string, now: number, trust: CustodyTrustPolicy | undefined, verifier: CustodyEvidenceVerifier | undefined): Promise<VerifiedCustody> {
 if (!trust || !verifier || !Number.isSafeInteger(now) || now<trust.validFrom || now>=trust.validUntil) throw new Error("CUSTODY_AUTHORITY_UNAVAILABLE");
 const subject=custodySubject(pin,identityPolicyRevision,identityPolicyHash);
 let result: unknown; try {result=await verifier.verify(subject,pin.provenanceBytes);} catch {throw new Error("CUSTODY_AUTHORITY_UNAVAILABLE");}
 if (!plain(result) || result.status!=="verified" || !plain(result.subject) || typeof result.evidenceVersion!=="string" || !trust.evidenceVersions.includes(result.evidenceVersion) || !verifier.supportedEvidenceVersions.includes(result.evidenceVersion) || typeof result.evidenceId!=="string" || !evidenceIdPattern.test(result.evidenceId) || trust.revokedEvidenceIds.includes(result.evidenceId) || typeof result.evidenceHash!=="string" || !/^[a-f0-9]{64}$/.test(result.evidenceHash) || typeof result.issuerId!=="string" || typeof result.keyId!=="string" || typeof result.trustRootId!=="string" || !trust.issuers.some(issuer=>issuer.issuerId===result.issuerId && issuer.keyId===result.keyId && issuer.trustRootId===result.trustRootId) || result.authorityPolicyId!==trust.authorityPolicyId || result.authorityPolicyRevision!==trust.authorityPolicyRevision || result.authorityPolicyHash!==trust.authorityPolicyHash || result.authorityGeneration!==trust.authorityGeneration || !Number.isSafeInteger(result.validatedAt) || !Number.isSafeInteger(result.validUntil) || (result.validatedAt as number)>now || (result.validUntil as number)<=now || (result.validUntil as number)>trust.validUntil || (result.validUntil as number)<=(result.validatedAt as number) || now-(result.validatedAt as number)>trust.maxAgeMs || canonicalJson(result.subject)!==canonicalJson(subject)) throw new Error("CUSTODY_AUTHORITY_UNAVAILABLE");
 return result as unknown as VerifiedCustody;
}
