# 0014 corrected homepage — candidate for human live review

**Date:** 2026-10-02  
**Decision authority:** owner live response pending. Automated checks do not decide aesthetic quality.  
**Local preview:** `http://127.0.0.1:4173/`, isolated integration checkout.

The selected [0012 Warm poster](../history/0012-maydan-warm-poster-replacement-selection.md) was corrected under the owner's [0014 exact Refero direction](../history/0014-maydan-fictional-reference-correction.md), bound by [receipt](../reference-correction-receipt-0014.json) and [token readback](../integration-fictional-style-readback-2026-10-02.md). The homepage uses the exact pale peach/black/red/yellow/lime/violet reference anchors, light game invitations, a white supporting capsule, and original code-drawn accents. The Huroof motif has 25 uniform yellow staggered cells; Enta remains visibly unavailable. No other game route was restyled.

| Render | Pixels | SHA-256 |
| --- | --- | --- |
| [Desktop light](0014-candidate-desktop-light.png) | 1440×1447 | `109005C00007DECE21CA74997ACE6F4EFF849700CC89DDF5AD4CFCD6211630FE` |
| [Desktop dark](0014-candidate-desktop-dark.png) | 1440×1447 | `ACB0A8AD44FCBB667FCED3DCDBA639EA744A370D5190D19670E0AB159D3909C9` |
| [320px light](0014-candidate-mobile-320-light.png) | 320×2060 | `E07D1F5CD3B866DA3B07719B350D78638C96D0A1339DDFF5CFA681850C0F78AD` |
| [320px dark](0014-candidate-mobile-320-dark.png) | 320×2060 | `098BDD99C6DE7C37D765078BEC282E522C65FF131C79EB527ABA880CBC754D8B` |

Isolated source SHA-256: `src/routes/HomeSurface.tsx` `C59E093AFD82130D402DA1BCC8863EAF93D623610B69BE6FE3D7D979D94653B5`; `src/styles/khaliah.css` `90BA6D94CD88E4D1392A93C13866A1846422E21F1767456F34CDDB16BC4B1AAE`; focused `tests/e2e/a11y.spec.ts` `33A7E2D7356C5D18C4E57F994FFA0E99B5CF20688759E0C8801F8625EA8EE88A`.

Forge checks: 15 focused homepage UI tests; two Playwright layout/accessibility checks; app typecheck; app build; scoped diff check all passed. The browser check asserts 320px no horizontal overflow, 44px action targets, 25 uniform yellow cells, white hero capsule, dark content contrast, verified-host login path and no Enta play link. The automated accessibility scan found no critical or serious violations. Root independently reviewed all four actual renders against the exact reference and reran `npx vitest run tests/app/home-surface-inventory.test.tsx`: 7/7 passed. The broader `npm run typecheck` still fails on missing `firebase-functions/https` types and follow-on Functions errors; the app-only typecheck and build pass. The build retains a large-chunk advisory. These limitations predate the scoped visual correction.

The owner must review the live corrected page and explicitly approve or request changes. Until then INT-3B remains open and the selected visual system cannot expand to other routes.
