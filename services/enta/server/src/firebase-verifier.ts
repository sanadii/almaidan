// firebase-admin's jwks-rsa 4.x path is CommonJS and requires jose at runtime.
// Root package.json keeps that nested jose on its CommonJS-compatible 5.x line.
import { applicationDefault, cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { APPROVED_HOSTED_PROJECT, assertHostedControls, isHosted, validNamespace } from "./config-policy";
import type { FirebaseClaims, IdTokenVerifier } from "./identity";
import { loadRuntimeConfig } from "./runtime-config";
import { validatePolicy, type PolicyRow } from "./huroof-pg/identity-policy";

export function firebaseTokenVerifier(projectId: string, auth: Pick<Auth, "verifyIdToken" | "getUser">): IdTokenVerifier {
  return async (token) => {
    const decoded = await auth.verifyIdToken(token, true);
    // verifyIdToken checks signatures and standard claims; explicitly pin both
    // audience and issuer so project configuration drift fails closed as well.
    if (decoded.aud !== projectId || decoded.iss !== `https://securetoken.google.com/${projectId}`) {
      throw new Error("FIREBASE_PROJECT_MISMATCH");
    }
    const user = await auth.getUser(decoded.uid);
    if (user.uid !== decoded.uid) throw new Error("FIREBASE_USER_MISMATCH");
    return {
      ...decoded,
      uid: decoded.uid,
      // Current Admin SDK state is authoritative. Never fall back to stale
      // token email/verification when the account was changed or disabled.
      email: user.email ?? undefined,
      email_verified: user.emailVerified,
      currentUser: {
        disabled: user.disabled,
        emailVerified: user.emailVerified,
        ...(user.email ? { email: user.email } : {}),
      },
      firebase: decoded.firebase as FirebaseClaims["firebase"],
    };
  };
}

/** Pure configuration validation; performs no SDK initialization or policy read. */
function validateAdminConfiguration(projectId: string): ServiceAccount | undefined {
  if (!projectId) throw new Error("Explicit Firebase project ID required");
  assertHostedControls(process.env);
  if (isHosted(process.env) && (projectId !== APPROVED_HOSTED_PROJECT || process.env.FIREBASE_PROJECT_ID?.trim() !== projectId || process.env.VITE_FIREBASE_PROJECT_ID?.trim() !== projectId)) throw new Error("FIREBASE_ADMIN_PROJECT_MISMATCH");
  for (const key of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "FIREBASE_PROJECT", "FIREBASE_PROJECT_ID"]) {
    if (process.env[key]?.trim() && process.env[key]?.trim() !== projectId) throw new Error("FIREBASE_ADMIN_PROJECT_MISMATCH");
  }
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson === undefined) return undefined;
  let serviceAccount: ServiceAccount & { project_id?: unknown };
  try { serviceAccount = JSON.parse(serviceAccountJson) as ServiceAccount & { project_id?: unknown }; }
  catch { throw new Error("FIREBASE_ADMIN_CREDENTIAL_INVALID"); }
  if (!serviceAccount || typeof serviceAccount !== "object" || Array.isArray(serviceAccount)) throw new Error("FIREBASE_ADMIN_CREDENTIAL_INVALID");
  const aliases: unknown[] = [serviceAccount.project_id, serviceAccount.projectId];
  if (aliases.every(value => value === undefined)) throw new Error("FIREBASE_ADMIN_CREDENTIAL_PROJECT_MISMATCH");
  for (const value of aliases) {
    if (value !== undefined && (typeof value !== "string" || value !== projectId)) throw new Error("FIREBASE_ADMIN_CREDENTIAL_PROJECT_MISMATCH");
  }
  return serviceAccount;
}

function firebaseAdminAppForValidatedProject(projectId: string) {
  const serviceAccount = validateAdminConfiguration(projectId);
  const appName = `enta-${projectId}`;
  const existing = getApps().find((candidate) => candidate.name === appName);
  if (existing && existing.options.projectId !== projectId) throw new Error("FIREBASE_ADMIN_PROJECT_MISMATCH");
  let credential;
  try { credential = existing ? undefined : serviceAccount ? cert(serviceAccount) : applicationDefault(); }
  catch { throw new Error("FIREBASE_ADMIN_CREDENTIAL_INVALID"); }
  let app;
  try { app = existing ?? initializeApp({ projectId, credential }, appName); }
  catch { throw new Error("FIREBASE_ADMIN_INITIALIZATION_FAILED"); }
  if (app.options.projectId !== projectId) throw new Error("FIREBASE_ADMIN_PROJECT_MISMATCH");
  return app;
}

export function firebaseAdminAppForProject(projectId: string) {
  if (!projectId) throw new Error("Explicit Firebase project ID required");
  return firebaseAdminAppForValidatedProject(projectId);
}

/** Explicit server-only path: policy must come from the restricted active-head reader. */
export async function firebaseAdminAppForActivePolicy(namespace: string, clientProjectId: string, readActivePolicy: (namespace: string) => Promise<PolicyRow | null>) {
  if (!validNamespace(namespace)) throw new Error("POLICY_UNAVAILABLE");
  validateAdminConfiguration(clientProjectId);
  if (isHosted(process.env)) {
    const config = loadRuntimeConfig(process.env);
    if (config.namespaceId !== namespace || config.firebaseProjectId !== clientProjectId) throw new Error("POLICY_UNAVAILABLE");
  }
  const row = await readActivePolicy(namespace);
  if (!row) throw new Error("POLICY_UNAVAILABLE");
  const policy = validatePolicy(row, namespace, clientProjectId);
  return firebaseAdminAppForValidatedProject(policy.projectId);
}

export function firebaseAdminVerifier(projectId: string): IdTokenVerifier {
  return firebaseTokenVerifier(projectId, getAuth(firebaseAdminAppForProject(projectId)));
}
