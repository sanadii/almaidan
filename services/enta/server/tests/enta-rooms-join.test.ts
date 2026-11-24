import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalRooms, type LocalRoomStore, type RoomAdapter } from '../src/local-development/rooms';
import { LOCAL_PROJECT } from '../src/local-development/guard';

// In-memory stand-in for the single-row room state table; no database is used.
function memoryStore(): LocalRoomStore {
  const state = { rooms: [] as unknown[] };
  let queue: Promise<unknown> = Promise.resolve();
  const transaction = <T>(work: (s: typeof state) => Promise<T>): Promise<T> => {
    const run = queue.then(async () => { const draft = structuredClone(state); const result = await work(draft); state.rooms = draft.rooms; return result; });
    queue = run.catch(() => undefined); return run;
  };
  return { transaction } as unknown as LocalRoomStore;
}
const host = { projectId: LOCAL_PROJECT, uid: `rooms-join-${randomUUID()}`, email: 'host@example.test', verifiedAccount: true, anonymous: false };
const match = { id: 'join-match', version: 1, phase: 'BOARD', mode: 'CLASSIC', teams: [{ id: 't1', name: 'الأول', players: ['نور', 'علي'] }, { id: 't2', name: 'الثاني', players: ['ريم'] }] };
async function room() {
  const adapter: RoomAdapter = { get: async () => structuredClone(match), command: async () => ({}) };
  const rooms = createLocalRooms(memoryStore(), { classic: adapter, kids: adapter, round: adapter, competitive: adapter });
  const attached = await rooms.attach(host, { engine: 'classic', matchId: match.id, requestKey: randomUUID() });
  return { rooms, code: attached.room.code };
}

test('a repeated join key re-issues the same member capability and retires the unseen token', async () => {
  const { rooms, code } = await room(), requestKey = randomUUID();
  const first = await rooms.join(code, { name: 'نور', requestKey });
  const replay = await rooms.join(code, { name: 'نور', requestKey });
  assert.equal(replay.memberId, first.memberId); assert.equal(replay.idempotent, true); assert.equal(replay.tokenUnavailable, false);
  assert.match(replay.token!, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(replay.token, first.token);
  assert.equal((await rooms.view(code, replay.token!)).room.self!.id, first.memberId);
  await assert.rejects(rooms.view(code, first.token!), /ROOM_CAPABILITY_DENIED/);
  assert.equal((await rooms.hostView(host, code)).room.members.length, 1);
  await assert.rejects(rooms.join(code, { name: 'سارة', requestKey }), /ROOM_KEY_CONFLICT/);
});

test('a member whose reply was lost can recover after the host locks joining', async () => {
  const { rooms, code } = await room(), requestKey = randomUUID();
  const first = await rooms.join(code, { name: 'نور', requestKey }), version = (await rooms.hostView(host, code)).room.version;
  await rooms.hostCommand(host, code, { commandId: randomUUID(), expectedVersion: version, type: 'LOCK', locked: true });
  await assert.rejects(rooms.join(code, { name: 'علي', requestKey: randomUUID() }), /ROOM_LOCKED/);
  const replay = await rooms.join(code, { name: 'نور', requestKey });
  assert.equal(replay.memberId, first.memberId); assert.ok(replay.token);
});

test('display names are unique among current members, case-insensitively, and free again after removal', async () => {
  const { rooms, code } = await room();
  const noor = await rooms.join(code, { name: 'Noor', requestKey: randomUUID() });
  await assert.rejects(rooms.join(code, { name: 'noor', requestKey: randomUUID() }), /ROOM_NAME_TAKEN/);
  const version = (await rooms.hostView(host, code)).room.version;
  await rooms.hostCommand(host, code, { commandId: randomUUID(), expectedVersion: version, type: 'REMOVE', memberId: noor.memberId });
  const again = await rooms.join(code, { name: 'noor', requestKey: randomUUID() });
  assert.notEqual(again.memberId, noor.memberId);
});

test('REVOKE_DISPLAY clears every display link so a new one can be issued after the limit', async () => {
  const { rooms, code } = await room(); let version = (await rooms.hostView(host, code)).room.version;
  const tokens: string[] = [];
  for (let n = 0; n < 8; n++) { const issued = await rooms.hostCommand(host, code, { commandId: randomUUID(), expectedVersion: version, type: 'DISPLAY' }); tokens.push(issued.token!); version = issued.room.version; }
  await assert.rejects(rooms.hostCommand(host, code, { commandId: randomUUID(), expectedVersion: version, type: 'DISPLAY' }), /DISPLAY_LIMIT/);
  version = (await rooms.hostCommand(host, code, { commandId: randomUUID(), expectedVersion: version, type: 'REVOKE_DISPLAY' })).room.version;
  await assert.rejects(rooms.view(code, tokens[0]), /ROOM_CAPABILITY_DENIED/);
  assert.ok((await rooms.hostCommand(host, code, { commandId: randomUUID(), expectedVersion: version, type: 'DISPLAY' })).token);
});
