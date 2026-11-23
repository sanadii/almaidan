import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app";
import { createEntaServiceForTest, createEntaService, parseStartCommand, prepareStart } from "../src/gameplay/service";
import { parseHistoryQuery, prepareSuccessor } from "../src/gameplay/successor";
import { projectMatch } from "../src/gameplay/projection";
import { productionModeReceiptPolicy } from "../src/wallet/enta-mode-policy";
import { fixtureStart } from "./enta-gameplay-fixture";
import { SuccessorFixtureRepository, fixtureKidsStart, fixturePrincipal, fixtureProject } from "./enta-successor-fixture";
import type { MatchProjection } from "../src/gameplay/types";

const classicPolicy = { source: "test-only" as const, async assertEligible() {} }, modePolicy = { source: "test-only" as const, async assertEligible() {} };
export function fixtureService(repository = new SuccessorFixtureRepository()) { return { repository, service: createEntaServiceForTest(repository, classicPolicy, modePolicy) }; }
export async function successorHttp(t: Pick<TestContext, "after">, repository = new SuccessorFixtureRepository()) {
  const { service } = fixtureService(repository); const app = createApp({ config: { environment: "test", firebaseProjectId: fixtureProject, namespaceId: "fixture-namespace", allowDevMocks: false }, entaService: service,
    verifyIdToken: async token => { if (!["host", "other"].includes(token)) throw Error("controlled verifier rejected"); const uid = token === "host" ? fixturePrincipal.uid : "fixture-other"; return { aud: fixtureProject, iss: `https://securetoken.google.com/${fixtureProject}`, uid, sub: uid, firebase: { sign_in_provider: "password" }, currentUser: { disabled: false, emailVerified: true, email: "fixture@example.invalid" } }; },
    identityStore: { async assertDeploymentNamespace() {}, async getAdminScopes() { return []; }, async upsertIdentity() {} }, historyHandlers: { async page(p, q) { return service.history(p, q) as never; }, async original() { throw Error("unused"); } },
  }); const server = createServer(app); await new Promise<void>(done => server.listen(0, "127.0.0.1", done)); t.after(() => new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))); const address = server.address(); assert.ok(address && typeof address !== "string");
  return { repository, service, origin: `http://127.0.0.1:${address.port}`, request: (path: string, body?: unknown, token = "host") => fetch(`http://127.0.0.1:${address.port}/api/v1/enta${path}`, { headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) }) };
}
const command = (match: MatchProjection, input: Record<string, unknown>) => ({ commandId: randomUUID(), expectedVersion: match.version, ...input });
async function finish(service: ReturnType<typeof fixtureService>["service"], match: MatchProjection) { return (await service.command(fixturePrincipal, match.id, command(match, { type: "FINISH", confirmEarly: true }))).match; }

test("mounted HTTP KIDS six-pin complete loop, history and paid rematch recover one debit per logical match", async t => {
  const { request, repository } = await successorHttp(t); repository.available = 2n;
  const catalog = await (await request("/catalog/kids")).json(); assert.equal(catalog.mode, "KIDS"); assert.equal(catalog.categoryCount, 1); assert.equal(catalog.categories.length, 3);
  let match: MatchProjection = (await (await request("/matches/kids", fixtureKidsStart())).json()).match; assert.equal(match.mode, "KIDS"); assert.equal(match.categories.length, 1); assert.equal(match.tiles.length, 6);
  for (const tile of match.tiles) for (const action of [{ type: "OPEN_QUESTION", questionId: tile.id }, { type: "REVEAL_ANSWER", questionId: tile.id }, { type: "ADJUDICATE", questionId: tile.id, ruling: "NO_SCORE", teamId: null }]) { const response = await request(`/matches/${match.id}/commands`, command(match, action)); assert.equal(response.status, 200); match = (await response.json()).match; }
  match = (await (await request(`/matches/${match.id}/commands`, command(match, { type: "FINISH", confirmEarly: false }))).json()).match;
  assert.equal(match.result?.unplayedCount, 0); assert.equal(match.result?.reason, "ALL_QUESTIONS_PLAYED");
  const setup = await (await request(`/matches/${match.id}/rematch-setup`)).json(); assert.equal(setup.mode, "KIDS"); assert.equal(setup.setup.version, 3);
  const rematch = { requestKey: "rematch-request-0001", logicalMatchId: "rematch-logical-0001", predecessorVersion: setup.predecessorVersion, setup: setup.setup };
  const created = await request(`/matches/${match.id}/rematch`, rematch); assert.equal(created.status, 201); const child = (await created.json()).match;
  repository.kids.categories = []; const retried = await request(`/matches/${match.id}/rematch`, rematch); assert.equal(retried.status, 200); assert.equal((await retried.json()).match.id, child.id); assert.equal(repository.debitCount, 2); assert.equal(repository.links.size, 1);
  repository.walletMissing = true; const history = await (await request("/matches/history")).json(); assert.equal(history.matches.length, 2); assert.ok(!/players|prompt|answers|admissionId|identityId|receiptId|rootHash/.test(JSON.stringify(history))); assert.equal((await request(`/matches/${match.id}/rematch-setup`, undefined, "other")).status, 404); assert.equal((await request("/matches/history", undefined, "other")).status, 200);
});

test("CLASSIC v2 parser/hash/retry survives successor integration; CLASSIC rematch is paid v3", async () => {
  const { repository, service } = fixtureService(); repository.available = 2n; const original = fixtureStart(), prepared = prepareStart(parseStartCommand(original)); const beforeHash = prepared.intentHash;
  assert.equal(beforeHash, "9ab6c40e2fc3ff98c5d0ee5e00b9e8229cfbe8f3f6dd974ea271764e764ec220", "accepted E1 golden bytes unchanged"); assert.equal(prepared.requestHash, "e7aa2e4078fd85bf0d2a213fd609c2262c760b895f0ed204c0801718370a8a15");
  const parent = await finish(service, (await service.start(fixturePrincipal, original)).match); assert.equal((await service.start(fixturePrincipal, original)).match.id, parent.id); assert.equal(prepareStart(parseStartCommand(original)).intentHash, beforeHash);
  const setup = await service.rematchSetup(fixturePrincipal, parent.id); const child = await service.rematch(fixturePrincipal, parent.id, { requestKey: "classic-rematch-0001", logicalMatchId: "classic-child-0001", predecessorVersion: setup.predecessorVersion, setup: setup.setup }); assert.equal(child.match.mode, "CLASSIC"); assert.equal(child.match.tiles.length, 36); assert.equal(repository.debitCount, 2);
});

test("Kids receipt adult relabelling/missing cohort/suitability/rights/tier/fresh revision proof rejects before debit", async () => {
  for (const mutate of [
    (repo: SuccessorFixtureRepository) => { repo.kids.receipt.mode = "CLASSIC"; },
    (repo: SuccessorFixtureRepository) => { repo.kids.receipt.targetCohort = null; },
    (repo: SuccessorFixtureRepository) => { repo.kids.kidsSources[0].suitability.decision = "REJECTED" as "APPROVED"; },
    (repo: SuccessorFixtureRepository) => { repo.kids.kidsSources[0].rightsDecision = "UNKNOWN" as "CLEARED"; },
    (repo: SuccessorFixtureRepository) => { repo.kids.kidsProofs.pop(); },
    (repo: SuccessorFixtureRepository) => { repo.kids.categories[0].questions[0].contentHash = "0".repeat(64); },
  ]) { const { repository, service } = fixtureService(); mutate(repository); await assert.rejects(service.startKids(fixturePrincipal, fixtureKidsStart()), /CATALOG_UNAVAILABLE/); assert.equal(repository.debitCount, 0); }
});

test("v3 rejects browser billing/mode/extras/category count and material setup/predecessor key changes", async () => {
  const { repository, service } = fixtureService(); repository.available = 3n;
  for (const changed of [{ ...fixtureKidsStart(), mode: "STUDENT" }, { ...fixtureKidsStart(), free: true }, { ...fixtureKidsStart(), setup: { ...fixtureKidsStart().setup, categoryKeys: ["fixture_kids_0", "fixture_kids_1"] } }]) await assert.rejects(service.startKids(fixturePrincipal, changed), /INVALID/);
  const parent = await finish(service, (await service.startKids(fixturePrincipal, fixtureKidsStart())).match), setup = await service.rematchSetup(fixturePrincipal, parent.id);
  const input = { requestKey: "bound-rematch-0001", logicalMatchId: "bound-child-0001", predecessorVersion: setup.predecessorVersion, setup: setup.setup }; await service.rematch(fixturePrincipal, parent.id, input);
  await assert.rejects(service.rematch(fixturePrincipal, parent.id, { ...input, predecessorVersion: input.predecessorVersion + 1 }), /IDEMPOTENCY_KEY_CONFLICT/);
  await assert.rejects(service.rematch(fixturePrincipal, parent.id, { ...input, setup: { ...input.setup, rules: { questionSeconds: 60 } } }), /IDEMPOTENCY_KEY_CONFLICT/);
  assert.notEqual(prepareSuccessor(input, "KIDS", { gameId: parent.id, version: input.predecessorVersion }).intentHash, prepareSuccessor(input, "KIDS", null).intentHash);
});

test("foreign/active predecessor denied before retry; missing or corrupt v3 mode never downgrades", async () => {
  const { repository, service } = fixtureService(); const match = (await service.startKids(fixturePrincipal, fixtureKidsStart())).match;
  await assert.rejects(service.rematchSetup(fixturePrincipal, match.id), /PREDECESSOR_NOT_FINISHED/); await finish(service, match);
  await assert.rejects(service.rematchSetup({ ...fixturePrincipal, uid: "other" }, match.id), /MATCH_NOT_FOUND/);
  const game = repository.games.get(match.id)!; delete game.mode; await assert.rejects(service.rematchSetup(fixturePrincipal, match.id), /MATCH_DATA_UNAVAILABLE/); assert.throws(() => projectMatch(game, repository.nowValue), /MATCH_DATA_UNAVAILABLE/);
  game.mode = "CLASSIC"; await assert.rejects(service.rematchSetup(fixturePrincipal, match.id), /MATCH_DATA_UNAVAILABLE/);
});

test("history keyset ties/filters/foreign anchor/malformed date is private and independent of wallet/current supply", async () => {
  const { repository, service } = fixtureService(); repository.available = 4n; const rows: MatchProjection[] = [];
  for (let i = 0; i < 3; i++) { const input = fixtureKidsStart(); input.requestKey = `history-request-${i}`; input.logicalMatchId = `history-logical-${i}`; rows.push((await service.startKids(fixturePrincipal, input)).match); }
  for (const game of repository.games.values()) game.createdAt = "2026-10-07T15:00:00.123Z";
  await finish(service, rows[0]); repository.walletMissing = true; repository.kids.categories = []; repository.catalog.categories = [];
  const first = await service.history(fixturePrincipal, { limit: "2" }); assert.equal(first.matches.length, 2); assert.ok(first.nextCursor); const second = await service.history(fixturePrincipal, { limit: "2", cursor: first.nextCursor! }); assert.equal(second.matches.length, 1); assert.equal(new Set([...first.matches, ...second.matches].map(row => row.id)).size, 3);
  await assert.rejects(service.history({ ...fixturePrincipal, uid: "other" }, { cursor: first.nextCursor! }), /INVALID_HISTORY_CURSOR/);
  await assert.rejects(service.history(fixturePrincipal, { cursor: first.nextCursor!, mode: "CLASSIC" }), /INVALID_HISTORY_CURSOR/);
  await assert.rejects(service.history(fixturePrincipal, { limit: "51" }), /INVALID_HISTORY_QUERY/); await assert.rejects(service.history(fixturePrincipal, { cursor: "abc" }), /INVALID_HISTORY_CURSOR/);
  const finished = await service.history(fixturePrincipal, { status: "FINISHED", mode: "KIDS" }); assert.equal(finished.matches.length, 1); assert.equal(finished.matches[0].finishedAt, new Date(repository.nowValue).toISOString()); assert.equal(repository.successorReads, 3);
});

test("synthetic last-credit rematches serialize once; partial link rollback and multiple paid children preserve predecessor", async () => {
  const { repository, service } = fixtureService(); const parent = await finish(service, (await service.startKids(fixturePrincipal, fixtureKidsStart())).match), setup = await service.rematchSetup(fixturePrincipal, parent.id); const original = structuredClone(repository.games.get(parent.id)); repository.available = 1n;
  const make = (id: number) => ({ requestKey: `parallel-rematch-${id}`, logicalMatchId: `parallel-logical-${id}`, predecessorVersion: setup.predecessorVersion, setup: setup.setup });
  const results = await Promise.allSettled([service.rematch(fixturePrincipal, parent.id, make(1)), service.rematch(fixturePrincipal, parent.id, make(2))]); assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(repository.links.size, 1); assert.deepEqual(repository.games.get(parent.id), original);
  repository.available = 1n; repository.failAfterLink = true; const debit = repository.debitCount; await assert.rejects(service.rematch(fixturePrincipal, parent.id, make(3)), /CONTROLLED_LINK_ROLLBACK/); assert.equal(repository.links.size, 1); assert.equal(repository.available, 1n); assert.equal(repository.debitCount, debit);
  repository.failAfterLink = false; await service.rematch(fixturePrincipal, parent.id, make(3)); assert.equal(repository.links.size, 2); assert.deepEqual(repository.games.get(parent.id), original);
});

test("new production mode policy remains deny-only; hosted factory cannot enable successors", async () => {
  const repository = new SuccessorFixtureRepository(); const closed = createEntaService({ source: "postgres", projectId: repository.projectId, transaction: repository.transaction.bind(repository) }); await assert.rejects(closed.startKids(fixturePrincipal, fixtureKidsStart()), /CATALOG_RECEIPT_POLICY_UNAVAILABLE/); assert.equal(repository.debitCount, 0);
  await assert.rejects(productionModeReceiptPolicy.assertEligible(repository.kids.receipt), /CATALOG_RECEIPT_POLICY_UNAVAILABLE/); const previous = process.env.VERCEL; try { process.env.VERCEL = "1"; assert.throws(() => fixtureService(repository), /TEST_GAMEPLAY_FORBIDDEN/); } finally { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; }
});

test("history parser rejects invalid dates, unknown/duplicate query keys and keeps exact millisecond UTC", () => {
  assert.equal(parseHistoryQuery({}).limit, 25); for (const input of [{ limit: ["2", "3"] }, { score: "1" }, { mode: "STUDENT" }, { cursor: Buffer.from(JSON.stringify({ version: 1, id: "row", createdAt: "2026-02-30T00:00:00.000Z", mode: null, status: null })).toString("base64url") }]) assert.throws(() => parseHistoryQuery(input), /INVALID_HISTORY/);
});
