/** Local presentation only; server authorization remains independent. */
export const isAlmaidanLocalDevelopment = (import.meta.env.DEV || (import.meta.env.MODE==='almaidan-local'&&import.meta.env.VITE_ALMAIDAN_LOCAL_BUILD==='true')) && ['127.0.0.1', 'localhost'].includes(window.location.hostname) &&
  import.meta.env.VITE_ALMAIDAN_LOCAL_ONLY === 'true' &&
  import.meta.env.VITE_FIREBASE_PROJECT_ID === 'demo-almaidan-local' &&
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' &&
  import.meta.env.VITE_GAME_RUNTIME === 'local';
export const isAlmaidanRealContent = isAlmaidanLocalDevelopment && import.meta.env.VITE_ALMAIDAN_REAL_CONTENT === 'true';
export const localContentNote = isAlmaidanRealContent ? 'أسئلة النسخة المحفوظة ومحتوى محلي مراجع للأنماط الخاصة. اللعب محلي دون مدفوعات.' : 'تدريب محلي مجاني؛ لا تُستخدم مدفوعات أو أرصدة حقيقية.';
