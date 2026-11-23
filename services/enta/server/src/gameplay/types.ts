import type { ReceiptPolicyInput } from "../wallet/financial-policy";
import type { StoredEntaAvailability } from "../catalog/selector-replay";
import type { EntaClassicSourceQuestion } from "../catalog/selectors";
import type { KidsSource, KidsTierProof } from "../catalog/kids-selector";
import type { ModeReceiptInput } from "../wallet/enta-mode-policy";

export type MatchPhase = "BOARD" | "QUESTION_OPEN" | "REVEALED" | "FINISHED";
export type EntaMode = "CLASSIC" | "KIDS";
export interface SuccessorSetup extends Omit<ClassicSetup, "version"> { version: 3 }
export interface SuccessorStart { requestKey: string; logicalMatchId: string; setup: SuccessorSetup }
export interface RematchStart extends SuccessorStart { predecessorVersion: number }
export interface PreparedSuccessor extends SuccessorStart {
  setupHash: string; intentHash: string; requestHash: string; requestVersion: 3;
  mode: EntaMode; operation: "PAID_ENTA_CLASSIC" | "PAID_ENTA_KIDS"; startKind: "START" | "REMATCH";
  predecessor: null | { gameId: string; version: number };
}
export interface HistoryQuery { limit: number; mode: EntaMode | null; status: "ACTIVE" | "FINISHED" | null; cursor: null | { id: string; createdAt: string } }
export interface HistoryRow { id: string; mode: EntaMode; status: "ACTIVE" | "FINISHED"; createdAt: string; finishedAt: string | null; teams: { name: string; score: number }[]; resultReason: "ALL_QUESTIONS_PLAYED" | "HOST_ENDED" | null; unplayedCount: number }
export interface HistoryProjection { matches: HistoryRow[]; nextCursor: string | null }
export interface ClassicSetup {
  version: 2;
  categoryKeys: string[];
  teams: { name: string; players: string[]; lifelines: [] }[];
  rules: { questionSeconds: number };
}
export interface StartCommand { requestKey: string; logicalMatchId: string; setup: ClassicSetup }
export interface PreparedStart extends StartCommand { setupHash: string; intentHash: string; requestHash: string; requestVersion: 2 }
export type MatchCommand = { commandId: string; expectedVersion: number } & (
  | { type: "OPEN_QUESTION"; questionId: string }
  | { type: "REVEAL_ANSWER"; questionId: string }
  | { type: "ADJUDICATE"; questionId: string; ruling: "CORRECT" | "NO_SCORE"; teamId: string | null }
  | { type: "FINISH"; confirmEarly: boolean }
);
export interface PinnedQuestion {
  id: string; revisionId: string; contentHash: string; sourceQuestionId: string; categoryKey: string;
  points: 200 | 400 | 600; prompt: string; answers: { text: string; isCorrect: boolean; isTrap: boolean }[];
  isOpened: boolean; isCorrect: boolean | null; answeredByTeamId: string | null;
}
export interface MatchRecord {
  /** Missing on saved pre-projection matches; those retain physical category pools. */
  localCategoryProjectionVersion?: "category-groups-v1" | "category-groups-v2";
  mode?: EntaMode; createdAt?: string; finishedAt?: string;
  id: string; identityId: string; projectId: string; hostUid: string; admissionId: string;
  releaseId: string; releaseRootHash: string; setup: ClassicSetup | SuccessorSetup; setupHash: string;
  version: number; phase: MatchPhase; turnIndex: number; activeQuestionId: string | null; activeTeamId: string | null;
  deadlineAt: number | null; resultReason: "ALL_QUESTIONS_PLAYED" | "HOST_ENDED" | null; unplayedCount: number;
  teams: { id: string; name: string; players: string[]; score: number }[];
  categories: { key: string; label: string; revisionId: string }[];
  questions: PinnedQuestion[];
}
export interface CommandReceipt { commandId: string; type: MatchCommand["type"] | "START"; sequence: number; intentHash: string }
export interface MatchProjection {
  id: string; mode: EntaMode; version: number; phase: MatchPhase; serverNow: number;
  rules: { questionSeconds: number }; teams: { id: string; name: string; players: string[]; score: number }[];
  categories: { key: string; label: string }[];
  tiles: { id: string; categoryKey: string; points: number; used: boolean; active: boolean; answeredByTeamId: string | null; isCorrect: boolean | null }[];
  turnTeamId: string; currentQuestion: null | { id: string; prompt: string; points: number; answeringTeamId: string; deadlineAt: number; answers?: string[] };
  result: null | { reason: "ALL_QUESTIONS_PLAYED" | "HOST_ENDED"; unplayedCount: number; winnerTeamIds: string[]; isTie: boolean };
}
export interface PreparedCatalog {
  receipt: ReceiptPolicyInput;
  availability: StoredEntaAvailability[];
  selectorSources: EntaClassicSourceQuestion[];
  categories: { key: string; label: string; revisionId: string; questions: Omit<PinnedQuestion, "id" | "isOpened" | "isCorrect" | "answeredByTeamId">[] }[];
}
export interface SuccessorCatalog { receipt: ModeReceiptInput; categories: PreparedCatalog["categories"]; kidsSources: KidsSource[]; kidsProofs: KidsTierProof[]; classic: PreparedCatalog | null }
export interface CatalogProjection { mode: EntaMode; categoryCount: 6 | 1; categories: { key: string; label: string; favoriteKey?: string }[]; availableCredit: string }
export class EntaError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export const fail = (status: number, code: string): never => { throw new EntaError(status, code); };
