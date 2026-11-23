# Mixed game browser acceptance — 2026-11-05

Actual Chrome UI at `http://127.0.0.1:5174/`, using the existing local host account, two separately joined room guest identities in independent tabs, and the host-issued read-only display. All interactions used the computer-use browser interface, including setup, joining, scoring, canvas input, results, history and rematch. No browser fetch, hidden application state, database writes, production services or payment operations drove the journeys.

## Full mixed match

- Room: `E1-3LQXPJ5U`.
- Match: `b402e8cb-3036-4a42-acf5-ad4d887336ce`.
- Teams: فريق المزيج الأول / فريق المزيج الثاني; guests ضيف المزيج أ / ضيف المزيج ب.
- Six selected categories: كرة السلة وNBA, دوري أبطال أوروبا, الدوري الإنجليزي, البيت (drawing), كلمات وحروف (one list round), صباحنا (one acting round).
- Board contained 18 original questions, 6 reviewed drawing rounds, 1 reviewed list round and 1 reviewed acting round: 26 total.
- Both guests joined through the homepage room-code form and entered names. Host assigned the two teams. Guest A refreshed and retained the same room identity/team before play.
- List guest A submitted `ق`; host saw that submission and awarded 100 through the normal item-adjudication control. Guest B and display did not show the submitted text.
- Drawing guest A received private target `طاولة`; guest B and display showed the generic drawing prompt. Actual pointer drag drew a horizontal stroke, observed on the read-only display. Host revealed the target and awarded points using normal controls.
- Acting reached its real 40-second deadline and closed with no score. Performer-private acceptance was completed separately below; do not describe the original timed-out round as successful performer-private acceptance.
- All 26 board tiles became played. The early-finish checkbox remained unchecked. Normal finish yielded **5300 / 4400**, winner فريق المزيج الأول, and “لعبتم كل الجولات. شكراً للتحدّي!”. Both guest screens and display showed the finished outcome.
- History listed the same teams/scores as finished. Its original-result route preserved the result and offered the source-preserving rematch link.

## Exhaustion and recovery

The same-settings rematch review retained the six categories, teams, players, timing and content provenance. Creation returned the explicit exhausted-content message before creating a room.

A read-only PostgreSQL/source diagnosis confirmed genuine exhaustion, rather than a stale prompt-reference defect: the 18 drawing items for `authored-v1-drawing-home` were allocated in three matches belonging to the same host:

1. `6c8ea385-626d-490f-9682-59a93a08180c` — 6 items.
2. `b402e8cb-3036-4a42-acf5-ad4d887336ce` — 6 items.
3. `bc32098c-eea6-4111-998e-eb74ddeb4fcb` — 6 items.

The original three question categories each had six fresh selected items, the list category had 13 fresh prompts, and the acting category had 17. The parent content identity matched the current immutable source. Existing saved records were unchanged.

The exhausted response exposed a UI dead end: the rejected intent could only be retried. The bounded repair retires the exact captured local-v6 intent only after the local endpoint's definite `409 REMATCH_CONTENT_EXHAUSTED`, with unchanged owner epoch and storage bytes. Unknown responses, network loss, malformed replies, and other statuses retain the original intent. The review page then offers “اختيار فئات أخرى لمباراة جديدة”. Actual UI retry confirmed exhaustion and this link opened a usable mixed setup.

Focused tests: 14 local-rematch tests and 57 pending-safety tests passed; app TypeScript passed. Root obtained independent security review and final build verification after this change. No server restart was required.

## Acting privacy, natural tie and successful rematch

- Focused MIXED_BOARD room: `E1-B8MHQEH8`.
- Match: `88457b5d-5301-4550-b07c-04a2e96ab9a7`.
- Six acting categories, one explicitly selected prompt each: صباحنا, رياضة وحركة, أعمال ومهن, حركات حيوانات, أنشطة البيت, مواقف وتمثيل.
- The two independent guest identities rejoined through the homepage code form; host assigned their teams and issued a display link.
- Host selected guest A and the first word through the engine assignment controls, then issued the room private task. Guest A showed “مهمتك الخاصة — لا تعرضها للفريق” and `تبحث عن نظارتك`. Guest B and display did not show the target. Host awarded the item through the normal UI, then completed the remaining five rounds through adjudication controls.
- All six rounds played naturally, **300 / 300**, “تعادل جميل!”, and full-completion copy. This verifies the supported tie path.
- The result's same-settings rematch review retained all six categories, players and rules; “بدء الإعادة” created fresh lobby **`E1-VGMVCTRZ`**. The successor was left in the lobby; a second complete playthrough was not claimed.

## Screenshots

Files under `D:/projects/huroof_wa_oloof/local/almaidan/`:

- `mixed-browser-result.png` — full 26-round result, 5300/4400.
- `mixed-browser-display-canvas.png` — actual synchronized canvas stroke on display.
- `mixed-browser-exhaustion-recovery.png` — truthful exhausted inventory with actionable new-game link.
- `mixed-browser-actor-private.png` — assigned actor-only prompt.
- `mixed-browser-tie-result.png` — six-round natural tie, 300/300.

## Evidence boundaries

This report proves the stated actual UI journeys, visible role separation, scoring, results/history, exhaustion recovery and successful non-exhausted rematch. Broader network-response privacy, duplicate-command, restart, content-allocation and nine-mode HTTP checks are separately recorded in `LOCAL-ENTA-LIVE-ACCEPTANCE.md` and its linked artifacts. It does not claim every viewport/theme was inspected here; root owns responsive and theme acceptance.

An earlier clipboard-derived invite navigation was rejected as an invalid URL. It was not retried or bypassed. Normal homepage entry with the displayed room code and the actual rendered display link succeeded.
