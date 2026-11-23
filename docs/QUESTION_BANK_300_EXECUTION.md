# Question Bank 300-per-Category Execution Ledger

Status: `V3_3_GATE_3_REPAIR`
Checkpoint revision: `12`
Started: `2026-09-04T15:24:13+03:00`

## Objective

Create at least 300 policy-valid Arabic questions for every category exposed by the app, store each category in its own canonical file, obtain real review receipts, build an immutable release, and publish and verify it in Firestore project `huroof-a3ee7`, database `(default)`, location `me-central2`.

The frozen product scope is the 62 runtime categories `tahadani-001` through `tahadani-062`. The four `huroof-*` extensions remain proposed and runtime-invisible; adding them requires a separate human-approved catalog expansion.

## Current verified baseline

- The production catalog contains 62 categories.
- The v3.2 policy registry contains 66 policy entries and must be reconciled with the app catalog before authoring scope is frozen.
- The legacy bank contains 280 drafts and zero approved questions.
- The v3.2 pilot contains 408 candidates across 17 categories: 384 `ready_for_human` and 24 `evidence_ready`.
- The v3.2 report currently contains 408 errors and 50 warnings.
- The approved production JSONL contains zero records.
- The production Firestore console currently displays an empty database.
- Firebase MCP/CLI and local ADC are not authenticated/configured for production writes.

## Non-negotiable constraints

- Do not copy Tahadani's 12,400 legacy questions as production questions.
- Do not fabricate human, specialist, media-rights, or release approvals.
- Do not publish drafts, candidates, charades into classic mode, or records with blocking findings.
- Every accepted answer must satisfy Arabic starting-letter policy where the modality requires a target letter.
- Every factual claim needs a source/evidence binding and temporal policy where applicable.
- Every category must have a separate canonical question artifact and deterministic count/hash.
- Shared schemas, manifests, registries, and release outputs are coordinator-owned and edited serially.
- Production publication must use `plan -> prepare -> verify -> activate`; prepare must not change the active pointer.
- Rollback changes only the active pointer through compare-and-swap and writes an immutable rollback receipt. It may restore a previously verified immutable release, or—only when rolling back the first release and the expected active release matches—atomically delete `runtime/activeRelease` to restore the verified prior `none` state.

## Draft acceptance matrix

| Criterion | Required evidence | Current state |
|---|---|---|
| Category scope frozen | Catalog/policy reconciliation and reviewed plan | Pending |
| 300+ per category | Canonical per-category counts, no slots/filler | 0 categories complete |
| Arabic quality | Human Arabic review receipts | 0 receipts |
| Factual correctness | Evidence packets and source checks | Partial pilots only |
| Duplicate safety | Zero errors and zero unresolved review findings | 408 errors, 50 warnings |
| Letter/board readiness | Per-category and combined-pack simulations | Pending |
| Media/rights | Asset hashes, alt text, rights receipts | Pending for image modes |
| Runtime eligibility | Approved canonical export | 0 records |
| Firebase readiness | Non-empty offline plan and authenticated ADC | Blocked |
| Production completeness | Exact ID-set/count/hash readback and active pointer audit | Not started |

## Ownership

- Root coordinator: ledger, shared contracts, integration, evidence reconciliation, and final Firebase authorization boundary.
- Architect: read-only execution contract and pre-mortem (`/root/all_categories_architect`).
- Plan critic: `/root/question_bank_plan_critic` — PASS on revision 4.
- Shared-contract writer: `/root/question_bank_v33_contract_forge`.
- Category writers: gated pending independent v3.3 contract PASS; at most three concurrent, with non-overlapping category/artifact ownership.
- Independent contract Gate: `/root/question_bank_v33_contract_gate`.
- Independent release Gate: required again for the exact production release tuple.

## Evidence log

- `npm run validate:questions -- --as-of 2026-09-04`: 280 questions inspected, 0 approved, 0 errors, 0 warnings.
- `npm run firestore:production:plan`: correctly refused a zero-approved release before cloud access.
- `npm run validate:pilots:v3.2`: 408 questions, 418 evidence packets, 408 errors, 50 warnings.
- Firebase Console read: project `huroof-a3ee7`, `(default)`, `me-central2`, empty database.
- Read-only 62-category inventory: pilots exist only for 001–010, 013, and 015–020. Categories 011, 012, 014, 044, and 061 require licensed question media; 016–020 are separate charades; 001, 045, 046, and 059 are closed finite domains with strict concept caps. Every category has 320px and 640px cover derivatives, but those covers are not licensed question media.

## Baseline hashes

- `content/categories/categories.json`: `073b37a65baabf1996a014c097378e3d62f18b348f08d1cb16c4c47d93e0c727`
- `content/question-bank-v3/v3.2/category-policies.v3.2.json`: `6e390d5cb3d66345b71cff338ea9d65780497c084b50520be3afeb8aa619058c`
- `content/question-bank-v3/v3.2/reports/validation.v3.2.json`: `b6c573c36ed5430ee88b7e6a1977f89efc070bbc18d730b13ce42643df87d9ae`
- `content/questions/approved/questions.jsonl`: `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`
- `content/questions/reports/release-manifest.json`: `af8144a40e29b48f9e7481a578836d3bb82d017132b0e5dd00a4d5e91c636160`

## Failures and blockers

- Production upload is blocked by zero approved content, missing authenticated review receipts, validator failures, and absent ADC.
- The canonical release path cannot yet accept a non-empty v3.2 payload without resolving the v1/v3.2 schema conflict.
- The workspace is Git-backed at commit `58f3fbb3ce80a8165d231bd6adcbfc358efd422e` and contains pre-existing modified/untracked work. The exact working-tree paths and hashes are frozen in `.codex/question-bank-300.working-tree-baseline.json`; no writer may reset, stash, broad-stage, or overwrite them.
- The first independent v3.3 Gate could not emit its final verdict because the host filtered two final messages, but its delivered checkpoint and coordinator reproduction establish a FAIL: the validator accepted a synthetic 62-by-300 corpus with omitted candidate counts, an unverified issuer string, an ancient receipt, and a rejected rights receipt.
- The v3.3 contract is not yet wired into the production builder or runtime. The existing builder still requires 66 v3.2 policies and excludes charades; client, Functions, and local-service contracts do not yet provide a separate charades lifecycle.
- Repair checkpoint 1 was incomplete: root verification found `functions:test` at 11/12, and the actual `buildFirestoreReleasePlan({ production: true })` path still invoked the legacy v1/v3.2 gates. The new v3.3 assertion existed only as an unused helper, so production identity still depended on the approved JSONL hash rather than the full v3.3 tuple.
- The continued repair restored Functions to 12/12 and routed explicit v3.3 production input through a tuple-derived builder, but an independent Security review returned FAIL: caller-controlled registries and literal `trusted_server` fields remain forgeable; rejected rights receipts can pass; author/category/time/replay checks are incomplete; and charades review/evidence semantics do not match this ledger.

## Architect-approved phase contract

1. Freeze a hash-bound 62-category scope manifest and preserve the current tree baseline.
2. Repair the canonical authoring/approval/runtime/release contract so one schema handles classic, image, and charades records, per-category approved files, aggregate derivation, and rollback-to-none.
3. Repair the existing 408-record pilot without approval, eliminate blocking findings, and pass an independent pilot Gate before scale-out.
4. Generate a preferred 336 candidates per category in 24-item batches. Three writers own non-overlapping category paths; shared artifacts remain coordinator-owned.
5. Obtain authenticated Arabic/fact/specialist/rights/originality receipts as applicable. AI-generated review never counts as human approval.
6. Serialize integration into exactly 62 per-category approved files, each with at least 300 playable records, then derive the aggregate and hash-bound release manifest.
7. Run an independent release Gate over the exact frozen corpus, including all modalities and at least 1,000 actual-corpus simulations.
8. With fresh authorization for the exact tuple and working ADC, run Firebase `plan -> prepare -> verify -> activate`, post-verify the ID set/count/hash, and retain the tested rollback target.

Preferred gross target: 336 × 62 = 20,832 candidate records. Minimum approved target: 300 × 62 = 18,600 records.

### Writer category ownership

- Writer 1: 001, 004, 007, 010, 013, 016, 019, 022, 025, 028, 031, 034, 037, 040, 043, 046, 049, 052, 055, 058, 061.
- Writer 2: 002, 005, 008, 011, 014, 017, 020, 023, 026, 029, 032, 035, 038, 041, 042, 047, 050, 053, 056, 059, 062.
- Writer 3: 003, 006, 009, 012, 015, 018, 021, 024, 027, 030, 033, 036, 039, 044, 045, 048, 051, 054, 057, 060.

Each writer owns only category source plans and category batch question/evidence/report files. Writers must not edit schemas, policies, aggregates, manifests, receipts, lockfiles, runtime, or publisher code.

## Product decisions resolving Plan Critic blockers

- Scope remains exactly the 62 runtime-visible categories. The four proposed extensions are excluded.
- Every category receives at least 300 approved records, but letter-board standalone eligibility is separate from raw count. Categories that cannot naturally supply 25 supported answer letters are `combined_only`; validators must reject unplayable standalone or category combinations instead of inventing rare-letter answers.
- A coordinator-owned slot ledger will define 336 immutable candidate slots per category before scale-out. Classic/image slots bind letter, difficulty, concept, and facet quotas; charades slots bind performance-facet and suitability quotas.
- v3.3 validation must load and hash-bind the exact question, evidence, policy, review-receipt, and media corpora. It must validate answer-initial letters, strict schemas, complete duplicate recall, quota progress, and remaining rejection margin.
- Image questions require a byte-hashed local asset, Arabic alt text, provenance, publishable licence, and authenticated rights receipt. Unverified legacy covers never satisfy question-media requirements.
- Charades are published and consumed through a separate runtime mode with no `targetLetter`; they may not be silently filtered from the immutable release.
- Authenticated review receipts are mandatory. Writers and AI may create drafts and automated findings only and cannot create human/specialist/rights receipts.
- The trusted review issuer is a server-side/Admin-only service bound to Firebase Authentication principals and a versioned reviewer-qualification registry. It verifies the principal token, authorizes the required role for the category/review type, refuses writer/AI/self-issued identities, and issues immutable receipts server-side only. Each receipt binds question content hash, evidence/source hashes, policy hash, media hash when applicable, reviewer UID, authorized role, verdict, and timestamp. Any bound-content change invalidates the receipt. Client-authored receipts are never accepted.
- Canonical per-category approved files are the source of truth. The aggregate publisher input is deterministically generated; release identity binds the full catalog/policy/question/receipt/media/report tuple.
- First-release rollback-to-none will be implemented and tested as an audited compare-and-swap operation before production activation.
- Exact readback must enumerate the stored release ID set to detect missing and extra documents.

## Revised gate sequence

1. Shared-contract Forge implements strict v3.3 schemas/validator, slot ledgers, the server-side/Admin-only authenticated promotion issuer and reviewer-role registry checks, all-modality runtime/release handling, complete-tuple identity, exact readback, and rollback-to-none. It owns shared code only.
2. Independent Gate must PASS negative contract tests—including forged principal, unauthorized role, writer/AI identity, client-authored receipt, stale hash, replay, and altered-content cases—and classic/image/charades emulator lifecycles before content writers start.
3. Three category writers repair only their existing assigned pilot paths; one rights-complete image calibration batch is required.
4. Independent pilot Gate must PASS the repaired 408 records and representative modalities.
5. Writers scale one validated 24-item batch at a time against frozen slot ledgers, while shared integration remains serialized.
6. Genuine reviewers issue receipts; coordinator derives 62 approved files and the aggregate.
7. Independent release Gate freezes the exact tuple and runs all required simulations/lifecycles.
8. Authorized Firebase operator runs `plan -> prepare -> exact verify -> activate -> production smoke`; failed smoke triggers the tested CAS rollback-to-none or prior release.

## Next action

Repair Gate 3's two release-pipeline defects: path-component/symlink-safe external trust-root containment and publisher-wide v3.3 plan wiring. Root-verify, freeze, and repeat the independent Gate. Category writers remain blocked until PASS.
