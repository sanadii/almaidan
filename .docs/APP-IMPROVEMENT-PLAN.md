# Almaidan improvement plan (2026-11-24)

Source: four read-only reviews of the running local app on 2026-11-24 (style and theme, function, media, flow) at commit `43941b1`. 108 findings in total; none blocks a game from being played, 24 are things users will clearly hit.

Scope: the whole app except category covers and question images/videos.

Owner decisions that stand: keep the current colours and theme (navy, blue, cyan; light and dark). The feel is friendly and picture-first.

## Status (2026-11-25)

All seven phases and one short correction round are implemented in the working tree by Sol 6.2 (high) and were checked by the coordinator after each phase: gates run again, local servers restarted, the affected flows replayed in a browser with a host, two phones and a display.

| Phase | Result |
|---|---|
| 1 Broken and invisible things | Done. The board fix needed a second pass (a fifth SVG layer was still black). |
| 2 الخلية setup and lobby | Done. |
| 3 الخلية play, results, recovery | Done. |
| 4 إنت صح rooms, big screen, setup | Done. |
| 5 One product | Done, except الدخيل rooms in «مبارياتي»: its saved rooms are not linked to the host account. |
| 6 Media, sharing, sound | Done. Sound cues are covered by tests only; nobody has listened to them yet. |
| 7 Same-room rematch, design cleanup | Done. 147 of 161 before/after screenshots identical; the other 14 differ by image-loading timing only. |
| Corrections | Enta join form buttons, old join links after a rematch, phone header spacing, one label. Done. |

Final gates: typecheck and lint clean; 812 UI tests; 148 local game tests (5 skipped, they need private fixtures); 7 visual-contract tests; scanner findings 279 → 114.

Not verified: the hosted runtime (Firebase functions were changed to mirror the rules and have passing unit tests, nothing was deployed); real devices and real link previews; audible sound; the episodes video player (no episodes exist locally); screen readers. The share tags point at `https://huroof-wa-oloof.vercel.app/` and need the real production address if it differs.

## How this plan is run

- Seven phases, done in order, one at a time, in this checkout. Phases share large files (`src/routes/GameRoutes.tsx`, `src/styles/khaliah.css`), so they never run in parallel.
- Each phase is implemented by Sol 6.2 (high) from the phase's section below. The coordinator checks the diff, restarts local services where server code changed, replays the affected flows in a browser and runs the gates before the next phase starts.
- Nothing is committed, pushed or deployed by the implementer. Commits happen only when the owner asks.

### Rules for every phase

1. Change only what the phase lists. If a listed fix turns out to be wrong or already done, say so in the report instead of improvising a different change.
2. Every behaviour fix gets a test (Vitest for UI under `tests/app/`, `tsx --test` for server code next to the module or under `tests/game/`). Do not weaken or delete an existing test to make it pass; if a test encodes the old behaviour, update it and say which.
3. Styles use tokens only: `--app-*`, `--spatial-*`, `--arena-*`, radius and shadow tokens. No new hex/rgb literals, no new `!important`. `npm run test:visual-contract` must pass and the scanner count must not rise.
4. Arabic-first RTL. Use logical CSS properties. All new user-facing text is Arabic, in the friendly Gulf register the app already uses.
5. Both themes and 320 / 390 / 768 / 1440 px must work for every screen touched.
6. Local runtime code is in `server/` (Huroof, Imposter) and `services/enta/server/src/local-development/` (Enta). Where the same Huroof rule also exists in the hosted functions (`functions/src/game.ts`, `functions/src/index.ts`), apply the same fix and test there. Never deploy.
7. Do not read or print `local/almaidan/*.private.json`. Do not reset databases, delete stored state or touch anything under `local/` or `content/`.
8. Do not run a recursive search from the repository root (`local/` is huge). Search inside `src/`, `server/`, `services/enta/server/src/`, `functions/src/`, `tests/`, `design/`, `scripts/`, `public/`.

### Gates after every phase

```
npm run typecheck
npm run lint
npm run test:ui
npm run test:visual-contract
npx tsx --test tests/game/**/*.test.ts            (when server/ changed)
npx tsx --test <changed local-development tests>   (when Enta local server changed)
```

Known flake until phase 1 fixes it: `tests/app/question-media.test.tsx` "renders a contained muted inline video…".

### Defaults chosen (change here if the owner disagrees)

- **Digits:** Western digits (0-9) everywhere for scores, timers, counts and codes. The Huroof board already uses them.
- **Names:** one name per thing. الخلية (the game), لوحة الحروف / لوحة الفئات (its two boards), إنت صح, الدخيل, غرفة الانتظار (every lobby), الرئيسية (every link home).
- **Sound:** short synthesised WebAudio cues, no audio files. On by default on host and display screens, off by default on player phones, one mute toggle in the header.
- **Room codes:** stay as they are in this plan (6 characters for الخلية, 11 for the other two); every lobby gets a QR code and a copy button so nobody has to type them. Shortening codes is listed under "Later".
- **Art direction:** new pictures follow the home hero painting (rich, illustrated, friendly). No text inside images.

---

## Phase 1 — Broken and invisible things

Small, safe fixes for things that are plainly wrong today.

| ID | Problem | Change |
|---|---|---|
| 1.1 | The الخلية board renders black layers on `/how-to-play` and `/room/:code/results`: `.game-board__cell-shell`, `.game-board__cell-side`, `.game-board__enclosure-section`, `.game-board__enclosure-groove` only get a fill inside gameplay scopes (`src/styles/global.css:2689, 3585, 3902, 4468`). | Add unscoped base fills for the four classes beside the base `.game-board__cell-face` rule in `global.css`, using the same tokens the gameplay scopes use. |
| 1.2 | الخلية audience display in light theme: navy stage with dark ink (title about 1.06:1), white score cards, light strips either side (`src/styles/khaliah.css:503-509` against `src/styles/shared-app.css:214-216`). | Keep the audience arena theme-invariant: exclude `.game-arena:not(.game-arena--host)` from the `--arena-*` remap at `shared-app.css:214`, and make `.game-arena` full-bleed on the display route. |
| 1.3 | Lobby «انسخ الرمز» is invisible in dark theme, 1.10:1 (`khaliah.css:940-941`, `global.css:3460`). `.lobby-join-qr__trigger` shares the rule. | Dark variant: `background: var(--app-subtle); color: var(--app-ink); border-color: var(--app-border)`. |
| 1.4 | Host console theme toggle is invisible in light theme, 1.17:1 (`khaliah.css:308`). | `color: inherit; border-color: currentColor`. |
| 1.5 | الدخيل vote: selected player name 2.30:1 in light theme (`src/features/imposter/imposter.css:51`). | Explicit selected background and a text colour that passes 4.5:1, from tokens. |
| 1.6 | Host «الأسرع: …» for the horizontal team is 2.47:1 in dark theme (`global.css:880-882`). | Give it the same filled chip treatment as the vertical variant (`global.css:4359`). |
| 1.7 | Enta room code breaks across two lines at 390 and 320 (`src/styles/rooms.css`, `src/features/enta/RoomRoutes.tsx:32`). | `white-space: nowrap; direction: ltr; unicode-bidi: isolate` on room codes; put the code on its own line in the join heading. |
| 1.8 | Footer tagline touches the wordmark on `/login` and `/account` (suspect: fixed `inline-size: 6.5rem` on `.auth-page__footer .brand-mark`, `khaliah.css:246`). | Find the real cause, fix it, check 390 and 1440. |
| 1.9 | «↕» renders as a colour emoji while «↔» is text (`src/routes/GameRoutes.tsx:533, 4068, 4077`). | Use the existing `.axis-mark` SVG icons, or append U+FE0E to both. |
| 1.10 | `--font-mono` is used but never defined (`global.css:3453, 5200`; `design/tokens.css:146-147`). | Define it in `design/tokens.css`. |
| 1.11 | Every page fetches a 180 KB background nobody sees: `body` in `global.css:63-68` paints `--studio-background-image`, removed only after React mounts (`src/styles/page-layout.css:178-182`). | `background-image: none` on `body`; apply the image only on surfaces that really paint it. Confirm with a network trace that the request is gone on `/`. |
| 1.12 | First paint ignores the device theme: `public/theme-bootstrap.js:4` falls back to dark for a missing or `system` value. `theme-color` is one fixed navy. | Resolve `system`/missing with `matchMedia('(prefers-color-scheme: dark)')`; two `theme-color` metas with `media`, updated from `src/app/ThemeProvider.tsx` when the user picks a theme. |
| 1.13 | Flaky test: `tests/app/question-media.test.tsx:97` (and the image test at `:64`) reads the `<video>` from the synchronous loading placeholder. | Wait for the element itself with `waitFor`. Run the file 20 times to confirm. |
| 1.14 | Display says «اكتمل المسار والمباراة» for a match ended without a winner (`GameRoutes.tsx:3967`). | Branch on the no-winner end and show «انتهت المباراة بلا فائز». |
| 1.15 | Local build: `/questions` and `/admin/questions` open a broken hosted admin shell (`src/app/App.tsx:232-246`). | When `isAlmaidanLocalDevelopment`, do not register the hosted admin child routes; every `/admin/*` and `/questions*` path redirects to `/local-admin`. |
| 1.16 | Three home game cards run an infinite box-shadow glow (`khaliah.css:1604`; also `:1514`). Eight `transition: all` rules. | Run the glow on hover/focus only. Replace `transition: all` with the properties that change. |

Done when: both boards render correctly on `/how-to-play` and results in both themes; the four contrast cases measure at least 4.5:1 (3:1 for large text); gates pass; the media test passes 20 runs in a row.

---

## Phase 2 — الخلية setup and lobby

Getting a الخلية room from "new game" to "everyone is in" without stumbling.

| ID | Problem | Change |
|---|---|---|
| 2.1 | Setup shows a fake 8-category list and «أنشئ الغرفة التجريبية» for 2-4 s, then drops whatever was picked (`GameRoutes.tsx:685`). `GET /api/question-inventory` re-reads the whole release per request and is requested twice (`server/index.ts:269`). | While the inventory loads on the local runtime, show picture-card skeletons and a disabled button «جارٍ تحميل الفئات…». Never show the demo list when the real inventory is expected. Cache the inventory on the server (invalidate when content overlays change) and request it once. |
| 2.2 | One selected category passes the form, then fails with 422 and «…تأكد من تشغيل الخدمات المحلية…». The server hides the real reason (`server/local-owned-room-creation.ts:24`, `server/service.ts:501`); `readableError` never sees it (`GameRoutes.tsx:317, 340-346`). | Return the real reason code in the 422 body and map it to «الفئات المختارة لا تكفي لتعبئة اللوح. أضيفوا فئة أو فئتين ثم حاولوا.», scrolling to the category section. Show a live «أسئلة كافية ✓ / تحتاجون فئات أكثر» indicator beside the selection count. |
| 2.3 | The picker leads with 373 unavailable cards; the first pickable one is about three phone screens down; each repeats the same sentence. | Show available categories only by default, with a toggle «أظهر غير المتاحة (N)» that reveals the rest at the bottom under one explanatory note. Add «اختاروا لنا عشوائياً» as Enta has. Topic count badges at least 12 px. |
| 2.4 | Tapping a home category as a stranger loses the category (`/host/new?kind=categories&category=…` is rewritten). | Keep `category` while the inventory loads and across the sign-in round trip. Hint text: «اختاروا فئة ثانية على الأقل لتكتمل اللوحة.» |
| 2.5 | Setup asks for decisions that do nothing: «سريعة» changes no timer; the «تحدّيات تفاعلية» card is disabled and written in server terms; the summary shows a count instead of names. | Make «سريعة» set shorter timers (or remove the switch and keep «التوقيت»). Put timing and challenges in a closed «إعدادات إضافية» disclosure; hide the challenges card when nothing can be enabled; list the chosen category names in the summary. |
| 2.6 | Validation message renders under the submit button while focus jumps to the search box, and it stays after being fixed. | Show «اختاروا فئة واحدة على الأقل.» at the top of the categories section where focus lands; clear it when a category is selected. |
| 2.7 | A joined player who never presses ready blocks «ابدأ المباراة», and the lobby has no way to remove them (`GameRoutes.tsx:3632-3745`; controls exist only in `HostLobbyControls`, `:4213`). | Render the host's remove/move controls in the lobby with a connected/absent state per player. Add a secondary «ابدأ بدون انتظار الباقين» once each team has one ready player. |
| 2.8 | Two guests pressing «جاهز» at the same moment: one gets a "stale" refusal and a confusing message. | Re-send a stale ready/un-ready intent automatically against the new revision. |
| 2.9 | No QR code in the lobby; the big screen in the lobby phase shows an empty board and «الردهة», no code, no names. The display link appears only after the match starts. | Build one `RoomCode` component in `src/design-system/` (code, copy button with «تم النسخ», QR of the join link using the existing `qrcode` dependency). Use it in the الخلية lobby and add «افتح شاشة العرض» there. While waiting, the display shows «ادخلوا من جوالاتكم», the QR, the code in very large type and names as people arrive. |
| 2.10 | Lobby header is cramped: hints wrap into 100 px columns; team cards repeat the team name; on phones the main action is not full width. | Two-row grid (title + code/copy/QR, then actions with a hint under each); drop the duplicate badge; full-width actions under 480 px. |
| 2.11 | Two 1.2 MB PNGs draw two 64 px board-type icons (`public/assets/game-types/huroof.png`, `categories.png`; `GameRoutes.tsx:547-550, 1036`). | Re-encode to 192 px WebP (about 6 KB each), add `width`, `height`, `decoding="async"`, rounded corners. Remove the old PNGs. |

Done when: a signed-in host creates a room with two categories and reaches a lobby showing a QR in under ten taps; picking during load is impossible; one category gives the specific message; an absent player can be removed from the lobby; gates pass.

---

## Phase 3 — الخلية play, results and recovery

| ID | Problem | Change |
|---|---|---|
| 3.1 | The winner's phone keeps saying «أنت الأسرع — أجب الآن» after judging, through round and match end: `room.buzzWinner` is never cleared on a correct answer (`server/service.ts:2052, 2687`; `GameRoutes.tsx:3570`). Other players never learn who buzzed or whether it was right. | Clear `buzzWinner` when the answer is finalised. Use the buzz-winner text only in `FIRST_ANSWER` and `OPPONENT_CHANCE`. Add a 3-second result state on phones: «إجابة صحيحة — الخلية لفريق {اللون}» / «إجابة خاطئة — الفرصة للفريق الآخر»; when someone else buzzes: «{الاسم} أسرع — ننتظر الإجابة». Show the player's own name and the round score in the top strip. |
| 3.2 | No countdown on phones or the display during the main question; only the host sees it (`GameRoutes.tsx:2138, 3781`). | Show the same countdown on player and display surfaces for the whole `QUESTION_READING` phase. |
| 3.3 | Nobody is told whose turn it is to choose. | After each award, host and display say «فريق {اللون} يختار الحرف التالي» (or «المضيف يختار الحرف التالي» if that is the rule in force). |
| 3.4 | Time-out with no buzz says «لم تُقبل الإجابة», and «إنهاء المباراة كاملةً بلا فائز» sits beside the routine next step at the same size. | «انتهى الوقت — ما أحد جاوب». Routine button «كمّلوا — اختاروا حرفاً آخر». Move end-without-winner to the lower tools row behind the in-page confirmation. |
| 3.5 | The match ends without a results screen: the host console never names the winner; the player's «العودة إلى الردهة» goes nowhere. The results page has weak hierarchy (two cryptic lines, four equal buttons). | On `MATCH_COMPLETE` send host and players to `/room/:code/results` with «فاز فريق {اللون}». Results: two team score cards with names, rules inside `<details>`, one primary «العبوا مرة ثانية» plus «غيّروا اللعبة» and «الرئيسية» for the host; «الرئيسية» only for players. |
| 3.6 | Extra confirmation steps: after «ابدأ المباراة» the console's only action is «جهّز الجولة»; every later round repeats it. The rematch interstitial's three actions run together. | Prepare the round automatically after start and after «جولة جديدة». Create the rematch room directly from the end screen (keep the interstitial only as the error/recovery view, with spaced buttons). |
| 3.7 | Closing the tab loses the seat: the capability lives only in `sessionStorage` (`src/routes/NameJoinRoute.tsx:90-91`, `GameRoutes.tsx:313`); rejoining creates a second same-name player on the other team (`server/service.ts:924`). | Reclaim-by-name as الدخيل already does (`server/imposter-service.ts` `join`): a disconnected seat with the same name is taken back, same team. Skip the name form when the browser already holds a session for the room. Mark the player's own row «(أنت)». |
| 3.8 | Duplicate names are accepted and break roster keys (`server/service.ts:931`, `GameRoutes.tsx:3708`). Invisible and direction-override names are accepted (`server/service.ts:208`, `src/routes/EntryRoute.tsx:19`). | With 3.7 in place: a name held by a connected player is refused with «في لاعب بهذا الاسم. اختاروا اسماً آخر.» Key roster rows by seat id. Name rule: at least one letter or digit, reject format characters; wrap names in `<bdi>`. One rule and one message on all join forms: «اكتب اسمك (حتى 30 حرفاً).» |
| 3.9 | Join has no in-flight guard or idempotency key (`NameJoinRoute.tsx`). | Return early when busy; send a per-tab request key that the server deduplicates. |
| 3.10 | Clients retry once a second forever after a terminal error, because the terminal test never matches the JSON error body (`GameRoutes.tsx:1676, 1682`). A hung snapshot request stops reconnection for good (`:1610`). | Parse the error code first; treat 401/403/404 as terminal; exponential backoff; `AbortController` timeout of about 8 s with the flag reset in `finally`. |
| 3.11 | A room opened without a session is a dead end («تعذر فتح الغرفة»), including for the signed-in owner in a new tab. | Primary button «ادخل الغرفة باسمك» to the join page; restore the host session automatically for the signed-in owner. |
| 3.12 | Keyboard focus drops to `<body>` after every host action (`GameRoutes.tsx:3279-3296` handles one transition only). | On every room state change move focus to the first primary host action or the question heading; focus «تأكيد إزالة» when it appears. |
| 3.13 | Signing out does not end host control of a running room, while the account page says it does. | Clear `huroof:*` capability keys on sign-out. |
| 3.14 | Joining a finished room says the challenge has started. The rematch page says "retry" for failures that can never succeed (`src/features/game/HuroofRematch.tsx:21`). | Distinct code and message «انتهت هذه المباراة». Branch on the failure code; drop the pending key for definitive failures; set a document title. |
| 3.15 | The server tick scans and JSON-parses every stored room four times a second (`server/service.ts:609`). | Persist `deadline_at` and `has_challenge` as indexed columns written on commit and select on those. Keep behaviour identical; add a test. |
| 3.16 | How-to-play is not reachable from inside الخلية and skips the buzzer test, the second chance, the win rule and the numbered cells. | «كيف نلعب؟» link in the lobby and play screen (new tab). Four more lines in the الخلية section. |

Done when: a full two-round match played by a host, two phones and a display shows the countdown, the result feedback and the winner on every screen; closing and reopening a player tab returns the same seat; gates pass including `tests/game`.

---

## Phase 4 — إنت صح rooms, big screen and setup

| ID | Problem | Change |
|---|---|---|
| 4.1 | The big-screen display is the plain room page: site header, roster, question in 16 px text below the fold, no board (`src/features/enta/RoomRoutes.tsx`, `GuestState` with `display`). | Own full-screen stage layout reusing `.enta-scores`, `.enta-stage`, `.enta-question` (`src/styles/enta.css`) at TV scale: scores and «الدور على {الفريق}» on top; the points board when idle; category, points, question and a large countdown during a question. No header, roster card or home link. While waiting: QR, code and names (the `RoomCode` component from 2.9). |
| 4.2 | Names are entered three times and the host seats every guest by dropdown. «اللاعبون» is required at setup with a placeholder that looks like a value. | Player names optional at setup («أسماء اللاعبين (اختياري)»). On the join page the guest picks a team with two large buttons; the seat is created from the guest's name. Host room: «وزّعهم تلقائياً», and «بدء المباراة» disabled with «وزّعوا اللاعبين على الفرق أولاً» until everyone has a team. |
| 4.3 | Guest join and play screens look unfinished: plain heading, narrow input; play is stacked 16 px text cards. | Join uses the shared name-join card (`src/routes/NameJoinRoute.tsx`, `.name-join-card`). Play uses `.enta-question` / `.enta-scores` with one large status line. |
| 4.4 | Thin feedback: after judging the guest screen returns to idle with only a number changed; expiry sits on «0 ثانية»; a late joiner waits unseen by the host; «نسخ رابط الدعوة» confirms nothing; guests and display are not told whose turn it is. | 3-second «+{النقاط} لـ{الفريق}» / «ما أحد جاوب صح» on play and display; «انتهى الوقت»; badge «لاعب ينتظر القبول» on the host board; «تم نسخ الرابط»; «الدور على {اسم الفريق}» on play and display when idle. |
| 4.5 | After «بدء المباراة» the host stays on the room page and must tap «فتح لوحة المضيف». The display link takes two steps. | Go straight to the board after start. One tap to open the display. |
| 4.6 | Closing the tab loses the seat; the same name is then refused with 409. | Reclaim a disconnected seat by name (same rule as 3.7). |
| 4.7 | Competitive mode: the host's judging board does not show what players typed (`CompetitionRoutes.tsx` never reads `submissions`; they render only at `RoomRoutes.tsx:55`). | Show each current-round submission beside the attempt being judged. |
| 4.8 | The one-second countdown sits inside a polite live region (`RoomRoutes.tsx:80`). | Remove `aria-live` from the section; timer gets `role="timer"`; a small `role="status"` line announces phase changes. |
| 4.9 | The sign-in link on the room host page has no `returnTo`, and `/login` without one is a dead end (`RoomRoutes.tsx:52`, `src/routes/AuthRoutes.tsx:33`). | Pass `returnTo`; a signed-in user on `/login` with no `returnTo` goes home. |
| 4.10 | Setup shows a storage error for a name over 30 characters and one generic message for every other problem (`src/routes/EntaRoutes.tsx:94`). | Validate each rule before building the intent, with a specific message and focus on the offending field. Keep the storage message for real storage failures. |
| 4.11 | Normal play logs failures: 36 × `403 /private` in a classic match; polling never stops on `FINISHED` or 404 and ignores hidden tabs (`RoomRoutes.tsx`, `src/features/enta/use-match.ts:25`). | Skip `/private` for the classic engine and answer 204 for "nothing private". Stop polling on terminal states; pause while `document.hidden`. |
| 4.12 | `/enta/new/mixed` is about 50,000 px tall on a phone with the start button at the bottom. The other variants use a different step order and no step numbers. | Use `CategoryPicker` (topic chips, bounded results) on every variant (`src/features/enta/RoundRoutes.tsx`, `CompetitionSetup.tsx`). Same order everywhere: categories, teams, time, with numbered steps. Summary sticky at the bottom under 768 px. |
| 4.13 | `/enta/new` offers ten look-alike modes in a rail; five pictures are each used twice and cropped (`EntaRoutes.tsx:39-49`, `enta.css:162`). | One «نوع اللعب» step with four picture choices (أسئلة، قوائم، تمثيل، رسم) plus two switches («مع المساعدات», «للأطفال») that route to the existing setup pages. «مبارياتي» moves out of the rail. Pictures use `<picture>` with AVIF/WebP and `object-fit: contain`. New mode pictures arrive in phase 6; until then each choice uses the closest existing one once. |
| 4.14 | Sign-in is demanded before a stranger sees a single category (and at a third moment in الدخيل). | Strangers can browse and choose on `/enta/new` and `/host/new?kind=imposter`; sign-in is asked on the final button; choices survive through `returnTo`. `/login` names the destination: «سجّل دخولك لتكمل إنشاء مباراة {اللعبة} — اختياراتك محفوظة.» |

Done when: an Enta classic match with a host, two phone guests and a display runs with guests picking their own team, the display showing a real board, and no 403/409 noise in the console; gates pass including the Enta local tests.

---

## Phase 5 — One product: shared components, wording, navigation

| ID | Problem | Change |
|---|---|---|
| 5.1 | Primary buttons render in seven variants (44-58 px tall, radius 10-999, weight 600-800); inputs have three radii; hover and cursor differ. | Define `.button`, `.button--lg`, `.button--secondary`, `.button--quiet` and the field style once in `shared-app.css` (48 px, radius token, weight 700, `cursor: pointer`, one hover). Delete the per-surface overrides (lobby and results pills in `global.css` around `:3620-3690`, `.maydan-button` in `khaliah.css`, `.imposter-page` buttons, `shared-app.css:217-218`). |
| 5.2 | Three lobbies, three confirmation patterns, no toast. | Use `RoomCode` (2.9) in the Enta and الدخيل lobbies too. One `ConfirmDialog` built on the `.correction-dialog` styles, used for الدخيل «إغلاق الغرفة» and Enta finish. One status/toast region in the shared shell for "copied" and similar. |
| 5.3 | Focus rings exist everywhere but many are too faint (cyan on light 1.7:1, white on white on home). | One `--focus-ring-color` token (light, dark, on-arena values that reach 3:1). Replace the literal ring rules (`global.css:2659, 2787, 3518, 3678-3691, 3773, 3795, 5152, 5175, 5205` and the home rules in `khaliah.css`). |
| 5.4 | Arabic-Indic and Western digits are mixed, sometimes in one line («الشلة · 3 / ٨», «58s»). | One formatter in `src/lib/format-number.ts`; Western digits everywhere; seconds written one way; `font-variant-numeric: tabular-nums` on scores and timers. |
| 5.5 | Touch targets under 44 px (text links 20-27 px, chips 40 px, الدخيل checkboxes 24 px). | 44 px minimum on standalone links, chips, checkboxes and `summary` rows. |
| 5.6 | The same thing has several names (الخلية / لعبة الحروف / بطولة الحروف; ردهة / غرفة اللعب; eight labels for "home"). | Apply the names in "Defaults chosen" everywhere: headings, eyebrows, buttons, history, how-to-play. |
| 5.7 | Navigation loose ends: «الحلقات» leads to an empty page; `/study` says unavailable; the footer exists on three pages only; home buttons loop; the phone menu re-stacks the header buttons; the nav collapses at 1024 px although the links fit. | Hide «الحلقات» while there are no episodes; remove `/study` from public reach; footer on all public pages; fix the two looping home buttons; keep header buttons in place when the menu opens; nav breakpoint about 56rem. |
| 5.8 | «مبارياتي» is not in the menu and is hard to read: الخلية rooms first with no date, unfinished rooms pile up, الدخيل absent. | Add it to the menu for signed-in users. One list by date with a game filter; date and category names on الخلية rows; unfinished rooms older than a day collapsed under «غرف لم تكتمل»; signed-out text «سجّل دخولك لتشوف مبارياتك». |
| 5.9 | A wrong room code is only rejected after the guest typed a name. | Check the code when «الدخول» is pressed on the home page; show «ما لقينا غرفة بهذا الرمز. تأكدوا منه مع المضيف.» under the field. Same message on a direct join link with an unknown code. Placeholder shows a real 6-character example. |
| 5.10 | الدخيل makes a finished group wait out the clock. | Host button «ابدأوا التصويت الآن» in discussion; close the vote when every connected player has confirmed. |
| 5.11 | Simple pages differ in shell, back action and empty state; empty states have no picture. | One `StatusPanel` (illustration slot, title, text, one action) for episodes, contact, credits, 404, study, the الدخيل guide. Reuse the existing `maydan-e-*` objects as spot art. |
| 5.12 | Developer wording on player screens («…دون رموز تحكم», content-provenance line in Enta setup, «إلغاء كل روابط شاشة العرض», «في جلسة متصفح مستقلة…»). | Rewrite in plain player language or move behind «خيارات». |
| 5.13 | Tablet: الخلية display at 768×700 truncates the status and pushes the question below the fold; host score labels drop to 10 px. | Scale the board under 900 px height; 12 px floor on score labels. |
| 5.14 | Type: H1/H2 weights differ by page; help text and values share the label weight on setup pages. | H1 and H2 set once in `shared-app.css`; help text and values at 400-500. |

Done when: a census of primary buttons across the app returns one size and radius (plus the large variant); no mixed digits on any screen; every screen keeps 44 px targets; gates pass.

---

## Phase 6 — Media, sharing and sound

| ID | Problem | Change |
|---|---|---|
| 6.1 | Room links pasted into chat apps show no picture: no Open Graph, Twitter card or canonical in `index.html`. | Add the tags and `public/og-image.jpg` (1200×630: a crop of the home hero with the logo and «الميدان»). |
| 6.2 | No web app manifest; `icon-192.png` and `icon-512.png` are orphaned and not maskable. | `public/manifest.webmanifest` (name, short name, `lang`, `dir`, standalone, colours, icons), linked from `index.html`; a maskable 512 icon rendered from `favicon.svg`. Add `public/favicon.ico` and a real `public/robots.txt`. |
| 6.3 | The hero is one 199 KB file for every screen, discovered late; on phones it is a small letterboxed strip below the fold. | AVIF and WebP `<source>` at 800 / 1280 / 1672 widths; an art-directed 4:3 mobile crop for under 768 px that fills its block; preload from `public/theme-bootstrap.js` on `/`. |
| 6.4 | Half of the in-scope bytes in `public/` (3.6 MB) are never used: 24 `maydan-*` artwork files, `topics-sprite-v1.png`, IBM Plex and Lalezar fonts, five backgrounds. | Check `server/`, `scripts/` and `tests/` for references first, then move unused files to `design/evidence/assets/` and delete the dead CSS (`khaliah.css:436-463`, `global.css:2601`). |
| 6.5 | Font swap moves the page on slow connections (CLS 0.166 on phones). Latin letters and digits inside heavy Arabic headings are lighter (Cairo Latin subset not shipped). | Metric-matched fallback `@font-face` (`size-adjust`, ascent/descent overrides) after Cairo in `--font-sans`. Ship Cairo's Latin subset from the upstream recorded in `public/fonts/cairo-instrument-manifest.json`. |
| 6.6 | Fonts and artwork get the default one-hour cache in production (`firebase.json`). | Long immutable cache for `/fonts/**` and versioned `/assets/**`. Do not deploy. |
| 6.7 | The games have no sound at all. | `src/lib/sound.ts`: one shared `AudioContext` unlocked on first tap, synthesised cues (tick for the last five seconds, time up, correct, wrong, cell claimed, win), preference in `localStorage`, respects reduced-motion-style quiet default on phones. Mute toggle beside the theme toggle. Wire into the الخلية, Enta and الدخيل timers and judgments. |
| 6.8 | The three games have no artwork of their own (64 px line icons on the home cards); four illustration styles are mixed. | Generate three key pictures in the hero's style (الخلية, إنت صح, الدخيل), two sizes each in AVIF and WebP, under `public/assets/games/`. Use them on the home game cards, as the header of each setup page and on how-to-play. |
| 6.9 | `/enta/new` reuses five pictures for different modes. | Generate the missing mode pictures for the four play types in the same style; wire them into 4.13. |
| 6.10 | How-to-play illustrates one game out of three, with five-card grids leaving an orphan. | One visual per step group for إنت صح and الدخيل (interface captures or the new key art); auto-fit grid in `src/styles/game-guide.css`. |
| 6.11 | `/episodes` cannot show video. | Optional `youtubeId` in the episode contract (`src/features/episodes/client.ts` and the API); click-to-load poster that swaps in the `youtube-nocookie` iframe; no autoplay. |
| 6.12 | `/media-credits` does not describe what ships and reads like release notes. | Three short lists: fonts (name, licence, link to the shipped licence file), illustrations, question images. Footer link renamed to cover fonts. |
| 6.13 | Arrows are text glyphs from a system font; icons live in 11 files with hard-coded colours. | `src/design-system/Icon.tsx` from `HomeGraphicIcon`; use it for every arrow, chevron and check; strokes use `currentColor`. Fix the discovery card `sizes` (`src/routes/HomeHeroCards.tsx:17-18`). |

Done when: the first load of `/` transfers under 250 KB of images and fonts on a phone; a link preview test page shows the share image; sounds play on host and display and the mute toggle persists; gates pass.

---

## Phase 7 — Play again in the same room, and design-system cleanup

| ID | Problem | Change |
|---|---|---|
| 7.1 | Play-again in الخلية and إنت صح creates a new room with a new code and leaves guests and the display in the finished room. الدخيل's «جولة جديدة» keeps everyone. | When the host starts a rematch, everyone still connected to the old room is carried over: play and display screens show «المضيف بدأ مباراة جديدة — ادخلوا» which joins the new room with the same name and team, and the display switches by itself. The old room keeps a pointer to its successor so late returners are forwarded too. |
| 7.2 | Six token families; the live palette is defined in `shared-app.css` and `khaliah.css`, not in `design/tokens.css`. The written contract (`design/TOKENS.md`, `design/ROUTE-VISUAL-CONTRACT.md`, parts of `DESIGN.md`) describes zero radius, mint and IBM Plex, so the scanner reports every radius. | Move the `--app-*` pairs into `design/tokens.css` as the semantic palette; add `--radius-sm/md/lg/pill` and shadow tokens; alias `--khaliah-*` and `--maydan-*` to them. Update the design documents and `scripts/scan-visual-contract.ts` (and its test) to match the app as it is. |
| 7.3 | `khaliah.css` holds 525 hex literals and 226 `!important`. Two home layers fight each other (lines 77-262 against 1348-1945). 72 one-off dark-theme patches (lines 405-537, 923-945). | Convert the dark "contrast repair" block to tokens first. Merge the two home layers into one and delete superseded rules. Map the 111 literal radii in `global.css` to the new radius tokens. The home page and every game screen must look the same before and after (screenshot comparison in both themes). |

Done when: a rematch carries a host, two guests and a display into the new match without anyone typing a code; the scanner count drops by at least half with no visual change; gates pass.

---

## Later (not in this plan)

- Six-character room codes for إنت صح and الدخيل (server change with history and link compatibility to consider).
- Real-device checks: iOS Safari, Android fallback fonts, link previews in chat apps, screen readers.
- The hosted runtime (Firebase functions, Firestore rules) for anything beyond the mirrored rule fixes in phase 3.
- `/host/new` requests about 516 category cover images on arrival (seen during the media review; category media is out of scope here).
