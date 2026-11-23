# 0012 — human selection of the warm poster replacement homepage

**Record ID:** `design-history-0012`  
**Date:** 2026-10-02  
**Status:** immutable human pre-code replacement selection; live homepage review pending

This decision appends to the [0011 live rejection](0011-maydan-homepage-rejection.md), whose exact SHA-256 is `5CB986F67449FB6AB84008C86A86FE6F69D08775ECE5411788CC3687C4E9C74A`. It preserves that rejection and the separate owner-confirmed product name **ميدان**. The three comparable replacement previews are bound in the [exact-three manifest](../integration-reconcept-set-2026-10-02.json), SHA-256 `0A77A11CFB085BF956E41D5A4B6A6BEBC4F0582F553488920067E1184A4E427F`.

The exact human question was:

> Which of the three new מيدان previews should I use for the replacement homepage: A warm poster, B electric blue, or C paper-cut? You can also say none and describe what you want changed.

The exact human answer was:

> A — Warm poster

The owner selected **INT-2R-A — Warm poster play**. Its displayed original 1586×992 PNG is `design/mockups/integration-2026-10-02/int-2r-direction-a-warm-poster-play.png`, SHA-256 `1FA6BB51E67040BF24B0E8D9399D1A6324702CF31F4C6807A9661F6208D58311`. The [owner's Fictional Typeface screenshot](https://images.refero.design/styles/fictional-typeface.com/5f5fd099-866e-4681-917b-0254a3883980/preview_0.jpg) led this option. Its assets, logo, typeface, text and exact composition are not imported. This selection authorizes a replacement combined homepage and entry shell implementation only. It does not approve the rendered page or authorize whole-app visual expansion.

## VISUAL CONTRACT — selected replacement homepage and entry shell

- **Product mood and concept:** ميدان is a sociable Arabic party-game poster: exuberant, warm and confident, with large expressive Arabic type and bright handmade play shapes. The selected A preview is direction evidence, not bitmap UI.
- **Focal point and scan order:** A very large ميدان wordmark leads, then the available حروف invitation and its real start/join paths, then the clearly unavailable إنت صح invitation. Account and explanatory status support that decision. One dominant action per view.
- **Information density:** Homepage 4/10; keep generous cream negative space around one title and two game invitations. Group account, host and join controls instead of adding metrics, a catalog wall or a third card row.
- **Desktop and mobile composition:** On desktop use a full warm-paper stage, oversized central headline and two poster-like game panels with the available Huroof panel visibly primary; original stickers frame rather than cover content. In Arabic RTL, preserve legible reading and keyboard order. On 320px phones stack the headline, Huroof, its start/join actions and the Enta coming-soon panel; keep controls at least 44px, no clipped Arabic or horizontal overflow. Decorative pieces may be hidden or repositioned on phone. Never mirror Huroof's game coordinates or physical team axes.
- **Typography roles:** Self-host the Arabic-capable Lalezar display font from its [OFL-1.1 licensed source](https://github.com/BornaIz/Lalezar) with its license text for the wordmark and short game titles; use the already bundled IBM Plex Sans Arabic for body, labels and controls. Use real selectable DOM text, natural Arabic shaping with no letter spacing on joined glyphs, LTR isolation for room codes, and a readable system fallback if the display font fails to load. Do not rasterize generated lettering or inherit the rejected IBM Plex-only display hierarchy.
- **Palette and surfaces:** Cream/pale-peach background, near-black headline, sunflower-yellow highlights, saturated green for Huroof's available action, and violet for Enta's coming-soon invitation, with restrained red accents. Opaque paper-like panels and subtle code-rendered grain may support the poster feel. Set exact accessible contrast in CSS; actual Huroof crimson/emerald team semantics stay unchanged.
- **Spacing and shapes:** Use an 8px base rhythm, roomy 24–48px panel padding where width allows, broad irregular-looking but stable poster frames, bold 2–3px outlines or print-like edges and chunky pill actions. Bright original circles, bursts and arrows remain peripheral; they cannot overlap text or controls. The illustrative Huroof motif must respect its 25-cell staggered hex identity if depicted as a board.
- **Imagery and icons:** Draw simple original shapes, honeycomb and stage cues in code or locally authored SVG; no copied Refero artwork, fake live board state, external decorative dependency or raster screenshot as UI. Hide decorative marks from assistive technology. Reviewed content media, when later available, follows its own rights and privacy contract.
- **Interaction and UI states:** Real create/join/account navigation must remain usable by mouse, touch and keyboard. Show verified-host requirements, code-entry validation, loading, focus-visible, press, unavailable reason and recoverable error states clearly. Enta has a visibly disabled coming-soon state until reviewed gameplay/content and paid admission are actually available. Never display invented credits, categories, users or matches.
- **Motion restraint:** Finite 120–180ms press/focus feedback and subtle entrance only if it aids orientation; no bouncing wordmark, ambient sticker loops or moving targets. Honor reduced-motion settings.
- **Explicit anti-patterns:** No return to the rejected black/white/fuchsia layout; no generic card dashboard, tiny decorative accents as the only reference response, 3D stadium, neon/glass treatment, copied source logo/stickers, rasterized text, misleading play CTA, fake financial data, unreadable Arabic, obscured actions or changes to gameplay rules.

## Next gate

Implement this contract on the isolated homepage and entry shell, verify real desktop and 320px RTL rendering plus functional actions, then obtain the owner's explicit live review of the implemented page. Until that review approves it, existing game and supporting routes keep their historical visual treatment. Deterministic checks validate evidence identity, structure, dimensions, provenance and threshold consistency only; they cannot certify aesthetic quality. AI/model reviews remain advisory and cannot replace the owner's selection or live review.
