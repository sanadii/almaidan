import assert from "node:assert/strict";
import { randomUUID,createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { admissionHash, type HuroofBinding, type HuroofProof } from "../src/admission/huroof-protocol.cjs";

const url=process.env.INT5B_TEST_DATABASE_URL;
const callerUrls: string[]=process.env.INT5B_CATALOG_CALLERS_JSON ? JSON.parse(process.env.INT5B_CATALOG_CALLERS_JSON) : [];
const activatorUrl=process.env.INT5B_CATALOG_ACTIVATOR_DATABASE_URL;
if(url){
 const target=new URL(url);
 assert.ok(target.hostname==="127.0.0.1" && target.port==="55440" && /^\/maydan_perm3_20261005_(empty|legacy)_int5b_test$/.test(target.pathname));
 assert.equal(process.env.INT5B_REHEARSAL_APPROVED,"1");
 assert.equal(process.env.INT5B_APPROVED_SQL_SHA256,createHash("sha256").update(readFileSync("services/enta/server/prisma/migrations/20261003100000_int5b_huroof_admission/migration.sql")).digest("hex"));
 assert.equal(callerUrls.length,6);assert.equal(new Set(callerUrls.map((item)=>new URL(item).username)).size,6);
 for(const item of [...callerUrls,activatorUrl!]){const parsed=new URL(item);assert.equal(parsed.hostname,target.hostname);assert.equal(parsed.port,target.port);assert.equal(parsed.pathname,target.pathname);assert.notEqual(parsed.username,target.username);}
 assert.equal(new URL(activatorUrl!).username,"int5b_v3_catalog_activator");
}
const writers=["catalog_assembler","catalog_reviewer","catalog_publisher","catalog_validator","catalog_activator"];

test("INT5B column-only pointer lock preserves catalog custody and both rotation orders",{skip:!url},async(t)=>{
 const dba=new PrismaClient({datasourceUrl:url!});
 const callers=callerUrls.map((value)=>({login:new URL(value).username,client:new PrismaClient({datasourceUrl:value})}));
 const activator=new PrismaClient({datasourceUrl:activatorUrl!});
 const kind=new URL(url ?? "http://unused").pathname.includes("_legacy_") ? "l" : "e";
 const selected=(operation:string)=>{const caller=callers.find((item)=>item.login===`int5b_utf8_${kind}_${operation}`);assert.ok(caller);return caller.client;};
 const reserver=selected("reserver"),provisioner=selected("provisioner"),reconciler=selected("reconciler");
 const txOptions={timeout:30000,maxWait:30000};
 const catalog=()=>dba.$queryRaw`SELECT (SELECT jsonb_agg(p ORDER BY p."id") FROM public."ActiveCatalogPointer" p) AS pointer,(SELECT jsonb_agg(r ORDER BY r."id") FROM public."CatalogValidationReceipt" r) AS receipts,(SELECT jsonb_agg(e ORDER BY e."id") FROM public."CatalogActivationEvent" e) AS events,(SELECT jsonb_agg(c ORDER BY c."id") FROM public."CatalogRelease" c) AS releases`;
 const deny=(client:PrismaClient,sql:string)=>assert.rejects(client.$transaction(async(db)=>{await db.$executeRawUnsafe(sql);throw new Error("UNEXPECTED_ALLOWED_ROLLBACK");},txOptions),/permission denied|must be owner/i);
 async function waitBlocked(name:string){const stop=Date.now()+8000;while(Date.now()<stop){const rows=await dba.$queryRaw<Array<{pid:number;blockers:number[]}>>`SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=current_database() AND application_name=${name} AND wait_event_type='Lock'`;if(rows.some((row)=>row.blockers.length)){t.diagnostic(`observed PostgreSQL lock wait ${name} blockers=${rows[0].blockers.length}`);return;}await new Promise((resolve)=>setTimeout(resolve,25));}throw new Error(`No observable lock wait for ${name}`);}
 async function held(client:PrismaClient,name:string,work:(db:Prisma.TransactionClient)=>Promise<unknown>){
  let signal!:()=>void,fail!:(error:unknown)=>void,release!:()=>void;
  const ready=new Promise<void>((resolve,reject)=>{signal=resolve;fail=reject;}),gate=new Promise<void>((resolve)=>{release=resolve;});
  const done=client.$transaction(async(db)=>{await db.$queryRaw`SELECT set_config('application_name',${name},true)`;await work(db);signal();await gate;},txOptions);
  void done.catch(fail);await ready;return {release,done};
 }
 const reserve=(db:Prisma.TransactionClient,binding:HuroofBinding,intentHash:string,config:unknown)=>db.$executeRaw`SELECT public.int5b_reserve_huroof(${JSON.stringify(binding)}::jsonb,${intentHash},${JSON.stringify(config)}::jsonb)`;
 async function fixture(receiptId:string){
  const receipt=(await dba.$queryRaw<Array<{id:string;catalogReleaseId:string;releaseRootHash:string;huroofProjectId:string;huroofReleaseId:string;huroofRootSha256:string;selectorVersion:string;policyVersion:string;huroofCapabilityStateHash:string}>>`SELECT * FROM public."CatalogValidationReceipt" WHERE id=${receiptId}`)[0];assert.ok(receipt);
  const uid=`catalog-lock-${randomUUID()}`,identityId=`identity-${uid}`,walletId=`wallet-${uid}`;
  await dba.$transaction(async(db)=>{
   await db.$executeRaw`INSERT INTO public."FirebaseIdentity"(id,"firebaseProjectId","firebaseUid","updatedAt") VALUES(${identityId},${receipt.huroofProjectId},${uid},clock_timestamp())`;
   await db.$executeRaw`INSERT INTO public."Wallet"(id,"firebaseIdentityId","updatedAt") VALUES(${walletId},${identityId},clock_timestamp())`;
   await db.$executeRaw`INSERT INTO public."WalletEntry"(id,"walletId",sequence,"originType","originId",effect,"deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId") VALUES(${randomUUID()},${walletId},1,'FREE_FIRST_GRANT',${identityId},'FREE_FIRST_GRANT',1,0,0,1,0,0,${identityId})`;
   await db.$executeRaw`UPDATE public."Wallet" SET available=1,version=1 WHERE id=${walletId}`;
  });
  const config={policyVersion:1,demo:false,releaseDemoFixture:false,releaseId:receipt.huroofReleaseId,releaseRootSha256:receipt.huroofRootSha256,gameKind:"huroof",modality:"classic",categories:["synthetic-category"],mapPresentation:"ordinary",questionSeconds:20,opponentSeconds:10,teams:{horizontal:"\u0623",vertical:"\u0628"},mode:"classic",difficulty:"mixed",labelledColours:false};
  const logicalMatchId=randomUUID(),requestKey=randomUUID(),intentHash=admissionHash({engine:"HUROOF",operation:"HOSTED_HUROOF",logicalMatchId,config,predecessorId:null});
  const binding:HuroofBinding={version:1,admissionId:randomUUID(),identityId,projectId:receipt.huroofProjectId,uid,engine:"HUROOF",operation:"HOSTED_HUROOF",logicalMatchId,roomId:randomUUID(),requestKey,requestHash:admissionHash({version:1,requestKey,intentHash}),catalogReleaseId:receipt.catalogReleaseId,catalogRootHash:receipt.releaseRootHash,validationReceiptId:receipt.id,releaseId:receipt.huroofReleaseId,releaseRootHash:receipt.huroofRootSha256,selectorVersion:receipt.selectorVersion,readinessPolicyVersion:receipt.policyVersion,capabilityHash:receipt.huroofCapabilityStateHash,configHash:admissionHash(config),predecessorId:null};
  const state=()=>dba.$queryRaw`SELECT to_jsonb(w) AS wallet,(SELECT jsonb_agg(a ORDER BY a.id) FROM public."Admission" a WHERE a."walletId"=w.id) AS admissions,(SELECT jsonb_agg(e ORDER BY e.sequence) FROM public."WalletEntry" e WHERE e."walletId"=w.id) AS ledger FROM public."Wallet" w WHERE w.id=${walletId}`;
  return {binding,intentHash,config,state};
 }
 try{
  await t.test("six real callers and definer/operation groups have no catalog writer path",async()=>{
   for(const caller of callers){const rows=await caller.client.$queryRaw<Array<{login:string;server:string;client:string;superuser:boolean;creator:boolean;createDb:boolean;bypass:boolean}>>`SELECT session_user AS login,current_setting('server_encoding') AS server,current_setting('client_encoding') AS client,r.rolsuper AS superuser,r.rolcreaterole AS creator,r.rolcreatedb AS "createDb",r.rolbypassrls AS bypass FROM pg_roles r WHERE r.rolname=session_user`;assert.deepEqual(rows[0],{login:caller.login,server:"UTF8",client:"UTF8",superuser:false,creator:false,createDb:false,bypass:false});
    for(const writer of [...writers,"enta_finance_executor","postgres","pg_database_owner","pg_write_all_data"]){const rows=await caller.client.$queryRaw<Array<{member:boolean}>>`SELECT pg_has_role(session_user,${writer},'member') AS member`;assert.equal(rows[0].member,false,`${caller.login} transitive ${writer}`);}
    for(const column of ["id","catalogReleaseId","releaseRootHash","validationReceiptId","updatedAt"]){const rights=await caller.client.$queryRaw<Array<{allowed:boolean}>>`SELECT has_column_privilege(session_user,'public."ActiveCatalogPointer"',${column},'UPDATE') AS allowed`;assert.equal(rights[0].allowed,false);}
    t.diagnostic(`actual restricted caller ${caller.login} has no catalog/owner path`);
   }
   for(const group of ["enta_runtime","enta_finance_executor","enta_outbox_worker","enta_huroof_reserver","enta_huroof_provisioner","enta_huroof_reconciler"]){for(const writer of writers){const result=await dba.$queryRaw<Array<{member:boolean}>>`SELECT pg_has_role(${group},${writer},'member') AS member`;assert.equal(result[0].member,false);}}
   const groupBoundary=await dba.$queryRaw<Array<{name:string;login:boolean;superuser:boolean;creator:boolean;createDb:boolean;bypass:boolean;schemaCreate:boolean}>>`SELECT rolname AS name,rolcanlogin AS login,rolsuper AS superuser,rolcreaterole AS creator,rolcreatedb AS "createDb",rolbypassrls AS bypass,has_schema_privilege(oid,'public','CREATE') AS "schemaCreate" FROM pg_roles WHERE rolname IN ('enta_finance_executor','enta_huroof_reserver','enta_huroof_provisioner','enta_huroof_reconciler')`;
   assert.equal(groupBoundary.length,4);assert.ok(groupBoundary.every((row)=>!row.login && !row.superuser && !row.creator && !row.createDb && !row.bypass && !row.schemaCreate));
   const positive=await activator.$queryRaw<Array<{login:string;superuser:boolean;creator:boolean;createDb:boolean;bypass:boolean;schemaCreate:boolean;activator:boolean;finance:boolean;server:string;client:string}>>`SELECT session_user AS login,r.rolsuper AS superuser,r.rolcreaterole AS creator,r.rolcreatedb AS "createDb",r.rolbypassrls AS bypass,has_schema_privilege(session_user,'public','CREATE') AS "schemaCreate",pg_has_role(session_user,'catalog_activator','member') AS activator,pg_has_role(session_user,'enta_finance_executor','member') AS finance,current_setting('server_encoding') AS server,current_setting('client_encoding') AS client FROM pg_roles r WHERE r.rolname=session_user`;
   assert.deepEqual(positive[0],{login:"int5b_v3_catalog_activator",superuser:false,creator:false,createDb:false,bypass:false,schemaCreate:false,activator:true,finance:false,server:"UTF8",client:"UTF8"});
  });
  await t.test("each real caller denies catalog DML, activation, issuance, ALTER and forbidden SET ROLE",async()=>{
   const before=await catalog();
   for(const caller of callers){
    for(const table of ["ActiveCatalogPointer","CatalogValidationReceipt","CatalogRelease","CatalogReleaseSeal","CatalogActivationEvent"]){for(const sql of [`INSERT INTO public."${table}" DEFAULT VALUES`,`UPDATE public."${table}" SET id=id`,`DELETE FROM public."${table}"`,`TRUNCATE public."${table}"`,`ALTER TABLE public."${table}" ADD COLUMN int5b_forbidden integer`])await deny(caller.client,sql);}
    for(const column of ["updatedAt","catalogReleaseId","releaseRootHash","validationReceiptId"]){await deny(caller.client,`UPDATE public."ActiveCatalogPointer" SET "${column}"="${column}" WHERE id='singleton'`);}
    await deny(caller.client,"SELECT public.activate_catalog_release('int5b-synthetic-receipt','int5b-rotation-receipt')");
    await deny(caller.client,"SELECT public.issue_catalog_validation_receipt('x','x','x','x','x','x','x','x','x','x','x')");
    for(const role of ["enta_finance_executor","postgres",...writers])await deny(caller.client,`SET LOCAL ROLE ${role}`);
    await deny(caller.client,'CREATE TABLE public.int5b_forbidden(id integer)');
   }
   assert.deepEqual(await catalog(),before);
  });
  await t.test("actual nonactivator session hits unchanged R5 guard inside fixed finance definer probe",async()=>{
   const info=await dba.$queryRaw<Array<{owner:string;definer:boolean;path:string[];source:string}>>`SELECT pg_get_userbyid(proowner) AS owner,prosecdef AS definer,proconfig AS path,prosrc AS source FROM pg_proc WHERE oid='public.int5b_test_pointer_guard()'::regprocedure`;
   assert.equal(info[0].owner,"enta_finance_executor");assert.equal(info[0].definer,true);assert.deepEqual(info[0].path,["search_path=pg_catalog"]);assert.match(info[0].source,/UPDATE public\."ActiveCatalogPointer" SET "updatedAt"=clock_timestamp\(\) WHERE id='singleton'/);
   const allowed=`int5b_utf8_${kind}_reserver`;
   const acl=await dba.$queryRaw<Array<{grantee:string;privilege:string;grantable:boolean}>>`SELECT CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,x.privilege_type AS privilege,x.is_grantable AS grantable FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) x WHERE p.oid='public.int5b_test_pointer_guard()'::regprocedure ORDER BY 1`;
   assert.deepEqual(acl,[{grantee:"enta_finance_executor",privilege:"EXECUTE",grantable:false},{grantee:allowed,privilege:"EXECUTE",grantable:false}]);
   const before=await catalog();
   for(const caller of callers){if(caller.login===allowed){await assert.rejects(caller.client.$queryRaw`SELECT public.int5b_test_pointer_guard()`,new RegExp(`INT5B_FIXED_GUARD session_user=${allowed} current_user=enta_finance_executor original=active catalog pointer changes require the restricted activator`));}
    else await deny(caller.client,"SELECT public.int5b_test_pointer_guard()");}
   assert.deepEqual(await catalog(),before);
  });
  await t.test("reservation pointer share lock excludes rotation, immutable pin and same-key retry survive",async()=>{
   assert.equal((await dba.$queryRaw<Array<{id:string}>>`SELECT "validationReceiptId" AS id FROM public."ActiveCatalogPointer" WHERE id='singleton'`)[0].id,"int5b-synthetic-receipt");
   assert.equal((await dba.$queryRaw<Array<{n:bigint}>>`SELECT count(*) AS n FROM public."AdmissionOutbox" WHERE state<>'DONE'`)[0].n,0n,"queue must be known empty");
   const initialEvents=(await dba.$queryRaw<Array<{n:bigint}>>`SELECT count(*) AS n FROM public."CatalogActivationEvent" WHERE "validationReceiptId"='int5b-rotation-receipt'`)[0].n;
   const f=await fixture("int5b-synthetic-receipt"),heldReserve=await held(reserver,"int5b-v3-reserve-first",(db)=>reserve(db,f.binding,f.intentHash,f.config));
   const rotation=activator.$transaction(async(db)=>{await db.$queryRaw`SELECT set_config('application_name','int5b-v3-activation-wait',true)`;const rows=await db.$queryRaw<Array<{ok:boolean}>>`SELECT public.activate_catalog_release('int5b-synthetic-receipt','int5b-rotation-receipt') AS ok`;assert.equal(rows[0].ok,true);},txOptions);void rotation.catch(()=>{});
   try{await waitBlocked("int5b-v3-activation-wait");}finally{heldReserve.release();await heldReserve.done;await rotation;}
   const pinned=await dba.$queryRaw<Array<{receipt:string;config:typeof f.config;hash:string}>>`SELECT "huroofValidationReceiptId" AS receipt,"huroofConfig" AS config,public.int5b_hash_json("huroofConfig") AS hash FROM public."Admission" WHERE id=${f.binding.admissionId}`;
   assert.equal(pinned[0].receipt,"int5b-synthetic-receipt");assert.deepEqual(pinned[0].config,f.config);assert.equal(pinned[0].hash,f.binding.configHash);
   const before=await f.state();await reserver.$transaction((db)=>reserve(db,f.binding,f.intentHash,f.config),txOptions);assert.deepEqual(await f.state(),before);
   const lease=(await provisioner.$queryRaw<Array<{value:{jobId:string;leaseOwner:string;leaseVersion:number;binding:HuroofBinding}|null}>>`SELECT public.int5b_claim_huroof('catalog-lock-worker') AS value`)[0].value;assert.ok(lease);assert.equal(lease.binding.admissionId,f.binding.admissionId);
   const proof:HuroofProof={version:1,binding:f.binding,state:"CANCELLED",provision:null,terminal:{version:1,kind:"CANCEL",actorUid:"catalog-test-canceller",intentId:"catalog-test-release",requestHash:"d".repeat(64),fromRevision:0,toRevision:1}};
   assert.equal((await reconciler.$queryRaw<Array<{ok:boolean}>>`SELECT public.int5b_finish_huroof(${lease.jobId},${lease.leaseOwner},${lease.leaseVersion},${JSON.stringify(proof)}::jsonb) AS ok`)[0].ok,true);
   const events=await dba.$queryRaw<Array<{n:bigint}>>`SELECT count(*) AS n FROM public."CatalogActivationEvent" WHERE "validationReceiptId"='int5b-rotation-receipt'`;assert.equal(events[0].n,initialEvents+1n);
  });
  await t.test("activation locks first; stale reserve waits then fails with no hold",async()=>{
   const f=await fixture("int5b-rotation-receipt"),before=await f.state();
   const rotation=await held(activator,"int5b-v3-activation-first",async(db)=>{const rows=await db.$queryRaw<Array<{ok:boolean}>>`SELECT public.activate_catalog_release('int5b-rotation-receipt','int5b-synthetic-receipt') AS ok`;assert.equal(rows[0].ok,true);});
   const stale=reserver.$transaction(async(db)=>{await db.$queryRaw`SELECT set_config('application_name','int5b-v3-reserve-wait',true)`;return reserve(db,f.binding,f.intentHash,f.config);},txOptions);void stale.catch(()=>{});
   try{await waitBlocked("int5b-v3-reserve-wait");}finally{rotation.release();await rotation.done;}
   await assert.rejects(stale,/active readiness rotated/);assert.deepEqual(await f.state(),before);
   assert.equal((await dba.$queryRaw<Array<{n:bigint}>>`SELECT count(*) AS n FROM public."AdmissionOutbox" WHERE state<>'DONE'`)[0].n,0n);
   assert.equal((await dba.$queryRaw<Array<{id:string}>>`SELECT "validationReceiptId" AS id FROM public."ActiveCatalogPointer" WHERE id='singleton'`)[0].id,"int5b-synthetic-receipt");
  });
 }finally{await Promise.all([dba.$disconnect(),activator.$disconnect(),...callers.map((caller)=>caller.client.$disconnect())]);}
});
