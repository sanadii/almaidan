import { admissionHash } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import type { CompetitionCatalog, CompetitionPinReference, CompetitionPrompt, CompetitionRequest } from './competition-types';
import type { Selection } from './types';
import { exact, HASH } from './validation';
export const PIN_MATERIAL = 'maydan.enta.competitive.pin-references.v1' as const;
export const START_MATERIAL = 'maydan.enta.competitive.start-intent.v1' as const;
export const POOL_MATERIAL = 'maydan.enta.competitive.source-pool.v1' as const;
export function pinReference(pin: CompetitionPrompt, selection: Selection): CompetitionPinReference {
  return { ordinal: selection.ordinal, cycle: selection.cycle, sourceNamespace: pin.sourceNamespace, sourceId: pin.sourceId, revisionId: pin.revisionId, hash: pin.hash, categoryKey: pin.categoryKey, format: pin.format, formatId: pin.formatId, formatHash: pin.formatHash, proofHash: pin.proofHash, hintRoot: pin.hintRoot };
}
export function pinReferencesHash(references: CompetitionPinReference[]): string { if (!Array.isArray(references) || references.length < 1 || references.length > 36) return fail(503, 'SELECTION_UNAVAILABLE'); for (const [n, reference] of references.entries()) { exact(reference, ['ordinal', 'cycle', 'sourceNamespace', 'sourceId', 'revisionId', 'hash', 'categoryKey', 'format', 'formatId', 'formatHash', 'proofHash', 'hintRoot']); if (reference.ordinal !== n || Object.values(reference).some(value => typeof value === 'string' && (!value.length || Buffer.byteLength(value) > 1024)) || !['ORDINARY_TIER', 'DRAWING_TARGET', 'LIST_ITEMS', 'ACTING_ITEMS'].includes(reference.format) || ['sourceNamespace', 'sourceId', 'revisionId', 'categoryKey', 'formatId'].some(key => typeof reference[key as keyof CompetitionPinReference] !== 'string') || !Number.isSafeInteger(reference.cycle) || reference.cycle < 0 || reference.cycle > 2_000_000_000 || ![reference.hash, reference.formatHash, reference.proofHash, reference.hintRoot].every(h => HASH.test(h))) return fail(503, 'SELECTION_UNAVAILABLE'); } return admissionHash({ domain: PIN_MATERIAL, version: 1, references }); }
export const startIntentHash = (intent: unknown) => admissionHash({ domain: START_MATERIAL, version: 1, intent });
export const sourcePoolRecord = (pin: CompetitionPrompt) => ({ sourceNamespace: pin.sourceNamespace, sourceId: pin.sourceId, categoryKey: pin.categoryKey, format: pin.format, revisionId: pin.revisionId, hash: pin.hash, formatId: pin.formatId, formatHash: pin.formatHash, proofHash: pin.proofHash, hintRoot: pin.hintRoot, ref: pin.ref });
export type SourcePoolRecord = ReturnType<typeof sourcePoolRecord>;
// UTF-8 byte ordering matches PostgreSQL COLLATE C, including non-ASCII IDs.
export function comparePool(a: SourcePoolRecord, b: SourcePoolRecord): number { for (const key of ['sourceNamespace', 'sourceId', 'categoryKey', 'format', 'revisionId', 'formatId', 'ref'] as const) { const order = Buffer.compare(Buffer.from(a[key]), Buffer.from(b[key])); if (order) return order; } return 0; }
export function sourcePoolRoot(records: Iterable<SourcePoolRecord>): string {
  let count = 0, previous: SourcePoolRecord | null = null, root = admissionHash({ domain: POOL_MATERIAL, version: 1, count: 0 });
  for (const record of records) { exact(record, ['sourceNamespace', 'sourceId', 'categoryKey', 'format', 'revisionId', 'hash', 'formatId', 'formatHash', 'proofHash', 'hintRoot', 'ref']); if (Object.values(record).some(value => typeof value !== 'string' || !value.length || Buffer.byteLength(value) > 1024) || ![record.hash, record.formatHash, record.proofHash, record.hintRoot].every(hash => HASH.test(hash)) || !['ORDINARY_TIER', 'DRAWING_TARGET', 'LIST_ITEMS', 'ACTING_ITEMS'].includes(record.format) || !Number.isSafeInteger(count + 1) || previous && comparePool(previous, record) >= 0) return fail(503, 'SELECTION_UNAVAILABLE'); root = admissionHash({ domain: POOL_MATERIAL, version: 1, index: count, previousRoot: root, recordHash: admissionHash(record) }); count++; previous = record; }
  return admissionHash({ domain: POOL_MATERIAL, version: 1, count, finalRoot: root });
}
export function catalogPoolRoot(request: CompetitionRequest, catalog: CompetitionCatalog): string {
  const keys = new Set(request.setup.categories.map(c => c.key));
  return sourcePoolRoot(catalog.prompts.filter(p => keys.has(p.categoryKey)).map(sourcePoolRecord).sort(comparePool));
}
