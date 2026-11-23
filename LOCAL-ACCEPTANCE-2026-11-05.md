# Almaidan local acceptance — 2026-11-05

The app runs at http://127.0.0.1:5174/; optimized local preview is http://127.0.0.1:5175/. Both use the isolated services on this computer. This report supersedes the earlier restart-blocked entries in LOCAL-IMPLEMENTATION.md. Browser continuation uses Chrome after the in-app preview stopped accepting input. The remaining browser journeys, media checks and representative visual checks are complete. This is local acceptance, not a production sign-off; bounded limitations are listed below.

## Execution and data boundaries

The earlier execution rejection was not bypassed. At the start of this continuation the old API processes were absent, so the existing launcher started missing services normally. Later, normal execution accepted narrowly identified Enta process restarts. All final backend changes are loaded. Auth, PostgreSQL, SQLite files, signing keys and previous matches were preserved.

Ports 5174, 5175, 14001, 18787, 19099 and 15439 were verified bound to 127.0.0.1. No hosted environment or payment service was used. The original saved capture and derived original local content retain their SHA-256 values:

- CAPTURE-v4.json: e3d4bcf074489eb0751767793c3ba5af12f719e5c94f4ed8e1be1949193bb23a
- real-content.json: 7ce29d3d9e58f8ca89cb32f50bf47342f86e138d90f85b283ecefbf5eca28a54

## Content coverage

| Content | Coverage |
| --- | --- |
| Original saved release | 530 distinct category IDs, 115,636 questions |
| Reviewed local supplement | 24 categories, 432 entries: six categories each for kids ages 7–10, lists, acting and drawing |
| Combined catalogue/admin | 554 categories, 116,068 entries; source IDs and provenance remain distinct |
| Huroof category selection | 520 ready pools; ten insufficient categories retained with explanations |
| Enta classic / competitive text | 453 / 440 compatible pools |
| Enta mixed | 458 compatible pools; mode counts overlap and must not be added as unique categories |
| Selection verification | 1,839 category/mode allocations, zero failures; three nonrepeating matches per authored selection |
| Original media/challenges | 4,578 hash-verified media bindings; 2,000 original challenge definitions |

Reports in D:/projects/huroof_wa_oloof/local/almaidan: enta-allocation-coverage-1793839454866.json, catalogue-allocation-1793837515150.json, supplemental-content-coverage-reviewed-v1.json, content-admin-browse-live-1793853584182.json.

## Actual runtime evidence

All nine Enta room families passed authenticated host + two independent opaque guest credentials + read-only display, role permissions, scoring, early finish and history. This is actual HTTP/PostgreSQL/Auth Emulator evidence, not mocked services. The subsequent natural-completion run passed all nine: 146/146 prescribed questions/rounds, 728 guest/display privacy assertions, 36 drawing canvas/display checks, nine histories and nine idempotent rematch lobby creations with unchanged predecessors. Host rulings and guest submissions were scripted. The host reassigned the two guest identities to active seats; this does not claim a separate browser session for every roster slot.

| Family | Natural completion | History / rematch | Evidence |
| --- | --- | --- | --- |
| الخلية / letters | Two complete rounds, ten correct moves | Verified / new lobby 97AFB9 | HTTP/WebSocket and full Chrome journey |
| Categories | Two complete rounds, ten correct moves | Verified / new lobby 8A4673 | HTTP/WebSocket and full Chrome journey |
| Enta classic | 36/36 questions; 7200–7200 | Verified / new lobby E1-4QDXYEYE | Real HTTP and full Chrome journey |
| Kids ages 7–10 | 6/6 questions | Verified / idempotent | Real HTTP; earlier browser result |
| Lists | 4/4 rounds, 12 judged items | Verified / idempotent | Real HTTP and full browser journey |
| Acting | 4/4 rounds | Verified / idempotent | Real HTTP and full browser journey |
| Drawing | 36/36 rounds | Verified / new room | Full browser journey; canvas also covered in both HTTP mixed modes |
| Mixed | 26/26 rounds, all four formats; 5300–4400 | Verified; truthful exhaustion recovery; separate non-exhausted mixed rematch created | Real HTTP and full Chrome journey |
| Competitive classic | 36/36 rounds; 7200–7200 | Verified / new lobby E1-E4T3RUYX | Real HTTP and full Chrome journey |
| Competitive lists | 4/4 rounds, 12 judged items; 400–800 | Verified / new lobby E1-2UGAQCZ5 | Real HTTP and full Chrome journey |
| Competitive acting | 4/4 rounds; 200–200 | Verified / new lobby E1-DVLYYZ7R | Real HTTP and full Chrome journey |
| Competitive mixed | 26/26 rounds, all four formats; 4800–4800 | Verified / successor E1-MP5NQ4SZ | Real HTTP and full Chrome journey |

The nine-case HTTP matrix is `rooms-http-acceptance-1793855268196.json`. Every finish used `confirmEarly:false`; results reported ALL_QUESTIONS_PLAYED or ALL_ROUNDS. It is reproducible through the existing room acceptance script with `ALMAIDAN_ROOM_MATRIX_COMPLETE=true` in its isolated local environment. The browser column identifies actual UI coverage separately from HTTP verification.

- rooms-http-acceptance-1793852181762.json: all nine room families.
- rooms-live-recovery-1793852246690.json: typed list/competitive submissions, duplicate/empty rejection, private response separation, real deadline expiry, exact retry after close, rematch setup/idempotency and restart readback.
- huroof-live-coverage-1793852670900.json: HTTP/WebSocket ownership and joining, natural letters and categories matches, reconnect, history, all four original challenge mechanics, authorized image/video bytes and guest denials.
- admin-live-review-1793852968506.json: browse/search, ordinary host/guest denials, immutable draft/review, saved identity restoration.
- admin-publication-http-1793853443982.json: actual reviewed activation A→B, CAS head switching, original and archived-overlay rematches, unseen questions and exact retries. Original active release restored; original file unchanged.

## Browser observations

Browser sessions use real app controls. Adjudication during repeated rounds is scripted; these checks do not assert human knowledge or guessing ability.

| Journey | Observed result |
| --- | --- |
| Kids | Earlier six-question browser match completed with 1,200–1,200 result; preserved across later startup |
| Drawing | E1-X43PBMRP, all 36 rounds, 9,200–5,200; two separately room-authenticated guests, same-team seats, assigned private prompt, real keyboard canvas stroke, typed guess, display synchronization and guest reload. Result survived Enta restart. Rematch created E1-YHCFRMYU with retained six categories/teams |
| Lists | E1-L93CRQZT, all four rounds / 12 items, 600–600; real guest submission, host-only judging guide, host score controls and matching display result |
| Acting | E1-KVV4XSQT, all four rounds, 200–200; private performer target moved between two teams, other guest did not receive it |
| History | Finished drawing/list/acting scores visible in the account history |
| Missing tile | Original 374ECB puzzle rendered; correct blue-circle choice accepted, score became 1; returned to board and host-ended review room |
| Memory | Original 8DB2E2 observation/recall/reveal rendered. Reviewer answered incorrectly because left-origin columns were unclear. UI now explicitly labels coordinates and origin; no rule or answer was changed. Returned to board and host-ended review room. New rematch149140 verified labelled observation, color-hidden recall and correct ordered answer through guest UI, score1 |
| Navigation | Original 18C3FA movement board rendered; host movement, pause, cancel and board return exercised. Correct complete path and guide privacy are covered by HTTP report; separate guide now completed all 11 correct moves with zero strikes and a saved point |
| Word search | Original 555F4F grid rendered; keyboard endpoint selection (row2,col3 → row5,col6) spelled شراع, accepted with score1; solution reveal and return exercised |
| Original image question | A5753C geometry image decoded at 960×760 and was visually inspected; answer 120 سم² scored once, board updated to one point, host-ended result confirmed in history |
| Admin | Real separate admin login; 554-category dropdown, authored kids preview/provenance, draft creation and review. New UI draft remains inactive. Logged admin out afterwards |
| Invalid Enta code | E1-INVALID1 remained on Enta; actionable Arabic missing-room message, no legacy fallback |

Browser record: `browser-natural-journeys-current.json`. Chrome verified original video E370F7 at 854×354, duration2.302302s, readyState4, played to its end with no media error. It was host-ended and appeared in history. The earlier preview-control blocker is resolved by the approved Chrome fallback.

Additional reports: `huroof-browser-acceptance-20261105.json`, `chrome-classic-browser-current.json`, `browser-competitive-classic-acceptance.json`, `browser-competitive-list-acceptance.json`, `browser-competitive-acting-acceptance.json`, `browser-competitive-mixed-20261105.json`, and `LOCAL-MIXED-BROWSER-ACCEPTANCE.md`. The mixed actor-only prompt was separately verified in a six-round mixed acting match with300–300 tie and fresh successor E1-VGMVCTRZ. The main mixed match's drawing category had legitimately consumed all18items across three previous allocations; exhausted creation made no empty room and now offers another-category setup.

## Repairs found during live review

- Shared room assignment now selects a free roster seat instead of always seat zero; occupied seats/full teams are disabled. Exact server validation remains authoritative.
- Direct guest/display drawing routes now load canvas styling, keeping dark strokes on readable paper.
- Drawing setup names the drawing board correctly. Displayed elapsed time is clamped to avoid briefly showing 121 seconds for a 120-second round; server deadlines remain authoritative.
- Homepage copy reflects local accounts and same-computer sessions. Tablet room-code layout stacks its controls so complete E1 codes fit.
- Admin secondary actions use shared semantic button styles; long identities/hash metadata wrap.
- Original challenge screens now use shared themes, compact brand/home/theme controls and readable actions. Memory coordinates state upper-left origin; word-search setup explains its own rules.
- Legacy classic/kids rematches resolve the exact original/archived predecessor release. Published snapshots use atomic immutable archive publication, preventing a partial crash-written archive from silently repinning content.
- Startup restores only the saved local admin identity if missing from the emulator import. Existing accounts/passwords are validated and preserved.

## Verification and visual limits

Full frontend regression at this continuation:522passed, two optional private-corpus tests skipped, zero failed (`ui-regression-browser-final.json`). Subsequent focused room/results checks passed21/21; pending/auth/rematch safety review independently passed187/187. App/game/node type checks passed. Subsequent challenge changes passed 18 focused tests, with the same two optional-corpus skips, and app compilation. Reviewed provenance/archive tests passed 4/4 independently; admin startup review found no blocking findings. Earlier required independent security/database reviews remain bounded to the actual room, admin and additive persistence changes reviewed.

The shared semantic palette passes 32 explicit opaque color-pair contrast checks across both themes: normal/muted/accent/error text on canvas/surface/subtle, white action labels, and control borders. Minimum text contrast is 5.64:1 and minimum border contrast is 3.18:1 (`shared-theme-contrast-current.json`). This validates those token pairs only; this is not a blanket result for imagery, overlays or every game state. The rendered follow-up checked 48 visible text nodes across account and results in both themes with no measured failures (`rendered-contrast-browser-final.json`).

Latest isolated optimized build passed with 223 modules. The served index exactly matches SHA-256 `7b406230a7d8c7d23b3594e42e09246400e1d5212d60bcf2d7f5190eef273dc1` (`optimized-preview-current.json`). Final optimized homepage loaded this build, restored its signed-out state correctly, and the development homepage restored the local host account. Main chunk remains a performance warning at 711.74 kB minified /155.56 kB gzip; no threshold was raised. This local build does not disable hosted-production guards.

Entry card layouts were checked at 360/390/768/1280/1920 in light and dark, with no page horizontal overflow. The 768px code-field defect was repaired and recaptured. Desktop full-bleed hero, contained ordinary sections, mobile room lobby, display canvas, results and admin previews were inspected. Chrome subsequently completed representative setup, category search, room, question, error, results, account, rules and episode-empty views. Enta boards and both game-family results were checked across360/390/768/1280/1920with no whole-page horizontal overflow. Enta rails and Huroof results are capped at1200px. Theme choice survives reload, including system selection. This remains a representative visual review, not a complete WCAG certification.

Useful screenshots under the evidence root:

- home-hero-light-1920-current.png
- entry-dark-360-current.png; entry-light-768-current.png (tablet fix)
- live-drawing-display-stroke-fixed.png
- drawing-complete-host-dark.png
- list-complete-host-dark.png
- acting-private-performer-light.png; acting-complete-host-dark.png
- admin-preview-light-1280.png; admin-preview-dark-390.png
- original-image-question-dark.png; original-video-chrome-dark.png
- chrome-board-{light,dark}-{360,390,768,1280,1920}.png
- chrome-huroof-result-{light,dark}-{360,390,768,1280,1920}.png
- browser-competitive-{classic,list,acting}-result.jpg

Authored supplemental formats and original media/challenge definitions are immutable admin previews; ordinary text questions and category labels support new draft/review/publication overlays. This is not an all-format authoring editor. Original release files and old match content never change.

## Browser continuation repairs and isolation

- Fixed nested deferred authentication providers so homepage→setup navigation retains one owner runtime. Owner epoch invalidation and guest/display capability separation remain intact.
- Normal Huroof name joining now advertises the existing challenge protocol; actionable Arabic errors replace raw protocol JSON. Setup cancellation uses the existing host VOID action. Incomplete results no longer falsely claim content exhaustion.
- Equal Enta category names now show distinct unchanged collection IDs. Selection remains selected across search changes.
- Room command errors remain visible through successful background polls. Snapshot version conflicts now explain refreshing round details rather than claiming a service outage.
- Huroof host results provide history/home navigation; guests are directed to request a new room from their host.
- The launcher waits for PostgreSQL readiness after normal recovery. No reset or cache/data deletion is used.
- Stable local polling no longer rewrites unchanged entire JSON states. The original transaction locks, callbacks, deadlines and mutation persistence remain. Six actual PostgreSQL no-op/concurrency/rollback checks and ten focused durable engine cases passed. Three old test category-count assertions were updated for the existing reviewed supplement; behavior checks were retained.
- Independent source/security report: `security-browser-final-review.md` (187focused tests). Independent database concurrence: `D:/projects/huroof_wa_oloof/database-polling-final-review.md`. Database check evidence: `database-polling-validation-current.json` and `local-store-write-elision-current.json`.
- For the final local API restart, both active competitive matches were paused through UI. No in-flight commands were retried blindly; existing database/key files were reused. Acting restored13seconds and mixed restored105seconds with identical scores and guest identities before UI resume.
- Original capture/local content hashes were rechecked unchanged. All services bind127.0.0.1. New review records remain isolated; existing games and original content were not edited or removed.

One original question answer includes editorial review annotations (category`tahadani-052`, question`64084399fa942ab73c843989c25580cb4d659db8e730e63dc6e37cb9f0267d16`). The exact answer identity/source is preserved; this is an original-content cleanliness limitation, not a fabricated correction. The local catalogue is not a fresh factual audit of all115,636original questions.

## Handoff artifacts

- Restart/service instructions: `LOCAL-ALMAIDAN.md`.
- Live service/binding verification: `D:/projects/huroof_wa_oloof/local/almaidan/final-local-readiness-current.json`.
- Browser evidence index: `D:/projects/huroof_wa_oloof/local/almaidan/browser-natural-journeys-current.json`.
- Final homepage screenshot: `D:/projects/huroof_wa_oloof/local/almaidan/almaidan-final-browser-home.png`. Temporary browser viewport overrides were reset; the main local app remains open.

## Nonblocking scope limits

- The optimized main bundle remains above the existing 500kB warning; no threshold was raised. Stable polls no longer rewrite identical JSON, but the local stores still read/serialize whole state and are not a production scaling claim.
- The admin editor supports text/category overlays. Special-format and media/challenge definitions have immutable previews rather than a complete authoring editor.
- The original content is preserved, including the editorial annotation noted above; all original questions have not been fact-checked again.
- Visual checks cover representative states and five requested widths. They are not a full accessibility certification; system-theme selection persistence was checked, while a live operating-system appearance toggle was not exercised.

## Final competitive mixed closure

Chrome completed E1-C3TYMBJN through all 26 rounds (18 original text, six drawing, one list and one acting), tied 4,800–4,800, with matching read-only display and saved history. Rematch E1-MP5NQ4SZ was created successfully. A focused drawing check in that successor confirmed a visible black right-angle stroke on both the drawer and independent display, while the private prompt stayed hidden from the display. That new review successor was explicitly host-ended at 200–0 after one of 26 rounds; its predecessor remains naturally complete. Evidence: `browser-competitive-mixed-20261105.json` and `browser-competitive-mixed-canvas-{drawer,display}-confirmed.png`.

All remaining browser checks in `browser-natural-journeys-current.json` are closed. The final checks found no unresolved defect blocking local creation, joining, playing, scoring, finishing, history or rematch. Stable polling latency improved in the observed competitive rounds from roughly 25–30 seconds per multi-command browser round to about 8–12 seconds; this is an observed local sample, not a benchmark guarantee.
