# INT-071.E Root acceptance — 2026-10-07

**Done within public episode catalogue source/UI scope. Full F09/INT-7 and production remain open.**

Implementation: isolated checkout `C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof`. Ten source/test files: public-catalog/reviewed-release/app.ts/API tests, episode client/route/CSS, App.tsx/InternalHeader and UI tests. Root read public release/projection/client/route/CSS and exact existing-file delta; no auth changes or legacy router. Explicit empty release is adopted; future records need publication review.

Root independently executed three controlled API checks: default empty200, namespace denial before catalogue/JSON access, legacy/detail/write404. All3 passed; ten frozen hashes matched, zero mismatches. Personally inspected actual final1440dark empty,320light empty and390dark populated renders against approved sharedDNA; populated data are fixtures, not approved publications. No new aesthetic or human-device approval claimed.

Forge:13 API/20 UI checks, app+bounded API typecheck, scoped lint, two frontend-only builds,36 rendered states/10 keyboard scenarios;30 axe checks zero violations,6 static-preview cases zero API requests. Existing chunk warnings retained. Initial lint/browser harness issues and one concurrent identity fetch failure are disclosed in REPORT.md; final sequential13 passed. Controlled namespace injection is not production DB/runtime acceptance.

Security independently verified exact ten-file freeze, four API and two hostile-text/stale-response UI checks; no concrete scoped blocker. Review: `output/int071e-episodes-20261007/security/REVIEW.md`. Source freeze SHA256 `b76bf44a83b333aa109d10c8ccf4354b0346e47a5eab60643ce9acea23900904`; evidence freeze `0a1496c71f57e0e2f6b7cd35ed3bd81e60d57b6b0c5677fca2327f3cdc9c7145`. REPORT.md and DELTA.patch preserve exact tranche and failures.

No production/DB/native/financial/rules effects. No seeded episodes/media. TV applications/admin authoring/content/live backend/device/cutover remain required. Rollback only this reviewed delta after intervening-work inspection. Preview will use isolated frontend output, retaining prior dist. Provider token telemetry unavailable.
