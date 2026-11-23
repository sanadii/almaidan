import type { ContentAdminRepository, QueryIo, RoleQueryIo, SqlContext } from "./repository";
async function single(io: QueryIo, query: string, values: readonly unknown[]): Promise<unknown> {
  if(io.transactionMode!=="autocommit") throw new Error("TRANSACTION_BOUNDARY_UNAVAILABLE");
  const result = await io.query<{result: unknown}>(query, values);
  if (result.rows.length!==1 || result.rows[0].result==null) throw new Error("ADMIN_UNAVAILABLE");
  return result.rows[0].result;
}
function required(io:QueryIo|undefined):QueryIo {if(!io) throw new Error("PRIVILEGED_CAPABILITY_UNAVAILABLE");return io;}
/** Fixed parameterized calls only. Constructing this adapter performs no I/O. */
export function createPostgresAdminRepository(io: RoleQueryIo): ContentAdminRepository {
  const privateReader=()=>io.privateRead ? required(io[io.privateRead]) : io.reader;
  return {
    profilePrepare: (c,scope,sourceId,snapshotId,receiptId) => single(required(io.publisher),"SELECT public.eng03_05_profile_prepare($1::jsonb,$2::text,$3::text,$4::text,$5::text) AS result",[JSON.stringify(c),scope,sourceId,snapshotId,receiptId]),
    pointerPrepare: (c,scope,sourceId,revision) => single(required(io.publisher),"SELECT public.eng03_05_pointer_prepare($1::jsonb,$2::text,$3::text,$4::bigint) AS result",[JSON.stringify(c),scope,sourceId,revision]),
    profileAppend: (c,mutation,descriptor) => single(required(io.publisher),"SELECT public.eng03_05_profile_append($1::jsonb,$2::jsonb,$3::jsonb) AS result",[JSON.stringify(c),JSON.stringify(mutation),JSON.stringify(descriptor)]),
    pointerMove: (c,mutation,descriptor) => single(required(io.publisher),"SELECT public.eng03_05_pointer_move($1::jsonb,$2::jsonb,$3::jsonb) AS result",[JSON.stringify(c),JSON.stringify(mutation),JSON.stringify(descriptor)]),
    supplementPut: (c,mutation,id,raw,provenance) => single(required(io.publisher),"SELECT public.pro273_supplement_put($1::jsonb,$2::jsonb,$3::text,$4::bytea,$5::bytea) AS result",[JSON.stringify(c),JSON.stringify(mutation),id,Buffer.from(raw),Buffer.from(provenance)]),
    supplementPrepare: (c,scope,sourceId,snapshotId,supplementId) => single(required(io.publisher),"SELECT public.pro273_supplement_prepare($1::jsonb,$2::text,$3::text,$4::text,$5::text) AS result",[JSON.stringify(c),scope,sourceId,snapshotId,supplementId]),
    mediaAppend: (c,mutation,objectId,generation,rawId,evidence) => single(required(io.material),"SELECT public.eng03_05_media_append($1::jsonb,$2::jsonb,$3::text,$4::bigint,$5::text,$6::jsonb) AS result",[JSON.stringify(c),JSON.stringify(mutation),objectId,generation,rawId,JSON.stringify(evidence)]),
    revisionAppend: (c,mutation,descriptor) => single(required(io.editor),"SELECT public.eng03_05_revision_append($1::jsonb,$2::jsonb,$3::jsonb) AS result",[JSON.stringify(c),JSON.stringify(mutation),JSON.stringify(descriptor)]),
    rawPut: (c,mutation,id,raw,mediaType,serialization,provenance) => single(required(io.editor),"SELECT public.eng03_05_raw_put($1::jsonb,$2::jsonb,$3::text,$4::bytea,$5::text,$6::text,$7::bytea) AS result",[JSON.stringify(c),JSON.stringify(mutation),id,Buffer.from(raw),mediaType,serialization,Buffer.from(provenance)]),
    registryLookup: async (c,target) => {if(io.reader.transactionMode!=="autocommit") throw new Error("TRANSACTION_BOUNDARY_UNAVAILABLE");const result=await io.reader.query<{result:unknown}>("SELECT public.eng03_05_registry_lookup($1::jsonb,$2::text) AS result",[JSON.stringify(c),target]);if(result.rows.length!==1) throw new Error("ADMIN_UNAVAILABLE");return result.rows[0].result;},
    registryChange: (c, mutation, target, mode, patch) => single(required(io.registry),"SELECT public.eng03_05_registry_change($1::jsonb,$2::jsonb,$3::text,$4::text,$5::jsonb) AS result",[JSON.stringify(c),JSON.stringify(mutation),target,mode,JSON.stringify(patch)]),
    syncComplete: (namespace, operationId, target, version, desiredHash, outcome, evidenceHash) => single(required(io.sync),"SELECT public.eng03_05_sync_complete($1::text,$2::text,$3::text,$4::bigint,$5::text,$6::text,$7::text) AS result",[namespace,operationId,target,version,desiredHash,outcome,evidenceHash]),
    inspectionGet: (c,scope,release,question) => single(required(io.reader),"SELECT public.eng03_05_inspection_get($1::jsonb,$2::text,$3::text,$4::text) AS result",[JSON.stringify(c),scope,release,question]),
    inspectionMark: (c,mutation,scope,release,question) => single(required(c.claimRoles.includes("super_admin") || c.claimRoles.includes("content_admin") ? io.editor : io.reviewer),"SELECT public.eng03_05_inspection_mark($1::jsonb,$2::jsonb,$3::text,$4::text,$5::text) AS result",[JSON.stringify(c),JSON.stringify(mutation),scope,release,question]),
    correctionGet: (c,scope,category,release) => single(required(io.reader),"SELECT public.eng03_05_correction_get($1::jsonb,$2::text,$3::text,$4::text) AS result",[JSON.stringify(c),scope,category,release]),
    correctionSave: (c,mutation,scope,category,release,patch) => single(required(io.editor),"SELECT public.eng03_05_correction_save($1::jsonb,$2::jsonb,$3::text,$4::text,$5::text,$6::jsonb) AS result",[JSON.stringify(c),JSON.stringify(mutation),scope,category,release,JSON.stringify(patch)]),
    categoryGet: (c,id) => single(required(io.reader),"SELECT public.eng03_05_category_get($1::jsonb,$2::text) AS result",[JSON.stringify(c),id]),
    categoryList: (c,filter) => single(required(io.reader),"SELECT public.eng03_05_category_list($1::jsonb,$2::jsonb) AS result",[JSON.stringify(c),JSON.stringify(filter)]),
    categoryUpdate: (c,mutation,id,patch) => single(required(io.editor),"SELECT public.eng03_05_category_update($1::jsonb,$2::jsonb,$3::text,$4::jsonb) AS result",[JSON.stringify(c),JSON.stringify(mutation),id,JSON.stringify(patch)]),
    auditList: (c,filter) => single(required(io.reader),"SELECT public.eng03_05_audit_list($1::jsonb,$2::jsonb) AS result",[JSON.stringify(c),JSON.stringify(filter)]),
    operationGet: (c,id) => single(privateReader(),"SELECT public.eng03_05_operation_get($1::jsonb,$2::text) AS result",[JSON.stringify(c),id]),
    roomGet: (c,id) => single(required(io.reader),"SELECT public.eng03_05_room_get($1::jsonb,$2::text) AS result",[JSON.stringify(c),id]),
    roomList: (c,filter) => single(required(io.reader),"SELECT public.eng03_05_room_list($1::jsonb,$2::jsonb) AS result",[JSON.stringify(c),JSON.stringify(filter)]),
    reviewGet: (c,id) => single(required(io.reader),"SELECT public.eng03_05_review_get($1::jsonb,$2::text) AS result",[JSON.stringify(c),id]),
    reviewList: (c,filter) => single(required(io.reader),"SELECT public.eng03_05_review_list($1::jsonb,$2::jsonb) AS result",[JSON.stringify(c),JSON.stringify(filter)]),
    draftGet: (c,id) => single(required(io.reader),"SELECT public.eng03_05_draft_get($1::jsonb,$2::text) AS result",[JSON.stringify(c),id]),
    draftList: (c,filter) => single(required(io.reader),"SELECT public.eng03_05_draft_list($1::jsonb,$2::jsonb) AS result",[JSON.stringify(c),JSON.stringify(filter)]),
    draftSave: (c,mutation,id,draft) => single(required(io.editor),"SELECT public.eng03_05_draft_save($1::jsonb,$2::jsonb,$3::text,$4::jsonb) AS result",[JSON.stringify(c),JSON.stringify(mutation),id,JSON.stringify(draft)]),
    draftArchive: (c,mutation,id) => single(required(io.editor),"SELECT public.eng03_05_draft_archive($1::jsonb,$2::jsonb,$3::text) AS result",[JSON.stringify(c),JSON.stringify(mutation),id]),
    reviewSubmit: (c,mutation,id) => single(required(io.editor),"SELECT public.eng03_05_review_submit($1::jsonb,$2::jsonb,$3::text) AS result",[JSON.stringify(c),JSON.stringify(mutation),id]),
    reviewDecide: (c,mutation,id,decision,reason) => single(required(io.reviewer),"SELECT public.eng03_05_review_decide($1::jsonb,$2::jsonb,$3::text,$4::text,$5::text) AS result",[JSON.stringify(c),JSON.stringify(mutation),id,decision,reason]),
    settingsGet: (c: SqlContext) => single(required(io.reader),"SELECT public.eng03_05_settings_get($1::jsonb) AS result",[JSON.stringify(c)]),
    settingsUpdate: (c, mutation, patch) => single(required(io.registry),"SELECT public.eng03_05_settings_update($1::jsonb,$2::jsonb,$3::jsonb) AS result",[JSON.stringify(c),JSON.stringify(mutation),JSON.stringify(patch)]),
    principal: (c: SqlContext) => single(privateReader(),"SELECT public.eng03_05_principal($1::jsonb) AS result",[JSON.stringify(c)]),
    rate: (c: SqlContext) => single(privateReader(),"SELECT public.eng03_05_rate_take($1::jsonb) AS result",[JSON.stringify(c)]),
    snapshot: (c: SqlContext, scope: string, releaseId: string) => {
      if (scope==="huroof-release-snapshot-v1" || !/^[A-Za-z0-9_-]{1,128}$/.test(scope) || !/^[A-Za-z0-9_-]{1,128}$/.test(releaseId)) throw new Error("INVALID_REQUEST");
      return single(privateReader(),"SELECT public.eng03_05_snapshot_read($1::jsonb,$2::text,$3::text) AS result",[JSON.stringify(c),scope,releaseId]);
    },
    mediaAuthorize: (c: SqlContext, subject: unknown) => single(required(io.reader),"SELECT public.eng03_05_media_authorize($1::jsonb,$2::jsonb) AS result",[JSON.stringify(c),JSON.stringify(subject)]),
  };
}

/** Decode exact byte-bearing query output; parseStoredSnapshot verifies all hashes and references. */
export function decodeSnapshotResult(value: unknown): import("./contracts").StoredSnapshot {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("CONTENT_UNAVAILABLE");
  const v=value as Record<string,unknown>;
  const str=(name:string):string=>{const x=v[name]; if(typeof x!=="string" || !x || x.length>1024) throw new Error("CONTENT_UNAVAILABLE"); return x;};
  const len=(name:string):number=>{const x=v[name]; if(typeof x!=="string" || !/^(0|[1-9][0-9]*)$/.test(x)) throw new Error("CONTENT_UNAVAILABLE"); const n=Number(x); if(!Number.isSafeInteger(n) || n>64*1024*1024) throw new Error("CONTENT_UNAVAILABLE"); return n;};
  const bytes=(name:string):Buffer=>{const x=v[name]; if(typeof x!=="string" || x.length>90_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(x)) throw new Error("CONTENT_UNAVAILABLE"); const out=Buffer.from(x,"base64");if(out.toString("base64")!==x) throw new Error("CONTENT_UNAVAILABLE");return out;};
  const artifact=(prefix:string)=>({id:str(prefix+"Id"),hash:str(prefix+"Hash"),byteLength:len(prefix+"Length"),mediaType:str(prefix+"MediaType"),serialization:str(prefix+"Serialization"),provenanceHash:str(prefix+"ProvenanceHash"),raw:bytes(prefix+"Base64"),provenance:bytes(prefix+"ProvenanceBase64")});
  return {namespace:str("namespace"),projectId:str("projectId"),profileScope:str("profileScope"),pointerVersion:str("pointerVersion"),profileSourceId:str("profileSourceId"),profileRevision:str("profileRevision"),profile:artifact("profile"),releaseId:str("releaseId"),releaseRoot:str("releaseRoot"),receiptId:str("receiptId"),catalogId:str("catalogId"),catalogRoot:str("catalogRoot"),sealHash:str("sealHash"),snapshot:artifact("snapshot")};
}




















