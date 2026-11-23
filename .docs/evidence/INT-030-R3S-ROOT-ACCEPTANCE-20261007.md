# INT-030.R3.S Root acceptance — 2026-10-07

**Done WITH LIMITS: inactive source validator and decision plans only. Operational coexistence, financial release and full integration remain open.**

Two new files in the isolated integration checkout: `services/enta/server/src/admission/huroof-coexistence.ts` and `services/enta/server/tests/huroof-coexistence.test.ts`. Root read the complete helper and material replay/START/cancellation tests, then the complete bounded v1→v2 helper diff and final report/source map. No mounting, financial source, rules, frontend routing, schema or cloud changes.

V1 was rejected: both Database/Security reproduced legacy Firestore auto-ID rejection caused by UUID-only paths/index validation. UUID-only legacy fixtures missed it. V1 source/freeze/reviews remain historical. V2 uses the exact legacy source predicate `[A-Za-z0-9_-]{1,128}`, distinct opposite-namespace absence probe, unchanged paid UUIDv4 validation and no fallback. Root independently replayed genuine20-character legacy ID routing, invalid legacy segments/paid nonUUID/collisions, fixed paid paths, legacy positive routing and retained-index zero-write replay; all4 selected tests passed across two runs. Earlier v1 four scoped checks also passed but did not establish compatibility.

Root verified v2 two-file freeze hashes, zero mismatches. The first v1 Root verifier incorrectly treated the object-shaped manifest as an array; that check failed and was not acceptance. Corrected `.members` verification matched both v1 files while v1 remained held. `git diff --no-index` exit1 represented the expected repair delta, not a test failure.

Forge:20/20 focused tests, bounded TypeScript and scoped lint passed. Exact v2 Database/Security reviews independently verified hashes and auto-ID/paid UUID rejection/no-fallback; no remaining material scoped finding. No actual transactions, server/admission start, production compatibility, query provenance or contention proof. Seven create instructions include unresolved projection/summary derivations and are not executable SDK batches.

Source freeze `f0947e5ea326b9ba92ceee00c3d14245a58b16b138ad8fa87c872f2e850d72e4`; helper `469f3384889d9da8e981ae2ddfe6d42651b8da832067f8e4ccb0d43a29d4127c`; tests `86ca4a28703a14ff805781f8524859f2817c159238eb21d5c334af5cb218a8a3`; evidence freeze `5006418af8b58743d714b92e85aa68cd3cac6f2c39f50bcb8d71deaeb427e86c`. Detailed report/reviews under integration `output/int030r3s-coexistence-20261007/`.

Next: fresh production R2 authority, reviewed actual adapter/projection/rule wiring and Firestore transaction tests, with financial/content/release gates. R-v6 remains diagnostic STOP; no native retry authorized. Rollback only inactive two-file delta after checking intervening work; no data rollback. Recorded Forge implementation/checks19m57s; host/provider token telemetry unavailable.
