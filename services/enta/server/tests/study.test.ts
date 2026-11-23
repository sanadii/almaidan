import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudyService, StudyError, type StudyPool, type StudyRepository, type StudySession } from '../src/study/service';

function fixture() {
  const sessions = new Map<string, StudySession>();
  const receipts = new Map<string, Awaited<ReturnType<StudyRepository['start']>>>();
  const repository: StudyRepository = { async start(owner, requestId, create) { const key = `${owner}:${requestId}`; const prior = receipts.get(key); if (prior) return structuredClone(prior); const { session, receipt } = await create(); sessions.set(session.id, structuredClone(session)); receipts.set(key, structuredClone(receipt)); return receipt; }, async transact(id, owner, fn) { const s = sessions.get(id); if (!s || s.owner !== owner) return undefined; const copy = structuredClone(s); const result = fn(copy); sessions.set(id, copy); return result; } };
  let pool: StudyPool = { releaseId: 'r1', seal: 'seal1', questions: [{ id: 'source1', revision: 'v1', prompt: 'first', choices: ['wrong', 'right'], correctIndex: 1 }, { id: 'source2', revision: 'v1', prompt: 'second', choices: ['yes', 'no'], correctIndex: 0 }] };
  return { sessions, service: createStudyService(repository, async () => pool), update() { pool = { ...pool, releaseId: 'r2', questions: [{ ...pool.questions[0], prompt: 'changed', choices: ['new', 'changed'] }] }; }, repository };
}
const requestId = 'a0000000-0000-4000-8000-000000000000';
const rejects = (fn: () => Promise<unknown>, code: StudyError['code']) => assert.rejects(fn, (e: unknown) => e instanceof StudyError && e.code === code);
test('defaults unavailable and rejects invalid pools', async () => {
  const f = fixture(); await rejects(() => createStudyService(f.repository).start('u', requestId), 'UNAVAILABLE');
  const bad = createStudyService(f.repository, async () => ({ releaseId: 'r', seal: 's', questions: [{ id: 'x', revision: 'r', prompt: 'x', choices: ['only'], correctIndex: 0 }] })); await rejects(() => bad.start('u', requestId), 'UNAVAILABLE');
});
test('pins privately, grades once, denies future and other owners, survives head changes', async () => {
  const f = fixture(); const start = await f.service.start('owner', requestId); const q = start.question!; const stored = f.sessions.get(start.sessionId)!;
  assert.equal(JSON.stringify(start).includes('correctIndex'), false); assert.equal(JSON.stringify(start).includes('correctChoiceId'), false); assert.equal(JSON.stringify(start).includes('second'), false); assert.equal(JSON.stringify(start).includes('source1'), false);
  await rejects(() => f.service.get('other', start.sessionId), 'NOT_FOUND');
  await rejects(() => f.service.answer('other', start.sessionId, q.id, q.choices[0].id), 'NOT_FOUND');
  await rejects(() => f.service.answer('owner', start.sessionId, stored.questions[1].id, stored.questions[1].choices[0].id), 'TOO_EARLY');
  await rejects(() => f.service.answer('owner', start.sessionId, q.id, 'invalid'), 'INVALID_CHOICE');
  f.update(); assert.deepEqual(await f.service.start('owner', requestId), start); assert.equal(f.sessions.size, 1); assert.equal((await f.service.get('owner', start.sessionId)).question?.prompt, 'first');
  const result = await f.service.answer('owner', start.sessionId, q.id, q.choices[0].id); assert.equal(result.correct, false); assert.equal(result.progress.answered, 1); assert.equal(result.question?.prompt, 'second');
  assert.deepEqual(await f.service.answer('owner', start.sessionId, q.id, q.choices[0].id), result);
  await rejects(() => f.service.answer('owner', start.sessionId, q.id, q.choices[1].id), 'CONFLICT');
  const next = result.question!; const done = await f.service.answer('owner', start.sessionId, next.id, next.choices[0].id); assert.equal(done.correct, true); assert.equal(done.question, null); assert.equal(done.progress.answered, 2); assert.deepEqual(await f.service.answer('owner', start.sessionId, q.id, q.choices[0].id), result);
  assert.equal(f.sessions.get(start.sessionId)?.releaseId, 'r1'); assert.equal(f.sessions.get(start.sessionId)?.seal, 'seal1');
});

test('rejects normalized duplicate choices and controls', async () => {
  const f = fixture();
  for (const choices of [['Ａ', 'A'], [' x ', 'x'], ['a\n', 'b']]) {
    const service = createStudyService(f.repository, async () => ({ releaseId: 'r', seal: 's', questions: [{ id: 'q', revision: 'v', prompt: 'p', choices, correctIndex: 0 }] }));
    await rejects(() => service.start('u', requestId), 'UNAVAILABLE');
  }
});
test('rejects cross-owner data even from a faulty repository', async () => {
  const f = fixture(); const started = await f.service.start('owner', requestId); const session = f.sessions.get(started.sessionId)!;
  const faulty: StudyRepository = { ...f.repository, async transact(_id, _owner, fn) { return fn(structuredClone(session)); } };
  await rejects(() => createStudyService(faulty).get('other', session.id), 'NOT_FOUND');
});
