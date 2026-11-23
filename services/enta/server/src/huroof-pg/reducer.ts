import { expireRoom, reduceIntent, validIntent, type CanonicalMember, type CanonicalRoom, type GameIntent } from "../../../../../functions/src/game.js";
import { prepareIntentContent, type PinnedQuestionReader } from "../../../../../functions/src/content-preparation.js";

/** Called only after authentication, actor authority, receipt replay and state load. */
export async function reduceCommand(room: CanonicalRoom, actor: CanonicalMember, intent: GameIntent, now: number, members: CanonicalMember[], readPinnedQuestions: PinnedQuestionReader, manualParticipantId?: string) {
  if (!validIntent(intent) || !Number.isSafeInteger(now) || now < 0) throw new Error("INVALID_COMMAND");
  // Work on a private snapshot: a failed preparation cannot mutate a caller's state.
  const working = structuredClone(room);
  const prepared = await prepareIntentContent(working, actor, intent, members, readPinnedQuestions);
  return reduceIntent(prepared.room, actor, intent, now, prepared.question, members, prepared.letters, prepared.surpriseLetter, manualParticipantId);
}
/** Timer expiry is a distinct, server-timestamped CAS operation, never an implicit client command. */
export function reduceExpiry(room: CanonicalRoom, now: number): CanonicalRoom {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("INVALID_SERVER_TIME");
  return expireRoom(structuredClone(room), now);
}

import { deriveMatch } from "../../../../../src/features/game/domain/lifecycle.js";
/** Excludes transport revision and timestamps; compares actual board, scores and outcomes. */
export function resultSemantics(room: CanonicalRoom) {
  const game = room.game;
  return { board: game.board, questionScores: game.questionScores, roundOutcomeHistory: game.roundOutcomeHistory, currentRound: game.currentRound, endedWithoutWinner: Boolean(game.endedWithoutWinner), match: deriveMatch(game) };
}
function canonicalResult(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, item => item === undefined ? "null" : canonicalResult(item)).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalResult(record[key])}`).join(",")}}`;
  }
  throw new Error("INVALID_RESULT_SEMANTICS");
}
export function sameResult(left: CanonicalRoom, right: CanonicalRoom): boolean {
  return canonicalResult(resultSemantics(left)) === canonicalResult(resultSemantics(right));
}

