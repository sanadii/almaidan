# T35.I missing media and held-card handoff

Source: `TAHADANI_101_150_15000_CARDS_DRAFT.zip`, archiveSHA256 `0916642b6a12764f75205c4916a629de1cc7a68d5a0aa9c8d9c3494555949cec`.

This file covers this archive only. It does not replace earlier G/H media guides. Source documents are retained privately; held cards are not advertised as playable. The release result is the authority for deployment status.

- [Every held source card, exact reason and original media manifest](../output/t35i-cards-20260922/ROOT-ALL-BLOCKERS.jsonl): 8197 records.
- [Single-question held cards requiring media](../output/t35i-cards-20260922/ROOT-MISSING-MEDIA.jsonl): 846 records, with source IDs, exact raw hashes, prompts, targets and supplied URLs. Some have additional family/content blockers; media alone may not clear them.
- [Release result](../output/t35i-cards-20260922/RESULT.md), [live category inventory](CATEGORY-QUESTION-INVENTORY-2026-09-17.md).

## What to supply

Keep each original sourceId and asset_id. Obtain the exact requested image/audio/video, not a generic substitute. Reference pages and unverified URLs are leads, not prepared assets. Preserve role/position/visibility, identity, license/source information and preprocessing instructions from each media entry. Posters or logos that expose the answer need the specified masking/cropping reviewed before publication. Do not replace missing stimuli with generated or unrelated images.

Check each media entry's `acquisition` record first. A downloaded localFile is already available under the patch evidence directory; it may need masking or identity review, not another download. Acquisition failures retain the concrete reason (such as rate limiting or missing provider file) rather than being mislabeled as absent source links. Source manifest status is preserved separately from acquisition outcome.

Multi-part cards require scoring and scheduling mechanics, not merely another image. Audio and other unsupported mechanics also need a separately scoped runtime change. Conflicting answers, ambiguous inherited fact families and self-answering prompts need source-level review; a binary upload cannot repair them. Retain raw source rather than silently rewriting questions or answers.

The34conservative prompt/answer-string holds in this candidate are mostly legacy formatting or equivalent-name differences, not34proven factual errors. They need duplicate/family reconciliation without rewriting the preserved predecessor.

## All held reasons

| Reason | Source cards |
|---|---:|
| answer_disclosure_or_tautology_review | 75 |
| conflicting_rendered_prompt_answers | 34 |
| insufficient_supported_category_allocation | 5 |
| media_not_root_accepted_or_prepared | 746 |
| unsupported_atomic_mechanic | 100 |
| unsupported_composite_all_parts_required | 7237 |

## Held single-question media by category

| Category ID | Category | Source cards | Distinct asset IDs |
|---|---|---:|---:|
| tahadani-games-276 | النشيد الوطني | 100 | 100 |
| tahadani-games-280 | أعلام | 32 | 32 |
| tahadani-games-317 | شعارات سعودية | 92 | 92 |
| tahadani-games-323 | كرة قدم سعودية | 42 | 42 |
| tahadani-games-328 | شعارات قطرية | 54 | 54 |
| tahadani-games-330 | كرة قدم قطرية | 36 | 36 |
| tahadani-games-333 | شعارات إماراتية | 68 | 68 |
| tahadani-games-335 | كرة قدم إماراتية | 33 | 33 |
| tahadani-games-338 | شعارات بحرينية | 21 | 21 |
| tahadani-games-342 | شعارات عمانية | 84 | 84 |
| tahadani-games-348 | بوسترات مسرح طفل | 98 | 98 |
| tahadani-games-349 | بوسترات مسرحيات | 186 | 186 |

Generated from source-hash-matched final dispositions. No factual or media-rights certification is implied. Earlier source cohorts may overlap this archive; do not sum them as unique missing questions.
