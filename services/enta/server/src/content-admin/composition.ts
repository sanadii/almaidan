import { authenticateAdmin, type AdminClaimsDependencies } from "./claims";
import type { GeneralQueryIo, QueryIo } from "./repository";
import { createPostgresAdminRepository } from "./postgres";
import { createContentAdminRouter, type RegistryService } from "./router";
import { changeRegistry, prepareProfile, preparePointer, appendPreparedProfile, movePreparedPointer, putGameplaySupplement, prepareGameplaySupplement, admitSnapshot, appendRelease, type SyncAuthIo, type SyncSettlementVerifier, type LookupAuthIo } from "./service";
import type { PublisherAuthority } from "./authorization";
import { appendStoredMedia, admitMediaRaw, type MaterialAuthority } from "./media";
const unavailable:QueryIo={transactionMode:"autocommit",query:async()=>{throw new Error("PRIVILEGED_CAPABILITY_UNAVAILABLE");}};
/** General router has no publisher/sync connection or SDK effect capability. */
export function composeContentAdmin(auth:AdminClaimsDependencies,channels:GeneralQueryIo,registryService?:RegistryService,lookup?:LookupAuthIo,material?:MaterialAuthority) {
 const repository=createPostgresAdminRepository({reader:channels.reader,editor:channels.editor,reviewer:channels.reviewer,registry:channels.registry});
 return {router:createContentAdminRouter(auth,repository,registryService,lookup,material)};
}
/** Separately provisioned private registry worker; construction performs no I/O. */
export function composeRegistryService(auth:AdminClaimsDependencies,channels:Pick<GeneralQueryIo,"reader"|"registry">,syncQuery:QueryIo,syncAuth:SyncAuthIo,settlement:SyncSettlementVerifier):RegistryService {
 const repository=createPostgresAdminRepository({reader:channels.reader,editor:unavailable,reviewer:unavailable,registry:channels.registry,sync:syncQuery});
 return {change:async(token,request)=>changeRegistry(repository,await authenticateAdmin(auth,token),{resolveIdentity:auth.resolveIdentity,sync:{auth:syncAuth,settlement,completion:{complete:(intent,proof)=>repository.syncComplete(intent.namespace,intent.operationId,intent.identityId,intent.authzVersion,intent.desiredAuthorizationHash,proof.outcome,proof.evidenceHash)}}},request)};
}
/** Material append uses its own restricted executor and cannot be reached through the general router. */
export function composeMaterialService(auth:AdminClaimsDependencies,materialQuery:QueryIo,authority:MaterialAuthority) {
 const repository=createPostgresAdminRepository({reader:unavailable,editor:unavailable,reviewer:unavailable,registry:unavailable,material:materialQuery,privateRead:"material"});
 return {append:async(token:string,input:Parameters<typeof appendStoredMedia>[3])=>appendStoredMedia(repository,await authenticateAdmin(auth,token),authority,input)};
}




/** The publisher role and authority remain private to these token-authenticated operations. */
export function composePublisherService(auth:AdminClaimsDependencies,publisherQuery:QueryIo,authority:PublisherAuthority) {
 const repository=createPostgresAdminRepository({reader:unavailable,editor:unavailable,reviewer:unavailable,registry:unavailable,publisher:publisherQuery,privateRead:"publisher"});
 return {
  prepareProfile:async(token:string,scope:string,source:string,snapshotId:string,receiptId:string)=>prepareProfile(repository,await authenticateAdmin(auth,token),scope,source,snapshotId,receiptId),
  preparePointer:async(token:string,scope:string,source:string,revision:string)=>preparePointer(repository,await authenticateAdmin(auth,token),scope,source,revision),
  putSupplement:async(token:string,input:Parameters<typeof putGameplaySupplement>[2])=>putGameplaySupplement(repository,await authenticateAdmin(auth,token),input),
  prepareSupplement:async(token:string,scope:string,source:string,snapshotId:string,supplementId:string)=>prepareGameplaySupplement(repository,await authenticateAdmin(auth,token),scope,source,snapshotId,supplementId),
  append:async(token:string,input:Parameters<typeof appendPreparedProfile>[3])=>appendPreparedProfile(repository,await authenticateAdmin(auth,token),authority,input),
  move:async(token:string,input:Parameters<typeof movePreparedPointer>[3])=>movePreparedPointer(repository,await authenticateAdmin(auth,token),authority,input),
 };
}


/** Internal immutable-content producer; it has no publisher/material executor. */
export function composeContentProducerService(auth:AdminClaimsDependencies,channels:Pick<GeneralQueryIo,"reader"|"editor">) {
 const repository=createPostgresAdminRepository({reader:channels.reader,editor:channels.editor,reviewer:unavailable,registry:unavailable});
 return {
  admitSnapshot:async(token:string,...args:Parameters<typeof admitSnapshot> extends [unknown,unknown,...infer Rest]?Rest:never)=>admitSnapshot(repository,await authenticateAdmin(auth,token),...args),
  appendRelease:async(token:string,...args:Parameters<typeof appendRelease> extends [unknown,unknown,...infer Rest]?Rest:never)=>appendRelease(repository,await authenticateAdmin(auth,token),...args),
  admitMediaRaw:async(token:string,input:Parameters<typeof admitMediaRaw>[2])=>admitMediaRaw(repository,await authenticateAdmin(auth,token),input),
 };
}

