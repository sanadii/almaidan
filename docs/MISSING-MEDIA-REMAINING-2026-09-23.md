# Remaining media work

Updated 2026-09-23 against active release `t35h-rebase-059f411c0636288ffa1f60237ca7bd79`.

This is a private editorial handoff. It may contain question targets, answers, source URLs, and provenance in the linked detailed worklists; do not publish it with the player application.

## Current position

- The active release contains **107,354** approved questions and **3,428** bound runtime-media records.
- Bound runtime media is not listed here as missing.
- The remaining work below comes from separate source packages. Do **not** add their row counts together as a unique-media total: different packages can refer to the same asset or question family.

## Media still needed by source package

| Source package / workstream | Rows needing new or final media | Other media work | Exact worklist |
|---|---:|---:|---|
| Earlier supplied-folder reconciliation (T35.F) | 16,598 acquisition/final-asset rows | 1,219 rows need editing, verification, binding, or runtime support | [Acquisition guide](MISSING-MEDIA-ACQUISITION-2026-09-22.md), [CSV](MISSING-MEDIA-ACQUISITION-2026-09-22.csv), [JSON](MISSING-MEDIA-ACQUISITION-2026-09-22.json) |
| 27-category / 8,100-card draft patch (T35.G) | 6,600 prepared-media rows: 4,200 image, 1,200 audio, 1,200 video | 1,511 rows have a supplied candidate/direct URL; a URL is not a verified final asset | [T35.G worklist](MISSING-MEDIA-T35G-8100-2026-09-22.md) |
| 50-category / 15,000-card draft patch (T35.I) | 846 held single-question cards requiring media | 7,237 composite cards also require unsupported multi-part mechanics; 1,111 prepared PNGs are retained but the corrected release had not been accepted at the time of this handoff | [T35.I worklist](MISSING-MEDIA-T35I-CARDS-2026-09-22.md) |

## Delivery rules

1. Keep the original `sourceId` and `asset_id` with every delivered file.
2. Provide the exact requested image, audio, or video plus source/provenance and any crop, mask, or clip timestamps.
3. Treat supplied URLs and downloaded references as leads, not automatic approval for gameplay.
4. Do not substitute a generic poster, incorrect version, adult photo for a childhood prompt, or generated lookalike.
5. Media delivery alone does not clear cards needing answer-leak review, duplicate/family reconciliation, identity/version checks, or unsupported mechanics.

## Detailed status meanings

The older acquisition guide uses dispositions such as `missing_final_asset`, `download_failed`, `downloaded_needs_edit_or_review`, and `embedded_needs_binding_or_runtime`. The T35.G and T35.I reports preserve their source-package-specific reasons. Use the detailed files for question-level IDs and instructions; this summary deliberately does not duplicate answer-bearing records.
