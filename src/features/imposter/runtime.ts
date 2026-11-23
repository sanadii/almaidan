import { isAlmaidanLocalDevelopment } from '../../lib/local-development';
import type { Intent, Projection } from './contracts';

export type Session = { roomId: string; roomCode: string; token?: string; uid?: string };
export type Snapshot = { roomId: string; projection: Projection; serverTime: number };
type Joined = Snapshot & Session;
export type Command = Intent extends infer T ? T extends Intent ? Omit<T, 'requestId' | 'phaseId'> : never : never;
export type Resolution = { gameKind: 'imposter' | 'huroof' | 'categories'; joinable: boolean };

// Hosted play stays closed until Almaidan's existing admission contract supports this game.
export const imposterRuntimeKind = () => isAlmaidanLocalDevelopment ? 'local' as const : 'fixture' as const;
const sessionKey = (code: string) => `imposter:session:${code}`;
export function saveSession(session: Session) { sessionStorage.setItem(sessionKey(session.roomCode), JSON.stringify({ roomId: session.roomId, roomCode: session.roomCode, token: session.token, uid: session.uid })); }
export function loadSession(code: string): Session | undefined {
  try { const value = JSON.parse(sessionStorage.getItem(sessionKey(code)) ?? 'null') as Session | null; return value && typeof value.roomId === 'string' && value.roomCode === code ? value : undefined; } catch { return undefined; }
}
export function clearSession(code: string) { sessionStorage.removeItem(sessionKey(code)); }

async function local<T>(path: string, data: unknown, token?: string): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data), cache: 'no-store' });
  if (!response.ok) { const value = await response.json().catch(() => ({})) as { error?: string }; throw new Error(value.error ?? `HTTP_${response.status}`); }
  return response.json() as Promise<T>;
}
function playable() { if (imposterRuntimeKind() !== 'local') throw new Error('IMPOSTER_LOCAL_ONLY'); }

export async function resolveRoom(roomCode: string): Promise<Resolution> {
  playable();
  return local(`/api/imposter/resolve/${encodeURIComponent(roomCode)}`, {});
}
export async function createImposterRoom(displayName: string): Promise<Joined> {
  playable();
  const { getOptionalFirebaseAuth } = await import('../../lib/firebase/client');
  const auth = getOptionalFirebaseAuth();
  if (!auth) throw new Error('VERIFIED_HOST_REQUIRED');
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user || user.isAnonymous || !user.emailVerified) throw new Error('VERIFIED_HOST_REQUIRED');
  const joined = await local<Joined>('/api/imposter/rooms', { displayName }, await user.getIdToken());
  saveSession(joined); return joined;
}
export async function joinImposterRoom(roomCode: string, displayName: string): Promise<Joined> {
  playable();
  const joined = await local<Joined>(`/api/imposter/rooms/${encodeURIComponent(roomCode)}/join`, { displayName });
  saveSession({ ...joined, roomCode }); return joined;
}
export async function resumeImposterRoom(session: Session): Promise<Snapshot> {
  playable(); return local(`/api/imposter/rooms/${encodeURIComponent(session.roomId)}/resume`, {}, session.token);
}
export async function syncImposterRoom(session: Session): Promise<Snapshot> {
  playable(); return local(`/api/imposter/rooms/${encodeURIComponent(session.roomId)}/sync`, {}, session.token);
}
export async function submitImposterIntent(session: Session, projection: Projection, command: Command, requestId = crypto.randomUUID()): Promise<Snapshot> {
  playable();
  const intent: Intent = { ...command, phaseId: projection.phaseId, requestId };
  return local(`/api/imposter/rooms/${encodeURIComponent(session.roomId)}/intents`, intent, session.token);
}

export function subscribeImposterRoom(session: Session, onSnapshot: (value: Snapshot) => void, onConnection: (connected: boolean) => void, onError: (error: Error) => void): () => void {
  let stopped = false;
  let dispose: (() => void) | undefined;
  if (imposterRuntimeKind() !== 'local') { onError(new Error('IMPOSTER_LOCAL_ONLY')); return () => { stopped = true; }; }
  {
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const open = () => {
      if (stopped) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/imposter?roomId=${encodeURIComponent(session.roomId)}&token=${encodeURIComponent(session.token ?? '')}`);
      socket.addEventListener('open', () => { attempt = 0; });
      socket.addEventListener('message', event => { if (!stopped) { try {
        const value = JSON.parse(String(event.data)) as Snapshot;
        if (value.roomId !== session.roomId || value.projection?.gameKind !== 'imposter' || !Number.isFinite(value.serverTime) || !Number.isFinite(value.projection.revision)) throw new Error('INVALID_SNAPSHOT');
        onSnapshot(value);
      } catch { onConnection(false); onError(new Error('INVALID_SNAPSHOT')); } } });
      socket.addEventListener('close', () => { if (!stopped) { onConnection(false); retry = setTimeout(open, Math.min(1_000 * 2 ** attempt++, 10_000)); } });
      socket.addEventListener('error', () => { if (!stopped) onConnection(false); });
    };
    open(); dispose = () => { clearTimeout(retry); socket?.close(); };
  }
  return () => { stopped = true; dispose?.(); };
}

const errors: Record<string, string> = {
  IMPOSTER_LOCAL_ONLY: 'الدخيل متاح في نسخة الميدان المحلية. اللعب المستضاف غير مفعّل حالياً.',
  VERIFIED_HOST_REQUIRED: 'سجّل الدخول بحساب موثّق لإنشاء غرفة الدخيل.',
  IMPOSTER_PREVIEW_ONLY: 'هذه معاينة فقط. اللعب متاح عند تشغيل الخادم المحلي أو Firebase.',
  ROOM_NOT_FOUND: 'لم نجد هذه الغرفة. تحقق من الرمز.',
  ROOM_FULL: 'اكتملت الغرفة؛ الحد الأقصى ٨ لاعبين.',
  DUPLICATE_NAME: 'هذا الاسم مستخدم. اختر اسماً آخر.',
  ROUND_ACTIVE: 'بدأت الجولة. انتظر الجولة التالية للانضمام.',
  JOIN_LOCKED: 'بدأت الجولة. انتظر الجولة التالية للانضمام.',
  INVALID_NAME: 'أدخل اسماً صالحاً من ١ إلى ٤٨ حرفاً.',
  INVALID_CLUE: 'اكتب كلمة واحدة من الحروف فقط، دون مسافات، وبحد أقصى ٤٠ حرفاً.',
  INVALID_GUESS: 'أدخل تخمينك أولاً.',
  STALE_PHASE: 'انتقلت الجولة إلى مرحلة جديدة. راجع الشاشة ثم حاول مجدداً.',
  NOT_YOUR_TURN: 'انتظر دورك.',
  NOT_TURN: 'انتظر دورك.',
  ALREADY_VOTED: 'تم تثبيت صوتك بالفعل.',
  CONTENT_EXHAUSTED: 'انتهت الكلمات المتاحة. اختر فئات أخرى أو أنشئ غرفة جديدة.',
};
export function imposterError(error: unknown) { const detail = error instanceof Error ? error.message : ''; const key = Object.keys(errors).find(code => detail.includes(code)); return key ? errors[key] : 'تعذر إتمام الطلب. تحقق من الاتصال وأعد المحاولة.'; }
