# T37.M image-media acquisition handoff — 2026-09-24

Private editorial handoff for the three `(1).zip` question archives. This document and the linked local ledgers contain answer/target information; do not ship them to players. The active T37.M successor published exactly **39** reviewed whole-object image questions after guarded upload, full release readback and a zero-write retry. The other **322** image rows remain held. Downloaded files alone did not publish any row. The later Topup67 T39 intake repeats the exact 139 whole-object and 32 flag source IDs here; its duplicate `(1)`/`(2)` ZIP copies add no image work. T39's separate 138 audio-question candidates are tracked in the [T39 media handoff](MISSING-MEDIA-T39-2026-09-25.md), not in the 322-image hold count.

| Batch | Question rows | Local binary status | Public/playable status |
|---|---:|---|---|
| `tahadani-011` whole-object | 139 | 139 exact-revision OpenMoji SVG originals and transparent PNG derivatives downloaded/prepared | 39 published with private generation-bound media; 100 held after identity/editorial/alias review |
| `tahadani-012` cropped-object | 190 | 190 exact-revision originals/whole PNGs downloaded; 760 v3 partial PNG candidates generated (4 per row) | 0 newly published; independent contact-sheet advice found 127 potentially identifiable rows and 63 holds, but all 190 need individual approval |
| `tahadani-games-280` flags | 32 | Berlin/Hamburg thumbnails (2), eight exact-file Commons SVG originals, and one exact-file Commons-rendered PNG candidate are local/private; all other candidates remain held | 0 newly published; exact variant/rights/attribution and editorial review required |

The private per-question [acquisition ledger](../output/t37-media-20260924/ACQUISITION.jsonl), [accepted/held ledger](../output/t37-media-20260924/ma4-whole-object/ACCEPTED-HELD-LEDGER.private.jsonl), [whole-object review](../output/t37-media-20260924/WHOLE-OBJECT-REVIEW.jsonl), [crop v3 summary](../output/t37-media-20260924/crops/v3-subject75-full/CROP-PREP-SUMMARY.json) and [direct-flag retry](../output/t37-media-20260924/DIRECT-FLAG-RETRY.jsonl) pin IDs, source bytes, hashes, geometry and hold reasons. OpenMoji attribution renders at [image credits](https://huroof-wa-oloof.vercel.app/media-credits). The [live T37.M result](../output/t37-media-root-20260924/LIVE-RESULT.md) records the exact published subset and verification limit.

## Published subset and remaining review

Active release `t37m-media-cc919463d962a644fefb20b5d05ed8f8` contains 115,636 approved questions and 4,578 media documents. Its verified generation-bound root is `7ef9b9fe0aad1b6945bd3d2b476da3f831626085174990643fa6240db68b771c`. The 39 new `tahadani-011` bindings use private, hash-checked 768×768 PNGs with neutral public alt text; the public credits route was checked in normal Chrome. The first guarded apply encountered a transient fetch failure after partial immutable writes but before pointer activation. Exact-field partial resume completed, separate full verification passed, and the repeat apply returned `alreadyActive:true` without a write.

The 100 remaining whole-object rows need individual editorial, identity, alias/overlap or fairness clearance; the 190 crops need per-row geometry/answerability and phone-display approval; all 32 flags still need exact file/variant/rights and player-display review. No held row is represented as public or playable. A fresh QA room verified ordinary image delivery, audience answer privacy and scoring, but its sampled first-round image questions were predecessor rows: the room's queue put the first new T37.M ID at position 21. A newly published question's browser display and scoring were **not** directly observed in that room, so that narrower end-to-end claim remains open even though the release/objects and selector queue verified.

The downloaded direct thumbnails are [Berlin](https://commons.wikimedia.org/wiki/File:Flag_of_Berlin.svg) and [Hamburg](https://commons.wikimedia.org/wiki/File:Flag_of_Hamburg.svg). Their individual Commons pages identify the flag and assert public-domain status for the depiction, while warning that insignia-use restrictions are separate. Both remain held pending exact-file and game-context checks; the [file-page review](../output/t37-media-root-20260924/DIRECT-FLAG-FILE-REVIEW.md) records their hashes and page details.

## MA2b bounded acquisition evidence — 2026-09-24

All records below are private, candidate-only evidence. No Cloud Storage upload,
Firestore write, release pointer change, or publication was attempted.

- [First-pass original ledger](../output/t37-media-20260924/flags/FLAG-ORIGINAL-ACQUISITION.jsonl): 6 of 30 exact-file SVG originals downloaded locally and held; 18 HTTP 429 holds; 6 unsafe-SVG holds.
- [One post-cooldown retry](../output/t37-media-20260924/flags/FLAG-ORIGINAL-RATE-LIMITED-RETRY.jsonl): touched only those 18 rate-limited rows; 2 more exact originals were downloaded and held (Saxony and New Brunswick), 12 remained HTTP 429, 3 were rejected as unsafe SVG, and 1 malformed earlier candidate title (Bavaria lozengy) remained held. No broad retry or variant substitution occurred.
- The six first-pass unsafe-SVG rows received a separate exact-file rendered-PNG process. The retained [dimension-repair ledger](../output/t37-media-20260924/flags/FLAG-UNSAFE-SVG-RASTER-DIMENSION-REPAIR.jsonl) contains one Thuringia PNG candidate only: exact Commons file page/revision `1275323506`, original Commons SHA-1, question-binding hash, original attribution metadata, rendered URL, fetched URL, SHA-256, MIME, byte size, and dimensions. It is `1280×640`, 543 bytes, SHA-256 `e9e84f6c511979e028053682909e25369400be299e5df66cf4694085d4976948`; the API advertised `1024×512`, so both values are retained rather than concealed.
- The other five first-pass unsafe SVGs (Schleswig-Holstein, Alberta, Northwest Territories, Saskatchewan, and New South Wales) remain held after their bounded rendered-PNG attempt rate-limited. The [first raster ledger](../output/t37-media-20260924/flags/FLAG-UNSAFE-SVG-RASTER-CANDIDATES.jsonl) and [versioned retry ledger](../output/t37-media-20260924/flags/FLAG-UNSAFE-SVG-RASTER-RETRY.jsonl) are retained unchanged. They contain no local PNG bytes.
- Total exact-file source originals retained: **8**. Total rendered PNG candidates retained: **1**. **All 32 flag questions remain unpublished and unplayable.** Every retained candidate is still held for individual license/author/source/attribution, exact-variant, insignia-use, editorial-overlap, and player-display review.

## Candidate file-page worklist (30; 22 source originals not retained)

These are candidate file-description pages resolved from gallery leads, **not accepted variants or blanket permission**. Use the individual Commons page, current file revision, original bytes/hash, author/source/license and official flag reference before adding a question. German civil/service variants and some Canadian/Australian attribution or insignia-use details remain open.

| Question target | Candidate file page |
|---|---|
| تورينغن | [Flag of Thuringia](https://commons.wikimedia.org/wiki/File:Flag_of_Thuringia.svg) |
| شلسفيغ هولشتاين | [Flag of Schleswig-Holstein](https://commons.wikimedia.org/wiki/File:Flag_of_Schleswig-Holstein.svg) |
| ساكسونيا | [Flag of Saxony](https://commons.wikimedia.org/wiki/File:Flag_of_Saxony.svg) |
| بريمن | [Flag of Bremen](https://commons.wikimedia.org/wiki/File:Flag_of_Bremen.svg) — variant needs confirmation |
| هسن | [Flag of Hesse](https://commons.wikimedia.org/wiki/File:Flag_of_Hesse.svg) |
| بافاريا | [Flag of Bavaria (lozengy)](<https://commons.wikimedia.org/wiki/File:Flag_of_Bavaria_(lozengy).svg>) — striped/lozengy variant needs confirmation |
| براندنبورغ | [Flag of Brandenburg](https://commons.wikimedia.org/wiki/File:Flag_of_Brandenburg.svg) |
| مكلنبورغ فوربومرن | [Flag of Mecklenburg-Western Pomerania](https://commons.wikimedia.org/wiki/File:Flag_of_Mecklenburg-Western_Pomerania.svg) |
| ساكسونيا أنهالت | [Flag of Saxony-Anhalt (state)](<https://commons.wikimedia.org/wiki/File:Flag_of_Saxony-Anhalt_(state).svg>) — service/civil variant needs confirmation |
| ساكسونيا السفلى | [Flag of Lower Saxony](https://commons.wikimedia.org/wiki/File:Flag_of_Lower_Saxony.svg) |
| سارلاند | [Flag of Saarland](https://commons.wikimedia.org/wiki/File:Flag_of_Saarland.svg) |
| راينلاند بالاتينات | [Flag of Rhineland-Palatinate](https://commons.wikimedia.org/wiki/File:Flag_of_Rhineland-Palatinate.svg) |
| بادن فورتمبيرغ | [Flag of Baden-Württemberg](https://commons.wikimedia.org/wiki/File:Flag_of_Baden-Württemberg.svg) |
| شمال الراين وستفاليا | [Flag of North Rhine-Westphalia](https://commons.wikimedia.org/wiki/File:Flag_of_North_Rhine-Westphalia.svg) |
| ألبرتا | [Flag of Alberta](https://commons.wikimedia.org/wiki/File:Flag_of_Alberta.svg) |
| الأقاليم الشمالية الغربية | [Flag of the Northwest Territories](https://commons.wikimedia.org/wiki/File:Flag_of_the_Northwest_Territories.svg) — indirect source |
| أونتاريو | [Flag of Ontario](https://commons.wikimedia.org/wiki/File:Flag_of_Ontario.svg) |
| نوفا سكوشا | [Flag of Nova Scotia](https://commons.wikimedia.org/wiki/File:Flag_of_Nova_Scotia.svg) — dead source link |
| ساسكاتشوان | [Flag of Saskatchewan](https://commons.wikimedia.org/wiki/File:Flag_of_Saskatchewan.svg) |
| نيو برونزويك | [Flag of New Brunswick](https://commons.wikimedia.org/wiki/File:Flag_of_New_Brunswick.svg) |
| كولومبيا البريطانية | [Flag of British Columbia](https://commons.wikimedia.org/wiki/File:Flag_of_British_Columbia.svg) |
| يوكون | [Flag of Yukon](https://commons.wikimedia.org/wiki/File:Flag_of_Yukon.svg) |
| كيبيك | [Flag of Quebec](https://commons.wikimedia.org/wiki/File:Flag_of_Quebec.svg) |
| جزيرة الأمير إدوارد | [Flag of Prince Edward Island](https://commons.wikimedia.org/wiki/File:Flag_of_Prince_Edward_Island.svg) |
| نيوفاوندلاند ولابرادور | [Flag of Newfoundland and Labrador](https://commons.wikimedia.org/wiki/File:Flag_of_Newfoundland_and_Labrador.svg) |
| نونافوت | [Flag of Nunavut](https://commons.wikimedia.org/wiki/File:Flag_of_Nunavut.svg) — no source listed |
| مانيتوبا | [Flag of Manitoba](https://commons.wikimedia.org/wiki/File:Flag_of_Manitoba.svg) — indirect source |
| جنوب أستراليا | [Flag of South Australia](https://commons.wikimedia.org/wiki/File:Flag_of_South_Australia.svg) — page flags invalid SVG/source uncertainty |
| كوينزلاند | [Flag of Queensland](https://commons.wikimedia.org/wiki/File:Flag_of_Queensland.svg) — confirm standard variant |
| نيو ساوث ويلز | [Flag of New South Wales](https://commons.wikimedia.org/wiki/File:Flag_of_New_South_Wales.svg) |

This T37.M handoff is separate from the wider [current missing-media inventory](MISSING-MEDIA-CURRENT-2026-09-24.md), which covers other question archives, including audio. The 900 bundled Clean70 challenge SVGs are a separate disabled-challenge review, not 900 missing T37.M downloads.
