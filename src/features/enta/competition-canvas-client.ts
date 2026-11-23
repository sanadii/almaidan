import { EntaClientError } from './client';
import { exactRound, type CanvasCommand, type Stroke } from './round-client';
import { commandCanonical } from './competition-intent';
const bad = (): never => { throw new EntaClientError('MALFORMED_RESPONSE'); };
const integer = (n: unknown, min: number, max: number) => Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max;
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export interface CompetitionCanvasPage { roundId: string; revision: number; gameVersion: number; total: number; offset: number; nextCursor: string | null; strokes: Stroke[] }
export function parseCompetitionCanvasPage(input: unknown): CompetitionCanvasPage {
  const envelope = exactRound(input, ['page', 'idempotent']), p = exactRound(envelope.page, ['roundId', 'revision', 'gameVersion', 'total', 'offset', 'nextCursor', 'strokes']);
  if (envelope.idempotent !== false || !id(p.roundId) || !integer(p.revision, 0, 512) || !integer(p.gameVersion, 1, 64946) || !integer(p.total, 0, 128) || !integer(p.offset, 0, p.total as number) || (p.offset as number) % 16 || p.nextCursor !== null && (typeof p.nextCursor !== 'string' || p.nextCursor.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(p.nextCursor)) || !Array.isArray(p.strokes) || p.strokes.length !== Math.min(16, (p.total as number) - (p.offset as number)) || (p.nextCursor === null) !== ((p.offset as number) + p.strokes.length === p.total)) return bad();
  for (const value of p.strokes) { const stroke = exactRound(value, ['id', 'color', 'width', 'erase', 'points']); if (!id(stroke.id) || !['#191615', '#ffffff', '#ff2e95', '#3478bd', '#267448'].includes(stroke.color as string) || ![2, 5, 10].includes(stroke.width as number) || typeof stroke.erase !== 'boolean' || !Array.isArray(stroke.points) || !stroke.points.length || stroke.points.length > 256 || stroke.points.some(point => !Array.isArray(point) || point.length !== 2 || point.some(n => !integer(n, 0, 10000)))) return bad(); }
  return p as unknown as CompetitionCanvasPage;
}
export async function verifyCompetitionCanvasReceipt(input: unknown, gameId: string, roundId: string, command: CanvasCommand): Promise<number> {
  const envelope = exactRound(input, ['idempotent', 'canvasReceipt']), r = exactRound(envelope.canvasReceipt, ['gameId', 'roundId', 'commandId', 'hash', 'expectedRevision', 'revision', 'eventId']);
  if (typeof envelope.idempotent !== 'boolean' || r.gameId !== gameId || r.roundId !== roundId || r.commandId !== command.commandId || r.expectedRevision !== command.expectedRevision || r.revision !== command.expectedRevision + 1 || !integer(r.revision, 1, 512) || !id(r.eventId) || typeof r.hash !== 'string' || !/^[a-f0-9]{64}$/.test(r.hash)) return bad();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(commandCanonical(command))), hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== r.hash) return bad(); return r.revision as number;
}
