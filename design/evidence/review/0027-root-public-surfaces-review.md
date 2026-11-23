# Root technical acceptance — INT-060.V — 2026-10-04

## Decision

Done for this presentation slice under human homepage approval0026 and the approved shared application DESIGN-DNA. This is technical acceptance, not full INT-6/7 integration, live authentication, approved content, payments or production acceptance.

## Integrated review and reproduced checks

Root inspected DELTA.patch for GameRoutes, MediaCredits, App status and scoped shared-app CSS. The changes retain existing host logic, routing/guards and gameplay bodies. Reviewed actual host and mobile help renders against the warm neutral/pink Arabic task-screen contract. On the final build at127.0.0.1:4173, Root opened the real host setup, activated the keyboard skip link and confirmed main-content focus, then used the header to open the real help route. The help diagram has no actionable controls in its accessibility tree. No room creation, credential entry or database mutation occurred. The local host catalog is existing demo content, not production editorial acceptance.

Root independently verified all1243 entries in FREEZE.json with zero mismatches. Forge reports11 scoped tests, typecheck, scoped lint, diff checks and frontend build passing;72 fixture state renders,24 built-route renders,6 keyboard/reduced-motion cases and2010 contrast roles.223 protected hashes,101 non-owned game AST statements,55 host logic statements, App routing/guards and previous shared CSS prefix remain unchanged. See the frozen REPORT.md for exact checks and outputs. Existing Vite chunk-size warning remains.

## Evidence limitations

The original42 before PNGs and their capture manifest were accidentally overwritten during implementation. They are invalid before evidence. Exact source snapshots survive. The single reconstruction attempt timed out and produced no images. Final captures and source preservation evidence are valid; no before/after pixel-preservation claim is made. Prior INT-070.A optional broad legacy failures remain disclosed in its report; this slice does not establish whole-suite success.

## Evidence and next work

Source/evidence: C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof/output/int060v-public-surfaces-20261004/REPORT.md, FREEZE.json, DELTA.patch and root-live-host.png.

Continue remaining gameplay/admin/supporting screens using the approved DNA and existing integration contracts. Functional game admission, reviewed content, fresh production infrastructure, undecided payment provider/currency, and staging/cutover gates stay open. Preserve the mixed checkout and protected INT-5B draft.
## Owner summary placement correction — 2026-10-04

Owner requested the live summary below the setup fields. Changed only isolated src/styles/shared-app.css: single-column setup grid, normal-flow final summary instead of sticky side column. DOM/source order already placed it last. Vite frontend build passed with existing large-chunk warning. Live4173 DOM geometry confirmed summary below every preceding form child, static position and no horizontal overflow; final viewport screenshot saved under the V output as summary-below-owner-correction.png. A screenshot positioning attempt to focus the nonfocusable aside timed out; used native End/scroll successfully. No gameplay/form logic changed. Earlier frozen manifest remains historical and does not describe this later CSS/build correction.

## Owner wide-page correction — 2026-10-04

Owner requested app pages use more browser width rather than centered boxes. Isolated shared-app.css removes1072px host/help and720px attribution/status caps; desktop content follows32px edge gutters, mobile retains24/16px. Category tiles auto-fill available width at220px minimum rather than stretching three giant columns. Live summary remains below all fields. Compact login/join forms retain readable widths. Approved homepage and gameplay bodies were not restyled by this correction. Frontend build passed (existing large-chunk warning); real1280px browser host layout has32px left gutter,1201px content width after scrollbar, no cap/no overflow and static summary. Screenshot: output/int060v-public-surfaces-20261004/wide-host-owner-correction.png. Earlier freezes remain historical.
