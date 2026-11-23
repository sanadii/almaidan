import { APPROVED_HOSTED_PROJECT, HOSTED_RUNTIME_MARKERS, assertHostedControls, isHosted, validNamespace } from "./config-policy";
import { validatePolicy, type PolicyRow } from "./huroof-pg/identity-policy";
export type Environment = Record<string, string | undefined>;

export interface RuntimeConfig {
  environment: "development" | "test" | "production";
  firebaseProjectId: string;
  namespaceId: string;
  databaseUrl?: string;
  allowDevMocks: boolean;
  paymentProvider?: "tap" | "myfatoorah";
}

const DATABASE_NAME = "/almaidan";
const DATABASE_URL_ERROR = "DATABASE_URL must be a valid PostgreSQL URL for the almaidan database";
const DIRECT_URL_ERROR = "DIRECT_URL must be a valid PostgreSQL URL for the almaidan database";
const IDENTITY_QUERY_KEYS = new Set([
  "dbname", "database", "host", "hostaddr", "port", "user", "password", "options", "service", "servicefile",
]);

function validateDatabaseUrl(value: string, errorMessage: string): string {
  const url = value.trim();
  if (!url || /[\p{White_Space}\p{Cc}]/u.test(url) || /%(?![0-9A-Fa-f]{2})/u.test(url) ||
      url.includes("#") || url.includes("\\")) {
    throw new Error(errorMessage);
  }

  // Check the raw path before URL parsing, which normalizes dot segments.
  const rawParts = /^(postgres|postgresql):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?$/iu.exec(url);
  if (!rawParts || rawParts[3] !== DATABASE_NAME) throw new Error(errorMessage);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(errorMessage);
  }
  if ((parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") || !parsed.hostname) {
    throw new Error(errorMessage);
  }

  for (const key of new URLSearchParams(parsed.search).keys()) {
    if (IDENTITY_QUERY_KEYS.has(key.toLowerCase())) throw new Error(errorMessage);
  }
  return url;
}

export function assertLocalMockRuntime(env: Environment = process.env): void {
  const hostedRuntime = HOSTED_RUNTIME_MARKERS.some((key) => Boolean(env[key]?.trim()));
  const environment = env.NODE_ENV ?? "development";
  if (env.ENTA_ALLOW_DEV_MOCKS !== "true" || env.ENTA_RUNTIME_MODE !== "local" || hostedRuntime ||
      (environment !== "development" && environment !== "test")) {
    throw new Error("Development mocks require ENTA_RUNTIME_MODE=local on an unhosted development/test runtime");
  }
}

function loadRuntimeConfigForBinding(env: Environment): RuntimeConfig {
  const environment = env.NODE_ENV === "production"
    ? "production"
    : env.NODE_ENV === "test"
      ? "test"
      : "development";
  const firebaseProjectId = env.FIREBASE_PROJECT_ID?.trim() ?? "";
  if (!firebaseProjectId) throw new Error("FIREBASE_PROJECT_ID is required");
  const namespaceId = env.ENTA_NAMESPACE_ID?.trim() ?? "";
  if (!validNamespace(namespaceId)) throw new Error("ENTA_NAMESPACE_ID is required and must be a valid bounded namespace");
  assertHostedControls(env);

  const mockOptIn = env.ENTA_ALLOW_DEV_MOCKS === "true";
  if (mockOptIn) assertLocalMockRuntime(env);
  const allowDevMocks = mockOptIn;

  const suppliedDatabaseUrl = env.DATABASE_URL?.trim() || undefined;
  const databaseUrl = suppliedDatabaseUrl
    ? validateDatabaseUrl(suppliedDatabaseUrl, DATABASE_URL_ERROR)
    : undefined;
  const directUrl = env.DIRECT_URL?.trim() || undefined;
  if (directUrl) validateDatabaseUrl(directUrl, DIRECT_URL_ERROR);
  const configuredProvider = env.PAYMENT_PROVIDER?.trim().toLowerCase();
  const paymentProvider = configuredProvider === "tap" || configuredProvider === "myfatoorah"
    ? configuredProvider
    : undefined;

  if (isHosted(env)) {
    const webProjectId = env.VITE_FIREBASE_PROJECT_ID?.trim() ?? "";
    if (!webProjectId) throw new Error("VITE_FIREBASE_PROJECT_ID is required in production");
    if (firebaseProjectId !== APPROVED_HOSTED_PROJECT || webProjectId !== APPROVED_HOSTED_PROJECT) throw new Error("Hosted Firebase project must match the approved project");
    if (webProjectId !== firebaseProjectId) throw new Error("VITE_FIREBASE_PROJECT_ID must match FIREBASE_PROJECT_ID in production");
    if (!databaseUrl) throw new Error("DATABASE_URL is required in production");
    if (!paymentProvider) throw new Error("PAYMENT_PROVIDER must select a live provider in production");
    const hasProviderCredential = paymentProvider === "tap"
      ? Boolean(env.TAP_SECRET_KEY?.trim())
      : Boolean(env.MYFATOORAH_API_KEY?.trim());
    if (!hasProviderCredential) throw new Error(`Live ${paymentProvider} configuration is required in production`);
  } else if ((!databaseUrl || !paymentProvider) && !allowDevMocks && environment !== "test") {
    throw new Error("Configure Firebase, PostgreSQL, and a payment provider, or explicitly enable ENTA_ALLOW_DEV_MOCKS for local development");
  }

  return { environment, firebaseProjectId, namespaceId, databaseUrl, allowDevMocks, paymentProvider };
}

export function loadRuntimeConfig(env: Environment = process.env): RuntimeConfig {
  return loadRuntimeConfigForBinding(env);
}

/** Explicit server-only policy path; the reader must be the restricted active-head dependency. */
export async function loadRuntimeConfigForActivePolicy(env: Environment, readActivePolicy: (namespace: string) => Promise<PolicyRow | null>): Promise<RuntimeConfig> {
  assertHostedControls(env);
  const namespace = env.ENTA_NAMESPACE_ID?.trim() ?? "";
  const project = env.FIREBASE_PROJECT_ID?.trim() ?? "";
  const client = env.VITE_FIREBASE_PROJECT_ID?.trim() ?? "";
  if (!validNamespace(namespace) || !project || !client || project !== client || (isHosted(env) && project !== APPROVED_HOSTED_PROJECT)) throw new Error("POLICY_UNAVAILABLE");
  if (env.ENTA_ALLOW_DEV_MOCKS === "true") throw new Error("POLICY_MOCKS_FORBIDDEN");
  const config = loadRuntimeConfigForBinding(env);
  const row = await readActivePolicy(namespace);
  if (!row) throw new Error("POLICY_UNAVAILABLE");
  const policy = validatePolicy(row, namespace, client);
  if (policy.projectId !== project) throw new Error("POLICY_UNAVAILABLE");
  return config;
}

export function assertLiveGatewayConfigured(env: Environment = process.env): "tap" | "myfatoorah" {
  const provider = env.PAYMENT_PROVIDER?.trim().toLowerCase();
  if (provider === "tap" && env.TAP_SECRET_KEY?.trim()) return "tap";
  if (provider === "myfatoorah" && env.MYFATOORAH_API_KEY?.trim()) return "myfatoorah";
  throw new Error("A configured live payment gateway is required");
}
