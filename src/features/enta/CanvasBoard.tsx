import { useEffect, useRef, useState } from 'react';
import '../../styles/enta-rounds.css';
import { entaErrorText, EntaClientError } from './client';
import { exactRound, grantRequest, roundRequest, type CanvasCommand, type Stroke } from './round-client';
import type { MediaAuthority } from './protected-media';
import { competitionRequest } from './competition-client';
import { parseCompetitionCanvasPage, verifyCompetitionCanvasReceipt } from './competition-canvas-client';
const colors = ['#191615', '#ffffff', '#ff2e95', '#3478bd', '#267448'] as const;
function parsePage(input: unknown): { roundId: string; revision: number; offset: number; nextOffset: number | null; strokes: Stroke[] } {
  const envelope = exactRound(input, ['page', 'idempotent']), page = exactRound(envelope.page, ['roundId', 'revision', 'offset', 'nextOffset', 'strokes']);
  if (typeof page.roundId !== 'string' || !Number.isSafeInteger(page.revision) || !Number.isSafeInteger(page.offset) || (page.nextOffset !== null && !Number.isSafeInteger(page.nextOffset)) || !Array.isArray(page.strokes) || page.strokes.length > 16) throw new EntaClientError('MALFORMED_RESPONSE');
  for (const value of page.strokes) { const stroke = exactRound(value, ['id', 'color', 'width', 'erase', 'points']); if (typeof stroke.id !== 'string' || !colors.includes(stroke.color as typeof colors[number]) || ![2, 5, 10].includes(stroke.width as number) || typeof stroke.erase !== 'boolean' || !Array.isArray(stroke.points) || stroke.points.length < 1 || stroke.points.length > 256 || stroke.points.some(point => !Array.isArray(point) || point.length !== 2 || point.some(n => !Number.isInteger(n) || n < 0 || n > 10000))) throw new EntaClientError('MALFORMED_RESPONSE'); }
  return page as unknown as ReturnType<typeof parsePage>;
}
export function CanvasBoard({ authority, roundId, revision, epoch, writable, requestOverride }: { requestOverride?: (path:string,signal:AbortSignal,body?:unknown)=>Promise<unknown>; authority: MediaAuthority; roundId: string; revision: number; epoch: string; writable: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), generation = useRef(0), controller = useRef<AbortController | null>(null), stroke = useRef<Stroke | null>(null), pending = useRef<CanvasCommand | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]), [currentRevision, setRevision] = useState(revision), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [attempt, setAttempt] = useState(0), [color, setColor] = useState<Stroke['color']>('#191615'), [width, setWidth] = useState<Stroke['width']>(5), [erase, setErase] = useState(false), [cursor, setCursor] = useState<[number, number]>([5000, 5000]);
  const requestPage = (path: string, signal: AbortSignal, body?: unknown) => requestOverride ? requestOverride(path,signal,body) : authority.competition ? competitionRequest(authority.token ? `/capability${path}` : `/matches/${authority.gameId}${path}`, authority, signal, body) : authority.token ? grantRequest(path, authority.token, signal, body) : roundRequest(`/round-matches/${authority.gameId}${path}`, authority.user!, signal, body);
  const paint = (rows: Stroke[], draft?: Stroke | null) => {
    const context = canvas.current?.getContext('2d'); if (!context || !canvas.current) return;
    context.clearRect(0, 0, canvas.current.width, canvas.current.height);
    for (const line of [...rows, ...(draft ? [draft] : [])]) { context.save(); context.globalCompositeOperation = line.erase ? 'destination-out' : 'source-over'; context.strokeStyle = line.color; context.lineWidth = line.width; context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath(); line.points.forEach((point, index) => { const x = point[0] * 640 / 10000, y = point[1] * 400 / 10000; if (index === 0) context.moveTo(x, y); else context.lineTo(x, y); }); if (line.points.length === 1) { const point = line.points[0]; context.lineTo(point[0] * 640 / 10000 + .1, point[1] * 400 / 10000 + .1); } context.stroke(); context.restore(); }
  };
  useEffect(() => { const version = ++generation.current, abort = new AbortController(); controller.current?.abort(); controller.current = abort; pending.current = null; stroke.current = null; setStrokes([]); setBusy(false); setError(null); paint([]);
    void (async () => {
      const rows: Stroke[] = []; let offset = 0, snapshot: number | null = null, gameVersion: number | null = null, total: number | null = null, nextCursor: string | null = null;
      do {
        if (authority.competition) {
          const path = `/rounds/${roundId}/canvas${nextCursor === null ? '' : `?snapshot=${gameVersion}&revision=${snapshot}&cursor=${encodeURIComponent(nextCursor)}`}`, page = parseCompetitionCanvasPage(await requestPage(path, abort.signal));
          if (page.roundId !== roundId || page.offset !== offset || snapshot !== null && page.revision !== snapshot || gameVersion !== null && page.gameVersion !== gameVersion || total !== null && page.total !== total) throw new EntaClientError('MALFORMED_RESPONSE');
          snapshot = page.revision; gameVersion = page.gameVersion; total = page.total; rows.push(...page.strokes); nextCursor = page.nextCursor;
          if (rows.length > 128 || new Set(rows.map(row => row.id)).size !== rows.length) throw new EntaClientError('MALFORMED_RESPONSE'); if (nextCursor === null) { if (rows.length !== total) throw new EntaClientError('MALFORMED_RESPONSE'); break; } offset += page.strokes.length;
        } else {
          const page = parsePage(await requestPage(`/rounds/${roundId}/canvas?offset=${offset}${snapshot === null ? '' : `&revision=${snapshot}`}`, abort.signal)); if (page.roundId !== roundId || page.offset !== offset || (snapshot !== null && snapshot !== page.revision)) throw new EntaClientError('MALFORMED_RESPONSE'); snapshot = page.revision; rows.push(...page.strokes); if (rows.length > 128) throw new EntaClientError('MALFORMED_RESPONSE'); if (page.nextOffset === null) break; if (page.nextOffset <= offset || page.nextOffset > 128) throw new EntaClientError('MALFORMED_RESPONSE'); offset = page.nextOffset;
        }
      } while (offset <= 128);
      if (version !== generation.current || abort.signal.aborted) return; setStrokes(rows); setRevision(snapshot ?? 0); paint(rows);
    })().catch(error => { if (version === generation.current && !abort.signal.aborted) setError(error); });
    return () => { generation.current++; abort.abort(); stroke.current = null; paint([]); };
    // Authority identity is bound into epoch; do not restart on a fresh object.
  }, [attempt, epoch, roundId]);
  useEffect(() => { if (revision !== currentRevision && !pending.current && !busy) setAttempt(value => value + 1); }, [busy, currentRevision, revision]);
  const mutate = async (type: CanvasCommand['type'], line?: Stroke) => {
    if (!writable || busy) return;
    if (!pending.current) pending.current = { commandId: crypto.randomUUID(), expectedRevision: currentRevision, type, ...(type === 'APPEND' ? { stroke: line! } : {}) } as CanvasCommand;
    const version = generation.current, abort = new AbortController(); controller.current?.abort(); controller.current = abort; setBusy(true); setError(null);
    try { const command = pending.current, response = await requestPage(`/rounds/${roundId}/canvas`, abort.signal, command), nextRevision = authority.competition ? await verifyCompetitionCanvasReceipt(response, authority.gameId!, roundId, command) : parsePage(response).revision; if (version !== generation.current || abort.signal.aborted) return; pending.current = null; setRevision(nextRevision); setBusy(false); setAttempt(value => value + 1); }
    catch (error) { if (version === generation.current && !abort.signal.aborted) { setBusy(false); setError(error); } }
  };
  const point = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => { const box = event.currentTarget.getBoundingClientRect(); return [Math.max(0, Math.min(10000, Math.round((event.clientX - box.left) / box.width * 10000))), Math.max(0, Math.min(10000, Math.round((event.clientY - box.top) / box.height * 10000)))]; };
  return <section className="enta-canvas-panel"><h3>{writable ? 'ارسم لفريقك' : 'لوحة الرسم'}</h3><canvas ref={canvas} width={640} height={400} tabIndex={writable ? 0 : -1} aria-label={writable ? 'لوحة رسم: الأسهم لتحريك القلم، والمسافة لبدء الخط وإنهائه' : 'رسم الفريق المحفوظ'} data-writable={writable} onPointerDown={event => { if (!writable || busy || pending.current) return; event.currentTarget.setPointerCapture(event.pointerId); stroke.current = { id: crypto.randomUUID(), color, width, erase, points: [point(event)] }; paint(strokes, stroke.current); }} onPointerMove={event => { if (!stroke.current || stroke.current.points.length >= 256) return; stroke.current.points.push(point(event)); paint(strokes, stroke.current); }} onPointerUp={() => { const line = stroke.current; stroke.current = null; if (line) void mutate('APPEND', line); }} onPointerCancel={() => { stroke.current = null; paint(strokes); }} onKeyDown={event => { if (!writable || busy || pending.current) return; if (event.key === ' ' || event.key.startsWith('Arrow')) event.preventDefault(); if (event.key === ' ') { if (stroke.current) { const line = stroke.current; stroke.current = null; void mutate('APPEND', line); } else stroke.current = { id: crypto.randomUUID(), color, width, erase, points: [cursor] }; } else { const next: [number, number] = [Math.max(0, Math.min(10000, cursor[0] + (event.key === 'ArrowRight' ? 200 : event.key === 'ArrowLeft' ? -200 : 0))), Math.max(0, Math.min(10000, cursor[1] + (event.key === 'ArrowDown' ? 200 : event.key === 'ArrowUp' ? -200 : 0)))]; setCursor(next); if (stroke.current && stroke.current.points.length < 256) { stroke.current.points.push(next); paint(strokes, stroke.current); } } }} />
    {writable ? <><div className="enta-canvas-tools"><label>اللون<select value={color} disabled={busy || !!pending.current} onChange={event => setColor(event.target.value as Stroke['color'])}>{colors.map((color, index) => <option key={color} value={color}>{['أسود', 'أبيض', 'وردي', 'أزرق', 'أخضر'][index]}</option>)}</select></label><label>سُمك القلم<select value={width} disabled={busy || !!pending.current} onChange={event => setWidth(Number(event.target.value) as Stroke['width'])}><option value={2}>رفيع</option><option value={5}>متوسط</option><option value={10}>عريض</option></select></label><label><input type="checkbox" checked={erase} disabled={busy || !!pending.current} onChange={event => setErase(event.target.checked)} />ممحاة</label></div><div className="enta-actions">{(['UNDO', 'REDO', 'CLEAR'] as const).map((type, index) => <button className="button" type="button" key={type} disabled={busy || !!pending.current} onClick={() => void mutate(type)}>{['تراجع عن خط', 'إعادة الخط', 'مسح اللوحة'][index]}</button>)}</div><p>يمكن رسم ١٢٨ خطاً كحد أقصى؛ التراجع والمسح لا يعيدان سعة الرسم.</p></> : null}
    {error ? <div><p role="alert">{entaErrorText(error)}</p><button className="button" type="button" disabled={busy} onClick={() => pending.current ? void mutate(pending.current.type) : setAttempt(value => value + 1)}>إعادة المحاولة</button></div> : busy ? <p role="status">جارٍ حفظ الرسم…</p> : null}
  </section>;
}


