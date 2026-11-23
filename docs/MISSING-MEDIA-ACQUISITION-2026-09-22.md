# Missing media and remaining asset work — 2026-09-22

Reconciled against the actual live release. Release: `t35f-complete-17c6c0b23e51dcdfd9dd2634216e1de5`. Removed 1,052 newly published source rows from the worklist.

There are **16,598 rows needing acquisition or additional final assets** and **1,219 rows needing editing, verification, binding or game support using supplied/reference material**. The CSV has **17,817 asset-related rows**. Another 14,885 held/duplicate rows have non-media blockers; getting images will not resolve those.

| Status | Questions |
|---|---:|
| download_failed | 281 |
| downloaded_needs_edit_or_review | 19 |
| downloaded_reference_needs_composition | 113 |
| downloaded_reference_needs_exact_asset | 147 |
| embedded_needs_binding_or_runtime | 300 |
| local_asset_reference_unverified | 900 |
| missing_final_asset | 16,057 |

## How to use the files

1. Open [the CSV](MISSING-MEDIA-ACQUISITION-2026-09-22.csv) in Excel and filter `acquisitionNeeded = true` to find files you need to obtain. UTF-8 BOM preserves Arabic text. The [JSON](MISSING-MEDIA-ACQUISITION-2026-09-22.json) retains exact structured records.
2. Follow `requiredDeliverable` and the original Arabic production brief. `existingUrls` are supplied references, not proof of a usable final asset. Failed downloads include their recorded reason.
3. For downloaded rows, `downloadedAssets` gives the existing local PNG and its hash. Use it where suitable; do not download it again unnecessarily. App glyphs are not exact app-store icons, full-name badges need a genuine masked/cropped version, and portraits may need a source-faithful crop.
4. A `local_asset_reference_unverified` row names a source archive member whose existence has not been verified by this report. Check the original package first. An embedded asset already exists in the source and needs binding or runtime support, not collection.
5. Return files with a mapping containing `sourcePack`, `sourceId`, asset role (question/answer), filename and source URL. For shared assets, list every applicable question ID. Keep original files and any crop/mask derivatives separate; include rights/source information when available.
6. Do not replace childhood photos with adult photos, invent lookalike logos, or substitute a different clip/icon version. Audio, timed boards, acting/drawing and private-role mechanics also need runtime work; possessing a file alone will not make those questions playable.

This is a private editorial handoff: it contains answers and source provenance. Do not deploy these files to the public website. Publication, factual accuracy, identity and rights are not certified by this report.

Counts throughout this report are question rows, not necessarily unique files. One shared asset can satisfy multiple rows only when their exact source requirements match.

## Image-link patch accounting

All 3,000 question IDs are accounted for. The patch supplied 642 mappings to 471 unique URLs; after a bounded retry, 275 unique source assets downloaded and 196 remain held. A download is not necessarily the final playable stimulus.

| Current question disposition | Questions |
|---|---:|
| download_failed | 281 |
| downloaded_needs_edit_or_review | 19 |
| no_supplied_link | 2,358 |
| downloaded_reference_needs_exact_asset | 147 |
| downloaded_reference_needs_composition | 113 |
| published_playable | 82 |
