import { randomBytes } from 'node:crypto';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import { HASH, ID, text } from './validation';
import type { Exposure, FormatCatalog, FullIntent, MediaPin, PromptPin, RequestBinding, Selection } from './types';
export const CHUNK_BYTES = 262144;
// These source alphabets permit delimiters; identity and rank are structured
// canonical tuples. Component comparison matches PostgreSQL COLLATE "C".
export const sourceKey = (row: { sourceNamespace: string; sourceId: string }): string => JSON.stringify([row.sourceNamespace, row.sourceId]);
export const sourceRank = (seed: string, cycle: number, row: { sourceNamespace: string; sourceId: string }): string => admissionHash([seed, cycle, row.sourceNamespace, row.sourceId]);
export function compareSource(a: { sourceNamespace: string; sourceId: string }, b: { sourceNamespace: string; sourceId: string }): number { return a.sourceNamespace < b.sourceNamespace ? -1 : a.sourceNamespace > b.sourceNamespace ? 1 : a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0; }
export function validateMedia(pin: MediaPin): void {
  if (!pin || !ID.test(pin.id) || !HASH.test(pin.sha256) || typeof pin.objectKey !== 'string' || !/^enta-private\/[A-Za-z0-9_/-]{1,180}$/.test(pin.objectKey) || pin.objectKey.includes('..') || !/^[0-9]{1,24}$/.test(pin.objectVersion) || !Number.isSafeInteger(pin.bytes) || pin.bytes < 1 || !Number.isInteger(pin.width) || !Number.isInteger(pin.height) || pin.width < 1 || pin.height < 1 || pin.width * pin.height > 16_000_000) return fail(503, 'MEDIA_PROOF_UNAVAILABLE');
  const video = ['video/mp4', 'video/webm'].includes(pin.mime);
  if (video ? pin.bytes > 64 * 1024 * 1024 || !Number.isSafeInteger(pin.durationMs) || pin.durationMs! < 1 || pin.durationMs! > 120000 || !['h264', 'vp8', 'vp9'].includes(pin.codec ?? '') : !['image/png', 'image/jpeg', 'image/webp'].includes(pin.mime) || pin.bytes > 10 * 1024 * 1024 || pin.durationMs !== null || pin.codec !== null) return fail(503, 'MEDIA_POLICY_UNAVAILABLE');
  if (!Array.isArray(pin.chunks) || pin.chunks.length !== Math.ceil(pin.bytes / CHUNK_BYTES)) return fail(503, 'MEDIA_PROOF_UNAVAILABLE');
  pin.chunks.forEach((chunk, index) => { if (chunk.ordinal !== index || chunk.byteLength !== Math.min(CHUNK_BYTES, pin.bytes - index * CHUNK_BYTES) || !HASH.test(chunk.sha256)) return fail(503, 'MEDIA_PROOF_UNAVAILABLE'); });
}
export function validateFormatCatalog(catalog: FormatCatalog): void {
  if (!catalog || catalog.policyVersion !== 'enta-format-1' || ![catalog.baseReleaseId, catalog.receiptId, catalog.formatReleaseId].every(value => ID.test(value)) || ![catalog.baseRoot, catalog.formatRoot, catalog.mediaRoot].every(value => HASH.test(value)) || !Array.isArray(catalog.categories) || !catalog.categories.length || catalog.categories.length > 1000 || new Set(catalog.categories.map(category => category.key)).size !== catalog.categories.length) return fail(503, 'FORMAT_CATALOG_UNAVAILABLE');
  for (const category of catalog.categories) {
    if (!ID.test(category.key) || text(category.label, 1, 100) !== category.label || !['ORDINARY_TIER', 'DRAWING_TARGET', 'LIST_ITEMS', 'ACTING_ITEMS'].includes(category.format) || !Array.isArray(category.prompts) || category.prompts.length < 1 || category.prompts.length > 1000 || new Set(category.prompts.map(pin => pin.ref)).size !== category.prompts.length || new Set(category.prompts.map(sourceKey)).size !== category.prompts.length) return fail(503, 'FORMAT_CATALOG_UNAVAILABLE');
    if (category.cover) { validateMedia(category.cover); if (category.cover.role !== 'COVER' || category.cover.itemId !== null || !category.cover.mime.startsWith('image/')) return fail(503, 'MEDIA_PROOF_UNAVAILABLE'); }
    for (const pin of category.prompts) {
      const { formatHash, ...hashPayload } = pin;
      if (!pin.rules || Object.keys(pin.rules).length !== 3 || pin.rules.version !== 1 || pin.rules.kind !== pin.format || pin.rules.target !== pin.target || formatHash !== admissionHash({ version: 1, pin: hashPayload })) return fail(503, 'FORMAT_CATALOG_UNAVAILABLE');
      if (![pin.ref, pin.revisionId, pin.formatId].every(value => ID.test(value)) || ![pin.hash, pin.formatHash].every(value => HASH.test(value)) || typeof pin.sourceId !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(pin.sourceId) || typeof pin.sourceNamespace !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(pin.sourceNamespace) || pin.format !== category.format || pin.categoryKey !== category.key || text(pin.prompt, 1, 2000) !== pin.prompt || !Array.isArray(pin.items) || pin.items.length > 128 || !Array.isArray(pin.media) || pin.media.length > 260) return fail(503, 'FORMAT_CATALOG_UNAVAILABLE');
      if (['ORDINARY_TIER', 'DRAWING_TARGET'].includes(pin.format) ? ![200, 400, 600].includes(pin.points ?? 0) || !pin.target || text(pin.target, 1, 512) !== pin.target : pin.points !== null || pin.target !== null || pin.items.length < 1) return fail(503, 'FORMAT_CATALOG_UNAVAILABLE');
      if (new Set(pin.items.map(item => item.id)).size !== pin.items.length || new Set(pin.items.map(item => item.revisionId)).size !== pin.items.length) return fail(503, 'FORMAT_CATALOG_UNAVAILABLE');
      pin.items.forEach((item, ordinal) => { if (![item.id, item.revisionId].every(value => ID.test(value)) || !HASH.test(item.hash) || item.ordinal !== ordinal || text(item.text, 1, 512) !== item.text || !Number.isInteger(item.value) || item.value < 1 || item.value > 10000 || typeof item.trap !== 'boolean' || !Array.isArray(item.mediaIds)) return fail(503, 'FORMAT_CATALOG_UNAVAILABLE'); });
      for (const media of pin.media) { validateMedia(media); if (!['PROMPT', 'MASKED', 'CLEAR', 'ACTOR', 'ITEM'].includes(media.role) || (media.role === 'ITEM' ? !pin.items.some(item => item.id === media.itemId && item.mediaIds.includes(media.id)) : media.itemId !== null)) return fail(503, 'MEDIA_PROOF_UNAVAILABLE'); }
      for (const item of pin.items) if (item.mediaIds.some(id => !pin.media.some(media => media.id === id && media.itemId === item.id && media.role === 'ITEM'))) return fail(503, 'MEDIA_PROOF_UNAVAILABLE');
      const masks = pin.media.filter(media => media.role === 'MASKED'), clears = pin.media.filter(media => ['CLEAR', 'ACTOR'].includes(media.role));
      if (masks.some(mask => clears.some(clear => clear.sha256 === mask.sha256 || (clear.objectKey === mask.objectKey && clear.objectVersion === mask.objectVersion)))) return fail(503, 'MEDIA_VARIANTS_NOT_DISTINCT');
    }
  }
}
/** Separate assertion; never casts a v4 format into old CLASSIC receipt evidence. */
export const productionFormatPolicy = (catalog: FormatCatalog): void => { void catalog; return fail(503, 'FORMAT_RECEIPT_POLICY_UNAVAILABLE'); };
export function selectRoundPins(request: RequestBinding, catalog: FormatCatalog, exposures: Exposure[], seed = randomBytes(32).toString('hex')): { pins: PromptPin[]; intent: FullIntent } {
  validateFormatCatalog(catalog);
  if (!HASH.test(seed)) return fail(503, 'SELECTION_UNAVAILABLE');
  const pins: PromptPin[] = [], selection: Selection[] = [];
  for (const requested of request.setup.categories) {
    const category = catalog.categories.find(row => row.key === requested.key); if (!category) return fail(409, 'CATEGORY_UNAVAILABLE');
    const standalone = request.executionFormat !== 'MIXED_BOARD';
    if (standalone && category.format !== (request.executionFormat === 'STANDALONE_LIST' ? 'LIST_ITEMS' : 'ACTING_ITEMS')) return fail(409, 'FORMAT_UNAVAILABLE');
    let chosen: PromptPin[];
    if (!standalone) {
      if (['LIST_ITEMS', 'ACTING_ITEMS'].includes(category.format)) {
        if (requested.promptRefs.length < 1) return fail(400, 'PROMPTS_REQUIRED');
        chosen = requested.promptRefs.map(ref => category.prompts.find(pin => pin.ref === ref) ?? fail(409, 'PROMPT_UNAVAILABLE'));
      } else {
        if (requested.promptRefs.length || category.prompts.length !== 6 || [200, 400, 600].some(points => category.prompts.filter(pin => pin.points === points).length !== 2)) return fail(503, 'TIER_SUPPLY_UNAVAILABLE');
        chosen = [...category.prompts].sort((a, b) => a.points! - b.points! || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
      }
      for (const pin of chosen) selection.push({ sourceNamespace: pin.sourceNamespace, sourceId: pin.sourceId, revisionId: pin.revisionId, cycle: 0, ordinal: selection.length });
    } else {
      const history = exposures.filter(row => row.categoryKey === category.key);
      if (history.some(row => !(/^[A-Za-z0-9._:-]{1,200}$/).test(row.sourceId) || !/^[A-Za-z0-9._:-]{1,128}$/.test(row.sourceNamespace) || !Number.isSafeInteger(row.cycle) || row.cycle < 1) || new Set(history.map(row => JSON.stringify([row.sourceNamespace, row.sourceId, row.cycle]))).size !== history.length) return fail(503, 'EXPOSURE_UNAVAILABLE');
      let cycle = Math.max(1, ...history.map(row => row.cycle));
      const seen = new Set(history.filter(row => row.cycle === cycle).map(sourceKey));
      const order = (rows: PromptPin[], currentCycle: number) => [...rows].sort((a, b) => { const ah = sourceRank(seed, currentCycle, a), bh = sourceRank(seed, currentCycle, b); return ah < bh ? -1 : ah > bh ? 1 : compareSource(a, b) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0); });
      chosen = order(category.prompts.filter(pin => !seen.has(sourceKey(pin))), cycle).slice(0, Math.min(4, category.prompts.length));
      for (const pin of chosen) selection.push({ sourceNamespace: pin.sourceNamespace, sourceId: pin.sourceId, revisionId: pin.revisionId, cycle, ordinal: selection.length });
      if (chosen.length < Math.min(4, category.prompts.length)) { cycle++; const selected = new Set(chosen.map(sourceKey)); const remainder = order(category.prompts.filter(pin => !selected.has(sourceKey(pin))), cycle).slice(0, Math.min(4, category.prompts.length) - chosen.length); for (const pin of remainder) { chosen.push(pin); selection.push({ sourceNamespace: pin.sourceNamespace, sourceId: pin.sourceId, revisionId: pin.revisionId, cycle, ordinal: selection.length }); } }
    }
    pins.push(...chosen);
  }
  if (!pins.length || pins.length > 36 || new Set(pins.map(sourceKey)).size !== pins.length || new Set(pins.map(pin => pin.revisionId)).size !== pins.length) return fail(503, 'SELECTION_UNAVAILABLE');
  const intent: FullIntent = { version: 4, request, baseReleaseId: catalog.baseReleaseId, baseRoot: catalog.baseRoot, receiptId: catalog.receiptId, formatReleaseId: catalog.formatReleaseId, formatRoot: catalog.formatRoot, mediaRoot: catalog.mediaRoot, policyVersion: catalog.policyVersion, poolHash: admissionHash(request.setup.categories.map(requested => { const category = catalog.categories.find(category => category.key === requested.key)!; return { key: category.key, sources: category.prompts.map(pin => ({ sourceNamespace: pin.sourceNamespace, sourceId: pin.sourceId, revisionId: pin.revisionId, hash: pin.hash })).sort(compareSource) }; })), seed, selection, roundCount: pins.length, pinsHash: admissionHash(pins) };
  return { pins, intent };
}
