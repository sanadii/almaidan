# 0020 — Root review of INT-032.E

Current outcome: implementation and Root technical review complete; human live acceptance remains pending. This record does not certify aesthetic quality or authorize other-route expansion.

## Personally inspected evidence

- Selected saved Playful reference: `design/evidence/references/20261003-playful/01-playful.jpg`.
- Five native-alpha originals on cream at 200×240: buzzer, trophy, question stack, hex cluster, speech cloud. Separate coherent matte objects; no baked card frames.
- E art-integrated 1600 first viewport and 390 full-page draft; E 1440 dark/reduced and 390 light/reduced full-page matrix captures.
- Existing source: `HomeSurface.tsx`, extracted `HomeHeroCards.tsx`, homepage-scoped CSS, and measured contrast report.

The revised candidate keeps the selected broad headline, local pink wash, five tactile faces and quiet wordmark. Major available-game emphasis, compact unavailable Enta notice, open guide, restrained empty catalogue, balanced gathering, FAQ and warm final invitation carry a varied hierarchy. Phone cards form two readable columns with the fifth centered. Final source/freeze identity is to be appended after Forge stops writes.

## Independent live browser replay

Performed through CUA in a fresh temporary localhost tab, without changing the owner's existing room-code tab or creating a room:

1. The hero guide card navigated to `#how-it-works`; the section itself became the active element.
2. The five native links had five distinct image `currentSrc` values (`maydan-e-buzzer`, `trophy`, `questions`, `hex`, `cloud`) and five intended fragment destinations. Exactly one `.join-form--code` existed.
3. The guest shortcut navigated to `#room-code` and focused the real input.
4. Input `!!` normalized to empty; submit showed the required-code error, set `aria-invalid=true`, and retained focus on `room-code`.
5. Input `ab12cd34` normalized to `AB12CD34` and navigated to `/room/AB12CD34/join`, showing the actual player-name step. No player-name submission or room join occurred.
6. Returned to the clean homepage after the replay.

## Final candidate binding — 2026-10-03

Forge stopped source writes at `2026-10-03T11:09:10.645Z`. Root independently recomputed all146 entries in `output/int3e-homepage-20261003/final-hashes.json`: zero mismatches. Manifest SHA256 `5199bf022f5ffd7e63467c148d7499c532b84a833484208da06a14f038a53433`; FREEZE.json SHA256 `27e15a0762ce906b174d3a8b778583d6c88f7253cab1494c5e6443b2f692ed4d`. Primary and isolated DNA hashes are identical.

Final source: HomeSurface `ef5028713f6adb2da83bfde5853b40acaaf8d93c1868d88bb582147939172d39`; HomeHeroCards `5fd69d024441c9e2b6d7cf8d6c7ca591aacc0598c1dae42ae005cdbc058d805e`. Root reviewed the HomeSurface delta against E baseline and the extracted component/CSS boundary. Data/auth/state handling is preserved; this is the authorized presentation change. Preservation report verifies EntryRoute,10 protected backend files, nonhomepage CSS bytes and118 prior C/D bindings.

Root personally inspected final neutral1600 light landing,1600 light/reduced full page,390 dark/reduced full page and corrected320 card close-up. The actual phone images and wrapped captions occupy separate boxes after containment correction. Final invitation stays cream/warm dark, with magenta action. No further concrete contract deviation identified.

Final evidence:30/30 focused UI tests;19/19 final browser cases across16 responsive/theme/motion variants plus3 interaction cases; frontend typecheck/scoped lint/whitespace/Vite pass. Intermediate stale presentation assertion, stylesheet timing probe, classic-scrollbar shift and phone containment failure were corrected and rerun; details remain in the implementation report. Existing bundle-size warning remains. Prior full backend build is historical evidence, not newly executed in E. Root's independent live replay is recorded above; source changes afterward were limited to verified mobile containment/gutters.

Exact [implementation report](C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof/output/int3e-homepage-20261003/IMPLEMENTATION-EVIDENCE.md) and [freeze](C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof/output/int3e-homepage-20261003/FREEZE.json) identify the reviewed candidate.

Usage: OpenAI GPT-6 Astra planner and Sol coordinator/Forge telemetry unavailable. OpenAI GPT-5.6 Sol image role produced5 closed wrapper runs (151/118/128/158/84 seconds; raw totals48370/28097/43827/25038/36618, combined181950). Uncached input/cached input/output breakdown unavailable. One interrupted image attempt has unavailable telemetry. [Actual provenance](C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof/output/int3e-art-20261003/provenance.json). No estimates substitute for missing counts.

## Remaining gate

Exact human live decision on the revised homepage. Earlier D's technical evidence remains historical with rejected human outcome. No production deployment or integration-completion claim. Only explicit owner acceptance permits visual expansion.
