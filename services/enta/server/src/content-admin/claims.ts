import type { Auth, UserRecord } from "firebase-admin/auth";
import { firebaseTokenVerifier } from "../firebase-verifier";
import { principalFromClaims } from "../identity";
import { validatePolicy, type PolicyRow } from "../huroof-pg/identity-policy";

export const ADMIN_ROLES = ["super_admin", "content_admin", "reviewer", "game_ops", "viewer"] as const;
export type AdminRole = typeof ADMIN_ROLES[number];
export interface VerifiedAdminClaims {
  readonly namespace: string; readonly projectId: string; readonly uid: string;
  readonly identityId: string; readonly claimRoles: readonly AdminRole[];
  readonly claimAuthzVersion: number; readonly provider: "password" | "google.com";
  readonly policyRevision: string; readonly policyHash: string;
}
export interface AdminClaimsDependencies {
  readonly namespace: string; readonly clientProjectId: string;
  readonly readActivePolicy: (namespace: string) => Promise<PolicyRow | null>;
  readonly resolveIdentity: (projectId: string, uid: string) => Promise<string | null>;
  readonly auth: Pick<Auth, "verifyIdToken" | "getUser">;
}
/** Unmounted: only the real SDK verifier supplies decoded token and current user. */
export async function authenticateAdmin(deps: AdminClaimsDependencies, token: string): Promise<VerifiedAdminClaims> {
  if (!token || token.length > 16384) throw new Error("AUTH_REQUIRED");
  const row = await deps.readActivePolicy(deps.namespace);
  if (!row) throw new Error("POLICY_UNAVAILABLE");
  const policy = validatePolicy(row, deps.namespace, deps.clientProjectId);
  let current: UserRecord | undefined;
  const auth: Pick<Auth, "verifyIdToken" | "getUser"> = {
    verifyIdToken: (value, checkRevoked) => deps.auth.verifyIdToken(value, checkRevoked),
    getUser: async uid => { const user = await deps.auth.getUser(uid); current = user; return user; },
  };
  const claims = await firebaseTokenVerifier(policy.projectId, auth)(token);
  const principal = principalFromClaims(claims, policy.projectId);
  const provider = claims.firebase?.sign_in_provider;
  if (!principal.verifiedAccount || (provider !== "password" && provider !== "google.com") ||
      !current || current.uid !== principal.uid || current.disabled || !current.emailVerified ||
      !current.providerData.some(item => item.providerId === provider)) throw new Error("ADMIN_IDENTITY_UNAVAILABLE");
  const roles = claims.adminRoles;
  if (!Array.isArray(roles) || roles.length < 1 || roles.length > ADMIN_ROLES.length ||
      roles.some(role => typeof role !== "string" || !ADMIN_ROLES.includes(role as AdminRole)) ||
      new Set(roles).size !== roles.length || roles.some((role, i) => i > 0 && roles[i - 1] >= role)) throw new Error("ADMIN_CLAIMS_INVALID");
  const version = claims.authzVersion;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) throw new Error("ADMIN_CLAIMS_INVALID");
  const identityId = await deps.resolveIdentity(policy.projectId, principal.uid);
  if (!identityId || identityId.length > 200) throw new Error("IDENTITY_UNAVAILABLE");
  return { namespace: policy.namespace, projectId: policy.projectId, uid: principal.uid, identityId,
    claimRoles: roles as AdminRole[], claimAuthzVersion: version, provider,
    policyRevision: policy.revision, policyHash: policy.hash };
}
