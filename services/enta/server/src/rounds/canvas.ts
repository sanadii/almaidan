import { admissionHash } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import type { Canvas, CanvasCommand } from './types';
export function newCanvas(roundId: string): Canvas { return { roundId, revision: 0, strokes: [], visibleIds: [], redoIds: [], cumulativePoints: 0, mutations: 0, receipts: [] }; }
export function reduceCanvas(canvas: Canvas, command: CanvasCommand): { canvas: Canvas; idempotent: boolean } {
  const hash = admissionHash(command), existing = canvas.receipts.find(row => row.commandId === command.commandId);
  if (existing) { if (existing.hash !== hash) return fail(409, 'COMMAND_KEY_CONFLICT'); return { canvas, idempotent: true }; }
  if (command.expectedRevision !== canvas.revision) return fail(409, 'STALE_CANVAS_REVISION');
  if (canvas.mutations >= 512) return fail(409, 'CANVAS_BUDGET_EXCEEDED');
  const next = structuredClone(canvas);
  if (command.type === 'APPEND') {
    if (next.strokes.length >= 128 || next.cumulativePoints + command.stroke.points.length > 8192 || next.strokes.some(stroke => stroke.id === command.stroke.id)) return fail(409, 'CANVAS_BUDGET_EXCEEDED');
    next.strokes.push(command.stroke); next.visibleIds.push(command.stroke.id); next.redoIds = []; next.cumulativePoints += command.stroke.points.length;
  } else if (command.type === 'UNDO') { const id = next.visibleIds.pop(); if (!id) return fail(409, 'CANVAS_EMPTY'); next.redoIds.push(id); }
  else if (command.type === 'REDO') { const id = next.redoIds.pop(); if (!id) return fail(409, 'NO_REDO'); next.visibleIds.push(id); }
  else { next.visibleIds = []; next.redoIds = []; }
  next.revision++; next.mutations++; next.receipts.push({ commandId: command.commandId, hash, revision: next.revision }); return { canvas: next, idempotent: false };
}
export function canvasPage(canvas: Canvas, revision: number | null, offset: number): { roundId: string; revision: number; offset: number; nextOffset: number | null; strokes: Canvas['strokes'] } {
  if (revision !== null && revision !== canvas.revision) return fail(409, 'STALE_CANVAS_REVISION');
  const visible = canvas.visibleIds.map(id => canvas.strokes.find(stroke => stroke.id === id)!), page: Canvas['strokes'] = [];
  let index = offset;
  while (index < visible.length && page.length < 16) { if (Buffer.byteLength(JSON.stringify([...page, visible[index]])) > 128 * 1024) break; page.push(visible[index++]); }
  if (offset > visible.length) return fail(400, 'INVALID_CANVAS_CURSOR');
  return { roundId: canvas.roundId, revision: canvas.revision, offset, nextOffset: index < visible.length ? index : null, strokes: page };
}
