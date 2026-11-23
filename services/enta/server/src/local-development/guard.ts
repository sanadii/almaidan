import { HOSTED_RUNTIME_MARKERS } from '../config-policy';

export const LOCAL_PROJECT = 'demo-almaidan-local';
export function assertLocalDevelopment(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ALMAIDAN_LOCAL_ONLY !== 'true' || env.ENTA_RUNTIME_MODE !== 'local' || !['development', 'test'].includes(env.NODE_ENV ?? '') || HOSTED_RUNTIME_MARKERS.some(k => Boolean(env[k])) || env.FIREBASE_PROJECT_ID !== LOCAL_PROJECT || env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:19099') throw new Error('LOCAL_DEVELOPMENT_ONLY');
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_SERVICE_ACCOUNT_JSON','TAP_SECRET_KEY','MYFATOORAH_API_KEY','PAYMENT_PROVIDER']) if (env[key]) throw new Error('LOCAL_CREDENTIALS_FORBIDDEN');
  const raw = env.DATABASE_URL ?? '';
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('LOCAL_DATABASE_REQUIRED'); }
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '15439' || url.pathname !== '/almaidan' || url.search || url.hash || !url.username || !url.password) throw new Error('LOCAL_DATABASE_REQUIRED');
  return raw;
}
