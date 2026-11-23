import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app";
import { createPrismaIdentityStore, principalFromClaims, type FirebaseClaims, type IdentityStore } from "../src/identity";
import type { RuntimeConfig } from "../src/runtime-config";

const projectId = "new-enta-test-project";
const config: RuntimeConfig = {
  environment: "test",
  firebaseProjectId: projectId,
  namespaceId: "maydan-test-namespace",
  allowDevMocks: false,
};

function claims(uid: string, provider: string, verified = false, aud = projectId): FirebaseClaims {
  return {
    aud,
    iss: `https://securetoken.google.com/${aud}`,
    sub: uid,
    uid,
    email: verified ? `${uid}@example.test` : undefined,
    email_verified: verified,
    ...(verified ? { currentUser: { disabled: false, emailVerified: true, email: `${uid}@example.test` } } : {}),
    firebase: { sign_in_provider: provider },
    role: "ADMIN",
    name: "Client supplied administrator",
  };
}

test("Firebase project, verified account, admin scope, and legacy route boundaries", async (t) => {
  const scopeRows = new Map<string, string[]>([[`${projectId}:scoped-admin`, ["content:read"]]]);
  const linked = new Set<string>();
  let adminReads = 0;
  const identityStore: IdentityStore = {
    async assertDeploymentNamespace(namespaceId, pid) {
      if (namespaceId !== config.namespaceId || pid !== projectId) throw new Error("namespace mismatch");
    },
    async upsertIdentity(pid, uid) { linked.add(`${pid}:${uid}`); },
    async getAdminScopes(pid, uid) {
      adminReads += 1;
      return scopeRows.get(`${pid}:${uid}`) ?? [];
    },
  };
  const tokenClaims = new Map<string, FirebaseClaims>([
    ["guest", claims("guest-1", "anonymous")],
    ["unverified", claims("unverified-1", "password", false)],
    ["verified-email", claims("verified-email-1", "password", true)],
    ["verified", claims("verified-1", "google.com", true)],
    ["scoped-admin", claims("scoped-admin", "password", true)],
    ["wrong-project", claims("foreign-1", "google.com", true, "old-enta-project")],
  ]);
  const app = createApp({
    config,
    verifyIdToken: async (token) => {
      const found = tokenClaims.get(token);
      if (!found) throw new Error("bad token");
      return found;
    },
    identityStore,
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const account = async (token: string, method = "GET", body?: unknown) => fetch(`${origin}/api/v1/account`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const health = await fetch(`${origin}/api/v1/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("cache-control"), "no-store");
  assert.deepEqual(await health.json(), { ok: true, service: "enta", apiVersion: 1 });

  assert.equal((await fetch(`${origin}/api/v1/account`)).status, 401);
  assert.equal((await account("wrong-project")).status, 401);

  const guest = await account("guest");
  assert.equal(guest.status, 200);
  const guestCapabilities = (await guest.json() as { capabilities: Record<string, unknown> }).capabilities;
  assert.equal(guestCapabilities.canJoin, true);
  assert.equal(guestCapabilities.canHost, false);
  assert.equal(guestCapabilities.canClaimFreeGrant, false);
  assert.equal(guestCapabilities.canCheckout, false);
  assert.deepEqual(guestCapabilities.adminScopes, []);
  assert.equal((await account("guest", "POST")).status, 403);

  const unverified = await account("unverified");
  assert.equal(unverified.status, 200);
  const unverifiedCapabilities = (await unverified.json() as { capabilities: { canHost: boolean; adminScopes: string[] } }).capabilities;
  assert.equal(unverifiedCapabilities.canHost, false);
  assert.deepEqual(unverifiedCapabilities.adminScopes, []);

  const verifiedEmail = await account("verified-email");
  assert.equal((await verifiedEmail.json() as { capabilities: { canHost: boolean } }).capabilities.canHost, true);

  const verified = await account("verified");
  assert.equal(verified.status, 200);
  const verifiedCapabilities = (await verified.json() as { capabilities: Record<string, unknown> }).capabilities;
  assert.equal(verifiedCapabilities.canHost, true);
  assert.equal(verifiedCapabilities.canClaimFreeGrant, true);
  assert.equal(verifiedCapabilities.canCheckout, true);
  const linkedResponse = await account("verified", "POST", { userId: "attacker-selected", role: "ADMIN" });
  assert.equal(linkedResponse.status, 200);
  assert.deepEqual(await linkedResponse.json(), {
    uid: "verified-1", projectId, identityRegistered: true,
  });
  assert.ok(linked.has(`${projectId}:verified-1`));
  assert.ok(!linked.has(`${projectId}:attacker-selected`));

  const fakeRole = await account("verified");
  assert.deepEqual((await fakeRole.json() as { capabilities: { adminScopes: string[] } }).capabilities.adminScopes, []);
  const scoped = await account("scoped-admin");
  assert.deepEqual((await scoped.json() as { capabilities: { adminScopes: string[] } }).capabilities.adminScopes, ["content:read"]);
  assert.equal(adminReads, 4, "only verified principals may read admin scopes; scopes are reread per verified request");

  for (const path of [
    "/api/auth/login", "/api/auth/guest", "/api/guest", "/api/games", "/api/rooms", "/api/answers",
    "/api/admin", "/api/payments/checkout", "/api/v1/admin/users",
  ]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 404, `${path} is not mounted`);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/u);
  }
  const deepLink = await fetch(`${origin}/a-client-side-route`);
  assert.equal(deepLink.status, 404);
  assert.match(deepLink.headers.get("content-type") ?? "", /application\/json/u);
});

test("identity upsert uses the project and UID composite key concurrently", async () => {
  const calls: unknown[] = [];
  const fakePrisma = {
    deploymentNamespace: { async findUnique() { return null; } },
    firebaseIdentity: {
      async upsert(args: unknown) { calls.push(args); return { id: "mapped" }; },
    },
  };
  const store = createPrismaIdentityStore(fakePrisma as never);
  await Promise.all(Array.from({ length: 12 }, () => store.upsertIdentity(projectId, "same-uid")));
  assert.equal(calls.length, 12);
  for (const call of calls) {
    assert.deepEqual(call, {
      where: { firebaseProjectId_firebaseUid: { firebaseProjectId: projectId, firebaseUid: "same-uid" } },
      create: { firebaseProjectId: projectId, firebaseUid: "same-uid" },
      update: {},
      select: { id: true },
    });
  }
});

test("Prisma namespace guard requires the exact provisioned singleton marker", async () => {
  let marker: { namespaceId: string; firebaseProjectId: string } | null = null;
  let query: unknown;
  const fakePrisma = {
    deploymentNamespace: {
      async findUnique(args: unknown) { query = args; return marker; },
    },
    firebaseIdentity: { async upsert() { return { id: "unused" }; } },
    firebaseAdminScope: { async findMany() { return []; } },
  };
  const store = createPrismaIdentityStore(fakePrisma as never);
  await assert.rejects(store.assertDeploymentNamespace(config.namespaceId, projectId), /DEPLOYMENT_NAMESPACE_MISMATCH/u);
  marker = { namespaceId: "wrong-namespace", firebaseProjectId: projectId };
  await assert.rejects(store.assertDeploymentNamespace(config.namespaceId, projectId), /DEPLOYMENT_NAMESPACE_MISMATCH/u);
  marker = { namespaceId: config.namespaceId, firebaseProjectId: "old-project" };
  await assert.rejects(store.assertDeploymentNamespace(config.namespaceId, projectId), /DEPLOYMENT_NAMESPACE_MISMATCH/u);
  marker = { namespaceId: config.namespaceId, firebaseProjectId: projectId };
  await store.assertDeploymentNamespace(config.namespaceId, projectId);
  assert.deepEqual(query, { where: { id: "singleton" } });
});

test("API fails closed before health, account, and JSON parsing when its namespace marker is missing or wrong", async (t) => {
  let marker: { namespaceId: string; firebaseProjectId: string } | null = null;
  let apiResponses = 0;
  const identityStore: IdentityStore = {
    async assertDeploymentNamespace(namespaceId, firebaseProjectId) {
      if (!marker || marker.namespaceId !== namespaceId || marker.firebaseProjectId !== firebaseProjectId) {
        throw new Error("DEPLOYMENT_NAMESPACE_MISMATCH");
      }
    },
    async upsertIdentity() {},
    async getAdminScopes() { return []; },
  };
  const app = createApp({
    config,
    verifyIdToken: async () => { throw new Error("revoked token"); },
    identityStore: {
      ...identityStore,
      async assertDeploymentNamespace(namespaceId, firebaseProjectId) {
        await identityStore.assertDeploymentNamespace(namespaceId, firebaseProjectId);
        apiResponses += 1;
      },
    },
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  for (const request of [
    fetch(`${origin}/api/v1/health`),
    fetch(`${origin}/api/v1/account`, { headers: { authorization: "Bearer revoked" } }),
    fetch(`${origin}/api/v1/account`, { method: "POST", headers: { authorization: "Bearer revoked", "content-type": "application/json" }, body: "{" }),
  ]) {
    const response = await request;
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "SERVICE_NAMESPACE_UNAVAILABLE" });
  }
  assert.equal(apiResponses, 0, "no protected route executes before an exact namespace marker is present");

  marker = { namespaceId: config.namespaceId, firebaseProjectId: "old-project" };
  assert.equal((await fetch(`${origin}/api/v1/health`)).status, 503);
  marker = { namespaceId: config.namespaceId, firebaseProjectId: projectId };
  assert.equal((await fetch(`${origin}/api/v1/health`)).status, 200);
  const revoked = await fetch(`${origin}/api/v1/account`, { headers: { authorization: "Bearer revoked" } });
  assert.equal(revoked.status, 401);
  assert.deepEqual(await revoked.json(), { error: "INVALID_ID_TOKEN" });
});

test("Firebase project checks reject wrong audience or issuer", () => {
  assert.equal(principalFromClaims({ ...claims("same-uid", "google.com", true), currentUser: { disabled: false, emailVerified: true, email: "current@example.test" } }, projectId).verifiedAccount, true);
  assert.throws(() => principalFromClaims(claims("same-uid", "google.com", true, "another-project"), projectId), /FIREBASE_PROJECT_MISMATCH/u);
  assert.throws(() => principalFromClaims({ ...claims("same-uid", "google.com", true), iss: "https://securetoken.google.com/old-project" }, projectId), /FIREBASE_PROJECT_MISMATCH/u);
});

test("development and Vercel route `/api/v1` ahead of the existing API and SPA", async () => {
  const vite = await readFile(resolve("vite.config.ts"), "utf8");
  const vercel = JSON.parse(await readFile(resolve("vercel.json"), "utf8")) as {
    functions?: Record<string, unknown>;
    rewrites?: Array<{ source: string; destination: string }>;
  };
  assert.ok(vite.indexOf("'/api/v1'") < vite.indexOf("'/api'"), "the versioned API proxy precedes the Huroof API proxy");
  assert.ok(vercel.functions?.["api/index.ts"], "Vercel has a static filesystem API function");
  assert.deepEqual(vercel.rewrites?.[0], {
    source: "/api/(.*)",
    destination: "/api/index?__api_path=$1",
  }, "the API rewrite targets the function and captures the original path first");
  assert.equal(vercel.rewrites?.at(-1)?.destination, "/index.html", "SPA fallback runs after filesystem function routes");
});
