import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { deliverStoredPreview, type PreviewBinding } from "../src/content-admin/media";
const hash=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
test("stored preview validates bytes and stops when authorization changes before write",async()=>{
 const raw=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]); const provenance=Buffer.from("origin");
 const binding:PreviewBinding={epoch:"1",objectId:"image",generation:"1",hash:hash(raw),byteLength:raw.length,mediaType:"image/png",provenanceHash:hash(provenance)};
 let writes=0, destroyed=false, calls=0; const response=Object.assign(new EventEmitter(),{status(){return this;},setHeader(){return this;},write(){writes++;return true;},end(){},destroy(){destroyed=true;}});
 await assert.rejects(()=>deliverStoredPreview(response as never,async()=>{calls++;return calls>=3?{...binding,epoch:"2"}:binding;},async()=>({binding,bytes:raw,provenance})),/MEDIA_DENIED/);
 assert.equal(writes,0); assert.equal(destroyed,true);
 await assert.rejects(()=>deliverStoredPreview(response as never,async()=>binding,async()=>({binding,bytes:Buffer.from("corrupt"),provenance})),/MEDIA_UNAVAILABLE/);
});
test("stored preview returns the validated bytes when current authorization remains stable",async()=>{
 const raw=Buffer.from([137,80,78,71,13,10,26,10,5,6]); const provenance=Buffer.from("origin");
 const binding:PreviewBinding={epoch:"1",objectId:"image",generation:"10",hash:hash(raw),byteLength:raw.length,mediaType:"image/png",provenanceHash:hash(provenance)};
 let sent=Buffer.alloc(0); const headers:Record<string,string|number>={}; let ended=false;
 const response=Object.assign(new EventEmitter(),{status(){return this;},setHeader(k:string,v:string|number){headers[k]=v;return this;},write(b:Uint8Array){sent=Buffer.concat([sent,Buffer.from(b)]);return true;},end(){ended=true;},destroy(){throw new Error("unexpected destroy");}});
 await deliverStoredPreview(response as never,async()=>binding,async()=>({binding,bytes:raw,provenance}));
 assert.deepEqual(sent,raw); assert.equal(headers["cache-control"],"no-store"); assert.equal(ended,true);
});


test("closed or errored responses never receive stale bytes",async()=>{
 const raw=Buffer.from([137,80,78,71,13,10,26,10]); const provenance=Buffer.from("origin");
 const binding:PreviewBinding={epoch:"1",objectId:"image",generation:"1",hash:hash(raw),byteLength:raw.length,mediaType:"image/png",provenanceHash:hash(provenance)};
 let writes=0; const response=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,status(){return this;},setHeader(){return this;},write(){writes++;return true;},end(){},destroy(){this.destroyed=true;}});
 await assert.rejects(()=>deliverStoredPreview(response as never,async()=>{response.emit("error",new Error("socket"));return binding;},async()=>({binding,bytes:raw,provenance})),/CLIENT_CLOSED/);
 assert.equal(writes,0); assert.equal(response.destroyed,true);
});
test("closed backpressure waiter fails without a later write",async()=>{
 const raw=Buffer.alloc(70000,1); Buffer.from([137,80,78,71,13,10,26,10]).copy(raw); const provenance=Buffer.from("origin");
 const binding:PreviewBinding={epoch:"1",objectId:"image",generation:"1",hash:hash(raw),byteLength:raw.length,mediaType:"image/png",provenanceHash:hash(provenance)};
 let writes=0; const response=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,status(){return this;},setHeader(){return this;},write(){writes++;queueMicrotask(()=>response.emit("close"));return false;},end(){},destroy(){this.destroyed=true;}});
 await assert.rejects(()=>deliverStoredPreview(response as never,async()=>binding,async()=>({binding,bytes:raw,provenance})),/CLIENT_CLOSED/);
 assert.equal(writes,1); assert.equal(response.destroyed,true);
});

test("stalled drain is bounded and destroys response",async()=>{
 const raw=Buffer.from([137,80,78,71,13,10,26,10]); const provenance=Buffer.from("origin");
 const binding:PreviewBinding={epoch:"1",objectId:"image",generation:"1",hash:hash(raw),byteLength:raw.length,mediaType:"image/png",provenanceHash:hash(provenance)};
 let writes=0; const response=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,status(){return this;},setHeader(){return this;},write(){writes++;return false;},end(){},destroy(){this.destroyed=true;}});
 await assert.rejects(()=>deliverStoredPreview(response as never,async()=>binding,async()=>({binding,bytes:raw,provenance})),/CLIENT_WRITE_TIMEOUT/);
 assert.equal(writes,1); assert.equal(response.destroyed,true);
});
test("synchronous close during write cannot enter a stale drain wait",async()=>{
 const raw=Buffer.from([137,80,78,71,13,10,26,10]); const provenance=Buffer.from("origin");
 const binding:PreviewBinding={epoch:"1",objectId:"image",generation:"1",hash:hash(raw),byteLength:raw.length,mediaType:"image/png",provenanceHash:hash(provenance)};
 let writes=0; const response=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,status(){return this;},setHeader(){return this;},write(){writes++;response.emit("close");return false;},end(){},destroy(){this.destroyed=true;}});
 await assert.rejects(()=>deliverStoredPreview(response as never,async()=>binding,async()=>({binding,bytes:raw,provenance})),/CLIENT_CLOSED/); assert.equal(writes,1);
});
test("material validator binds exact stored subject and current independent policy",async()=>{
 const {requireMaterialEvidence}=await import("../src/content-admin/media");const now=Date.now();
 const subject={namespace:"ns",projectId:"project",identityId:"i",identityPolicyRevision:"1",identityPolicyHash:"5".repeat(64),profileScope:"s",pointerVersion:"0",profileSourceId:"p",profileRevision:"1",profileHash:"a".repeat(64),snapshotHash:"b".repeat(64),releaseId:"r",releaseRoot:"c".repeat(64),receiptId:"receipt",catalogId:"catalog",catalogRoot:"d".repeat(64),sealHash:"e".repeat(64),questionId:"q",digestKind:"release-question-document-raw-sha256-v1" as const,questionDocumentDigest:"f".repeat(64),categoryId:"cat",variant:"question" as const,mediaId:"m",generation:"1",assetHash:"1".repeat(64),byteLength:8,mediaType:"image/png",provenanceHash:"2".repeat(64)};
 const policy={namespace:"ns",projectId:"project",policyId:"material",revision:"1",hash:"3".repeat(64),validFrom:now-1000,validUntil:now+60000,maxAgeMs:30000,versions:["v1"],revokedEvidenceIds:[] as string[],issuers:[{issuerId:"issuer",keyId:"key",trustRootId:"root"}]};
 const evidence={status:"verified",evidenceVersion:"v1",evidenceId:"proof",evidenceHash:"4".repeat(64),policyId:"material",policyRevision:"1",policyHash:policy.hash,issuerId:"issuer",keyId:"key",trustRootId:"root",validatedAt:now,validUntil:now+30000,subject};
 const authority={readCurrentPolicy:async()=>policy,verify:async()=>evidence};assert.match((await requireMaterialEvidence(subject,authority)).subjectHash,/^[a-f0-9]{64}$/);
 await assert.rejects(()=>requireMaterialEvidence({...subject,profileScope:"other"},authority),/MATERIAL_AUTHORITY_UNAVAILABLE/);
 await assert.rejects(()=>requireMaterialEvidence(subject,{...authority,readCurrentPolicy:async()=>({...policy,revokedEvidenceIds:["proof"]})}),/MATERIAL_AUTHORITY_UNAVAILABLE/);
 await assert.rejects(()=>requireMaterialEvidence(subject,undefined),/MATERIAL_AUTHORITY_UNAVAILABLE/);
 let reads=0;await assert.rejects(()=>requireMaterialEvidence(subject,{...authority,readCurrentPolicy:async()=>++reads===1?policy:{...policy,revision:"2"}}),/MATERIAL_AUTHORITY_UNAVAILABLE/);
});

test("stored snapshot to material verifier to preview bytes uses actual adapters",async()=>{
 const {deliverPublishedPreview}=await import("../src/content-admin/media");const {composeMaterialService}=await import("../src/content-admin/composition");const {createPostgresAdminRepository}=await import("../src/content-admin/postgres");const {canonicalJson,documentsHash}=await import("../../../../scripts/firestore-release-canonical");
 const raw=Buffer.from([137,80,78,71,13,10,26,10,8,9]), assetHash=hash(raw);
 const question={id:"q",categoryId:"c",modality:"image",answerConceptId:"answer",headerAr:"Q",promptAr:"P",canonicalAnswer:"A",acceptedAnswers:["A"],targetLetter:"a",media:{mediaId:"m",assetSha256:assetHash,type:"image",contentType:"image/png"}};
 const docs=[{path:"releases/r/questions/q",data:question},{path:"releases/r/catalogCategories/c",data:{id:"c"}},{path:"releases/r/inventory/c",data:{categoryId:"c",approvedCount:1}}];const root=documentsHash(docs),questionDigest=hash(Buffer.from(canonicalJson(docs[0])));
 const prov=Buffer.from(canonicalJson({schemaVersion:"huroof-admin-media-binding-v1",namespace:"ns",profileScope:"scope",releaseId:"r",questionId:"q",variant:"question",mediaId:"m",generation:"1",contentHash:assetHash}));
 const make=(id:string,raw:Buffer,serialization:string)=>({id,raw,hash:hash(raw),length:raw.length,mediaType:"application/json",serialization,provenance:Buffer.from("origin"),provenanceHash:hash(Buffer.from("origin"))});
 const snap=make("s",Buffer.from(canonicalJson({schemaVersion:"huroof-release-snapshot-v1",releaseId:"r",documents:docs})),"huroof-release-snapshot-v1");
 const profile=make("p",Buffer.from(JSON.stringify({contentSnapshot:{namespace:"ns",id:snap.id,hash:snap.hash,byteLength:snap.length,mediaType:snap.mediaType,serialization:snap.serialization,provenanceHash:snap.provenanceHash}})),"profile-label");
 const enc=(prefix:string,a:typeof profile)=>({[prefix+"Id"]:a.id,[prefix+"Hash"]:a.hash,[prefix+"Length"]:String(a.length),[prefix+"MediaType"]:a.mediaType,[prefix+"Serialization"]:a.serialization,[prefix+"ProvenanceHash"]:a.provenanceHash,[prefix+"Base64"]:a.raw.toString("base64"),[prefix+"ProvenanceBase64"]:a.provenance.toString("base64")});
 const registry={namespace:"ns",projectId:"project",identityId:"i",enabled:true,disabled:false,identityReady:true,authzVersion:2,roles:["reviewer"],categoryScopes:["c"],reviewerScopes:[]};
 const base={registry,namespace:"ns",projectId:"project",profileScope:"scope",pointerVersion:"0",profileSourceId:"p",profileRevision:"1",releaseId:"r",releaseRoot:root,receiptId:"receipt",catalogId:"catalog",catalogRoot:"a".repeat(64),sealHash:"b".repeat(64),...enc("profile",profile),...enc("snapshot",snap)};
 const baseline={namespace:"ns",projectId:"project",profileScope:"scope",pointerVersion:"0",profileSourceId:"p",profileRevision:"1",profileHash:profile.hash,snapshotHash:snap.hash,releaseId:"r",releaseRoot:root,receiptId:"receipt",catalogId:"catalog",catalogRoot:"a".repeat(64),sealHash:"b".repeat(64),questionId:"q",questionDocumentDigest:questionDigest,categoryId:"c",variant:"question"};
 const binding={epoch:"current",objectId:"m",generation:"1",hash:assetHash,byteLength:raw.length,mediaType:"image/png",provenanceHash:hash(prov)};
  let committed:Record<string,unknown>|null=null;let appendQueries=0;
 const queryIo={transactionMode:"autocommit" as const,query:async(sql:string,params:readonly unknown[])=>{let result:unknown;if(sql.includes("rate_take"))result={count:1};else if(sql.includes("snapshot_read"))result=base;else if(sql.includes("media_authorize"))result={binding,baseline,base64:raw.toString("base64"),provenanceBase64:prov.toString("base64")};else if(sql.includes("operation_get"))result=committed?{found:true,receipt:committed}:{found:false};else if(sql.includes("media_append")){appendQueries++;const evidence=JSON.parse(String(params[5]));if(!committed) committed={operationId:"op",revision:1,status:"appended",rawArtifactId:"raw",...evidence};result=committed;}else throw new Error("unexpected");return {rows:[{result}] as never};}}; const selected:string[]=[];const channel=(name:string)=>({transactionMode:"autocommit" as const,query:async(sql:string,params:readonly unknown[])=>{selected.push(name);return queryIo.query(sql,params);}});const reader=channel("reader"),editor=channel("editor"),reviewer=channel("reviewer"),registryIo=channel("registry"),materialIo=channel("material");const repo=createPostgresAdminRepository({reader,editor,reviewer,registry:registryIo,material:materialIo});
 const now=Date.now();const policy={namespace:"ns",projectId:"project",policyId:"material",revision:"1",hash:"3".repeat(64),validFrom:now-1000,validUntil:now+60000,maxAgeMs:30000,versions:["v1"],revokedEvidenceIds:[],issuers:[{issuerId:"issuer",keyId:"key",trustRootId:"root"}]};let verificationCalls=0;const authority={readCurrentPolicy:async()=>policy,verify:async(subject:unknown)=>(verificationCalls++,{status:"verified",evidenceVersion:"v1",evidenceId:"proof",evidenceHash:"4".repeat(64),policyId:"material",policyRevision:"1",policyHash:policy.hash,issuerId:"issuer",keyId:"key",trustRootId:"root",validatedAt:now,validUntil:now+30000,subject})};
 let sent=Buffer.alloc(0);const response=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,status(){return this;},setHeader(){return this;},write(b:Uint8Array){sent=Buffer.concat([sent,Buffer.from(b)]);return true;},end(){},destroy(){this.destroyed=true;}});
 const claims={namespace:"ns",projectId:"project",uid:"u",identityId:"i",claimRoles:["reviewer"] as const,claimAuthzVersion:2,provider:"password" as const,policyRevision:"1",policyHash:"f".repeat(64)};
  await deliverPublishedPreview(response as never,repo,claims,{mode:"published-preview",profileScope:"scope",releaseId:"r",questionId:"q",variant:"question"},authority);assert.deepEqual(sent,raw);
 registry.roles=["content_admin"];const policyRaw=Buffer.from(JSON.stringify({schema:"huroof-identity-policy-v1",namespace:"ns",projectId:"project",issuer:"https://securetoken.google.com/project",audience:"project",clientProjectId:"project"}));const identityPolicy={namespace:"ns",revision:"1",hash:hash(policyRaw),raw:policyRaw,projectId:"project",issuer:"https://securetoken.google.com/project",audience:{projectId:"project"}};
 const auth={namespace:"ns",clientProjectId:"project",readActivePolicy:async()=>identityPolicy,resolveIdentity:async()=>"i",auth:{verifyIdToken:async()=>({uid:"u",sub:"u",aud:"project",iss:identityPolicy.issuer,adminRoles:["content_admin"],authzVersion:2,firebase:{sign_in_provider:"password"}}),getUser:async()=>({uid:"u",disabled:false,emailVerified:true,email:"x@example.test",providerData:[{providerId:"password"}]})} as never};
 const material=composeMaterialService(auth,materialIo,authority);const stored={id:"raw",hash:assetHash,byteLength:raw.length,mediaType:"image/png",serialization:"huroof-admin-media-v1",provenanceHash:hash(prov),raw,provenance:prov};
 const input={profileScope:"scope",releaseId:"r",questionId:"q",variant:"question" as const,generation:"1",raw:stored,operationId:"op"};
 selected.length=0;await material.append("token",input);assert.ok(selected.length>0 && selected.every(name=>name==="material"));const afterFresh=verificationCalls;await material.append("token",input);assert.equal(verificationCalls,afterFresh);assert.equal(appendQueries,2);
});







