import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { lookupRoomCode } from '../../server/room-code-lookup.js';

test('room-code lookup checks the indexed code without changing the room or accepting an internal ID', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE rooms (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO rooms VALUES (?, ?, ?, ?)');
  insert.run('ID1234', 'ABC234', 9, JSON.stringify({ game: { lifecycle: 'LOBBY' }, successor: { roomCode: 'NEXT34' } }));
  insert.run('internal-old', 'OLD123', 10, JSON.stringify({
    game: { lifecycle: 'MATCH_COMPLETE' }, successor: { roomId: 'internal-next', roomCode: 'NEXT34' },
    members: [{ name: 'اسم خاص', token: 'private-token' }],
  }));
  insert.run('internal-ended', 'ENDED1', 11, JSON.stringify({ game: { lifecycle: 'MATCH_COMPLETE' } }));
  insert.run('internal-invalid', 'ENDED2', 11, JSON.stringify({ game: { lifecycle: 'MATCH_COMPLETE' }, successor: { roomCode: 'a/b' } }));
  db.exec('PRAGMA query_only = ON');

  assert.deepEqual(lookupRoomCode(db, 'ABC234'), { exists: true });
  assert.deepEqual(lookupRoomCode(db, 'OLD123'), { exists: true, finished: true, successorCode: 'NEXT34' });
  assert.deepEqual(lookupRoomCode(db, 'ENDED1'), { exists: true, finished: true });
  assert.deepEqual(lookupRoomCode(db, 'ENDED2'), { exists: true, finished: true });
  for (const code of ['ID1234', 'ZZZZZZ', 'abc234']) assert.deepEqual(lookupRoomCode(db, code), { exists: false });
  assert.equal(db.prepare('SELECT revision FROM rooms WHERE code = ?').get('OLD123')?.revision, 10);
});
