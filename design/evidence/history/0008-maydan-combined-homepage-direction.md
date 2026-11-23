# 0008 — human selection of ميدان for the combined app

**Record ID:** `design-history-0008`  
**Date:** 2026-10-01  
**Status:** immutable human pre-code concept and name selection; homepage live review pending

## Authority and exact selection

This record appends to, and does not alter,
[0007](0007-spatial-studio-whole-app-rollout.md). The exact SHA-256 of 0007 at
this selection is
`B6FF90DD167B0813A1118C23AC030B71260D66A71DCCC38B077643DE8EFB7510`.
The three comparable concept previews are bound in
[the concept-set artifact](../integration-concept-set-2026-10-01.json), SHA-256
`BA0FB9D388417EECF4967366D6556AADED4A3CEF2F5E769D65267EC19DD5B187`.

The exact human review question was:

> Which visual direction and product name should the combined app use? Choose A / لَمّة, B / ميدان, or C / مِداد from the three previews above. You can also choose a direction with a different name in free text.

The exact human answer was:

> ميدان

The owner selected **concept B — ميدان** as both the visual direction and the
product name for the combined Huroof and EntaSa7 app. The selected 1586×992
PNG is `design/mockups/integration-2026-10-01/concept-b-maydan.png`, SHA-256
`F9C9FC2D199B83BB2B6BEE583489BB29977D0A3E177ACCC4805C74AF8AEE9B28`.
The owner has not yet reviewed an implemented homepage. This authorizes a
homepage and unified entry shell implementation only; whole-app visual rollout
requires a later exact human live-review record.

## Visual contract — combined homepage and entry shell

Mood/concept: ميدان is an Arabic competition stage for two distinct games under one account and catalog. Its character is crisp, energetic and fair: mostly ink and white with one fuchsia action accent. The selected screenshot establishes direction, not literal pixel layout or shippable artwork.

Focal/scan order: the page title and the choice between حروف and إنت صح lead; next come the primary create-match action and join-by-code action; account, credit and availability information are supporting status. Show only real available modes and content. One dominant decision per viewport.

Density: public homepage 4/10, setup and host 5/10, player/audience 3/10, admin 6/10 if expanded after live review. Preserve whitespace, grouped controls and a single focal point; no tiny score-like metrics or card stacks.

Desktop/mobile composition: Arabic RTL shell with a bounded max-width stage. Desktop gives the two games equal clear choices, with create and join actions directly below. On phone, stack game choices then actions in reading order, with 44px minimum targets and no horizontal page overflow at 320px. A future TV audience view keeps an uncluttered 16:9 safe area. RTL never mirrors Huroof game coordinates or the physical team axes.

Typography roles: retain IBM Plex Sans Arabic for production copy; 700 for brand and game names, 600 for headings/actions, 400–500 for explanations. Never track joined Arabic letters. Use tabular figures for genuine timers/scores and isolate room codes and technical IDs as LTR. Re-enter all generated text as checked HTML text.

Palette/surfaces: near-black ink, white or soft-white task surfaces, and a single strong fuchsia for the primary action, focus and selected entry. Use solid opaque panels and high-contrast borders. Preserve semantic crimson/emerald ownership colors and accessible contrast in actual Huroof gameplay; fuchsia never reassigns team meaning. Define exact values in tokens after rendered contrast checks.

Spacing/shapes: a 4px spacing system with 24–64px section rhythm; straight or lightly softened geometric frames, crisp 1–2px rules, and restrained shadow only where it aids grouping. The hexagon can identify Huroof, but decorative shapes cannot claim to be its live board. Actual Huroof play keeps the canonical 25-cell six-neighbour board, hit targets and physical team rails.

Imagery/icons: use code-rendered, labelled game marks and one coherent outline icon family; no rasterized screenshot-as-UI, copied Refero brand assets, fake match data or invented content. Rights-cleared category media appears only from approved releases with fallback. The homepage works before any decorative image loads.

Interaction/states: show real public browsing and join access, and correct verified-host/account requirements. Every action has focus, press, busy, disabled reason, validation and recoverable error states. Empty, unavailable, offline and reconnecting states are truthful. Hidden answers, admin scope and credits remain server-enforced, not visual-only.

Motion: 90–120ms press and about 200ms state transitions; finite feedback only. No ambient loops, moving targets, timer jitter or hover-only actions. Respect reduced motion with static states.

Anti-patterns: no imported concept bitmap as product UI; no square-grid replacement for the Huroof board; no generic neon gamer dashboard, crypto/bracket branding, gradients, glass, fake players/scores/credits, nested cards, copied logos or features shown as live before they work.

## Binding and next review

For the new combined homepage, this contract supersedes incompatible visual and
product-name clauses in the older Huroof `DESIGN-DNA.md`. It does not amend 0001–0007
or their receipts, nor change any game mechanics, content rights, role filtering,
authentication, payments or historical screens. Existing Huroof routes retain
their prior approved visual treatment until a live review of the new homepage
specifically authorizes expansion. Deterministic checks may verify only this
record's identity, structure, dimensions, provenance and hash bindings; they
cannot judge aesthetics. AI review is advisory and cannot replace the human
homepage review.
