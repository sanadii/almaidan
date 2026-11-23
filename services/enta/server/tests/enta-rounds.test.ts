import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { createApp } from '../src/app';
import { createRoundService, createRoundServiceForTest } from '../src/rounds/service';
import { parseCanvasCommand, parseHostCommand, parseRoundStart } from '../src/rounds/validation';
import { productionFormatPolicy, selectRoundPins, validateMedia } from '../src/rounds/selection';
import { reduceCanvas, newCanvas } from '../src/rounds/canvas';
import { mediaRange } from '../src/rounds/media';
import { admissionHash } from '../src/admission/huroof-protocol.cjs';
import { fixtureByteReader, fixtureBytes, fixtureFormatCatalog, fixtureMedia, fixturePrincipal, fixtureProject, fixtureRoundStart, RoundFixtureRepository } from './enta-round-fixture';
import type { projectRoundGame } from '../src/rounds/projection';
type Match = ReturnType<typeof projectRoundGame>;
const action = (match: Match, command: Record<string, unknown>) => ({ commandId: randomUUID(), expectedVersion: match.version, ...command });
export async function roundHttp(t: Pick<TestContext, 'after'>, repository = new RoundFixtureRepository()) {
  const service = createRoundServiceForTest(repository, () => {}), reader = fixtureByteReader();
  const app = createApp({ config: { environment: 'test', firebaseProjectId: fixtureProject, namespaceId: 'fixture-namespace', allowDevMocks: false }, roundService: service, mediaReader: reader,
    verifyIdToken: async token => { if (!['host', 'other'].includes(token)) throw Error('invalid fixture token'); const uid = token === 'host' ? fixturePrincipal.uid : 'fixture-other'; return { aud: fixtureProject, iss: `https://securetoken.google.com/${fixtureProject}`, sub: uid, uid, firebase: { sign_in_provider: 'password' }, currentUser: { disabled: false, emailVerified: true, email: 'fixture@example.invalid' } }; }, identityStore: { async assertDeploymentNamespace() {}, async getAdminScopes() { return []; }, async upsertIdentity() {} },
  }); const server = createServer(app); await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); assert.ok(address && typeof address !== 'string'); t.after(() => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))); const origin = `http://127.0.0.1:${address.port}`;
  return { repository, service, reader, origin, request: (path: string, body?: unknown, token = 'host', headers: Record<string, string> = {}) => fetch(`${origin}/api/v1/enta${path}`, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) }) };
}
test('mounted unaligned 1MiB protected range verifies five full provider chunks, not only returned slice', async t => {
  const repository = new RoundFixtureRepository(), bytes = Uint8Array.from({ length: 5 * 262144 + 7 }, (_, n) => n % 251), hash = (part: Uint8Array) => createHash('sha256').update(part).digest('hex');
  // Large synthetic video bytes exercise integrity/range accounting only;
  // actual decoding uses the separate375883-byte immutable MP4 browser fixture.
  const pin = repository.catalogValue.categories[0].prompts[0], media = pin.media[0]; Object.assign(media, { mime: 'video/mp4', durationMs: 1000, codec: 'h264', bytes: bytes.length, sha256: hash(bytes), chunks: Array.from({ length: 6 }, (_, ordinal) => { const part = bytes.subarray(ordinal * 262144, Math.min(bytes.length, (ordinal + 1) * 262144)); return { ordinal, byteLength: part.length, sha256: hash(part) }; }) }); fixtureBytes.set(media.id, bytes);
  const { formatHash: previousHash, ...payload } = pin; void previousHash; pin.formatHash = admissionHash({ version: 1, pin: payload });
  const { request, reader } = await roundHttp(t, repository); let match: Match = (await (await request('/matches/mixed', fixtureRoundStart('MIXED_BOARD', 'chunk-range'))).json()).match;
  const round = match.rounds.find(row => row.format === 'LIST_ITEMS')!; match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'OPEN_ROUND', roundId: round.id }))).json()).match;
  const providerReads: [number, number][] = [], original = reader.read.bind(reader); reader.read = async (pin, start, length) => { providerReads.push([start, length]); return original(pin, start, length); };
  const response = await request(`/round-matches/${match.id}/media/${media.id}`, undefined, 'host', { range: 'bytes=131072-1179647' }); assert.equal(response.status, 206); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.subarray(131072, 1179648)); assert.deepEqual(providerReads, Array.from({ length: 5 }, (_, ordinal) => [ordinal * 262144, 262144]));
  // Corruption precedes the requested slice yet must invalidate its proof.
  reader.corrupt = true; assert.equal((await request(`/round-matches/${match.id}/media/${media.id}`, undefined, 'host', { range: 'bytes=131072-1179647' })).status, 503);
});
test('mounted HTTP standalone LIST/ACTING four-round loops, current grading, negative trap, reload/result and one paid debit', async t => {
  const { request, repository } = await roundHttp(t);
  for (const [name, format] of [['list', 'STANDALONE_LIST'], ['acting', 'STANDALONE_ACTING']] as const) {
    assert.equal((await request(`/catalog/${name}`)).status, 200);
    let match: Match = (await (await request(`/matches/${name}`, fixtureRoundStart(format, name))).json()).match; assert.equal(match.rounds.length, 4);
    for (let index = 0; index < 4; index++) {
      match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'NEXT_ROUND' }))).json()).match; const current = match.currentRound!;
      assert.ok(!JSON.stringify(match).includes('تفاحة')); assert.ok(!JSON.stringify(match).includes('objectKey'));
      const grading = await (await request(`/round-matches/${match.id}/rounds/${current.id}/grading`)).json(); assert.equal(grading.items.length, 3);
      assert.equal((await request(`/round-matches/${match.id}/media/${grading.items[0].media[0].id}`)).status, 403);
      assert.equal((await request(`/round-matches/${match.id}/rounds/${current.id}/grading/media/${grading.items[0].media[0].id}`)).status, 200);
      assert.equal((await request(`/round-matches/${match.id}/rounds/foreign/grading/media/${grading.items[0].media[0].id}`)).status, 403);
      const trap = await request(`/round-matches/${match.id}/commands`, action(match, { type: 'JUDGE_ITEM', roundId: current.id, itemId: grading.items[2].id })); assert.equal(trap.status, 200); match = (await trap.json()).match;
      assert.ok(match.teams.some(team => team.score < 0));
      match = (await (await request(`/round-matches/${match.id}`)).json()); assert.equal(match.currentRound!.id, current.id);
      const deadline = match.currentRound!.turnDeadline;
      const consumed = await request(`/round-matches/${match.id}/commands`, action(match, { type: 'JUDGE_ITEM', roundId: current.id, itemId: grading.items[2].id })); assert.equal(consumed.status, 409);
      assert.equal(repository.games.get(match.id)!.rounds.find(round => round.id === current.id)!.turnDeadline, deadline);
      match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'CLOSE_ROUND', roundId: current.id }))).json()).match;
    }
    match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'FINISH', confirmEarly: false }))).json()).match; assert.equal(match.result?.unplayedCount, 0); assert.equal(match.result?.reason, 'ALL_ROUNDS');
    assert.equal((await (await request(`/round-matches/${match.id}`)).json()).finished, true);
  }
  assert.equal(repository.debitCount, 2);
});
test('mounted mixed list/acting/drawing/ordinary flow preserves masked/clear bytes, same-game score pins and zero embedded debit', async t => {
  const { request, repository, reader } = await roundHttp(t); let match: Match = (await (await request('/matches/mixed', fixtureRoundStart('MIXED_BOARD', 'mixed'))).json()).match;
  assert.equal(match.rounds.length, 28);
  for (const format of ['LIST_ITEMS', 'ACTING_ITEMS', 'DRAWING_TARGET', 'ORDINARY_TIER']) {
    const round = match.rounds.find(round => round.format === format && round.state === 'READY')!;
    match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'OPEN_ROUND', roundId: round.id }))).json()).match;
    const current = match.currentRound!, stored = repository.games.get(match.id)!.rounds.find(row => row.id === round.id)!;
    assert.ok(!JSON.stringify(match).includes('قارب')); assert.equal((await request(`/round-matches/${match.id}/media/${stored.pin.media.find(media => media.role === 'ACTOR' || media.role === 'CLEAR')!.id}`)).status, 403);
    const mask = await request(`/round-matches/${match.id}/media/${current.media[0].id}`); assert.equal(mask.status, 200); assert.ok((await mask.arrayBuffer()).byteLength > 0);
    if (format.endsWith('ITEMS')) {
      const deadline = current.turnDeadline; match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'JUDGE_ITEM', roundId: round.id, itemId: current.items[2].id }))).json()).match;
      assert.equal(match.currentRound!.turnDeadline, deadline); assert.equal(match.teams[0].score, 0); assert.equal(repository.games.get(match.id)!.postings.at(-1)!.delta, 0);
      match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'CLOSE_ROUND', roundId: round.id }))).json()).match;
    } else { match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'REVEAL_TARGET', roundId: round.id }))).json()).match; assert.ok(match.currentRound!.target); const clearId = match.currentRound!.media.find(media => media.id.includes('clear'))!.id; assert.equal((await request(`/round-matches/${match.id}/media/${clearId}`)).status, 200); match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'ADJUDICATE_ROUND', roundId: round.id, correct: true, teamId: match.teams[0].id }))).json()).match; }
  }
  assert.equal(repository.debitCount, 1); assert.ok(reader.reads > 0);
});
test('v4 immutable retry reconstructs original pins after pointer rotation; changed setup/source corruption conflicts', async () => {
  const repository = new RoundFixtureRepository(), service = createRoundServiceForTest(repository, () => {}), input = fixtureRoundStart();
  const first = await service.start(fixturePrincipal, 'STANDALONE_LIST', input); repository.available = 0n; repository.catalogValue.categories = [];
  const retry = await service.start(fixturePrincipal, 'STANDALONE_LIST', input); assert.equal(retry.idempotent, true); assert.equal(retry.match.id, first.match.id); assert.equal(repository.debitCount, 1);
  await assert.rejects(service.start(fixturePrincipal, 'STANDALONE_LIST', { ...input, setup: { ...input.setup, rules: { ...input.setup.rules, turnSeconds: 45 } } }), /IDEMPOTENCY_KEY_CONFLICT/);
  repository.games.get(first.match.id)!.rounds[0].pin.items[0].value++; await assert.rejects(service.start(fixturePrincipal, 'STANDALONE_LIST', input), /MATCH_DATA_UNAVAILABLE/);
});
test('synthetic last-credit serialization and transaction rollback consume neither exposure nor extra credit', async () => {
  const repository = new RoundFixtureRepository(), service = createRoundServiceForTest(repository, () => {}); repository.available = 1n;
  const attempts = await Promise.allSettled([service.start(fixturePrincipal, 'STANDALONE_LIST', fixtureRoundStart('STANDALONE_LIST', 'parallel-a')), service.start(fixturePrincipal, 'STANDALONE_LIST', fixtureRoundStart('STANDALONE_LIST', 'parallel-b'))]); assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1); assert.equal(repository.debitCount, 1);
  repository.available = 1n; repository.failAfterReserve = true; const before = [...repository.games.values()].map(game => game.intent.selection); await assert.rejects(service.start(fixturePrincipal, 'STANDALONE_LIST', fixtureRoundStart('STANDALONE_LIST', 'rollback')), /transaction failure/); assert.equal(repository.available, 1n); assert.deepEqual([...repository.games.values()].map(game => game.intent.selection), before);
});
test('source exposure unseen remainder precedes documented repeat cycle; revisions do not manufacture novelty', () => {
  const catalog = fixtureFormatCatalog(), request = parseRoundStart(fixtureRoundStart(), 'STANDALONE_LIST'), seed = '1'.repeat(64), first = selectRoundPins(request, catalog, [], seed);
  assert.equal(first.pins.length, 4); const history = first.intent.selection.map(selection => ({ categoryKey: request.setup.categories[0].key, sourceNamespace: selection.sourceNamespace, sourceId: selection.sourceId, cycle: selection.cycle })); const second = selectRoundPins(request, catalog, history, seed);
  assert.equal(second.intent.selection[0].cycle, 1); assert.ok(!history.some(row => row.sourceId === second.intent.selection[0].sourceId)); assert.deepEqual(second.intent.selection.slice(1).map(row => row.cycle), [2, 2, 2]);
  catalog.categories[0].prompts.forEach(pin => { pin.revisionId += '_new'; const { formatHash: previousHash, ...payload } = pin; void previousHash; pin.formatHash = admissionHash({ version: 1, pin: payload }); }); const rotated = selectRoundPins(request, catalog, history, seed); assert.deepEqual(rotated.intent.selection.map(row => [row.sourceId, row.cycle]), second.intent.selection.map(row => [row.sourceId, row.cycle]));
});
test('owner/foreign children before duplicate; identical duplicate before stale CAS; changed expectedVersion conflict; answer-free receipts', async () => {
  const repository = new RoundFixtureRepository(), service = createRoundServiceForTest(repository, () => {}); let match = (await service.start(fixturePrincipal, 'STANDALONE_LIST', fixtureRoundStart())).match;
  const original = action(match, { type: 'NEXT_ROUND' }); match = (await service.command(fixturePrincipal, match.id, original)).match;
  assert.equal((await service.command(fixturePrincipal, match.id, original)).idempotent, true);
  await assert.rejects(service.command(fixturePrincipal, match.id, { ...original, expectedVersion: match.version }), /COMMAND_KEY_CONFLICT/);
  await assert.rejects(service.command({ ...fixturePrincipal, uid: 'other' }, match.id, original), /MATCH_NOT_FOUND/);
  await assert.rejects(service.command(fixturePrincipal, match.id, action(match, { type: 'JUDGE_ITEM', roundId: 'foreign_round', itemId: 'foreign_item' })), /MATCH_NOT_FOUND/);
  assert.ok(!JSON.stringify(repository.games.get(match.id)!.events).includes('تفاحة'));
});
test('post-lock expiry commits SYSTEM settlement then rejects requested judgment; unauthorized/expired grant writes zero', async () => {
  const repository = new RoundFixtureRepository(), service = createRoundServiceForTest(repository, () => {}); let match = (await service.start(fixturePrincipal, 'MIXED_BOARD', fixtureRoundStart('MIXED_BOARD'))).match;
  match = (await service.command(fixturePrincipal, match.id, action(match, { type: 'OPEN_ROUND', roundId: match.rounds[0].id }))).match; const round = match.currentRound!;
  const issued = await service.grant(fixturePrincipal, match.id, action(match, { type: 'CREATE_GRANT', roundId: round.id, role: 'JUDGE', durationSeconds: 600 })); match = issued.match;
  const before = repository.saves; await assert.rejects(service.capability('x'.repeat(43)), /GRANT_DENIED/); assert.equal(repository.saves, before);
  repository.waitAdvance = 40000; await assert.rejects(service.command(fixturePrincipal, match.id, action(match, { type: 'JUDGE_ITEM', roundId: round.id, itemId: round.items[0].id })), /ROUND_TIME_EXPIRED/);
  const stored = repository.games.get(match.id)!; assert.equal(stored.rounds[0].state, 'RESOLVED'); assert.equal(stored.rounds[0].consumed.length, 0); assert.equal(stored.events.at(-1)!.authority.kind, 'SYSTEM'); assert.equal(repository.saves, before + 1);
  await assert.rejects(service.capability(issued.issuance.token!), /GRANT_DENIED/); assert.equal(repository.saves, before + 1);
});
test('pause retains timers/audit, suspends scoring/assignment/new grading/canvas; resume never restarts cap', async () => {
  const repository = new RoundFixtureRepository(), service = createRoundServiceForTest(repository, () => {}), input = fixtureRoundStart('STANDALONE_ACTING'); input.setup.rules.overallSeconds = 300;
  let match = (await service.start(fixturePrincipal, 'STANDALONE_ACTING', input)).match; match = (await service.command(fixturePrincipal, match.id, action(match, { type: 'NEXT_ROUND' }))).match; const roundId = match.currentRound!.id; repository.nowValue += 10000;
  match = (await service.command(fixturePrincipal, match.id, action(match, { type: 'PAUSE_ROUND', roundId, reason: 'استراحة إدارية' }))).match; assert.equal(match.currentRound!.remainingTurn, 20000); assert.equal(match.currentRound!.remainingOverall, 290000); assert.equal(repository.games.get(match.id)!.events.at(-1)!.pauseReason, 'استراحة إدارية');
  for (const command of [{ type: 'JUDGE_ITEM', itemId: match.currentRound!.items[0].id }, { type: 'ASSIGN_ACTOR', teamId: match.teams[0].id, playerIndex: 0, itemId: match.currentRound!.items[0].id }]) await assert.rejects(service.command(fixturePrincipal, match.id, action(match, { ...command, roundId })), /ROUND_PAUSED/);
  await assert.rejects(service.grading(fixturePrincipal, match.id, roundId), /INVALID_PHASE/); repository.nowValue += 60000;
  match = (await service.command(fixturePrincipal, match.id, action(match, { type: 'RESUME_ROUND', roundId }))).match; assert.equal(match.currentRound!.turnDeadline, repository.nowValue + 20000); assert.equal(match.currentRound!.overallDeadline, repository.nowValue + 290000);
});
test('hash-only grant create/rotate duplicate metadata, retained owner reload, revoke/paused/assignment privacy and no Firebase fallback', async t => {
  const { request, repository } = await roundHttp(t); let match: Match = (await (await request('/matches/acting', fixtureRoundStart('STANDALONE_ACTING'))).json()).match; match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'NEXT_ROUND' }))).json()).match;
  const roundId = match.currentRound!.id; match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'ASSIGN_ACTOR', roundId, teamId: match.teams[0].id, playerIndex: 0, itemId: match.currentRound!.items[0].id }))).json()).match;
  const create = action(match, { type: 'CREATE_GRANT', roundId, role: 'ACTOR', durationSeconds: 600 }), first = await (await request(`/round-matches/${match.id}/grants`, create)).json(); match = first.match; const token = first.issuance.token;
  assert.ok(token); const duplicate = await (await request(`/round-matches/${match.id}/grants`, create)).json(); assert.equal(duplicate.issuance.tokenUnavailable, true); assert.equal(duplicate.issuance.token, undefined); assert.ok(!JSON.stringify([...repository.games.values()]).includes(token));
  assert.equal((await request('/capability/view', undefined, '', { 'x-enta-grant': token })).status, 200); const view = await (await request('/capability/view', undefined, '', { 'x-enta-grant': token })).json(); assert.equal(view.target, 'تفاحة — اختبار'); assert.ok(!JSON.stringify(view).includes('موزة')); assert.equal((await request(`/round-matches/${match.id}`, undefined, '', { 'x-enta-grant': token })).status, 401);
  assert.equal((await request(`/round-matches/${match.id}`)).status, 200); assert.equal((await request('/capability/view', undefined, '', { 'x-enta-grant': token })).status, 200);
  const rotate = action(match, { type: 'ROTATE_GRANT', roundId, scopeId: first.issuance.scopeId, expectedGeneration: first.issuance.generation, durationSeconds: 600 }), rotated = await (await request(`/round-matches/${match.id}/grants`, rotate)).json(); match = rotated.match;
  assert.equal((await request('/capability/view', undefined, '', { 'x-enta-grant': token })).status, 403); assert.equal((await (await request(`/round-matches/${match.id}/grants`, rotate)).json()).issuance.tokenUnavailable, true);
  const revoked = await request(`/round-matches/${match.id}/grants`, action(match, { type: 'REVOKE_GRANT', roundId, scopeId: rotated.issuance.scopeId })); assert.equal(revoked.status, 201); assert.equal((await request('/capability/view', undefined, '', { 'x-enta-grant': rotated.issuance.token })).status, 403);
});
test('drawing target actor-only, scoped persisted canvas CAS/history/foreign-round denial and host reveal invalidates grant', async t => {
  const { request, repository } = await roundHttp(t); let match: Match = (await (await request('/matches/mixed', fixtureRoundStart('MIXED_BOARD'))).json()).match; const round = match.rounds.find(round => round.format === 'DRAWING_TARGET')!;
  match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'OPEN_ROUND', roundId: round.id }))).json()).match; assert.ok(!JSON.stringify(match).includes('قارب'));
  match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'ASSIGN_ACTOR', roundId: round.id, teamId: match.teams[0].id, playerIndex: 0, itemId: null }))).json()).match;
  const issuance = await (await request(`/round-matches/${match.id}/grants`, action(match, { type: 'CREATE_GRANT', roundId: round.id, role: 'ACTOR', durationSeconds: 600 }))).json(); match = issuance.match; const headers = { 'x-enta-grant': issuance.issuance.token };
  assert.ok((await (await request('/capability/view', undefined, '', headers)).json()).target.includes('قارب'));
  const stroke = { id: randomUUID(), color: '#191615', width: 5, erase: false, points: [[0, 0], [10000, 10000]] }, append = { commandId: randomUUID(), expectedRevision: 0, type: 'APPEND', stroke };
  assert.equal((await request(`/capability/rounds/${round.id}/canvas`, append, '', headers)).status, 200); assert.equal((await (await request(`/capability/rounds/${round.id}/canvas`, append, '', headers)).json()).idempotent, true);
  assert.equal((await request('/capability/rounds/foreign/canvas', append, '', headers)).status, 403);
  assert.equal((await request(`/capability/rounds/${round.id}/canvas`, { ...append, commandId: randomUUID() }, '', headers)).status, 409);
  const hostCanvas = await (await request(`/round-matches/${match.id}/rounds/${round.id}/canvas`)).json(); assert.equal(hostCanvas.page.strokes.length, 1); assert.equal(hostCanvas.page.revision, 1); assert.ok(!JSON.stringify(hostCanvas).includes('قارب'));
  match = await (await request(`/round-matches/${match.id}`)).json(); match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'REVEAL_TARGET', roundId: round.id }))).json()).match; assert.ok(match.currentRound!.target!.includes('قارب')); assert.equal((await request('/capability/view', undefined, '', headers)).status, 403); assert.equal(repository.debitCount, 1);
});
test('canvas cumulative accepted points/strokes/mutations survive undo/redo/clear; strict bounds reject nonfinite/style/foreign shapes', () => {
  let canvas = newCanvas('round'); const make = (type: string, extras = {}) => ({ type, commandId: randomUUID(), expectedRevision: canvas.revision, ...extras });
  for (let i = 0; i < 32; i++) canvas = reduceCanvas(canvas, parseCanvasCommand(make('APPEND', { stroke: { id: `stroke_${i}`, color: '#191615', width: 5, erase: false, points: Array.from({ length: 256 }, () => [0, 0]) } }))).canvas;
  canvas = reduceCanvas(canvas, parseCanvasCommand(make('UNDO'))).canvas; canvas = reduceCanvas(canvas, parseCanvasCommand(make('REDO'))).canvas; canvas = reduceCanvas(canvas, parseCanvasCommand(make('CLEAR'))).canvas; assert.equal(canvas.cumulativePoints, 8192); assert.equal(canvas.strokes.length, 32); assert.equal(canvas.mutations, 35);
  assert.throws(() => reduceCanvas(canvas, parseCanvasCommand(make('APPEND', { stroke: { id: 'next', color: '#191615', width: 5, erase: false, points: [[0, 0]] } }))), /CANVAS_BUDGET_EXCEEDED/);
  for (const points of [[[Infinity, 0]], [[-1, 0]], [[10001, 0]], Array.from({ length: 257 }, () => [0, 0])]) assert.throws(() => parseCanvasCommand(make('APPEND', { stroke: { id: 'invalid', color: '#191615', width: 5, erase: false, points } })), /INVALID/);
  assert.throws(() => parseCanvasCommand({ ...make('CLEAR'), style: 'url(https://example.invalid)' }), /INVALID/);
});
test('protected video two ranges/immutable proof, hidden/foreign/corrupt/wrong generation/revoked delivery and SSRF/range negatives', async t => {
  const { request, reader, repository } = await roundHttp(t); let match: Match = (await (await request('/matches/mixed', fixtureRoundStart('MIXED_BOARD'))).json()).match; const round = match.rounds.find(round => round.categoryKey === 'format_category_4')!; match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'OPEN_ROUND', roundId: round.id }))).json()).match;
  const video = match.currentRound!.media.find(media => media.mime === 'video/mp4')!; assert.equal(video.bytes, 375883);
  const first = await request(`/round-matches/${match.id}/media/${video.id}`, undefined, 'host', { range: 'bytes=0-262143' }); assert.equal(first.status, 206); assert.equal(first.headers.get('content-range'), `bytes 0-262143/${video.bytes}`); assert.equal((await first.arrayBuffer()).byteLength, 262144);
  const second = await request(`/round-matches/${match.id}/media/${video.id}`, undefined, 'host', { range: `bytes=262144-${video.bytes - 1}` }); assert.equal(second.status, 206); assert.equal((await second.arrayBuffer()).byteLength, video.bytes - 262144); assert.equal(reader.reads, 2);
  for (const range of ['bytes=0-', 'bytes=-100', 'bytes=0-10,20-30', `bytes=0-${video.bytes}`, 'bytes=0-1048576']) assert.equal((await request(`/round-matches/${match.id}/media/${video.id}`, undefined, 'host', { range })).status, 416);
  assert.equal((await request(`/round-matches/${match.id}/media/${video.id}`, undefined, 'other', { range: 'bytes=0-10' })).status, 404);
  reader.corrupt = true; assert.equal((await request(`/round-matches/${match.id}/media/${video.id}`, undefined, 'host', { range: 'bytes=0-10' })).status, 503); reader.corrupt = false; reader.wrongVersion = true; assert.equal((await request(`/round-matches/${match.id}/media/${video.id}`, undefined, 'host', { range: 'bytes=0-10' })).status, 503);
  const pin = fixtureMedia('bad_media', 'PROMPT'); pin.objectKey = 'https://127.0.0.1/private'; assert.throws(() => validateMedia(pin), /MEDIA_PROOF/); assert.throws(() => mediaRange(pin, 'bytes=-10'), /INVALID_MEDIA_RANGE/); assert.equal(repository.debitCount, 1);
});
test('strict v4 no browser mode/points/free flags, NFC/Unicode canonical hash and production/hosted test denial', () => {
  const input = fixtureRoundStart(); assert.throws(() => parseRoundStart({ ...input, free: true }, 'STANDALONE_LIST'), /INVALID/); assert.throws(() => parseHostCommand({ commandId: 'command-key-0001', expectedVersion: 1, type: 'JUDGE_ITEM', roundId: 'round', itemId: 'item', delta: 999 }), /INVALID/);
  input.setup.teams[0].name = '  cafe\u0301 😀  '; const request = parseRoundStart(input, 'STANDALONE_LIST'); assert.equal(request.setup.teams[0].name, 'café 😀'); assert.equal(admissionHash(request), admissionHash(JSON.parse(JSON.stringify(request))));
  for (const name of ['bad\u0000name', 'bad\ud800name', 'bad\u00a0name']) { input.setup.teams[0].name = name; assert.throws(() => parseRoundStart(input, 'STANDALONE_LIST'), /INVALID/); }
  assert.throws(() => productionFormatPolicy(fixtureFormatCatalog()), /FORMAT_RECEIPT_POLICY_UNAVAILABLE/); assert.throws(() => createRoundService(new RoundFixtureRepository()), /TEST_GAMEPLAY_FORBIDDEN/);
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production'; try { assert.throws(() => createRoundServiceForTest(new RoundFixtureRepository(), () => {}), /TEST_GAMEPLAY_FORBIDDEN/); } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
test('synthetic later save clock returns authoritative normal deadline; crossing commits settlement before typed API rejection', async t => {
  const { request, repository } = await roundHttp(t); let match: Match = (await (await request('/matches/mixed', fixtureRoundStart('MIXED_BOARD', 'later-clock'))).json()).match;
  const round = match.rounds.find(round => round.format === 'LIST_ITEMS')!; repository.saveClockAdvance = 25;
  match = (await (await request(`/round-matches/${match.id}/commands`, action(match, { type: 'OPEN_ROUND', roundId: round.id }))).json()).match;
  assert.equal(match.currentRound!.turnDeadline, repository.nowValue + 40000, 'service projects returned saved state, not earlier TS proposal');
  repository.nowValue = match.currentRound!.turnDeadline! - 1; repository.saveClockAdvance = 2;
  const response = await request(`/round-matches/${match.id}/commands`, action(match, { type: 'JUDGE_ITEM', roundId: round.id, itemId: match.currentRound!.items[0].id })); assert.equal(response.status, 409); assert.equal((await response.json()).error, 'ROUND_TIME_EXPIRED');
  const current = repository.games.get(match.id)!; assert.equal(current.rounds[0].state, 'RESOLVED'); assert.equal(current.rounds[0].consumed.length, 0); assert.equal(current.postings.length, 0); assert.equal(current.events.at(-1)!.authority.kind, 'SYSTEM'); assert.equal((await (await request(`/round-matches/${match.id}`)).json()).currentRound, null);
});
