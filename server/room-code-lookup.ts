import type { DatabaseSync } from 'node:sqlite';
import type { HuroofRoomCodeLookup } from '../src/features/game/runtime/contracts.js';

export function lookupRoomCode(db: DatabaseSync, code: string): HuroofRoomCodeLookup {
  if (!/^[A-Z0-9]{2,8}$/.test(code)) return { exists: false };
  const room = db.prepare(`
    SELECT json_extract(data, '$.game.lifecycle') AS lifecycle,
           json_extract(data, '$.successor.roomCode') AS successorCode
      FROM rooms WHERE code = ?
  `).get(code);
  if (!room) return { exists: false };
  if (room.lifecycle !== 'MATCH_COMPLETE') return { exists: true };
  const successor = room.successorCode;
  const successorCode = typeof successor === 'string' && successor !== code && /^[A-Z0-9]{2,8}$/.test(successor)
    ? successor : undefined;
  return { exists: true, finished: true, ...(successorCode ? { successorCode } : {}) };
}
