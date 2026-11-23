import { fail } from '../gameplay/types';
import { exact, id, text } from './validation';
import type { CompetitionPrompt } from './competition-types';
export const LIVE_WINDOW_BYTES = 4 * 1024 * 1024;
export const DESCRIPTOR_BYTES = 1024 * 1024;
export const ATTEMPT_BYTES = 2048;
export const PROOF_PAGE_BYTES = 512 * 1024;
export const PROJECTION_BYTES = 64 * 1024;
export const ENVELOPE_BYTES = 256 * 1024;
export function encodedBytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value)); }
export function boundedValue<T>(value: T, limit: number, code = 'CONTEXT_BOUND_EXCEEDED'): T { if (encodedBytes(value) > limit) return fail(503, code); return value; }
export function descriptorWithoutChunks(pin: CompetitionPrompt) { return { ...pin, media: pin.media.map(({ chunks, ...media }) => { void chunks; return media; }) }; }
/** New5 shape closure is separate from immutable old2–4 validators. Chunks
 * remain part of original format/media hash material; contexts load separately. */
export function validateNew5Descriptor(pin: CompetitionPrompt): void {
  exact(pin, ['ref', 'sourceNamespace', 'sourceId', 'revisionId', 'hash', 'formatId', 'formatHash', 'categoryKey', 'format', 'prompt', 'target', 'points', 'items', 'media', 'rules', 'hints', 'graphemes', 'hintRoot', 'effectValue', 'effectValueSource', 'proofHash']);
  const sourceId = (value: unknown): void => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return fail(503, 'COMPETITIVE_PROOF_UNAVAILABLE'); };
  // Same admitted new5 identifier alphabet as SQL int9_descriptor/int8_json_id.
  // Provenance namespace/source IDs retain their separate UTF8 byte predicate.
  [pin.ref, pin.revisionId, pin.formatId, pin.categoryKey].forEach(sourceId);
  for (const value of [pin.sourceNamespace, pin.sourceId]) if (typeof value !== 'string' || Buffer.byteLength(value) < 1 || Buffer.byteLength(value) > 1024) return fail(503, 'COMPETITIVE_PROOF_UNAVAILABLE');
  exact(pin.rules, ['version', 'kind', 'target']); text(pin.prompt, 1, 2000); if (pin.target !== null) text(pin.target, 1, 512);
  if (new Set(pin.media.map(m => m.id)).size !== pin.media.length) return fail(503, 'MEDIA_PROOF_UNAVAILABLE');
  let membership = 0;
  for (const item of pin.items) { exact(item, ['id', 'revisionId', 'hash', 'ordinal', 'text', 'value', 'trap', 'mediaIds']); sourceId(item.id); sourceId(item.revisionId); text(item.text, 1, 512); if (!Array.isArray(item.mediaIds) || item.mediaIds.length > 260 || new Set(item.mediaIds).size !== item.mediaIds.length) return fail(503, 'MEDIA_PROOF_UNAVAILABLE'); item.mediaIds.forEach(id); membership += item.mediaIds.length; }
  if (membership > 260) return fail(503, 'MEDIA_PROOF_UNAVAILABLE');
  for (const media of pin.media) { exact(media, ['id', 'objectKey', 'objectVersion', 'sha256', 'mime', 'bytes', 'width', 'height', 'durationMs', 'codec', 'chunks', 'role', 'itemId']); if (!Array.isArray(media.chunks) || media.chunks.length > 256) return fail(503, 'MEDIA_PROOF_UNAVAILABLE'); for (const chunk of media.chunks) exact(chunk, ['ordinal', 'byteLength', 'sha256']); boundedValue(media.chunks, PROOF_PAGE_BYTES, 'MEDIA_PROOF_UNAVAILABLE'); }
  for (const hint of pin.hints) { exact(hint, ['id', 'revisionId', 'revisionHash', 'ordinal', 'text', 'contentHash', 'safeDrawing']); sourceId(hint.id); text(hint.text, 1, 512); }
  for (const proof of pin.graphemes) { exact(proof, ['id', 'answerRevisionId', 'answerHash', 'segmentationVersion', 'grapheme', 'proofHash']); sourceId(proof.id); text(proof.grapheme, 1, 64); text(proof.segmentationVersion, 1, 64); }
  boundedValue(descriptorWithoutChunks(pin), DESCRIPTOR_BYTES, 'COMPETITIVE_PROOF_UNAVAILABLE');
}
