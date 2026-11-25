import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AuthoritativeGameService, RoomStore } from '../../server/service.js';
import { localOwnerRoomAccess } from '../../server/local-owned-room-access.js';
import { createLocalOwnedRoom, LocalRoomCreationError } from '../../server/local-owned-room-creation.js';
import { createLocalOwnedRematch } from '../../server/local-owned-room-rematch.js';
import type { GameIntent } from '../../src/features/game/runtime/contracts.js';

test('a two-round match projects one countdown, answer result, turn, and winner to every screen', async (t) => {
  let now = Date.parse('2026-01-01T00:00:00Z');
  const game = new AuthoritativeGameService({ dbPath: ':memory:', clock: () => new Date(now) });
  t.after(() => game.close());
  const host = game.create('Host', true);
  const first = await game.join(host.roomCode, 'ريم', undefined, 'first-player-request');
  const second = await game.join(host.roomCode, 'عمر');
  let intentId = 0;
  async function send(token: string, type: GameIntent['type'], payload: GameIntent['payload'] = {}) {
    const expectedRevision = game.metadata(host.roomId, token).revision;
    return (await game.intent(host.roomId, token, { type, intentId: String(++intentId), expectedRevision, payload })).projection.projection;
  }
  const view = (token: string) => game.metadata(host.roomId, token).projection;
  const actors = [host.token, first.token, second.token, host.audienceToken];
  await send(first.token, 'LOBBY_SET_READY', { ready: true });
  await send(second.token, 'LOBBY_SET_READY', { ready: true });
  assert.equal((await send(host.token, 'START_MATCH')).room.state, 'CELL_SELECTION');
  assert.equal(view(first.token).self?.displayName, 'ريم');
  assert.equal(view(second.token).self?.displayName, 'عمر');
  const firstIsHorizontal = view(first.token).self?.team === 'horizontal';
  const horizontal = firstIsHorizontal ? first : second;
  const vertical = firstIsHorizontal ? second : first;

  for (let round = 1; round <= 2; round++) {
    for (let column = 0; column < 5; column++) {
      const selected = await send(host.token, 'SELECT_CELL', { cellId: `cell-${column}-0` });
      assert.equal(selected.room.state, 'QUESTION_READING');
      assert.ok(selected.deadlineAt);
      assert.deepEqual(actors.map(token => view(token).deadlineAt), actors.map(() => selected.deadlineAt));
      if (round === 1 && column === 0) {
        await send(vertical.token, 'BUZZ');
        assert.equal(view(horizontal.token).buzzWinner?.displayName, view(vertical.token).self?.displayName);
        assert.equal(view(horizontal.token).self?.isBuzzWinner, undefined);
        assert.equal(view(vertical.token).self?.isBuzzWinner, true);
        await send(host.token, 'JUDGE_INCORRECT');
        assert.equal(view(horizontal.token).answerFeedback?.outcome, 'incorrect');
        assert.equal(view(vertical.token).buzzWinner, undefined);
        assert.equal(view(horizontal.token).self?.canBuzz, true);
      }
      await send(horizontal.token, 'BUZZ');
      await send(host.token, 'JUDGE_CORRECT');
      for (const token of actors) {
        const current = view(token);
        assert.equal(current.buzzWinner, undefined);
        assert.equal(current.self?.isBuzzWinner, undefined);
        assert.deepEqual(current.answerFeedback, { outcome: 'correct', team: 'horizontal', expiresAt: new Date(now + 3_000).toISOString() });
        assert.equal(current.board?.filter(cell => cell.owner === 'horizontal').length, column + 1);
        assert.equal(current.questionScores?.horizontal, (round - 1) * 5 + column + 1);
        if (column < 4) assert.equal(current.entitledTeam, 'horizontal');
      }
      now += 3_000;
      assert.equal(view(horizontal.token).answerFeedback, undefined);
    }
    if (round === 1) {
      assert.equal(view(host.token).room.state, 'ROUND_COMPLETE');
      assert.equal((await send(host.token, 'START_NEXT_ROUND')).room.state, 'CELL_SELECTION');
    }
  }
  for (const token of actors) {
    assert.equal(view(token).room.state, 'MATCH_COMPLETE');
    assert.equal(view(token).matchWinner, 'horizontal');
    assert.deepEqual(view(token).roundWins, { horizontal: 2, vertical: 0 });
  }
  await assert.rejects(game.join(host.roomCode, 'New player'), /MATCH_COMPLETE/);
  const replay = await game.join(host.roomCode, 'ريم', undefined, 'first-player-request');
  assert.equal(replay.token, first.token);
  assert.equal(replay.revision, game.metadata(host.roomId, host.token).revision);
});

test('join key replays once, rejects changes, and cannot regain a reclaimed seat', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-join-receipt-'));
  const options = { dbPath: join(dir, 'rooms.sqlite'), secret: 'isolated join receipt test' };
  let game = new AuthoritativeGameService(options);
  t.after(async () => { game.close(); await rm(dir, { recursive: true, force: true }); });
  const host = game.create('Host', true);
  const joinKey = 'phase3-join-in-flight';
  const [first, replay] = await Promise.all([
    game.join(host.roomCode.toLowerCase(), ' Zoë ', undefined, joinKey),
    game.join(host.roomCode, 'Zoe\u0308', undefined, joinKey),
  ]);
  assert.deepEqual(first, replay);
  await assert.rejects(game.join(host.roomCode, 'Someone else', undefined, joinKey), /JOIN_REQUEST_KEY_CONFLICT/);
  await assert.rejects(game.join(host.roomCode, 'ZOË', undefined, 'different-request-key'), /DUPLICATE_DISPLAY_NAME/);
  for (const invalid of ['\u202EAhmad', '--- 😀', '\u200B', 'a'.repeat(31)])
    await assert.rejects(game.join(host.roomCode, invalid), /INVALID_DISPLAY_NAME/);
  const original = game.metadata(host.roomId, first.token).projection;
  assert.equal(original.room.memberCount, 1);
  assert.ok(original.self?.seatId);
  game.close();
  game = new AuthoritativeGameService(options);
  assert.deepEqual(await game.join(host.roomCode, 'Zoë', undefined, joinKey), first);
  game.playerTransportObserved(host.roomId, original.self.uid);
  const reclaimed = await game.join(host.roomCode, 'Zoë', undefined, 'reclaimed-request-key');
  const next = game.metadata(host.roomId, reclaimed.token).projection;
  assert.equal(next.self?.seatId, original.self.seatId);
  assert.equal(next.self?.team, original.self.team);
  assert.equal(next.room.memberCount, 1);
  assert.equal(next.room.members?.find(member => member.seatId === next.self?.seatId)?.uid, undefined);
  assert.throws(() => game.metadata(host.roomId, first.token), /UNAUTHORIZED/);
  await assert.rejects(game.join(host.roomCode, 'Zoë', undefined, joinKey), /SEAT_REMOVED/);
});

test('manual players use the same name rule without blocking a disconnected seat from reclaim', async (t) => {
  const game = new AuthoritativeGameService({ dbPath: ':memory:' });
  t.after(() => game.close());
  const host = game.create('Host', true);
  const player = await game.join(host.roomCode, 'Zoë');
  const prior = game.metadata(host.roomId, player.token).projection.self!;
  game.playerTransportObserved(host.roomId, prior.uid);
  let intentId = 0;
  const add = (displayName: string) => game.intent(host.roomId, host.token, {
    type: 'LOBBY_ADD_MANUAL_PLAYER', intentId: String(++intentId), expectedRevision: game.metadata(host.roomId, host.token).revision,
    payload: { displayName, team: 'vertical' },
  });
  await assert.rejects(add('ZOE\u0308'), /DUPLICATE_DISPLAY_NAME/);
  await assert.rejects(add('A\u202EB'), /INVALID_DISPLAY_NAME/);
  assert.equal(game.metadata(host.roomId, host.token).revision, player.revision);
  const added = await add(' Cafe\u0301 ');
  assert.equal(added.projection.projection.room.members?.find(member => member.participation === 'manual')?.displayName, 'Café');
  await assert.rejects(add('CAFÉ'), /DUPLICATE_DISPLAY_NAME/);
  const reclaimed = await game.join(host.roomCode, 'Zoë');
  assert.equal(game.metadata(host.roomId, reclaimed.token).projection.self?.seatId, prior.seatId);
});

test('deadline lookup migrates stored rooms and tracks deadlines and challenges through writes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-deadline-index-'));
  const file = join(dir, 'old-rooms.sqlite');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const now = '2026-01-01T00:00:03.000Z';
  const old = new DatabaseSync(file);
  old.exec('CREATE TABLE rooms (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL)');
  const insert = old.prepare('INSERT INTO rooms(id, code, revision, data) VALUES (?,?,0,?)');
  insert.run('due', 'DUE', JSON.stringify({ id: 'due', code: 'DUE', revision: 0, deadlineAt: now }));
  insert.run('future', 'FUTURE', JSON.stringify({ id: 'future', code: 'FUTURE', revision: 0, deadlineAt: '2026-01-01T00:00:04.000Z' }));
  insert.run('challenge', 'CHALLENGE', JSON.stringify({ id: 'challenge', code: 'CHALLENGE', revision: 0, deadlineAt: now, challenge: {} }));
  insert.run('idle', 'IDLE', '{}');
  old.close();

  const store = new RoomStore(file);
  try {
    assert.deepEqual(store.tickCandidateIds(now).sort(), ['challenge', 'due']);
    assert.deepEqual(store.tickCandidateIds('2026-01-01T00:00:04.000Z').sort(), ['challenge', 'due', 'future']);
    const due = store.load('due')!;
    store.save({ ...due, id: 'due', code: 'DUE', revision: 0, deadlineAt: undefined });
    const challenge = store.load('challenge')!;
    store.commit({ ...challenge, id: 'challenge', code: 'CHALLENGE', revision: 1, deadlineAt: undefined, challenge: undefined }, { type: 'CONTINUE' }, now);
    assert.deepEqual(store.tickCandidateIds(now), []);
  } finally { store.close(); }
});

test('timeout and a missed second answer publish distinct reasons and finishing requires the host', async (t) => {
  let now = Date.parse('2026-01-01T00:00:00Z');
  const game = new AuthoritativeGameService({ dbPath: ':memory:', clock: () => new Date(now) });
  t.after(() => game.close());
  const host = game.create('Host', true);
  let intentId = 0;
  const send = async (type: GameIntent['type'], payload: GameIntent['payload'] = {}, token = host.token) => {
    const expectedRevision = game.metadata(host.roomId, token).revision;
    return (await game.intent(host.roomId, token, { type, intentId: String(++intentId), expectedRevision, payload })).projection.projection;
  };
  await send('START_MATCH');
  const selected = await send('SELECT_CELL', { cellId: 'cell-0-0' });
  now = Date.parse(selected.deadlineAt!);
  assert.deepEqual(await game.tick(), [host.roomId]);
  const failed = game.metadata(host.roomId, host.audienceToken).projection;
  assert.equal(failed.questionFailedReason, 'no-answer');
  assert.equal(failed.deadlineAt, undefined);
  assert.equal((await send('RETURN_CELL')).room.state, 'CELL_SELECTION');
  await send('SELECT_CELL', { cellId: 'cell-1-0' });
  await send('HOST_SELECT_TEAM', { team: 'horizontal' });
  await send('JUDGE_INCORRECT');
  await send('HOST_SELECT_TEAM', { team: 'vertical' });
  const wrong = await send('JUDGE_INCORRECT');
  assert.equal(wrong.questionFailedReason, 'incorrect');
  assert.equal(wrong.answerFeedback, undefined);
  assert.equal(wrong.buzzWinner, undefined);
  await assert.rejects(send('END_WITHOUT_WINNER', {}, host.audienceToken), /FORBIDDEN_ROLE/);
  assert.equal((await send('END_WITHOUT_WINNER')).endedWithoutWinner, true);
});

test('verified owners can restore by short code and receive a terminal rematch source error', async (t) => {
  const environment = { ALMAIDAN_LOCAL_ONLY: 'true', FIREBASE_PROJECT_ID: 'demo-almaidan-local', GAME_HOST: '127.0.0.1', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099' };
  const previous = Object.keys(environment).map(key => [key, process.env[key]] as const);
  Object.assign(process.env, environment);
  const game = new AuthoritativeGameService({ dbPath: ':memory:' });
  t.after(() => {
    game.close();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const claims = (uid: string) => async () => ({ aud: 'demo-almaidan-local', iss: 'https://securetoken.google.com/demo-almaidan-local', sub: uid, uid, currentUser: { disabled: false, emailVerified: true, email: 'fixture@example.test' }, firebase: { sign_in_provider: 'password' } });
  const owner = claims('phase3-owner');
  const identity = 'Bearer fixture';
  const host = await createLocalOwnedRoom(game, identity, { demo: true, requestKey: 'fixture-creation' }, owner);
  const restored = await localOwnerRoomAccess(game, identity, host.roomCode.toLowerCase(), owner);
  assert.equal(restored.roomId, host.roomId);
  assert.equal(restored.token, host.token);
  await assert.rejects(localOwnerRoomAccess(game, identity, host.roomCode, claims('other-host')), /LOCAL_OWNED_ROOM_NOT_FOUND/);
  const request = { requestKey: 'fixture-rematch' };
  await assert.rejects(createLocalOwnedRematch(game, identity, host.token, host.roomId, request, owner), /LOCAL_REMATCH_NOT_FINISHED/);
  for (const type of ['START_MATCH', 'PAUSE', 'END_WITHOUT_WINNER'] as const) {
    await game.intent(host.roomId, host.token, { type, intentId: type, expectedRevision: game.metadata(host.roomId, host.token).revision, payload: {} });
  }
  await assert.rejects(createLocalOwnedRematch(game, identity, host.token, host.roomId, request, owner),
    error => error instanceof LocalRoomCreationError && error.status === 422 && error.message === 'LOCAL_REMATCH_SOURCE_UNAVAILABLE');
  assert.equal(game.store.rooms().length, 1);
});
