import { createHash } from "node:crypto";

export interface HuroofBinding {
  version: 1;
  admissionId: string;
  identityId: string;
  projectId: string;
  uid: string;
  engine: "HUROOF";
  operation: "HOSTED_HUROOF";
  logicalMatchId: string;
  roomId: string;
  requestKey: string;
  requestHash: string;
  catalogReleaseId: string;
  catalogRootHash: string;
  validationReceiptId: string;
  releaseId: string;
  releaseRootHash: string;
  selectorVersion: string;
  readinessPolicyVersion: string;
  capabilityHash: string;
  configHash: string;
  predecessorId: string | null;
}

export interface HuroofProof {
  version: 1;
  binding: HuroofBinding;
  state: "RESERVED" | "STARTED" | "CANCELLED";
  provision: { version: 1; kind: "PROVISION"; roomCode: string; configHash: string } | null;
  terminal: {
    version: 1;
    kind: "START" | "CANCEL";
    actorUid: string;
    intentId: string;
    requestHash: string;
    fromRevision: number;
    toRevision: number;
  } | null;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("NON_CANONICAL_ADMISSION_VALUE");
}
export const admissionHash = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

export function assertBinding(binding: HuroofBinding): void {
  if (!binding || binding.version !== 1 || binding.engine !== "HUROOF" || binding.operation !== "HOSTED_HUROOF" ||
      ![binding.admissionId, binding.identityId, binding.projectId, binding.uid, binding.logicalMatchId, binding.roomId,
        binding.requestKey, binding.catalogReleaseId, binding.validationReceiptId, binding.releaseId,
        binding.selectorVersion, binding.readinessPolicyVersion].every(id) ||
      ![binding.requestHash, binding.catalogRootHash, binding.releaseRootHash, binding.capabilityHash, binding.configHash].every(hash) ||
      !(binding.predecessorId === null || id(binding.predecessorId))) throw new Error("ADMISSION_BINDING_INVALID");
}

export function assertProof(expected: HuroofBinding, proof: HuroofProof): void {
  assertBinding(expected);
  if (!proof || proof.version !== 1 || admissionHash(proof.binding) !== admissionHash(expected) ||
      !["RESERVED", "STARTED", "CANCELLED"].includes(proof.state)) throw new Error("ADMISSION_PROOF_MISMATCH");
  if (proof.provision !== null && (!proof.provision || proof.provision.version !== 1 || proof.provision.kind !== "PROVISION" ||
      typeof proof.provision.roomCode !== "string" || !/^[A-Z0-9]{8}$/u.test(proof.provision.roomCode) || proof.provision.configHash !== expected.configHash)) throw new Error("PROVISION_PROOF_INVALID");
  if (proof.state === "RESERVED") {
    if (!proof.provision || proof.terminal !== null) throw new Error("RESERVED_PROOF_INVALID");
    return;
  }
  const terminal = proof.terminal;
  if (!terminal || terminal.version !== 1 || terminal.kind !== (proof.state === "STARTED" ? "START" : "CANCEL") ||
      !id(terminal.actorUid) || !id(terminal.intentId) || !hash(terminal.requestHash) ||
      !Number.isSafeInteger(terminal.fromRevision) || terminal.fromRevision < 0 || !Number.isSafeInteger(terminal.toRevision) || terminal.toRevision !== terminal.fromRevision + 1)
    throw new Error("TERMINAL_PROOF_INVALID");
  if (proof.state === "STARTED" && (!proof.provision || terminal.actorUid !== expected.uid || terminal.fromRevision < 1)) throw new Error("START_PROOF_INVALID");
}

/** Only audience visibility is mutable during gameplay; all start configuration stays pinned. */
export function materialRoomConfig(config: Record<string, unknown>): Record<string, unknown> {
  const { paidAdmission: _paid, showQuestionOnAudience: _visibility, ...material } = config;
  return material;
}

export function assertHostedConfig(config: Record<string, unknown>): void {
  const categories = config.categories;
  const teams = config.teams as Record<string, unknown> | undefined;
  if (config.demo !== false || config.releaseDemoFixture !== false || config.policyVersion !== 1 ||
      config.qaAdmission !== undefined || config.paidAdmission !== undefined || config.challenge !== undefined ||
      config.mapPresentation !== "ordinary" || config.gameKind !== "huroof" || config.modality !== "classic" ||
      !["classic", "fast", "custom"].includes(config.mode as string) || !id(config.releaseId) || !hash(config.releaseRootSha256) ||
      !Array.isArray(categories) || categories.length < 1 || categories.length > 10 || !categories.every(id) || new Set(categories).size !== categories.length ||
      !teams || ![teams.horizontal, teams.vertical].every((name) => typeof name === "string" && name.trim().length > 0 && name.length <= 40) ||
      !Number.isSafeInteger(config.questionSeconds) || (config.questionSeconds as number) < 5 || (config.questionSeconds as number) > 120 ||
      !Number.isSafeInteger(config.opponentSeconds) || (config.opponentSeconds as number) < 5 || (config.opponentSeconds as number) > 120 ||
      typeof config.labelledColours !== "boolean" || typeof config.difficulty !== "string") throw new Error("HOSTED_CONFIG_UNSUPPORTED");
  const allowed = new Set(["demo", "releaseDemoFixture", "policyVersion", "mapPresentation", "gameKind", "modality", "mode", "releaseId", "releaseRootSha256", "categories", "teams", "questionSeconds", "opponentSeconds", "labelledColours", "difficulty", "showQuestionOnAudience"]);
  if (Object.keys(config).some((key) => !allowed.has(key))) throw new Error("HOSTED_CONFIG_UNSUPPORTED");
}

export function assertRoomBinding(binding: HuroofBinding, roomId: string, config: Record<string, unknown>, host: { uid?: string; role?: string; active?: boolean }): void {
  assertBinding(binding);
  if (binding.roomId !== roomId || config.demo !== false || config.releaseDemoFixture !== false || config.qaAdmission !== undefined ||
      !config.paidAdmission || admissionHash(config.paidAdmission) !== admissionHash(binding) ||
      config.releaseId !== binding.releaseId || config.releaseRootSha256 !== binding.releaseRootHash ||
      admissionHash(materialRoomConfig(config)) !== binding.configHash || host.uid !== binding.uid || host.role !== "host" || host.active !== true)
    throw new Error("ROOM_ADMISSION_BINDING_MISMATCH");
}
