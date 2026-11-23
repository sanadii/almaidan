import { createHash } from "node:crypto";
import type { Response } from "express";

/** Returned only by the restricted current-authority query, never by the request. */
export interface PreviewBinding { epoch: string; objectId: string; generation: string; hash: string; byteLength: number; mediaType: "image/png" | "image/jpeg" | "video/mp4"; provenanceHash: string }
export interface PreviewBytes { binding: PreviewBinding; bytes: Uint8Array; provenance: Uint8Array }
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function equal(a: PreviewBinding, b: PreviewBinding): boolean { return a.epoch===b.epoch && a.objectId===b.objectId && a.generation===b.generation && a.hash===b.hash && a.byteLength===b.byteLength && a.mediaType===b.mediaType && a.provenanceHash===b.provenanceHash; }
function validate(v: PreviewBytes): void {
  const p=v.binding, b=v.bytes;
  if (!p || !/^[A-Za-z0-9:_-]{1,128}$/.test(p.objectId) || !/^[1-9][0-9]{0,18}$/.test(p.generation) || BigInt(p.generation)>9223372036854775807n || !/^[a-f0-9]{64}$/.test(p.hash) || !/^[a-f0-9]{64}$/.test(p.provenanceHash) || !p.epoch || !(b instanceof Uint8Array) || !(v.provenance instanceof Uint8Array) || v.provenance.length>65536 || !Number.isSafeInteger(p.byteLength) || p.byteLength<1 || p.byteLength>1_000_000 || b.length!==p.byteLength || digest(b)!==p.hash || digest(v.provenance)!==p.provenanceHash) throw new Error("MEDIA_UNAVAILABLE");
  const png=b.length>=8 && Buffer.from(b.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg=b.length>=3 && b[0]===255 && b[1]===216 && b[2]===255;
  const mp4=b.length>=12 && Buffer.from(b.subarray(4,8)).toString("ascii")==="ftyp";
  if (!((p.mediaType==="image/png" && png) || (p.mediaType==="image/jpeg" && jpeg) || (p.mediaType==="video/mp4" && mp4))) throw new Error("MEDIA_UNAVAILABLE");
}
/** Byte source is the fixed, scoped PG raw-artifact query. No URL or bucket input. */
export async function deliverStoredPreview(response: Response, authorize: () => Promise<PreviewBinding>, read: (pin: PreviewBinding) => Promise<PreviewBytes>): Promise<void> {
  let closed=false; const markClosed=()=>{closed=true;}; response.on("close",markClosed); response.on("error",markClosed);
  const unavailable=()=>closed || response.destroyed || response.writableEnded;
  try {
    const initial=await authorize(); if(unavailable()) throw new Error("CLIENT_CLOSED");
    const loaded=await read(initial); validate(loaded);
    if (unavailable()) throw new Error("CLIENT_CLOSED");
    if (!equal(initial,loaded.binding) || !equal(initial,await authorize())) throw new Error("MEDIA_DENIED");
    if(unavailable()) throw new Error("CLIENT_CLOSED");
    response.status(200); response.setHeader("content-type",initial.mediaType); response.setHeader("content-length",initial.byteLength); response.setHeader("cache-control","no-store"); response.setHeader("referrer-policy","no-referrer"); response.setHeader("x-content-type-options","nosniff");
    for (let offset=0; offset<loaded.bytes.length; offset+=65536) {
      const current=await authorize();
      if (!equal(initial,current) || unavailable()) throw new Error("MEDIA_DENIED");
      if (!response.write(loaded.bytes.subarray(offset,Math.min(offset+65536,loaded.bytes.length)))) await waitForDrain(response,10000,unavailable);
    }
    if (unavailable()) throw new Error("CLIENT_CLOSED");
    response.end();
  } catch (error) { if(!response.destroyed) response.destroy(); throw error; }
  finally {response.off("close",markClosed); response.off("error",markClosed);}
}
function waitForDrain(response:Response, timeoutMs:number, unavailable:()=>boolean):Promise<void> {
 return new Promise<void>((resolve,reject)=>{
  let timer:ReturnType<typeof setTimeout>;
  const cleanup=()=>{clearTimeout(timer);response.off("drain",drain);response.off("close",close);response.off("error",error);};
  const drain=()=>{cleanup();resolve();}; const close=()=>{cleanup();reject(new Error("CLIENT_CLOSED"));}; const error=()=>{cleanup();reject(new Error("CLIENT_WRITE_FAILED"));};
  response.once("drain",drain); response.once("close",close); response.once("error",error);
  timer=setTimeout(()=>{cleanup();reject(new Error("CLIENT_WRITE_TIMEOUT"));},timeoutMs);
  if(unavailable()) close();
 });
}


import type { VerifiedAdminClaims } from "./claims";
import type { ContentAdminRepository } from "./repository";
import { sqlContext, chargeRate } from "./repository";
import { readPublishedSnapshot, getPublishedQuestion } from "./service";
import { requireAdmin } from "./authorization";
import { canonicalJson } from "../../../../../scripts/firestore-release-canonical.js";
export interface MaterialSubject { namespace:string;projectId:string;identityId:string;identityPolicyRevision:string;identityPolicyHash:string;profileScope:string;pointerVersion:string;profileSourceId:string;profileRevision:string;profileHash:string;snapshotHash:string;releaseId:string;releaseRoot:string;receiptId:string;catalogId:string;catalogRoot:string;sealHash:string;questionId:string;digestKind:"release-question-document-raw-sha256-v1";questionDocumentDigest:string;categoryId:string;variant:"question"|"answer";mediaId:string;generation:string;assetHash:string;byteLength:number;mediaType:string;provenanceHash:string }
export interface MaterialPolicy { namespace:string;projectId:string;policyId:string;revision:string;hash:string;validFrom:number;validUntil:number;maxAgeMs:number;versions:readonly string[];revokedEvidenceIds:readonly string[];issuers:readonly {issuerId:string;keyId:string;trustRootId:string}[] }
export interface MaterialAuthority {readCurrentPolicy(namespace:string,projectId:string):Promise<MaterialPolicy|null>;verify(subject:MaterialSubject):Promise<unknown>}
/** Policy is independently supplied and refreshed; the response never supplies its own trust anchor. */
export async function requireMaterialEvidence(subject:MaterialSubject, authority:MaterialAuthority|undefined):Promise<import("./contracts").EvidenceSummary> {
 if(!authority) throw new Error("MATERIAL_AUTHORITY_UNAVAILABLE"); let policy:MaterialPolicy|null; try{policy=await authority.readCurrentPolicy(subject.namespace,subject.projectId);}catch{throw new Error("MATERIAL_AUTHORITY_UNAVAILABLE");}
 const now=Date.now(); if(!policy || policy.namespace!==subject.namespace || policy.projectId!==subject.projectId || !policy.policyId || !/^[1-9][0-9]*$/.test(policy.revision) || !/^[a-f0-9]{64}$/.test(policy.hash) || !Number.isSafeInteger(policy.validFrom) || !Number.isSafeInteger(policy.validUntil) || !Number.isSafeInteger(policy.maxAgeMs) || policy.maxAgeMs<1 || policy.validUntil<=policy.validFrom || now<policy.validFrom || now>=policy.validUntil || !Array.isArray(policy.versions) || !policy.versions.length || !Array.isArray(policy.revokedEvidenceIds) || !Array.isArray(policy.issuers) || !policy.issuers.length || !/^[A-Za-z0-9._:-]{1,200}$/.test(policy.policyId) || policy.versions.some(v=>typeof v!=="string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(v)) || new Set(policy.versions).size!==policy.versions.length || policy.revokedEvidenceIds.some(v=>typeof v!=="string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(v)) || new Set(policy.revokedEvidenceIds).size!==policy.revokedEvidenceIds.length || policy.issuers.some(v=>!v || !/^[A-Za-z0-9._:-]{1,200}$/.test(v.issuerId) || !/^[A-Za-z0-9._:-]{1,200}$/.test(v.keyId) || !/^[A-Za-z0-9._:-]{1,200}$/.test(v.trustRootId))) throw new Error("MATERIAL_AUTHORITY_UNAVAILABLE");
 let result:unknown; try{result=await authority.verify(subject);}catch{throw new Error("MATERIAL_AUTHORITY_UNAVAILABLE");}
 if(!result || typeof result!=="object" || Array.isArray(result)) throw new Error("MATERIAL_AUTHORITY_UNAVAILABLE"); const r=result as Record<string,unknown>;
 if(Object.keys(r).sort().join("|")!=="evidenceHash|evidenceId|evidenceVersion|issuerId|keyId|policyHash|policyId|policyRevision|status|subject|trustRootId|validUntil|validatedAt" || r.status!=="verified" || typeof r.evidenceVersion!=="string" || !policy.versions.includes(r.evidenceVersion) || typeof r.evidenceId!=="string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(r.evidenceId) || policy.revokedEvidenceIds.includes(r.evidenceId) || typeof r.evidenceHash!=="string" || !/^[a-f0-9]{64}$/.test(r.evidenceHash) || r.policyId!==policy.policyId || r.policyRevision!==policy.revision || r.policyHash!==policy.hash || !policy.issuers.some(x=>x.issuerId===r.issuerId && x.keyId===r.keyId && x.trustRootId===r.trustRootId) || !Number.isSafeInteger(r.validatedAt) || !Number.isSafeInteger(r.validUntil) || (r.validatedAt as number)<policy.validFrom || (r.validatedAt as number)>now || (r.validUntil as number)<=now || (r.validUntil as number)>policy.validUntil || now-(r.validatedAt as number)>policy.maxAgeMs || (r.validUntil as number)<=(r.validatedAt as number)) throw new Error("MATERIAL_AUTHORITY_UNAVAILABLE");
 try{if(canonicalJson(r.subject)!==canonicalJson(subject)) throw new Error("subject mismatch");const latest=await authority.readCurrentPolicy(subject.namespace,subject.projectId);const finalNow=Date.now();if(!latest || canonicalJson(latest)!==canonicalJson(policy) || finalNow>=policy.validUntil || finalNow>=(r.validUntil as number) || finalNow-(r.validatedAt as number)>policy.maxAgeMs) throw new Error("policy changed");}catch{throw new Error("MATERIAL_AUTHORITY_UNAVAILABLE");}
 return {evidenceVersion:r.evidenceVersion as string,evidenceId:r.evidenceId as string,evidenceHash:r.evidenceHash as string,issuerId:r.issuerId as string,keyId:r.keyId as string,trustRootId:r.trustRootId as string,policyId:policy.policyId,policyRevision:policy.revision,policyHash:policy.hash,validatedAt:r.validatedAt as number,validUntil:r.validUntil as number,subjectHash:createHash("sha256").update(canonicalJson(subject)).digest("hex")};
}
export interface PreviewSubject {mode:"published-preview"; profileScope:string; releaseId:string; questionId:string; variant:"question"|"answer"}
function decodePreview(value:unknown):PreviewBytes & {baseline:Record<string,unknown>} {
 if(!value || typeof value!=="object" || Array.isArray(value)) throw new Error("MEDIA_UNAVAILABLE");
 const v=value as Record<string,unknown>; if(!v.binding || typeof v.binding!=="object" || Array.isArray(v.binding)) throw new Error("MEDIA_UNAVAILABLE");
 const decode=(x:unknown,maxEncoded:number)=>{if(typeof x!=="string" || x.length>maxEncoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(x)) throw new Error("MEDIA_UNAVAILABLE"); const out=Buffer.from(x,"base64");if(out.toString("base64")!==x) throw new Error("MEDIA_UNAVAILABLE");return out;};
 if(!v.baseline || typeof v.baseline!=="object" || Array.isArray(v.baseline)) throw new Error("MEDIA_UNAVAILABLE"); const result={binding:v.binding as PreviewBinding,baseline:v.baseline as Record<string,unknown>,bytes:decode(v.base64,1_333_336),provenance:decode(v.provenanceBase64,87_384)}; validate(result); return result;
}
/** Every authorization reloads the exact subject and current policy under the database boundary. */
export async function deliverPublishedPreview(response:Response, repo:ContentAdminRepository, claims:VerifiedAdminClaims, subject:PreviewSubject, authority:MaterialAuthority|undefined):Promise<void> {
 if(subject.mode!=="published-preview" || !/^[A-Za-z0-9_-]{1,120}$/.test(subject.profileScope) || !/^[A-Za-z0-9_-]{1,120}$/.test(subject.releaseId) || !/^[A-Za-z0-9_-]{1,120}$/.test(subject.questionId) || (subject.variant!=="question" && subject.variant!=="answer") || Object.keys(subject).sort().join("|")!=="mode|profileScope|questionId|releaseId|variant") throw new Error("MEDIA_DENIED");
 const ctx=sqlContext(claims); const {snapshot,registry}=await readPublishedSnapshot(repo,claims,subject.profileScope,subject.releaseId);
 const question=snapshot.questions.get(subject.questionId);
 if(!question || typeof question.categoryId!=="string" || !snapshot.categories.has(question.categoryId)) throw new Error("MEDIA_DENIED");
 requireAdmin(claims,registry,"questions.read",[question.categoryId]); getPublishedQuestion(claims,registry,snapshot,subject.questionId);
 const value=question[subject.variant==="question"?"media":"answerMedia"];
 if(!value || typeof value!=="object" || Array.isArray(value)) throw new Error("MEDIA_DENIED");
 const m=value as Record<string,unknown>;
 if(typeof m.mediaId!=="string" || typeof m.assetSha256!=="string") throw new Error("MEDIA_DENIED");
  const documentDigest=createHash("sha256").update(canonicalJson({data:question,path:`releases/${subject.releaseId}/questions/${subject.questionId}`})).digest("hex");
 const load=async()=>{const loaded=decodePreview(await repo.mediaAuthorize(ctx,subject)); if(loaded.binding.objectId!==m.mediaId || loaded.binding.hash!==m.assetSha256) throw new Error("MEDIA_DENIED"); const pin=snapshot.binding,b=loaded.binding;
  const expectedBaseline={namespace:claims.namespace,projectId:claims.projectId,profileScope:subject.profileScope,pointerVersion:pin.pointerVersion,profileSourceId:pin.profileSourceId,profileRevision:pin.profileRevision,profileHash:pin.profile.hash,snapshotHash:pin.snapshot.hash,releaseId:subject.releaseId,releaseRoot:pin.releaseRoot,receiptId:pin.receiptId,catalogId:pin.catalogId,catalogRoot:pin.catalogRoot,sealHash:pin.sealHash,questionId:subject.questionId,questionDocumentDigest:documentDigest,categoryId:question.categoryId,variant:subject.variant}; if(canonicalJson(loaded.baseline)!==canonicalJson(expectedBaseline)) throw new Error("MEDIA_DENIED");
  const material:MaterialSubject={namespace:claims.namespace,projectId:claims.projectId,identityId:claims.identityId,identityPolicyRevision:claims.policyRevision,identityPolicyHash:claims.policyHash,profileScope:subject.profileScope,pointerVersion:pin.pointerVersion,profileSourceId:pin.profileSourceId,profileRevision:pin.profileRevision,profileHash:pin.profile.hash,snapshotHash:pin.snapshot.hash,releaseId:subject.releaseId,releaseRoot:pin.releaseRoot,receiptId:pin.receiptId,catalogId:pin.catalogId,catalogRoot:pin.catalogRoot,sealHash:pin.sealHash,questionId:subject.questionId,digestKind:"release-question-document-raw-sha256-v1",questionDocumentDigest:documentDigest,categoryId:question.categoryId as string,variant:subject.variant,mediaId:b.objectId,generation:b.generation,assetHash:b.hash,byteLength:b.byteLength,mediaType:b.mediaType,provenanceHash:b.provenanceHash};
   let provenance:unknown, provenanceText:string;try{provenanceText=new TextDecoder("utf-8",{fatal:true}).decode(loaded.provenance);provenance=JSON.parse(provenanceText);}catch{throw new Error("MEDIA_DENIED");}
  const expectedProvenance={schemaVersion:"huroof-admin-media-binding-v1",namespace:claims.namespace,profileScope:subject.profileScope,releaseId:subject.releaseId,questionId:subject.questionId,variant:subject.variant,mediaId:b.objectId,generation:b.generation,contentHash:b.hash};
  try{if(canonicalJson(provenance)!==provenanceText || canonicalJson(provenance)!==canonicalJson(expectedProvenance)) throw new Error("provenance mismatch");}catch{throw new Error("MEDIA_DENIED");}
 const summary=await requireMaterialEvidence(material,authority);const materialEpoch=createHash("sha256").update(canonicalJson(summary)).digest("hex");return {...loaded,binding:{...b,epoch:`${b.epoch}:${materialEpoch}`}};};
 await deliverStoredPreview(response,async()=>(await load()).binding,async()=>load());
}












/** Private producer capability; no browser route or generic raw writer is exposed. */
export async function appendStoredMedia(repo:ContentAdminRepository,claims:VerifiedAdminClaims,authority:MaterialAuthority|undefined,input:{profileScope:string;releaseId:string;questionId:string;variant:"question"|"answer";generation:string;raw:import("./contracts").StoredArtifact;operationId:string}):Promise<unknown> {
 const {profileScope,releaseId,questionId,variant,generation,raw,operationId}=input;
 if(!/^[A-Za-z0-9_-]{1,120}$/.test(profileScope) || !/^[A-Za-z0-9_-]{1,120}$/.test(releaseId) || !/^[A-Za-z0-9_-]{1,120}$/.test(questionId) || !/^[A-Za-z0-9_-]{1,120}$/.test(operationId) || !/^[1-9][0-9]{0,18}$/.test(generation) || BigInt(generation)>9223372036854775807n || (variant!=="question" && variant!=="answer") || !raw || !/^[A-Za-z0-9_-]{1,120}$/.test(raw.id) || raw.serialization!=="huroof-admin-media-v1") throw new Error("INVALID_REQUEST");
 const {snapshot,registry}=await readPublishedSnapshot(repo,claims,profileScope,releaseId);const q=snapshot.questions.get(questionId);if(!q || typeof q.categoryId!=="string") throw new Error("MEDIA_DENIED");getPublishedQuestion(claims,registry,snapshot,questionId);requireAdmin(claims,registry,"questions.write",[q.categoryId]);
 const variantValue=q[variant==="question"?"media":"answerMedia"];if(!variantValue || typeof variantValue!=="object" || Array.isArray(variantValue)) throw new Error("MEDIA_DENIED");const v=variantValue as Record<string,unknown>;
 if(typeof v.mediaId!=="string" || typeof v.assetSha256!=="string" || v.assetSha256!==raw.hash || (v.contentType!==undefined && v.contentType!==raw.mediaType) || (v.type!==undefined && v.type!==(raw.mediaType==="video/mp4"?"video":"image"))) throw new Error("MEDIA_DENIED");
 const binding={epoch:"admission",objectId:v.mediaId,generation,hash:raw.hash,byteLength:raw.byteLength,mediaType:raw.mediaType as PreviewBinding["mediaType"],provenanceHash:raw.provenanceHash};validate({binding,bytes:raw.raw,provenance:raw.provenance});
 let provenance:unknown,provenanceText:string;try{provenanceText=new TextDecoder("utf-8",{fatal:true}).decode(raw.provenance);provenance=JSON.parse(provenanceText);}catch{throw new Error("MEDIA_DENIED");}
 const expectedProvenance={schemaVersion:"huroof-admin-media-binding-v1",namespace:claims.namespace,profileScope,releaseId,questionId,variant,mediaId:v.mediaId,generation,contentHash:raw.hash};if(canonicalJson(provenance)!==provenanceText || canonicalJson(provenance)!==canonicalJson(expectedProvenance)) throw new Error("MEDIA_DENIED");
 const pin=snapshot.binding,documentDigest=createHash("sha256").update(canonicalJson({data:q,path:`releases/${releaseId}/questions/${questionId}`})).digest("hex");
 const subject:MaterialSubject={namespace:claims.namespace,projectId:claims.projectId,identityId:claims.identityId,identityPolicyRevision:claims.policyRevision,identityPolicyHash:claims.policyHash,profileScope,pointerVersion:pin.pointerVersion,profileSourceId:pin.profileSourceId,profileRevision:pin.profileRevision,profileHash:pin.profile.hash,snapshotHash:pin.snapshot.hash,releaseId,releaseRoot:pin.releaseRoot,receiptId:pin.receiptId,catalogId:pin.catalogId,catalogRoot:pin.catalogRoot,sealHash:pin.sealHash,questionId,digestKind:"release-question-document-raw-sha256-v1",questionDocumentDigest:documentDigest,categoryId:q.categoryId,variant,mediaId:v.mediaId,generation,assetHash:raw.hash,byteLength:raw.byteLength,mediaType:raw.mediaType,provenanceHash:raw.provenanceHash};
 const ctx=sqlContext(claims), lookup=await repo.operationGet(ctx,operationId);if(!lookup || typeof lookup!=="object" || Array.isArray(lookup) || typeof (lookup as Record<string,unknown>).found!=="boolean") throw new Error("MEDIA_UNAVAILABLE");
 const record=lookup as Record<string,unknown>;let summary:import("./contracts").EvidenceSummary;
 if(record.found){const receipt=record.receipt;if(!receipt || typeof receipt!=="object" || Array.isArray(receipt)) throw new Error("MEDIA_UNAVAILABLE");const r=receipt as Record<string,unknown>;if(r.operationId!==operationId || r.rawArtifactId!==raw.id || canonicalJson(r.subject)!==canonicalJson(subject) || !r.authority || typeof r.authority!=="object" || Array.isArray(r.authority)) throw new Error("MEDIA_DENIED");summary=r.authority as import("./contracts").EvidenceSummary;}
 else summary=await requireMaterialEvidence(subject,authority);
 const target=`media/${v.mediaId}/${generation}`,action="media.append",expectedRevision=null,payload={rawArtifactId:raw.id,subject,authority:summary},mutation={operationId,expectedRevision,requestHash:createHash("sha256").update(canonicalJson({action,target,expectedRevision,payload})).digest("hex")};
 const result=await repo.mediaAppend(ctx,mutation,v.mediaId,generation,raw.id,{subject,authority:summary});
 if(!result || typeof result!=="object" || Array.isArray(result) || (result as Record<string,unknown>).operationId!==operationId || canonicalJson((result as Record<string,unknown>).subject)!==canonicalJson(subject) || canonicalJson((result as Record<string,unknown>).authority)!==canonicalJson(summary)) throw new Error("MEDIA_UNAVAILABLE");
 return {operationId,status:(result as Record<string,unknown>).status,revision:(result as Record<string,unknown>).revision};
}
/** Store exact release-bound media bytes without creating rights or a media revision. */
export async function admitMediaRaw(repo:ContentAdminRepository,claims:VerifiedAdminClaims,input:{profileScope:string;releaseId:string;questionId:string;variant:"question"|"answer";generation:string;raw:import("./contracts").StoredArtifact;operationId:string}):Promise<unknown> {
 const {profileScope,releaseId,questionId,variant,generation,raw,operationId}=input;
 if(!/^[A-Za-z0-9_-]{1,120}$/.test(profileScope) || !/^[A-Za-z0-9_-]{1,120}$/.test(releaseId) || !/^[A-Za-z0-9_-]{1,120}$/.test(questionId) || !/^[A-Za-z0-9_-]{1,120}$/.test(operationId) || !/^[1-9][0-9]{0,18}$/.test(generation) || BigInt(generation)>9223372036854775807n || (variant!=="question" && variant!=="answer") || !raw || !/^[A-Za-z0-9_-]{1,120}$/.test(raw.id) || raw.serialization!=="huroof-admin-media-v1") throw new Error("INVALID_REQUEST");
 const {snapshot,registry}=await readPublishedSnapshot(repo,claims,profileScope,releaseId),q=snapshot.questions.get(questionId);if(!q || typeof q.categoryId!=="string") throw new Error("MEDIA_DENIED");getPublishedQuestion(claims,registry,snapshot,questionId);requireAdmin(claims,registry,"questions.write",[q.categoryId]);
 const v=q[variant==="question"?"media":"answerMedia"];if(!v || typeof v!=="object" || Array.isArray(v)) throw new Error("MEDIA_DENIED");const media=v as Record<string,unknown>;
 if(typeof media.mediaId!=="string" || typeof media.assetSha256!=="string" || media.assetSha256!==raw.hash || (media.contentType!==undefined && media.contentType!==raw.mediaType) || (media.type!==undefined && media.type!==(raw.mediaType==="video/mp4"?"video":"image"))) throw new Error("MEDIA_DENIED");
 const binding={epoch:"admission",objectId:media.mediaId,generation,hash:raw.hash,byteLength:raw.byteLength,mediaType:raw.mediaType as PreviewBinding["mediaType"],provenanceHash:raw.provenanceHash};validate({binding,bytes:raw.raw,provenance:raw.provenance});
 let proof:unknown,text:string;try{text=new TextDecoder("utf-8",{fatal:true}).decode(raw.provenance);proof=JSON.parse(text);}catch{throw new Error("MEDIA_DENIED");}const expected={schemaVersion:"huroof-admin-media-binding-v1",namespace:claims.namespace,profileScope,releaseId,questionId,variant,mediaId:media.mediaId,generation,contentHash:raw.hash};if(canonicalJson(proof)!==text || canonicalJson(proof)!==canonicalJson(expected)) throw new Error("MEDIA_DENIED");
 const action="raw.put",target=raw.id,expectedRevision=null,payload={hash:raw.hash,length:raw.byteLength,mediaType:raw.mediaType,serialization:raw.serialization,provenanceHash:raw.provenanceHash},mutation={operationId,expectedRevision,requestHash:createHash("sha256").update(canonicalJson({action,target,expectedRevision,payload})).digest("hex")};
 const result=await repo.rawPut(sqlContext(claims),mutation,raw.id,raw.raw,raw.mediaType,raw.serialization,raw.provenance);if(!result || typeof result!=="object" || Array.isArray(result) || (result as Record<string,unknown>).operationId!==operationId) throw new Error("MEDIA_UNAVAILABLE");return result;
}



