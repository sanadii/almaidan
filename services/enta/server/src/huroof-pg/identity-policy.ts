import { createHash } from "node:crypto";

/** Restricted bootstrap result, read from the active immutable policy head. */
export interface PolicyRow {
  namespace: string; revision: string; hash: string; raw: Uint8Array;
  projectId: string; issuer: string; audience: unknown;
}
export interface PolicyBinding {
  namespace: string; revision: string; hash: string; projectId: string;
  issuer: string; audience: string; clientProjectId: string;
}
/** v1 raw bytes are UTF-8 JSON with exactly these string-valued fields. */
export function validatePolicy(row: PolicyRow, expectedNamespace: string, expectedClientProjectId: string): PolicyBinding {
  if (!row || !(row.raw instanceof Uint8Array) || row.raw.byteLength<1 || row.raw.byteLength>65536 || row.namespace !== expectedNamespace || !/^[1-9][0-9]*$/.test(row.revision) || !/^[a-f0-9]{64}$/.test(row.hash) || createHash("sha256").update(row.raw).digest("hex") !== row.hash) throw new Error("POLICY_UNAVAILABLE");
  let value: unknown; let rawText: string;
  try { rawText = new TextDecoder("utf-8", { fatal: true }).decode(row.raw); value = JSON.parse(rawText); } catch { throw new Error("POLICY_UNAVAILABLE"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("POLICY_UNAVAILABLE");
  const p = value as Record<string, unknown>;
  const keys = ["schema", "namespace", "projectId", "issuer", "audience", "clientProjectId"];
  if (Object.keys(p).length !== keys.length || !keys.every(k => Object.hasOwn(p, k)) || p.schema !== "huroof-identity-policy-v1" || p.namespace !== row.namespace || typeof p.projectId !== "string" || !p.projectId || p.projectId !== row.projectId || p.clientProjectId !== expectedClientProjectId || p.clientProjectId !== p.projectId || p.audience !== p.projectId || p.issuer !== `https://securetoken.google.com/${p.projectId}` || p.issuer !== row.issuer || !row.audience || typeof row.audience !== "object" || Array.isArray(row.audience)) throw new Error("POLICY_UNAVAILABLE");
  if (JSON.stringify(p) !== rawText) throw new Error("POLICY_UNAVAILABLE");
  const audience = row.audience as Record<string, unknown>;
  if (Object.keys(audience).length !== 1 || audience.projectId !== p.audience) throw new Error("POLICY_UNAVAILABLE");
  return { namespace: row.namespace, revision: row.revision, hash: row.hash, projectId: p.projectId, issuer: p.issuer as string, audience: p.audience as string, clientProjectId: p.clientProjectId as string };
}


import { principalFromClaims, type IdTokenVerifier, type Principal } from "../identity";
export interface IdentityDependencies {
  readonly namespace: string;
  readonly clientProjectId: string;
  readActivePolicy(namespace: string): Promise<PolicyRow | null>;
  verifyToken: IdTokenVerifier;
  resolveIdentity(projectId: string, uid: string): Promise<string | null>;
}
export interface AuthenticatedContext { readonly principal: Principal; readonly identityId: string; readonly policy: PolicyBinding }
/** Token verifier must be the actual SDK-backed verifier in composition, not HTTP data. */
export async function authenticate(deps: IdentityDependencies, token: string): Promise<AuthenticatedContext> {
  if (!token) throw new Error("AUTH_REQUIRED");
  const row = await deps.readActivePolicy(deps.namespace);
  if (!row) throw new Error("POLICY_UNAVAILABLE");
  const policy = validatePolicy(row, deps.namespace, deps.clientProjectId);
  const claims = await deps.verifyToken(token);
  if (!claims.currentUser || claims.currentUser.disabled !== false) throw new Error("USER_UNAVAILABLE");
  const principal = principalFromClaims(claims, policy.projectId);
  const identityId = await deps.resolveIdentity(principal.projectId, principal.uid);
  if (!identityId) throw new Error("IDENTITY_UNAVAILABLE");
  return { principal, identityId, policy };
}
export function requireHosting(context: AuthenticatedContext): void {
  if (context.principal.anonymous || !context.principal.verifiedAccount) throw new Error("VERIFIED_ACCOUNT_REQUIRED");
}
