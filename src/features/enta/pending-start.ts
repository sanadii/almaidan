import {verifyLocalRematchCompletion} from './local-rematch-client';
import { isAlmaidanLocalDevelopment } from '../../lib/local-development';
import { roomRequest } from './room-client';
import type { User } from 'firebase/auth';
import { ownerEpoch, isOwnerEpoch } from './auth-epoch';
import { EntaClientError, matchEnvelope, pendingStartStorageKey, requestEnta } from './client';
import { competitionEnvelope, competitionRequest } from './competition-client';
import { roundEnvelope } from './round-client';
import { pendingOccupancy, type PendingIntent } from './pending-intent';

const serialized = (intent: PendingIntent): string => JSON.stringify(intent.version === 2 ? intent.command : intent);
const mismatch = (): never => { throw new EntaClientError('PENDING_COMMIT_MISMATCH'); };

/** Online POST completion only. This captures client dispatch context, not a server receipt.
 * No detached projection or caller-supplied Game ID can authorize storage removal. */
export async function completePendingStart(user: Pick<User, 'uid' | 'getIdToken'>, supplied: PendingIntent, signal: AbortSignal, currentOwner: () => boolean): Promise<{ id: string; roomCode?: string }> {
  const uid = user.uid, identity = ownerEpoch(uid), storageKey = pendingStartStorageKey(uid);
  const current = (): boolean => isOwnerEpoch(identity) && !signal.aborted && currentOwner();
  if (!current()) return mismatch();
  const occupied = pendingOccupancy(uid);
  if (occupied.state !== 'VALID' || serialized(occupied.intent) !== serialized(supplied)) return mismatch();
  // Parsed from captured raw bytes: caller mutation while token/response awaits cannot
  // change the fixed endpoint, protocol, command, or later commit comparison.
  const intent = occupied.intent, raw = occupied.raw;
  const assertCaptured = (): undefined => {
    if (!current()) return mismatch();
    const state = pendingOccupancy(uid);
    if (state.state !== 'VALID' || state.raw !== raw || serialized(state.intent) !== serialized(intent)) return mismatch();
    return undefined;
  };
  // The existing transport awaits a token before fetch. Keep that seam bound to
  // this exact occupancy as well as its unchanged transport owner-epoch checks.
  const actor = Object.freeze({ uid, getIdToken: async (forceRefresh?: boolean) => {
    assertCaptured();
    const token = await user.getIdToken(forceRefresh);
    assertCaptured();
    return token;
  } });
  let gameId: string;
  if (intent.version === 6) {
    let response: unknown;
    try { response = await requestEnta(intent.endpoint,actor,signal,intent.command,assertCaptured); }
    catch (error) {
      // This local endpoint rejects exhaustion before create, within its atomic
      // transaction. Only that definite rejection can retire this exact intent;
      // timeouts, malformed responses and other failures remain retryable.
      if (isAlmaidanLocalDevelopment && error instanceof EntaClientError && error.code === 'REMATCH_CONTENT_EXHAUSTED' && error.status === 409) {
        assertCaptured();
        try { sessionStorage.removeItem(storageKey); }
        catch { throw new EntaClientError('PENDING_INTENT_STORAGE_UNAVAILABLE'); }
      }
      throw error;
    }
    const envelope=verifyLocalRematchCompletion(response,intent);
    const match=intent.engine==='round'?roundEnvelope(envelope):competitionEnvelope(envelope,intent.command.logicalMatchId);
    if(match.id!==intent.command.logicalMatchId||match.executionFormat!==intent.executionFormat)throw new EntaClientError('MALFORMED_RESPONSE');
    gameId=match.id;
  } else if (intent.version === 2 || intent.version === 3) {
    const value = await requestEnta(intent.endpoint, actor, signal, intent.command, assertCaptured);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'match') || !Object.hasOwn(value, 'idempotent') || typeof (value as { idempotent?: unknown }).idempotent !== 'boolean') throw new EntaClientError('MALFORMED_RESPONSE');
    const match = matchEnvelope(value);
    if (match.mode !== intent.mode) throw new EntaClientError('MALFORMED_RESPONSE');
    // Native2/3 allocate Game.id independently of logicalMatchId. A retry can
    // return a progressed/finished owned match; do not assume initial state.
    gameId = match.id;
  } else if (intent.version === 4) {
    const match = roundEnvelope(await requestEnta(intent.endpoint, actor, signal, intent.command, assertCaptured));
    if (match.id !== intent.command.logicalMatchId || match.executionFormat !== intent.executionFormat) throw new EntaClientError('MALFORMED_RESPONSE');
    gameId = match.id;
  } else if (intent.version === 5) {
    const match = competitionEnvelope(await competitionRequest(intent.endpoint.slice('/competition'.length), { user: actor }, signal, intent.command, assertCaptured), intent.command.logicalMatchId);
    if (match.executionFormat !== intent.executionFormat) throw new EntaClientError('MALFORMED_RESPONSE');
    gameId = match.id;
  } else return mismatch();
  if (!current()) return mismatch();
  let roomCode: string | undefined;
  if (isAlmaidanLocalDevelopment) {
    const engine = intent.version === 6 ? intent.engine : intent.version === 5 ? 'competitive' : intent.version === 4 ? 'round' : intent.mode === 'KIDS' ? 'kids' : 'classic';
    const attached = await roomRequest('', { user: actor, signal, body: { engine, matchId: gameId, requestKey: intent.command.requestKey } });
    roomCode = (attached.room ?? attached).code;
    if (typeof roomCode !== 'string' || !/^E1-[A-Z0-9]{8}$/.test(roomCode)) throw new EntaClientError('MALFORMED_RESPONSE');
    assertCaptured();
    sessionStorage.setItem(`almaidan:match-room:${uid}:${gameId}`, roomCode);
  }
  const latest = pendingOccupancy(uid);
  if (latest.state !== 'VALID' || latest.raw !== raw || serialized(latest.intent) !== serialized(intent)) return mismatch();
  // No await between lifecycle/epoch/raw checks and removal of this one key.
  try {
    if (!current() || sessionStorage.getItem(storageKey) !== raw) return mismatch();
    sessionStorage.removeItem(storageKey);
  } catch (error) {
    if (error instanceof EntaClientError) throw error;
    throw new EntaClientError('PENDING_INTENT_STORAGE_UNAVAILABLE');
  }
  return { id: gameId, ...(roomCode ? {roomCode} : {}) };
}
