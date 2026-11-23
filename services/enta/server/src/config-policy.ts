export const APPROVED_HOSTED_PROJECT = "huroof-a3ee7";
export const HOSTED_RUNTIME_MARKERS = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "AWS_LAMBDA_FUNCTION_NAME", "K_SERVICE", "FUNCTIONS_WORKER_RUNTIME", "WEBSITE_SITE_NAME", "FLY_APP_NAME", "RENDER", "RAILWAY_ENVIRONMENT", "DYNO"] as const;
export const EMULATOR_KEYS = ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_DATABASE_EMULATOR_HOST", "FIREBASE_FUNCTIONS_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST", "PUBSUB_EMULATOR_HOST", "VITE_FIREBASE_AUTH_EMULATOR_PORT", "VITE_FIREBASE_FIRESTORE_EMULATOR_PORT", "VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT", "VITE_FIREBASE_STORAGE_EMULATOR_PORT"] as const;
export type ConfigEnvironment = Record<string, string | undefined>;
export function validNamespace(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value); }
export function isHosted(env: ConfigEnvironment): boolean { return env.NODE_ENV === "production" || HOSTED_RUNTIME_MARKERS.some(key => Boolean(env[key]?.trim())); }
export function assertHostedControls(env: ConfigEnvironment): void {
  if (!isHosted(env)) return;
  if (env.ENTA_ALLOW_DEV_MOCKS === "true" || env.ENTA_RUNTIME_MODE === "local" || env.VITE_USE_FIREBASE_EMULATORS === "true" || (env.VITE_GAME_RUNTIME !== undefined && env.VITE_GAME_RUNTIME !== "firebase") || EMULATOR_KEYS.some(key => Boolean(env[key]?.trim()))) throw new Error("HOSTED_MOCK_OR_EMULATOR_FORBIDDEN");
}
