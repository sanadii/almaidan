# Candidate category-cover backfill — 2026-09-22

## Outcome

Create a dedicated, text-free, original cover-image asset for every unique category name in the candidate Tahadani Games source catalog that does not already resolve to a local cover. This work creates a reviewable asset library only. It does not activate candidate categories, alter question ownership, publish to Firebase, or assert rights for imported legacy artwork.

## Current-state evidence

- Authoritative candidate source: `content/source-catalog/tahadani-games-catalog.v1.json`.
- Source entries: 558 across 27 groups; 544 unique normalized category names.
- Existing local image library: `src/data/tahadani-image-catalog.public.json`, 306 covers; all referenced 320/640 WebP files exist locally.
- Exact normalized-name resolution finds 111 covered unique source names and 433 unique names without a dedicated cover.

## Tasks

| ID | Scope | Owner | Acceptance |
|---|---|---|---|
| CC-01 | Produce a deterministic audit of normalized source names, existing matching covers, and missing cover IDs. | Root | Counts, mappings, and every unresolved category are recorded in JSON/Markdown. |
| CC-02 | Generate one original, text-free square cover for each missing unique source category. | Image | Each output decodes as a bitmap; no copied logos, trademarks, actor likenesses, copyrighted character art, or in-image text. |
| CC-03 | Create optimized public derivatives and a source-to-cover mapping without changing category activation. | Root | One unique generated image per unresolved normalized name; source/original and WebP delivery assets remain separate. |
| CC-04 | Validate all mappings/files and retain a reviewable coverage report. | Root | Zero unresolved names in the candidate catalog; no missing mapped files; production build and focused mapping checks pass. |

## Visual contract

Square category-card artwork for a family-friendly Arabic knowledge game: high-signal illustrative objects or environments that communicate the category at thumbnail size; no text, watermark, branded logo, celebrity likeness, franchise character, or copied poster. Use neutral, original compositions and avoid yellow/gold, generic gamer neon, glass effects, or Tahadani/Golbha brand imitation. For brand/franchise/person categories, depict the broader genre or mechanic rather than protected marks or identities.

## Sequence and rollback

1. Generate review originals in batches, retaining brief/prompt provenance.
2. Validate decode/dimensions and visually inspect representative outputs by group.
3. Derive 640px WebP delivery assets and write the mapping/report.
4. Verify the mapping and app build.

Rollback is limited to removing only newly generated source/derivative files and their generated mapping/report; the source catalog, existing cover library, category activation, questions, and production releases are unchanged.

## Status

CC-01 complete. CC-02 in progress. Current decoded-file counts are recorded in `reports/category-cover-audit-2026-09-22.json`; do not use historical chat counts as completion evidence.

2026-09-22 continuation: corrected Windows PowerShell stderr handling that incorrectly marked completed images as failed. Six disjoint queues now assign canonical category IDs by source index modulo six, preserving existing originals. Each successful render must pass a full Sharp decode. Per-image runner logs and prompts remain alongside originals; queue logs are in `reports/category-cover-backfill-2026-09-22-shard-*.log`.

CC-03 implementation is ready: `npx tsx scripts/build-tahadani-games-category-covers.ts` builds 320/640px WebP assets and a public mapping for all 558 source IDs. `src/data/local-question-inventory.ts` resolves that mapping by category ID. Missing images remain explicitly unresolved. Forge reported typecheck, scoped lint and 25 setup tests passing; root repeated the derivative builder and app typecheck successfully. CC-04 remains open until every required original and mapped derivative is verified.

## Completion evidence — 2026-09-22 20:06 +03:00

CC-01, CC-02, CC-03 and CC-04 are **Done**. The progress paragraphs above are retained as historical execution evidence.

- All six generation queues completed. The final audit records **558 source IDs, 544 distinct normalized names, 111 existing cover matches, 433 generated originals, and zero unresolved names**.
- The final delivery mapping, `src/data/tahadani-games-category-covers.public.json`, covers **558/558 category IDs** with no unresolved entries. Duplicate normalized names intentionally share an image.
- Generated originals and prompt/runner provenance remain in `design/category-covers/tahadani-games-review-2026-09-22/`. The **866 new WebP derivatives** (433 each at 320px and 640px) are in `public/assets/categories/generated/tahadani-games/`.
- `npx tsx scripts/verify-tahadani-games-category-covers.ts` passed: all **558 runtime mappings**, **1,088 unique referenced delivery files** (including existing artwork), and **433 originals** fully decoded; all generated derivatives have exact target dimensions; all originals are at least 640px; **433 distinct SHA-256 hashes** confirm no identical original files.
- Root visually inspected one representative generated image from each of the 27 source groups: IDs 517, 340, 218, 529, 077, 276, 026, 101, 324, 296, 263, 085, 359, 431, 460, 379, 252, 119, 344, 142, 331, 292, 439, 336, 160, 539 and 548. This is a limited visual spot-check, not a claim that deterministic validation certifies aesthetic quality.
- `npm run typecheck:app`, scoped ESLint (audit/build/verification scripts and inventory mapping), `npx vitest run tests/app/setup-route.test.tsx` (**25/25 tests**), and `npm run build` passed. Test output retained existing React `act` warnings; Vite retained its >500kB chunk advisory.
- The final full `npm run typecheck` did **not** pass: unrelated `tests/t35i-cards.test.ts` lines 4–5 use `.ts` import extensions without `allowImportingTsExtensions` (TS5097). That file was not modified by this backfill and was left untouched.
- No categories were activated, no questions or database data were changed, and no deployment was performed. Existing imported-image rights flags remain unverified; generation does not change their status.

### Execution usage

Continuation elapsed approximately **2h40m** (17:26–20:06), within the revised 2–3h parallel-run estimate. Image generation used GPT-5.6 Sol through the configured wrapper; Forge implementation used GPT-5.6 Terra. Retained logs expose 397 closed image-session token reports totaling **7,482,019 reported tokens**. Input/cache/output breakdowns and complete telemetry for other image attempts, root and Forge are unavailable; this is a partial captured total, not an estimate of total task usage.

### Handover

The requested missing-image backfill is complete locally. Re-run the audit, derivative builder and verifier commands above to reproduce coverage checks. Further category activation or production publication remains outside this task.

## Follow-up CC-05 — actual setup-screen coverage

The owner's screenshot revealed that source-catalog completeness did not prove coverage of every live setup category. The open local page at `http://127.0.0.1:5199/host/new?kind=huroof&mode=classic` initially held stale module/image state. After reload, all five screenshot categories loaded their dedicated generated covers. A second fresh-load audit of 160 displayed cards left nine actual legacy-topic gaps (plus the legitimate general-knowledge cover that doubles as the fallback artwork).

- Two gaps, Marvel and Dragon Ball, had generated covers but different runtime IDs. The resolver now matches exact normalized source labels after checking source IDs; existing known-category precedence is preserved, with no fuzzy substitutions.
- Seven legacy topics require supplemental originals: PlayStation, Nintendo, أفلام ديزني وبيكسار, DC Comics, مسلسلات أجنبية, أفلام هوليوود, أفلام عربية. Originals/prompts are isolated under `design/category-covers/legacy-review-2026-09-22/`; derivatives belong under `public/assets/categories/generated/legacy/`.
- Scope: presentation mapping and seven missing assets only. No database/category activation or deployment.
- Checks completed: app typecheck, 25 setup-route tests, 3 new resolver tests (including all 558 labels with non-source IDs), and scoped lint. Browser DOM confirms the five screenshot topics and Marvel/Dragon Ball use loaded generated images.
- Acceptance still open: generate/decode the seven originals and 14 derivatives; reload the actual page and verify all displayed images load with no fallback-alt category cards; run final build and source-catalog verifier. Status: **In progress**.

### CC-05 completion

**Done.** Seven supplemental originals and 14 WebP derivatives are decoded and saved. `scripts/build-legacy-category-covers.ts` reproduces the derivatives. The image runner visually inspected all seven 1254×1254 PNGs and confirmed distinct hashes. Built-in generation prompts and wrapper logs accompany the originals.

Final checks passed: 28 tests across setup-route and category-cover-resolution, app typecheck, scoped ESLint, production app build, and the original 558-ID/433-original verifier. The new tests also require the seven mapped public files to exist.

The local Vite server stopped during verification; it was restored on the same loopback address/port with the existing Firebase runtime mode. A fresh Chrome DOM audit of the actual page then returned **160 displayed images, 160 successfully loaded, zero fallback-alt cards**, including all seven supplemental covers. The general-knowledge cover remains intentionally valid, not counted as a missing image merely because its artwork also serves as the error fallback. No database writes or deployment occurred.

Captured supplemental Image/GPT-5.6 Sol telemetry: seven closed renders, **176,701 reported tokens**; input/cache/output breakdown and root/agent-coordination telemetry unavailable. The original 5–15-minute bounded-check estimate expanded when seven new legacy-topic renders were found necessary; full root-session elapsed telemetry is unavailable.

## Follow-up CC-06 — meaningful parent topics

Owner request: classify categories properly under parent topics, including the 70 entries shown under `موضوعات أخرى`. Baseline browser evidence: 160 active setup cards; 70 in Other. Scope is browse-only presentation classification; no activation, question, database, image, or deployment changes.

Retain the current RTL topic-pill design and existing parents. Expand food to `طعام ومطاعم`; add `إنترنت وصنّاع محتوى`, `أسلوب حياة`, `تاريخ وتراث`, and `لغة وأدب`. Use reviewed source-category identity and normalized names so runtime IDs do not discard source classification. Content-specific quiz formats and country collections must resolve by actual subject, not simply their format or country collection. Keep Other available for genuinely unknown future categories.

Acceptance: all 558 source entries have meaningful parents; all 160 displayed categories remain available exactly once across the filters; the 70 known Other entries are classified; counts and selected filters agree; existing cover resolution and setup checks still pass. Root verifies rendered filters and one load-bearing test after Forge completes implementation. Status: **In progress**.

### CC-06 completion — 2026-09-22 21:17 +03:00

**Done locally.** The reviewed taxonomy covers all 558 source IDs and 544 normalized names, including runtime IDs that differ from source IDs. Four new parents are present, food is broadened, and legacy history/cars/poetry assignments align with their new parents. Unknown future labels still retain the fallback rather than being silently forced into an unrelated topic.

Root exercised all 14 rendered filters. Counts: sports 54, geography 7, screen 18, music 7, animation 6, games 8, science 12, religion 16, culture 8, food 2, digital 5, lifestyle 6, history 6, literature 5. Their 160-card label multiset exactly matches the pre-change baseline; no category was lost or added by filtering. Two pre-existing cards share the label `السيرة النبوية`; this is not a new filter duplicate. Other has zero entries and is hidden. All 160 card images load successfully. Final desktop screenshot confirms the existing two-row RTL pill treatment is retained.

Forge: 35 focused category-filter/setup/cover tests passed, app typecheck passed, scoped lint and diff checks passed. Root independently reran the seven taxonomy tests and the final production build successfully. Existing React act warnings and Vite chunk-size advisory remain. Full-repository typecheck was not repeated; the unrelated TS5097 issue documented above remains outside scope.

Changed files: `src/data/category-topic-taxonomy.ts`, `src/data/category-filters.ts`, scoped icon rules in `src/styles/khaliah.css`, `tests/app/category-filters.test.tsx`, and one expected topic-count assertion in `tests/app/setup-route.test.tsx`, plus this follow-up record. Source/catalog, questions, images, database, and deployment were not changed. Future source-catalog revisions require review of the ordinal taxonomy and its coverage tests.

Elapsed approximately 16 minutes against the initial 10–20-minute estimate. Sessions: root Astra and one Forge GPT-5.6 Terra agent (implementation plus bounded review repair). Provider token telemetry and per-session elapsed breakdown are unavailable; no token estimates are reported.
