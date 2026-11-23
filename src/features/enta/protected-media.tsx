import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { EntaClientError, entaErrorText } from './client';
export interface PublicMedia { id: string; mime: string; bytes: number; width: number; height: number; durationMs: number | null }
export interface MediaAuthority { gameId?: string; user?: User; token?: string; gradingRoundId?: string; competition?: boolean }
/** Complete object only. Sequential 256KiB video ranges, declared <=64MiB
 * encoded media and explicit <=128MiB encoded-copy budget, one active video.
 * Never attempts to play a partial MP4 Blob. No persistent token or byte cache. */
export async function readProtectedBlob(pin: PublicMedia, authority: MediaAuthority, signal: AbortSignal): Promise<Blob> {
  const safeId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  if (signal.aborted || !safeId(pin.id) || (authority.token ? !/^[A-Za-z0-9_-]{43}$/.test(authority.token) : !safeId(authority.gameId) || authority.gradingRoundId !== undefined && !safeId(authority.gradingRoundId))) throw new EntaClientError('MEDIA_UNAVAILABLE');
  if (!Number.isSafeInteger(pin.bytes) || pin.bytes < 1 || pin.bytes > (pin.mime.startsWith('video/') ? 64 : 10) * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'].includes(pin.mime) || Boolean(authority.token) === Boolean(authority.user)) throw new EntaClientError('MEDIA_UNAVAILABLE');
  const base = authority.competition ? '/api/v1/enta/competition' : '/api/v1/enta', matches = authority.competition ? 'matches' : 'round-matches';
  const path = authority.token ? `${base}/capability/media/${pin.id}` : authority.gradingRoundId ? `${base}/${matches}/${authority.gameId}/rounds/${authority.gradingRoundId}/grading/media/${pin.id}` : `${base}/${matches}/${authority.gameId}/media/${pin.id}`;
  const headers: Record<string, string> = authority.token ? { 'x-enta-grant': authority.token } : { authorization: `Bearer ${await authority.user!.getIdToken()}` };
  const parts: Uint8Array<ArrayBuffer>[] = []; let total = 0;
  const video = pin.mime.startsWith('video/');
  for (let start = 0; start < pin.bytes; start += video ? 262144 : pin.bytes) {
    const end = Math.min(pin.bytes - 1, start + (video ? 262144 : pin.bytes) - 1), length = end - start + 1;
    const response = await fetch(path, { headers: { ...headers, ...(video ? { range: `bytes=${start}-${end}` } : {}) }, signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    if (response.status !== (video ? 206 : 200) || response.headers.get('content-type') !== pin.mime || Number(response.headers.get('content-length')) !== length || video && response.headers.get('content-range') !== `bytes ${start}-${end}/${pin.bytes}` || !response.body) throw new EntaClientError('MEDIA_DENIED', response.status);
    const reader = response.body.getReader(), chunk = new Uint8Array(length); let offset = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; if (offset + part.value.length > length) { await reader.cancel(); throw new EntaClientError('MEDIA_UNAVAILABLE'); } chunk.set(part.value, offset); offset += part.value.length; } } finally { reader.releaseLock(); }
    if (offset !== length || signal.aborted) throw new EntaClientError('MEDIA_UNAVAILABLE'); total += length; if (total * 2 > 128 * 1024 * 1024) throw new EntaClientError('MEDIA_UNAVAILABLE'); parts.push(chunk);
  }
  if (signal.aborted || total !== pin.bytes) throw new EntaClientError('MEDIA_UNAVAILABLE'); return new Blob(parts, { type: pin.mime });
}
export function ProtectedMedia({ pin, authority, epoch, label, onUnavailable }: { pin: PublicMedia; authority: MediaAuthority; epoch: string; label: string; onUnavailable?: (error: unknown) => void }) {
  const [url, setUrl] = useState<string | null>(null), [error, setError] = useState<unknown>(null), [attempt, setAttempt] = useState(0), [zoom, setZoom] = useState(false), dialog = useRef<HTMLDialogElement>(null), button = useRef<HTMLButtonElement>(null), generation = useRef(0);
  const unavailable = useRef(onUnavailable); unavailable.current = onUnavailable;
  useEffect(() => { const current = ++generation.current, controller = new AbortController(); let objectUrl: string | null = null; setUrl(null); setError(null); setZoom(false); void readProtectedBlob(pin, authority, controller.signal).then(blob => { if (current !== generation.current || controller.signal.aborted) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(error => { if (current === generation.current && !controller.signal.aborted) { setError(error); unavailable.current?.(error); } }); return () => { generation.current++; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); }; }, [attempt, authority.competition, authority.gameId, authority.gradingRoundId, authority.token, authority.user, epoch, pin.bytes, pin.id, pin.mime]);
  useEffect(() => { if (zoom) dialog.current?.showModal(); else dialog.current?.close(); }, [zoom]);
  return <figure className="enta-protected-media">{url ? pin.mime.startsWith('video/') ? <video src={url} controls preload="metadata" playsInline aria-label={label} /> : <><button type="button" className="enta-image-button" ref={button} onClick={() => setZoom(true)} aria-label={`تكبير ${label}`}><img src={url} alt={label} /></button><dialog ref={dialog} className="enta-media-dialog" onCancel={() => setZoom(false)} onClose={() => { setZoom(false); button.current?.focus(); }}><button type="button" className="button" onClick={() => setZoom(false)}>إغلاق الصورة</button><img src={url} alt={label} /></dialog></> : error ? <><p role="alert">{entaErrorText(error)}</p><button type="button" className="button" onClick={() => setAttempt(value => value + 1)}>إعادة تحميل الوسائط</button></> : <p role="status">جارٍ تحميل الوسائط…</p>}</figure>;
}
