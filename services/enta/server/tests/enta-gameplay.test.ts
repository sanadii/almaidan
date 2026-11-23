import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app";
import { createEntaService, createEntaServiceForTest, parseStartCommand, prepareStart } from "../src/gameplay/service";
import { productionReceiptPolicy } from "../src/wallet/financial-policy";
import { FixtureEntaRepository, fixturePrincipal, fixtureProject, fixtureStart } from "./enta-gameplay-fixture";
import type { MatchProjection } from "../src/gameplay/types";

const testPolicy = { source: "test-only" as const, async assertEligible() {} };
const makeService = (repository = new FixtureEntaRepository()) => ({ repository, service: createEntaServiceForTest(repository, testPolicy) });
async function http(t: TestContext, repository = new FixtureEntaRepository(), namespace = true) {
  const service = createEntaServiceForTest(repository, testPolicy);
  const app = createApp({ config: { environment: "test", firebaseProjectId: fixtureProject, namespaceId: "fixture-namespace", allowDevMocks: false }, entaService: service,
    verifyIdToken: async token => {
      if (!["host", "other", "unverified", "guest"].includes(token)) throw new Error("invalid token");
      const uid = token === "host" ? fixturePrincipal.uid : `fixture-${token}`;
      return { aud: fixtureProject, iss: `https://securetoken.google.com/${fixtureProject}`, sub: uid, uid, firebase: { sign_in_provider: token === "guest" ? "anonymous" : "password" }, currentUser: { disabled: false, emailVerified: token === "host" || token === "other", email: "fixture@example.invalid" } };
    },
    identityStore: { async assertDeploymentNamespace() { if (!namespace) throw new Error("namespace unavailable"); }, async getAdminScopes() { return []; }, async upsertIdentity() {} },
  });
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const request = (path: string, body?: unknown, token = "host") => fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
  return { repository, request };
}
async function start(service: ReturnType<typeof createEntaServiceForTest>) { return (await service.start(fixturePrincipal, fixtureStart())).match; }
const command = (match: MatchProjection, action: Record<string, unknown>) => ({ commandId: randomUUID(), expectedVersion: match.version, ...action });

test("mounted controlled HTTP CLASSIC flow: setup/start/open/reveal/adjudicate/finish/result/reload privacy", async t => {
  const { request, repository } = await http(t);
  const catalog = await (await request("/enta/catalog")).json();
  assert.equal(catalog.categories.length, 6); assert.equal(catalog.availableCredit, "1"); assert.ok(!JSON.stringify(catalog).includes("إجابة"));
  const response = await request("/enta/matches/classic", fixtureStart()); assert.equal(response.status, 201);
  let match: MatchProjection = (await response.json()).match;
  assert.equal(match.tiles.length, 36); assert.equal(match.phase, "BOARD"); assert.ok(!JSON.stringify(match).includes("إجابة")); assert.ok(!JSON.stringify(match).includes("prompt"));
  const id = match.id, qid = match.tiles[0].id;
  const send = async (action: Record<string, unknown>) => { const response = await request(`/enta/matches/${id}/commands`, command(match, action)); assert.equal(response.status, 200); const body = await response.json(); assert.deepEqual(Object.keys(body.receipt).sort(), ["commandId", "sequence", "type"]); match = body.match; return body; };
  await send({ type: "OPEN_QUESTION", questionId: qid }); assert.equal(match.phase, "QUESTION_OPEN"); assert.ok(!JSON.stringify(match).includes("إجابة اختبار مخفية"));
  const reloaded = (await (await request(`/enta/matches/${id}`)).json()).match; assert.equal(reloaded.currentQuestion.id, qid); assert.equal(reloaded.currentQuestion.answers, undefined);
  await send({ type: "REVEAL_ANSWER", questionId: qid }); assert.ok(match.currentQuestion?.answers?.[0].includes("إجابة اختبار مخفية"));
  await send({ type: "ADJUDICATE", questionId: qid, ruling: "CORRECT", teamId: match.teams[0].id }); assert.equal(match.teams[0].score, 200); assert.equal(match.currentQuestion, null); assert.ok(!JSON.stringify(match).includes("إجابة اختبار مخفية"));
  await send({ type: "FINISH", confirmEarly: true }); assert.equal(match.phase, "FINISHED"); assert.equal(match.result?.reason, "HOST_ENDED"); assert.equal(match.result?.unplayedCount, 35);
  assert.deepEqual((await (await request(`/enta/matches/${id}`)).json()).match.result, match.result); assert.equal(repository.debitCount, 1);
});

test("full36-question loop ends complete; NO_SCORE is resolved and cannot reopen", async () => {
  const { service } = makeService(); let match = await start(service);
  for (const tile of match.tiles) {
    match = (await service.command(fixturePrincipal, match.id, command(match, { type: "OPEN_QUESTION", questionId: tile.id }))).match;
    match = (await service.command(fixturePrincipal, match.id, command(match, { type: "REVEAL_ANSWER", questionId: tile.id }))).match;
    match = (await service.command(fixturePrincipal, match.id, command(match, { type: "ADJUDICATE", questionId: tile.id, ruling: "NO_SCORE", teamId: null }))).match;
    await assert.rejects(service.command(fixturePrincipal, match.id, command(match, { type: "OPEN_QUESTION", questionId: tile.id })), /QUESTION_UNAVAILABLE/);
  }
  match = (await service.command(fixturePrincipal, match.id, command(match, { type: "FINISH", confirmEarly: false }))).match;
  assert.equal(match.result?.reason, "ALL_QUESTIONS_PLAYED"); assert.equal(match.result?.unplayedCount, 0); assert.equal(match.result?.isTie, true);
});

test("full setup version2 hashes teams/players/lifelines/rules/category order; identical retry precedes rotation", async () => {
  const { service, repository } = makeService(); const intent = fixtureStart(); const match = (await service.start(fixturePrincipal, intent)).match;
  repository.catalog.receipt.releaseId = "rotated-invalid-release"; repository.catalog.categories = [];
  assert.equal((await service.start(fixturePrincipal, intent)).match.id, match.id); assert.equal(repository.catalogReads, 1); assert.equal(repository.debitCount, 1);
  for (const mutate of [
    (input: ReturnType<typeof fixtureStart>) => { input.setup.teams[0].name = "فريق آخر"; },
    (input: ReturnType<typeof fixtureStart>) => { input.setup.teams[0].players = ["لاعب آخر"]; },
    (input: ReturnType<typeof fixtureStart>) => { input.setup.rules.questionSeconds = 60; },
    (input: ReturnType<typeof fixtureStart>) => { input.setup.categoryKeys.reverse(); },
  ]) { const changed = fixtureStart(); mutate(changed); await assert.rejects(service.start(fixturePrincipal, changed), /IDEMPOTENCY_KEY_CONFLICT/); assert.notEqual(prepareStart(changed).intentHash, prepareStart(intent).intentHash); }
  await assert.rejects(service.start(fixturePrincipal, { ...intent, setup: { ...intent.setup, teams: [{ ...intent.setup.teams[0], lifelines: ["DOUBLE_POINTS"] }, intent.setup.teams[1]] } }), /INVALID_SETUP/);
});

test("synthetic last-credit serialization charges one game, not a real PostgreSQL race", async () => {
  const { service, repository } = makeService(); const first = fixtureStart(), second = fixtureStart(); second.requestKey = "different-key-0001"; second.logicalMatchId = "different-logical-0001";
  const results = await Promise.allSettled([service.start(fixturePrincipal, first), service.start(fixturePrincipal, second)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(repository.available, 0n); assert.equal(repository.debitCount, 1); assert.equal(repository.games.size, 1);
});

test("duplicate commands before stale revision score once; changed expectedVersion/key payload conflicts", async () => {
  const { service } = makeService(); let match = await start(service); const questionId = match.tiles[0].id;
  const open = command(match, { type: "OPEN_QUESTION", questionId }); match = (await service.command(fixturePrincipal, match.id, open)).match;
  match = (await service.command(fixturePrincipal, match.id, command(match, { type: "REVEAL_ANSWER", questionId }))).match;
  const award = command(match, { type: "ADJUDICATE", questionId, ruling: "CORRECT", teamId: match.teams[0].id }); match = (await service.command(fixturePrincipal, match.id, award)).match;
  const duplicate = await service.command(fixturePrincipal, match.id, award); assert.equal(duplicate.idempotent, true); assert.equal(duplicate.match.teams[0].score, 200); assert.equal(duplicate.match.currentQuestion, null); assert.ok(!JSON.stringify(duplicate).includes("إجابة اختبار مخفية"));
  await assert.rejects(service.command(fixturePrincipal, match.id, { ...award, expectedVersion: match.version }), /COMMAND_KEY_CONFLICT/);
  await assert.rejects(service.command(fixturePrincipal, match.id, { ...award, commandId: randomUUID() }), /STALE_VERSION/);
  const replayOpen = await service.command(fixturePrincipal, match.id, open); assert.equal(replayOpen.match.phase, "BOARD", "old receipt never replays old grading DTO");
});

test("wrong owner/project and foreign children denied before duplicate lookup; auth contracts hold over HTTP", async t => {
  const controlled = makeService(); await assert.rejects(controlled.service.catalog({ ...fixturePrincipal, projectId: "other-project" }), /VERIFIED_ACCOUNT_REQUIRED/); assert.equal(controlled.repository.catalogReads, 0);
  const { request } = await http(t); const match = (await (await request("/enta/matches/classic", fixtureStart())).json()).match;
  for (const token of ["other", "guest", "unverified", "invalid"]) { const response = await request(`/enta/matches/${match.id}`, undefined, token); assert.equal(response.status, token === "other" ? 404 : token === "invalid" ? 401 : 403); assert.ok(!JSON.stringify(await response.json()).includes("إجابة")); }
  for (const action of [{ type: "OPEN_QUESTION", questionId: "foreign-question" }, { type: "ADJUDICATE", questionId: match.tiles[0].id, teamId: "foreign-team", ruling: "CORRECT" }]) assert.equal((await request(`/enta/matches/${match.id}/commands`, command(match, action))).status, 404);
  assert.equal((await request(`/enta/matches/${match.id}/commands`, command(match, { type: "OPEN_QUESTION", questionId: match.tiles[0].id, score: 9000 }))).status, 400);
  assert.equal((await request("/games")).status, 404); assert.equal((await request("/enta/matches/student", fixtureStart())).status, 404);
});

test("single active question, reveal-before-ruling, unresolved finish and early confirmation are enforced", async () => {
  const { service } = makeService(); let match = await start(service);
  await assert.rejects(service.command(fixturePrincipal, match.id, command(match, { type: "FINISH", confirmEarly: false })), /EARLY_FINISH_CONFIRMATION_REQUIRED/);
  match = (await service.command(fixturePrincipal, match.id, command(match, { type: "OPEN_QUESTION", questionId: match.tiles[0].id }))).match;
  await assert.rejects(service.command(fixturePrincipal, match.id, command(match, { type: "OPEN_QUESTION", questionId: match.tiles[1].id })), /QUESTION_UNAVAILABLE/);
  await assert.rejects(service.command(fixturePrincipal, match.id, command(match, { type: "FINISH", confirmEarly: true })), /UNRESOLVED_QUESTION/);
  await assert.rejects(service.command(fixturePrincipal, match.id, command(match, { type: "ADJUDICATE", questionId: match.tiles[0].id, ruling: "CORRECT", teamId: match.teams[0].id })), /INVALID_PHASE/);
});

test("transaction failures roll back synthetic debit/state/events; pinned content survives source rotation", async () => {
  const { service, repository } = makeService(); repository.failAfterDebit = true;
  await assert.rejects(start(service), /CONTROLLED_START_TRANSACTION_FAILURE/); assert.equal(repository.available, 1n); assert.equal(repository.games.size, 0); assert.equal(repository.debitCount, 0);
  repository.failAfterDebit = false; const match = await start(service); repository.catalog.categories[0].questions[0].answers[0].text = "rotated answer must not enter game";
  repository.failAfterCommand = true; await assert.rejects(service.command(fixturePrincipal, match.id, command(match, { type: "OPEN_QUESTION", questionId: match.tiles[0].id })), /CONTROLLED_COMMAND_TRANSACTION_FAILURE/);
  assert.equal((await service.get(fixturePrincipal, match.id)).match.phase, "BOARD"); assert.equal(repository.receipts.size, 0);
  repository.failAfterCommand = false; let opened = (await service.command(fixturePrincipal, match.id, command(match, { type: "OPEN_QUESTION", questionId: match.tiles[0].id }))).match;
  opened = (await service.command(fixturePrincipal, match.id, command(opened, { type: "REVEAL_ANSWER", questionId: opened.tiles[0].id }))).match;
  assert.ok(opened.currentQuestion?.answers?.[0].includes("إجابة اختبار مخفية"));
});

test("server clock is sampled after synthetic lock wait; namespace denial precedes service", async t => {
  const { service, repository } = makeService(); const match = await start(service), oldClock = repository.nowValue;
  repository.onTransactionLocked = async () => { repository.nowValue += 90_000; };
  const opened = (await service.command(fixturePrincipal, match.id, command(match, { type: "OPEN_QUESTION", questionId: match.tiles[0].id }))).match;
  assert.equal(opened.currentQuestion?.deadlineAt, oldClock + 120_000);
  const api = await http(t, new FixtureEntaRepository(), false); assert.equal((await api.request("/enta/catalog")).status, 503); assert.equal(api.repository.catalogReads, 0);
});

test("production receipt remains deny-all and hosted test composition is denied", async () => {
  const repository = new FixtureEntaRepository(); const closed = createEntaService({ source: "postgres", projectId: repository.projectId, transaction: repository.transaction.bind(repository) });
  await assert.rejects(closed.start(fixturePrincipal, fixtureStart()), /CATALOG_RECEIPT_POLICY_UNAVAILABLE/); assert.equal(repository.debitCount, 0);
  await assert.rejects(productionReceiptPolicy.assertEligible(repository.catalog.receipt), /CATALOG_RECEIPT_POLICY_UNAVAILABLE/);
  const previous = process.env.VERCEL; try { process.env.VERCEL = "1"; assert.throws(() => createEntaServiceForTest(repository, testPolicy), /TEST_GAMEPLAY_FORBIDDEN/); } finally { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; }
});

test("strict text/setup parser rejects NUL/lone surrogate/non-ASCII whitespace and keeps normative NFC/hash shape", () => {
  for (const name of ["aa\0bb", "aa\ud800bb", "aa\udc00bb", "aa\u00a0bb", "aa\u2003bb", "aa\u0085bb"]) { const input = fixtureStart(); input.setup.teams[0].name = name; assert.throws(() => parseStartCommand(input), /INVALID_REQUEST/); }
  const input = fixtureStart(); input.setup.teams[0].name = "  Café\u0301  "; const parsed = parseStartCommand(input); assert.equal(parsed.setup.teams[0].name, "Café́".normalize("NFC"));
  const duplicate = fixtureStart(); duplicate.setup.teams[0].name = "TEAM"; duplicate.setup.teams[1].name = "team"; assert.throws(() => parseStartCommand(duplicate), /DUPLICATE_TEAM_NAME/);
});

test("synthetic coherent GET snapshot holds transaction while queued command waits; not PostgreSQL race proof", async () => {
  const { repository, service } = makeService(); const match = await start(service);
  let release!: () => void, locked!: () => void; const entered = new Promise<void>(resolve => { locked = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; }); repository.onTransactionLocked = async () => { repository.onTransactionLocked = null; locked(); await hold; };
  const read = service.get(fixturePrincipal, match.id); await entered; let commandReturned = false;
  const write = service.command(fixturePrincipal, match.id, command(match, { type: "OPEN_QUESTION", questionId: match.tiles[0].id })).then(value => { commandReturned = true; return value; });
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(commandReturned, false); release();
  const observed = (await read).match, changed = (await write).match; assert.equal(observed.version, 1); assert.equal(observed.phase, "BOARD"); assert.equal(observed.currentQuestion, null); assert.deepEqual(observed.teams.map(team => team.score), [0, 0]); assert.equal(changed.version, 2); assert.equal(changed.phase, "QUESTION_OPEN");
});
