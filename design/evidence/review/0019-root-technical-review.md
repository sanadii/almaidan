# 0019 correction — Root review of INT-032.D

Recorded 2026-10-03. The corrected homepage is implemented and technically reviewed. Owner live acceptance is pending; other-route expansion remains closed. This review does not certify aesthetic quality.

## Frozen candidate

- [Implementation evidence](C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof/output/int3d-homepage-20261003/IMPLEMENTATION-EVIDENCE.md), [freeze](C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof/output/int3d-homepage-20261003/FREEZE.json) and [94-entry exact manifest](C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof/output/int3d-homepage-20261003/final-hashes.json).
- Freeze: `2026-10-03T10:18:19.469Z`. HomeSurface SHA256 `955c9e186d4575db070de121823f86474ed5a5376d3760b9a911aaa9ff47c3c0`.
- Root independently verified all94 bindings and matching primary/isolated DNA.

## Review and concrete corrections

Root compared the selected 1600×1000 Playful reference with rejected C and new D renders, plus full-page, 390px and 320px/dark/reduced-motion evidence. New composition has a broad Arabic statement, wide horizontal illustrated tiles, quiet action cluster and softer major game surfaces. Existing ten sections and real behavior remain.

Root found rough edges in the first new artwork and insufficient pink atmosphere. A dedicated native-alpha image edit removed the fringe; Forge strengthened the local wash. Root inspected the final cream/dark browser captures and the actual live in-app browser, including theme selection. The final native-alpha original and threshold-aware derivative crop remain explicitly documented; source originals are unchanged.

Root inspected the baseline-to-current HomeSurface diff: responsive art geometry and hero copy only, with runtime state logic retained. Independently reran `npm run test:ui -- tests/app/home-surface-catalog.test.tsx`: **4/4 passed, no skips**, session56158 exited0. Forge reports28 focused tests and17 final browser cases passing, app typecheck/lint/whitespace/final Vite build passing. Full build passed before final static art/wash refinement; unchanged backend and final frontend checks are recorded separately.

Preservation evidence verifies ten protected backend files, EntryRoute, non-homepage CSS bytes and36 old C asset/screenshot hashes unchanged. No commit, push, database application or deployment occurred.

## Exact next action

Owner live review of <http://127.0.0.1:4173/>. Append the exact owner response as new immutable history before visual acceptance or styling remaining routes. The 0018 human rejection remains valid; neither tests nor this review reverses it. Live Firebase/catalog configuration, Enta availability and purchasing remain outside this visual correction.
