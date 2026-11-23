# 0018 homepage — Root technical review

Recorded 2026-10-03. INT-032.C is technically implemented and reviewed; human live acceptance is pending. This record does not certify aesthetic quality or authorize styling other routes.

## Exact candidate

- Isolated checkout: `C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof`.
- [Frozen implementation evidence](C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof/output/int3c-homepage-20261003/IMPLEMENTATION-EVIDENCE.md), [freeze](C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof/output/int3c-homepage-20261003/FREEZE.json), and [45-entry hash manifest](C:/Users/User/.codex/worktrees/huroof-enta-integration/huroof_wa_oloof/output/int3c-homepage-20261003/final-hashes.json).
- Freeze: `2026-10-03T05:58:29Z`; HomeSurface SHA256 `0ef7674739547cdaa0d45016f7c5b8321d9b6376353c69104cb07395cf110d69`.
- Root independently verified all 45 final bindings and identical primary/isolated DESIGN-DNA.md.

## Root review

Root inspected the scoped implementation and actual desktop/mobile/dark/reduced-motion screenshots. The initial desktop composition exposed only the top of the artwork; Forge corrected spacing and the 560px artwork slot. Root inspected the corrected 1440×768 first viewport with the complete fan visible, then the live in-app browser.

Root independently reran the inventory suite: **11/11 passed, no skips**. EntryRoute matches the pre-visual baseline byte-for-byte. Live FAQ expansion shows truthful Enta availability. Homepage and both 640px AVIF URLs return HTTP 200 with correct media types/sizes. Ten protected backend hashes remain unchanged.

Forge's frozen evidence records 28 focused tests, 13 browser matrix cases and five affected final desktop checks passing, plus app typecheck, scoped ESLint/whitespace and app/full builds. Known large-chunk warnings and Windows/unconfigured private issuer omissions remain explicit. Artwork payload at desktop DPR1 is 41,771 bytes; controls use finite motion and reduced-motion alternatives.

## Remaining gate

Present the actual candidate at <http://127.0.0.1:4173/> for the owner's explicit live review. Record the exact response as a new immutable history entry before accepting the homepage or expanding its styling. Preview has no live Firebase/catalog configuration; Enta and purchasing remain unavailable. No production deployment, database application, commit or push occurred.
