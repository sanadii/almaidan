import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { postgresHuroofReserveStore, postgresHuroofLeaseClaimer, postgresHuroofLeaseSettler } from "../src/admission/huroof-postgres.js";
import { reserveHuroofMatchForTest } from "../src/admission/huroof-reserve.js";
import { runHuroofAdmissionJob } from "../src/admission/huroof-worker.js";

const gated = process.env.INT5B_INTEGRATED_TEST === "1";
if (gated) {
  const target = new URL(process.env.INT5B_TEST_DATABASE_URL ?? "");
  if (!/^(127\.0\.0\.1|localhost)$/u.test(target.hostname) || !target.pathname.endsWith("_int5b_test") || process.env.INT5B_REHEARSAL_APPROVED !== "1") throw new Error("exact rereview and explicit disposable integrated target required");
  for (const name of ["INT5B_RESERVER_DATABASE_URL","INT5B_PROVISIONER_DATABASE_URL","INT5B_RECONCILER_DATABASE_URL"]) {
    const login = new URL(process.env[name] ?? "");
    if (login.hostname !== target.hostname || login.port !== target.port || login.pathname !== target.pathname || login.username === target.username) throw new Error("distinct restricted logins must use the exact disposable target");
  }
  if (!/^127\.0\.0\.1:\d+$/u.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") || !/^127\.0\.0\.1:\d+$/u.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "")) throw new Error("explicit loopback Auth/Firestore emulators required");
  const actual = createHash("sha256").update(readFileSync("services/enta/server/prisma/migrations/20261003100000_int5b_huroof_admission/migration.sql")).digest("hex");
  if (process.env.INT5B_APPROVED_SQL_SHA256 !== actual) throw new Error("exact approved SQL hash required");
}

test("INT5B real restricted PostgreSQL adapters and direct Firestore Admin terminal roundtrip", { skip: !gated }, async (t) => {
  const projectId = "demo-int5b-admission";
  process.env.GCLOUD_PROJECT = projectId; process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
  process.env.FUNCTIONS_EMULATOR = "true"; process.env.HUROOF_ADMISSION_PROJECT_ID = projectId;
  const callables = await import("../../../../functions/src/index.js");
  const functionsRequire = createRequire(resolve("functions/package.json"));
  const { getApps } = functionsRequire("firebase-admin/app") as typeof import("firebase-admin/app"), { getAuth } = functionsRequire("firebase-admin/auth") as typeof import("firebase-admin/auth"), { getFirestore } = functionsRequire("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
  const { createHuroofFirestorePort } = await import("../../../../functions/src/paid-admission.js");
  const app = getApps()[0], firestore = getFirestore(app), port = createHuroofFirestorePort(app,"مضيف");
  const dba = new PrismaClient({ datasourceUrl: process.env.INT5B_TEST_DATABASE_URL! });
  const reserver = new PrismaClient({ datasourceUrl: process.env.INT5B_RESERVER_DATABASE_URL! }), provisioner = new PrismaClient({ datasourceUrl: process.env.INT5B_PROVISIONER_DATABASE_URL! }), reconciler = new PrismaClient({ datasourceUrl: process.env.INT5B_RECONCILER_DATABASE_URL! });
  try {
    const pins = (await dba.$queryRaw<Array<{ huroofProjectId: string; huroofReleaseId: string; huroofRootSha256: string; selectorVersion: string; policyVersion: string; huroofCapabilityStateHash: string }>>`SELECT r.* FROM public."CatalogValidationReceipt" r JOIN public."ActiveCatalogPointer" p ON p."validationReceiptId"=r."id" WHERE r."id"='int5b-synthetic-receipt'`)[0];
    assert.equal(pins.huroofProjectId,projectId);
    const config = { policyVersion:1 as const,demo:false,releaseDemoFixture:false,releaseId:pins.huroofReleaseId,releaseRootSha256:pins.huroofRootSha256,gameKind:"huroof" as const,modality:"classic" as const,categories:["synthetic-category"],mapPresentation:"ordinary" as const,questionSeconds:20,opponentSeconds:10,teams:{ horizontal:"أ",vertical:"ب" },mode:"classic" as const,difficulty:"mixed",labelledColours:false };
    const batch = firestore.batch(), letters = [..."ابتثجحخدذرزسشصضطظعغفقكلمنهوي"];
    batch.set(firestore.doc(`releases/${pins.huroofReleaseId}`),{ immutable:true,demoFixture:false,documentRootSha256:pins.huroofRootSha256,approvedCount:letters.length*4 });
    batch.set(firestore.doc(`releases/${pins.huroofReleaseId}/inventory/synthetic-category`),{ immutable:true,categoryId:"synthetic-category",approvedCount:letters.length*4 });
    for (const [index,letter] of letters.entries()) for (let n=0;n<4;n++) {
      const id=`q-${index}-${n}`;
      batch.set(firestore.doc(`releases/${pins.huroofReleaseId}/questions/${id}`),{ id,categoryId:"synthetic-category",modality:"classic",targetLetter:letter,answerConceptId:`concept-${id}`,headerAr:"اختبار",promptAr:`سؤال ${index} ${n}`,canonicalAnswer:`${letter} جواب ${index} ${n}`,acceptedAnswers:[],review:{ approved:true },moderation:{ status:"approved" } });
    }
    batch.set(firestore.doc("runtime/catalogSelectorAttestation"),{ issuer:"huroof-functions",projectId,releaseId:pins.huroofReleaseId,rootSha256:pins.huroofRootSha256,selectorVersion:pins.selectorVersion,policyVersion:pins.policyVersion,capabilityStateHash:pins.huroofCapabilityStateHash });
    await batch.commit();
    const claimer=postgresHuroofLeaseClaimer(provisioner),settler=postgresHuroofLeaseSettler(reconciler);
    const waitAvailable = async (admissionId:string) => {
      const job=(await dba.$queryRaw<Array<{ state:string; available:Date; expiry:Date | null }>>`SELECT "state","availableAt" AS available,"leaseExpiresAt" AS expiry FROM public."AdmissionOutbox" WHERE "admissionId"=${admissionId}`)[0];
      const deadline=job.state==="LEASED" ? job.expiry! : job.available;
      await new Promise((resolve)=>setTimeout(resolve,Math.max(0,deadline.getTime()-Date.now()+100)));
    };
    for (const outcome of ["STARTED","CANCELLED"] as const) await t.test(`${outcome} Admin proof survives lost response and posts one matching terminal effect`,async()=>{
      const uid=`integrated-${randomUUID()}`,identityId=`identity-${uid}`,walletId=`wallet-${uid}`,email=`${uid}@example.invalid`,password="synthetic-password-123";
      await getAuth(app).createUser({ uid,email,password,emailVerified:true });
      await dba.$transaction(async(sql)=>{
        await sql.$executeRaw`INSERT INTO public."FirebaseIdentity"("id","firebaseProjectId","firebaseUid","updatedAt") VALUES(${identityId},${projectId},${uid},clock_timestamp())`;
        await sql.$executeRaw`INSERT INTO public."Wallet"("id","firebaseIdentityId","updatedAt") VALUES(${walletId},${identityId},clock_timestamp())`;
        await sql.$executeRaw`INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId") VALUES(${randomUUID()},${walletId},1,'FREE_FIRST_GRANT',${identityId},'FREE_FIRST_GRANT',1,0,0,1,0,0,${identityId})`;
        await sql.$executeRaw`UPDATE public."Wallet" SET "available"=1,"version"=1 WHERE "id"=${walletId}`;
      });
      const store=postgresHuroofReserveStore(reserver), principal={ projectId,uid,email,verifiedAccount:true,anonymous:false },command={ logicalMatchId:randomUUID(),requestKey:randomUUID(),config };
      const reserved=await reserveHuroofMatchForTest(store,principal,command,async()=>{});
      assert.deepEqual((await reserveHuroofMatchForTest(store,principal,command,async()=>{})).binding,reserved.binding); // reserve response loss
      if (outcome==="STARTED") {
        // Commit provisioning, then lose its response before SQL can requeue.
        await assert.rejects(runHuroofAdmissionJob(claimer,settler,{ ...port,provision:async(binding,material)=>{ await port.provision(binding,material); throw new Error("PROVISION_RESPONSE_LOST"); } },"integrated-worker"),/RESPONSE_LOST/);
        const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic-key`,{ method:"POST",headers:{ "Content-Type":"application/json" },body:JSON.stringify({ email,password,returnSecureToken:true }) }); assert.equal(response.status,200);
        const { idToken }=await response.json() as { idToken:string };
        const request={ auth:{ uid,token:{ aud:projectId } },rawRequest:{ headers:{ authorization:`Bearer ${idToken}` } },data:{ roomId:reserved.binding.roomId,intent:{ type:"START_MATCH",intentId:"integrated-start",expectedRevision:1,payload:{} } } };
        await callables.submitGameIntent.run(request as never);
        assert.equal((await callables.submitGameIntent.run(request as never))?.replayed,true); // start response loss
      } else {
        await assert.rejects(runHuroofAdmissionJob(claimer,settler,{ ...port,cancel:async(binding,id)=>{ await port.cancel(binding,id); throw new Error("CANCEL_RESPONSE_LOST"); } },"integrated-worker",{ cancel:true }),/RESPONSE_LOST/);
      }
      await waitAvailable(reserved.binding.admissionId); // real expired claim/reclaim, no timer rewrite
      let postings=0;
      await assert.rejects(runHuroofAdmissionJob(claimer,{ finish:async(lease,proof)=>{ assert.ok(proof); postings++; const result=await settler.finish(lease,proof); assert.equal(result,true); throw new Error("SQL_RESPONSE_LOST"); } },port,"integrated-retry"),/SQL_RESPONSE_LOST/);
      assert.equal(postings,1); assert.equal((await port.read(reserved.binding))?.state,outcome);
      assert.equal(await runHuroofAdmissionJob(claimer,settler,port,"duplicate-worker"),"idle");
      const effects=await dba.$queryRaw<Array<{ effect:string }>>`SELECT "effect" FROM public."WalletEntry" WHERE "originId"=${reserved.binding.admissionId} ORDER BY "sequence"`;
      assert.deepEqual(effects.map((row)=>row.effect),["RESERVE",outcome==="STARTED" ? "COMMIT" : "RELEASE"]);
      const wallet=(await dba.$queryRaw<Array<{ available:bigint; held:bigint; version:bigint }>>`SELECT "available","held","version" FROM public."Wallet" WHERE "id"=${walletId}`)[0];
      assert.deepEqual(wallet,{ available:outcome==="STARTED" ? 0n : 1n,held:0n,version:3n });
    });
  } finally { await Promise.all([dba,reserver,provisioner,reconciler].map((client)=>client.$disconnect())); }
});
