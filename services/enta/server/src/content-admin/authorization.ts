import type { AdminRole, VerifiedAdminClaims } from "./claims";

export type Capability = "session" | "questions.read" | "questions.inspect" | "questions.write" | "reviews.read" | "reviews.decide" | "categories.read" | "categories.write" | "releases.read" | "releases.stage" | "rooms.read" | "rooms.act" | "users.read" | "users.write" | "audit.read" | "health.read" | "settings.read" | "settings.write";
const capabilities: Record<AdminRole, readonly Capability[]> = {
  super_admin: ["session","questions.read","questions.inspect","questions.write","reviews.read","reviews.decide","categories.read","categories.write","releases.read","releases.stage","rooms.read","rooms.act","users.read","users.write","audit.read","health.read","settings.read","settings.write"],
  content_admin: ["session","questions.read","questions.inspect","questions.write","reviews.read","categories.read","categories.write","releases.read","releases.stage","audit.read","health.read","settings.read"],
  reviewer: ["session","questions.read","questions.inspect","reviews.read","reviews.decide","categories.read","audit.read","health.read"],
  game_ops: ["session","rooms.read","rooms.act","audit.read","health.read"],
  viewer: ["session","questions.read","reviews.read","categories.read","releases.read","rooms.read","audit.read","health.read","settings.read"],
};
export function capabilitiesFor(roles:readonly AdminRole[]):Capability[] {return [...new Set(roles.flatMap(role=>capabilities[role]??[]))];}
export interface AdminRegistry {
  namespace: string; projectId: string; identityId: string; enabled: boolean; disabled: boolean;
  identityReady: boolean; authzVersion: number; roles: readonly AdminRole[];
  categoryScopes: readonly string[]; reviewerScopes: readonly string[];
}
export function requireAdmin(claims: VerifiedAdminClaims, row: AdminRegistry, capability: Capability, categories: readonly string[] = []): void {
  if (!row || row.namespace !== claims.namespace || row.projectId !== claims.projectId || row.identityId !== claims.identityId ||
      !row.enabled || row.disabled || !row.identityReady || row.authzVersion !== claims.claimAuthzVersion ||
      row.roles.length !== claims.claimRoles.length || row.roles.some((role, index) => role !== claims.claimRoles[index]) ||
      !row.roles.some(role => capabilities[role]?.includes(capability)) ||
      categories.some(category => !/^[A-Za-z0-9_-]{1,128}$/.test(category) || (!row.roles.includes("super_admin") && !row.categoryScopes.includes(category)))) {
    throw new Error("ADMIN_DENIED");
  }
}
export function requireReviewer(claims: VerifiedAdminClaims, row: AdminRegistry, category: string, authorIdentityId: string, specialties: readonly string[]): void {
  requireAdmin(claims, row, "reviews.decide", [category]);
  if (claims.identityId === authorIdentityId || specialties.some(role => !row.reviewerScopes.includes(role))) throw new Error("ADMIN_DENIED");
}

import { createHash } from "node:crypto";
import { canonicalJson } from "../../../../../scripts/firestore-release-canonical.js";
export interface LegacyPublisherSubject {
 kind:"profile-append"|"pointer-move"; namespace:string; projectId:string; identityId:string; identityPolicyRevision:string; identityPolicyHash:string;
 profileScope:string; pointerVersion:string|null; profileSourceId:string; profileRevision:string; profileRawId:string; profileHash:string;
 snapshotId:string; snapshotHash:string; snapshotProvenanceHash:string; releaseId:string; releaseRoot:string; receiptId:string; catalogId:string; catalogRoot:string; sealHash:string; categories:readonly string[];
}
import { parseGameplayProfile, validateGameplayProfileProvenance, type GameplayRawRef } from "../huroof-pg/profile";
import { definitionForQuestion, readGameplaySupplement, type MapRootMaterial } from "../huroof-pg/definition-reader";
import { readPinnedQuestions } from "../huroof-pg/content-reader";
export type PublisherSubject = LegacyPublisherSubject | (LegacyPublisherSubject & {schemaVersion:"huroof-gameplay-publication-subject-v1";profileRaw:GameplayRawRef;supplement:GameplayRawRef|null;sourceManifestSha256:string});
export interface GameplayPublicationMaterial {profileProvenance:Uint8Array;snapshot:{raw:Uint8Array;provenance:Uint8Array};supplement:null|{raw:Uint8Array;provenance:Uint8Array};mapRootEvidence?:MapRootMaterial}
export type PublicationPurpose = "rights" | "editorial" | "validation" | "semantic" | "custody";
export interface PublisherTrust { namespace:string;projectId:string;policyId:string;revision:string;hash:string;validFrom:number;validUntil:number;maxAgeMs:number;versions:readonly string[];revokedEvidenceIds:readonly string[];issuers:readonly {purpose:PublicationPurpose;issuerId:string;keyId:string;trustRootId:string}[] }
export interface PublisherAuthority {readCurrentPolicy(namespace:string,projectId:string):Promise<PublisherTrust|null>;verify(subject:PublisherSubject,profileBytes:Uint8Array,material?:GameplayPublicationMaterial):Promise<unknown>}
/** One observed attestation must cover every required purpose under the independent policy. */
export async function requirePublisherEvidence(subject:PublisherSubject,authority:PublisherAuthority|undefined,profileBytes:Uint8Array,material?:GameplayPublicationMaterial):Promise<import("./contracts").EvidenceSummary> {
 if(!authority || !(profileBytes instanceof Uint8Array) || createHash("sha256").update(profileBytes).digest("hex")!==subject.profileHash || !subject.categories.length || new Set(subject.categories).size!==subject.categories.length || subject.categories.some((v,i)=>!/^[A-Za-z0-9_-]{1,120}$/.test(v) || (i>0 && subject.categories[i-1]>=v))) throw new Error("PUBLISHER_AUTHORITY_UNAVAILABLE");
 if("schemaVersion" in subject) {
  try {
   const fields=["kind","namespace","projectId","identityId","identityPolicyRevision","identityPolicyHash","profileScope","pointerVersion","profileSourceId","profileRevision","profileRawId","profileHash","snapshotId","snapshotHash","snapshotProvenanceHash","releaseId","releaseRoot","receiptId","catalogId","catalogRoot","sealHash","categories","schemaVersion","profileRaw","supplement","sourceManifestSha256"];
   if(Object.keys(subject).length!==fields.length || !fields.every(key=>Object.hasOwn(subject,key))) throw new Error("subject shape");
   const profile=parseGameplayProfile(profileBytes,subject.profileHash);
   // No provisioned verifier has yet established receipt-bound source-root
   // inclusion. A map-bearing pin cannot be published even for a non-map scope.
   if(profile.supplement?.serialization==="huroof-gameplay-map-supplement-v2") throw new Error("map supplier unavailable");
   if(material && Object.hasOwn(material,"mapRootEvidence")) throw new Error("unexpected map material");
   if(subject.schemaVersion!=="huroof-gameplay-publication-subject-v1" || !material || !["profile-append","pointer-move"].includes(subject.kind) || profile.namespace!==subject.namespace || profile.profileScope!==subject.profileScope || profile.sourceId!==subject.profileSourceId || profile.categories.some(category=>!subject.categories.includes(category)) || profile.release.id!==subject.releaseId || profile.release.rootSha256!==subject.releaseRoot || profile.release.receiptId!==subject.receiptId || profile.release.catalogId!==subject.catalogId || profile.release.catalogRoot!==subject.catalogRoot || profile.release.sealHash!==subject.sealHash || profile.release.sourceManifestHash!==subject.sourceManifestSha256 || profile.contentSnapshot.id!==subject.snapshotId || profile.contentSnapshot.hash!==subject.snapshotHash || profile.contentSnapshot.provenanceHash!==subject.snapshotProvenanceHash || subject.profileRaw.id!==subject.profileRawId || subject.profileRaw.hash!==subject.profileHash || subject.profileRaw.byteLength!==profileBytes.byteLength || canonicalJson(profile.supplement)!==canonicalJson(subject.supplement)) throw new Error("subject mismatch");
   validateGameplayProfileProvenance(profile,subject.profileRaw,material.profileProvenance);
   const supplement=profile.supplement && material.supplement?readGameplaySupplement(profile,{ref:profile.supplement,raw:material.supplement.raw,provenance:material.supplement.provenance}):null;
   if((profile.supplement===null)!==(material.supplement===null)) throw new Error("supplement mismatch");
   const s=profile.contentSnapshot;
   // Snapshot semantics only: current receipt capability and selector authority must be independently rejoined by the publisher/SQL boundary.
   const questions=readPinnedQuestions({namespace:subject.namespace,matchNamespace:subject.namespace,projectId:subject.projectId,profileRevision:subject.profileRevision,receiptId:subject.receiptId,selectorVersion:profile.selector.version,readinessPolicyVersion:profile.readiness.policyVersion,releaseId:subject.releaseId,huroofRoot:subject.releaseRoot,configReleaseId:subject.releaseId,configHuroofRoot:subject.releaseRoot,profileScope:subject.profileScope,profileFamily:"profile",profileSourceId:subject.profileSourceId,profileArtifactId:subject.profileRawId,profileArtifactHash:subject.profileHash,profileArtifactLength:subject.profileRaw.byteLength,profileRawBytes:profileBytes,profileSnapshotId:s.id,profileSnapshotHash:s.hash,profileSnapshotLength:s.byteLength,profileSnapshotMediaType:s.mediaType,profileSnapshotSerialization:s.serialization,profileSnapshotProvenanceHash:s.provenanceHash,snapshotId:s.id,snapshotHash:s.hash,snapshotLength:s.byteLength,snapshotMediaType:s.mediaType,snapshotSerialization:s.serialization,snapshotProvenanceHash:s.provenanceHash,snapshotBytes:material.snapshot.raw,provenanceBytes:material.snapshot.provenance,receiptCatalogId:subject.catalogId,profileCatalogId:subject.catalogId,receiptCatalogRoot:subject.catalogRoot,profileCatalogRoot:subject.catalogRoot,receiptSealHash:subject.sealHash,sealHash:subject.sealHash,sourceEvidenceManifestHash:subject.sourceManifestSha256},profile.categories);
   if(!supplement && questions.some(question=>question.challenge)) throw new Error("supplement mismatch");
   if(supplement) {if(questions.some(question=>question.categoryId==="tahadani-games-326")) throw new Error("map commitment unavailable");const byId=new Map(questions.map(question=>[question.id,question]));for(const entry of supplement.definitions) if(profile.categories.includes(entry.categoryId)) {const question=byId.get(entry.questionId);if(!question?.challenge || question.categoryId!==entry.categoryId) throw new Error("definition mismatch");definitionForQuestion(supplement,question);}for(const question of questions) if(question.challenge) definitionForQuestion(supplement,question);}
   const parsedSnapshot=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(material.snapshot.raw)) as {documents:Array<{path:string}>};
   const allCategories=parsedSnapshot.documents.filter(document=>document.path.split("/")[2]==="catalogCategories").map(document=>document.path.split("/")[3]).sort();
   if(canonicalJson(allCategories)!==canonicalJson(subject.categories)) throw new Error("category authority mismatch");
  } catch {throw new Error("PUBLISHER_AUTHORITY_UNAVAILABLE");}
 }
 let trust:PublisherTrust|null;try{trust=await authority.readCurrentPolicy(subject.namespace,subject.projectId);}catch{throw new Error("PUBLISHER_AUTHORITY_UNAVAILABLE");}
 const now=Date.now();if(!trust || trust.namespace!==subject.namespace || trust.projectId!==subject.projectId || !/^[A-Za-z0-9._:-]{1,200}$/.test(trust.policyId) || !/^[1-9][0-9]*$/.test(trust.revision) || !/^[a-f0-9]{64}$/.test(trust.hash) || !Number.isSafeInteger(trust.validFrom) || !Number.isSafeInteger(trust.validUntil) || !Number.isSafeInteger(trust.maxAgeMs) || trust.maxAgeMs<1 || trust.validUntil<=trust.validFrom || now<trust.validFrom || now>=trust.validUntil || !Array.isArray(trust.versions) || !trust.versions.length || !Array.isArray(trust.revokedEvidenceIds) || !Array.isArray(trust.issuers) || !trust.issuers.length || trust.versions.some(v=>typeof v!=="string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(v)) || new Set(trust.versions).size!==trust.versions.length || trust.revokedEvidenceIds.some(v=>typeof v!=="string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(v)) || new Set(trust.revokedEvidenceIds).size!==trust.revokedEvidenceIds.length || trust.issuers.some(v=>!v || !["rights","editorial","validation","semantic","custody"].includes(v.purpose) || !/^[A-Za-z0-9._:-]{1,200}$/.test(v.issuerId) || !/^[A-Za-z0-9._:-]{1,200}$/.test(v.keyId) || !/^[A-Za-z0-9._:-]{1,200}$/.test(v.trustRootId))) throw new Error("PUBLISHER_AUTHORITY_UNAVAILABLE");
 let result:unknown;try{result=await authority.verify(subject,profileBytes,material);}catch{throw new Error("PUBLISHER_AUTHORITY_UNAVAILABLE");}
 if(!result || typeof result!=="object" || Array.isArray(result)) throw new Error("PUBLISHER_AUTHORITY_UNAVAILABLE");const r=result as Record<string,unknown>,purposes=["rights","editorial","validation","semantic","custody"];
 if(("schemaVersion" in subject && r.evidenceVersion!=="huroof-gameplay-semantic-v1") || Object.keys(r).sort().join("|")!=="evidenceHash|evidenceId|evidenceVersion|issuerId|keyId|policyHash|policyId|policyRevision|purposes|status|subject|trustRootId|validUntil|validatedAt" || !Array.isArray(r.purposes) || r.purposes.length!==5 || purposes.some(x=>!(r.purposes as unknown[]).includes(x)) || r.status!=="verified" || typeof r.evidenceVersion!=="string" || !trust.versions.includes(r.evidenceVersion) || typeof r.evidenceId!=="string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(r.evidenceId) || trust.revokedEvidenceIds.includes(r.evidenceId) || typeof r.evidenceHash!=="string" || !/^[a-f0-9]{64}$/.test(r.evidenceHash) || r.policyId!==trust.policyId || r.policyRevision!==trust.revision || r.policyHash!==trust.hash || purposes.some(p=>!trust!.issuers.some(x=>x.purpose===p && x.issuerId===r.issuerId && x.keyId===r.keyId && x.trustRootId===r.trustRootId)) || !Number.isSafeInteger(r.validatedAt) || !Number.isSafeInteger(r.validUntil) || (r.validatedAt as number)<trust.validFrom || (r.validatedAt as number)>now || (r.validUntil as number)<=now || (r.validUntil as number)>trust.validUntil || now-(r.validatedAt as number)>trust.maxAgeMs || (r.validUntil as number)<=(r.validatedAt as number)) throw new Error("PUBLISHER_AUTHORITY_UNAVAILABLE");
 try{if(canonicalJson(r.subject)!==canonicalJson(subject)) throw new Error("subject mismatch");const latest=await authority.readCurrentPolicy(subject.namespace,subject.projectId);const finalNow=Date.now();if(!latest || canonicalJson(latest)!==canonicalJson(trust) || finalNow>=trust.validUntil || finalNow>=(r.validUntil as number) || finalNow-(r.validatedAt as number)>trust.maxAgeMs) throw new Error("policy changed");}catch{throw new Error("PUBLISHER_AUTHORITY_UNAVAILABLE");}
 return {evidenceVersion:r.evidenceVersion as string,evidenceId:r.evidenceId as string,evidenceHash:r.evidenceHash as string,issuerId:r.issuerId as string,keyId:r.keyId as string,trustRootId:r.trustRootId as string,policyId:trust.policyId,policyRevision:trust.revision,policyHash:trust.hash,validatedAt:r.validatedAt as number,validUntil:r.validUntil as number,subjectHash:createHash("sha256").update(canonicalJson(subject)).digest("hex")};
}






