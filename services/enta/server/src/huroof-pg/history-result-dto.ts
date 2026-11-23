export interface HistoryResultDto {
  schemaVersion: 1;
  matchId: string;
  resultVersion: string;
  occurredAt: string;
  questionScores: { horizontal: number; vertical: number };
  roundWins: { horizontal: number; vertical: number };
  matchWinner: 'horizontal' | 'vertical' | null;
  matchWinReason: 'two_consecutive_round_wins' | 'three_total_round_wins' | null;
  endedWithoutWinner: boolean;
}

const keys = ['schemaVersion', 'matchId', 'resultVersion', 'occurredAt', 'questionScores', 'roundWins', 'matchWinner', 'matchWinReason', 'endedWithoutWinner'];
const exact = (x: unknown, names: string[]): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === names.length && names.every(k => Object.hasOwn(x, k));
const match = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const version = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
const utc = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return false;
  try { return new Date(v).toISOString() === v; } catch { return false; }
};
function scores(v: unknown): { horizontal: number; vertical: number } {
  if (!exact(v, ['horizontal', 'vertical'])) throw new Error('RESULT_UNAVAILABLE');
  const horizontal = v.horizontal, vertical = v.vertical;
  if (![horizontal, vertical].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 2147483647)) throw new Error('RESULT_UNAVAILABLE');
  return { horizontal: horizontal as number, vertical: vertical as number };
}

/** Validates the closed public projection, returning no references to the input. */
export function parseHistoryResultDto(value: unknown, expectedMatchId: string, expectedVersion: string): HistoryResultDto {
  if (!match(expectedMatchId) || !version(expectedVersion) || !exact(value, keys)) throw new Error('RESULT_UNAVAILABLE');
  const { schemaVersion, matchId, resultVersion, occurredAt, questionScores: rawScores, roundWins: rawWins, matchWinner, matchWinReason, endedWithoutWinner } = value;
  if (schemaVersion !== 1 || matchId !== expectedMatchId || resultVersion !== expectedVersion || !utc(occurredAt) || typeof endedWithoutWinner !== 'boolean' ||
      (matchWinner === null ? matchWinReason !== null : (matchWinner !== 'horizontal' && matchWinner !== 'vertical') || (matchWinReason !== 'two_consecutive_round_wins' && matchWinReason !== 'three_total_round_wins'))) throw new Error('RESULT_UNAVAILABLE');
  const questionScores = scores(rawScores), roundWins = scores(rawWins);
  return {
    schemaVersion: 1, matchId: expectedMatchId, resultVersion: expectedVersion, occurredAt,
    questionScores, roundWins,
    matchWinner: matchWinner as HistoryResultDto['matchWinner'], matchWinReason: matchWinReason as HistoryResultDto['matchWinReason'], endedWithoutWinner,
  };
}

/** Compact fixed-order public encoding; this is not an attestation or resource qualification. */
export function encodeHistoryResultDto(value: unknown, expectedMatchId: string, expectedVersion: string): string {
  return JSON.stringify(parseHistoryResultDto(value, expectedMatchId, expectedVersion));
}
