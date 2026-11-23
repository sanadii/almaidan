import type { CompetitionCommandReceipt, CompetitionCommandRejectionProof } from './competition-receipts';
import type { PageRequest } from './competition-pages';
import type { CompetitionNativeMatch, CompetitionNativeScope } from './competition-native';
import type { projectCompetitionCapability } from './competition-projection';
import type { Principal } from '../identity';
import type { Canvas, CanvasCommand, Grant, GrantScope, MediaPin, PromptPin, RoundEvent, Selection, Exposure, FormatCatalog } from './types';
import type { CapacityDisposition, CapacityReservation } from './competition-capacity';
export type CompetitionFormat = 'TIER_BOARD' | 'MIXED_BOARD' | 'STANDALONE_LIST' | 'STANDALONE_ACTING';
export type BoardAid = 'PHONE_A_FRIEND' | 'DOUBLE_ANSWER' | 'MORE_HINT' | 'TRAP' | 'PICK_ANSWERER' | 'STEAL_POINTS' | 'DOUBLE_POINTS';
export type ListAid = 'HINT' | 'PASS' | 'FREEZE' | 'DOUBLE' | 'PHONE';
export type Aid = BoardAid | ListAid;
export type ColorKey = 'CORAL' | 'SKY' | 'VIOLET' | 'MINT' | 'GOLD' | 'ROSE';
export interface CompetitionSetup {
  version: 5; categories: { key: string; promptRefs: string[] }[];
  teams: { name: string; colorKey: ColorKey; players: string[]; aids: Aid[] }[];
  rules: { version: 'enta-competitive-1'; paletteVersion: 'enta-team-palette-1'; questionSeconds: number; turnSeconds: 15 | 30 | 45; overallSeconds: null | 300 | 600; stealSeconds: 10; phoneSeconds: 60; embeddedStealCap: 200 };
}
export interface CompetitionStart { requestKey: string; logicalMatchId: string; setup: CompetitionSetup }
export interface CompetitionRequest extends CompetitionStart { version: 5; executionFormat: CompetitionFormat; operation: 'PAID_ENTA_CLASSIC' | 'PAID_ENTA_LIST' | 'PAID_ENTA_ACTING'; predecessor: null }
export interface HintProof { id: string; revisionId: string; revisionHash: string; ordinal: number; text: string; contentHash: string; safeDrawing: boolean }
export interface GraphemeProof { id: string; answerRevisionId: string; answerHash: string; segmentationVersion: string; grapheme: string; proofHash: string }
export interface CompetitionPrompt extends PromptPin { hints: HintProof[]; graphemes: GraphemeProof[]; hintRoot: string; effectValue: number; effectValueSource: 'PINNED_TIER' | 'OWNER_EMBEDDED_200'; proofHash: string }
export interface CompetitionCatalog { base: FormatCatalog; policyVersion: 'enta-competitive-1'; competitiveReleaseId: string; proofRoot: string; paletteRoot: string; prompts: CompetitionPrompt[] }
export interface CompetitionPinReference extends Selection { hash: string; categoryKey: string; format: PromptPin['format']; formatId: string; formatHash: string; proofHash: string; hintRoot: string }
export interface CompetitionIntent {
  version: 5; request: CompetitionRequest; baseReleaseId: string; baseRoot: string; receiptId: string; formatReleaseId: string; formatRoot: string; mediaRoot: string;
  domain: 'maydan.enta.competitive.start-intent.v1'; pinMaterial: 'maydan.enta.competitive.pin-references.v1'; competitiveReleaseId: string; proofRoot: string; paletteRoot: string; policyVersion: 'enta-competitive-1'; poolHash: string; seed: string; selection: CompetitionPinReference[]; roundCount: number; pinsHash: string; tournamentBinding: null;
}
export interface CompetitionTeam { id: string; name: string; colorKey: ColorKey; players: { id: string; name: string }[]; aids: Aid[]; score: number; scoreVersion: number; scoreHead: string | null }
export type Phase = 'READY' | 'MAIN' | 'TRAP' | 'STEAL' | 'SHARED' | 'TURN' | 'AWAITING_RULING' | 'RESOLVED';
export interface Pause { cause: 'ADMIN' | 'PHONE' | 'FREEZE'; eventId: string; resumeAt: number | null; phaseRemaining: number | null; overallRemaining: number | null }
export interface CompetitiveAssignment { id: string; teamId: string; playerId: string; itemId: string | null; generation: number }
export interface CompetitionRound {
  id: string; questionId: string; ordinal: number; pin: CompetitionPrompt; phase: Phase; phaseOrdinal: number; generation: number; version: number;
  originalTeamId: string | null; currentTeamId: string | null; originalDeadline: number | null; deadline: number | null; overallDeadline: number | null; pause: Pause | null;
  publicRevealed: boolean; itemReveals: string[]; assignment: CompetitiveAssignment | null; pickedPlayerId: string | null; pickedEventId: string | null;
  usedAidIds: string[]; doubleAttemptTeamId: string | null; bonus: { teamId: string; multiplier: 2; eventId: string } | null;
  revealedHintIds: string[]; graphemeHints: { proofId: string; itemId: string; eventId: string }[]; consumed: { itemId: string; effectId: string; teamId: string | null }[];
  reason: 'TIME_EXPIRED' | 'ADJUDICATED' | 'HOST_CLOSED' | 'ALL_ITEMS' | null;
  turnAdvanced: boolean;
  resourceStop: { eventId: string; at: number; reason: 'SYSTEM_CAPACITY' | 'GENERATION_BOUND' } | null;
}
export interface Allowance { id: string; teamId: string; aid: Aid; scope: 'MATCH' | 'PINNED_QUESTION'; scopeId: string; roundId: string | null }
export interface Consumption { id: string; allowanceId: string; roundId: string; eventId: string; effectId: string; aid: Aid; teamId: string }
export interface Attempt {
  id: string; roundId: string; itemId: string | null; phase: 'MAIN' | 'TRAP' | 'STEAL' | 'SHARED' | 'TURN'; phaseOrdinal: number; generation: number; teamId: string; playerId: string; ordinal: number;
  acceptedAt: number; deadline: number; eventId: string; pickedEventId: string | null; allowanceId: string | null; bonusEventId: string | null; bonusMultiplier: 1 | 2; disclosureHead: string | null;
  eligiblePlayerIds: string[]; eligibilityHash: string;
}
export interface Classification { id: string; attemptId: string; eventId: string; correct: boolean; interim: boolean }
export interface Disclosure { id: string; roundId: string; targetRevisionId: string; targetHash: string; playerId: string; assignmentId: string; assignmentGeneration: number; at: number; grantId: string; grantGeneration: number }
export interface Posting { id: string; effectId: string; teamId: string; delta: number; before: number; after: number; scoreVersion: number; previousHead: string | null }
export interface ScoreRead { teamId: string; scoreVersion: number; value: number; sourceEffectId: string | null; kind: 'BASE' | 'RANK' | 'CLAMP' | 'CAP' }
export interface ClockSnapshot { phase: Phase; phaseOrdinal: number; generation: number; currentTeamId: string | null; deadline: number | null; overallDeadline: number | null; pause: Pause | null }
export interface Effect {
  id: string; eventId: string; sequence: number; roundId: string | null; kind: 'AID' | 'RULING' | 'NO_SCORE' | 'INTERIM' | 'TIMING' | 'DISCLOSURE' | 'REVERSAL' | 'CORRECTION' | 'FINISH';
  aid: Aid | null; amountKind: 'FIXED' | 'DERIVED' | 'NONE'; reversible: boolean; barrier: boolean; reads: ScoreRead[]; dependencies: string[]; postingIds: string[];
  beforeClock: ClockSnapshot | null; afterClock: ClockSnapshot | null;
  originalAttemptIds: string[]; correctAttemptIds: string[]; bonusSnapshot: { attemptId: string; teamId: string; multiplier: 1 | 2; sourceEventId: string | null }[];
  predecessorId: string | null; predecessorHash: string | null; reason: string | null; hash: string;
}
export interface RulingHead { roundId: string; itemId: string | null; scopeId: string; originalEffectId: string; effectId: string; version: number; hash: string; reversed: boolean }
export interface VarReport { id: string; roundId: string; effectId: string | null; blockingIds: string[]; reason: string; eventId: string }
export interface ItemReview { id: string; roundId: string; itemId: string; originalEffectId: string; originalEffectHash: string; reversalEffectId: string; predecessorRulingVersion: number; predecessorRulingHash: string; originalAttemptIds: string[]; consumptionEffectId: string; eventId: string; hash: string }
export interface ItemReviewResolution { id: string; reviewId: string; reviewHash: string; effectId: string; eventId: string; rulingVersion: number; rulingHash: string; mode: 'RESTORE_ORIGINAL' | 'REPLACE'; reason: string }
export interface EngineBindingSnapshot { id: string; attemptId: string; admissionId: string; logicalMatchId: string; engine: 'ENTA'; participants: [string, string]; mapping: { participantId: string; tournamentTeamId: string }[]; hash: string }
export interface EngineResultPayload {
  schemaVersion: 1; rulesVersion: 'enta-competitive-1'; requestVersion: 5; executionFormat: CompetitionFormat; projectId: string; engine: 'ENTA'; gameId: string; admissionId: string; logicalMatchId: string;
  resultVersion: number; predecessor: { version: number; hash: string } | null; terminal: { eventId: string; revision: number }; authority: { eventId: string; kind: 'HOST' | 'SYSTEM'; correctionReason: string | null };
  participants: string[]; reason: 'ALL_ROUNDS' | 'HOST_ENDED'; prescribedCount: number; completedCount: number; unplayedCount: number;
  outcome: 'DECISIVE' | 'UNRESOLVED_TIE' | 'HOST_ENDED'; scores: { participantId: string; score: number }[]; winnerParticipantIds: string[]; tournamentBinding: EngineBindingSnapshot | null;
}
export interface EngineResult { payload: EngineResultPayload; hash: string }
export interface EngineResultSignal { gameId: string; resultVersion: number; resultHash: string; bindingId: string; attemptId: string }
export interface CompetitionGame {
  id: string; identityId: string; projectId: string; hostUid: string; admissionId: string; request: CompetitionRequest; requestHash: string; intent: CompetitionIntent; intentHash: string;
  version: number; finished: boolean; activeRoundId: string | null; turnIndex: number; resultReason: 'ALL_ROUNDS' | 'HOST_ENDED' | null; teams: CompetitionTeam[];
  categories: { key: string; label: string; format: PromptPin['format']; cover: MediaPin | null }[]; rounds: CompetitionRound[];
  allowances: Allowance[]; consumptions: Consumption[]; attempts: Attempt[]; classifications: Classification[]; disclosures: Disclosure[]; effects: Effect[]; postings: Posting[]; rulings: RulingHead[];
  events: RoundEvent[]; grants: Grant[]; grantScopes: GrantScope[]; canvases: Canvas[]; reports: VarReport[]; latestEffectId: string | null; correctionReview: string | null;
  openItemReview: string | null; itemReviews: ItemReview[]; itemResolutions: ItemReviewResolution[];
  tournamentBinding: EngineBindingSnapshot | null; results: EngineResult[]; resultSignals: EngineResultSignal[];
  capacityReservations: CapacityReservation[]; capacityDispositions: CapacityDisposition[];
  /** Internal SQL-only bounded evidence, never a caller-submitted authority. */
  factContext?: { version: 1; selectedRoundId: string | null; effectSequence: number; pendingTotal: number; rulingTotal: number; terminalValidated: boolean };
}
export type CompetitionCommand = { commandId: string; expectedVersion: number } & (
  | { type: 'OPEN_ROUND'; roundId: string } | { type: 'NEXT_ROUND' }
  | { type: 'USE_AID'; roundId: string; teamId: string; aid: Aid }
  | { type: 'RECORD_ATTEMPT'; roundId: string; teamId: string; playerId: string; itemId: string | null }
  | { type: 'INTERIM_WRONG'; roundId: string; attemptId: string }
  | { type: 'PUBLIC_REVEAL'; roundId: string; itemId: string | null }
  | { type: 'FINAL_RULING'; roundId: string; itemId: string | null; classifications: [attemptId: string, correct: boolean][] }
  | { type: 'REVEAL_HINT' | 'END_ASSISTANCE' | 'RESUME_ROUND' | 'CLOSE_ROUND'; roundId: string }
  | { type: 'PAUSE_ROUND'; roundId: string; reason: string }
  | { type: 'SELECT_SCORING_TEAM'; roundId: string; teamId: string }
  | { type: 'ASSIGN_ACTOR'; roundId: string; teamId: string; playerId: string; itemId: string | null }
  | { type: 'CREATE_GRANT'; roundId: string; role: 'JUDGE' | 'ACTOR'; durationSeconds: number }
  | { type: 'ROTATE_GRANT'; roundId: string; scopeId: string; expectedGeneration: number; durationSeconds: number }
  | { type: 'REVOKE_GRANT'; roundId: string; scopeId: string }
  | { type: 'UNDO_EFFECT'; effectId: string; effectHash: string }
  | { type: 'CORRECT_RULING'; effectId: string; rulingVersion: number; correctAttemptIds: string[]; reason: string }
  | { type: 'RESOLVE_ITEM_REVIEW'; reviewId: string; reviewHash: string; rulingVersion: number; mode: 'RESTORE_ORIGINAL' | 'REPLACE'; correctAttemptIds: string[]; reason: string }
  | { type: 'REPORT_VAR'; roundId: string; effectId: string | null; blockingIds: string[]; reason: string }
  | { type: 'FINISH'; confirmEarly: boolean } | { type: 'RESOLVE_TIE'; resultHash: string }
);
export interface CompetitionTransaction {
  nativeScope?(principal: Principal | null, hash: string | null, gameId: string): Promise<CompetitionNativeScope | null>;
  nativeDisclose?(hash: string, gameId: string): Promise<{ scope: CompetitionNativeScope; data: ReturnType<typeof projectCompetitionCapability> }>;
  nativeCanvasMutation?(hash: string, gameId: string, snapshot: number, command: CanvasCommand): Promise<{ idempotent: boolean; canvasReceipt: { gameId: string; roundId: string; commandId: string; hash: string; expectedRevision: number; revision: number; eventId: string } }>;
  nativeCanvasPage?(principal: Principal | null, hash: string | null, gameId: string, roundId: string, snapshot: number | null, revision: number | null, offset: number): Promise<{ restart: true } | { denied: true } | { total: number; rows: Canvas['strokes']; canvasRevision: number; scope: CompetitionNativeScope }>;
  nativeCatalog?(principal: Principal, format: CompetitionFormat, categoryKey: string | null, snapshot: string | null, offset: number): Promise<{ releaseId: string; snapshot: string; total: number; rows: unknown[] }>;
  nativeMediaManifest?(principal: Principal | null, hash: string | null, gameId: string, mediaId: string, gradingRoundId: string | null, snapshot: number): Promise<{ pin: MediaPin; restart?: false } | { restart: true }>;
  nativePage?(principal: Principal | null, hash: string | null, gameId: string, request: PageRequest, offset: number): Promise<{ total: number; rows: unknown[]; restart?: true }>;
  nativeGet?(principal: Principal, gameId: string): Promise<{ match: CompetitionNativeMatch }>;
  nativeStart?(principal: Principal, request: CompetitionRequest, seed: string): Promise<{ match: CompetitionNativeMatch; idempotent: boolean }>;
  nativeCommand?(principal: Principal, gameId: string, command: CompetitionCommand, entropy: { tokenHash: string } | null): Promise<{ match: CompetitionNativeMatch; idempotent: boolean; rejection: 'ROUND_TIME_EXPIRED' | 'RESOURCE_LIMIT_REACHED' | 'CORRECTION_DEPENDENCY_REVIEW_REQUIRED' | 'STALE_VERSION' | 'OPTIONAL_CAPACITY_EXHAUSTED' | 'ATTEMPT_BUDGET_EXCEEDED' | null; blockingIds?: string[]; blockingTotal?: number; commandReceipt: CompetitionCommandReceipt | null; commandRejection?: CompetitionCommandRejectionProof; issuance: Omit<Grant, 'assignmentId' | 'tokenHash'> | null; auditId?: string }>;
  lockWallet(principal: Principal): Promise<{ identityId: string; available: bigint; debt: bigint }>;
  findStart(principal: Principal, key: string, logicalId: string): Promise<CompetitionGame | null>;
  catalog(principal: Principal, format: CompetitionFormat): Promise<CompetitionCatalog>;
  exposures(principal: Principal, format: CompetitionFormat, categoryKey: string): Promise<Exposure[]>;
  create(principal: Principal, request: CompetitionRequest, intent: CompetitionIntent, pins: CompetitionPrompt[], catalog: CompetitionCatalog): Promise<CompetitionGame>;
  loadOwner(principal: Principal, id: string, lock: boolean): Promise<CompetitionGame | null>;
  locateGrant(hash: string): Promise<{ gameId: string } | null>; loadGrant(id: string, tokenHash: string): Promise<CompetitionGame | null>;
  save(before: CompetitionGame, next: CompetitionGame, command: CompetitionCommand | CanvasCommand | null): Promise<{ game: CompetitionGame; rejection: 'ROUND_TIME_EXPIRED' | 'RESOURCE_LIMIT_REACHED' | 'CORRECTION_DEPENDENCY_REVIEW_REQUIRED' | null; blockingIds?: string[] }>;
  disclose(game: CompetitionGame, tokenHash: string, now: number): Promise<CompetitionGame>; now(): Promise<number>;
  audit(principal: Principal, game: CompetitionGame, command: Extract<CompetitionCommand, { type: 'REPORT_VAR' }>): Promise<{ id: string; idempotent: boolean }>;
  hasAuditCommand(principal: Principal, gameId: string, commandId: string): Promise<boolean>;
}
export interface CompetitionRepository { source: 'postgres' | 'test-only' | 'local-development'; projectId: string; transaction<T>(work: (tx: CompetitionTransaction) => Promise<T>): Promise<T> }
