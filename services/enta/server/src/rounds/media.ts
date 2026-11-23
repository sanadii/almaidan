import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { getStorage } from 'firebase-admin/storage';
import { fail } from '../gameplay/types';
import { hostedGameplayRuntime } from '../gameplay/service';
import { firebaseAdminAppForProject } from '../firebase-verifier';
import { CHUNK_BYTES, validateMedia } from './selection';
import type { MediaPin } from './types';
export interface PinnedByteReader { source: 'firebase-storage' | 'test-only'; read(pin: MediaPin, start: number, length: number): Promise<{ objectVersion: string; bytes: Uint8Array }> }
/** Fixed bucket chosen by trusted deployment configuration. No URL argument,
 * external fetch/redirect, signed link or caller-selected bucket. Missing verified
 * private corpus configuration is unavailable; this constructor performs no IO. */
export function firebasePinnedByteReader(projectId: string, bucketName: string | null): PinnedByteReader {
  return { source: 'firebase-storage', async read(pin, start, length) {
    if (!bucketName || ![`${projectId}.appspot.com`, `${projectId}.firebasestorage.app`].includes(bucketName)) return fail(503, 'MEDIA_PROVIDER_UNAVAILABLE');
    validateMedia(pin);
    // Generation stays an exact decimal string, never a lossy JS number.
    const file = getStorage(firebaseAdminAppForProject(projectId)).bucket(bucketName).file(pin.objectKey, { generation: pin.objectVersion });
    const chunks: Buffer[] = []; let total = 0;
    await new Promise<void>((resolve, reject) => {
      const stream = file.createReadStream({ start, end: start + length - 1, validation: false });
      stream.on('data', (data: Buffer) => { total += data.length; if (total > length) { stream.destroy(new Error('MEDIA_LENGTH_MISMATCH')); return; } chunks.push(data); });
      stream.once('error', reject); stream.once('end', resolve);
    });
    if (total !== length) return fail(503, 'MEDIA_LENGTH_MISMATCH');
    return { objectVersion: pin.objectVersion, bytes: Buffer.concat(chunks) };
  } };
}
export function assertByteReader(reader: PinnedByteReader, testEnvironment: boolean): void { if (reader.source === 'test-only' && (!testEnvironment || hostedGameplayRuntime())) throw new Error('TEST_MEDIA_FORBIDDEN'); }
export function mediaRange(pin: MediaPin, header: string | undefined): { start: number; end: number; partial: boolean } {
  const video = pin.mime.startsWith('video/');
  if (!header) { if (video) return fail(416, 'MEDIA_RANGE_REQUIRED'); return { start: 0, end: pin.bytes - 1, partial: false }; }
  const match = /^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(header);
  if (!video || !match) return fail(416, 'INVALID_MEDIA_RANGE');
  const start = Number(match[1]), end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= pin.bytes || end - start + 1 > 1024 * 1024) return fail(416, 'INVALID_MEDIA_RANGE');
  return { start, end, partial: true };
}
export async function deliverMedia(response: Response, reader: PinnedByteReader, authorize: () => Promise<{ pin: MediaPin; epoch: string }>, header: string | undefined): Promise<void> {
  const initial = await authorize(); validateMedia(initial.pin); const pin = initial.pin, range = mediaRange(pin, header);
  const first = Math.floor(range.start / CHUNK_BYTES), last = Math.floor(range.end / CHUNK_BYTES), parts: Buffer[] = [];
  // A 1MiB unaligned range may require five aligned proof reads. Account for
  // actual bytes <=5*256KiB, not only the requested slice. No DB locks span IO.
  for (let ordinal = first; ordinal <= last; ordinal++) {
    const before = await authorize(); if (before.epoch !== initial.epoch || before.pin.sha256 !== pin.sha256) return fail(403, 'MEDIA_DENIED');
    const proof = pin.chunks[ordinal], loaded = await reader.read(pin, ordinal * CHUNK_BYTES, proof.byteLength);
    const after = await authorize();
    if (after.epoch !== initial.epoch || after.pin.sha256 !== pin.sha256) return fail(403, 'MEDIA_DENIED');
    const bytes = Buffer.from(loaded.bytes);
    if (loaded.objectVersion !== pin.objectVersion || bytes.length !== proof.byteLength || createHash('sha256').update(bytes).digest('hex') !== proof.sha256) return fail(503, 'MEDIA_INTEGRITY_UNAVAILABLE');
    parts.push(bytes);
  }
  const aligned = Buffer.concat(parts), result = aligned.subarray(range.start - first * CHUNK_BYTES, range.end - first * CHUNK_BYTES + 1);
  if (!range.partial && createHash('sha256').update(result).digest('hex') !== pin.sha256) return fail(503, 'MEDIA_INTEGRITY_UNAVAILABLE');
  const final = await authorize(); if (final.epoch !== initial.epoch) return fail(403, 'MEDIA_DENIED');
  response.status(range.partial ? 206 : 200); response.setHeader('content-type', pin.mime); response.setHeader('content-length', result.length); response.setHeader('cache-control', 'no-store'); response.setHeader('referrer-policy', 'no-referrer'); response.setHeader('content-disposition', `inline; filename="media.${pin.mime.split('/')[1]}"`);
  if (range.partial) { response.setHeader('content-range', `bytes ${range.start}-${range.end}/${pin.bytes}`); response.setHeader('accept-ranges', 'bytes'); }
  for (let offset = 0; offset < result.length; offset += CHUNK_BYTES) {
    const current = await authorize(); if (current.epoch !== initial.epoch) { response.destroy(); return; }
    // Revocation prevents new delivery, it cannot recall bytes already received.
    if (!response.write(result.subarray(offset, Math.min(offset + CHUNK_BYTES, result.length)))) await new Promise<void>((resolve, reject) => { const cleanup = () => { response.off('drain', done); response.off('close', closed); }; const done = () => { cleanup(); resolve(); }; const closed = () => { cleanup(); reject(new Error('CLIENT_CLOSED')); }; response.once('drain', done); response.once('close', closed); });
  }
  response.end();
}
