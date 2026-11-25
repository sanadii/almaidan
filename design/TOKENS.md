# Design Tokens

Authority: exact reusable values for [`DESIGN-DNA.md`](../DESIGN-DNA.md).  
Implementation seed: [`tokens.css`](tokens.css).

## Theme colors

The shared semantic palette is defined in [tokens.css](tokens.css). Dark surfaces use
navy, primary actions use blue, and active controls pick up cyan in the dark theme.
The `--khaliah-*` and `--maydan-*` color aliases resolve these token families while
preserving the established shell and homepage shades. Existing `--gameplay-*`,
`--spatial-*`, and `--arena-*` values cover legacy board details, spatial surfaces,
and the audience stage.

| Token | Light | Dark | Role |
|---|---:|---:|---|
| `--app-canvas` | `#F3F6FB` | `#081321` | Shared canvas |
| `--app-surface` | `#FFFFFF` | `#142236` | Panel and field surface |
| `--app-subtle` | `#E8EEF7` | `#20334C` | Quiet control surface |
| `--app-ink` | `#15253D` | `#F4F7FC` | Primary text |
| `--app-muted` | `#485C76` | `#BDCBDC` | Supporting text |
| `--app-border` | `#76869B` | `#71849E` | Control and panel boundary |
| `--app-action` | `#175BC4` | `#175BC4` | Primary action fill |
| `--app-accent` | `#075CAA` | `#80D9F5` | Links and focus accent |
| `--app-error` | `#B42318` | `#FFB4AD` | Error text |

The audience board uses the navy `--arena-*` stage in both themes. The horizontal
team uses crimson and the vertical team uses green. Preserve the physical team axis,
patterns, Arabic labels, and glyphs alongside the colors.

## Typography

- Family: Cairo via `--font-ui`, with metric-matched fallbacks and Instrument Sans.
- Weights: 400, 500, 600, 700.
- Scale: 12, 14, 16, 20, 24, 32, 48px and `clamp(3rem, 7vw, 4.5rem)`.
- Line heights: 1.15 display, 1.35 UI, 1.6 reading.
- Timers, scores, ranks, and result columns use tabular numerals.

## Spacing, sizing, shape

- Base unit 4px; scale 4, 8, 12, 16, 24, 32, 48, 64px.
- Page gutter: 16px mobile, 24px tablet, 32px desktop, 48px audience display.
- Minimum touch target 44×44px; host primary controls 52px high.
- Player buzzer: `min(72vw, 320px)` across flats, never below 220px.
- Shared radii use `--radius-sm` (8px), `--radius-md` (12px), `--radius-lg` (16px), and `--radius-pill` (999px). Use `--radius-none` or `--radius-circle` for intentional square or circular geometry. Existing surfaces retain their named special sizes.
- Borders: 1px divider, 2px control/cell, 4px winning path; icon stroke 2px.

## Motion and layering

- Durations: press 90ms, fast 120ms, state 200ms, large 320ms.
- Never use `transition: all`; reduced motion removes translation/scale and limits opacity to 100ms.
- z-index scale: base 0, sticky 20, popover 40, modal 60, toast 80.
- Use named `--shadow-*` recipes with the existing arena and spatial aliases. Designated gradients cover the illustrated home artwork and masks, audience stage lighting, and board materials. Keep their recipes and SVG stop colors in the associated tokens.
- Disabled controls use the named disabled background, foreground, and border tokens. They do
  not use opacity as their only signal and do not receive hover or active treatment.
