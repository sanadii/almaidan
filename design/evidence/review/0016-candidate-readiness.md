# 0016 — Option B electric-blue homepage candidate

**Date:** 2026-10-02  
**Status:** technical and Root visual review complete; explicit owner live decision pending

The owner [selected Option B](../history/0016-maydan-electric-blue-selection.md) after rejecting the warm-poster structure. This candidate implements that selection only on the combined homepage in the isolated integration checkout `C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof`. The local live preview is <http://127.0.0.1:4173/>. It does not enable Enta gameplay or payment.

| Reviewed artifact | SHA-256 |
| --- | --- |
| [Desktop light](0016-candidate-desktop-light.png) | `7DD1736993143D375E0971DBC883F198F86795D4CF2FE6630B6DACC1804B2AC3` |
| [Desktop dark](0016-candidate-desktop-dark.png) | `90645F6077BAA74672AC12006576C65E669A182252861631C28CD5D0AC85DBAA` |
| [320px light](0016-candidate-mobile-320-light.png) | `A7FA82DDAA80F4AE149FE7B2AA077C8532D73F48E4F014860069A1385A030442` |
| [320px dark](0016-candidate-mobile-320-dark.png) | `DD08F79775EFA419803A27CE9D676DA836A1964FABD6372ADDC484254D70EE19` |

The reviewed source files were `src/routes/HomeSurface.tsx` SHA-256 `5B13FCF283250E8545EE924D28A1E1F2991ACA74F4F4AC1CD8689D85D12C78A0` and `src/styles/khaliah.css` SHA-256 `941F97C31025C89B0BC9B54DD90CF91577713F46E12B50E5424DB1ACF98A8833` in that isolated checkout. Existing homepage tests and the focused browser test were updated; obsolete 0014 homepage CSS was removed while unrelated styles remain.

Forge passed 15/15 focused UI tests, 2/2 focused Playwright/axe checks, `npm run typecheck:app`, `npm run build`, and scoped `git diff --check`. The build retained the existing Vite large-chunk advisory. Root independently reran the 15/15 UI tests before the obsolete-CSS cleanup and the 7/7 inventory/homepage tests afterward, checked the final source diff and CSS consolidation, and inspected desktop and 320px light/dark captures. The browser checks cover 320px horizontal overflow, 44px actions, the 1440×768 first-viewport host action, unavailable Enta, empty room-code validation and focus. The local inventory source remains unavailable; the page reports that state instead of presenting unapproved categories.

**Live-review gate:** The owner has been asked to review the rendered page. An answer approving this candidate must be appended as a new immutable history entry and bound to these exact artifacts before the selected styling expands to other routes. A correction or rejection likewise appends history; technical checks do not override that decision.
