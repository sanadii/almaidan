import {parseLocalRematchPending,type LocalRematchPending} from './local-rematch-client';
import { inspectPending, requireReadable, savePending, PendingError, type Occupancy } from './pending-store';
import { EntaClientError, foldEntaName, pendingName, pendingStartStorageKey, parsePendingStart, type EntaMode, type RematchStart, type StartCommand, type SuccessorSetup, type SuccessorStart } from './client';
import { parseRoundPending, type PendingRoundIntent } from './round-client';
import { parseCompetitionPending, type PendingCompetitionIntent } from './competition-client';
export function pendingIntentRoute(value: PendingIntent): string {
  if (value.version === 6) return `/enta/local-rematch/${value.engine}/${value.predecessor.id}`;
  if (value.version === 5) return `/enta/competitive/new/${value.executionFormat === 'TIER_BOARD' ? 'classic' : value.executionFormat === 'MIXED_BOARD' ? 'mixed' : value.executionFormat === 'STANDALONE_LIST' ? 'list' : 'acting'}`;
  if (value.version === 4) return `/enta/new/${value.executionFormat === 'MIXED_BOARD' ? 'mixed' : value.executionFormat === 'STANDALONE_LIST' ? 'list' : 'acting'}`;
  return value.version === 2 ? '/enta/new' : value.predecessor ? `/enta/matches/${value.predecessor.gameId}/rematch` : '/enta/new/kids';
}
export type PendingIntent = LocalRematchPending | PendingCompetitionIntent | PendingRoundIntent | { version: 2; mode: 'CLASSIC'; operation: 'PAID_ENTA_CLASSIC'; startKind: 'START'; predecessor: null; endpoint: '/matches/classic'; command: StartCommand } | { version: 3; mode: EntaMode; operation: 'PAID_ENTA_CLASSIC' | 'PAID_ENTA_KIDS'; startKind: 'START' | 'REMATCH'; predecessor: null | { gameId: string; version: number }; endpoint: `/matches/${string}`; command: SuccessorStart | RematchStart };
const id = /^[A-Za-z0-9_-]{1,128}$/, key = /^[A-Za-z0-9._:-]{8,128}$/;
function exact(value: unknown, keys: string[]): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
export function parseSuccessorSetup(value: unknown, mode: EntaMode): SuccessorSetup {
  if (!exact(value, ['version', 'categoryKeys', 'teams', 'rules']) || value.version !== 3 || !Array.isArray(value.categoryKeys) || value.categoryKeys.length !== (mode === 'KIDS' ? 1 : 6) || !value.categoryKeys.every(key => typeof key === 'string' && id.test(key)) || new Set(value.categoryKeys).size !== value.categoryKeys.length || !exact(value.rules, ['questionSeconds']) || !Number.isInteger(value.rules.questionSeconds) || (value.rules.questionSeconds as number) < 5 || (value.rules.questionSeconds as number) > 120 || !Array.isArray(value.teams) || value.teams.length < 2 || value.teams.length > 4) throw new EntaClientError('MALFORMED_RESPONSE');
  for (const team of value.teams) if (!exact(team, ['name', 'players', 'lifelines']) || !pendingName(team.name, 2, 22) || !Array.isArray(team.players) || team.players.length < 1 || team.players.length > 8 || !team.players.every(player => pendingName(player, 1, 30)) || !Array.isArray(team.lifelines) || team.lifelines.length) throw new EntaClientError('MALFORMED_RESPONSE');
  if (new Set(value.teams.map(team => foldEntaName(team.name))).size !== value.teams.length) throw new EntaClientError('MALFORMED_RESPONSE');
  return value as unknown as SuccessorSetup;
}
export function parsePendingIntent(value: unknown): Extract<PendingIntent, { version: 3 }> {
  if (!exact(value, ['version', 'mode', 'operation', 'startKind', 'predecessor', 'endpoint', 'command']) || value.version !== 3 || !['CLASSIC', 'KIDS'].includes(value.mode as string) || value.operation !== (value.mode === 'KIDS' ? 'PAID_ENTA_KIDS' : 'PAID_ENTA_CLASSIC') || !['START', 'REMATCH'].includes(value.startKind as string)) throw new EntaClientError('PENDING_INTENT_INVALID');
  const rematch = value.startKind === 'REMATCH';
  if (rematch ? !exact(value.predecessor, ['gameId', 'version']) || typeof value.predecessor.gameId !== 'string' || !id.test(value.predecessor.gameId) || !Number.isSafeInteger(value.predecessor.version) || (value.predecessor.version as number) < 2 || (value.predecessor.version as number) > 2000000000 : value.predecessor !== null || value.mode !== 'KIDS') throw new EntaClientError('PENDING_INTENT_INVALID');
  const predecessor = value.predecessor as { gameId: string; version: number } | null;
  if (value.endpoint !== (rematch ? `/matches/${predecessor!.gameId}/rematch` : '/matches/kids') || !exact(value.command, ['requestKey', 'logicalMatchId', 'setup', ...(rematch ? ['predecessorVersion'] : [])]) || typeof value.command.requestKey !== 'string' || !key.test(value.command.requestKey) || typeof value.command.logicalMatchId !== 'string' || !id.test(value.command.logicalMatchId) || (rematch && value.command.predecessorVersion !== predecessor!.version)) throw new EntaClientError('PENDING_INTENT_INVALID');
  parseSuccessorSetup(value.command.setup, value.mode as EntaMode); return value as unknown as Extract<PendingIntent, { version: 3 }>;
}
function parseStoredPending(value: unknown): PendingIntent {
  if (value && typeof value === 'object' && !Object.hasOwn(value, 'version')) {
    const command = parsePendingStart(value); if (!command) throw new EntaClientError('PENDING_INTENT_INVALID');
    return { version: 2, mode: 'CLASSIC', operation: 'PAID_ENTA_CLASSIC', startKind: 'START', predecessor: null, endpoint: '/matches/classic', command };
  }
  const version = value && typeof value === 'object' ? (value as { version?: unknown }).version : null;
  return version === 6 ? parseLocalRematchPending(value) : version === 5 ? parseCompetitionPending(value) : version === 4 ? parseRoundPending(value) : parsePendingIntent(value);
}
const serializePending = (value: PendingIntent) => JSON.stringify(value.version === 2 ? value.command : value);
function storageWork<T>(work: () => T): T { try { return work(); } catch (e) { if (e instanceof PendingError) throw new EntaClientError(e.code); throw e; } }
export function pendingOccupancy(uid: string): Occupancy<PendingIntent> {
  try { return inspectPending(sessionStorage, pendingStartStorageKey(uid), parseStoredPending); } catch { return { state: 'STORAGE_UNAVAILABLE' }; }
}
export function readPendingIntent(uid: string): PendingIntent | null { return storageWork(() => requireReadable(pendingOccupancy(uid))); }
export function loadPendingForSetup(uid: string, blocked: (error: unknown) => void): PendingIntent | null {
  try { return readPendingIntent(uid); } catch (error) { blocked(error); return null; }
}
export function pendingStorageReadable(uid: string): boolean { const state = pendingOccupancy(uid); return state.state === 'EMPTY' || state.state === 'VALID'; }
export function persistPendingIntent(uid: string, value: PendingIntent): void {
  storageWork(() => savePending(sessionStorage, pendingStartStorageKey(uid), value, parseStoredPending, serializePending));
}
