import { getApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken, type UserRecord } from "firebase-admin/auth";
import { HttpsError } from "firebase-functions/https";
import { admissionProject } from "./paid-admission.js";

interface PaidHostRequest {
  auth?: { uid: string } | null;
  rawRequest: { headers: { authorization?: string } };
}
type PaidHostAuth = Pick<ReturnType<typeof getAuth>, "verifyIdToken" | "getUser">;

/** The dependency seam is used by production-shaped tests; callers cannot select it. */
export function paidHostVerifier(auth: PaidHostAuth, projectId: string) {
  return async (request: PaidHostRequest): Promise<string> => {
    const authorization = request.rawRequest?.headers?.authorization;
    const bearer = typeof authorization === "string" ? /^Bearer ([^\s]+)$/iu.exec(authorization)?.[1] : undefined;
    if (!request.auth?.uid || !bearer) throw new HttpsError("unauthenticated", "PAID_HOST_SESSION_REQUIRED");
    let token: DecodedIdToken;
    let current: UserRecord;
    try {
      // Callable middleware defaults to checkRevoked=false outside emulators.
      token = await auth.verifyIdToken(bearer, true);
      if (token.uid !== request.auth.uid || token.sub !== request.auth.uid || token.aud !== projectId ||
          token.iss !== `https://securetoken.google.com/${projectId}` ||
          !Number.isSafeInteger(token.auth_time) || token.auth_time <= 0 ||
          !["password", "google.com"].includes(token.firebase?.sign_in_provider))
        throw new Error("INVALID_PAID_HOST_SESSION");
      current = await auth.getUser(token.uid);
    } catch {
      throw new HttpsError("permission-denied", "PAID_HOST_SESSION_INVALID");
    }
    const validAfter = Date.parse(current.tokensValidAfterTime ?? "");
    if (current.uid !== token.uid || !Number.isFinite(validAfter) || token.auth_time * 1000 < validAfter ||
        current.disabled || current.emailVerified !== true || typeof current.email !== "string" || !current.email.trim() ||
        !current.providerData.some((provider) => ["password", "google.com"].includes(provider.providerId)))
      throw new HttpsError("permission-denied", "VERIFIED_ACCOUNT_REQUIRED");
    return token.uid;
  };
}

export async function assertCurrentPaidHost(request: PaidHostRequest): Promise<string> {
  const projectId = admissionProject(), app = getApp();
  if (app.options.projectId !== projectId) throw new HttpsError("failed-precondition", "FIREBASE_ADMIN_PROJECT_MISMATCH");
  return paidHostVerifier(getAuth(app), projectId)(request);
}
