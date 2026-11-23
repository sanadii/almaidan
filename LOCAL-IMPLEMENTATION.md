# Almaidan local acceptance ledger

**Current continuation:** see [LOCAL-ACCEPTANCE-2026-11-05.md](LOCAL-ACCEPTANCE-2026-11-05.md). Backend restart succeeded normally and all final backend changes are loaded. Entries below preserve earlier evidence and pending states; the dated current report supersedes those states.

Updated 2026-11-05. **Implementation and acceptance remain in progress. No full completion or production acceptance claim.**

Scope: isolated local services/databases only. Production, payments, the original saved release and existing match pins remain untouched. Worktree: `C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof`. Evidence/data root: `D:/projects/huroof_wa_oloof/local/almaidan`.

## Acceptance matrix

| Area | Accepted evidence | Remaining qualification |
| --- | --- | --- |
| Original source | Hash-pinned 530 categories / 115,636 questions; 4,578 media hashes; 2,000 original challenge definitions. Allocation report passes 520 advertised pools, all 134,940 pairs, four challenge checks and 84 letter selections. Ten insufficient-concept categories remain visible with reasons. | Source allocation is not a complete browser playthrough. Final catalogue inspection remains. |
| Local supplement | 24 categories × 18 entries = 432, covering kids/list/acting/drawing. Independent factual/ambiguity review, five corrections, and actual selectors for three nonrepeating matches per category. Six pack tests passed; combined real-mode pack/room run passed 8/8. | Keep separate authored-local provenance; these are not original saved-release questions. |
| Natural completion | Nine service/database combinations completed with zero unplayed items and persisted results: classic, kids, v4 list/acting/mixed, competitive tier/list/acting/mixed. | Does not substitute for nine multi-device browser playthroughs. |
| Shared rooms over HTTP | Live acceptance reported 8/9: host, two independent guest sessions, display, scoring, early finish and history. Competitive reports explicitly record HOST_ENDED, not natural completion. | v4 mixed HTTP rerun pending backend reload. First four successes were captured in tool output, not a persisted report. |
| Typed room submissions | Optional persisted submissions preserve old room JSON compatibility; room singleton transaction serializes submissions, normalized duplicates and removal/assignment. Competitive accepted receipt is verified before recording text; deterministic member/request/text binding supports recovery after engine commit with room rollback. V4 collection never auto-scores. Independent normalization, recovery and actual PostgreSQL v4/competitive checks pass 4/4. Submission count and 120 KB serialized budget are checked before engine mutation. | New actionsVersion 2 feature requires backend reload; independent database and security reviews concurred. Full guest browser attempt/canvas flow not accepted. |
| Room persistence/concurrency | Independently reproduced PostgreSQL tests 3/3: concurrent attach, ownership, lobby guard, admission/removal, display revocation, actor privacy, encrypted grants, canvas replay/reconnect. Aborted HTTP requests retain the room lock until engine work settles. | Latest source requires restart before live acceptance. |
| Local admin | Dedicated verified emulator UID/email, separate in-memory browser auth, real browse/edit/review/activate/restore. PostgreSQL/API tests 3/3 passed including concurrent head conflicts, reconnect and guest denial. Independent security review concurred. | Final rendered review and restarted-stack activation smoke check. Local editorial review is not automatic independent factual approval of future edits. |
| Immutable overlays | Append-only draft/review records, CAS active heads, derived local release identity. Original release and existing game pins remain immutable. Database-authoritative private snapshot is repaired at startup; Huroof archives old snapshots. | Cross-service publication is eventual, not one atomic transaction. Verify latest running processes after restart. |
| Rematches | Actual PostgreSQL suite 4/4: owner/source/version/idempotency checks, immutable predecessor, old metadata reconstruction, three explicit mixed boards with unseen refs then fail-closed exhaustion. Frontend rematch plus pending/round/competition/history regression run passed 128 tests. | Latest rematch backend still needs restart and live rematch/reconnect checks. |
| Huroof host creation | Saved-release POST requires verified emulator host and owner-scoped request key. Additive SQLite receipt, room/event/snapshot commit atomically; replay returns original capabilities. Actual source/emulator tests 2/2 include forced receipt-write rollback. Existing game service tests 35/35 passed using the main media directory. | Latest server source requires restart. Root caller integration/recovery review is ongoing. |
| Huroof rematch/history | Authenticated rematch requires a completed predecessor, its exact host capability and matching recorded owner where one exists; exact retries return the stored successor. Predecessor source/settings and cumulative consumed question/concept/family exclusions persist; parent is unchanged. Independent SQLite/source rematch tests 2/2 passed. Owner-only history reads are side-effect free; owner-access is an explicit authenticated POST. | Latest routes require reload and browser retry/reconnect acceptance. Legacy unowned host capabilities permit new owned successors without claiming the old room. |
| Huroof creation client | Typed definitive versus uncertain failures; credentials in headers only. Frontend/adapter tests 22/22 cover stale-owner dispatch/response fencing and rematch parent/source/header handling. Pending key retained for auth/conflict/server/network uncertainty. | Final lost-response/auth-change browser check. |
| Setup drafts/search | Categories, prompt refs, timers, teams, colours and aids persist per UID/mode; drawing scope separate. Competition search walks all signed pages, with progress/error rather than partial false results. Five focused tests plus 35 existing round/competition/page tests pass. | Final rendered setup inspection. |
| Category compatibility metadata | Focused compatibility test 1/1 agrees with all 1,839 selector checks: 554 category IDs (530 original and 24 authored), ten modes including six drawing categories; no private question fields. Strict server/test compilation passed. | Endpoint registration is source-only pending backend reload; independent public projection security review concurred. |
| Huroof retained snapshots | Legacy baseline c094fcbdc8674e70fd0c9ef39dc8e1ee2e5d027d9971a899d6fc9b888e064942 restored alongside current baseline and hash-checked archives. Malformed answers/tiers/duplicate overlay keys reject. Earlier real challenge setup/reconnect checks passed all four mechanics. | Preserve accepted rooms on latest restart. Tokens predating the persistent secret were already nonrecoverable; their rows remain. |
| Local build/boundary | Dedicated optimized almaidan-local build passed. No dotenv; exact demo/emulator/loopback opt-in; fixed local proxies; hosted-marker rejection; environment restoration. HTTP and real-capability WebSocket checks accept local and reject foreign Host/Origin. Independent security concurrence received. | Final reviewed candidate rebuilt successfully (222 modules). Existing preview 5175 serves the exact new index with HTTP 200 and readiness true; no process restart. Current main chunk warning: 709.48 kB minified. This is not backend reload, rendered acceptance or ordinary production-build qualification. |
| Theme/accessibility | Earlier light/dark/mobile screenshots retained. Shared semantic tokens, headers, theme controls and titles implemented. | **Not final:** complete current light/dark host/guest/display/results/admin review at 360, 390, 768, 1280 and 1920 px. |

## Mode-by-mode acceptance

These columns distinguish selector/service evidence, HTTP clients, and actual browser interactions. A pass in one column does not imply a pass in another. Browser observations below were reported by the root reviewer in the current session.

| Mode | Exact selector/content coverage | Natural service/database completion | Actual HTTP shared-room evidence | Actual browser evidence / gap |
| --- | --- | --- | --- | --- |
| Huroof letters | Original 530-category source; 84 letter selections checked; four original challenge mechanics exercised with actual definitions. | No full natural browser-match acceptance inferred from service tests. | Authenticated creation/rematch has isolated SQLite/emulator tests; latest live route acceptance remains separate. | Room BAAF4C: real question opened, then explicit early finish. This is not natural completion or rematch/reconnect acceptance. |
| Huroof categories | 520 eligible category pools / 530 original; all 134,940 pairs checked. Ten categories retain insufficiency reasons. | Original-source challenge setup/reconnect tests pass; not a full category-board match. | Latest owned creation/source preservation tested in isolated service/API harness. | Complete category-board browser playthrough remains pending. |
| Enta classic | 453 eligible text categories. | All 36 questions completed and result persisted. | Host + two guests + display + scoring/early finish/history reported; tool-output evidence only. | Full browser match pending. |
| Enta kids | Six authored categories, 18 entries each; six per match, three nonrepeating matches. | All six questions completed and result persisted. | Same shared-room flow reported; tool-output evidence only. | Root completed all six questions to a tied result and inspected rematch review. Successor creation/reconnect is not implied. |
| Round list | Six authored list categories. | Four rounds / 12 scored entries completed. | Same shared-room flow reported; tool-output evidence only. | Full browser match pending. |
| Round acting | Six authored acting categories. | Four rounds completed. | Same shared-room flow reported; tool-output evidence only. | Full browser match pending. |
| Round mixed | 458 selector-compatible categories. | All 36 rounds completed. | Prior HTTP runner failed before acceptance; rerun pending. | Full browser match pending. |
| Competitive tier | 440 strict-text categories. | All 36 rounds completed, zero unplayed. | Persisted report records shared-room flow and HOST_ENDED. | Full browser match pending. |
| Competitive list | Six authored list categories. | Four rounds completed, zero unplayed. | Persisted report records shared-room flow and HOST_ENDED. | Full browser match pending. |
| Competitive acting | Six authored acting categories. | Four rounds completed, zero unplayed. | Persisted report records shared-room flow and HOST_ENDED. | Full browser match pending. |
| Competitive mixed | 458 selector-compatible categories. | All 36 rounds completed, zero unplayed. | Separate persisted report records shared-room flow and HOST_ENDED. | Full browser match pending. |
| Drawing logical alias | Six authored drawing categories / 108 entries; drawing capability is a format within the engines, not an additional independently completed engine mode. | Canvas/grant/replay persistence tests pass; nine natural completions above do not independently qualify drawing UX. | Capability privacy/revocation/replay tests pass; full live drawing flow not accepted. | Room E1-SWBRMYME / match 33e9a6d0-e562-4cf5-839e-7e9a59526b6e: host, two guests and display joined. Four drawing rounds auto-ended at their deadlines; assigned actor Sara received private سجادة and writable canvas, while display showed generic prompt. No stroke was accepted before deadline. Host then early-finished with 32 unplayed rounds; persisted result v1 agreed on display. **Partial only: no complete match or canvas mutation proof.** Earlier private-view/read errors recovered; guest/API repair remains under review. |

Content totals are 115,636 immutable original questions across 530 categories, plus 432 independently reviewed authored-local entries across 24 categories (six each kids/list/acting/drawing). Compatibility exposes 554 distinct IDs. The selector report records 1,839 category/mode checks with zero failures; its 458-category mixed catalogue and overlapping per-mode counts must not be added as unique original-category totals. Media verification covers 4,578 files and original challenge validation covers 2,000 definitions.

## Latest UI regression scope

`D:/projects/huroof_wa_oloof/local/almaidan/ui-regression-final.json` records 505 passing tests, two optional private-corpus tests skipped, zero failed across 48 test files. Earlier `ui-regression-latest.json` is preserved with 503 passing, two skipped across 47 files. The newer snapshot precedes the final duplicate/receipt fixes. It does not qualify those later edits or replace browser gameplay checks. After both independent reviews, the final candidate was rebuilt with 222 modules; focused regressions and build checks below apply to that candidate.

## Screenshot index and limits

Screenshots are preserved under `D:/projects/huroof_wa_oloof/local/almaidan`. Dimensions below are the root reviewer's verified viewport widths, not inferred solely from filenames.

| Files | Valid observation | Limit |
| --- | --- | --- |
| `display-dark-{360,390,768,1280,1920}.png` | Kids display, dark theme at each stated width. | Display layout evidence, not host/guest workflow completion. |
| `huroof-modal-dark-390.png` | Huroof modal at 390 px, dark theme. | Single modal state. |
| `huroof-result-dark-{360,390,768,1280,1920}.png` | Huroof result whole-page captures at stated widths; overflow checked. | Dark result layout only; match ended early. |
| Huroof result light equivalents | Captures retained. | 390 px immediate capture has a blank lower region; not signed off. Fresh light 390 capture remains needed. |
| `result-light.png` | Kids result, actual 1280 px. | One light desktop result state. |
| `result-light-360.png` | Retained historical capture, **actual 1280 px**. | Mislabelled: never use as 360 px/mobile evidence. |

Additional verified captures: `kids-result-light-390-verified.png` and `kids-result-dark-390-verified.png` were visually inspected at actual 390 px (375 px page DOM) and are readable. `room-host-dark-390-viewport.png` is valid viewport evidence. Do not use `room-host-dark-390.png`: its full-page capture has a rendering-offset artifact despite correct DOM/viewport.

`drawing-early-finish-host-dark.png` and `drawing-early-finish-display-light.png` are 1280 px viewport captures of the same partial drawing result, not natural completion evidence.

Current CategoryCompatibility component tests pass 2/2. Final light/dark host, guest, drawing, admin and responsive flow acceptance remains incomplete; these screenshots must not be generalized to unobserved routes or states.

## Evidence index

Reports below are in `D:/projects/huroof_wa_oloof/local/almaidan`:

- `supplemental-content-coverage-reviewed-v1.json`: authoritative reviewed pack. Earlier `supplemental-content-coverage-v1.json` retained as candidate evidence.
- `enta-allocation-coverage-1793839454866.json`: 1,839 actual selector category/mode checks, zero failures (source-level coverage, not live HTTP).
- `catalogue-allocation-1793837515150.json`, `media-index.json`, `real-challenge-definitions-report.json`: saved-source allocation/media/definition checks.
- `natural-classic-classic-1793837889774.json`, `natural-kids-kids-1793837890085.json`, `natural-round-list-1793837891698.json`, `natural-round-acting-1793837892847.json`, `natural-round-mixed-1793837900438.json`: five persisted natural completions.
- `natural-competitive-readback-1793838062444.json`: four competitive natural completions, zero unplayed rounds and result hashes.
- `rooms-http-acceptance-1793837583027.json`: competitive tier/list/acting only. `rooms-http-acceptance-1793837620502.json`: competitive mixed. Classic/kids/v4-list/v4-acting live successes are earlier tool-output evidence; the interrupted runner did not save their final report. Do not claim these two files prove all eight.
- Test sources in the worktree: `services/enta/server/src/local-development/{content-pack,content-admin,content-admin-http,rooms,rematches}.test.ts`; `tests/game/{local-owned-room-creation,local-owned-room-rematch,service}.test.ts`; `tests/app/{enta-setup-drafts,local-owned-create,enta-local-rematch}.test.tsx`; `tests/local-build-config.test.ts`.
- Earlier pending-start/auth/theme run: 153 passing tests. Preserve it as earlier candidate evidence, not a final suite result for all later edits.

## Remaining acceptance

1. Finish ongoing UI changes and reviews. Current backend restart was blocked by tool policy; do not describe source changes as deployed or invent a successful restart.
2. When authorized execution is available, restart only the identified local Huroof/Enta processes, preserving databases, Auth Emulator and keys.
3. Rerun v4 mixed HTTP acceptance plus current authenticated creation/rematch/overlay flows, replay and reconnect.
4. Finish rendered acceptance and repeat affected preview flows against restarted services. The final candidate local build and existing-preview static/readiness checks passed; rebuild again only if source changes.
5. Replace pending entries only with actual resulting evidence. No production deployment or LAN exposure is included.

## Final candidate build check — 2026-11-05

Dedicated local build passed with 220 modules; app, game, node and strict local server-entry TypeScript checks passed. Huroof rematch frontend/adapter tests passed 22/22; local build guard test passed 1/1. Existing preview on 5175 returned HTTP 200 with an index byte-identical to the new artifact and readiness true. Neither preview nor blocked backend processes were restarted. The 703.62 kB main JavaScript chunk remains a performance warning; no threshold was raised. These checks do not close the pending backend reload, live retry/reconnect, v4 mixed HTTP or final rendered light/dark/device acceptance gaps.

## Reviewed final artifact — 2026-11-05

After final typed-submission database and security concurrence, the dedicated isolated build passed with 222 modules. App/game/node/strict local server compilation passed; focused Huroof frontend/adapter tests passed 22/22, independent typed-room checks passed 4/4, independent security regressions passed 7/7, and build guard passed 1/1. The existing preview served the exact new index and JavaScript module with HTTP 200; readiness was true. Index SHA-256: `56dcc8dfb0694235b3a5b56cf612f4baafdf6963c6f7ee657d6d2c78077cbd56`; entry module: `assets/index-BQdfPVkd.js`. Main chunk is 709.48 kB minified (154.91 kB gzip), retaining the size warning without increasing thresholds. No backend or preview process was restarted.

The competitive adapter's outer service already throws internal engine rejection. The added exact accepted-receipt validation is defense in depth at the local room boundary; it is not evidence that production previously accepted stale commands. Current actionsVersion 2 remains a source/build capability until the corresponding backend is reloaded. Final live typed submission, full canvas stroke/reconnect, remaining modes and full responsive theme acceptance remain open as described above.
