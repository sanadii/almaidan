import type { User } from 'firebase/auth';
import { assertOwnerEpoch, ownerEpoch } from '../enta/auth-epoch';

/** This client is inactive until an independently qualified API is mounted. */
export async function studyPost(path: string, user: Pick<User, 'uid' | 'getIdToken'>, body: object, signal: AbortSignal): Promise<unknown> {
  if (!/^\/sessions(?:\/[a-f0-9-]{36}\/answers)?$/.test(path)) throw new Error('INVALID_STUDY_PATH');
  const epoch = ownerEpoch(user.uid); assertOwnerEpoch(epoch, signal);
  const token = await user.getIdToken(); assertOwnerEpoch(epoch, signal);
  const response = await fetch(`/api/v1/study${path}`, { signal, method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { accept: 'application/json', authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assertOwnerEpoch(epoch, signal);
  if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !response.body) throw new Error('STUDY_UNAVAILABLE');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 64_000) throw new Error('STUDY_RESPONSE_TOO_LARGE'); chunks.push(value); } } finally { reader.releaseLock(); }
  assertOwnerEpoch(epoch, signal); const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
