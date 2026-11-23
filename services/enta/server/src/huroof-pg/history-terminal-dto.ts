import { parseHistoryResultDto, type HistoryResultDto } from './history-result-dto';

export type HistoryTerminalDto = HistoryResultDto | { schemaVersion: 1; kind: 'ABANDONED'; matchId: string; resultVersion: string; occurredAt: string };

/** Terminal kind is supplied by the trusted immutable event join, not inferred from current match state. */
export function parseHistoryTerminalDto(kind: unknown, value: unknown, expectedMatchId: string, expectedVersion: string): HistoryTerminalDto {
  if (kind === 'FINISHED') return parseHistoryResultDto(value, expectedMatchId, expectedVersion);
  if (kind !== 'ABANDONED' || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RESULT_UNAVAILABLE');
  const raw = value as Record<string, unknown>;
  const keys = ['schemaVersion', 'kind', 'matchId', 'resultVersion', 'occurredAt'];
  if (Object.keys(raw).length !== keys.length || !keys.every(k => Object.hasOwn(raw, k))) throw new Error('RESULT_UNAVAILABLE');
  const { schemaVersion, kind: actualKind, matchId, resultVersion, occurredAt } = raw;
  if (schemaVersion !== 1 || actualKind !== 'ABANDONED' || typeof expectedMatchId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(expectedMatchId) || matchId !== expectedMatchId || typeof expectedVersion !== 'string' || !/^[1-9][0-9]{0,18}$/.test(expectedVersion) || BigInt(expectedVersion) > 9223372036854775807n || resultVersion !== expectedVersion || typeof occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(occurredAt)) throw new Error('RESULT_UNAVAILABLE');
  try { if (new Date(occurredAt).toISOString() !== occurredAt) throw new Error('RESULT_UNAVAILABLE'); } catch { throw new Error('RESULT_UNAVAILABLE'); }
  return { schemaVersion: 1, kind: 'ABANDONED', matchId: expectedMatchId, resultVersion: expectedVersion, occurredAt };
}
