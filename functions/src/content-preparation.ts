import { makeBoard, preflightContentPreparation, roomGameKind, type CanonicalMember, type CanonicalQuestion, type CanonicalRoom, type GameIntent } from "./game.js";
import { generateCategoryBoard } from "../../src/features/game/domain/board.js";
import { addChallengeReplacementReserve, assertChallengeSelectionCapacity, beginNextChallengeSelectionRound, createMatchQuestionSelection, createCategoryQuestionSelection, createChallengeCategoryQuestionSelection, promoteReservedChallengeQuestion, promoteReservedQuestion, reserveChallengeQuestionForCell, reserveQuestionForCell, selectChallengeCategoryQuestion, selectCharadesQuestion, selectCategoryQuestion, selectMatchQuestion, type ChallengeCategoryQuestionSelection } from "../../src/features/game/runtime/challenge-question-selector.js";
import type { FamilySlot } from "../../src/features/game/challenges/family-allocation.js";
export function questionRows(docs: Array<{ id: string; data(): Record<string, unknown> }>): CanonicalQuestion[] {
  const rows = docs.map((item) => ({ id: item.id, ...(item.data() as Partial<CanonicalQuestion>) }));
  if (
    docs.some((item) => item.data()?.id !== item.id) ||
    rows.some(
      (item) =>
        typeof item.id !== "string" ||
        typeof item.categoryId !== "string" ||
        (item.modality !== "classic" &&
          item.modality !== "image" &&
          item.modality !== "video" &&
          item.modality !== "charades") ||
        typeof item.answerConceptId !== "string" ||
        !item.answerConceptId ||
        typeof item.headerAr !== "string" ||
        typeof item.promptAr !== "string" ||
        typeof item.canonicalAnswer !== "string" ||
        !Array.isArray(item.acceptedAnswers) ||
        (item.challenge !== undefined && (!item.challenge || typeof item.challenge !== "object" || !item.challenge.definition || typeof item.challenge.definition !== "object" || typeof item.challenge.definition.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.challenge.definition.manifestSha256) || typeof item.challenge.definition.id !== "string" || typeof item.challenge.definition.definitionSha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.challenge.definition.definitionSha256) || !["t36-challenge-definition-v1", "t37-clean70-challenge-definition-v1", "t37-topup-word-search-definition-v1"].includes(item.challenge.definition.schemaVersion) || !Array.isArray(item.challenge.factFamilies) || !item.challenge.factFamilies.every((family: unknown) => typeof family === "string" && family.length > 0) || !["navigation", "missing_tile", "memory", "qatar_map", "word_search"].includes(item.challenge.kind))) ||
        (item.modality === "charades"
          ? Boolean(item.targetLetter)
          : typeof item.targetLetter !== "string"),
    )
  )
    throw new PreparationError("Pinned release contains an incomplete runtime question.");
  return rows as CanonicalQuestion[];
}

export type PinnedQuestionReader = (room: CanonicalRoom) => Promise<CanonicalQuestion[]>;
export class PreparationError extends Error {}
export class PreparationPreflightError extends Error { constructor(readonly reason: unknown) { super("PREPARATION_PREFLIGHT"); } }

export const runtimeQuestions = (questions: CanonicalQuestion[]) =>
  questions.map((question) => {
    if (!question.categoryId || !question.modality || !question.answerConceptId)
      throw new Error(
        "Pinned release question lacks required runtime identity.",
      );
    return {
      ...question,
      categoryId: question.categoryId,
      modality: question.modality,
      answerConceptId: question.answerConceptId,
    };
  });
export function challengeQuestionsForRoom(
  questions: CanonicalQuestion[],
  challenge: CanonicalRoom["config"]["challenge"] | undefined,
) {
  return !challenge
    ? questions.filter((question) => !question.challenge)
    : questions.filter((question) => !question.challenge || challenge.mechanics.includes(question.challenge.kind));
}

export function releaseLetters(questions: CanonicalQuestion[], room: CanonicalRoom) {
  if (room.config.modality === "charades")
    throw new Error("Charades never creates a letter-board selection.");
  const selection =
    room.questionSelection ??
    createMatchQuestionSelection(runtimeQuestions(challengeQuestionsForRoom(questions, room.config.challenge)), {
      categories: room.config.categories ?? [],
      modality: room.config.modality ?? "classic",
      seed: room.questionCursor + 1,
      reservePerLetter: 3,
    });
  room.questionSelection = selection;
  return Object.keys(selection.queues);
}
function isChallengeSelection(selection: CanonicalRoom["questionSelection"]): selection is ChallengeCategoryQuestionSelection {
  return !!selection && "challengeFamilyState" in selection;
}
/**
 * Board slots are bound to the board persisted in the room, not to the
 * question cursor.  The cursor advances after every card selection while a
 * board remains immutable for its whole round.
 */
export function categoryChallengePlanForBoard(board: NonNullable<CanonicalRoom["game"]["board"]>): { boardSlots: FamilySlot[]; reserveSlots: FamilySlot[] } {
  if (!Number.isSafeInteger(board.seed)) throw new Error("Challenge category board has an invalid stable marker.");
  const marker = String(board.seed);
  const boardSlots = board.cells.map((cell) => {
    if (!cell.categoryId) throw new Error("Challenge category board cell is missing category scope.");
    return { slotId: `board:${marker}:${cell.id}`, categoryId: cell.categoryId };
  });
  const categories = [...new Set(boardSlots.map((slot) => slot.categoryId))].sort();
  return { boardSlots, reserveSlots: categories.map((categoryId) => ({ slotId: `reserve:${marker}:${categoryId}:0`, categoryId })) };
}
function challengeRemainingSlots(selection: ChallengeCategoryQuestionSelection, selectedSlotId?: string): FamilySlot[] {
  const occupied = new Set([...selection.challengeCompletedSlotIds, ...Object.values(selection.challengeSlotForCell)]);
  if (selectedSlotId) occupied.add(selectedSlotId);
  return selection.challengePlannedSlots.filter((slot) => !occupied.has(slot.slotId));
}

function boardCellId(slotId: string): string | undefined {
  return /^board:[^:]+:(cell-[0-4]-[0-4])$/u.exec(slotId)?.[1];
}

/**
 * M6 initially regenerated the plan from questionCursor. Existing QA rooms
 * can therefore contain unoccupied board slots whose category differs from
 * the immutable board. Correct only those unoccupied category claims. Every
 * completed/reserved slot, selector history, family state, and reservation ID
 * stays byte-for-byte intact; an occupied mismatch fails before any write.
 * Older affected rooms may have an owned board cell whose completed-slot entry
 * was discarded by the old round reset. Its board owner and consumed families
 * remain authoritative, so its stale untracked plan category is corrected but
 * its slot deliberately remains in future capacity accounting (conservative
 * over-reservation rather than making an awarded question available again).
 */
export function reconcileChallengeSelectionForCurrentBoard(
  runtime: ReturnType<typeof runtimeQuestions>,
  selection: ChallengeCategoryQuestionSelection,
  room: CanonicalRoom,
): ChallengeCategoryQuestionSelection {
  const board = room.game.board;
  if (!board) throw new Error("CHALLENGE_SELECTION_BOARD_PLAN_INVALID");
  const expectedPlan = categoryChallengePlanForBoard(board);
  const expectedByCell = new Map(expectedPlan.boardSlots.map((slot) => [boardCellId(slot.slotId)!, slot]));
  const persistedByCell = new Map<string, FamilySlot>();
  for (const slot of selection.challengeBoardSlots) {
    const cellId = boardCellId(slot.slotId);
    if (!cellId || persistedByCell.has(cellId)) throw new Error("CHALLENGE_SELECTION_BOARD_PLAN_INVALID");
    persistedByCell.set(cellId, slot);
  }
  if (persistedByCell.size !== expectedByCell.size || [...expectedByCell.keys()].some((cellId) => !persistedByCell.has(cellId)))
    throw new Error("CHALLENGE_SELECTION_BOARD_PLAN_INVALID");

  const plannedById = new Map(selection.challengePlannedSlots.map((slot) => [slot.slotId, slot]));
  const reserveById = new Map(selection.challengeReserveSlots.map((slot) => [slot.slotId, slot]));
  const selectedCategories = new Set(selection.categories);
  const allPersistedSlots = [...selection.challengeBoardSlots, ...selection.challengeReserveSlots];
  if (
    plannedById.size !== selection.challengePlannedSlots.length ||
    reserveById.size !== selection.challengeReserveSlots.length ||
    new Set(allPersistedSlots.map((slot) => slot.slotId)).size !== allPersistedSlots.length ||
    selection.challengePlannedSlots.length !== allPersistedSlots.length ||
    allPersistedSlots.some((slot) => plannedById.get(slot.slotId)?.categoryId !== slot.categoryId || !selectedCategories.has(slot.categoryId)) ||
    [...persistedByCell.values()].some((slot) => !plannedById.has(slot.slotId)) ||
    selection.categories.some((categoryId) => !selection.challengeReserveSlots.some((slot) => slot.categoryId === categoryId))
  )
    throw new Error("CHALLENGE_SELECTION_BOARD_PLAN_INVALID");
  const recordedOccupied = new Set([...selection.challengeCompletedSlotIds, ...Object.values(selection.challengeSlotForCell)]);
  if (
    new Set(selection.challengeCompletedSlotIds).size !== selection.challengeCompletedSlotIds.length ||
    [...recordedOccupied].some((slotId) => !plannedById.has(slotId))
  ) throw new Error("CHALLENGE_SELECTION_OCCUPANCY_INVALID");
  const ownedUntracked = new Set(
    board.cells
      .filter((cell) => cell.owner)
      .map((cell) => persistedByCell.get(cell.id)?.slotId)
      .filter((slotId): slotId is string => Boolean(slotId && !recordedOccupied.has(slotId))),
  );
  const originalByCell = new Map(
    generateCategoryBoard(board.seed, room.config.categorySnapshot ?? [])
      .cells.map((cell) => [cell.id, cell]),
  );
  const reservationIds = selection.reservedForCell ?? {};
  const reservedSlotIds = selection.challengeFamilyState.reservedForSlot;
  const reservationCells = new Set(Object.keys(reservationIds));
  const activeReplacementBoardSlots = new Set<string>();
  for (const [cellId, slotId] of Object.entries(selection.challengeSlotForCell)) {
    const questionId = reservationIds[cellId];
    const stateQuestionId = reservedSlotIds[slotId];
    const expected = expectedByCell.get(cellId);
    const boardSlot = persistedByCell.get(cellId);
    const original = originalByCell.get(cellId as `cell-${number}-${number}`);
    if (!questionId || questionId !== stateQuestionId || !expected || !boardSlot) throw new Error("CHALLENGE_SELECTION_RESERVATION_INVALID");
    const question = runtime.find((candidate) => candidate.id === questionId);
    if (!question || question.categoryId !== expected.categoryId) throw new Error("CHALLENGE_SELECTION_RESERVATION_CATEGORY_CONFLICT");
    if (slotId !== boardSlot.slotId) {
      const history = selection.challengeReplacementHistory?.[cellId];
      if (!reserveById.has(slotId) || !selection.challengeCompletedSlotIds.includes(boardSlot.slotId))
        throw new Error("CHALLENGE_SELECTION_RESERVATION_INVALID");
      if (boardSlot.categoryId !== expected.categoryId) {
        if (
          !history ||
          history.boardSlotId !== boardSlot.slotId ||
          history.reserveSlotId !== slotId ||
          history.originalCategoryId !== boardSlot.categoryId ||
          history.originalCategoryId !== original?.categoryId ||
          history.replacementCategoryId !== expected.categoryId
        ) throw new Error("CHALLENGE_SELECTION_REPLACEMENT_LINEAGE_INVALID");
        activeReplacementBoardSlots.add(boardSlot.slotId);
      }
    } else if (boardSlot.categoryId !== expected.categoryId) {
      throw new Error("CHALLENGE_SELECTION_RESERVATION_CATEGORY_CONFLICT");
    }
    reservationCells.delete(cellId);
  }
  if (reservationCells.size || Object.keys(reservedSlotIds).some((slotId) => !Object.values(selection.challengeSlotForCell).includes(slotId)))
    throw new Error("CHALLENGE_SELECTION_RESERVATION_INVALID");

  const historicalReplacementBoardSlots = new Set(
    Object.entries(selection.challengeReplacementHistory ?? {})
      .filter(([cellId, history]) => {
        const boardSlot = persistedByCell.get(cellId);
        const original = originalByCell.get(cellId as `cell-${number}-${number}`);
        const current = expectedByCell.get(cellId);
        return Boolean(
          boardSlot && original && current &&
          selection.challengeCompletedSlotIds.includes(boardSlot.slotId) &&
          selection.challengeCompletedSlotIds.includes(history.reserveSlotId) &&
          reserveById.get(history.reserveSlotId)?.categoryId === current.categoryId &&
          history.boardSlotId === boardSlot.slotId &&
          history.reserveSlotId !== boardSlot.slotId &&
          history.originalCategoryId === boardSlot.categoryId &&
          history.originalCategoryId === original.categoryId &&
          history.replacementCategoryId === current.categoryId &&
          original.categoryId !== current.categoryId,
        );
      })
      .map(([, history]) => history.boardSlotId),
  );
  const correctedBoardSlots = selection.challengeBoardSlots.map((slot) => {
    const cellId = boardCellId(slot.slotId)!;
    const expected = expectedByCell.get(cellId)!;
    const validReplacement = activeReplacementBoardSlots.has(slot.slotId) || historicalReplacementBoardSlots.has(slot.slotId);
    if (recordedOccupied.has(slot.slotId) && slot.categoryId !== expected.categoryId && !validReplacement)
      throw new Error("CHALLENGE_SELECTION_OCCUPIED_CATEGORY_CONFLICT");
    // `ownedUntracked` has no slot receipt left to preserve; see the recovery
    // contract above. Its consumed family state remains untouched.
    if (ownedUntracked.has(slot.slotId)) return { ...slot, categoryId: expected.categoryId };
    return recordedOccupied.has(slot.slotId) ? slot : { ...slot, categoryId: expected.categoryId };
  });
  const correctedById = new Map(correctedBoardSlots.map((slot) => [slot.slotId, slot]));
  const corrected = {
    ...selection,
    challengeBoardSlots: correctedBoardSlots,
    challengePlannedSlots: selection.challengePlannedSlots.map((slot) => correctedById.get(slot.slotId) ?? slot),
  };
  assertChallengeSelectionCapacity(runtime, corrected, challengeRemainingSlots(corrected));
  return corrected;
}

/** A retry keeps the current category; after a prior replacement its new reserve supersedes the consumed reserve in the auditable lineage. */
export function updateChallengeRetryLineage(
  selection: ChallengeCategoryQuestionSelection,
  cellId: string,
  boardSlot: FamilySlot | undefined,
  retrySlot: FamilySlot,
): ChallengeCategoryQuestionSelection {
  if (!boardSlot || boardSlot.categoryId === retrySlot.categoryId) return selection;
  const history = selection.challengeReplacementHistory?.[cellId];
  if (
    !history ||
    history.boardSlotId !== boardSlot.slotId ||
    history.originalCategoryId !== boardSlot.categoryId ||
    history.replacementCategoryId !== retrySlot.categoryId ||
    !selection.challengeReserveSlots.some((slot) => slot.slotId === retrySlot.slotId && slot.categoryId === retrySlot.categoryId)
  ) throw new Error("CHALLENGE_SELECTION_REPLACEMENT_LINEAGE_INVALID");
  return {
    ...selection,
    challengeReplacementHistory: {
      ...(selection.challengeReplacementHistory ?? {}),
      [cellId]: { ...history, reserveSlotId: retrySlot.slotId },
    },
  };
}

export function releaseCategorySelection(questions: CanonicalQuestion[], room: CanonicalRoom, nextRound = false) {
  if (room.config.challenge) {
    const runtime = runtimeQuestions(questions).filter((question) => question.modality !== "charades" && (!question.challenge || room.config.challenge!.mechanics.includes(question.challenge.kind)));
    const board = nextRound || !room.game.board ? makeBoard(room) : room.game.board;
    const plan = categoryChallengePlanForBoard(board);
    try {
      const selection = isChallengeSelection(room.questionSelection)
        ? nextRound
          ? beginNextChallengeSelectionRound(runtime, room.questionSelection, plan)
          : reconcileChallengeSelectionForCurrentBoard(runtime, room.questionSelection, room)
        : createChallengeCategoryQuestionSelection(runtime, { categories: room.config.categories ?? [], modality: "classic", seed: room.questionCursor + 1 }, plan);
      room.questionSelection = selection;
      return selection;
    } catch (error) {
      if (isChallengeAllocationExhausted(error))
        throw new PreparationError("CONTENT_DEPLETED");
      throw error;
    }
  }
  const selection = room.questionSelection ?? createCategoryQuestionSelection(runtimeQuestions(challengeQuestionsForRoom(questions, undefined)), {
    categories: room.config.categories ?? [], modality: "classic", seed: room.questionCursor + 1,
  });
  room.questionSelection = selection;
  return selection;
}
export function releaseRoundReservations(room: CanonicalRoom) {
  if (!room.questionSelection || isChallengeSelection(room.questionSelection)) return;
  room.questionSelection = { ...room.questionSelection, reservedQuestionIds: [], reservedAnswerConceptIds: [], reservedForCell: {} };
}

function isChallengeAllocationExhausted(reason: unknown) {
  return reason instanceof Error && (
    reason.message.startsWith("Insufficient family-safe reserve") ||
    reason.message.startsWith("No family-safe reservation") ||
    reason.message.startsWith("Family allocation search budget exhausted")
  );
}

async function pinnedQuestion(
  readQuestions: PinnedQuestionReader,
  room: CanonicalRoom,
  activeCellId = room.game.activeCellId,
): Promise<{ question: CanonicalQuestion; surpriseLetter?: string }> {
  try {
    roomGameKind(room);
    const questions = await readQuestions(room);
    const runtime = runtimeQuestions(challengeQuestionsForRoom(questions, room.config.challenge));
    if (room.config.modality === "charades")
      {
        const question = selectCharadesQuestion(runtime, {
          categories: room.config.categories ?? [],
          cursor: room.questionCursor,
          consumedQuestionIds: room.questionSelection?.consumedQuestionIds,
          consumedAnswerConceptIds:
            room.questionSelection?.consumedAnswerConceptIds,
        }) as CanonicalQuestion;
        room.questionSelection = {
          queues: {},
          consumedQuestionIds: [
            ...(room.questionSelection?.consumedQuestionIds ?? []),
            question.id,
          ],
          consumedAnswerConceptIds: [
            ...(room.questionSelection?.consumedAnswerConceptIds ?? []),
            question.answerConceptId!,
          ],
          seed: room.questionCursor + 1,
          categories: [...(room.config.categories ?? [])].sort(),
          modality: "charades",
        };
        return { question };
      }
    const active = room.game.board?.cells.find(
      (cell) => cell.id === activeCellId,
    );
    if (!active) throw new Error("No active board cell.");
    if (roomGameKind(room) === "categories") {
      const selection = releaseCategorySelection(questions, room);
      const result = isChallengeSelection(selection)
        ? (() => {
            const challengeRuntime = runtime.filter((question) => question.modality !== "charades" && (!question.challenge || room.config.challenge!.mechanics.includes(question.challenge.kind)));
            const promoted = promoteReservedChallengeQuestion(challengeRuntime, selection, active.id);
            if (promoted) return promoted;
            const slot = selection.challengeBoardSlots.find((candidate) => candidate.slotId.endsWith(`:${active.id}`));
            if (!slot) throw new Error("CHALLENGE_SLOT_MISSING");
            return selectChallengeCategoryQuestion(challengeRuntime, selection, slot, challengeRemainingSlots(selection, slot.slotId));
          })()
        : (promoteReservedQuestion(runtime, selection, active.id) ?? selectCategoryQuestion(runtime, selection, active.categoryId ?? ""));
      const question = questions.find((candidate) => candidate.id === result.question.id);
      if (!question || question.categoryId !== active.categoryId)
        throw new Error("Pinned release lacks the selected category question.");
      room.questionSelection = result.selection;
      return { question };
    }
    const selection =
      room.questionSelection ??
      createMatchQuestionSelection(runtime, {
        categories: room.config.categories ?? [],
        modality: room.config.modality ?? "classic",
        seed: room.questionCursor + 1,
        reservePerLetter: 3,
      });
    const used = new Set(
      room.game.board!.cells.flatMap((cell) =>
        cell.kind === "letter"
          ? [cell.visibleValue]
          : cell.revealedLetter
            ? [cell.revealedLetter]
            : [],
      ),
    );
    const candidates = Object.keys(selection.queues)
      .filter((letter) => !used.has(letter))
      .sort();
    const surpriseLetter =
      active.kind === "surprise" && !active.revealedLetter
        ? candidates[room.questionCursor % candidates.length]
        : undefined;
    const letter =
      surpriseLetter ?? active.revealedLetter ?? active.visibleValue;
    if (!letter) throw new Error("No unused surprise letter.");
    const promoted = promoteReservedQuestion(runtime, selection, active.id);
    const result = promoted ?? selectMatchQuestion(runtime, selection, letter);
    const question = questions.find(
      (candidate) => candidate.id === result.question.id,
    );
    if (
      !question ||
      !question.targetLetter?.trim() ||
      question.targetLetter.trim() !== letter.trim()
    )
      throw new Error(
        "Pinned release question is missing its selected target letter.",
      );
    room.questionSelection = result.selection;
    return { question, ...(surpriseLetter ? { surpriseLetter } : {}) };
  } catch (error) {
    if (error instanceof PreparationError && error.message === 'CONTENT_DEPLETED') throw error;
    if (error instanceof Error && (/No unused question\/concept reserve|No unused surprise letter/.test(error.message)))
      throw new PreparationError('CONTENT_DEPLETED');
    throw new PreparationError(error instanceof Error ? error.message : "Pinned release has no playable question.");
  }
}
/** Retry reserves a fresh question without changing the active cell's scope; the callable promotes it immediately. */
async function retryFailedCell(
  readQuestions: PinnedQuestionReader,
  room: CanonicalRoom,
): Promise<CanonicalRoom> {
  const cell = room.game.board?.cells.find((item) => item.id === room.game.activeCellId);
  if (!cell || !room.questionSelection)
    throw new PreparationError("CONTENT_DEPLETED");
  const questions = await readQuestions(room);
  const runtime = runtimeQuestions(challengeQuestionsForRoom(questions, room.config.challenge));
  const queueKey = roomGameKind(room) === "categories"
    ? cell.categoryId
    : cell.revealedLetter ?? cell.visibleValue;
  if (!queueKey)
    throw new PreparationError("CONTENT_DEPLETED");
  try {
    if (roomGameKind(room) === "categories" && isChallengeSelection(room.questionSelection)) {
      const challengeRuntime = runtime.filter((question) => question.modality !== "charades" && (!question.challenge || room.config.challenge!.mechanics.includes(question.challenge.kind)));
      let selection = room.questionSelection;
      let slot = selection.challengeReserveSlots.find((entry) => entry.categoryId === queueKey && !selection.challengeCompletedSlotIds.includes(entry.slotId) && !Object.values(selection.challengeSlotForCell).includes(entry.slotId));
      if (!slot) { slot = { slotId: `retry:${room.questionCursor + 1}:${cell.id}:${queueKey}:${selection.challengeReserveSlots.length}`, categoryId: queueKey }; selection = addChallengeReplacementReserve(challengeRuntime, selection, slot); }
      const selected = reserveChallengeQuestionForCell(challengeRuntime, selection, slot, challengeRemainingSlots(selection, slot.slotId), cell.id);
      const boardSlot = selection.challengeBoardSlots.find((entry) => entry.slotId.endsWith(`:${cell.id}`));
      return { ...room, questionSelection: updateChallengeRetryLineage(selected.selection, cell.id, boardSlot, slot) };
    }
    const selected = reserveQuestionForCell(runtime, room.questionSelection, queueKey, cell.id);
    return { ...room, questionSelection: selected.selection };
  } catch {
    throw new PreparationError("CONTENT_DEPLETED");
  }
}
/** Returning to the board reserves a replacement before its cell changes, so concurrent selection cannot steal it. */
export async function replaceFailedCell(
  readQuestions: PinnedQuestionReader,
  room: CanonicalRoom,
): Promise<CanonicalRoom> {
  const cell = room.game.board?.cells.find((item) => item.id === room.game.activeCellId);
  if (!cell || !room.questionSelection || !room.game.board)
      throw new PreparationError("CONTENT_DEPLETED");
  const questions = await readQuestions(room);
  const runtime = runtimeQuestions(challengeQuestionsForRoom(questions, room.config.challenge));
  if (roomGameKind(room) === "categories") {
    const alternatives = (room.config.categories ?? []).filter((id) => id !== cell.categoryId).sort();
    const originalChallengeBoardSlot = isChallengeSelection(room.questionSelection)
      ? room.questionSelection.challengeBoardSlots.find((entry) => entry.slotId.endsWith(`:${cell.id}`))
      : undefined;
    let selected: { question: import("../../src/features/game/runtime/challenge-question-selector.js").RuntimeQuestionV32; selection: CanonicalRoom["questionSelection"] } | undefined;
    let categoryId: string | undefined;
    for (const candidate of alternatives) try {
      if (isChallengeSelection(room.questionSelection)) {
        const challengeRuntime = runtime.filter((question) => question.modality !== "charades" && (!question.challenge || room.config.challenge!.mechanics.includes(question.challenge.kind)));
        let selection = room.questionSelection;
        let slot = selection.challengeReserveSlots.find((entry) => entry.categoryId === candidate && !selection.challengeCompletedSlotIds.includes(entry.slotId) && !Object.values(selection.challengeSlotForCell).includes(entry.slotId));
        if (!slot) { slot = { slotId: `replacement:${room.questionCursor + 1}:${cell.id}:${candidate}:${selection.challengeReserveSlots.length}`, categoryId: candidate }; selection = addChallengeReplacementReserve(challengeRuntime, selection, slot); }
        selected = reserveChallengeQuestionForCell(challengeRuntime, selection, slot, challengeRemainingSlots(selection, slot.slotId), cell.id);
      } else selected = reserveQuestionForCell(runtime, room.questionSelection, candidate, cell.id);
      categoryId = candidate;
      break;
    } catch { /* explicit hold/recovery is handled by the caller when none remain */ }
    if (!selected || !categoryId)
      throw new PreparationError("CONTENT_DEPLETED");
    if (originalChallengeBoardSlot && isChallengeSelection(selected.selection)) {
      const replacementSlotId = selected.selection.challengeSlotForCell[cell.id];
      if (!replacementSlotId || !selected.selection.challengeReserveSlots.some((slot) => slot.slotId === replacementSlotId && slot.categoryId === categoryId))
        throw new PreparationError("CONTENT_DEPLETED");
      selected = {
        ...selected,
        selection: {
          ...selected.selection,
          challengeReplacementHistory: {
            ...(selected.selection.challengeReplacementHistory ?? {}),
            [cell.id]: {
              boardSlotId: originalChallengeBoardSlot.slotId,
              reserveSlotId: replacementSlotId,
              originalCategoryId: originalChallengeBoardSlot.categoryId,
              replacementCategoryId: categoryId,
            },
          },
        },
      };
    }
    const labelAr = room.config.categorySnapshot?.find((entry) => entry.id === categoryId)?.labelAr;
    if (!labelAr) throw new PreparationError("Category snapshot is invalid.");
    const occurrence = (room.categoryOccurrences?.[categoryId] ?? 0) + 1;
    return {
      ...room,
      questionSelection: selected.selection,
      categoryOccurrences: { ...(room.categoryOccurrences ?? {}), [categoryId]: occurrence },
      game: { ...room.game, board: { ...room.game.board, cells: room.game.board.cells.map((item) => item.id === cell.id ? { ...item, categoryId, categoryLabelAr: labelAr, categoryOccurrence: occurrence, visibleValue: String(occurrence) } : item) } },
      activeQuestion: undefined,
    };
  }
  if (cell.kind === "surprise") {
    const used = new Set(room.game.board.cells.flatMap((item) => item.kind === "letter" ? [item.visibleValue] : item.revealedLetter ? [item.revealedLetter] : []));
    const candidates = Object.keys(room.questionSelection.queues).filter((letter) => letter !== cell.revealedLetter && !used.has(letter)).sort();
    let selected: ReturnType<typeof reserveQuestionForCell> | undefined;
    let letter: string | undefined;
    for (const candidate of candidates) try {
      selected = reserveQuestionForCell(runtime, room.questionSelection, candidate, cell.id);
      letter = candidate;
      break;
    } catch { /* next eligible unused letter */ }
    if (!selected || !letter)
      throw new PreparationError("CONTENT_DEPLETED");
    return { ...room, questionSelection: selected.selection, game: { ...room.game, board: { ...room.game.board, cells: room.game.board.cells.map((item) => item.id === cell.id ? { ...item, revealedLetter: letter } : item) } }, activeQuestion: undefined };
  }
  return { ...room, activeQuestion: undefined };
}

export async function prepareIntentContent(room: CanonicalRoom, member: CanonicalMember, intent: GameIntent, members: CanonicalMember[], readQuestions: PinnedQuestionReader) {
  try { preflightContentPreparation(room, member, intent, members); } catch (reason) { throw new PreparationPreflightError(reason); }
  let question: CanonicalQuestion | undefined, surpriseLetter: string | undefined, letters: string[] | undefined;
  const gameKind = roomGameKind(room); const charades = room.config.modality === "charades";
  if (intent.type === "RETRY_CELL" && room.game.lifecycle === "QUESTION_FAILED" && !charades) { room = await retryFailedCell(readQuestions, room); ({ question } = await pinnedQuestion(readQuestions, room)); }
  if (intent.type === "RETURN_CELL" && room.game.lifecycle === "QUESTION_FAILED" && !charades) room = await replaceFailedCell(readQuestions, room);
  if (intent.type === "LETTER_REVEALED") { const active = room.game.board?.cells.find((cell) => cell.id === room.game.activeCellId); if (active?.kind === "surprise" && !active.revealedLetter) ({ question, surpriseLetter } = await pinnedQuestion(readQuestions, room)); else question = room.activeQuestion; }
  if (!charades && intent.type === "SELECT_CELL") ({ question, surpriseLetter } = await pinnedQuestion(readQuestions, room, intent.payload.cellId as string));
  if (charades && (intent.type === "START_MATCH" || intent.type === "START_NEXT_ROUND")) ({ question } = await pinnedQuestion(readQuestions, room));
  if (!charades && (intent.type === "START_MATCH" || intent.type === "START_NEXT_ROUND")) {
    if (intent.type !== "START_MATCH") releaseRoundReservations(room);
    const questions = await readQuestions(room);
    if (gameKind === "categories") releaseCategorySelection(questions, room, intent.type === "START_NEXT_ROUND"); else letters = releaseLetters(questions, room);
    if (gameKind !== "categories" && (!letters || letters.length < 25)) throw new PreparationError("Pinned release has insufficient 16 visible + 9 surprise coverage.");
  }
  return { room, question, surpriseLetter, letters };
}
