# Route Visual Implementation Contract

Status: derives implementation treatment from [DESIGN-DNA.md](../DESIGN-DNA.md), without
authorizing a new direction. Source/status truth is
[ROUTE-STATE-COVERAGE.md](ROUTE-STATE-COVERAGE.md).

The home page uses an illustrated stage, direct entry to **الخلية**, **إنت صح**,
and **الدخيل**, and a shared join-by-code form. The visual rollout follows the
whole-app approval. [History 0007](evidence/history/0007-spatial-studio-whole-app-rollout.md)

## Shared rules

- Shared routes, host controls, and player surfaces resolve light and dark palettes from
  `--app-*` tokens. Navy anchors the dark shell, blue marks primary actions, and cyan
  highlights active controls. Audience displays use a theme-invariant `--arena-*` stage.
- RTL changes reading sequence only. The board stays physically horizontal crimson left/right
  and vertical green top/bottom. Identity is color + pattern + axis glyph + Arabic label.
- Center the content rail and give each viewport one primary focus. Use named radius tokens
  for fields, cards, panels, and pills. Preserve the board's hexagon geometry.
- Cairo is the main interface font. Use tabular scores and timers and isolate technical
  identifiers LTR.
- Named gradients support homepage artwork masks and lighting, board materials, and the
  audience arena. Use the corresponding tokens for shadows and SVG gradient stops.
- Every route has title, skip link, focus-visible, rest/hover/pressed/loading/disabled-reason,
  success/error/offline/reconnecting/stale treatment, and a safe return.
- Motion is 90–120ms press, 200ms state, one 320ms winning path; reduced motion removes
  translation, scale, sweep, and pulse.

The historical region audit and deferred features are recorded in
[the homepage surface specification](HOME-SURFACE-SPEC.md). The current page exposes supported
game, account, join-by-code, and catalogue routes.

## Pattern contracts

| Pattern | Composition | Responsive/theme/state treatment |
|---|---|---|
| `/` | Illustrated introduction, three game choices, join by code, and the category catalogue. | Shared themes; query-prefilled/validation/joining/failure/success copy stays explicit. |
| `/how-to-play` | Authentic annotated board + four concise steps. | Shared themes; long Arabic, bidi and 200% zoom reflow without hidden controls. |
| `/host/new` | Balanced setup/summary columns on desktop; focused single column mobile; visible selection count and next legal action. | Shared themes; default/demo/selected/empty/no-stock/creating/error/success use explicit reason/copy. |
| `/room/:roomCode/lobby` | Room/readiness then physical-team rosters; start action fixed and reasoned. | Shared themes; connecting/unavailable/closed/host/player/audience states retain safe recovery. |
| `/room/:roomCode/host` | Green vertical score physically left, centered board, crimson horizontal score physically right; question/timer second; console below. | Theme-aware host controls. Tablet score summaries stack above board; sub-768 shows safe limitation. All lifecycle/connection/fatal states are required per coverage. |
| `/room/:roomCode/play` | Phone-first phase instruction then one-thumb hex buzzer. | Theme-aware player UI with ready/locked/open/pending/first/opponent/missed/pause/result/recovery states have Arabic reason and no private data. |
| `/room/:roomCode/display` | 16:9 safe stage: same physical score placement, one timer/round module above, question tray below. | Theme-invariant navy arena. Selection collapses tray; question/winner/reveal/award/correction/result projections are public-safe. |
| `/room/:roomCode/results` | Winner/path then derived rounds then secondary metrics/actions. | Shared theme. Player carry, both winners, nonterminal deep link, missing history, busy/error rematch and role filtering are explicit. |
| `/questions` | Inventory health → filters → records; aligned dense 6/10 workstation. | Shared themes; loading/populated/filtered/empty/local-only/service-error/unauthorized treatments. |
| `/questions/new` | Fields with source/review panel; no nested cards. | Shared themes; blank/validation/dirty/saving/saved/error/review/authorized status. |
| `/questions/:questionId` | Record state first, edit/evidence second; approved is read-only. | Shared themes; not-found/service-error/unauthorized are safe, explicit. |
| `*` | Framed unknown-path/expired-session panel and one return action. | Shared themes; no technical trace or private data. |

Tahadani covers, where supplied, retain aspect ratio, rights metadata, title strip, loading/error
fallback, and content role. They are never decorative wallpaper or a substitute for the
code-native board. Golbha assets/copy/visual mechanics never ship.
