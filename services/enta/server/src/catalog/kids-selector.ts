import { admissionHash } from "../admission/huroof-protocol.cjs";

export const KIDS_SELECTOR = "enta-reviewed-kids-tier-v1";
export const KIDS_SUITABILITY_POLICY = "enta-kids-suitability-v1";
export interface KidsSource {
  revisionId: string; contentHash: string; sourceQuestionId: string; categoryKey: string; points: 200 | 400 | 600;
  engine: "ENTA"; mode: "KIDS"; modality: "classic"; editorialDecision: "APPROVED"; rightsDecision: "CLEARED";
  sourceNamespace: "enta.question";
  suitability: { policyVersion: string; targetCohort: string; reviewerIdentityId: string; evidenceHash: string; decision: "APPROVED" };
}
export interface KidsSelection { seed: number; ids: string[]; hash: string }
export interface KidsTierProof { categoryKey: string; tier: number; selectorVersion: string; fresh: KidsSelection; repeat: KidsSelection; manifestHash: string }
const ID = /^[A-Za-z0-9_-]{1,128}$/, HASH = /^[a-f0-9]{64}$/;
export function selectKidsTier(sources: readonly KidsSource[], categoryKey: string, points: number, seed: number, targetCohort: string): KidsSelection {
  if (!ID.test(categoryKey) || !ID.test(targetCohort) || ![200, 400, 600].includes(points) || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("KIDS_PROOF_INVALID");
  const pool = sources.filter(source => source.categoryKey === categoryKey && source.points === points);
  if (pool.length < 4 || new Set(pool.map(source => source.revisionId)).size !== pool.length || new Set(pool.map(source => source.sourceQuestionId)).size !== pool.length || pool.some(source => !ID.test(source.revisionId) || !HASH.test(source.contentHash) || !ID.test(source.sourceQuestionId) || source.sourceNamespace !== "enta.question" || source.engine !== "ENTA" || source.mode !== "KIDS" || source.modality !== "classic" || source.editorialDecision !== "APPROVED" || source.rightsDecision !== "CLEARED" || source.suitability?.decision !== "APPROVED" || source.suitability.policyVersion !== KIDS_SUITABILITY_POLICY || source.suitability.targetCohort !== targetCohort || !ID.test(source.suitability.reviewerIdentityId) || !HASH.test(source.suitability.evidenceHash))) throw new Error("KIDS_PROOF_INVALID");
  const ids = [...pool].sort((a, b) => { const first = admissionHash({ selector: KIDS_SELECTOR, seed, id: a.revisionId }), second = admissionHash({ selector: KIDS_SELECTOR, seed, id: b.revisionId }); return first < second ? -1 : first > second ? 1 : a.revisionId < b.revisionId ? -1 : 1; }).slice(0, 2).map(source => source.revisionId);
  return { seed, ids, hash: admissionHash({ selector: KIDS_SELECTOR, targetCohort, categoryKey, points, seed, ids }) };
}
export function proveKidsTier(sources: readonly KidsSource[], categoryKey: string, tier: number, targetCohort: string, freshSeed: number, repeatSeed: number): KidsTierProof {
  const fresh = selectKidsTier(sources, categoryKey, tier, freshSeed, targetCohort), repeat = selectKidsTier(sources, categoryKey, tier, repeatSeed, targetCohort);
  if (fresh.ids.some(id => repeat.ids.includes(id))) throw new Error("KIDS_REPEAT_SUPPLY_INCOMPLETE");
  return { categoryKey, tier, selectorVersion: KIDS_SELECTOR, fresh, repeat, manifestHash: admissionHash({ selector: KIDS_SELECTOR, targetCohort, categoryKey, tier, fresh, repeat }) };
}
export function replayKidsProofs(sources: readonly KidsSource[], proofs: readonly KidsTierProof[], categories: readonly string[], targetCohort: string): void {
  if (categories.length < 1 || categories.length > 1000 || new Set(categories).size !== categories.length || proofs.length !== categories.length * 3 || sources.length > 12000 || sources.some(source => !categories.includes(source.categoryKey) || ![200, 400, 600].includes(source.points)) || new Set(sources.map(source => source.revisionId)).size !== sources.length || new Set(sources.map(source => `${source.categoryKey}:${source.sourceQuestionId}`)).size !== sources.length) throw new Error("KIDS_PROOF_INVALID");
  for (const key of categories) for (const tier of [200, 400, 600]) {
    const rows = proofs.filter(proof => proof.categoryKey === key && proof.tier === tier); if (rows.length !== 1) throw new Error("KIDS_PROOF_INVALID");
    const row = rows[0], actual = proveKidsTier(sources, key, tier, targetCohort, row.fresh.seed, row.repeat.seed);
    if (admissionHash(actual) !== admissionHash(row)) throw new Error("KIDS_PROOF_INVALID");
  }
}
