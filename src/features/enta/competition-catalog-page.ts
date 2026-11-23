import { EntaClientError, pendingName } from './client';
import { exactRound, parsePublicMedia } from './round-client';
import type { projectCompetitionCatalog } from '../../../services/enta/server/src/rounds/competition-projection';
export interface CatalogPrompt { ref: string; label: string }
export type CatalogCategory = ReturnType<typeof projectCompetitionCatalog>['categories'][number];
export interface CatalogPage<T> { scope: { gameId: string; collection: 'catalog-categories' | 'catalog-prompts'; roundId: string | null; effectId: null; purpose: 'OWNER' }; revision: string; snapshot: string; total: number; returned: number; offset: number; nextCursor: string | null; complete: boolean; rows: T[] }
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const bad = (): never => { throw new EntaClientError('MALFORMED_RESPONSE'); };
export function parseCatalogPrompt(value: unknown): CatalogPrompt { const row = exactRound(value, ['ref', 'label']); if (!id(row.ref) || !pendingName(row.label, 1, 2000)) return bad(); return row as unknown as CatalogPrompt; }
export function parseCatalogCategory(value: unknown): CatalogCategory {
  const row = exactRound(value, ['key', 'label', 'format', 'prompts', 'cover']);
  if (!id(row.key) || !pendingName(row.label, 1, 100) || !['ORDINARY_TIER', 'DRAWING_TARGET', 'LIST_ITEMS', 'ACTING_ITEMS'].includes(row.format as string) || !Array.isArray(row.prompts) || row.prompts.length > 64) return bad();
  if (row.cover !== null) parsePublicMedia(row.cover); row.prompts.forEach(parseCatalogPrompt); return row as unknown as CatalogCategory;
}
export function parseCatalogPage<T>(value: unknown, categoryKey: string | null, parseRow: (value: unknown) => T, binding?: { gameId: string; revision: string; snapshot?: string }): CatalogPage<T> {
  const p = exactRound(value, ['scope', 'revision', 'snapshot', 'total', 'returned', 'offset', 'nextCursor', 'complete', 'rows']), scope = exactRound(p.scope, ['gameId', 'collection', 'roundId', 'effectId', 'purpose']);
  const size = categoryKey === null ? 32 : 64;
  if (typeof scope.gameId !== 'string' || !scope.gameId.length || new TextEncoder().encode(scope.gameId).byteLength > 1024 || scope.collection !== (categoryKey === null ? 'catalog-categories' : 'catalog-prompts') || scope.roundId !== categoryKey || scope.effectId !== null || scope.purpose !== 'OWNER' || !hash(p.revision) || !hash(p.snapshot) || binding && (scope.gameId !== binding.gameId || p.revision !== binding.revision || binding.snapshot !== undefined && p.snapshot !== binding.snapshot) || !Number.isSafeInteger(p.total) || (p.total as number) < 0 || !Number.isSafeInteger(p.offset) || (p.offset as number) < 0 || (p.offset as number) > (p.total as number) || (p.offset as number) % size !== 0 || !Array.isArray(p.rows) || p.rows.length !== Math.min(size, (p.total as number) - (p.offset as number)) || p.returned !== p.rows.length || p.complete !== ((p.offset as number) + p.rows.length === p.total) || (p.nextCursor === null) !== p.complete || p.nextCursor !== null && (typeof p.nextCursor !== 'string' || p.nextCursor.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(p.nextCursor)) || new TextEncoder().encode(JSON.stringify(p.rows)).byteLength > 65536) return bad();
  return { ...p, scope, rows: p.rows.map(parseRow) } as unknown as CatalogPage<T>;
}
