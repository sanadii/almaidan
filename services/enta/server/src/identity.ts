import type { FirebaseAdminScope, PrismaClient } from "@prisma/client";
import type { RuntimeConfig } from "./runtime-config";

export interface FirebaseClaims {
  aud: string;
  iss: string;
  sub: string;
  uid?: string;
  email?: string;
  email_verified?: boolean;
  /** Server-added current Admin SDK user state; never trusted from token claims. */
  currentUser?: { disabled: boolean; emailVerified: boolean; email?: string };
  firebase?: { sign_in_provider?: string };
  [claim: string]: unknown;
}

export interface Principal {
  projectId: string;
  uid: string;
  anonymous: boolean;
  verifiedAccount: boolean;
  email?: string;
}

export interface IdentityStore {
  assertDeploymentNamespace(namespaceId: string, firebaseProjectId: string): Promise<void>;
  upsertIdentity(projectId: string, uid: string): Promise<void>;
  getAdminScopes(projectId: string, uid: string): Promise<string[]>;
}

export type IdTokenVerifier = (token: string) => Promise<FirebaseClaims>;

export function principalFromClaims(claims: FirebaseClaims, projectId: string): Principal {
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  const uid = typeof claims.uid === "string" ? claims.uid : claims.sub;
  if (claims.aud !== projectId || claims.iss !== expectedIssuer || !uid || claims.sub !== uid) {
    throw new Error("FIREBASE_PROJECT_MISMATCH");
  }
  const provider = claims.firebase?.sign_in_provider;
  const anonymous = provider === "anonymous";
  const verifiedProvider = provider === "password" || provider === "google.com";
  const currentEmail = claims.currentUser?.email?.trim();
  const verifiedAccount = !anonymous
    && verifiedProvider
    && claims.currentUser?.disabled === false
    && claims.currentUser.emailVerified === true
    && Boolean(currentEmail);
  return {
    projectId,
    uid,
    anonymous,
    verifiedAccount,
    ...(verifiedAccount && currentEmail ? { email: currentEmail } : {}),
  };
}

export function createPrismaIdentityStore(prisma: PrismaClient): IdentityStore {
  return {
    async assertDeploymentNamespace(namespaceId, firebaseProjectId) {
      const marker = await prisma.deploymentNamespace.findUnique({ where: { id: "singleton" } });
      if (!marker || marker.namespaceId !== namespaceId || marker.firebaseProjectId !== firebaseProjectId) {
        throw new Error("DEPLOYMENT_NAMESPACE_MISMATCH");
      }
    },
    async upsertIdentity(projectId, uid) {
      await prisma.firebaseIdentity.upsert({
        where: { firebaseProjectId_firebaseUid: { firebaseProjectId: projectId, firebaseUid: uid } },
        create: { firebaseProjectId: projectId, firebaseUid: uid },
        update: {},
        select: { id: true },
      });
    },
    async getAdminScopes(projectId, uid) {
      const rows: Pick<FirebaseAdminScope, "scope">[] = await prisma.firebaseAdminScope.findMany({
        where: { firebaseProjectId: projectId, firebaseUid: uid },
        select: { scope: true },
      });
      return rows.map((row) => row.scope);
    },
  };
}

export function createInMemoryIdentityStore(namespaceId: string, firebaseProjectId: string): IdentityStore {
  const identities = new Set<string>();
  const grants = new Map<string, Set<string>>();
  const key = (projectId: string, uid: string) => `${projectId}\u0000${uid}`;
  return {
    async assertDeploymentNamespace(expectedNamespaceId, expectedFirebaseProjectId) {
      if (expectedNamespaceId !== namespaceId || expectedFirebaseProjectId !== firebaseProjectId) {
        throw new Error("DEPLOYMENT_NAMESPACE_MISMATCH");
      }
    },
    async upsertIdentity(projectId, uid) { identities.add(key(projectId, uid)); },
    async getAdminScopes(projectId, uid) {
      if (!identities.has(key(projectId, uid))) return [];
      return [...(grants.get(key(projectId, uid)) ?? [])];
    },
  };
}

export function requireVerifiedAccount(principal: Principal): void {
  if (!principal.verifiedAccount) throw new Error("VERIFIED_ACCOUNT_REQUIRED");
}

export function localMockVerifier(config: RuntimeConfig): IdTokenVerifier {
  if (config.environment === "production" || !config.allowDevMocks) {
    throw new Error("Local mock authentication is disabled");
  }
  return async (token) => {
    const [prefix, uid, state] = token.split(":");
    if (prefix !== "dev" || !uid || !["anonymous", "verified", "unverified"].includes(state ?? "")) {
      throw new Error("INVALID_LOCAL_DEV_TOKEN");
    }
    const provider = state === "anonymous" ? "anonymous" : state === "verified" ? "google.com" : "password";
    return {
      aud: config.firebaseProjectId,
      iss: `https://securetoken.google.com/${config.firebaseProjectId}`,
      sub: uid,
      uid,
      ...(state === "anonymous" ? {} : {
        email: `${uid}@example.invalid`,
        email_verified: state === "verified",
        currentUser: { disabled: false, emailVerified: state === "verified", email: `${uid}@example.invalid` },
      }),
      firebase: { sign_in_provider: provider },
    };
  };
}
