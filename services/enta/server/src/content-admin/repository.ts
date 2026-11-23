import { AsyncLocalStorage } from "node:async_hooks";
import type { VerifiedAdminClaims } from "./claims";

/** Query only through fixed SQL entry points; never interpolate an identifier from a request. */
/** Trusted adapter contract: each call runs as its own transaction and resolves only after commit; never wrap in a caller transaction. Installed provider semantics require separate verification. */
export interface QueryIo { readonly transactionMode:"autocommit"; query<T>(sql: string, parameters: readonly unknown[]): Promise<{ rows: T[] }> }
export interface GeneralQueryIo {reader:QueryIo;editor:QueryIo;reviewer:QueryIo;registry:QueryIo}
export interface RoleQueryIo extends GeneralQueryIo {sync?:QueryIo;publisher?:QueryIo;material?:QueryIo;privateRead?:"material"|"publisher"}
export interface SqlContext { namespace: string; projectId: string; identityId: string; claimAuthzVersion: number; claimRoles: readonly string[]; provider: string; emailVerified: true; policyRevision: string; policyHash: string }
export function sqlContext(claims: VerifiedAdminClaims): SqlContext { return {namespace:claims.namespace,projectId:claims.projectId,identityId:claims.identityId,claimAuthzVersion:claims.claimAuthzVersion,claimRoles:claims.claimRoles,provider:claims.provider,emailVerified:true,policyRevision:claims.policyRevision,policyHash:claims.policyHash}; }
export interface Mutation {operationId: string; requestHash: string; expectedRevision: number | string | null}
export interface ContentAdminRepository {
  principal(c: SqlContext): Promise<unknown>;
  rate(c: SqlContext): Promise<unknown>;
  snapshot(c: SqlContext, scope: string, releaseId: string): Promise<unknown>;
  mediaAuthorize(c: SqlContext, subject: unknown): Promise<unknown>;
  profilePrepare(c:SqlContext,scope:string,sourceId:string,snapshotId:string,receiptId:string):Promise<unknown>;
  pointerPrepare(c:SqlContext,scope:string,sourceId:string,revision:string):Promise<unknown>;
  profileAppend(c:SqlContext,mutation:Mutation,descriptor:unknown):Promise<unknown>;
  pointerMove(c:SqlContext,mutation:Mutation,descriptor:unknown):Promise<unknown>;
  supplementPut(c:SqlContext,mutation:Mutation,id:string,raw:Uint8Array,provenance:Uint8Array):Promise<unknown>;
  supplementPrepare(c:SqlContext,scope:string,sourceId:string,snapshotId:string,supplementId:string):Promise<unknown>;
  mediaAppend(c:SqlContext,mutation:Mutation,objectId:string,generation:string,rawId:string,evidence:unknown):Promise<unknown>;
  revisionAppend(c:SqlContext,mutation:Mutation,descriptor:unknown):Promise<unknown>;
  rawPut(c:SqlContext,mutation:Mutation,id:string,raw:Uint8Array,mediaType:string,serialization:string,provenance:Uint8Array):Promise<unknown>;
  registryLookup(c:SqlContext,targetIdentityId:string):Promise<unknown|null>;
  registryChange(c: SqlContext, mutation: Mutation, target: string, mode: "role"|"status"|"revoke", patch: unknown): Promise<unknown>;
  syncComplete(namespace:string, operationId:string, target:string, version:number, desiredHash:string, outcome:string, evidenceHash:string):Promise<unknown>;
  inspectionGet(c:SqlContext,scope:string,release:string,question:string):Promise<unknown>;
  inspectionMark(c:SqlContext,mutation:Mutation,scope:string,release:string,question:string):Promise<unknown>;
  correctionGet(c:SqlContext,scope:string,category:string,release:string):Promise<unknown>;
  correctionSave(c:SqlContext,mutation:Mutation,scope:string,category:string,release:string,patch:unknown):Promise<unknown>;
  categoryGet(c:SqlContext,id:string):Promise<unknown>;
  categoryList(c:SqlContext,filter:unknown):Promise<unknown>;
  categoryUpdate(c:SqlContext,mutation:Mutation,id:string,patch:unknown):Promise<unknown>;
  auditList(c:SqlContext,filter:unknown):Promise<unknown>;
  operationGet(c:SqlContext,id:string):Promise<unknown>;
  roomGet(c:SqlContext,id:string):Promise<unknown>;
  roomList(c:SqlContext,filter:unknown):Promise<unknown>;
  reviewGet(c:SqlContext,id:string):Promise<unknown>;
  reviewList(c:SqlContext,filter:unknown):Promise<unknown>;
  draftGet(c:SqlContext,id:string):Promise<unknown>;
  draftList(c:SqlContext,filter:unknown):Promise<unknown>;
  draftSave(c:SqlContext,mutation:Mutation,id:string,draft:unknown):Promise<unknown>;
  draftArchive(c:SqlContext,mutation:Mutation,id:string):Promise<unknown>;
  reviewSubmit(c:SqlContext,mutation:Mutation,id:string):Promise<unknown>;
  reviewDecide(c:SqlContext,mutation:Mutation,id:string,decision:string,reason:string):Promise<unknown>;
  settingsGet(c: SqlContext): Promise<unknown>;
  settingsUpdate(c: SqlContext, mutation: Mutation, patch: unknown): Promise<unknown>;
}





















interface RateScope {charged?:string}
const rateScope=new AsyncLocalStorage<RateScope>();
function rateKey(claims:VerifiedAdminClaims):string {return JSON.stringify([claims.namespace,claims.projectId,claims.identityId,claims.claimAuthzVersion,claims.policyRevision,claims.policyHash]);}
/** A request consumes one committed database-time rate slot even when validation fails. */
export async function chargeRate(repo:ContentAdminRepository,claims:VerifiedAdminClaims):Promise<void> {const key=rateKey(claims),scope=rateScope.getStore();if(scope?.charged===key)return;await repo.rate(sqlContext(claims));if(scope)scope.charged=key;}
export async function withRequestRate<T>(repo:ContentAdminRepository,claims:VerifiedAdminClaims,action:()=>Promise<T>):Promise<T> {return rateScope.run({},async()=>{await chargeRate(repo,claims);return action();});}
