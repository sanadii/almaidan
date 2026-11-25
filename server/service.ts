import { CURRENT_CATEGORY_PROJECTION, canonicalCategoryId, canonicalizeCategoryIds, type CategoryProjectionVersion } from "../src/features/game/runtime/category-projection.js";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { lookupRoomCode } from "./room-code-lookup.js";
import { join, relative, resolve, sep, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import {
  generateBoard,
  generateCategoryBoard,
  revealSurprise,
  type GameBoard,
  type TeamAxis,
} from "../src/features/game/domain/board.js";
import {
  deriveMatch,
  initialGameState,
  reduceGame,
  type GameEvent,
  type GameState,
  type RuleSet,
} from "../src/features/game/domain/lifecycle.js";
import {
  addChallengeReplacementReserve,
  beginNextChallengeSelectionRound,
  createCategoryQuestionSelection,
  createChallengeCategoryQuestionSelection,
  createMatchQuestionSelection,
  promoteReservedChallengeQuestion,
  promoteReservedQuestion,
  reserveChallengeQuestionForCell,
  reserveQuestionForCell,
  selectChallengeCategoryQuestion,
  selectCategoryQuestion,
  selectMatchQuestion,
  type ChallengeCategoryQuestionSelection,
  type MatchQuestionSelection,
  type RuntimeQuestionV32,
} from "../src/features/game/runtime/challenge-question-selector.js";
import {
  CLIENT_CHALLENGE_CAPABILITY,
  type ChallengeCapabilityOffer,
  type ClientRole,
  type GameIntent,
  type ProjectionEnvelope,
  type SafeProjection,
} from "../src/features/game/runtime/contracts.js";
import {
  canonicalChallengeJson,
  compactChallengeState,
  participantRecipient,
  projectChallenge,
  restoreChallengeState,
  teamForChallengeRecipient,
  type ChallengeDefinitionReference,
  type PersistedChallengeState,
} from "../src/features/game/challenges/integration.js";
import { createChallengeState, reduceChallenge, reconcileChallengeDeadline, type ChallengeIntent, type ChallengeRuntimeConfig, type Participant } from "../src/features/game/challenges/engine.js";
import { applyChallengeAward, applyChallengeContinuation, createChallengeBridgeContext, type TrustedChallengeBridgeContext } from "../src/features/game/challenges/award-bridge.js";
import { ChallengeDefinitionRepository } from "./challenge-definition-repository.js";
import type { FamilySlot } from "../src/features/game/challenges/family-allocation.js";
import { materializeMapPresentation, type MapPresentation, type MapVariantBinding } from "../src/features/game/runtime/map-variant-resolver.js";
import type { LocalRuntimeQuestionSource } from "./local-firestore-question-source.js";
import { sourceCategoryRegistry } from "../scripts/source-category-crosswalk.js";
import { localMediaEntry, assertLocalRealContent } from './local-release-question-source.js';
import { isYouTubeMediaDescriptor, youtubeDescriptorBytes, type YouTubeMediaDescriptor } from '../src/features/game/runtime/youtube-media.js';
import { normalizePlayerDisplayName } from '../src/features/game/runtime/display-name.js';

type Member = {
  uid: string;
  role: ClientRole;
  displayName: string;
  team?: TeamAxis;
  ready: boolean;
  joinGeneration?: string;
  carried?: true;
};
type ManualParticipant = { id: string; displayName: string; team: TeamAxis };
type QuestionMedia = { mediaId: string; assetSha256: string; altAr: string; type?: "image" | "video"; contentType?: string; youtube?: YouTubeMediaDescriptor };
const hasRevealedOccurrence = (
  activeOccurrence: unknown,
  revealedOccurrence: unknown,
) =>
  typeof activeOccurrence === "string" &&
  activeOccurrence.length > 0 &&
  activeOccurrence === revealedOccurrence;
type StoredQuestion = RuntimeQuestionV32 & {
  targetLetter?: string;
  sources?: unknown[];
  status: string;
  difficulty?: string;
  useCount?: number;
  objectionCount?: number;
  reviewError?: string;
  readOnly?: boolean;
  sourceUrl?: string;
  media?: QuestionMedia;
  answerMedia?: QuestionMedia;
  challenge?: { definition: ChallengeDefinitionReference; factFamilies: string[]; kind: "navigation" | "missing_tile" | "memory" | "qatar_map" | "word_search" };
  selectionFacts?: { kind: "qatar_map"; factFamilies: readonly string[] };
};
export type MatchConfig = {
  policyVersion?: 1;
  categoryProjectionVersion?: CategoryProjectionVersion;
  questionSeconds: number;
  opponentSeconds: number;
  teams: Record<TeamAxis, string>;
  categories: string[];
  modality: "classic" | "image" | "charades";
  gameKind?: "huroof" | "categories";
  categorySnapshot?: Array<{ id: string; labelAr: string }>;
  difficulty: string;
  mode: "classic" | "fast" | "custom";
  showQuestionOnAudience?: boolean;
  labelledColours?: boolean;
  /** Legacy rooms default to ordinary predecessor presentation. */
  mapPresentation?: MapPresentation;
  challenge?: ChallengeCapabilityOffer;
};
type CreateMatchConfig = Omit<Partial<MatchConfig>,'teams'> & { teams?: Partial<Record<TeamAxis,string>>; bestOf?: 1 | 3 | 5 | 7 };
type Room = {
  id: string;
  code: string;
  revision: number;
  demo: boolean;
  questionSourceSnapshot?: string;
  localRematch?: {predecessorRoomId:string;sourceSnapshot:string;excludedQuestionIds:string[];excludedAnswerConceptIds:string[];excludedFactFamilies:string[]};
  successor?: NonNullable<SafeProjection['room']['successor']>;
  roomSchemaVersion: 1 | 2;
  ruleSet: RuleSet;
  config: MatchConfig;
  game: GameState;
  members: Member[];
  manualParticipants?: ManualParticipant[];
  /** Legacy snapshots may contain inline receipts; new writes use SQLite intent_receipts. */
  intentIds?: Record<string, number>;
  intentHashes?: Record<string, string>;
  boardNonce: string;
  boardSequence: number;
  categoryOccurrences?: Record<string, number>;
  activeQuestion?: StoredQuestion;
  activeQuestionOccurrence?: string;
  answerRevealedOccurrence?: string;
  surpriseLetters: string[];
  questionSelection?: MatchQuestionSelection | ChallengeCategoryQuestionSelection;
  deadlineAt?: string;
  buzzOpen?: boolean;
  pausedTimer?: { remainingMs: number; buzzOpen?: boolean };
  answerFeedback?: SafeProjection['answerFeedback'];
  questionFailedReason?: SafeProjection['questionFailedReason'];
  /** Persisted compact state; private grading stays in the injected repository. */
  challenge?: PersistedChallengeState;
  challengeBridge?: TrustedChallengeBridgeContext;
  buzzWinner?: {
    uid?: string;
    displayName: string;
    team: TeamAxis;
    method: "player" | "host";
  };
  audit: Array<{
    revision: number;
    type: string;
    at: string;
    actor: string;
    payload: unknown;
  }>;
};
type Capability = { roomId: string; uid: string; role: ClientRole; joinGeneration?: string };
type JoinReceipt = { keyHash: string; name: string; memberUid: string; generation: string };
const JOIN_CONNECTION_GRACE_MS = 15_000;
const publicSeatId = (roomId: string, uid: string) => createHash('sha256').update(`${roomId}\0${uid}`).digest('base64url');
const matchesPlayerName = (name: string) => {
  const key = name.toLocaleLowerCase('ar');
  return (candidate: { displayName: string }) => candidate.displayName.normalize('NFC').toLocaleLowerCase('ar') === key;
};
export type Clock = () => Date;
export const verifyPrivateQuestionMediaBytes = (
  bytes: Buffer,
  assetSha256: string,
  width?: unknown,
  height?: unknown,
) => {
  if (
    !Buffer.isBuffer(bytes) ||
    !/^[a-f0-9]{64}$/.test(assetSha256) ||
    createHash("sha256").update(bytes).digest("hex") !== assetSha256
  )
    throw new Error("MEDIA_ASSET_HASH_MISMATCH");
  if (
    bytes.length < 24 ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    throw new Error("MEDIA_ASSET_INVALID_PNG");
  const actualWidth = bytes.readUInt32BE(16),
    actualHeight = bytes.readUInt32BE(20);
  if (
    !actualWidth ||
    !actualHeight ||
    actualWidth > 4096 ||
    actualHeight > 4096 ||
    (typeof width === "number" && width !== actualWidth) ||
    (typeof height === "number" && height !== actualHeight)
  )
    throw new Error("MEDIA_ASSET_INVALID_BOUNDS");
};
const canManageTeamsInState = (lifecycle: GameState["lifecycle"]) =>
  [
    "LOBBY",
    "ROUND_SETUP",
    "CELL_SELECTION",
    "QUESTION_FAILED",
    "ROUND_COMPLETE",
  ].includes(lifecycle);
const scores = (value?: unknown): Record<TeamAxis, number> => {
  const record = value as Partial<Record<TeamAxis, unknown>> | undefined;
  return {
    horizontal: typeof record?.horizontal === "number" ? record.horizontal : 0,
    vertical: typeof record?.vertical === "number" ? record.vertical : 0,
  };
};
const canonicalIntentHash = (intent: GameIntent) =>
  createHash("sha256").update(intent.type.startsWith("CHALLENGE_") ? canonicalChallengeJson({
    type: intent.type,
    expectedRevision: intent.expectedRevision,
    payload: intent.payload,
  }) : JSON.stringify({
    type: intent.type,
    expectedRevision: intent.expectedRevision,
    payload: Object.fromEntries(
      Object.entries(intent.payload).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  })).digest("hex");
const legacyCanonicalIntentJson = (intent: GameIntent) =>
  JSON.stringify({
    type: intent.type,
    expectedRevision: intent.expectedRevision,
    payload: Object.fromEntries(
      Object.entries(intent.payload).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  });
const trustedCategorySnapshot = (
  ids: string[],
  importedCategories: ReadonlyArray<{ id: string; labelAr: string }> = [],
  version?: CategoryProjectionVersion,
) => {
  const source = JSON.parse(
    readFileSync(
      join(process.cwd(), "content", "categories", "categories.json"),
      "utf8",
    ),
  ) as { categories?: Array<{ id?: unknown; displayNameAr?: unknown }> };
  const labels = new Map(
    (source.categories ?? []).flatMap((category) =>
      typeof category.id === "string" &&
      typeof category.displayNameAr === "string" &&
      category.displayNameAr.trim()
        ? [[category.id, category.displayNameAr.trim()] as const]
        : [],
    ),
  );
  for (const category of sourceCategoryRegistry.categories)
    labels.set(category.sourceCategoryId, category.sourceTitleAr);
  // Local import inventory is validated while reading the pinned source.  It is
  // the authority for imported category names; a browser never supplies labels.
  for (const category of importedCategories)
    if (typeof category.id === "string" && typeof category.labelAr === "string" && category.labelAr.trim())
      labels.set(category.id, category.labelAr.trim());
  if (version) {
    labels.set("tahadani-047", "عملات");
    labels.set("tahadani-019", "كرتون / ولا كلمة");
  }
  const snapshot = ids
    .map((id) => ({ id, labelAr: labels.get(id) }))
    .filter((item): item is { id: string; labelAr: string } =>
      Boolean(item.labelAr),
    );
  if (snapshot.length !== ids.length)
    throw new Error("CATEGORY_SNAPSHOT_INVALID");
  return snapshot;
};

function validChallengeIntentPayload(type: string, payload: Record<string, unknown>): boolean {
  const keys = Object.keys(payload);
  const revision = payload.challengeRevision;
  if (!keys.every((key) => ["occurrence", "challengeRevision", "stage", "assignment", "participantId", "readiness", "direction", "answers", "start", "end"].includes(key)) || typeof payload.occurrence !== "string" || !/^[A-Za-z0-9:_-]{1,180}$/.test(payload.occurrence) || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 || !["setup", "countdown", "observation", "answer", "steal_offer", "steal", "result", "void"].includes(payload.stage as string)) return false;
  if (type === "CHALLENGE_ASSIGN") return keys.length === 5 && ["guide", "mover", "captain", "stealCaptain"].includes(payload.assignment as string) && typeof payload.participantId === "string" && /^(member|manual):[A-Za-z0-9_-]{1,120}$/.test(payload.participantId);
  if (type === "CHALLENGE_READY") { const readiness = payload.readiness; return keys.length === 5 && typeof payload.participantId === "string" && /^(member|manual):[A-Za-z0-9_-]{1,120}$/.test(payload.participantId) && readiness !== null && typeof readiness === "object" && !Array.isArray(readiness) && Object.keys(readiness).sort().join("|") === "assignmentHash|protocolHash|stimulusHash" && Object.values(readiness).every((value) => typeof value === "string" && value.length > 0 && value.length <= 256); }
  if (type === "CHALLENGE_MOVE") return keys.length === 4 && ["north", "east", "south", "west"].includes(payload.direction as string);
  if (type === "CHALLENGE_SUBMIT") {
    const endpoint = (value: unknown) => Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("|") === "column|row" && Number.isInteger((value as { row?: unknown }).row) && Number.isInteger((value as { column?: unknown }).column) && (value as { row: number }).row >= 0 && (value as { row: number }).row < 9 && (value as { column: number }).column >= 0 && (value as { column: number }).column < 9);
    return (keys.length === 4 && Array.isArray(payload.answers) && payload.answers.length > 0 && payload.answers.length <= 3 && payload.answers.every((value) => typeof value === "string" && value.length <= 64)) || (keys.length === 5 && endpoint(payload.start) && endpoint(payload.end));
  }
  return keys.length === 3;
}
function validIntent(intent: unknown): intent is GameIntent {
  if (!intent || typeof intent !== "object") return false;
  const value = intent as GameIntent;
  if (
    !Object.keys(value).every((key) =>
      ["type", "intentId", "expectedRevision", "payload"].includes(key),
    ) ||
    typeof value.type !== "string" ||
    typeof value.intentId !== "string" ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(value.intentId) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0 ||
    !value.payload ||
    typeof value.payload !== "object" ||
    Array.isArray(value.payload)
  )
    return false;
  const keys = Object.keys(value.payload);
  if (value.type.startsWith("CHALLENGE_")) return validChallengeIntentPayload(value.type, value.payload);
  if (value.type === "LOBBY_SET_READY")
    return keys.length === 1 && typeof value.payload.ready === "boolean";
  if (value.type === "START_MATCH")
    return keys.length === 0 || (keys.length === 1 && value.payload.withoutWaiting === true);
  if (value.type === "LOBBY_ASSIGN_TEAM") {
    const hasMember =
      typeof value.payload.memberUid === "string" &&
      value.payload.memberUid.length > 0 &&
      value.payload.memberUid.length <= 128;
    const hasManual =
      typeof value.payload.manualParticipantId === "string" &&
      value.payload.manualParticipantId.length > 0 &&
      value.payload.manualParticipantId.length <= 128;
    return (
      keys.length === 2 &&
      hasMember !== hasManual &&
      (value.payload.team === "horizontal" || value.payload.team === "vertical")
    );
  }
  if (value.type === "LOBBY_REMOVE_PARTICIPANT") {
    const member = typeof value.payload.memberUid === "string" && value.payload.memberUid.length > 0 && value.payload.memberUid.length <= 128;
    const manual = typeof value.payload.manualParticipantId === "string" && value.payload.manualParticipantId.length > 0 && value.payload.manualParticipantId.length <= 128;
    return keys.length === 1 && member !== manual;
  }
  if (value.type === "LOBBY_ADD_MANUAL_PLAYER")
    return (
      keys.length === 2 &&
      typeof value.payload.displayName === "string" &&
      (value.payload.team === "horizontal" || value.payload.team === "vertical")
    );
  if (value.type === "SELECT_CELL")
    return (
      keys.length === 1 &&
      typeof value.payload.cellId === "string" &&
      /^cell-[0-4]-[0-4]$/.test(value.payload.cellId)
    );
  if (value.type === "HOST_SELECT_TEAM")
    return (
      keys.length === 1 &&
      (value.payload.team === "horizontal" || value.payload.team === "vertical")
    );
  if (value.type === "SET_AUDIENCE_QUESTION_VISIBILITY")
    return keys.length === 1 && typeof value.payload.showQuestion === "boolean";
  if (value.type === "BEGIN_CORRECTION")
    return (
      keys.every((key) => ["cellId", "owner", "reason"].includes(key)) &&
      typeof value.payload.cellId === "string" &&
      /^cell-[0-4]-[0-4]$/.test(value.payload.cellId) &&
      (value.payload.owner === undefined ||
        value.payload.owner === "horizontal" ||
        value.payload.owner === "vertical") &&
      typeof value.payload.reason === "string" &&
      value.payload.reason.trim().length > 0 &&
      value.payload.reason.length <= 240
    );
  if (value.type === "REVEAL_ANSWER")
    return keys.length === 1 && typeof value.payload.occurrence === "string" && /^[A-Za-z0-9:_-]{1,180}$/.test(value.payload.occurrence);
  return (
    [
      "ROUND_READY",
      "LETTER_REVEALED",
      "OPEN_QUESTION",
      "BUZZ",
      "JUDGE_CORRECT",
      "JUDGE_INCORRECT",
      "RETRY_CELL",
      "RETURN_CELL",
      "END_WITHOUT_WINNER",
      "AWARD_CELL",
      "CHECK_PATH",
      "START_NEXT_ROUND",
      "PAUSE",
      "RESUME",
      "CONFIRM_CORRECTION",
      "CANCEL_CORRECTION",
      "CLOSE_QUESTION",
    ].includes(value.type) && keys.length === 0
  );
}

/** Produces a browser-safe deterministic board seed from persisted room entropy. */
export function deriveBoardSeed(
  boardNonce: string,
  boardSequence: number,
): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < boardNonce.length; index++)
    hash = Math.imul(hash ^ boardNonce.charCodeAt(index), 0x01000193);
  return (hash ^ Math.imul(boardSequence + 1, 0x9e3779b1)) >>> 0;
}

function boardDefaults<
  T extends { boardNonce?: unknown; boardSequence?: unknown },
>(room: T): T & Pick<Room, "boardNonce" | "boardSequence"> {
  return {
    ...room,
    boardNonce:
      typeof room.boardNonce === "string" && room.boardNonce
        ? room.boardNonce
        : randomUUID(),
    boardSequence:
      Number.isSafeInteger(room.boardSequence) &&
      Number(room.boardSequence) >= 0
        ? Number(room.boardSequence)
        : 0,
  };
}

/** Bounded JSON upcast: untouched lobbies become v2; started legacy rooms retain legacy authority without invented round order. */
function upcastRoom(value: unknown): Room {
  const room = boardDefaults(
    value as Room & {
      roomSchemaVersion?: number;
      ruleSet?: RuleSet;
      config?: MatchConfig & { bestOf?: 1 | 3 | 5 | 7 };
      game?: GameState & {
        points?: Record<TeamAxis, number>;
        roundWins?: Record<TeamAxis, number>;
      };
    },
  );
  if (room.roomSchemaVersion === 2 && room.ruleSet === "v2") {
    if (room.config?.policyVersion === undefined) {
      if (room.config?.gameKind && room.config.gameKind !== "huroof")
        throw new Error("ROOM_POLICY_UNKNOWN");
      return {
        ...room,
        config: { ...room.config, policyVersion: 1, gameKind: "huroof" },
      };
    }
    if (
      room.config.policyVersion !== 1 ||
      (room.config.gameKind !== "huroof" &&
        room.config.gameKind !== "categories")
    )
      throw new Error("ROOM_POLICY_UNKNOWN");
    return room;
  }
  const legacyBestOf =
    room.config?.bestOf && [1, 3, 5, 7].includes(room.config.bestOf)
      ? room.config.bestOf
      : 3;
  const config: MatchConfig = {
    policyVersion: 1,
    questionSeconds: room.config?.questionSeconds ?? 20,
    opponentSeconds: room.config?.opponentSeconds ?? 10,
    teams: room.config?.teams ?? { horizontal: "فريق ↔", vertical: "فريق ↕" },
    categories: room.config?.categories ?? [],
    modality:
      room.config?.modality === "image" || room.config?.modality === "charades"
        ? room.config.modality
        : "classic",
    gameKind: "huroof",
    difficulty: room.config?.difficulty ?? "mixed",
    mode: room.config?.mode ?? "classic",
    showQuestionOnAudience: room.config?.showQuestionOnAudience !== false,
  };
  if (!room.game || room.game.lifecycle === "LOBBY")
    return {
      ...room,
      roomSchemaVersion: 2,
      ruleSet: "v2",
      config,
      game: initialGameState(),
    };
  const game = room.game;
  return {
    ...room,
    roomSchemaVersion: 1,
    ruleSet: "legacy-v1",
    config,
    game: {
      ...game,
      ruleSet: "legacy-v1",
      questionScores: game.questionScores ?? scores(game.points),
      currentRound: game.currentRound ?? 0,
      roundOutcomeHistory: game.roundOutcomeHistory ?? [],
      legacyRoundWins: game.legacyRoundWins ?? scores(game.roundWins),
      legacyBestOf,
    },
  };
}

export class LocalRoomPreparationError extends Error { constructor(public reason:string){super('LOCAL_CREATE_SETUP_UNAVAILABLE');} }
export class RoomStore {
  private readonly db: DatabaseSync;
  /** The development database lives outside the worktree unless GAME_DB_PATH explicitly opts in. */
  constructor(path = join(tmpdir(), "huroof-wa-oloof-local-game.sqlite")) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (room_id TEXT NOT NULL, revision INTEGER NOT NULL, event TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(room_id, revision)); CREATE TABLE IF NOT EXISTS snapshots (room_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(room_id, revision)); CREATE TABLE IF NOT EXISTS intent_receipts (room_id TEXT NOT NULL, actor_uid TEXT NOT NULL, intent_id TEXT NOT NULL, request_hash TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(room_id, actor_uid, intent_id)); CREATE TABLE IF NOT EXISTS local_admin_drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);",
    );
    this.initializeRoomLookup();
  }
  private initializeRoomLookup(): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const columns = new Set(this.db.prepare('PRAGMA table_info(rooms)').all().map(column => column.name));
      if (!columns.has('deadline_at')) {
        this.db.exec("ALTER TABLE rooms ADD COLUMN deadline_at TEXT; UPDATE rooms SET deadline_at=json_extract(data,'$.deadlineAt') WHERE json_valid(data)");
      }
      if (!columns.has('has_challenge')) {
        this.db.exec("ALTER TABLE rooms ADD COLUMN has_challenge INTEGER NOT NULL DEFAULT 0; UPDATE rooms SET has_challenge=1 WHERE json_valid(data) AND json_extract(data,'$.challenge') IS NOT NULL");
      }
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS rooms_deadline_lookup ON rooms(deadline_at, id) WHERE deadline_at IS NOT NULL;
        CREATE INDEX IF NOT EXISTS rooms_challenge_lookup ON rooms(has_challenge, id) WHERE has_challenge = 1;
        CREATE TABLE IF NOT EXISTS join_receipts (room_id TEXT NOT NULL, key_hash TEXT NOT NULL, name TEXT NOT NULL, member_uid TEXT NOT NULL, generation TEXT NOT NULL, PRIMARY KEY(room_id, key_hash));
      `);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  save(room: Room): void {
    this.persist(room);
  }
  event(room: Room, value: unknown, at: string): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO events(room_id, revision, event, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(room.id, room.revision, JSON.stringify(value), at);
  }
  receipt(roomId: string, actorUid: string, intentId: string): { requestHash: string; revision: number } | undefined {
    const row = this.db.prepare("SELECT request_hash, revision FROM intent_receipts WHERE room_id=? AND actor_uid=? AND intent_id=?").get(roomId, actorUid, intentId) as { request_hash?: unknown; revision?: unknown } | undefined;
    return row && typeof row.request_hash === "string" && Number.isSafeInteger(row.revision) ? { requestHash: row.request_hash, revision: row.revision as number } : undefined;
  }
  recordReceipt(roomId: string, actorUid: string, intentId: string, requestHash: string, revision: number, at: string): void {
    this.db.prepare("INSERT INTO intent_receipts(room_id, actor_uid, intent_id, request_hash, revision, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(roomId, actorUid, intentId, requestHash, revision, at);
  }
  /** A room revision, snapshot, audit event, and accepted receipt are one durable unit. */
  commit(room: Room, event: unknown, at: string, receipt?: { actorUid: string; intentId: string; requestHash: string }, joinReceipt?: JoinReceipt): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.persist(room);
      this.event(room, event, at);
      if (receipt) this.recordReceipt(room.id, receipt.actorUid, receipt.intentId, receipt.requestHash, room.revision, at);
      if (joinReceipt) this.db.prepare('INSERT INTO join_receipts (room_id, key_hash, name, member_uid, generation) VALUES (?, ?, ?, ?, ?)')
        .run(room.id, joinReceipt.keyHash, joinReceipt.name, joinReceipt.memberUid, joinReceipt.generation);
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* transaction was never opened or already failed */ }
      throw error;
    }
  }
  joinReceipt(roomId: string, keyHash: string): JoinReceipt | undefined {
    return this.db.prepare('SELECT key_hash AS keyHash, name, member_uid AS memberUid, generation FROM join_receipts WHERE room_id=? AND key_hash=?')
      .get(roomId, keyHash) as JoinReceipt | undefined;
  }
  createLocalOwned(ownerUid:string,requestKey:string,requestHash:string,prepare:()=>Room,predecessorRoomId?:string):{room:Room;idempotent:boolean}{
    assertLocalRealContent();
    this.db.exec('CREATE TABLE IF NOT EXISTS local_owned_room_creations (owner_uid TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL, room_id TEXT NOT NULL, PRIMARY KEY(owner_uid,request_key))');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const predecessor=predecessorRoomId?this.load(predecessorRoomId):undefined;
      const predecessorOwner=predecessorRoomId?this.localRoomOwner(predecessorRoomId):undefined;
      if (predecessorOwner && predecessorOwner !== ownerUid) throw Error('LOCAL_REMATCH_HOST_REQUIRED');
      const receipt=this.db.prepare('SELECT request_hash,room_id FROM local_owned_room_creations WHERE owner_uid=? AND request_key=?').get(ownerUid,requestKey) as {request_hash:string;room_id:string}|undefined;
      if(receipt){if(receipt.request_hash!==requestHash)throw Error('LOCAL_CREATE_KEY_CONFLICT');const room=this.load(receipt.room_id);if(!room)throw Error('LOCAL_CREATE_RECEIPT_UNAVAILABLE');this.db.exec('COMMIT');return {room,idempotent:true};}
      if (predecessor?.successor) throw Error('LOCAL_REMATCH_ALREADY_STARTED');
      let room:Room;try{room=prepare();}catch(error){throw new LocalRoomPreparationError(error instanceof Error&&/^[A-Z0-9_]{1,100}$/.test(error.message)?error.message:'LOCAL_CREATE_SETUP_UNAVAILABLE');}this.persist(room);this.event(room,room.audit[0]!,room.audit[0]!.at);
      if (predecessor) {
        predecessor.successor = { roomId: room.id, roomCode: room.code };
        predecessor.revision++;
        const event = { revision: predecessor.revision, type: 'REMATCH_STARTED', at: room.audit[0]!.at, actor: ownerUid, payload: {} };
        predecessor.audit = [...predecessor.audit.slice(-99), event];
        this.persist(predecessor);
        this.event(predecessor, event, event.at);
        if (!predecessorOwner)
          this.db.prepare('INSERT INTO local_owned_room_creations(owner_uid,request_key,request_hash,room_id) VALUES (?,?,?,?)')
            .run(ownerUid, `/legacy-rematch:${predecessor.id}`, requestHash, predecessor.id);
      }
      this.db.prepare('INSERT INTO local_owned_room_creations(owner_uid,request_key,request_hash,room_id) VALUES (?,?,?,?)').run(ownerUid,requestKey,requestHash,room.id);
      this.db.exec('COMMIT');return {room,idempotent:false};
    }catch(error){try{this.db.exec('ROLLBACK');}catch{ /* Preserve the original transaction failure. */ }throw error;}
  }
  localRoomOwner(roomId:string):string|undefined{
    assertLocalRealContent();if(!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='local_owned_room_creations'").get())return undefined;
    return (this.db.prepare('SELECT owner_uid FROM local_owned_room_creations WHERE room_id=?').get(roomId) as {owner_uid:string}|undefined)?.owner_uid;
  }
  localOwnedRoom(ownerUid:string,roomId:string):Room|undefined{
    assertLocalRealContent();
    if(!ownerUid)return undefined;
    if(!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='local_owned_room_creations'").get())return undefined;
    const row=this.db.prepare('SELECT r.data FROM local_owned_room_creations o JOIN rooms r ON r.id=o.room_id WHERE o.owner_uid=? AND (o.room_id=? OR r.code=?)').get(ownerUid,roomId.toLowerCase(),roomId.toUpperCase()) as {data:string}|undefined;
    return row?upcastRoom(JSON.parse(row.data)):undefined;
  }
  localOwnedHistory(ownerUid:string,offset=0){
    assertLocalRealContent();
    if(!ownerUid||!Number.isSafeInteger(offset)||offset<0||offset>100000)throw Error('LOCAL_HISTORY_REQUEST_INVALID');
    // A read never creates/migrates storage or claims legacy unowned rooms.
    if(!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='local_owned_room_creations'").get())return {items:[],nextOffset:null};
    const rows=this.db.prepare('SELECT r.data FROM local_owned_room_creations o JOIN rooms r ON r.id=o.room_id WHERE o.owner_uid=? ORDER BY r.rowid DESC LIMIT 101 OFFSET ?').all(ownerUid,offset) as Array<{data:string}>;
    const items=rows.slice(0,100).map(({data})=>{
      // Deliberately avoid hydrate(), which may write schema markers during reads.
      const room=upcastRoom(JSON.parse(data)),match=deriveMatch(room.game),config=room.config;
      return {id:room.id,code:room.code,revision:room.revision,createdAt:room.audit[0]?.at??null,updatedAt:room.audit.at(-1)?.at??null,
        phase:room.game.lifecycle,complete:room.game.lifecycle==='MATCH_COMPLETE',teams:{horizontal:config.teams.horizontal,vertical:config.teams.vertical},
        settings:{gameKind:config.gameKind??'huroof',modality:config.modality,mode:config.mode,difficulty:config.difficulty,mapPresentation:config.mapPresentation??'ordinary',questionSeconds:config.questionSeconds,opponentSeconds:config.opponentSeconds},
        categories:config.categories.map(id=>({id,labelAr:config.categorySnapshot?.find(c=>c.id===id)?.labelAr??id})),
        scores:{horizontal:room.game.questionScores.horizontal,vertical:room.game.questionScores.vertical},roundWins:match.roundWins,currentRound:room.game.currentRound,
        winner:match.matchWinner??null,completionReason:room.game.endedWithoutWinner?'CONTENT_EXHAUSTED':match.matchWinReason??null,
        source:{snapshot:room.questionSourceSnapshot??null},predecessor:room.localRematch?{predecessorRoomId:room.localRematch.predecessorRoomId,sourceSnapshot:room.localRematch.sourceSnapshot}:null};
    });
    return {items,nextOffset:rows.length>100?offset+100:null};
  }
  private persist(room: Room): void {
    // Keep legacy receipt JSON until a matching request has safely replayed it.
    const data = JSON.stringify(room);
    this.db.prepare("INSERT INTO rooms(id, code, revision, data, deadline_at, has_challenge) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data,deadline_at=excluded.deadline_at,has_challenge=excluded.has_challenge")
      .run(room.id, room.code, room.revision, data, room.deadlineAt ?? null, room.challenge ? 1 : 0);
    this.db.prepare("INSERT OR REPLACE INTO snapshots(room_id, revision, data) VALUES (?, ?, ?)").run(room.id, room.revision, data);
  }
  private hydrate(data: string): Room {
    const room = upcastRoom(JSON.parse(data));
    const upgraded = JSON.stringify(room);
    // Persist the bounded schema marker without inventing an event, revision, or legacy round order.
    if (upgraded !== data)
      this.db
        .prepare("UPDATE rooms SET data=? WHERE id=?")
        .run(upgraded, room.id);
    return room;
  }
  lookupRoomCode(code: string) {
    return lookupRoomCode(this.db, code);
  }
  load(idOrCode: string): Room | undefined {
    const row = this.db
      .prepare("SELECT data FROM rooms WHERE id=? OR code=?")
      .get(idOrCode, idOrCode) as { data: string } | undefined;
    return row ? this.hydrate(row.data) : undefined;
  }
  /**
   * Rooms the server clock may need to advance: an open buzzer deadline or an active challenge.
   * Filtering in SQLite keeps the 250ms tick from re-parsing every room ever created.
   */
  tickCandidateIds(now = new Date().toISOString()): string[] {
    return (
      this.db.prepare('SELECT id FROM rooms WHERE deadline_at <= ? UNION SELECT id FROM rooms WHERE has_challenge = 1').all(now) as Array<{ id: string }>
    ).map((row) => row.id);
  }
  rooms(): Room[] {
    return (
      this.db.prepare("SELECT data FROM rooms").all() as Array<{ data: string }>
    ).map((row) => this.hydrate(row.data));
  }
  saveAdminDraft(id: string, draft: unknown, at: string): void {
    this.db
      .prepare(
        "INSERT INTO local_admin_drafts(id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
      )
      .run(id, JSON.stringify(draft), at);
  }
  adminDrafts(): StoredQuestion[] {
    return (
      this.db
        .prepare("SELECT data FROM local_admin_drafts ORDER BY updated_at DESC")
        .all() as Array<{ data: string }>
    ).map((row) => JSON.parse(row.data) as StoredQuestion);
  }
  close(): void {
    this.db.close();
  }
}

export class AuthoritativeGameService {
  readonly store: RoomStore;
  private readonly secret: string;
  private readonly clock: Clock;
  private readonly newBoardNonce: () => string;
  private localFirestoreQuestionSource?: LocalRuntimeQuestionSource;
  private localQuestionInventory?: ReturnType<AuthoritativeGameService["projectQuestionInventory"]>;
  private readonly localQuestionSourcesBySnapshot = new Map<
    string,
    LocalRuntimeQuestionSource
  >();
  private readonly roomSerial = new Map<string, Promise<void>>();
  private readonly mediaIssues = new Map<string, number[]>();
  private readonly challengeDefinitions: ChallengeDefinitionRepository;
  private readonly enabledChallengeMechanics: ReadonlySet<NonNullable<ChallengeCapabilityOffer>["mechanics"][number]>;
  private readonly mapVariants: readonly MapVariantBinding[];
  constructor(
    options: {
      dbPath?: string;
      secret?: string;
      clock?: Clock;
      boardNonce?: () => string;
      localFirestoreQuestionSource?: LocalRuntimeQuestionSource;
      /** Explicit server/test-only private definitions. Absence keeps mechanics disabled. */
      challengeDefinitions?: ConstructorParameters<typeof ChallengeDefinitionRepository>[0];
      /** Explicit server-only local feature flags; default disabled. */
      enabledChallengeMechanics?: readonly NonNullable<ChallengeCapabilityOffer>["mechanics"][number][];
      /** Immutable release sidecars supplied by the local authority test fixture. */
      mapVariants?: readonly MapVariantBinding[];
    } = {},
  ) {
    this.store = new RoomStore(options.dbPath);
    this.secret = options.secret ?? "local-development-secret";
    this.clock = options.clock ?? (() => new Date());
    this.newBoardNonce = options.boardNonce ?? randomUUID;
    this.challengeDefinitions = new ChallengeDefinitionRepository(options.challengeDefinitions ?? []);
    this.enabledChallengeMechanics = new Set(options.enabledChallengeMechanics ?? []);
    this.mapVariants = options.mapVariants ?? [];
    if (options.localFirestoreQuestionSource)
      this.replaceLocalQuestionSource(options.localFirestoreQuestionSource);
  }
  close(): void {
    this.store.close();
  }
  /**
   * Updates the source used by future local rooms while retaining the immutable
   * source bindings of rooms that are already active.
   */
  replaceLocalQuestionSource(source: LocalRuntimeQuestionSource): void {
    if (source === this.localFirestoreQuestionSource) return;
    this.challengeDefinitions.add(source.challengeDefinitions ?? []);
    this.localQuestionSourcesBySnapshot.set(source.snapshotId, source);
    this.localFirestoreQuestionSource = source;
    this.localQuestionInventory = undefined;
  }
  private now(): string {
    return this.clock().toISOString();
  }
  private token(capability: Capability): string {
    const encoded = Buffer.from(JSON.stringify(capability)).toString(
      "base64url",
    );
    return `${encoded}.${createHmac("sha256", this.secret).update(encoded).digest("base64url")}`;
  }
  verify(token: string): Capability | undefined {
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) return undefined;
    const expected = createHmac("sha256", this.secret)
      .update(encoded)
      .digest("base64url");
    // Compare byte lengths: a same-length string with multi-byte characters would otherwise make
    // timingSafeEqual throw (ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH) instead of rejecting the token.
    const expectedBytes = Buffer.from(expected), signatureBytes = Buffer.from(signature);
    if (
      expectedBytes.length !== signatureBytes.length ||
      !timingSafeEqual(expectedBytes, signatureBytes)
    )
      return undefined;
    try {
      return JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as Capability;
    } catch {
      return undefined;
    }
  }
  createAudienceCapability(roomId: string, challenge?: unknown): string {
    const room = this.mustRoom(roomId);
    if (room.config.challenge && !this.sameChallengeCapability(challenge, room.config.challenge))
      throw new Error("CHALLENGE_PROTOCOL_REQUIRED");
    return this.token({ roomId, uid: "audience", role: "audience" });
  }
  localOwnerAccess(ownerUid:string,roomId:string){
    assertLocalRealContent();const room=this.store.localOwnedRoom(ownerUid,roomId);
    if(!room)throw Error('LOCAL_OWNED_ROOM_NOT_FOUND');
    return this.creationResponse(room);
  }
  private creationResponse(room:Room){const host=room.members.find(m=>m.role==='host');if(!host)throw Error('LOCAL_CREATE_RECEIPT_UNAVAILABLE');return {roomId:room.id,roomCode:room.code,revision:room.revision,token:this.token({roomId:room.id,uid:host.uid,role:'host'}),audienceToken:this.token({roomId:room.id,uid:'audience',role:'audience'})};}
  create(displayName='المضيف',demo=false,requested:CreateMatchConfig={}){
    const room=this.prepareRoom(displayName,demo,requested);this.store.commit(room,room.audit[0]!,room.audit[0]!.at);return this.creationResponse(room);
  }
  createLocalOwned(ownerUid:string,requestKey:string,requestHash:string,displayName:string,requested:CreateMatchConfig){
    assertLocalRealContent();if(!ownerUid||!requestKey||!/^[A-Za-z0-9._:-]{8,128}$/.test(requestKey)||!/^[a-f0-9]{64}$/.test(requestHash))throw Error('LOCAL_CREATE_REQUEST_INVALID');
    const result=this.store.createLocalOwned(ownerUid,requestKey,requestHash,()=>this.prepareRoom(displayName,true,requested));return {...this.creationResponse(result.room),idempotent:result.idempotent};
  }
  createLocalRematch(ownerUid:string,requestKey:string,requestHash:string,predecessorRoomId:string,hostCapability:string){
    assertLocalRealContent();let capability:Capability|undefined;try{capability=this.verify(hostCapability);}catch{throw Error('LOCAL_REMATCH_HOST_REQUIRED');}const predecessor=this.store.load(predecessorRoomId);
    const recordedOwner=this.store.localRoomOwner(predecessorRoomId);if(recordedOwner&&recordedOwner!==ownerUid)throw Error('LOCAL_REMATCH_HOST_REQUIRED');
    if(!capability||capability.role!=='host'||capability.roomId!==predecessorRoomId||!predecessor?.members.some(m=>m.role==='host'&&m.uid===capability.uid))throw Error('LOCAL_REMATCH_HOST_REQUIRED');
    const result=this.store.createLocalOwned(ownerUid,requestKey,requestHash,()=>{
      const predecessor=this.store.load(predecessorRoomId);if(!predecessor)throw Error('LOCAL_REMATCH_SOURCE_UNAVAILABLE');
      if(predecessor.game.lifecycle!=='MATCH_COMPLETE')throw Error('LOCAL_REMATCH_NOT_FINISHED');
      const snapshot=predecessor.questionSourceSnapshot,source=snapshot?this.localQuestionSourcesBySnapshot.get(snapshot):undefined;if(!snapshot||!source)throw Error('LOCAL_REMATCH_SOURCE_UNAVAILABLE');
      const previous=predecessor.localRematch,selection=predecessor.questionSelection,family=selection&&this.isChallengeSelection(selection)?selection.challengeFamilyState:undefined;
      const excludedQuestionIds=[...new Set([...(previous?.excludedQuestionIds??[]),...(selection?.consumedQuestionIds??[]),...(family?.consumedIds??[]),...(predecessor.activeQuestion?[predecessor.activeQuestion.id]:[])])];
      const excludedAnswerConceptIds=[...new Set([...(previous?.excludedAnswerConceptIds??[]),...(selection?.consumedAnswerConceptIds??[]),...(family?.consumedConceptIds??[]),...(predecessor.activeQuestion?[predecessor.activeQuestion.answerConceptId]:[])])];
      const excludedFactFamilies=[...new Set([...(previous?.excludedFactFamilies??[]),...(family?.consumedFactFamilies??[])])];
      const retained={predecessorRoomId,sourceSnapshot:snapshot,excludedQuestionIds,excludedAnswerConceptIds,excludedFactFamilies};
      const filtered={...source,questions:this.excludePriorQuestions(source.questions,retained)};
      const room=this.prepareRoom(predecessor.members.find(m=>m.role==='host')!.displayName,true,predecessor.config,filtered,true);
      room.localRematch=retained;
      room.members.push(...predecessor.members.filter(member=>member.role==='player').map(member=>({...member,ready:false,carried:true as const})));
      return room;
    },predecessorRoomId);
    if(result.room.localRematch?.predecessorRoomId!==predecessorRoomId)throw Error('LOCAL_CREATE_KEY_CONFLICT');
    if(!result.idempotent)this.onRoomChanged?.(predecessorRoomId);
    return {...this.creationResponse(result.room),idempotent:result.idempotent,predecessorRoomId,source:{snapshotId:result.room.localRematch.sourceSnapshot,selection:'UNSEEN_PREDECESSOR' as const}};
  }
  carryRematch(predecessorRoomId: string, token: string) {
    const capability = this.mustCapability(predecessorRoomId, token);
    if (capability.role !== 'player') throw Error('UNAUTHORIZED');
    const predecessor = this.mustRoom(predecessorRoomId);
    if (!predecessor.successor) throw Error('ROOM_NOT_FOUND');
    const successor = this.mustRoom(predecessor.successor.roomId);
    const member = successor.members.find(member => member.role === 'player' && member.uid === capability.uid);
    if (!member || member.joinGeneration !== capability.joinGeneration) throw Error('SEAT_REMOVED');
    if (member.carried) {
      delete member.carried;
      this.commit(successor, 'REMATCH_PLAYER_JOINED', member.uid, {});
      this.onRoomChanged?.(successor.id);
    }
    return { ...predecessor.successor, token: this.joinResponse(successor, member).token };
  }
  private excludePriorQuestions<T extends StoredQuestion>(questions:T[],prior:NonNullable<Room['localRematch']>){
    const ids=new Set(prior.excludedQuestionIds),concepts=new Set(prior.excludedAnswerConceptIds),families=new Set(prior.excludedFactFamilies??[]);
    return questions.filter(q=>!ids.has(q.id)&&!concepts.has(q.answerConceptId)&&!(q.challenge?.factFamilies??[]).some(f=>families.has(f)));
  }
  private prepareRoom(displayName:string,demo:boolean,requested:CreateMatchConfig,localSourceOverride?:LocalRuntimeQuestionSource,isRematch=false):Room {
    const categoryProjectionVersion = isRematch ? requested.categoryProjectionVersion : CURRENT_CATEGORY_PROJECTION;
    if (!demo && !this.questionsSync(false).length)
      throw new Error("NO_APPROVED_QUESTION_STOCK");
    const id = randomUUID();
    const code = id.replaceAll("-", "").slice(0, 6).toUpperCase();
    const host = {
      uid: randomUUID(),
      role: "host" as const,
      displayName,
      ready: true,
    };
    // bestOf is accepted only for stale clients and deliberately has no v2 effect.
    const requestedCategories = canonicalizeCategoryIds([
      ...new Set(
        (requested.categories ?? [])
          .filter(
            (category): category is string =>
              typeof category === "string" && category.trim().length > 0,
          )
          .map((category) => category.trim()),
      ),
    ], categoryProjectionVersion).sort();
    const categories = requestedCategories.length
      ? requestedCategories
      : demo
        ? canonicalizeCategoryIds([
            ...new Set(
              ((localSourceOverride?.questions as StoredQuestion[]|undefined)??this.questionsSync(true))
                .map((question) => question.categoryId)
                .filter(
                  (category): category is string =>
                    typeof category === "string",
                ),
            ),
          ], categoryProjectionVersion).sort()
        : [];
    if (!categories.length) throw new Error("QUESTION_CATEGORY_SCOPE_REQUIRED");
    const modality =
      requested.modality === "image" || requested.modality === "charades"
        ? requested.modality
        : "classic";
    const gameKind = requested.gameKind ?? "huroof";
    if (gameKind !== "huroof" && gameKind !== "categories")
      throw new Error("GAME_KIND_INVALID");
    const localSource = demo ? localSourceOverride??this.localFirestoreQuestionSource : undefined;
    const challenge = this.validateRoomQuestionScope(
      demo, categories, modality, gameKind, requested,
      (localSourceOverride?.questions as StoredQuestion[] | undefined) ?? this.questionsSync(demo),
      categoryProjectionVersion,
    );
    const config: MatchConfig = {
      policyVersion: 1,
      ...(categoryProjectionVersion ? { categoryProjectionVersion } : {}),
      questionSeconds: Math.max(
        10,
        Math.min(60, requested.questionSeconds ?? 20),
      ),
      opponentSeconds: Math.max(
        10,
        Math.min(60, requested.opponentSeconds ?? 10),
      ),
      teams: {
        horizontal: requested.teams?.horizontal?.trim() || "فريق ↔",
        vertical: requested.teams?.vertical?.trim() || "فريق ↕",
      },
      categories,
      modality,
      gameKind,
      ...(gameKind === "categories"
        ? { categorySnapshot: isRematch && requested.categorySnapshot ? requested.categorySnapshot : trustedCategorySnapshot(categories, localSource?.inventory.categories, categoryProjectionVersion) }
        : {}),
      difficulty: requested.difficulty ?? "mixed",
      mode: requested.mode ?? "classic",
      showQuestionOnAudience: requested.showQuestionOnAudience !== false,
      labelledColours: requested.labelledColours === true,
      mapPresentation: requested.mapPresentation === "interactive" ? "interactive" : "ordinary",
      ...(challenge ? { challenge } : {}),
    };
    const room: Room = {
      id,
      code,
      revision: 1,
      demo,
      roomSchemaVersion: 2,
      ruleSet: "v2",
      config,
      game: initialGameState(),
      members: [host],
      manualParticipants: [],
      boardNonce: this.newBoardNonce(),
      boardSequence: 0,
      surpriseLetters: [],
      audit: [
        {
          revision: 1,
          type: "ROOM_CREATED",
          at: this.now(),
          actor: host.uid,
          payload: { demo, config, ruleSet: "v2" },
        },
      ],
    };
    if (localSource) room.questionSourceSnapshot = localSource.snapshotId;
    return room;
  }
  private hasInjectedChallengeDefinitions(): boolean {
    return this.challengeDefinitions.hasDefinitions;
  }
  private sameChallengeCapability(value: unknown, expected: ChallengeCapabilityOffer): boolean {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<ChallengeCapabilityOffer>;
    const schemas: unknown = candidate.definitionSchemas ?? ["t36-challenge-definition-v1"];
    return candidate.protocolVersion === expected.protocolVersion && Array.isArray(candidate.mechanics) && candidate.mechanics.length > 0 && candidate.mechanics.length <= 5 && new Set(candidate.mechanics).size === candidate.mechanics.length && candidate.mechanics.every((mechanic) => mechanic === "navigation" || mechanic === "missing_tile" || mechanic === "memory" || mechanic === "qatar_map" || mechanic === "word_search") &&
      Array.isArray(schemas) && schemas.length > 0 && schemas.length <= 3 && new Set(schemas).size === schemas.length && schemas.every((schema) => schema === "t36-challenge-definition-v1" || schema === "t37-clean70-challenge-definition-v1" || schema === "t37-topup-word-search-definition-v1") &&
      expected.mechanics.every((mechanic) => candidate.mechanics!.includes(mechanic)) &&
      (expected.definitionSchemas ?? ["t36-challenge-definition-v1"]).every((schema) => schemas.includes(schema));
  }
  async join(
    code: string,
    displayName: unknown,
    challenge?: unknown,
    requestKey?: unknown,
  ): Promise<{ roomId: string; revision: number; token: string }> {
    const initial = this.store.load(code) ?? this.store.load(code.toUpperCase());
    if (!initial) throw new Error("ROOM_NOT_FOUND");
    return this.serialize(initial.id, async () =>
      this.joinSerialized(initial.id, displayName, challenge, requestKey),
    );
  }
  private joinSerialized(
    roomId: string,
    displayName: unknown,
    challenge?: unknown,
    requestKey?: unknown,
  ): { roomId: string; revision: number; token: string } {
    const room = this.store.load(roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    const name = normalizePlayerDisplayName(displayName);
    if (!name) throw new Error('INVALID_DISPLAY_NAME');
    if (requestKey !== undefined && (typeof requestKey !== 'string' || !/^[A-Za-z0-9._:-]{16,128}$/.test(requestKey)))
      throw new Error('JOIN_REQUEST_KEY_INVALID');
    if (room.config.challenge && !this.sameChallengeCapability(challenge, room.config.challenge))
      throw new Error("CHALLENGE_PROTOCOL_REQUIRED");
    const keyHash = typeof requestKey === 'string' ? createHash('sha256').update(requestKey).digest('hex') : undefined;
    const receipt = keyHash ? this.store.joinReceipt(roomId, keyHash) : undefined;
    if (receipt) {
      if (receipt.name !== name) throw new Error('JOIN_REQUEST_KEY_CONFLICT');
      const member = room.members.find(candidate => candidate.uid === receipt.memberUid);
      if (!member || member.joinGeneration !== receipt.generation) throw new Error('SEAT_REMOVED');
      return this.joinResponse(room, member);
    }
    if (room.game.lifecycle === 'MATCH_COMPLETE') throw new Error('MATCH_COMPLETE');
    const matchesName = matchesPlayerName(name);
    const matching = room.members.filter(member => member.role === 'player' && matchesName(member));
    if (matching.some(member => member.carried || this.isPlayerConnected(room.id, member.uid)) ||
        (room.manualParticipants ?? []).some(matchesName))
      throw new Error('DUPLICATE_DISPLAY_NAME');
    const reclaim = matching[0];
    if (!reclaim && !canManageTeamsInState(room.game.lifecycle))
      throw new Error("JOIN_NOT_ALLOWED");
    if (!reclaim && this.participantCount(room) >= 16)
      throw new Error("PLAYER_CAPACITY_REACHED");
    const member: Member = reclaim ?? {
      uid: randomUUID(),
      role: "player",
      displayName: name,
      team: this.memberTeam(room),
      ready: false,
    };
    const generation = randomUUID();
    member.joinGeneration = generation;
    if (!reclaim) room.members.push(member);
    this.commit(room, reclaim ? 'PLAYER_RECLAIMED' : 'PLAYER_JOINED', member.uid, { team: member.team }, undefined, undefined,
      keyHash ? { keyHash, name, memberUid: member.uid, generation } : undefined);
    return this.joinResponse(room, member);
  }
  private joinResponse(room: Room, member: Member): { roomId: string; revision: number; token: string } {
    this.pendingPlayerConnections.set(`${room.id}:${member.uid}`, this.clock().getTime() + JOIN_CONNECTION_GRACE_MS);
    return {
      roomId: room.id,
      revision: room.revision,
      token: this.token({ roomId: room.id, uid: member.uid, role: 'player', joinGeneration: member.joinGeneration }),
    };
  }
  private readonly pendingPlayerConnections = new Map<string, number>();
  playerHasConnectedTransport?: (roomId: string, uid: string) => boolean;
  playerTransportObserved(roomId: string, uid: string): void {
    this.pendingPlayerConnections.delete(`${roomId}:${uid}`);
  }
  private isPlayerConnected(roomId: string, uid: string): boolean {
    return this.playerHasConnectedTransport?.(roomId, uid) === true || (this.pendingPlayerConnections.get(`${roomId}:${uid}`) ?? 0) > this.clock().getTime();
  }
  metadata(roomId: string, token: string): ProjectionEnvelope {
    const capability = this.mustCapability(roomId, token);
    const room = this.mustRoom(roomId);
    return this.project(room, capability);
  }
  /**
   * Local equivalent of the Firebase resume callable.  A challenge room must
   * negotiate its pinned protocol before either HTTP snapshot or WebSocket
   * delivery; ordinary legacy rooms remain compatible.
   */
  resume(roomId: string, token: string, challenge?: unknown): { revision: number; serverTime: string } {
    const capability = this.mustCapability(roomId, token);
    const room = this.mustRoom(roomId);
    if (capability.role !== "audience") {
      const member = room.members.find((candidate) => candidate.uid === capability.uid);
      if (!member || member.role !== capability.role) throw new Error("UNAUTHORIZED");
    }
    if (room.config.challenge && !this.sameChallengeCapability(challenge, room.config.challenge))
      throw new Error("CHALLENGE_PROTOCOL_REQUIRED");
    // Reconcile an elapsed deadline inside the per-room lock (never racing a concurrent intent's
    // write) and tell connected clients, instead of committing silently from this read path.
    if (room.challenge || (room.buzzOpen && room.deadlineAt && this.clock().getTime() >= Date.parse(room.deadlineAt)))
      void this.serialize(room.id, async () => this.expire(this.mustRoom(room.id)))
        .then((changed) => { if (changed) this.onRoomChanged?.(room.id); })
        .catch(() => undefined);
    return { revision: room.revision, serverTime: this.now() };
  }
  /** Set by the transport so server-side state changes outside an intent reach every client. */
  onRoomChanged?: (roomId: string) => void;
  presenceActor(
    roomId: string,
    token: string,
  ): { uid: string; role: ClientRole } {
    const capability = this.mustCapability(roomId, token);
    const room = this.mustRoom(roomId);
    // Audience is an explicitly signed, synthetic read-only capability. It has
    // no member record and must never participate in player presence.
    if (capability.role === "audience" && capability.uid === "audience")
      return { uid: capability.uid, role: capability.role };
    const member = room.members.find(
      (candidate) =>
        candidate.uid === capability.uid && candidate.role === capability.role,
    );
    if (!member) throw new Error("UNAUTHORIZED");
    return { uid: member.uid, role: member.role };
  }
  private mustRoom(id: string): Room {
    const room = this.store.load(id);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    if (
      (room.questionSourceSnapshot &&
        !this.localQuestionSourcesBySnapshot.has(room.questionSourceSnapshot)) ||
      (room.demo &&
        this.localFirestoreQuestionSource &&
        !room.questionSourceSnapshot)
    )
      throw new Error("QUESTION_SOURCE_SNAPSHOT_UNAVAILABLE");
    return room;
  }
  private mustCapability(roomId: string, token: string): Capability {
    const capability = this.verify(token);
    if (!capability || capability.roomId !== roomId)
      throw new Error("UNAUTHORIZED");
    const room = this.store.load(roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    if (capability.role === "audience" && capability.uid === "audience") return capability;
    const member = room.members.find((candidate) => candidate.uid === capability.uid);
    if (!member || member.role !== capability.role || member.joinGeneration !== capability.joinGeneration)
      throw new Error("UNAUTHORIZED");
    return capability;
  }
  /** Authorizes an image by the active immutable question binding only. */
  authorizeCurrentQuestionMedia(
    roomId: string,
    token: string,
    request: unknown,
  ): QuestionMedia {
    const capability = this.mustCapability(roomId, token);
    const room = this.mustRoom(roomId);
    if (room.challenge && !restoreChallengeState(room.challenge).solutionRevealed)
      throw new Error("CHALLENGE_MEDIA_DENIED");
    const value = request as Partial<QuestionMedia> | undefined;
    if (
      !value ||
      Object.keys(value).length !== 2 ||
      typeof value.mediaId !== "string" ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(value.mediaId) ||
      typeof value.assetSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.assetSha256)
    )
      throw new Error("INVALID_MEDIA_REQUEST");
    if ((room as Room & { closedAt?: unknown }).closedAt)
      throw new Error("ROOM_CLOSED");
    const visibleStates = new Set<GameState["lifecycle"]>([
      "QUESTION_READING",
      "FIRST_ANSWER",
      "OPPONENT_CHANCE",
      "QUESTION_FAILED",
      "PAUSED",
    ]);
    const hostAllowed = capability.role === "host" && visibleStates.has(room.game.lifecycle);
    const audienceAllowed =
      capability.role === "audience" &&
      capability.uid === "audience" &&
      visibleStates.has(room.game.lifecycle) &&
      room.config.showQuestionOnAudience !== false;
    if (!hostAllowed && !audienceAllowed)
      throw new Error(
        capability.role === "player" ? "FORBIDDEN_ROLE" : "MEDIA_NOT_VISIBLE",
      );
    const media = hasRevealedOccurrence(
      room.activeQuestionOccurrence,
      room.answerRevealedOccurrence,
    )
      ? room.activeQuestion?.answerMedia ?? room.activeQuestion?.media
      : room.activeQuestion?.media;
    if (
      !["image", "video"].includes(room.activeQuestion?.modality ?? "") ||
      !media ||
      media.mediaId !== value.mediaId ||
      media.assetSha256 !== value.assetSha256
    )
      throw new Error("MEDIA_BINDING_MISMATCH");
    return media;
  }
  issueCurrentQuestionMedia(
    roomId: string,
    token: string,
    request: unknown,
  ): { ticket: string; expiresAt: string } {
    const media = this.authorizeCurrentQuestionMedia(roomId, token, request);
    const capability = this.mustCapability(roomId, token);
    const key = `${capability.uid}:${roomId}`;
    const nowMs = this.clock().getTime();
    const recent = (this.mediaIssues.get(key) ?? []).filter(
      (at) => at > nowMs - 60_000,
    );
    if (recent.length >= 12) throw new Error("MEDIA_RATE_LIMITED");
    recent.push(nowMs);
    this.mediaIssues.set(key, recent);
    const expiresAtMs = nowMs + 60_000;
    const payload = {
      purpose: "current-question-media",
      roomId,
      uid: capability.uid,
      role: capability.role,
      mediaId: media.mediaId,
      assetSha256: media.assetSha256,
      expiresAtMs,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return {
      ticket: `${encoded}.${createHmac("sha256", this.secret).update(encoded).digest("base64url")}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }
  async readCurrentQuestionMedia(
    ticket: string,
    bearerToken: string,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    const [encoded, signature] = ticket.split(".");
    const expected = encoded
      ? createHmac("sha256", this.secret).update(encoded).digest("base64url")
      : "";
    if (
      !encoded ||
      !signature ||
      expected.length !== signature.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    )
      throw new Error("INVALID_MEDIA_TICKET");
    let payload: {
      purpose?: unknown;
      roomId?: unknown;
      uid?: unknown;
      role?: unknown;
      mediaId?: unknown;
      assetSha256?: unknown;
      expiresAtMs?: unknown;
    };
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw new Error("INVALID_MEDIA_TICKET");
    }
    if (
      payload.purpose !== "current-question-media" ||
      typeof payload.roomId !== "string" ||
      typeof payload.uid !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.mediaId !== "string" ||
      typeof payload.assetSha256 !== "string" ||
      !Number.isSafeInteger(payload.expiresAtMs)
    )
      throw new Error("MEDIA_TICKET_EXPIRED");
    const expiresAtMs = payload.expiresAtMs as number;
    if (expiresAtMs < this.clock().getTime())
      throw new Error("MEDIA_TICKET_EXPIRED");
    const capability = this.mustCapability(payload.roomId, bearerToken);
    if (capability.uid !== payload.uid || capability.role !== payload.role)
      throw new Error("UNAUTHORIZED");
    const media = this.authorizeCurrentQuestionMedia(
      payload.roomId,
      bearerToken,
      { mediaId: payload.mediaId, assetSha256: payload.assetSha256 },
    );
    if (media.youtube !== undefined) {
      assertLocalRealContent();
      if (media.type !== 'video' || !isYouTubeMediaDescriptor(media.youtube) || createHash('sha256').update(youtubeDescriptorBytes(media.youtube)).digest('hex') !== media.assetSha256) throw Error('MEDIA_BINDING_MISMATCH');
      return { bytes: Buffer.from(youtubeDescriptorBytes(media.youtube)), contentType: 'application/vnd.huroof.youtube+json' };
    }
    if(process.env.LOCAL_DB_QUESTION_SOURCE==='saved-release'){
      const entry=await localMediaEntry(media.mediaId,media.assetSha256);
      if(entry?.path){
        const target=await import('node:fs/promises').then(fs=>fs.realpath(entry.path!));
        const allowedRoots=['D:/projects/huroof_wa_oloof','C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof'].map(root=>resolve(root));
        if(!allowedRoots.some(root=>{const rel=relative(root,target);return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel);})||(await lstat(entry.path)).isSymbolicLink())throw Error('MEDIA_PATH_INVALID');
        const bytes=await readFile(target);
        if(bytes.length!==entry.byteSize||createHash('sha256').update(bytes).digest('hex')!==media.assetSha256)throw Error('MEDIA_ASSET_INVALID');
        if(!['image/png','image/jpeg','image/webp','video/mp4'].includes(entry.contentType))throw Error('MEDIA_TYPE_UNSUPPORTED');
        return {bytes,contentType:entry.contentType};
      }
    }
    const video = media.type === "video";
    const rebuiltImage = !video && media.mediaId.startsWith("rebuild-v2-photo-");
    const packageDirectory = video
      ? "goal-quiz-2026"
      : rebuiltImage
        ? "guess-picture-rebuild-v2"
        : "v18-private-240";
    const manifestPath = join(process.cwd(), "content", "question-media", packageDirectory, video ? "media-registry.json" : "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      assets?: Array<{
        mediaId?: string;
        assetSha256?: string;
        localFile?: string;
        width?: number; height?: number;
      }>;
    };
    const entry = manifest.assets?.find(
      (item) =>
        item.mediaId === media.mediaId &&
        (item.assetSha256 ?? (video ? (item as { sha256?: unknown }).sha256 : undefined)) === media.assetSha256,
    );
    if (
      !entry ||
      typeof entry.localFile !== "string" ||
      !(video
        ? /^assets\/[a-f0-9]{64}\.mp4$/u
        : rebuiltImage
          ? /^images\/\d{3}-\d{3}\.jpg$/u
          : /^originals\/[a-f0-9]{64}\.png$/u).test(entry.localFile)
    )
      throw new Error("MEDIA_ASSET_MISSING");
    const root = resolve(
      process.cwd(),
      "content",
      "question-media",
      packageDirectory,
    );
    const target = resolve(root, entry.localFile);
    if (
      relative(root, target).startsWith(`..${sep}`) ||
      relative(root, target) === ".."
    )
      throw new Error("MEDIA_PATH_INVALID");
    if ((await lstat(target)).isSymbolicLink()) throw new Error("MEDIA_PATH_INVALID");
    const bytes = await readFile(target);
    if (video) {
      if (bytes.length > 1_000_000 || bytes.subarray(4, 8).toString("ascii") !== "ftyp" || createHash("sha256").update(bytes).digest("hex") !== media.assetSha256)
        throw new Error("MEDIA_ASSET_INVALID_VIDEO");
      return { bytes, contentType: "video/mp4" };
    }
    if (rebuiltImage) {
      if (bytes.length > 1_000_000 || !bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) || createHash("sha256").update(bytes).digest("hex") !== media.assetSha256)
        throw new Error("MEDIA_ASSET_INVALID_JPEG");
      return { bytes, contentType: "image/jpeg" };
    }
    verifyPrivateQuestionMediaBytes(bytes, media.assetSha256, entry.width, entry.height);
    return { bytes, contentType: "image/png" };
  }
  private categoryChallengePlan(board: GameBoard, boardSequence: number): { boardSlots: FamilySlot[]; reserveSlots: FamilySlot[] } {
    const boardSlots = board.cells.map((cell) => {
      if (!cell.categoryId) throw new Error("Challenge category board cell is missing its category.");
      return { slotId: `board:${boardSequence}:${cell.id}`, categoryId: cell.categoryId };
    });
    const categories = [...new Set(boardSlots.map((slot) => slot.categoryId))].sort();
    return { boardSlots, reserveSlots: categories.map((categoryId) => ({ slotId: `reserve:${boardSequence}:${categoryId}:0`, categoryId })) };
  }
  private isChallengeSelection(selection: MatchQuestionSelection | ChallengeCategoryQuestionSelection | undefined): selection is ChallengeCategoryQuestionSelection {
    return !!selection && "challengeFamilyState" in selection;
  }
  private challengeRemainingSlots(selection: ChallengeCategoryQuestionSelection, selectedSlotId?: string): FamilySlot[] {
    const occupied = new Set([...selection.challengeCompletedSlotIds, ...Object.values(selection.challengeSlotForCell)]);
    if (selectedSlotId) occupied.add(selectedSlotId);
    return selection.challengePlannedSlots.filter((slot) => !occupied.has(slot.slotId));
  }
  private async freshBoard(room: Room): Promise<GameBoard> {
    const questions = await this.effectiveQuestions(room);
    let sequence = room.boardSequence;
    let seed = deriveBoardSeed(room.boardNonce, sequence);
    while (seed === room.game.board?.seed) { sequence++; seed = deriveBoardSeed(room.boardNonce, sequence); }
    if (room.config.gameKind === "categories") {
      const board = generateCategoryBoard(seed, room.config.categorySnapshot ?? []);
      if (room.config.challenge) {
        const challengeQuestions = questions.filter((question) => question.modality !== "charades" && (!question.challenge || room.config.challenge!.mechanics.includes(question.challenge.kind)));
        const plan = this.categoryChallengePlan(board, sequence);
        try {
          room.questionSelection = this.isChallengeSelection(room.questionSelection)
            ? beginNextChallengeSelectionRound(challengeQuestions, room.questionSelection, plan)
            : createChallengeCategoryQuestionSelection(challengeQuestions, { categories: room.config.categories, categoryProjectionVersion: room.config.categoryProjectionVersion, modality: "classic", seed }, plan);
        } catch (error) { throw new Error(`CHALLENGE_CONTENT_DEPLETED: ${error instanceof Error ? error.message : "family allocation failed"}`); }
      } else room.questionSelection ??= createCategoryQuestionSelection(questions, { categories: room.config.categories, categoryProjectionVersion: room.config.categoryProjectionVersion, modality: "classic", seed });
      room.boardSequence = sequence + 1;
      room.categoryOccurrences = Object.fromEntries(board.cells.reduce<Map<string, number>>((counts, cell) => counts.set(cell.categoryId!, Math.max(counts.get(cell.categoryId!) ?? 0, cell.categoryOccurrence ?? 0)), new Map()));
      return board;
    }
    const selection = room.questionSelection ?? createMatchQuestionSelection(questions, { categories: room.config.categories, categoryProjectionVersion: room.config.categoryProjectionVersion, modality: room.config.modality, seed: deriveBoardSeed(room.boardNonce, 0), reservePerLetter: room.demo ? 1 : 3 });
    room.questionSelection = selection;
    const shuffled = Object.keys(selection.queues).map((letter, index) => ({ letter, order: (seed * 1103515245 + index * 12345) >>> 0 })).sort((a, b) => a.order - b.order).map(({ letter }) => letter);
    room.surpriseLetters = shuffled.slice(16, 25);
    room.boardSequence = sequence + 1;
    return generateBoard(seed, shuffled.slice(0, 16));
  }
  private releaseRoundReservations(room: Room): void {
    if (!room.questionSelection) return;
    room.questionSelection = {
      ...room.questionSelection,
      reservedQuestionIds: [],
      reservedAnswerConceptIds: [],
      reservedForCell: {},
    };
  }
  private holdContent(
    room: Room,
    operation: "SELECT_CELL" | "START_NEXT_ROUND" | "CONTINUE",
    cellId = room.game.activeCellId,
  ): void {
    room.game = {
      ...room.game,
      contentHold: {
        reason: "CONTENT_EXHAUSTED",
        operation,
        ...(cellId ? { cellId } : {}),
        heldAtRevision: room.revision + 1,
      },
    };
    room.buzzOpen = false;
    room.deadlineAt = undefined;
    room.buzzWinner = undefined;
  }
  async startBoard(room: Room, nextRound = false): Promise<void> {
    if (nextRound && !this.isChallengeSelection(room.questionSelection)) this.releaseRoundReservations(room);
    const board = await this.freshBoard(room);
    // A board boundary is also a media/reveal boundary.  Keeping an old
    // occurrence here would let a delayed reveal grant describe a question
    // that no longer belongs to the active board.
    room.activeQuestion = undefined;
    room.challenge = undefined;
    room.challengeBridge = undefined;
    room.activeQuestionOccurrence = undefined;
    room.answerRevealedOccurrence = undefined;
    room.buzzOpen = false;
    room.deadlineAt = undefined;
    room.pausedTimer = undefined;
    room.buzzWinner = undefined;
    room.answerFeedback = undefined;
    room.questionFailedReason = undefined;
    room.game = reduceGame(
      room.game,
      nextRound
        ? { type: "START_NEXT_ROUND", board }
        : { type: "START_MATCH", board },
    );
    room.game = reduceGame(room.game, { type: 'ROUND_READY' });
  }
  private openQuestionBuzzer(
    room: Room,
    seconds = room.config.questionSeconds,
  ): void {
    room.buzzWinner = undefined;
    room.buzzOpen = true;
    room.deadlineAt = new Date(
      this.clock().getTime() + seconds * 1000,
    ).toISOString();
  }
  /** Authoritative deadline processing, invoked by the HTTP service loop and before every intent. */
  private async serialize<T>(
    roomId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.roomSerial.get(roomId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.roomSerial.set(
      roomId,
      previous.then(() => current),
    );
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
  private readonly tickFailures = new Map<string, string>();
  async tick(): Promise<string[]> {
    const changed: string[] = [];
    const now = this.clock();
    for (const [uid, until] of this.pendingPlayerConnections) {
      if (until <= now.getTime()) this.pendingPlayerConnections.delete(uid);
    }
    for (const id of this.store.tickCandidateIds(now.toISOString())) {
      try {
        if (
          await this.serialize(id, async () =>
            this.expire(this.mustRoom(id)),
          )
        )
          changed.push(id);
        this.tickFailures.delete(id);
      } catch (error) {
        // One room that cannot advance (a restored room whose source snapshot is missing, a
        // challenge definition that changed between restarts) must never stop the clock for
        // the other rooms or crash the server. Report each distinct failure once.
        const reason = error instanceof Error ? error.message : String(error);
        if (reason !== "QUESTION_SOURCE_SNAPSHOT_UNAVAILABLE" && this.tickFailures.get(id) !== reason)
          console.error(`ROOM_TICK_FAILED ${id}: ${reason.slice(0, 200)}`);
        this.tickFailures.set(id, reason);
      }
    }
    return changed;
  }
  async intent(
    roomId: string,
    token: string,
    intent: GameIntent,
  ): Promise<{
    revision: number;
    replayed: boolean;
    projection: ProjectionEnvelope;
    stale?: boolean;
  }> {
    return this.serialize(roomId, () =>
      this.intentSerialized(roomId, token, intent),
    );
  }
  private challengeParticipants(room: Room, hostUid: string): Participant[] {
    return [
      ...room.members.flatMap((member) => member.role === "player" && member.team ? [{ kind: "member" as const, uid: `member:${member.uid}`, actorUid: member.uid, team: member.team }] : []),
      ...(room.manualParticipants ?? []).map((participant) => ({ kind: "manual" as const, id: `manual:${participant.id}`, team: participant.team, controllerUid: hostUid })),
    ];
  }
  private challengeRuntime(room: Room, definitionHash: string): ChallengeRuntimeConfig {
    const hostUid = room.members.find((member) => member.role === "host")?.uid;
    if (!hostUid || !room.config.challenge) throw new Error("CHALLENGE_PROTOCOL_UNAVAILABLE");
    return {
      hostUid,
      protocolHash: room.config.challenge.protocolVersion,
      assignmentHash: `${room.activeQuestionOccurrence ?? "missing"}:${room.revision}`,
      stimulusHash: definitionHash,
    };
  }
  private activateChallenge(room: Room): void {
    if (!room.config.challenge || !room.activeQuestion?.challenge) return;
    const definition = this.challengeDefinitions.resolveBound(room.activeQuestion);
    if (!room.config.challenge.mechanics.includes(definition.kind)) throw new Error("CHALLENGE_MECHANIC_NOT_NEGOTIATED");
    if (!room.activeQuestionOccurrence || !room.game.activeCellId || !room.game.entitledTeam) throw new Error("CHALLENGE_OCCURRENCE_UNAVAILABLE");
    if (definition.kind === "navigation" && !room.members.some((member) => member.role === "player" && member.team === room.game.entitledTeam))
      throw new Error("NAVIGATION_PRIVATE_GUIDE_REQUIRED");
    const runtime = this.challengeRuntime(room, definition.definitionSha256);
    room.challenge = compactChallengeState(createChallengeState(definition, room.activeQuestionOccurrence, room.game.entitledTeam, this.clock().getTime(), runtime));
    room.challengeBridge = createChallengeBridgeContext(room.activeQuestionOccurrence, room.game.activeCellId);
    // Challenges own their own stages. The existing board enters the entitled
    // first-answer state without opening a generic buzzer or grading path.
    room.game = reduceGame(room.game, { type: "BUZZ_ACCEPTED", team: room.game.entitledTeam });
    room.buzzOpen = false;
    room.deadlineAt = undefined;
  }
  private async applyChallengeIntent(room: Room, capability: Capability, intent: GameIntent, receiptKey: string, receiptHash: string) {
    if (!room.challenge || !room.activeQuestion?.challenge || !room.activeQuestionOccurrence) throw new Error("CHALLENGE_NOT_ACTIVE");
    const definition = this.challengeDefinitions.resolveBound(room.activeQuestion);
    const current = restoreChallengeState(room.challenge);
    const runtime = this.challengeRuntime(room, definition.definitionSha256);
    const participants = this.challengeParticipants(room, runtime.hostUid);
    const names: Record<string, ChallengeIntent["type"]> = {
      CHALLENGE_ASSIGN: "ASSIGN", CHALLENGE_READY: "READY", CHALLENGE_START: "START", CHALLENGE_MOVE: "MOVE", CHALLENGE_SUBMIT: "SUBMIT", CHALLENGE_START_STEAL: "START_STEAL", CHALLENGE_DECLINE_STEAL: "DECLINE_STEAL", CHALLENGE_PAUSE: "PAUSE", CHALLENGE_RESUME: "RESUME", CHALLENGE_VOID: "VOID", CHALLENGE_REVEAL: "REVEAL", CHALLENGE_CONTINUE: "CONTINUE",
    };
    const type = names[intent.type as keyof typeof names];
    if (!type) throw new Error("CHALLENGE_INTENT_INVALID");
    const payload = intent.payload;
    const common = { id: intent.intentId, actor: capability.uid, payloadHash: receiptHash, occurrence: payload.occurrence as string, revision: payload.challengeRevision as number, expectedStage: payload.stage as ChallengeIntent["expectedStage"], at: this.clock().getTime(), type };
    const challengeIntent = type === "ASSIGN" ? { ...common, type, assignment: payload.assignment as "guide" | "mover" | "captain" | "stealCaptain", participantId: payload.participantId as string }
      : type === "READY" ? { ...common, type, participantId: payload.participantId as string, readiness: payload.readiness as ChallengeIntent & never }
      : type === "MOVE" ? { ...common, type, direction: payload.direction as "north" | "east" | "south" | "west" }
      : type === "SUBMIT" ? { ...common, type, ...(Array.isArray(payload.answers) ? { answers: payload.answers as string[] } : { start: payload.start as { row: number; column: number }, end: payload.end as { row: number; column: number } }) }
      : common as ChallengeIntent;
    const next = reduceChallenge(definition, current, challengeIntent as ChallengeIntent, participants, runtime);
    if (next === current) throw new Error("CHALLENGE_INTENT_REJECTED");
    room.challenge = compactChallengeState(next);
    if (next.result === "correct" && room.game.activeCellId) {
      const bridged = applyChallengeAward(next, room.game, room.challengeBridge ?? createChallengeBridgeContext(next.occurrence, room.game.activeCellId));
      room.challenge = compactChallengeState(bridged.challenge);
      room.game = bridged.game;
      room.challengeBridge = bridged.context;
    }
    if (next.continued) {
      if (next.result !== "correct") {
        if (!room.game.activeCellId) throw new Error("CHALLENGE_CONTINUATION_CELL_MISSING");
        // A continued failed/void category cell must have a fresh family-safe reservation before it returns unclaimed.
        // When the category has nothing left, fall back to the same content hold as ordinary cells so the
        // host can still end the match; otherwise every host intent stays blocked behind the challenge.
        let exhausted = false;
        if (room.config.gameKind === "categories") {
          try { await this.replaceFailedCategory(room); }
          catch (error) {
            if (!(error instanceof Error && /CONTENT_EXHAUSTED|No unused question/.test(error.message))) throw error;
            exhausted = true;
          }
        }
        const heldCellId = room.game.activeCellId;
        const bridged = applyChallengeContinuation(next, room.game, room.challengeBridge ?? createChallengeBridgeContext(next.occurrence, room.game.activeCellId));
        room.game = bridged.game;
        room.challengeBridge = bridged.context;
        if (exhausted) this.holdContent(room, "CONTINUE", heldCellId);
      }
      // Terminal data remains projected until this explicit host action. Once it
      // is accepted, return to the audited board lifecycle without a second
      // award or any retained challenge projection.
      room.challenge = undefined;
      room.challengeBridge = undefined;
      room.activeQuestion = undefined;
      room.activeQuestionOccurrence = undefined;
    }
    this.commit(room, intent.type, capability.uid, { occurrence: next.occurrence, stage: next.stage, result: next.result }, receiptKey, receiptHash);
    return { revision: room.revision, replayed: false, projection: this.project(room, capability) };
  }
  private expire(room: Room): boolean {
    if (room.challenge && room.activeQuestion?.challenge) {
      const definition = this.challengeDefinitions.resolveBound(room.activeQuestion);
      const current = restoreChallengeState(room.challenge);
      const next = reconcileChallengeDeadline(definition, current, this.clock().getTime());
      if (next !== current) {
        room.challenge = compactChallengeState(next);
        if (next.result === "correct" && room.game.activeCellId) {
          const bridged = applyChallengeAward(next, room.game, room.challengeBridge ?? createChallengeBridgeContext(next.occurrence, room.game.activeCellId));
          room.challenge = compactChallengeState(bridged.challenge);
          room.game = bridged.game;
          room.challengeBridge = bridged.context;
        }
        this.commit(room, "CHALLENGE_SERVER_DEADLINE", "server", { occurrence: next.occurrence, stage: next.stage, result: next.result });
        return true;
      }
      return false;
    }
    if (
      !room.buzzOpen ||
      !room.deadlineAt ||
      this.clock().getTime() < Date.parse(room.deadlineAt)
    )
      return false;
    if (
      room.game.lifecycle !== "QUESTION_READING" &&
      room.game.lifecycle !== "OPPONENT_CHANCE"
    ) {
      room.buzzOpen = false;
      room.deadlineAt = undefined;
      return false;
    }
    room.game = reduceGame(room.game, { type: "TIME_EXPIRED" });
    room.questionFailedReason = 'no-answer';
    room.answerFeedback = undefined;
    room.buzzOpen = false;
    room.deadlineAt = undefined;
    room.buzzWinner = undefined;
    this.commit(room, "SERVER_TIME_EXPIRED", "server", {}, undefined);
    return true;
  }
  private async intentSerialized(
    roomId: string,
    token: string,
    intent: GameIntent,
  ): Promise<{
    revision: number;
    replayed: boolean;
    projection: ProjectionEnvelope;
    stale?: boolean;
  }> {
    if (!validIntent(intent)) throw new Error("INVALID_INTENT");
    const capability = this.mustCapability(roomId, token);
    const room = this.mustRoom(roomId);
    this.expire(room);
    const receiptKey = `${capability.uid}\u0000${intent.intentId}`;
    const receiptHash = canonicalIntentHash(intent);
    const seen = this.store.receipt(roomId, capability.uid, intent.intentId);
    if (seen) {
      if (seen.requestHash !== receiptHash)
        throw new Error("INTENT_ID_REUSED");
      return {
        revision: seen.revision,
        replayed: true,
        projection: this.project(room, capability),
      };
    }
    const legacyKey = `${capability.uid}:${intent.intentId}`;
    const legacyRevision = room.intentIds?.[receiptKey] ?? room.intentIds?.[legacyKey];
    if (legacyRevision !== undefined) {
      const legacyHash = room.intentHashes?.[receiptKey] ?? room.intentHashes?.[legacyKey];
      // Legacy rooms stored canonical JSON. An exact match may replay, while
      // altered payloads remain rejected instead of being rehashed blindly.
      if (legacyHash !== legacyCanonicalIntentJson(intent) && legacyHash !== receiptHash)
        throw new Error("INTENT_ID_REUSED");
      return { revision: legacyRevision, replayed: true, projection: this.project(room, capability) };
    }
    if (intent.expectedRevision !== room.revision)
      return {
        revision: room.revision,
        replayed: false,
        stale: true,
        projection: this.project(room, capability),
      };
    if (intent.type.startsWith("CHALLENGE_"))
      return this.applyChallengeIntent(room, capability, intent, receiptKey, receiptHash);
    if (intent.type === "LOBBY_SET_READY") {
      this.require(capability, "player");
      if (room.game.lifecycle !== "LOBBY") throw new Error("READY_NOT_ALLOWED");
      const member = room.members.find(
        (value) => value.uid === capability.uid,
      )!;
      member.ready = Boolean(intent.payload.ready);
      this.commit(
        room,
        intent.type,
        capability.uid,
        intent.payload,
        receiptKey,
        receiptHash,
      );
      return {
        revision: room.revision,
        replayed: false,
        projection: this.project(room, capability),
      };
    }
    if (intent.type === "BUZZ") {
      if (room.challenge && !restoreChallengeState(room.challenge).continued)
        throw new Error("CHALLENGE_ACTIVE_LEGACY_INTENT_BLOCKED");
      this.require(capability, "player");
      const member = room.members.find(
        (value) => value.uid === capability.uid,
      )!;
      if (
        !member?.team ||
        room.buzzWinner ||
        !room.buzzOpen ||
        !room.deadlineAt ||
        (room.game.lifecycle !== "QUESTION_READING" &&
          room.game.lifecycle !== "OPPONENT_CHANCE") ||
        (room.game.lifecycle === "OPPONENT_CHANCE" &&
          member.team !== room.game.entitledTeam)
      )
        throw new Error("BUZZ_NOT_OPEN");
      room.game = reduceGame(room.game, {
        type: "BUZZ_ACCEPTED",
        team: member.team,
      });
      room.buzzOpen = false;
      room.deadlineAt = undefined;
      room.buzzWinner = {
        uid: member.uid,
        displayName: member.displayName,
        team: member.team,
        method: "player",
      };
      this.commit(
        room,
        intent.type,
        capability.uid,
        { team: member.team },
        receiptKey,
        receiptHash,
      );
      return {
        revision: room.revision,
        replayed: false,
        projection: this.project(room, capability),
      };
    }
    this.require(capability, "host");
    if (
      room.game.contentHold &&
      intent.type !== "PAUSE" &&
      intent.type !== "END_WITHOUT_WINNER"
    )
      throw new Error("CONTENT_HOLD_ACTIVE");
    if (intent.type === "SET_AUDIENCE_QUESTION_VISIBILITY") {
      room.config.showQuestionOnAudience = intent.payload
        .showQuestion as boolean;
      this.commit(
        room,
        intent.type,
        capability.uid,
        intent.payload,
        receiptKey,
        receiptHash,
      );
      return {
        revision: room.revision,
        replayed: false,
        projection: this.project(room, capability),
      };
    }
    if (intent.type === "LOBBY_ADD_MANUAL_PLAYER") {
      const { displayName, team } = intent.payload;
      if (
        Object.keys(intent.payload).length !== 2 ||
        room.game.lifecycle !== "LOBBY" ||
        (team !== "horizontal" && team !== "vertical")
      )
        throw new Error("MANUAL_ADD_NOT_ALLOWED");
      if (this.participantCount(room) >= 16)
        throw new Error("PLAYER_CAPACITY_REACHED");
      const name = normalizePlayerDisplayName(displayName);
      if (!name) throw new Error('INVALID_DISPLAY_NAME');
      const matchesName = matchesPlayerName(name);
      if (room.members.some(member => member.role === 'player' && matchesName(member)) || (room.manualParticipants ?? []).some(matchesName))
        throw new Error('DUPLICATE_DISPLAY_NAME');
      const participant: ManualParticipant = {
        id: randomUUID(),
        displayName: name,
        team,
      };
      room.manualParticipants = [
        ...(room.manualParticipants ?? []),
        participant,
      ];
      this.commit(
        room,
        intent.type,
        capability.uid,
        { displayName: participant.displayName, team },
        receiptKey,
        receiptHash,
      );
      return {
        revision: room.revision,
        replayed: false,
        projection: this.project(room, capability),
      };
    }
    if (intent.type === "LOBBY_REMOVE_PARTICIPANT") {
      // A stale seat (closed tab, re-joined from another tab, dead phone) would otherwise keep the
      // lobby from ever starting, because every joined player must be ready.
      if (room.game.lifecycle !== "LOBBY") throw new Error("LOBBY_REMOVAL_NOT_ALLOWED");
      const { memberUid, manualParticipantId } = intent.payload;
      if (typeof memberUid === "string") {
        const target = room.members.find((member) => member.uid === memberUid);
        if (!target || target.role !== "player") throw new Error("LOBBY_REMOVAL_TARGET_INVALID");
        room.members = room.members.filter((member) => member.uid !== memberUid);
      } else {
        const before = room.manualParticipants ?? [];
        if (!before.some((participant) => participant.id === manualParticipantId)) throw new Error("LOBBY_REMOVAL_TARGET_INVALID");
        room.manualParticipants = before.filter((participant) => participant.id !== manualParticipantId);
      }
      this.commit(room, intent.type, capability.uid, intent.payload, receiptKey, receiptHash);
      return { revision: room.revision, replayed: false, projection: this.project(room, capability) };
    }
    if (intent.type === "LOBBY_ASSIGN_TEAM") {
      const { memberUid, manualParticipantId, team } = intent.payload;
      const hasMember = typeof memberUid === "string" && memberUid.length > 0;
      const hasManual =
        typeof manualParticipantId === "string" &&
        manualParticipantId.length > 0;
      if (
        Object.keys(intent.payload).length !== 2 ||
        hasMember === hasManual ||
        (team !== "horizontal" && team !== "vertical") ||
        !canManageTeamsInState(room.game.lifecycle)
      )
        throw new Error("LOBBY_ASSIGNMENT_NOT_ALLOWED");
      if (hasManual) {
        const target = (room.manualParticipants ?? []).find(
          (participant) => participant.id === manualParticipantId,
        );
        if (!target) throw new Error("LOBBY_ASSIGNMENT_TARGET_INVALID");
        target.team = team;
      } else {
        const target = room.members.find((member) => member.uid === memberUid);
        if (!target || target.role !== "player")
          throw new Error("LOBBY_ASSIGNMENT_TARGET_INVALID");
        if (target.team !== team) {
          target.team = team;
          if (room.game.lifecycle === "LOBBY") target.ready = false;
        }
      }
      this.commit(
        room,
        intent.type,
        capability.uid,
        intent.payload,
        receiptKey,
        receiptHash,
      );
      return {
        revision: room.revision,
        replayed: false,
        projection: this.project(room, capability),
      };
    }
    const before = structuredClone(room);
    try {
      if (intent.type === "START_MATCH") {
        const reason = this.startBlockedReason(room, intent.payload.withoutWaiting === true);
        if (reason) throw new Error(reason);
        await this.startBoard(room);
      } else await this.applyHostIntent(room, intent);
    } catch (error) {
      if (
        error instanceof Error &&
        /CONTENT_EXHAUSTED|NO_UNUSED_SURPRISE_LETTER|No unused question/.test(
          error.message,
        ) &&
        [
          "SELECT_CELL",
          "LETTER_REVEALED",
          "RETRY_CELL",
          "RETURN_CELL",
          "START_NEXT_ROUND",
        ].includes(intent.type)
      ) {
        this.restoreRoom(room, before);
        this.holdContent(
          room,
          intent.type === "START_NEXT_ROUND"
            ? "START_NEXT_ROUND"
            : intent.type === "SELECT_CELL" || intent.type === "LETTER_REVEALED"
              ? "SELECT_CELL"
              : "CONTINUE",
          intent.type === "SELECT_CELL"
            ? (intent.payload.cellId as string)
            : before.game.activeCellId,
        );
      } else {
        this.restoreRoom(room, before);
        throw error;
      }
    }
    this.commit(
      room,
      intent.type,
      capability.uid,
      intent.payload,
      receiptKey,
      receiptHash,
    );
    return {
      revision: room.revision,
      replayed: false,
      projection: this.project(room, capability),
    };
  }
  private async applyHostIntent(room: Room, intent: GameIntent): Promise<void> {
    const payload = intent.payload;
    if (room.challenge && !restoreChallengeState(room.challenge).continued)
      throw new Error("CHALLENGE_ACTIVE_LEGACY_INTENT_BLOCKED");
    // Older clients may still send OPEN_QUESTION. It remains harmless, but cannot
    // reset the timer which is now opened atomically with question visibility.
    if (intent.type === "OPEN_QUESTION") {
      if (room.game.lifecycle !== "QUESTION_READING")
        throw new Error("QUESTION_NOT_READY");
      if (
        !room.buzzOpen &&
        !room.deadlineAt &&
        !hasRevealedOccurrence(
          room.activeQuestionOccurrence,
          room.answerRevealedOccurrence,
        )
      )
        this.openQuestionBuzzer(room);
      return;
    }
    if (intent.type === "REVEAL_ANSWER") {
      const occurrence = String(payload.occurrence);
      if (!room.activeQuestion || !room.activeQuestionOccurrence || occurrence !== room.activeQuestionOccurrence)
        throw new Error("STALE_QUESTION_OCCURRENCE");
      if (!["QUESTION_READING", "FIRST_ANSWER", "OPPONENT_CHANCE", "QUESTION_FAILED", "PAUSED"].includes(room.game.lifecycle))
        throw new Error("REVEAL_ANSWER_NOT_ALLOWED");
      room.answerRevealedOccurrence = occurrence;
      room.buzzOpen = false;
      room.deadlineAt = undefined;
      room.pausedTimer = undefined;
      room.buzzWinner = undefined;
      return;
    }
    if (intent.type === "CLOSE_QUESTION") {
      // "Nobody answered": once the host stopped the timer (e.g. by revealing the answer) this is the
      // same outcome as the timer running out, without judging two teams wrong by hand.
      if (room.game.lifecycle !== "QUESTION_READING" && room.game.lifecycle !== "OPPONENT_CHANCE")
        throw new Error("CLOSE_QUESTION_NOT_ALLOWED");
      room.game = reduceGame(room.game, { type: "TIME_EXPIRED" });
      room.questionFailedReason = 'no-answer';
      room.answerFeedback = undefined;
      room.buzzOpen = false;
      room.deadlineAt = undefined;
      room.buzzWinner = undefined;
      return;
    }
    if (intent.type === "HOST_SELECT_TEAM") {
      const team = payload.team;
      if (
        Object.keys(payload).length !== 1 ||
        (team !== "horizontal" && team !== "vertical") ||
        (room.game.lifecycle !== "QUESTION_READING" &&
          room.game.lifecycle !== "OPPONENT_CHANCE") ||
        (room.game.lifecycle === "OPPONENT_CHANCE" &&
          room.game.entitledTeam !== team)
      )
        throw new Error("HOST_TEAM_SELECTION_NOT_ALLOWED");
      room.game = reduceGame(room.game, { type: "BUZZ_ACCEPTED", team });
      room.buzzOpen = false;
      room.deadlineAt = undefined;
      room.buzzWinner = {
        displayName: room.config.teams[team],
        team,
        method: "host",
      };
      return;
    }
    if (intent.type === "PAUSE") {
      const canPreserveTimer =
        room.buzzOpen &&
        room.deadlineAt &&
        (room.game.lifecycle === "QUESTION_READING" ||
          room.game.lifecycle === "OPPONENT_CHANCE");
      room.pausedTimer = canPreserveTimer
        ? {
            remainingMs: Math.max(
              0,
              Date.parse(room.deadlineAt!) - this.clock().getTime(),
            ),
            buzzOpen: true,
          }
        : undefined;
      room.game = reduceGame(room.game, { type: "PAUSE" });
      room.buzzOpen = false;
      room.deadlineAt = undefined;
      return;
    }
    if (intent.type === "RESUME") {
      room.game = reduceGame(room.game, { type: "RESUME" });
      const pausedTimer = room.pausedTimer;
      room.pausedTimer = undefined;
      if (
        pausedTimer &&
        !hasRevealedOccurrence(
          room.activeQuestionOccurrence,
          room.answerRevealedOccurrence,
        ) &&
        (room.game.lifecycle === "QUESTION_READING" ||
          room.game.lifecycle === "OPPONENT_CHANCE")
      ) {
        room.buzzOpen = pausedTimer.buzzOpen;
        room.deadlineAt = pausedTimer.buzzOpen
          ? new Date(
              this.clock().getTime() + pausedTimer.remainingMs,
            ).toISOString()
          : undefined;
      }
      return;
    }
    if (intent.type === "START_NEXT_ROUND") {
      await this.startBoard(room, true);
      return;
    }
    if (intent.type === "END_WITHOUT_WINNER") {
      if (room.game.lifecycle !== "PAUSED" && (room.game.lifecycle !== 'QUESTION_FAILED' || room.game.contentHold))
        throw new Error("END_WITHOUT_WINNER_NOT_ALLOWED");
      room.game = {
        ...room.game,
        lifecycle: "MATCH_COMPLETE",
        answeringTeam: undefined,
        activeCellId: undefined,
        contentHold: undefined,
        endedWithoutWinner: true,
      };
      room.activeQuestion = undefined;
      room.activeQuestionOccurrence = undefined;
      room.answerRevealedOccurrence = undefined;
      room.buzzOpen = false;
      room.deadlineAt = undefined;
      room.buzzWinner = undefined;
      room.answerFeedback = undefined;
      room.questionFailedReason = undefined;
      return;
    }
    if (
      (intent.type === "RETRY_CELL" || intent.type === "RETURN_CELL") &&
      room.game.lifecycle === "QUESTION_FAILED"
    ) {
      if (room.config.gameKind === "categories")
        await this.replaceFailedCategory(room);
      else if (
        room.game.board?.cells.find(
          (cell) => cell.id === room.game.activeCellId,
        )?.kind === "surprise"
      )
        await this.replaceFailedSurprise(room);
      room.game = reduceGame(room.game, { type: "RETURN_CELL" });
      room.activeQuestion = undefined;
      room.activeQuestionOccurrence = undefined;
      room.answerRevealedOccurrence = undefined;
      room.questionFailedReason = undefined;
      return;
    }
    if (intent.type === "SELECT_CELL") {
      if (room.challenge && restoreChallengeState(room.challenge).continued) {
        room.challenge = undefined;
        room.challengeBridge = undefined;
      }
      room.game = reduceGame(room.game, {
        type: "SELECT_CELL",
        cellId: String(payload.cellId),
      });
      // Selecting a cell defines a new question boundary; it must never inherit
      // a previous prompt before the atomic reveal below.
      room.activeQuestion = undefined;
      room.answerFeedback = undefined;
      room.questionFailedReason = undefined;
      await this.revealActiveCell(room);
      return;
    }
    if (intent.type === "LETTER_REVEALED") {
      await this.revealActiveCell(room);
      return;
    }
    // A saved ROUND_SETUP still transitions normally. Older clients may send this
    // once just after an automatically prepared round has entered CELL_SELECTION.
    if (intent.type === 'ROUND_READY' && room.game.lifecycle === 'CELL_SELECTION') return;
    const events: Partial<Record<
      Exclude<
        GameIntent["type"],
        | "LOBBY_SET_READY"
        | "LOBBY_ASSIGN_TEAM"
        | "LOBBY_ADD_MANUAL_PLAYER"
        | "LOBBY_REMOVE_PARTICIPANT"
        | "CLOSE_QUESTION"
        | "START_MATCH"
        | "START_NEXT_ROUND"
        | "BUZZ"
        | "HOST_SELECT_TEAM"
        | "OPEN_QUESTION"
        | "LETTER_REVEALED"
        | "PAUSE"
        | "RESUME"
        | "SELECT_CELL"
        | "SET_AUDIENCE_QUESTION_VISIBILITY"
        | "REVEAL_ANSWER"
        | "END_WITHOUT_WINNER"
    >,
      () => GameEvent
    >> = {
      ROUND_READY: () => ({ type: "ROUND_READY" }),
      JUDGE_CORRECT: () => ({ type: "JUDGE_CORRECT" }),
      JUDGE_INCORRECT: () => ({ type: "JUDGE_INCORRECT" }),
      RETRY_CELL: () => ({ type: "RETRY_CELL" }),
      RETURN_CELL: () => ({ type: "RETURN_CELL" }),
      AWARD_CELL: () => ({ type: "AWARD_CELL" }),
      CHECK_PATH: () => ({ type: "CHECK_PATH" }),
      BEGIN_CORRECTION: () => {
        const reason = String(payload.reason ?? "").trim();
        if (!reason) throw new Error("CORRECTION_REASON_REQUIRED");
        return {
          type: "BEGIN_CORRECTION",
          cellId: String(payload.cellId),
          owner:
            payload.owner === "horizontal" || payload.owner === "vertical"
              ? payload.owner
              : undefined,
          reason,
        };
      },
      CONFIRM_CORRECTION: () => ({ type: "CONFIRM_CORRECTION" }),
      CANCEL_CORRECTION: () => ({ type: "CANCEL_CORRECTION" }),
    };
    const event = events[intent.type as keyof typeof events]?.();
    if (!event) throw new Error("UNKNOWN_INTENT");
    room.game = reduceGame(room.game, event);
    if (intent.type === 'JUDGE_CORRECT' || intent.type === 'JUDGE_INCORRECT') {
      room.answerFeedback = intent.type === 'JUDGE_CORRECT'
        ? { outcome: 'correct', team: room.game.answeringTeam, expiresAt: new Date(this.clock().getTime() + 3_000).toISOString() }
        : room.game.lifecycle === 'OPPONENT_CHANCE'
          ? { outcome: 'incorrect', expiresAt: new Date(this.clock().getTime() + 3_000).toISOString() }
          : undefined;
      room.questionFailedReason = room.game.lifecycle === 'QUESTION_FAILED' ? 'incorrect' : undefined;
      room.buzzWinner = undefined;
    }
    if (intent.type === "JUDGE_CORRECT") this.finalizeCorrectAnswer(room);
    // Older clients can still submit this once from CELL_AWARDED. Finish its
    // path check here so a deployed UI never leaves a room at an action it no
    // longer renders.
    if (intent.type === "AWARD_CELL") {
      room.game = reduceGame(room.game, { type: "CHECK_PATH" });
      room.buzzWinner = undefined;
    }
    if (["JUDGE_CORRECT", "JUDGE_INCORRECT"].includes(intent.type)) {
      room.buzzOpen = false;
      room.deadlineAt = undefined;
    }
    if (
      intent.type === "JUDGE_INCORRECT" &&
      !hasRevealedOccurrence(
        room.activeQuestionOccurrence,
        room.answerRevealedOccurrence,
      ) &&
      room.game.lifecycle === "OPPONENT_CHANCE"
    ) {
      room.buzzOpen = true;
      room.deadlineAt = new Date(
        this.clock().getTime() + room.config.opponentSeconds * 1000,
      ).toISOString();
      room.buzzWinner = undefined;
    }
    if (intent.type === 'RETRY_CELL') {
      room.answerFeedback = undefined;
      room.questionFailedReason = undefined;
    }
    if (
      intent.type === "RETRY_CELL" &&
      !hasRevealedOccurrence(
        room.activeQuestionOccurrence,
        room.answerRevealedOccurrence,
      )
    )
      this.openQuestionBuzzer(room);
  }
  /** Award and path evaluation are one authoritative consequence of a correct judgment. */
  private finalizeCorrectAnswer(room: Room): void {
    if (room.config.modality === "charades") {
      const winner = room.game.answeringTeam!;
      const version =
        room.game.roundOutcomeHistory
          .filter((entry) => entry.round === room.game.currentRound)
          .reduce((latest, entry) => Math.max(latest, entry.version), 0) + 1;
      room.game = {
        ...room.game,
        lifecycle: "ROUND_COMPLETE",
        questionScores: {
          ...room.game.questionScores,
          [winner]: room.game.questionScores[winner] + 1,
        },
        roundOutcomeHistory: [
          ...room.game.roundOutcomeHistory,
          { round: room.game.currentRound, version, winner },
        ],
        answeringTeam: undefined,
        activeCellId: undefined,
      };
      return;
    }
    room.game = reduceGame(room.game, { type: "AWARD_CELL" });
    room.game = reduceGame(room.game, { type: "CHECK_PATH" });
  }
  /** Keeps old LETTER_REVEAL rooms recoverable while new SELECT_CELL intents reveal atomically. */
  private async revealActiveCell(room: Room): Promise<void> {
    const cell = room.game.board?.cells.find(
      (value) => value.id === room.game.activeCellId,
    );
    const questionMustBeSelectedNow =
      !room.activeQuestion ||
      (cell?.kind === "surprise" && !cell.revealedLetter);
    if (cell?.kind === "surprise" && !cell.revealedLetter) {
      const letter = room.surpriseLetters.shift();
      if (!letter) throw new Error("NO_UNUSED_SURPRISE_LETTER");
      room.game = {
        ...room.game,
        board: revealSurprise(room.game.board!, cell.id, letter),
      };
    }
    room.game = reduceGame(room.game, { type: "LETTER_REVEALED" });
    if (questionMustBeSelectedNow) await this.assignQuestion(room);
    if (room.activeQuestion?.challenge) {
      this.activateChallenge(room);
      return;
    }
    if (
      !hasRevealedOccurrence(
        room.activeQuestionOccurrence,
        room.answerRevealedOccurrence,
      )
    )
      this.openQuestionBuzzer(room);
  }
  private async assignQuestion(room: Room): Promise<void> {
    const questions = await this.effectiveQuestions(room);
    const cell = room.game.board?.cells.find(
      (value) => value.id === room.game.activeCellId,
    );
    if (!cell || !room.questionSelection)
      throw new Error("QUESTION_SELECTION_NOT_INITIALIZED");
    const selected = this.isChallengeSelection(room.questionSelection)
      ? (() => {
          const challengeQuestions = questions.filter((question) => question.modality !== "charades" && (!question.challenge || room.config.challenge!.mechanics.includes(question.challenge.kind)));
          const promoted = promoteReservedChallengeQuestion(challengeQuestions, room.questionSelection, cell.id);
          if (promoted) return promoted;
          const slot = room.questionSelection.challengeBoardSlots.find((candidate) => candidate.slotId === `board:${room.boardSequence - 1}:${cell.id}`);
          if (!slot) throw new Error("CHALLENGE_SLOT_MISSING");
          return selectChallengeCategoryQuestion(challengeQuestions, room.questionSelection, slot, this.challengeRemainingSlots(room.questionSelection, slot.slotId));
        })()
      : (() => {
          const promoted = promoteReservedQuestion(questions, room.questionSelection!, cell.id);
          return promoted ?? (room.config.gameKind === "categories" ? selectCategoryQuestion(questions, room.questionSelection!, cell.categoryId ?? "") : selectMatchQuestion(questions, room.questionSelection!, cell.revealedLetter ?? cell.visibleValue ?? ""));
        })();
    room.activeQuestion = selected.question as StoredQuestion;
    room.activeQuestionOccurrence = `${room.boardSequence}:${cell.id}:${selected.question.id}`;
    room.answerRevealedOccurrence = undefined;
    room.questionSelection = selected.selection;
  }
  private async replaceFailedCategory(room: Room): Promise<void> {
    const cell = room.game.board?.cells.find(
      (value) => value.id === room.game.activeCellId,
    );
    if (!cell?.categoryId || !room.questionSelection || !room.game.board)
      throw new Error("CONTENT_EXHAUSTED");
    const questions = await this.effectiveQuestions(room);
    const alternatives = room.config.categories
      .filter((id) => id !== cell.categoryId)
      .sort();
    let selected: { question: RuntimeQuestionV32; selection: MatchQuestionSelection | ChallengeCategoryQuestionSelection } | undefined;
    for (const categoryId of alternatives)
      try {
        if (this.isChallengeSelection(room.questionSelection)) {
          const challengeQuestions = questions.filter((question) => question.modality !== "charades" && (!question.challenge || room.config.challenge!.mechanics.includes(question.challenge.kind)));
          let challengeSelection = room.questionSelection;
          let slot = challengeSelection.challengeReserveSlots.find((candidate) => candidate.categoryId === categoryId && !challengeSelection.challengeCompletedSlotIds.includes(candidate.slotId) && !Object.values(challengeSelection.challengeSlotForCell).includes(candidate.slotId));
          if (!slot) { slot = { slotId: `replacement:${room.boardSequence}:${cell.id}:${categoryId}:${challengeSelection.challengeReserveSlots.length}`, categoryId }; challengeSelection = addChallengeReplacementReserve(challengeQuestions, challengeSelection, slot); }
          selected = reserveChallengeQuestionForCell(challengeQuestions, challengeSelection, slot, this.challengeRemainingSlots(challengeSelection, slot.slotId), cell.id);
        } else selected = reserveQuestionForCell(questions, room.questionSelection, categoryId, cell.id);
        break;
      } catch { /* try next eligible category */ }
    if (!selected) throw new Error("CONTENT_EXHAUSTED");
    const label = room.config.categorySnapshot?.find(
      (item) => item.id === selected.question.categoryId,
    )?.labelAr;
    if (!label) throw new Error("CATEGORY_SNAPSHOT_INVALID");
    const occurrence =
      (room.categoryOccurrences?.[selected.question.categoryId] ?? 0) + 1;
    room.questionSelection = selected.selection;
    room.categoryOccurrences = {
      ...(room.categoryOccurrences ?? {}),
      [selected.question.categoryId]: occurrence,
    };
    room.game = {
      ...room.game,
      board: {
        ...room.game.board,
        cells: room.game.board.cells.map((item) =>
          item.id === cell.id
            ? {
                ...item,
                categoryId: selected!.question.categoryId,
                categoryLabelAr: label,
                categoryOccurrence: occurrence,
                visibleValue: String(occurrence),
              }
            : item,
        ),
      },
    };
  }
  private async replaceFailedSurprise(room: Room): Promise<void> {
    const cell = room.game.board?.cells.find(
      (value) => value.id === room.game.activeCellId,
    );
    if (
      !cell ||
      cell.kind !== "surprise" ||
      !room.questionSelection ||
      !room.game.board
    )
      throw new Error("CONTENT_EXHAUSTED");
    const questions = await this.effectiveQuestions(room);
    const used = new Set(
      room.game.board.cells.flatMap((item) =>
        item.kind === "letter"
          ? [item.visibleValue]
          : item.revealedLetter
            ? [item.revealedLetter]
            : [],
      ),
    );
    // Letters still hidden behind other surprise cells are used too: prefer anything else, and if
    // one must be taken, withdraw it from the pending pool so it can never appear twice.
    const pending = new Set(room.surpriseLetters);
    const available = Object.keys(room.questionSelection.queues)
      .filter((letter) => letter !== cell.revealedLetter && !used.has(letter))
      .sort();
    const candidates = [
      ...available.filter((letter) => !pending.has(letter)),
      ...available.filter((letter) => pending.has(letter)),
    ];
    let selected: ReturnType<typeof reserveQuestionForCell> | undefined;
    let letter: string | undefined;
    for (const candidate of candidates)
      try {
        selected = reserveQuestionForCell(
          questions,
          room.questionSelection,
          candidate,
          cell.id,
        );
        letter = candidate;
        break;
      } catch {
        /* retain explicit exhaustion state */
      }
    if (!selected || !letter) throw new Error("CONTENT_EXHAUSTED");
    const chosen = letter;
    if (pending.has(chosen)) room.surpriseLetters = room.surpriseLetters.filter((value) => value !== chosen);
    room.questionSelection = selected.selection;
    room.game = {
      ...room.game,
      board: {
        ...room.game.board,
        cells: room.game.board.cells.map((item) =>
          item.id === cell.id ? { ...item, revealedLetter: letter } : item,
        ),
      },
    };
  }
  questionInventory() {
    return this.localQuestionInventory ??= this.projectQuestionInventory();
  }
  questionCoverage(gameKind: "huroof" | "categories", categoryIds: string[], challengeEnabled: boolean, mapPresentation: MapPresentation) {
    const source = this.localFirestoreQuestionSource;
    if (!source) return undefined;
    const categories = canonicalizeCategoryIds(categoryIds, CURRENT_CATEGORY_PROJECTION).sort();
    if (!categories.length) return false;
    try {
      this.validateRoomQuestionScope(true, categories, "classic", gameKind, {
        mapPresentation,
        challenge: challengeEnabled ? CLIENT_CHALLENGE_CAPABILITY : undefined,
      }, source.questions as StoredQuestion[], CURRENT_CATEGORY_PROJECTION);
      return true;
    } catch (error) {
      if (error instanceof Error && [
        "CATEGORY_GAME_COMBINATION_INVALID", "QUESTION_SCOPE_INSUFFICIENT_COVERAGE",
        "CHALLENGE_PROTOCOL_REQUIRED", "CHALLENGE_MECHANICS_DISABLED", "CHALLENGE_DEFINITION_SCHEMA_UNSUPPORTED",
      ].includes(error.message)) return false;
      throw error;
    }
  }
  private projectQuestionInventory() {
    const inventory = this.localFirestoreQuestionSource?.inventory;
    if (!inventory) return undefined;
    const grouped = new Map<string, typeof inventory.categories>();
    for (const category of inventory.categories) {
      const id = canonicalCategoryId(category.id, CURRENT_CATEGORY_PROJECTION);
      grouped.set(id, [...(grouped.get(id) ?? []), category]);
    }
    return {
      source: inventory.source,
      huroofAvailable: inventory.huroofAvailable,
      recommendedHuroofCategoryIds: inventory.recommendedHuroofCategoryIds && canonicalizeCategoryIds(inventory.recommendedHuroofCategoryIds, CURRENT_CATEGORY_PROJECTION),
      categories: [...grouped].map(([id, members]) => {
        const base = members.find((item) => item.id === id) ?? members[0];
        if (id !== "tahadani-047" && id !== "tahadani-019") return {
          id: base.id, labelAr: base.labelAr, sourceOnly: base.sourceOnly,
          questionCount: base.questionCount, sourceQuestionCount: base.sourceQuestionCount,
          unavailableReason: base.unavailableReason, heldQuestionCount: base.heldQuestionCount,
          huroofQuestionCount: base.huroofQuestionCount, categoryGameEligible: base.categoryGameEligible,
          availability: base.availability,
        };
        const records = this.localFirestoreQuestionSource!.questions.filter((question) => canonicalCategoryId(question.categoryId, CURRENT_CATEGORY_PROJECTION) === id);
        const uniqueConcepts = new Set(records.filter((question) => question.modality !== "charades").map((question) => question.answerConceptId)).size;
        const distinctCards = id === "tahadani-019"
          ? new Set(records.map((question) => question.modality === "charades" ? `mime:${question.canonicalAnswer.normalize("NFKC").replace(/[\u064b-\u065f\u0640]/gu, "").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ar")}` : `concept:${question.answerConceptId}`)).size
          : records.length;
        const eligible = uniqueConcepts >= 14;
        return {
          id,
          labelAr: id === "tahadani-047" ? "عملات" : id === "tahadani-019" ? "كرتون / ولا كلمة" : base.labelAr,
          sourceOnly: members.every((item) => item.sourceOnly),
          questionCount: distinctCards,
          sourceQuestionCount: members.reduce((sum, item) => sum + (item.sourceQuestionCount ?? item.questionCount), 0),
          unavailableReason: eligible ? undefined : base.unavailableReason,
          heldQuestionCount: members.reduce((sum, item) => sum + item.heldQuestionCount, 0),
          huroofQuestionCount: records.filter((question) => question.modality === "classic" && Boolean(question.targetLetter)).length,
          categoryGameEligible: eligible,
          availability: eligible ? "ready" : records.length ? "insufficient_questions" : "held_only",
        };
      }),
    };
  }
  private firestoreQuestions(snapshot?: string): StoredQuestion[] {
    const source = snapshot
      ? this.localQuestionSourcesBySnapshot.get(snapshot)
      : undefined;
    if (!source)
      throw new Error("QUESTION_SOURCE_SNAPSHOT_UNAVAILABLE");
    return source.questions as StoredQuestion[];
  }
  private async fileQuestions(demo: boolean): Promise<StoredQuestion[]> {
    const file = demo
      ? join(process.cwd(), "content", "questions", "drafts", "questions.jsonl")
      : join(
          process.cwd(),
          "content",
          "questions",
          "approved",
          "questions.jsonl",
        );
    const content = await readFile(file, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const question = JSON.parse(line) as Partial<StoredQuestion>;
        return {
          ...question,
          modality: question.modality ?? "classic",
          answerConceptId: question.answerConceptId ?? `legacy:${question.id}`,
        } as StoredQuestion;
      })
      .filter((question) => demo || question.status === "approved");
  }
  private async questions(
    demo: boolean,
    snapshot?: string,
  ): Promise<StoredQuestion[]> {
    if (snapshot) return this.firestoreQuestions(snapshot);
    if (demo && this.localFirestoreQuestionSource)
      return this.firestoreQuestions(
        this.localFirestoreQuestionSource.snapshotId,
      );
    return this.fileQuestions(demo);
  }
  /**
   * The same sidecar materializer runs before every board allocation and
   * replacement.  It preserves ordinary delivery while denying original map
   * prompt/media fields to interactive candidates.
   */
  private async effectiveQuestions(room: Room): Promise<StoredQuestion[]> {
    const sourceQuestions = await this.questions(room.demo, room.questionSourceSnapshot);
    const questions=room.localRematch?this.excludePriorQuestions(sourceQuestions,room.localRematch):sourceQuestions;
    const materialized = !this.mapVariants.length ? questions : materializeMapPresentation(
      questions,
      room.config.mapPresentation ?? "ordinary",
      this.mapVariants,
      (question) => createHash("sha256").update(canonicalChallengeJson(question)).digest("hex"),
      (binding) => this.challengeDefinitions.resolve(binding.definition),
    ) as StoredQuestion[];
    return this.questionsForRoom(materialized, room.config.challenge);
  }
  /** A room without negotiated challenge capability is an ordinary room, even
   * when one selected category has both ordinary and challenge children. */
  private questionsForRoom(
    questions: readonly StoredQuestion[],
    challenge: ChallengeCapabilityOffer | undefined,
  ): StoredQuestion[] {
    return !challenge
      ? questions.filter((question) => !question.challenge)
      : questions.filter((question) => !question.challenge || challenge.mechanics.includes(question.challenge.kind));
  }
  private questionsSync(demo: boolean, snapshot?: string): StoredQuestion[] {
    if (snapshot) return this.firestoreQuestions(snapshot);
    if (demo && this.localFirestoreQuestionSource)
      return this.firestoreQuestions(
        snapshot ?? this.localFirestoreQuestionSource.snapshotId,
      );
    const file = demo
      ? join(process.cwd(), "content", "questions", "drafts", "questions.jsonl")
      : join(
          process.cwd(),
          "content",
          "questions",
          "approved",
          "questions.jsonl",
        );
    try {
      return readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const question = JSON.parse(line) as Partial<StoredQuestion>;
          return {
            ...question,
            modality: question.modality ?? "classic",
            answerConceptId:
              question.answerConceptId ?? `legacy:${question.id}`,
          } as StoredQuestion;
        })
        .filter((question) => demo || question.status === "approved");
    } catch {
      return [];
    }
  }
  private validateRoomQuestionScope(
    demo: boolean,
    categories: string[],
    modality: MatchConfig["modality"],
    gameKind: NonNullable<MatchConfig["gameKind"]>,
    { challenge, mapPresentation }: Pick<CreateMatchConfig, "challenge" | "mapPresentation">,
    questions: StoredQuestion[],
    categoryProjectionVersion?: CategoryProjectionVersion,
  ): ChallengeCapabilityOffer | undefined {
    if (gameKind === "categories" && (categories.length < 2 || categories.length > 10 || modality !== "classic"))
      throw new Error("CATEGORY_GAME_COMBINATION_INVALID");
    if (mapPresentation !== undefined && mapPresentation !== "ordinary" && mapPresentation !== "interactive")
      throw new Error("MAP_PRESENTATION_INVALID");
    if (challenge !== undefined) {
      const mechanics = challenge && typeof challenge === "object" ? challenge.mechanics : undefined;
      const definitionSchemas = challenge && typeof challenge === "object" && challenge.definitionSchemas !== undefined ? challenge.definitionSchemas : ["t36-challenge-definition-v1"];
      if (
        !challenge ||
        challenge.protocolVersion !== "t36-challenge-runtime-v1" ||
        !Array.isArray(mechanics) ||
        !mechanics.length ||
        mechanics.length > 5 ||
        new Set(mechanics).size !== mechanics.length ||
        mechanics.some((mechanic) => !["navigation", "missing_tile", "memory", "qatar_map", "word_search"].includes(mechanic)) ||
        !Array.isArray(definitionSchemas) || !definitionSchemas.length || definitionSchemas.length > 3 || new Set(definitionSchemas).size !== definitionSchemas.length || definitionSchemas.some((schema) => schema !== "t36-challenge-definition-v1" && schema !== "t37-clean70-challenge-definition-v1" && schema !== "t37-topup-word-search-definition-v1")
      ) throw new Error("CHALLENGE_PROTOCOL_UNSUPPORTED");
    }
    // Validate every selected challenge row when negotiating the protocol.
    const categorySet = new Set(categories);
    const scopedQuestions = questions.filter((question) =>
      (challenge || !question.challenge) && categorySet.has(canonicalCategoryId(question.categoryId, categoryProjectionVersion)),
    );
    const challengeQuestions = scopedQuestions.filter((question) => question.modality === modality && question.challenge);
    const scopedChallengeKinds = [...new Set([
      ...challengeQuestions.map((question) => question.challenge!.kind),
      ...(mapPresentation === "interactive" && categorySet.has("tahadani-games-326") ? ["qatar_map" as const] : []),
    ])];
    const scopedDefinitionSchemas = [...new Set(challengeQuestions.map((question) => question.challenge!.definition.schemaVersion))];
    if (scopedChallengeKinds.length && !challenge) throw new Error("CHALLENGE_PROTOCOL_REQUIRED");
    if (scopedChallengeKinds.length && (!challenge || gameKind !== "categories" || !this.hasInjectedChallengeDefinitions() || !scopedChallengeKinds.every((mechanic) => challenge.mechanics.includes(mechanic)) || !scopedChallengeKinds.every((mechanic) => this.enabledChallengeMechanics.has(mechanic)) || (mapPresentation === "interactive" && !this.mapVariants.length)))
      throw new Error("CHALLENGE_MECHANICS_DISABLED");
    if (scopedDefinitionSchemas.length && (!challenge || !scopedDefinitionSchemas.every((schema) => (challenge.definitionSchemas ?? ["t36-challenge-definition-v1"]).includes(schema)))) throw new Error("CHALLENGE_DEFINITION_SCHEMA_UNSUPPORTED");

    this.requirePlayableQuestionScope(demo, categories, modality, gameKind, scopedQuestions, categoryProjectionVersion);
    if (challenge && scopedChallengeKinds.length) return {
      protocolVersion: challenge.protocolVersion,
      mechanics: scopedChallengeKinds,
      definitionSchemas: scopedDefinitionSchemas.sort(),
    };
    return undefined;
  }
  /** Reject an unusable category scope before it can create a lobby that will fail on start. */
  private requirePlayableQuestionScope(
    demo: boolean,
    categories: string[],
    modality: MatchConfig["modality"],
    gameKind: MatchConfig["gameKind"] = "huroof",
    questions = this.questionsSync(demo),
    categoryProjectionVersion?: CategoryProjectionVersion,
  ): void {
    if (modality === "charades") return;
    try {
      if (gameKind === "categories")
        createCategoryQuestionSelection(questions, {
          categories,
          categoryProjectionVersion,
          modality: "classic",
          seed: 0,
        });
      else
        createMatchQuestionSelection(questions, {
          categories,
          categoryProjectionVersion,
          modality,
          seed: 0,
          reservePerLetter: demo ? 1 : 3,
        });
    } catch (reason) {
      if (
        reason instanceof Error &&
        /^(?:Insufficient (?:16 visible \+ 9 surprise letter coverage|concept reserve)|Category .* has insufficient unique concepts|Category scope has overlapping concepts)/.test(
          reason.message,
        )
      )
        throw new Error("QUESTION_SCOPE_INSUFFICIENT_COVERAGE");
      throw reason;
    }
  }
  private startBlockedReason(room: Room, withoutWaiting = false): string | undefined {
    if (!room.demo && !this.questionsSync(false).length)
      return "NO_APPROVED_QUESTION_STOCK";
    const players = room.members.filter((member) => member.role === "player" && (!withoutWaiting || member.ready));
    const manual = room.manualParticipants ?? [];
    const teams = [
      ...players.map((member) => member.team),
      ...manual.map((participant) => participant.team),
    ];
    if (!teams.length && !withoutWaiting) return undefined;
    if (
      teams.length < 2 ||
      !teams.includes("horizontal") ||
      !teams.includes("vertical")
    )
      return "LOBBY_NEEDS_TWO_TEAMS";
    if (players.some((member) => !member.ready))
      return "LOBBY_ALL_MEMBERS_MUST_BE_READY";
    return undefined;
  }
  private participantCount(room: Room) {
    return (
      room.members.filter((member) => member.role === "player").length +
      (room.manualParticipants?.length ?? 0)
    );
  }
  private memberTeam(room: Room): TeamAxis {
    const horizontal =
      room.members.filter(
        (member) => member.role === "player" && member.team === "horizontal",
      ).length +
      (room.manualParticipants ?? []).filter(
        (participant) => participant.team === "horizontal",
      ).length;
    const vertical = this.participantCount(room) - horizontal;
    return horizontal <= vertical ? "horizontal" : "vertical";
  }
  /** Local-admin boundary: answer-bearing drafts are read by the server, never bundled into Vite. */
  async adminQuestions(): Promise<StoredQuestion[]> {
    return [...this.store.adminDrafts(), ...(await this.fileQuestions(true))];
  }
  async adminQuestion(id: string): Promise<StoredQuestion | undefined> {
    return (await this.adminQuestions()).find((question) => question.id === id);
  }
  /** Imported intake records have a dedicated private review route and never flow through legacy admin APIs. */
  async legacyAdminQuestions(): Promise<StoredQuestion[]> {
    return (await this.adminQuestions()).filter(
      (question) => !("importSource" in question),
    );
  }
  async legacyAdminQuestion(id: string): Promise<StoredQuestion | undefined> {
    return (await this.legacyAdminQuestions()).find(
      (question) => question.id === id,
    );
  }
  saveAdminDraft(input: Record<string, unknown>): {
    id: string;
    status: "draft";
  } {
    const id =
      typeof input.id === "string" && input.id
        ? input.id
        : `local-${randomUUID()}`;
    const existing = this.store
      .adminDrafts()
      .find((question) => question.id === id);
    // Imported T16 rows are immutable intake evidence. Ordinary local drafts retain
    // their existing write behavior, but a client cannot turn this convention off.
    if (existing?.readOnly === true)
      throw new Error("IMPORTED_DRAFT_READ_ONLY");
    const draft = { ...input, id, status: "draft", updatedAt: this.now() };
    this.store.saveAdminDraft(id, draft, this.now());
    return { id, status: "draft" };
  }
  private require(capability: Capability, role: ClientRole): void {
    if (capability.role !== role) throw new Error("FORBIDDEN_ROLE");
  }
  private commit(
    room: Room,
    type: string,
    actor: string,
    payload: unknown,
    intentId?: string,
    intentHash?: string,
    joinReceipt?: JoinReceipt,
  ): void {
    room.revision++;
    const audit = {
      revision: room.revision,
      type,
      at: this.now(),
      actor,
      payload,
    };
    room.audit = [...room.audit.slice(-99), audit];
    const divider = intentId?.indexOf("\u0000") ?? -1;
    this.store.commit(room, audit, audit.at, divider > 0 && intentHash
      ? { actorUid: intentId!.slice(0, divider), intentId: intentId!.slice(divider + 1), requestHash: intentHash }
      : undefined, joinReceipt);
  }
  /** Restore an in-place transaction snapshot, including optional fields absent before a rejected mutation. */
  private restoreRoom(room: Room, before: Room): void {
    const target = room as unknown as Record<string, unknown>;
    for (const key of Object.keys(target)) if (!(key in before)) delete target[key];
    Object.assign(room, before);
  }
  project(room: Room, capability: Capability): ProjectionEnvelope {
    const member = room.members.find((value) => value.uid === capability.uid);
    const isHost = capability.role === "host";
    const now = this.clock();
    const buzzWinner = room.game.lifecycle === 'FIRST_ANSWER' || room.game.lifecycle === 'OPPONENT_CHANCE' ? room.buzzWinner : undefined;
    const questionVisible =
      room.game.lifecycle === "QUESTION_READING" ||
      room.game.lifecycle === "FIRST_ANSWER" ||
      room.game.lifecycle === "OPPONENT_CHANCE" ||
      room.game.lifecycle === "QUESTION_FAILED";
    const startBlockedReason =
      room.game.lifecycle === "LOBBY"
        ? this.startBlockedReason(room)
        : undefined;
    const match = deriveMatch(room.game);
    const matchRule =
      room.ruleSet === "v2"
        ? {
            ruleSet: "v2" as const,
            victoryAr:
              "تنتهي المباراة بفوز فريق بجولتين متتاليتين أو بثلاث جولات إجمالاً",
          }
        : {
            ruleSet: "legacy-v1" as const,
            victoryAr: "غرفة قديمة محفوظة بقواعدها السابقة",
          };
    const manualParticipants = room.manualParticipants ?? [];
    const displayedMembers = [
      ...room.members.map(({ uid, displayName, team, ready, role }) => ({
        seatId: publicSeatId(room.id, uid),
        displayName,
        team,
        ready,
        role,
        ...(isHost ? { uid } : {}),
      })),
      ...manualParticipants.map((participant) => ({
        seatId: publicSeatId(room.id, participant.id),
        displayName: participant.displayName,
        team: participant.team,
        ready: true,
        role: "player" as const,
        participation: "manual" as const,
        ...(isHost ? { manualParticipantId: participant.id } : {}),
      })),
    ];
    const projection: SafeProjection & Record<string, unknown> = {
      room: {
        roomCode: room.code,
        ...(room.successor ? { successor: room.successor } : {}),
        state: room.game.lifecycle,
        readyCount:
          room.members.filter((value) => value.role === "player" && value.ready)
            .length + manualParticipants.length,
        memberCount: this.participantCount(room),
        teams: room.config.teams,
        members: displayedMembers,
        matchSettings: {
          demo: room.demo,
          gameKind: room.config.gameKind ?? "huroof",
          questionSeconds: room.config.questionSeconds,
          opponentSeconds: room.config.opponentSeconds,
          teams: room.config.teams,
          categories: room.config.categories,
          modality: room.config.modality,
          difficulty: room.config.difficulty,
          mode: room.config.mode,
          showQuestionOnAudience: room.config.showQuestionOnAudience !== false,
          labelledColours: room.config.labelledColours === true,
          ...(room.config.challenge ? { challenge: room.config.challenge } : {}),
        },
        audienceQuestionVisible: room.config.showQuestionOnAudience !== false,
        canStart: !startBlockedReason,
        ...(startBlockedReason === "LOBBY_ALL_MEMBERS_MUST_BE_READY" && !this.startBlockedReason(room, true) ? { canStartWithoutWaiting: true } : {}),
        ...(startBlockedReason ? { startBlockedReason } : {}),
      },
      ...(room.demo ? { demo: true as const } : {}),
      matchRule,
      board: room.game.board?.cells.map((cell) => ({
        id: cell.id,
        q: cell.q,
        r: cell.r,
        kind: cell.kind,
        visibleValue: cell.visibleValue,
        ...(cell.categoryId ? { categoryId: cell.categoryId } : {}),
        ...(cell.categoryLabelAr
          ? { categoryLabelAr: cell.categoryLabelAr }
          : {}),
        ...(cell.categoryOccurrence
          ? { categoryOccurrence: cell.categoryOccurrence }
          : {}),
        ...(cell.revealedLetter ? { revealedLetter: cell.revealedLetter } : {}),
        ...(cell.owner ? { owner: cell.owner } : {}),
      })),
      activeCellId: room.game.activeCellId,
      currentRound: room.game.currentRound,
      questionScores: room.game.questionScores,
      roundWins: match.roundWins,
      currentStreak: match.currentStreak,
      roundResults: match.roundResults.map(({ round, winner }) => ({
        round,
        winner,
      })),
      ...(room.game.contentHold
        ? {
            contentHold: {
              reason: room.game.contentHold.reason,
              operation: room.game.contentHold.operation,
              ...(room.game.contentHold.cellId
                ? { cellId: room.game.contentHold.cellId }
                : {}),
            },
          }
        : {}),
      ...(room.game.endedWithoutWinner ? { endedWithoutWinner: true } : {}),
      ...(match.matchWinner
        ? {
            matchWinner: match.matchWinner,
            matchWinReason: match.matchWinReason,
          }
        : {}),
      entitledTeam: room.game.entitledTeam,
      answeringTeam: room.game.answeringTeam,
      winningPath: room.game.winningPath,
      ...(room.deadlineAt
        ? { deadlineAt: room.deadlineAt, buzzOpen: room.buzzOpen }
        : {}),
      ...(room.answerFeedback && Date.parse(room.answerFeedback.expiresAt) > now.getTime() ? { answerFeedback: room.answerFeedback } : {}),
      ...(room.game.lifecycle === 'QUESTION_FAILED' && room.questionFailedReason ? { questionFailedReason: room.questionFailedReason } : {}),
      ...(buzzWinner
        ? {
            buzzWinner: {
              displayName: buzzWinner.displayName,
              team: buzzWinner.team,
              method: buzzWinner.method,
            },
          }
        : {}),
      ...(capability.role === "audience"
        ? {}
        : {
            self: {
              uid: capability.uid,
              seatId: publicSeatId(room.id, capability.uid),
              displayName: member?.displayName,
              ready: member?.ready ?? false,
              team: member?.team,
              canBuzz:
                capability.role === "player" &&
                !room.buzzWinner &&
                Boolean(room.buzzOpen) &&
                (room.game.lifecycle === "QUESTION_READING" ||
                  (room.game.lifecycle === "OPPONENT_CHANCE" &&
                    member?.team === room.game.entitledTeam)),
              ...(buzzWinner?.method === "player" &&
              buzzWinner.uid === capability.uid
                ? { isBuzzWinner: true }
                : {}),
            },
          }),
    };
    if (room.challenge && room.activeQuestion?.challenge) {
      const definition = this.challengeDefinitions.resolveBound(room.activeQuestion);
      const state = restoreChallengeState(room.challenge);
      const recipient = participantRecipient(state, capability.uid, capability.role);
      const requiredTeam = teamForChallengeRecipient(state, recipient);
      if (capability.role === "player" && requiredTeam && member?.team !== requiredTeam)
        throw new Error("CHALLENGE_ASSIGNMENT_STALE");
      projection.challenge = projectChallenge(definition, state, recipient);
      // A challenge projection replaces generic question/audit fields so no
      // canonical answer, media binding, or submitted answer can leak.
      return {
        roomId: room.id,
        revision: room.revision,
        serverTime: this.now(),
        role: capability.role,
        projection,
      };
    }
    const revealed = hasRevealedOccurrence(
      room.activeQuestionOccurrence,
      room.answerRevealedOccurrence,
    );
    const visibleMedia = revealed
      ? room.activeQuestion?.answerMedia ?? room.activeQuestion?.media
      : room.activeQuestion?.media;
    // The external descriptor is delivered only through the authorized media ticket.
    const visibleMediaBinding = visibleMedia ? { ...visibleMedia } : undefined;
    if (visibleMediaBinding) delete visibleMediaBinding.youtube;
    const sharedAnswerVisible =
      capability.role !== "player" &&
      (capability.role === "host" || room.config.showQuestionOnAudience !== false) &&
      (revealed ||
        room.game.lifecycle === "QUESTION_FAILED");
    if (questionVisible && room.activeQuestion)
      projection.question = {
        ...(room.activeQuestionOccurrence ? { occurrence: room.activeQuestionOccurrence } : {}),
        headerAr: room.activeQuestion.headerAr,
        promptAr: room.activeQuestion.promptAr,
        ...(capability.role !== "player" &&
        (capability.role === "host" ||
          room.config.showQuestionOnAudience !== false) &&
        visibleMediaBinding
          ? { media: visibleMediaBinding }
          : {}),
        ...(sharedAnswerVisible
          ? { revealedAnswer: room.activeQuestion.canonicalAnswer }
          : {}),
      };
    if (isHost) {
      if (room.activeQuestion)
        projection.question = {
          ...(room.activeQuestionOccurrence ? { occurrence: room.activeQuestionOccurrence } : {}),
          headerAr: room.activeQuestion.headerAr,
          promptAr: room.activeQuestion.promptAr,
          ...(questionVisible && visibleMediaBinding
            ? { media: visibleMediaBinding }
            : {}),
          ...(sharedAnswerVisible
            ? { revealedAnswer: room.activeQuestion.canonicalAnswer }
            : {}),
          primaryAnswer: room.activeQuestion.canonicalAnswer,
          acceptedAnswers: room.activeQuestion.acceptedAnswers,
          sources: room.activeQuestion.sources ?? [],
          moderation: { status: room.activeQuestion.status },
        };
      if (room.game.correction)
        projection.correction = {
          ...room.game.correction,
          priorOwner: room.game.board?.cells.find(
            (cell) => cell.id === room.game.correction?.cellId,
          )?.owner,
        };
      projection.audit = room.audit.slice(-20);
    }
    return {
      roomId: room.id,
      revision: room.revision,
      serverTime: this.now(),
      role: capability.role,
      projection,
    };
  }
}


