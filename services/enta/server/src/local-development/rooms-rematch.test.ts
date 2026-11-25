import assert from 'node:assert/strict';
import test from 'node:test';
import type { Principal } from '../identity';
import { EntaError } from '../gameplay/types';
import { LOCAL_PROJECT } from './guard';
import { createLocalRooms, type RoomEngine } from './rooms';

const host: Principal = { uid: 'room-owner', projectId: LOCAL_PROJECT, verifiedAccount: true, anonymous: false, email: 'fixture@example.test' };
const other = { ...host, uid: 'another-owner' };

function fixture(engine: RoomEngine) {
  type Store = Parameters<typeof createLocalRooms>[0];
  let state: Parameters<Parameters<Store['transaction']>[0]>[0] = { rooms: [] };
  let pending = Promise.resolve();
  const store: Store = {
    transaction(work) {
      const run = pending.then(async () => {
        const draft = structuredClone(state);
        const result = await work(draft);
        state = draft;
        return result;
      });
      pending = run.then(() => {}, () => {});
      return run;
    },
  };
  const initial = (id: string, owner = host.uid) => ({
    id, owner, version: 1, mode: engine.toUpperCase(), phase: 'BOARD',
    teams: [{ id: 'sun', name: 'الشمس', players: ['ريم'] }, { id: 'moon', name: 'القمر', players: ['عمر'] }],
  });
  const matches = new Map([['old-match', initial('old-match')], ['foreign-match', initial('foreign-match', other.uid)]]);
  const adapter = {
    async get(principal: Principal, id: string) {
      const match = matches.get(id);
      if (match?.owner !== principal.uid) throw new EntaError(404, 'MATCH_NOT_FOUND');
      return { match };
    },
    async command() { throw new Error('No engine commands expected'); },
  };
  const rooms = createLocalRooms(store, { classic: adapter, kids: adapter, round: adapter, competitive: adapter });
  const setFinished = () => { matches.get('old-match')!.phase = 'FINISHED'; };
  const start = async (id = 'successor-match') => {
    const existing = matches.get(id);
    if (existing) return { idempotent: true, match: existing };
    const match = initial(id);
    matches.set(id, match);
    return { idempotent: false, match };
  };
  return { rooms, matches, setFinished, start };
}

test('Enta links a finished room once for its owner and carries both teams and the display', async () => {
  const { rooms, matches, setFinished, start } = fixture('classic');
  const { room } = await rooms.attach(host, { engine: 'classic', matchId: 'old-match', requestKey: 'original-request' });
  await assert.rejects(rooms.joinOptions('E1-NOTFOUND'), /ROOM_NOT_FOUND/);
  const activeOptions = { teams: [{ id: 'sun', name: 'الشمس' }, { id: 'moon', name: 'القمر' }] };
  assert.deepEqual(await rooms.joinOptions(room.code), activeOptions);
  const first = await rooms.join(room.code, { requestKey: 'first-player', name: 'ريم', teamIndex: 0 });
  const second = await rooms.join(room.code, { requestKey: 'second-player', name: 'عمر', teamIndex: 1 });
  const display = await rooms.hostCommand(host, room.code, { commandId: 'display-link', expectedVersion: second.room.version, type: 'DISPLAY' });
  await rooms.hostCommand(host, room.code, { commandId: 'start-match', expectedVersion: display.room.version, type: 'START' });
  const pending = await rooms.join(room.code, { requestKey: 'waiting-player', name: 'سارة' });
  const body = { requestKey: 'rematch-request', logicalMatchId: 'successor-match' };
  await assert.rejects(rooms.rematch(host, 'classic', 'old-match', body, start), /PREDECESSOR_NOT_FINISHED/);
  setFinished();
  assert.deepEqual(await rooms.joinOptions(room.code), { finished: true });
  await assert.rejects(rooms.join(room.code, { requestKey: 'finished-join', name: 'ضيف', teamIndex: 0 }), /ROOM_FINISHED/);
  await assert.rejects(rooms.rematch(other, 'classic', 'old-match', body, start), /ROOM_NOT_FOUND/);
  await Promise.all([rooms.rematch(host, 'classic', 'old-match', body, start), rooms.rematch(host, 'classic', 'old-match', body, start)]);
  await assert.rejects(rooms.rematch(host, 'classic', 'old-match', { ...body, requestKey: 'different-request' }, () => start('foreign-match')), /ROOM_REMATCH_ALREADY_STARTED/);
  assert.equal(matches.size, 3);
  const old = (await rooms.hostView(host, room.code)).room;
  const successor = old.successorCode!;
  assert.equal(old.phase, 'FINISHED');
  assert.deepEqual(await rooms.joinOptions(room.code), { finished: true, successorCode: successor });
  assert.deepEqual(await rooms.joinOptions(successor), activeOptions);
  assert.equal((await rooms.hostView(host, successor)).room.matchId, 'successor-match');
  await assert.rejects(rooms.hostView(other, successor), /ROOM_NOT_FOUND/);
  await assert.rejects(rooms.join(successor, { requestKey: 'impostor-key', name: 'ريم', teamIndex: 1 }), /ROOM_NAME_TAKEN/);
  for (const [guest, name, teamIndex] of [[first, 'ريم', 0], [second, 'عمر', 1]] as const) {
    assert.equal((await rooms.view(room.code, guest.token)).room.successorCode, successor);
    const next = (await rooms.view(successor, guest.token)).room;
    const member = next.members.find(member => member.id === next.self?.id);
    assert.deepEqual([member?.name, member?.teamIndex], [name, teamIndex]);
    assert.equal(next.self?.role, 'MEMBER');
  }
  assert.equal((await rooms.view(room.code, display.token!)).room.successorCode, successor);
  assert.equal((await rooms.view(successor, display.token!)).room.self?.role, 'DISPLAY');
  const lobby = (await rooms.hostView(host, successor)).room;
  assert.equal(lobby.members.some(member => member.name === 'سارة'), false);
  await rooms.hostCommand(host, successor, { commandId: 'start-rematch', expectedVersion: lobby.version, type: 'START' });
  const waiting = (await rooms.view(successor, pending.token)).room;
  assert.equal(waiting.members.find(member => member.id === waiting.self?.id)?.status, 'PENDING');
});

for (const engine of ['round', 'competitive'] as const) {
  test(`Enta ${engine} rematch recovers the same successor after a lost engine response`, async () => {
    const { rooms, matches, setFinished, start } = fixture(engine);
    const { room } = await rooms.attach(host, { engine, matchId: 'old-match', requestKey: 'original-request' });
    setFinished();
    const body = { requestKey: 'rematch-request', logicalMatchId: 'successor-match' };
    await assert.rejects(rooms.rematch(host, engine, 'old-match', body, async () => {
      await start();
      throw new Error('Reply lost after engine commit');
    }), /Reply lost/);
    assert.equal((await rooms.hostView(host, room.code)).room.successorCode, undefined);
    await assert.rejects(rooms.rematch(host, engine, 'old-match', { ...body, requestKey: 'different-request' }, () => start('another-match')), /ROOM_REMATCH_IN_PROGRESS/);
    assert.equal((await rooms.rematch(host, engine, 'old-match', body, start)).idempotent, true);
    const successor = (await rooms.hostView(host, room.code)).room.successorCode!;
    assert.deepEqual(await rooms.joinOptions(room.code), { finished: true, successorCode: successor });
    assert.equal((await rooms.hostView(host, successor)).room.matchId, 'successor-match');
    assert.equal(matches.size, 3);
  });
}

test('Enta refuses a first successor match belonging to a different host', async () => {
  const { rooms, matches, setFinished } = fixture('classic');
  const { room } = await rooms.attach(host, { engine: 'classic', matchId: 'old-match', requestKey: 'original-request' });
  setFinished();
  const body = { requestKey: 'rematch-request', logicalMatchId: 'foreign-match' };
  await assert.rejects(rooms.rematch(host, 'classic', 'old-match', body, async () => ({
    match: matches.get('foreign-match')!,
  })), /MATCH_NOT_FOUND/);
  assert.equal((await rooms.hostView(host, room.code)).room.successorCode, undefined);
});
