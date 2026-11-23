import assert from "node:assert/strict";
import { test } from "node:test";
import type { DecodedIdToken, UserRecord } from "firebase-admin/auth";
import { assertCurrentPaidHost, paidHostVerifier } from "./paid-host-verifier.js";
import { initializeApp, deleteApp } from "firebase-admin/app";

const project = "demo-int5b-admission", uid = "verified-host";
const token = { uid, sub: uid, aud: project, iss: `https://securetoken.google.com/${project}`, auth_time: 100,
  firebase: { sign_in_provider: "password" } } as DecodedIdToken;
const current = { uid, disabled: false, emailVerified: true, email: "host@example.invalid", tokensValidAfterTime: new Date(99000).toUTCString(), providerData: [{ providerId: "google.com" }] } as UserRecord;
const request = { auth: { uid }, rawRequest: { headers: { authorization: "Bearer exact-raw-token" } } };

test("actual initializeApp path retains Firebase config and rejects a mismatched Admin project before I/O", async () => {
  const keys=["FIREBASE_CONFIG","GCLOUD_PROJECT","HUROOF_ADMISSION_PROJECT_ID"] as const;
  const before=Object.fromEntries(keys.map((key)=>[key,process.env[key]]));
  try {
    process.env.FIREBASE_CONFIG=JSON.stringify({ projectId:project }); process.env.GCLOUD_PROJECT=project; process.env.HUROOF_ADMISSION_PROJECT_ID=project;
    const app=initializeApp();
    try { assert.equal(app.options.projectId,project); await assert.rejects(assertCurrentPaidHost({ auth:{ uid },rawRequest:{ headers:{} } }),/SESSION_REQUIRED/); } finally { await deleteApp(app); }
    const mismatch=initializeApp({ projectId:"wrong-project" });
    try { await assert.rejects(assertCurrentPaidHost(request),/ADMIN_PROJECT_MISMATCH/); } finally { await deleteApp(mismatch); }
    process.env.HUROOF_ADMISSION_PROJECT_ID="huroof-a3ee7"; process.env.GCLOUD_PROJECT="huroof-a3ee7";
    await assert.rejects(assertCurrentPaidHost(request),/PROJECT_UNAVAILABLE/);
  } finally { for (const key of keys) { if (before[key]===undefined) delete process.env[key]; else process.env[key]=before[key]; } }
});

test("paid host verifier rechecks the exact raw token with production revocation enabled", async () => {
  const calls: unknown[][] = [];
  const verify = paidHostVerifier({ async verifyIdToken(raw, revoked) { calls.push([raw, revoked]); return token; }, async getUser() { return current; } }, project);
  assert.equal(await verify(request), uid);
  assert.deepEqual(calls, [["exact-raw-token", true]]);
});
test("revoked token with a currently enabled verified linked account is denied", async () => {
  const verify = paidHostVerifier({ async verifyIdToken(_raw, revoked) { assert.equal(revoked, true); throw new Error("auth/id-token-revoked"); }, async getUser() { return current; } }, project);
  await assert.rejects(verify(request), /SESSION_INVALID/);
  // Independently enforce Admin's validated auth_time / current valid-after semantics.
  const stale = paidHostVerifier({ async verifyIdToken() { return token; }, async getUser() { return { ...current, tokensValidAfterTime: new Date(101000).toUTCString() } as UserRecord; } }, project);
  await assert.rejects(stale(request), /VERIFIED_ACCOUNT/);
});
test("validated session provider governs admission even with Google currently linked", async () => {
  for (const provider of ["anonymous", "custom", "github.com", undefined]) {
    const verify = paidHostVerifier({ async verifyIdToken() { return { ...token, firebase: { sign_in_provider: provider } } as DecodedIdToken; }, async getUser() { return current; } }, project);
    await assert.rejects(verify(request), /SESSION_INVALID/);
  }
  const google = paidHostVerifier({ async verifyIdToken() { return { ...token, firebase: { sign_in_provider: "google.com" } } as DecodedIdToken; }, async getUser() { return current; } }, project);
  assert.equal(await google(request), uid);
});
test("project UID claims current account malformed bearer and Auth outages fail closed", async () => {
  for (const patch of [{ aud: "wrong-project" }, { uid: "wrong-owner" }, { sub: "wrong-owner" }, { iss: "wrong-issuer" }, { auth_time: null }, { auth_time: "100" }, { auth_time: 0 }]) {
    const verify = paidHostVerifier({ async verifyIdToken() { return { ...token, ...patch } as DecodedIdToken; }, async getUser() { return current; } }, project);
    await assert.rejects(verify(request));
  }
  for (const patch of [{ disabled: true }, { email: "" }, { email: " " }, { email: undefined }, { emailVerified: false }, { tokensValidAfterTime: "invalid" }, { uid: "other" }, { providerData: [] }]) {
    const verify = paidHostVerifier({ async verifyIdToken() { return token; }, async getUser() { return { ...current, ...patch } as UserRecord; } }, project);
    await assert.rejects(verify(request), /VERIFIED_ACCOUNT/);
  }
  const outage = paidHostVerifier({ async verifyIdToken() { return token; }, async getUser() { throw new Error("Auth unavailable"); } }, project);
  await assert.rejects(outage(request), /SESSION_INVALID/);
  for (const authorization of [undefined, "", "Bearer", "Bearer token extra", "Basic token", "Bearer token\n"]) {
    let reads = 0;
    const verify = paidHostVerifier({ async verifyIdToken() { reads++; return token; }, async getUser() { return current; } }, project);
    await assert.rejects(verify({ ...request, rawRequest: { headers: { authorization } } })); assert.equal(reads, 0);
  }
});
