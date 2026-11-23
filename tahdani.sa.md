# Design Map

Source: https://tahdani.sa/ (also trivia-game and wasalha), captured 2026-09-13. Requested verify URL redirects to login; private screens unobserved. Browser fallback expressly approved by user.

## Spacing Scale
4, 6, 8, 12, 16, 24, 32, 40, 48, 56, 80px; mixed scale, no strict base inferred. Content span 1240px at a 1440px viewport.

## Font Hierarchy
Graphik Arabic; 48px/600 and 40px/700 headings; 24px support; 18–24px actions. Adaptation retains installed IBM Plex Sans Arabic.

## Color Palette
Source only: brand #f27a3d; canvas #f4fce2; ink #064e3b. Adaptation: cobalt #2456d6; ice #f4f7ff; navy #14284b; white #ffffff; cyan #80dfef.

## Image Ratios
Hero 0.80:1; phone 0.61:1; category 0.75:1; wordmark 2.77:1. Rounded portrait cards, small opposing tilts, contained full artwork, curved section overlaps.

## Component Tokens
48–56px buttons; 999px pills; 20.4–24px cards/dialogs; 0 2px 1.5px rgba(0,0,0,.25) outer and inset 0 -2px 4px rgba(0,0,0,.25) lower shadows. Transform transitions 0.2s. Focus-visible and reduced-motion rules found in source CSS.

## Evidence and limits
See output/taste-tahdani-20260913 for browser screenshots, DOM snapshots and summaries. Initial promotional modal dismissed before the primary homepage capture. Empty section-gap/grid extractor fields are not claims of absent spacing. Private game behavior is unavailable; app behavior derives from the existing implementation. No source logo or private font is shipped.

## Measured categories

| Category | Evidence |
|---|---|
| 1. Color palette | Source #f27a3d brand, #f4fce2 canvas, #064e3b ink; documentary only. |
| 2. Font families | Graphik Arabic across all three public DOM snapshots. |
| 3. Font size scale | 48, 40, 32, 24, 20, 18, 16, 14, 12px sampled. |
| 4. Font weights | 400, 500, 600, 700; 900 appears in sampled text. |
| 5. Border radius | Home 8/16.8/20.4/40/80/999px; category-page covers 40.755px. |
| 6. Shadow types | Hero card 0 4px 4px rgba(0,0,0,.25); pills outer + inset lower shadow. |
| 7. Image aspect ratios | Hero 0.80:1, phone 0.61:1, category 0.75:1, source logo 2.77:1. |
| 8. Card aspect ratios | Transformed home card boxes 334×392 and 339×395px; art is 4:5. |
| 9. Spacing scale | 4/6/8/12/16/24/32/40/48/56/80px; 24px appears 16 times in home capture. |
| 10. Layout grid | 1240px content maximum; no CSS-grid match from extractor, column count not inferred. |
| 11. Section spacing | Homepage hero 989px high; 80px appears seven times on wasalha; section-gap extractor empty. |
| 12. Component reuse | Header 187–191×56px pills repeat; content CTA 230×56px; nav and footer share logo. |
| 13. Text alignment | Homepage introduction centered; feature paragraph/heading visually right-aligned in home-features.jpeg. |
| 14. Neutral tinting | #f4fce2 canvas has a yellow-green tint; #fefefe is near-neutral white. |
| 15. Shadow construction | Two layers on buttons, one black 25% layer on tilted cards; green inset outline also sampled. |
| 16. Nested radius | 20.4px hero cards and 999px actions are separate shape roles; no concentric ratio inferred. |
| 17. Typography system | 48px/56.4px and 40px/47px headings; 24px/38px game support; no consistent modular scale. |
| 18. Spacing method | Both gap and margin/padding; sampled list gap 12px, heading padding 16px 39px. |
| 19. Motion properties | transform 0.2s; background-color/border-color/box-shadow 0.15s; some all transitions. |
| 20. Interaction details | focus-visible and reduced-motion rules found on all three pages; redirect URL preserved for login. |

## Repeated patterns

- **Broad sections** — 1440px hero and 1240px copy span, curved canvas boundary; separates introduction from explanation.
- **Pressable action shape** — repeated 48–56px pills and two-layer shading; distinguishes actions from body copy.
- **Portrait imagery** — 4:5 hero cards, 3:4 category covers and 0.61:1 phones; gives each subject a stable visual slot.
- **Arabic hierarchy** — 48px/600 and 40px/700 headings recur across game pages, with 24px/500 support; separates the invitation from its explanation.
- **Responsive content grouping** — centered first-view copy and right-aligned feature sections; moves from a shared invitation to specific game instructions.
- **Surface repetition** — orange brand fields and tinted cream content fields recur on all pages; source color roles become cobalt and ice in the adaptation.

# Taste DNA

### Curved sections set the pace
- **Trigger**: Moving between introduction and detailed game information.
- **Decision**: Use broad curved color boundaries instead of enclosing every section in a card.
- **Reason**: The reader can recognize a new topic before reading its heading.
- **Evidence**: 1440px wide hero; 989px homepage hero height; curved cream transition in home-clear-viewport.jpeg.

### Buttons feel pressable
- **Trigger**: Giving a short call to action visual priority.
- **Decision**: Use 48–56px pills with inset lower shading instead of a flat text link.
- **Reason**: The action has a distinct physical silhouette among the illustrations.
- **Evidence**: 56px navigation buttons; 999px radius tokens; 0 2px 1.5px rgba(0,0,0,.25) plus inset 0 -2px 4px rgba(0,0,0,.25).

### Portrait images carry the game choice
- **Trigger**: Explaining two games before entry.
- **Decision**: Pair portrait artwork with short copy instead of long feature inventories.
- **Reason**: Pictures establish the subject quickly while copy explains the next action.
- **Evidence**: hero art 683×853 and 681×855; phone art 775×1263; category covers rendered 269×359.

### One Arabic family is enough
- **Trigger**: Distinguishing navigation, display copy and explanations.
- **Decision**: Use one Arabic family with size and weight changes instead of mixing display families.
- **Reason**: Arabic letter rhythm stays consistent across the long page.
- **Evidence**: Graphik Arabic across captured typography; 40px/700 and 48px/600 headings; 24px frequent text size; 400/500/600/700 weights.

