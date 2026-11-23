import type { Principal } from '../identity';
export type ExecutionFormat = 'MIXED_BOARD' | 'STANDALONE_LIST' | 'STANDALONE_ACTING';
export type PromptFormat = 'ORDINARY_TIER' | 'DRAWING_TARGET' | 'LIST_ITEMS' | 'ACTING_ITEMS';
export type MediaRole = 'COVER' | 'PROMPT' | 'MASKED' | 'CLEAR' | 'ACTOR' | 'ITEM';
export interface RoundSetup {
  version: 4;
  categories: { key: string; promptRefs: string[] }[];
  teams: { name: string; players: string[] }[];
  rules: { turnSeconds: 15 | 30 | 45; overallSeconds: null | 300 | 600; questionSeconds: number };
}
export interface RoundStart { requestKey: string; logicalMatchId: string; setup: RoundSetup }
export interface RequestBinding extends RoundStart { version: 4; operation: 'PAID_ENTA_CLASSIC' | 'PAID_ENTA_LIST' | 'PAID_ENTA_ACTING'; executionFormat: ExecutionFormat; predecessor: null }
export interface ChunkProof { ordinal: number; byteLength: number; sha256: string }
export interface MediaPin {
  id: string; objectKey: string; objectVersion: string; sha256: string; mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'video/mp4' | 'video/webm';
  bytes: number; width: number; height: number; durationMs: number | null; codec: string | null; chunks: ChunkProof[];
  role: MediaRole; itemId: string | null;
}
export interface ItemPin { id: string; revisionId: string; hash: string; ordinal: number; text: string; value: number; trap: boolean; mediaIds: string[] }
export interface PromptPin {
  ref: string; sourceNamespace: string; sourceId: string; revisionId: string; hash: string; formatId: string; formatHash: string; categoryKey: string; format: PromptFormat;
  prompt: string; target: string | null; points: 200 | 400 | 600 | null; items: ItemPin[]; media: MediaPin[];
  rules: { version: 1; kind: PromptFormat; target: string | null };
}
export interface FormatCatalog {
  baseReleaseId: string; baseRoot: string; receiptId: string; formatReleaseId: string; formatRoot: string; mediaRoot: string;
  policyVersion: 'enta-format-1'; categories: { key: string; label: string; format: PromptFormat; prompts: PromptPin[]; cover: MediaPin | null }[];
}
export interface Exposure { categoryKey: string; sourceNamespace: string; sourceId: string; cycle: number }
export interface Selection { sourceNamespace: string; sourceId: string; revisionId: string; cycle: number; ordinal: number }
export interface FullIntent { version: 4; request: RequestBinding; baseReleaseId: string; baseRoot: string; receiptId: string; formatReleaseId: string; formatRoot: string; mediaRoot: string; policyVersion: 'enta-format-1'; poolHash: string; seed: string; selection: Selection[]; roundCount: number; pinsHash: string }
export type RoundState = 'READY' | 'RUNNING' | 'PAUSED' | 'RESOLVED';
export interface Assignment { id: string; teamId: string; playerIndex: number; itemId: string | null; generation: number }
export interface RoundRecord {
  id: string; questionId: string; ordinal: number; pin: PromptPin; state: RoundState; version: number; scoringTeamId: string | null;
  turnDeadline: number | null; overallDeadline: number | null; remainingTurn: number | null; remainingOverall: number | null;
  revealed: boolean; assignment: Assignment | null; consumed: { itemId: string; teamId: string; eventId: string }[];
  reason: 'HOST_CLOSED' | 'ALL_ITEMS' | 'TIME_EXPIRED' | 'ADJUDICATED' | null;
}
export interface RoundGame {
  id: string; identityId: string; projectId: string; hostUid: string; admissionId: string; request: RequestBinding; clientHash: string; intent: FullIntent; intentHash: string;
  version: number; finished: boolean; activeRoundId: string | null; turnIndex: number; resultReason: 'ALL_ROUNDS' | 'HOST_ENDED' | null;
  teams: { id: string; name: string; players: string[]; score: number }[];
  categories: { key: string; label: string; format: PromptFormat; cover: MediaPin | null }[]; rounds: RoundRecord[];
  events: RoundEvent[]; postings: ScorePosting[]; grants: Grant[]; grantScopes: GrantScope[]; canvases: Canvas[];
}
export type Authority = { kind: 'HOST'; identityId: string } | { kind: 'GRANT'; grantId: string; generation: number; assignmentId: string } | { kind: 'SYSTEM'; operation: 'CLOCK_SETTLEMENT' };
export interface RoundEvent { id: string; commandId: string; hash: string; sequence: number; type: string; roundId: string | null; authority: Authority; at: number; pauseReason: string | null }
export interface ScorePosting { id: string; eventId: string; roundId: string; itemId: string | null; teamId: string; delta: number; before: number; after: number; rulesVersion: 'enta-format-1' }
export type HostCommand = { commandId: string; expectedVersion: number } & (
  | { type: 'OPEN_ROUND'; roundId: string }
  | { type: 'NEXT_ROUND' }
  | { type: 'PAUSE_ROUND'; roundId: string; reason: string }
  | { type: 'RESUME_ROUND' | 'CLOSE_ROUND' | 'REVEAL_TARGET'; roundId: string }
  | { type: 'SELECT_SCORING_TEAM'; roundId: string; teamId: string }
  | { type: 'ASSIGN_ACTOR'; roundId: string; teamId: string; playerIndex: number; itemId: string | null }
  | { type: 'JUDGE_ITEM'; roundId: string; itemId: string }
  | { type: 'ADJUDICATE_ROUND'; roundId: string; teamId: string | null; correct: boolean }
  | { type: 'FINISH'; confirmEarly: boolean }
);
export interface GrantScope { id: string; roundId: string; role: 'JUDGE' | 'ACTOR'; assignmentId: string | null; generation: number; activeGrantId: string | null }
export interface Grant { id: string; scopeId: string; roundId: string; role: 'JUDGE' | 'ACTOR'; assignmentId: string | null; generation: number; tokenHash: string; expiresAt: number; revoked: boolean }
export type GrantCommand = { commandId: string; expectedVersion: number; roundId: string } & (
  | { type: 'CREATE_GRANT'; role: 'JUDGE' | 'ACTOR'; durationSeconds: number }
  | { type: 'ROTATE_GRANT'; scopeId: string; expectedGeneration: number; durationSeconds: number }
  | { type: 'REVOKE_GRANT'; scopeId: string }
);
export interface Stroke { id: string; color: '#191615' | '#ffffff' | '#ff2e95' | '#3478bd' | '#267448'; width: 2 | 5 | 10; erase: boolean; points: [number, number][] }
export interface Canvas { roundId: string; revision: number; strokes: Stroke[]; visibleIds: string[]; redoIds: string[]; cumulativePoints: number; mutations: number; receipts: { commandId: string; hash: string; revision: number }[] }
export type CanvasCommand = { commandId: string; expectedRevision: number } & ({ type: 'APPEND'; stroke: Stroke } | { type: 'UNDO' | 'REDO' | 'CLEAR' });
export interface RoundTransaction {
  lockWallet(principal: Principal): Promise<{ identityId: string; available: bigint; debt: bigint }>;
  findStart(principal: Principal, requestKey: string, logicalId: string): Promise<RoundGame | null>;
  catalog(principal: Principal, format: ExecutionFormat): Promise<FormatCatalog>;
  exposures(principal: Principal, format: ExecutionFormat, categoryKey: string): Promise<Exposure[]>;
  create(principal: Principal, request: RequestBinding, intent: FullIntent, pins: PromptPin[], catalog: FormatCatalog): Promise<RoundGame>;
  loadOwner(principal: Principal, id: string, lock: boolean): Promise<RoundGame | null>;
  locateGrant(hash: string): Promise<{ gameId: string } | null>;
  loadGrant(gameId: string, tokenHash: string): Promise<RoundGame | null>;
  save(before: RoundGame, next: RoundGame, command: HostCommand | GrantCommand | CanvasCommand | null): Promise<{ game: RoundGame; rejection: 'ROUND_TIME_EXPIRED' | null }>;
  now(): Promise<number>;
}
export interface RoundRepository { source: 'postgres' | 'test-only' | 'local-development'; projectId: string; transaction<T>(work: (tx: RoundTransaction) => Promise<T>): Promise<T> }

