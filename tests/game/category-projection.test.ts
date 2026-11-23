import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CATEGORY_PROJECTION_V1, CATEGORY_PROJECTION_V2, CATEGORY_PROJECTION_V3, canonicalizeCategoryIds, favoriteBackingKeys } from "../../src/features/game/runtime/category-projection.js";
import { createCategoryQuestionSelection, createMatchQuestionSelection, selectCharadesQuestion, type RuntimeQuestionV32 } from "../../src/features/game/runtime/question-selector.js";
import { parseSetupQuery } from "../../src/features/game/setup-options.js";

const card = (id: string, categoryId: string, concept = id, modality: RuntimeQuestionV32["modality"] = "classic"): RuntimeQuestionV32 => ({ id, categoryId, modality, answerConceptId: concept, headerAr: "", promptAr: "", canonicalAnswer: id, acceptedAnswers: [id] });

test("favorite selection finds the validated original keys without rewriting them", () => {
  const alias = "local.saved:tahadani-games-272", canonical = "local.saved:tahadani-047";
  assert.deepEqual(favoriteBackingKeys([alias], canonical), [alias]);
  assert.deepEqual(favoriteBackingKeys([alias, canonical], canonical), [alias, canonical]);
  assert.deepEqual(favoriteBackingKeys(["local.authored-v1:tahadani-games-272"], canonical), []);
});

test("setup links canonicalize and deduplicate the old currency alias", () => {
  const setup = parseSetupQuery(new URLSearchParams("category=tahadani-games-272&category=tahadani-047"));
  assert.deepEqual(setup.categories, ["tahadani-047"]);
});

test("new category projection deduplicates aliases and allocates the physical union", () => {
  const categories = canonicalizeCategoryIds(["tahadani-047", "tahadani-games-272", "other"], CATEGORY_PROJECTION_V1);
  assert.deepEqual(categories, ["tahadani-047", "other"]);
  const questions = [...Array.from({ length: 14 }, (_, i) => card(`currency-${i}`, "tahadani-games-272")), ...Array.from({ length: 14 }, (_, i) => card(`other-${i}`, "other"))];
  const selection = createCategoryQuestionSelection(questions, { categories, modality: "classic", seed: 1, categoryProjectionVersion: CATEGORY_PROJECTION_V1 });
  assert.equal(selection.queues["tahadani-047"].length, 14);
  assert.equal(questions[0].categoryId, "tahadani-games-272");
  assert.throws(() => createCategoryQuestionSelection(questions, { categories, modality: "classic", seed: 1 }), /insufficient unique concepts/);
});

test("letter board finds alias-only questions while retaining their physical identity", () => {
  const questions = Array.from({ length: 25 }, (_, i) => ({ ...card(`q${i}`, "tahadani-games-272"), targetLetter: `letter-${i}` }));
  const selection = createMatchQuestionSelection(questions, { categories: ["tahadani-047"], modality: "classic", seed: 1, reservePerLetter: 1, categoryProjectionVersion: CATEGORY_PROJECTION_V1 });
  assert.equal(selection.queues["letter-0"][0], "q0");
  assert.equal(questions[0].categoryId, "tahadani-games-272");
  assert.throws(() => createMatchQuestionSelection(questions, { categories: ["tahadani-047"], modality: "classic", seed: 1, reservePerLetter: 1 }), /Insufficient/);
});

test("charades considers aliases without repeating a consumed performance concept", () => {
  const questions = [card("one", "tahadani-019", "same", "charades"), card("two", "tahadani-games-111", "same", "charades"), card("three", "tahadani-games-111", "different", "charades")];
  const result = selectCharadesQuestion(questions, { categories: ["tahadani-019", "tahadani-games-111"], categoryProjectionVersion: CATEGORY_PROJECTION_V1, cursor: 0, consumedAnswerConceptIds: ["same"] });
  assert.equal(result.id, "three");
  assert.equal(result.categoryId, "tahadani-games-111");
});

test("new watch selection unions the two sources while saved v1 matches retain their original pool", () => {
  const leader = "tahadani-068", alias = "tahadani-games-046";
  const questions = [...Array.from({ length: 14 }, (_, i) => card(`watch-${i}`, alias)), ...Array.from({ length: 14 }, (_, i) => card(`other-${i}`, "other"))];
  const current = createCategoryQuestionSelection(questions, { categories: [leader, alias, "other"], modality: "classic", seed: 1, categoryProjectionVersion: CATEGORY_PROJECTION_V2 });
  assert.deepEqual(current.categories, ["other", leader]);
  assert.equal(current.queues[leader].length, 14);
  assert.equal(questions[0].categoryId, alias);
  for (const version of [undefined, CATEGORY_PROJECTION_V1]) {
    assert.deepEqual(canonicalizeCategoryIds([leader, alias], version), [leader, alias]);
    assert.throws(() => createCategoryQuestionSelection(questions, { categories: [leader, "other"], modality: "classic", seed: 1, categoryProjectionVersion: version }), /insufficient unique concepts/);
  }
});

test("new source selections and favorites resolve round-three aliases without rewriting validated backing keys", () => {
  const pairs = [["tahadani-004", "tahadani-games-022"], ["tahadani-005", "tahadani-games-011"], ["tahadani-028", "tahadani-games-455"], ["tahadani-029", "tahadani-games-458"]];
  for (const [leader, alias] of pairs) {
    assert.deepEqual(canonicalizeCategoryIds([alias, leader], CATEGORY_PROJECTION_V2), [leader]);
    assert.deepEqual(canonicalizeCategoryIds([alias, leader], CATEGORY_PROJECTION_V1), [alias, leader]);
    assert.deepEqual(favoriteBackingKeys([`local.saved:${alias}`], `local.saved:${leader}`), [`local.saved:${alias}`]);
  }
});

test("round-five source unions preserve saved versions and physical favorite associations", () => {
  const pairs = [["tahadani-058", "tahadani-games-310"], ["tahadani-043", "tahadani-games-523"], ["tahadani-011", "tahadani-games-134"], ["tahadani-012", "tahadani-games-135"], ["tahadani-014", "tahadani-games-127"], ["tahadani-020", "tahadani-games-107"]];
  for (const [leader, alias] of pairs) {
    const questions = [...Array.from({ length: 14 }, (_, i) => card(`${alias}-${i}`, alias)), ...Array.from({ length: 14 }, (_, i) => card(`other-${i}`, "other"))];
    const selection = createCategoryQuestionSelection(questions, { categories: [leader, alias, "other"], modality: "classic", seed: 1, categoryProjectionVersion: CATEGORY_PROJECTION_V3 });
    assert.deepEqual(selection.categories, ["other", leader]);
    assert.equal(selection.queues[leader].length, 14);
    assert.equal(questions[0].categoryId, alias);
    for (const version of [undefined, CATEGORY_PROJECTION_V1, CATEGORY_PROJECTION_V2]) {
      assert.deepEqual(canonicalizeCategoryIds([leader, alias], version), [leader, alias]);
      assert.throws(() => createCategoryQuestionSelection(questions, { categories: [leader, "other"], modality: "classic", seed: 1, categoryProjectionVersion: version }), /insufficient unique concepts/);
    }
    assert.deepEqual(favoriteBackingKeys([`local.saved:${alias}`], `local.saved:${leader}`), [`local.saved:${alias}`]);
  }
  assert.deepEqual(canonicalizeCategoryIds(["tahadani-games-046", "tahadani-games-272"], CATEGORY_PROJECTION_V3), ["tahadani-068", "tahadani-047"]);
});
