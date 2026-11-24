import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthoritativeGameService } from '../../server/service.js';
import { reduceGame, initialGameState, type GameState } from '../../src/features/game/domain/lifecycle.js';

async function withService(run: (service: AuthoritativeGameService) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'huroof-review-')); const service = new AuthoritativeGameService({ dbPath: join(dir, 'rooms.sqlite'), secret: 'test' });
  try { await run(service); } finally { service.close(); await rm(dir, { recursive: true, force: true }); }
}
async function lobby(service: AuthoritativeGameService) {
  const host = service.create('host', true, { questionSeconds: 10, opponentSeconds: 10 });
  const one = await service.join(host.roomCode, 'one'); const two = await service.join(host.roomCode, 'two');
  let revision = two.revision;
  const as = async (token: string, type: string, payload: Record<string, unknown> = {}) => { revision = service.store.load(host.roomId)!.revision; const result = await service.intent(host.roomId, token, { type: type as never, intentId: `${type}-${revision}`, expectedRevision: revision, payload }); revision = result.revision; return result; };
  return { host, one, two, as, hostIntent: (type: string, payload: Record<string, unknown> = {}) => as(host.token, type, payload) };
}

test('a forged token with multi-byte characters is rejected instead of throwing', async () => withService(async (service) => {
  const { host } = await lobby(service);
  const [encoded, signature] = host.token.split('.');
  const forged = `${encoded}.${'é'.repeat(signature.length)}`;
  assert.equal(forged.split('.')[1].length, signature.length);
  assert.equal(service.verify(forged), undefined);
}));

test('the host can remove a stale lobby seat so the match can start; removal is lobby-only', async () => withService(async (service) => {
  const room = await lobby(service);
  await room.as(room.one.token, 'LOBBY_SET_READY', { ready: true });
  const stale = await service.join(room.host.roomCode, 'one-again');
  const ghost = service.metadata(room.host.roomId, room.host.token).projection.room.members!.find(member => member.displayName === 'two')!;
  await assert.rejects(room.hostIntent('START_MATCH'), /LOBBY_ALL_MEMBERS_MUST_BE_READY/);
  await assert.rejects(room.as(room.one.token, 'LOBBY_REMOVE_PARTICIPANT', { memberUid: ghost.uid }), /FORBIDDEN_ROLE|UNAUTHORIZED|HOST/);
  await room.hostIntent('LOBBY_REMOVE_PARTICIPANT', { memberUid: ghost.uid });
  const staleMember = service.metadata(room.host.roomId, room.host.token).projection.room.members!.find(member => member.displayName === 'one-again')!;
  await room.hostIntent('LOBBY_REMOVE_PARTICIPANT', { memberUid: staleMember.uid });
  assert.deepEqual(service.metadata(room.host.roomId, room.host.token).projection.room.members!.filter(member => member.role === 'player').map(member => member.displayName), ['one']);
  assert.throws(() => service.metadata(room.host.roomId, stale.token), /UNAUTHORIZED|NOT_MEMBER|FORBIDDEN/);
  await room.hostIntent('LOBBY_ADD_MANUAL_PLAYER', { displayName: 'يدوي', team: 'vertical' });
  await room.hostIntent('START_MATCH');
  const player = service.metadata(room.host.roomId, room.host.token).projection.room.members!.find(member => member.displayName === 'one')!;
  await assert.rejects(room.hostIntent('LOBBY_REMOVE_PARTICIPANT', { memberUid: player.uid }), /LOBBY_REMOVAL_NOT_ALLOWED/);
}));

test('after revealing the answer the host can close an unanswered question; it cannot be closed mid-answer', async () => withService(async (service) => {
  const room = await lobby(service);
  await room.as(room.one.token, 'LOBBY_SET_READY', { ready: true }); await room.as(room.two.token, 'LOBBY_SET_READY', { ready: true });
  await room.hostIntent('START_MATCH'); await room.hostIntent('ROUND_READY');
  const board = service.metadata(room.host.roomId, room.host.token).projection.board!;
  await room.hostIntent('SELECT_CELL', { cellId: board.find(cell => cell.kind === 'letter')!.id });
  const stored = service.store.load(room.host.roomId)!;
  if (stored.game.lifecycle === 'LETTER_REVEAL') await room.hostIntent('LETTER_REVEALED');
  assert.equal(service.store.load(room.host.roomId)!.game.lifecycle, 'QUESTION_READING');
  await room.hostIntent('REVEAL_ANSWER', { occurrence: service.store.load(room.host.roomId)!.activeQuestionOccurrence! });
  const closed = await room.hostIntent('CLOSE_QUESTION');
  assert.equal(closed.projection.projection.room.state, 'QUESTION_FAILED');
  await room.hostIntent('RETRY_CELL');
  await room.hostIntent('SELECT_CELL', { cellId: service.metadata(room.host.roomId, room.host.token).projection.board!.find(cell => cell.kind === 'letter' && !cell.owner && cell.id !== board.find(c => c.kind === 'letter')!.id)!.id });
  if (service.store.load(room.host.roomId)!.game.lifecycle === 'LETTER_REVEAL') await room.hostIntent('LETTER_REVEALED');
  await room.hostIntent('HOST_SELECT_TEAM', { team: 'horizontal' });
  await assert.rejects(room.hostIntent('CLOSE_QUESTION'), /CLOSE_QUESTION_NOT_ALLOWED/);
}));

test('corrections are limited to settled board states', () => {
  const settled: GameState = { ...initialGameState(), lifecycle: 'CELL_SELECTION', board: { cells: [] } as never };
  assert.equal(reduceGame(settled, { type: 'BEGIN_CORRECTION', cellId: 'cell-0-0', reason: 'x' }).lifecycle, 'CORRECTION');
  for (const lifecycle of ['QUESTION_READING', 'FIRST_ANSWER', 'OPPONENT_CHANCE', 'PAUSED'] as const)
    assert.throws(() => reduceGame({ ...settled, lifecycle }, { type: 'BEGIN_CORRECTION', cellId: 'cell-0-0', reason: 'x' }));
});

test('the room tick skips idle rooms and survives a room that cannot advance', async () => withService(async (service) => {
  const room = await lobby(service);
  assert.deepEqual(service.store.tickCandidateIds(), []);
  const stored = service.store.load(room.host.roomId)!;
  service.store.save({ ...stored, buzzOpen: true, deadlineAt: new Date(Date.now() - 1000).toISOString(), game: { ...stored.game, lifecycle: 'QUESTION_READING' }, challenge: { broken: true } as never, activeQuestion: { challenge: true } as never });
  assert.deepEqual(service.store.tickCandidateIds(), [room.host.roomId]);
  const original = console.error; const logged: string[] = []; console.error = (line: string) => { logged.push(line); };
  try { assert.deepEqual(await service.tick(), []); assert.deepEqual(await service.tick(), []); } finally { console.error = original; }
  assert.equal(logged.filter(line => line.startsWith('ROOM_TICK_FAILED')).length, 1, 'each distinct failure is reported once');
}));
