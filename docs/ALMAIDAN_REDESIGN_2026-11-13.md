# Almaidan redesign — approved implementation contract

Authority: owner's implementation request in this chat, 2026-11-13. This contract supersedes conflicting historical pink/warm, viewport-wide rails, typography and archived workflow instructions in older design documents. Existing runtime, data, privacy and independent safety-review boundaries remain binding.

## Direction

Preserve navy, cyan, royal blue and white, fantasy homepage art, existing illustrations, homepage section sequence and white/navy alternation. Balanced clear density. Contextual public/account/admin navigation, minimal host/player/audience game chrome; no global sidebar. Current Almaidan is the dominant design reference. Narrow Refero references inform chapter hierarchy (Discord), host/join choice clarity (Marathon) and initiation/pending/destination feedback (Melius), never replacement palettes or fonts.

## Shared contract

- **Owner reference-container correction, 2026-11-13:** [measured Qolbha geometry](QOLBHA_CONTAINER_REVIEW_2026-11-13.md) supersedes the fixed1200px outer cap and pixel gutters. Use a centered outer border box `inline-size:min(100%,var(--page-canvas-max))`, where the cap is80.063 times the reference-responsive layout unit; add one internal gutter. Nested rails fill their parent's content box without a further gutter subtraction.
- Layout unit: `clamp(16px,calc(16px + (100vw - 1920px)*.014651),60px)`, at least17px from1280px and19px from1536px; compact landscape uses the measured12/14px geometry units. Internal gutter is1unit below576px and1.5units from576px. This scales only layout geometry, not global font size. Normal desktop examples: outer1361.06px/usable1310.06px at1440; outer1521.19px/usable1464.19px at1920.
- Task/admin/game outer workspaces use this shared responsive cap; inner account1000px, prose760px, auth/local-admin-signin560px and join520px remain intentional readable maxima. Nonhero content remains contained; homepage hero art is full width and hero copy aligns to the shared rail. Inner canvas is solid theme color, with no background image.
- Header72px desktop/minimum64px mobile; can grow for text. Content begins40px below desktop header,32px tablet,24px mobile. Ordinary panels24px desktop/20px mobile; auth32px/24px/16px <=360px. Sectiongaps32px/24px; homepage sectionspace80px/56px/40px.
- Setup >=1024px: flexible form +320px summary,24px gap, summary sticky below header; below1024px summary after fields in normal flow. Single long form, no new wizard: game/basic settings, teams/players, content/categories, timing/options, summary/start.
- Admin may use216px localnavigation +24px gap +flexibleworkspace within1200; collapse below1024. No duplicate navigation on focused player/audience surfaces.
- Semantic frontend page variants: authentication, reading, account, workspace, setup, game, status. Existing route identifiers remain compatible.

## Typography and controls

**Owner font replacement, 2026-11-13:** the supplied Cairo / Instrument Sans reference supersedes the earlier IBM Plex Sans Arabic / Lalezar choices. The active stack is `"Cairo", "Instrument Sans", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`. Self-host Cairo's Arabic variable face and Instrument Sans Latin/Latin-ext variable faces with their official unicode ranges and OFL licenses. Use Cairo 900 for the hero and wordmark, 800 for page/major section titles, 700 for smaller headings and buttons, 600 for labels and 400 for body text. Preserve colors, layout, type sizes and role-specific board geometry; adjust only clipping/wrapping defects caused by the new font metrics. Old assets/evidence are retained as history.

No synthetic weight, Arabic tracking or distorted glyphs. Codes/emails/identifiers use bdi/LTR isolation; intentional monospace code roles remain. Scores/timers tabular numerals; board lettering and game question roles retain independent geometry.

| Role | Desktop/mobile px | Weight/line-height |
|---|---|---|
| Hero |56/36|900/1.25|
| Home section |36/28|800/1.35|
| Inner title |36/28|800/1.4|
| Section |24/22|700/1.45|
| Card |20/18|700/1.5|
| Body/value |16/16|400/1.7|
| Label/button |16/16|600/700, line-height1.5|
| Supporting |14/14|400–500/1.6|

Spacing scale4/8/12/16/20/24/32/40/56/80px; fieldgap20,labelgap8,hintgap6,actiongap8–12. Controls48px minimum,utilities44px. Radius controls10,cards16,dialogs20px. No fixed-height text cards. Essential text >=14px.

## Palette and surfaces

Keep brand chapters #080e1e/#0f1a36, homepage action#2563eb, app action#175bc4; current theme-appropriate cyan accent; lightcanvas#f3f6fb/surfacewhite; darkcanvas#081321/surface#142236. Keep current semantic text/error/focus and game-specific ownership/team/answer tokens. Consolidate product tokens; do not indiscriminately remap gameplay semantics.

Gradients permitted only existing hero, restrained navy→blue featured/results banners, subtle brand-art cyan illumination. Normal cards/forms/tables/alerts/inner canvases solid, labels on stable contrast-tested backgrounds. No ordinary gradient text. Maintain intentional white homepage sections in both themes.

## Route-family delivery

Reconcile all71 current declarations/69 unique inner patterns against src/app/App.tsx, including aliases/nested routes and wildcard. There is no tournament route.

- Home: preserve hero→create/join→games→phones→discovery→catalogue→sharing→FAQ→final/footer. Generic hero/final Start goes to gamechoice; specific Start goes exact game setup; Rules inline; room code goes join. Honest catalogue fallback/error.
- Guides: general approach then each game rules, compact intro/anchors/numbered steps,760px reading measure, board beside text desktop and below mobile. Contact/credits retain mailto/attribution. Episodes catalogue2columns/1mobile with real data/states; no inventedplayer/details. Study unavailable stays unavailable; fixture any existing supportedstates.
- Login560 stableloading, concise field/action errors, preserve local-email versus hostedproviders and safe returnTo. Account1000 identity/verification/favorites/history/session contextualsections; preserve eligibility/unresolvedoperation guards. Join520 roomcontext/name/validation/retry, preserve protocolrouting.
- All host/new modes Huroof/categories/Imposter and Enta new/kids/drawing/list/acting/mixed/competitive classic/mixed/list/acting: shared setup composition, actual selectedcount/contentcompatibility, legal disabledreasons, same pendingattempt/uncertainty recovery, no duplicate start.
- Huroof room lobby/host/play/display/results, Imposter room, Enta room host/play/display and all classic/round/competitive match routes: role-specific state→board/challenge→legalactions→recovery. Preserve Huroof25cellgeometry/axes/teamcolors; Enta6→3→2 reflow/drawing/media; Impostersecret/clue/vote/reveal/guess. No private answers/hostcontrols in public payload or display. Connection/offline/stale/closed clearly distinguished.
- All Enta results/originalresults/historyaliases/rematches/localrematches/Huroofrematch/capabilities: outcome then scores/provenance then permittedactions; filters and states truthful. No new formats, capability bypass, fabricatedrecords or credit behavior.
- Localadmin560 isolated signin then1200 editorworkspace; localimportreview1200 filters/counts/content/pager. Hosted admin overview/questions/categories/drafts/reviews/releases/rooms/users/audit/health/settings/detail routes: consistent toolbar/list/detail, source/media/status groups, publishedread-only, draft/review/activate distinct, dirty-navigation/revisionconflict protections retained.
- Legacy question redirects, 404, suspense, chunkfailure, staticpreviewunavailable: shared stable status shell with actual recovery actions.

## State/accessibility acceptance

Cover applicable loading/empty/populated/validation/requesterror/unauthorized/unavailable/pending/success. Distinguish failedrequest from zeroresults. Preserve enteredvalues after recoverableerror, focus/menu/dialog restoration, keyboard/skiplinks, labels and associatederrors, reducedmotion,200%zoom,mixedRTL/LTR,contrastboth themes,text/icon semanticcues. No primary action hidden by fixedchrome/softwarekeyboard/safearea. Tables scroll internally, document never horizontally.

No backend/schema/auth/permission/billing/publication/protocol changes. Keep player/localadmin sessions separate with current restore/logout/identity epochs. Do not create rooms or mutate retaineddata for visual verification; protected phases use synthetic fixtures or already-authorized read-only session.

## Verification and delivery evidence

Sequence: sharedfoundation→navigation/simplepublic/auth→home→account/history/results→setupvariants→gamephases→admin/editors→completecoverage. One sharedstyles owner; independent family owners after foundation contract.

Test widths320/390/768/1024/1440 pluswidecap, both themes. Verify populated protectedfamilies, not onlygates. Reuse meaningful auth/setup/pendingstart/favorites/history/room/gameplay/admin/editor/status tests. Run npm run typecheck:app, relevantgametypecheck, npm run build:local. Update compatible visualselectors; old scripts may create rooms and must not blindlyrun. Repeat REA after implementation; distinguish actualruntimeobservations, syntheticrenderedfixtures, behaviortests and unavailableconditions in docs/INNER_PAGE_THEME_COVERAGE_2026-11-12.md.

Planning REA evidence (local ignored): local/almaidan/rea-ux-plan-20261113.json,4records. Public/auth/accessstates reviewed desktop1440x1000dark/mobile390x844light. Populatedprotectedstates remain implementation acceptance, not claimed liveverified by planningpass. Observed episodes error/cataloguefallback are runtimeconditions, not proof of redesign failure or service readiness.
