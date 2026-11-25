import assert from "node:assert/strict";
import test from "node:test";
import type { ImportedQuestion, LocalRuntimeQuestionSource } from "../../server/local-firestore-question-source.js";
import { createLocalOwnedRoom, LocalRoomCreationError } from "../../server/local-owned-room-creation.js";
import { AuthoritativeGameService } from "../../server/service.js";
import { createLocalOwnedRematch } from "../../server/local-owned-room-rematch.js";
import type { GameIntent } from "../../src/features/game/runtime/contracts.js";

const letters = [..."ابتثجحخدذرزسشصضطظعغفقكلمنهوي"];

test("Huroof rematch is owner-only, links once to the same owner's lobby, and carries both teams", async (t) => {
  const environment = { ALMAIDAN_LOCAL_ONLY: "true", FIREBASE_PROJECT_ID: "demo-almaidan-local", GAME_HOST: "127.0.0.1", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:19099" };
  const prior = Object.entries(environment).map(([key]) => [key, process.env[key]] as const);
  Object.assign(process.env, environment);
  const service = new AuthoritativeGameService({ dbPath: ":memory:", localFirestoreQuestionSource: sourceFixture() });
  t.after(() => {
    service.close();
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const verified = (uid = "owner") => async () => ({
    aud: "demo-almaidan-local", iss: "https://securetoken.google.com/demo-almaidan-local", sub: uid, uid,
    currentUser: { disabled: false, emailVerified: true, email: "fixture@example.test" },
    firebase: { sign_in_provider: "password" },
  });
  const old = await createLocalOwnedRoom(service, "Bearer fixture", {
    requestKey: "original-key", demo: true, categories: ["category-a", "category-b"],
  }, verified());
  const guests = await Promise.all([service.join(old.roomCode, "ريم"), service.join(old.roomCode, "عمر")]);
  let nextIntent = 0;
  const send = async (token: string, type: GameIntent["type"], payload: GameIntent["payload"] = {}) =>
    service.intent(old.roomId, token, { type, intentId: `rematch-${++nextIntent}`, expectedRevision: service.metadata(old.roomId, token).revision, payload });
  for (const guest of guests) await send(guest.token, "LOBBY_SET_READY", { ready: true });
  for (const type of ["START_MATCH", "PAUSE", "END_WITHOUT_WINNER"] as const) await send(old.token, type);
  const start = (token: string, requestKey = "rematch-request", uid = "owner") =>
    createLocalOwnedRematch(service, "Bearer fixture", token, old.roomId, { requestKey }, verified(uid));
  await assert.rejects(start(guests[0].token), /LOCAL_REMATCH_HOST_REQUIRED/);
  await assert.rejects(start(old.token, "rematch-request", "foreign-owner"), /LOCAL_REMATCH_HOST_REQUIRED/);
  const updated: string[] = [];
  service.onRoomChanged = roomId => updated.push(roomId);
  const [next, retry] = await Promise.all([start(old.token), start(old.token)]);
  assert.equal(retry.roomId, next.roomId);
  assert.equal(retry.idempotent, true);
  await assert.rejects(start(old.token, "another-request"), /LOCAL_REMATCH_ALREADY_STARTED/);
  assert.equal(service.store.localRoomOwner(next.roomId), service.store.localRoomOwner(old.roomId));
  assert.equal(service.store.rooms().length, 2);
  assert.deepEqual(updated, [old.roomId]);
  for (const token of [old.token, old.audienceToken, ...guests.map(guest => guest.token)]) {
    const view = service.metadata(old.roomId, token).projection;
    assert.equal(view.room.state, "MATCH_COMPLETE");
    assert.deepEqual(view.room.successor, { roomId: next.roomId, roomCode: next.roomCode });
  }
  assert.throws(() => service.carryRematch(old.roomId, old.audienceToken), /UNAUTHORIZED/);
  await assert.rejects(service.join(next.roomCode, "ريم"), /DUPLICATE_DISPLAY_NAME/);
  for (const guest of guests) {
    const previousSeat = service.metadata(old.roomId, guest.token).projection.self!;
    const entered = service.carryRematch(old.roomId, guest.token);
    const seat = service.metadata(next.roomId, entered.token).projection.self!;
    assert.equal(seat.displayName, previousSeat.displayName);
    assert.equal(seat.team, previousSeat.team);
    assert.equal(seat.ready, false);
    assert.equal(service.carryRematch(old.roomId, guest.token).token, entered.token);
  }
});

function sourceFixture(snapshotId = "baseline", labelAr = "فئة أ"): LocalRuntimeQuestionSource {
  const stock = (categoryId: string, count: number, conceptPrefix = categoryId, offset = 0): ImportedQuestion[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `${categoryId}-${index}`,
      categoryId,
      modality: "classic",
      answerConceptId: `${conceptPrefix}-${index}`,
      targetLetter: letters[index + offset],
      headerAr: "عنوان",
      promptAr: "سؤال",
      canonicalAnswer: "جواب",
      acceptedAnswers: ["جواب"],
      status: "draft_test_import",
      sourceContentHash: "a".repeat(64),
      difficulty: "mixed",
    }));
  const groups = [stock("category-a", 14), stock("category-b", 14, "category-b", 14), stock("sparse", 1), stock("overlap", 14, "category-a")];
  const questions = groups.flat();
  return {
    snapshotId,
    questions,
    inventory: {
      source: "local_saved_release",
      snapshotId,
      bundleSha256: "b".repeat(64),
      boundedReadCount: 0,
      sourceCandidateCount: questions.length,
      usableQuestionCount: questions.length,
      heldQuestionCount: 0,
      huroofAvailable: true,
      categories: groups.map((group) => ({
        id: group[0].categoryId,
        labelAr: group[0].categoryId === "category-a" ? labelAr : group[0].categoryId,
        sourceOnly: false,
        questionCount: group.length,
        heldQuestionCount: 0,
        classicQuestionCount: group.length,
        huroofQuestionCount: group.length,
        categoryGameEligible: group.length >= 14,
        availability: group.length >= 14 ? "ready" : "insufficient_questions",
      })),
    },
  };
}

test("inventory projection is reused until a replacement source is active", (t) => {
  const service = new AuthoritativeGameService({ dbPath: ":memory:", localFirestoreQuestionSource: sourceFixture() });
  t.after(() => service.close());
  const baseline = service.questionInventory();
  assert.equal(service.questionInventory(), baseline);
  service.replaceLocalQuestionSource(sourceFixture("revised", "فئة جديدة"));
  const updated = service.questionInventory();
  assert.notEqual(updated, baseline);
  assert.equal(updated?.categories[0].labelAr, "فئة جديدة");
  assert.equal(service.questionInventory(), updated);
});

test("live scope and local creation agree on one category, sparse questions and overlapping concepts", async (t) => {
  const environment = {
    ALMAIDAN_LOCAL_ONLY: "true",
    FIREBASE_PROJECT_ID: "demo-almaidan-local",
    GAME_HOST: "127.0.0.1",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:19099",
  };
  const original = Object.entries(environment).map(([key]) => [key, process.env[key]] as const);
  Object.assign(process.env, environment);
  const service = new AuthoritativeGameService({ dbPath: ":memory:", localFirestoreQuestionSource: sourceFixture() });
  t.after(() => {
    service.close();
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const create = (categories: string[], gameKind = "categories") => createLocalOwnedRoom(
    service,
    "Bearer fixture",
    { demo: true, requestKey: "test-request", gameKind, categories },
    async () => ({
      aud: "demo-almaidan-local",
      iss: "https://securetoken.google.com/demo-almaidan-local",
      sub: "fixture-host",
      uid: "fixture-host",
      currentUser: { disabled: false, emailVerified: true, email: "fixture@example.test" },
      firebase: { sign_in_provider: "password" },
    }),
  );
  const denied = (reason: string) => (error: unknown) => error instanceof LocalRoomCreationError && error.status === 422 && error.message === reason;
  for (const [scope, reason] of [
    [["category-a"], "CATEGORY_GAME_COMBINATION_INVALID"],
    [["category-a", "sparse"], "QUESTION_SCOPE_INSUFFICIENT_COVERAGE"],
    [["category-a", "overlap"], "QUESTION_SCOPE_INSUFFICIENT_COVERAGE"],
  ] as const) {
    assert.equal(service.questionCoverage("categories", [...scope], false, "ordinary"), false);
    await assert.rejects(create([...scope]), denied(reason));
  }
  assert.equal(service.questionCoverage("huroof", ["category-a"], false, "ordinary"), false);
  await assert.rejects(create(["category-a"], "huroof"), denied("QUESTION_SCOPE_INSUFFICIENT_COVERAGE"));
  assert.equal(service.store.rooms().length, 0);

  const playable = ["category-a", "category-b"];
  assert.equal(service.questionCoverage("categories", playable, false, "ordinary"), true);
  assert.equal(service.questionCoverage("huroof", playable, false, "ordinary"), true);
  const room = await create(playable);
  assert.equal(room.idempotent, false);
});

test("only the host can start without waiting and each team still needs a ready participant", async (t) => {
  const service = new AuthoritativeGameService({ dbPath: ":memory:", localFirestoreQuestionSource: sourceFixture() });
  t.after(() => service.close());
  const host = service.create("المضيف", true, { gameKind: "categories", categories: ["category-a", "category-b"] });
  const first = await service.join(host.roomCode, "لاعب 1");
  const second = await service.join(host.roomCode, "لاعب 2");
  const waiting = await service.join(host.roomCode, "لاعب 3");
  let revision = waiting.revision;
  let nextId = 0;
  const send = async (token: string, type: GameIntent["type"], payload: GameIntent["payload"]) => {
    const result = await service.intent(host.roomId, token, { type, intentId: `phase2-${nextId++}`, expectedRevision: revision, payload });
    revision = result.revision;
    return result;
  };
  await send(first.token, "LOBBY_SET_READY", { ready: true });
  await assert.rejects(send(host.token, "START_MATCH", { withoutWaiting: true }), /LOBBY_NEEDS_TWO_TEAMS/);
  const secondReady = await send(second.token, "LOBBY_SET_READY", { ready: true });
  assert.equal(secondReady.projection.projection.room.canStartWithoutWaiting, true);
  assert.equal(secondReady.projection.projection.room.canStart, false);
  await assert.rejects(send(host.token, "START_MATCH", {}), /LOBBY_ALL_MEMBERS_MUST_BE_READY/);
  await assert.rejects(send(waiting.token, "START_MATCH", { withoutWaiting: true }), /FORBIDDEN/);
  await assert.rejects(send(host.token, "START_MATCH", { withoutWaiting: true, extra: true }), /INVALID_INTENT/);
  const started = await send(host.token, "START_MATCH", { withoutWaiting: true });
  assert.equal(started.projection.projection.room.state, "CELL_SELECTION");
  assert.equal(started.projection.projection.room.memberCount, 3);
  assert.equal(started.projection.projection.room.readyCount, 2);
  assert.equal(started.projection.projection.room.canStartWithoutWaiting, undefined);
});

test("the local host can move a lobby player and remove their seat", async (t) => {
  const service = new AuthoritativeGameService({ dbPath: ":memory:", localFirestoreQuestionSource: sourceFixture() });
  t.after(() => service.close());
  const host = service.create("المضيف", true, { gameKind: "categories", categories: ["category-a", "category-b"] });
  const guest = await service.join(host.roomCode, "لاعب");
  const roster = service.metadata(host.roomId, host.token).projection.room.members;
  const member = roster?.find((item) => item.role === "player");
  assert.ok(member?.uid);
  const destination = member.team === "horizontal" ? "vertical" : "horizontal";
  const moved = await service.intent(host.roomId, host.token, {
    type: "LOBBY_ASSIGN_TEAM", intentId: "move-guest", expectedRevision: guest.revision, payload: { memberUid: member.uid, team: destination },
  });
  assert.equal(moved.projection.projection.room.members?.find((item) => item.uid === member.uid)?.team, destination);
  const removed = await service.intent(host.roomId, host.token, {
    type: "LOBBY_REMOVE_PARTICIPANT", intentId: "remove-guest", expectedRevision: moved.revision, payload: { memberUid: member.uid },
  });
  assert.equal(removed.projection.projection.room.memberCount, 0);
  assert.throws(() => service.metadata(host.roomId, guest.token), /UNAUTHORIZED/);
});
