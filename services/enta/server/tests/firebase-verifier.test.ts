import assert from "node:assert/strict";
import { test } from "node:test";
import { firebaseTokenVerifier } from "../src/firebase-verifier";

const projectId = "new-enta-test-project";

test("Firebase token verifier checks revocation and refreshes current account verification", async () => {
  let revocationCheck: boolean | undefined;
  const verifier = firebaseTokenVerifier(projectId, {
    async verifyIdToken(_token: string, checkRevoked?: boolean) {
      revocationCheck = checkRevoked;
      return {
        aud: projectId,
        iss: `https://securetoken.google.com/${projectId}`,
        uid: "user-1",
        sub: "user-1",
        email: "stale@example.test",
        email_verified: true,
        firebase: { sign_in_provider: "google.com" },
      } as never;
    },
    async getUser(uid: string) {
      assert.equal(uid, "user-1");
      return { uid: "user-1", email: "current@example.test", emailVerified: false, disabled: false } as never;
    },
  } as never);
  const claims = await verifier("valid-token");
  assert.equal(revocationCheck, true);
  assert.equal(claims.email, "current@example.test");
  assert.equal(claims.email_verified, false);
  assert.deepEqual(claims.currentUser, { disabled: false, emailVerified: false, email: "current@example.test" });
});

test("Firebase verifier never falls back to token email when current email is absent and records disabled state", async () => {
  const verifier = firebaseTokenVerifier(projectId, {
    async verifyIdToken() {
      return {
        aud: projectId, iss: `https://securetoken.google.com/${projectId}`, uid: "user-2", sub: "user-2",
        email: "stale@example.test", email_verified: true, firebase: { sign_in_provider: "password" },
      } as never;
    },
    async getUser() { return { uid: "user-2", email: undefined, emailVerified: true, disabled: true } as never; },
  } as never);
  const claims = await verifier("valid-token");
  assert.equal(claims.email, undefined);
  assert.deepEqual(claims.currentUser, { disabled: true, emailVerified: true });
});

test("Firebase token verifier propagates revoked-token rejection and pins project", async () => {
  let revocationCheck: boolean | undefined;
  const revokedVerifier = firebaseTokenVerifier(projectId, {
    async verifyIdToken(_token: string, checkRevoked?: boolean) {
      revocationCheck = checkRevoked;
      throw new Error("id-token-revoked");
    },
    async getUser() { throw new Error("must not fetch user after token rejection"); },
  } as never);
  await assert.rejects(revokedVerifier("revoked-token"), /id-token-revoked/u);
  assert.equal(revocationCheck, true);

  const wrongProjectVerifier = firebaseTokenVerifier(projectId, {
    async verifyIdToken() {
      return { aud: "old-project", iss: "https://securetoken.google.com/old-project", uid: "u" } as never;
    },
    async getUser() { throw new Error("must not fetch user for a mismatched project"); },
  } as never);
  await assert.rejects(wrongProjectVerifier("wrong-project"), /FIREBASE_PROJECT_MISMATCH/u);
});


test("Firebase verifier rejects a mismatched current user UID", async () => {
  const verifier = firebaseTokenVerifier(projectId, {
    async verifyIdToken() { return { aud: projectId, iss: `https://securetoken.google.com/${projectId}`, uid: "expected" } as never; },
    async getUser() { return { uid: "different", disabled: false, emailVerified: true } as never; },
  } as never);
  await assert.rejects(verifier("token"), /FIREBASE_USER_MISMATCH/);
});
