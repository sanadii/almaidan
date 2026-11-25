import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalRooms, type LocalRoomStore, type RoomAdapter } from './rooms';
import { createLocalRoomsRouter } from './rooms-router';
import { LOCAL_PROJECT } from './guard';

const host = { projectId: LOCAL_PROJECT, uid: 'phase-four-host', email: 'host@example.test', verifiedAccount: true, anonymous: false };

async function fixture(engine: 'classic' | 'competitive' = 'classic') {
  let clock = 10_000;
  let state: Parameters<Parameters<LocalRoomStore['transaction']>[0]>[0] = { rooms: [] };
  let match = { id: 'phase-four-match', mode: 'CLASSIC', version: 1, phase: 'BOARD', teams: [
    { id: 'team-sun', name: 'الشمس', players: engine === 'classic' ? [] : [{ id: 'slot', name: 'لاعب 1' }], score: 0 },
    { id: 'team-moon', name: 'القمر', players: [], score: 0 },
  ] };
  const store: Pick<LocalRoomStore, 'transaction'> = {
    transaction: async work => {
      const next = structuredClone(state);
      const data = await work(next);
      state = next;
      return data;
    },
  };
  const adapter: RoomAdapter = {
    get: async () => ({ ...match, serverNow: clock }),
    command: async (_owner, _id, input) => {
      const command = input as { type: string; teamId: string | null };
      match = { ...match, version: match.version + 1, teams: match.teams.map(team => team.id === command.teamId ? { ...team, score: team.score + 200 } : team) };
      return { match };
    },
  };
  const rooms = createLocalRooms(store, { classic: adapter, kids: adapter, competitive: adapter, round: adapter }, () => clock);
  const { room } = await rooms.attach(host, { engine, matchId: match.id, requestKey: randomUUID() });
  const code = room.code;
  const getRoom = async () => (await rooms.hostView(host, code)).room;
  return {
    rooms, code, getRoom, matchId: match.id,
    advance: (ms: number) => { clock += ms; },
    join: (name: string, teamIndex?: number, requestKey = randomUUID()) => rooms.join(code, { name, teamIndex, requestKey }),
    command: async (type: string, command: object = {}) => rooms.hostCommand(host, code, { type, expectedVersion: (await getRoom()).version, commandId: randomUUID(), ...command }),
  };
}

test('team choice creates a named seat even with no configured players, and late joins wait for the host', async () => {
  const { rooms, code, join, command, matchId } = await fixture();
  assert.deepEqual(await rooms.joinOptions(code), { teams: [{ id: 'team-sun', name: 'الشمس' }, { id: 'team-moon', name: 'القمر' }] });
  const first = await join('نور', 0), second = await join('سارة', 0);
  assert.deepEqual(second.room.teams[0].players, ['نور', 'سارة']);
  assert.deepEqual(second.room.members.map(member => [member.teamIndex, member.playerIndex]), [[0, 0], [0, 1]]);
  assert.equal((await command('START')).room.phase, 'PLAYING');
  const late = await join('محمد', 1);
  assert.equal(late.room.match, null);
  const ownerView = await rooms.hostViewForMatch(host, 'classic', matchId);
  assert.equal(ownerView.room?.members.find(member => member.id === late.memberId)?.status, 'PENDING');
  assert.deepEqual(await rooms.hostViewForMatch({ ...host, uid: 'other' }, 'classic', matchId), { room: null });
  await command('ADMIT', { memberId: late.memberId });
  assert.ok((await rooms.view(code, late.token)).room.match);
  assert.equal((await rooms.view(code, first.token)).room.members.find(member => member.id === late.memberId)?.teamIndex, 1);
});

test('auto-assignment balances unseated guests while preserving selected teams and retry identity', async () => {
  const { join, command, getRoom } = await fixture();
  const requestKey = randomUUID(), first = await join('نور', 0, requestKey);
  assert.equal((await join('نور', 0, requestKey)).memberId, first.memberId);
  await assert.rejects(join('نور', 1, requestKey), /ROOM_KEY_CONFLICT/);
  await join('سارة');
  await join('محمد');
  await join('ريم');
  await assert.rejects(command('START'), /ROOM_ASSIGNMENT_REQUIRED/);
  await command('AUTO_ASSIGN');
  const room = await getRoom();
  assert.deepEqual(room.members.map(member => member.teamIndex), [0, 1, 0, 1]);
  assert.deepEqual(room.teams.map(team => team.players), [['نور', 'محمد'], ['سارة', 'ريم']]);
});

test('active and recently hidden tabs keep their seat, while leave or lease expiry permits same-seat reclaim', async () => {
  const { rooms, code, join, advance, command } = await fixture();
  const guest = await join('  نور  ', 0);
  await assert.rejects(join('نور', 1), /ROOM_NAME_TAKEN/);
  await assert.rejects(join('ن\u202eور', 0), /INVALID_ROOM_NAME/);
  await rooms.idle(code, guest.token);
  advance(16_000);
  await assert.rejects(join('نور', 1), /ROOM_NAME_TAKEN/);
  await command('START');
  await command('LOCK', { locked: true });
  await rooms.leave(code, guest.token);
  const reclaimed = await join('نور', 1);
  assert.equal(reclaimed.memberId, guest.memberId);
  assert.equal(reclaimed.room.members[0].teamIndex, 0);
  assert.equal(reclaimed.room.members[0].status, 'ADMITTED');
  await assert.rejects(rooms.view(code, guest.token), /ROOM_CAPABILITY_DENIED/);
  await assert.rejects(rooms.leave(code, guest.token), /ROOM_CAPABILITY_DENIED/);
  advance(16_000);
  const secondReclaim = await join('نور', 1);
  assert.equal(secondReclaim.memberId, guest.memberId);
  assert.equal(secondReclaim.room.members[0].playerIndex, 0);
});

test('feedback expires from the authoritative snapshot and classic private reads are empty for a valid token', async () => {
  const { rooms, code, join, command, advance, matchId } = await fixture();
  const player = await join('نور', 0);
  await command('START');
  const display = await command('DISPLAY');
  await rooms.directEngineMutation(host, 'classic', matchId, { type: 'ADJUDICATE', questionId: 'one', teamId: 'team-sun' });
  assert.deepEqual((await rooms.view(code, display.token!)).room.feedback?.awards, [{ teamId: 'team-sun', points: 200 }]);
  advance(3000);
  assert.equal((await rooms.view(code, player.token)).room.feedback, null);
  await rooms.engineCommand(host, code, { command: { type: 'ADJUDICATE', questionId: 'two', teamId: null } });
  assert.deepEqual((await rooms.view(code, display.token!)).room.feedback?.awards, []);
  assert.deepEqual(await rooms.privateView(code, player.token), { capability: null });
  assert.deepEqual(await rooms.privateView(code, display.token!), { capability: null });
  await assert.rejects(rooms.privateView(code, 'invalid'), /ROOM_CAPABILITY_DENIED/);
});

test('the private HTTP route sends an empty 204 only for a valid room credential', async () => {
  const { rooms, code, join, command } = await fixture();
  const player = await join('نور', 0);
  await command('START');
  const router = createLocalRoomsRouter(rooms, (_req, _res, next) => next());
  const read = (token: string) => new Promise<{ status: number; body?: unknown }>((resolve, reject) => {
    let status = 200;
    const request = { method: 'GET', url: `/${code}/private`, get: () => token };
    const response = {
      setHeader: () => {},
      status: (value: number) => { status = value; return response; },
      end: () => resolve({ status }),
      json: (body: unknown) => resolve({ status, body }),
    };
    router(request as unknown as Parameters<typeof router>[0], response as unknown as Parameters<typeof router>[1], error => reject(error ?? new Error('NO_ROUTE_MATCH')));
  });
  assert.deepEqual(await read(player.token), { status: 204 });
  assert.deepEqual(await read('bad-capability'), { status: 403, body: { error: 'ROOM_CAPABILITY_DENIED' } });
});
