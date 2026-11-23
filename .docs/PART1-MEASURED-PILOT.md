# Part 1 measured pilot and forecast limits

Current status: Part 1 DONE WITH LIMITS; [completion and exact evidence](PART1-COMPLETION.md). No database writes or new persisted review credit. Parts 2–7 are unstarted.

The pilot selects 100 original IDs across the 44 recovered labels, using first/last rows and 12 middle rows. It is deliberately stratified, not a random population sample. The deterministic 8,170-ID order and four partitions remain unchanged. Pilot IDs must be reused once in their assigned partition.

Individual Root review produced 29 Approve, 36 Revise and 35 Hold. Revision is a proposed correction; Hold records an unresolved question. None establishes runtime playability, rights, semantic uniqueness or human acceptance. Twelve IDs have possible normalized question/answer matches in the current bank; they retain duplicate uncertainty. Final assessments and source contexts are preserved separately from compact rows.

## Measured stages

| Stage | Actual observation | Interpretation |
|---|---|---|
| Lane A 40-row research/draft/quality repair | 537 seconds, 06:01:45–06:10:42 UTC | Provisional decisions, including 20 research-incomplete holds; later corrections and Root acceptance excluded |
| Lane B initial 40-row research/draft/check | 564 seconds, 05:27:48–05:37:12 UTC | Provisional decisions; later evidence closure, corrections and Root acceptance excluded |
| Fresh A 17-row evidence enrichment | 175 seconds, 10:07:53–10:10:48 UTC | Targeted missing-context repair, not complete end-to-end reviews |
| Fresh B 16-row evidence enrichment | End 10:10:33 UTC; start unavailable | No elapsed rate calculated |
| Current coherent bank capture | 238.396 seconds; 135 requests; zero retries | One accepted snapshot, 115,636 question documents and 100 exact pilot originals |
| Bank evidence retention | 8.366 seconds, 276 artifacts / 552 physical copies | Local retention; permanence/off-disk durability not established |
| Actual original derivation | 5.407 seconds; 100 bindings / 106 physical CopyProofs | Source/index/linkage verification, no factual acceptance or writes |
| Final finite assembly | 1.567 seconds; 111 outputs | Existing API mapping/digest/acceptance validation, no database dispatch |
| Final package prepare | 12.052 seconds; 215 artifacts / 430 physical files | 100 review rows, 102 body documents plus separate receipt; actual credit zero |
| Full Part 1 setup and review | Began 04:45:39 UTC; accepted about 11:27 UTC | About 6h42m, above initial 1–2 hour technical-checkpoint estimate; includes reusable tooling and failed attempts |
| Accepted private persistence | Not performed in Part 1 | No persistence throughput benchmark |

Timing sources: lane-A/REMAINING40-SUMMARY-v2.json, lane-B/REMAINING40-SUMMARY-v1.json and preserved Root capture/derivation closures in output/t44-part1-speed-pilot-20261009 and output/t44-continuation-root-20261008. Provider token counts are unavailable. The lane measurements are stage elapsed times, not provider session telemetry.

## What can be forecast

The observed draft stage is 13.425–14.1 seconds per ID. Applying that stage alone to 8,170 IDs gives 30.47–32.00 lane-hours, or an ideal 15.23–16.00 elapsed hours with two fully occupied lanes. A 2,043-ID part has a draft-only equivalent of 7.62–8.00 lane-hours, ideally 3.81–4.00 elapsed hours. These are conditional arithmetic scenarios, not delivery estimates: the sample is stratified, the lanes were not fully concurrent, and the figures omit final evidence closure, Root audit, exception resolution and persistence. Previously accepted pilot IDs reduce their own partition's work once.

The pilot's 35 holds and 36 revisions show that exceptions and corrections are material. Their full elapsed costs were interleaved with tooling and are not reliably separable; no invented exception rate or end-to-end hours are supplied. Each review part should begin with a bounded production-shaped cohort, reuse this pipeline, measure research, corrections, Root audit and separately admitted persistence, then update its estimate. The earlier 150–490-hour forecast remains withdrawn.

The recovered-review track and category-supply track have different sizes. The fresh raw inventory has 530 categories, of which 247 have fewer than 300 stored questions, for a raw deficit of 51,716. This is a lower-bound supply observation at the captured snapshot; stored content is not necessarily reviewed, distinct or playable. The reviewed-playable deficit remains unknown. Parts 6–7 need their own inventory and acceptance evidence before a full-goal ETA is defensible. Seven parts do not promise seven days.

## Faster execution from Part 2

Reuse the frozen compact codec, shared assessment/evidence artifacts, accepted original binding derivation and physical retention proof. Do not rebuild the old expanded archival frameworks for each cohort. Keep at most two read-only factual lanes and one serialized Source writer. Separate regular rows from unresolved exceptions, retain individual decisions, and avoid researching a held claim indefinitely within the regular queue. Reuse the current bank index only while its release/version binding remains applicable; fresh mutation preconditions remain required before private persistence. No blanket approval, cap relaxation or public eligibility follows from this speed change.
