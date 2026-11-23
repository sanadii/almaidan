# INT-4 — EntaSa7 private editorial intake pilot

**Status, 2026-10-02:** source discovery and factual triage only. No row below is editorially approved, rights-cleared, imported or publishable. This is a review queue for the [INT-4 content contract](INT-4-CONTENT-CONTRACT.md), not a catalog manifest.

Source: clean `D:/projects/EntaSa7-git` commit `a009328442c7469937b073b6a8fe3ce4ce115160`, `server/prisma/data/extraQuestions.json` SHA-256 `32a1bd7788d4f7d919af0e676c84b11d8a76e7f63d7752af535a5e1982ff1604`. Key format is category name + one-based JSON array index + this file hash. The seed labels the extra bank AI-drafted (`server/prisma/seed.ts:6–14`), sets image URL undefined and deduplicates by category/text/answer; no stable source category ID is committed. A sample of four rows per actual 200/400/600 tier in each of تاريخ and تكنولوجيا had no exact prompt/answer duplicates within the sample or each category’s three starter rows. That narrow screen is not correctness or rights approval. Selected rows have no media.

**Full-category numerical supply check, 2026-10-02:** A read-only scan of the same pinned artifact found 25/25/24 rows at the 200/400/600 tiers in each pilot category. Neither category has missing text, answer or points, or an exact normalized prompt or prompt-plus-answer duplicate within a tier. Each therefore has enough distinct raw candidates for two fresh and two repeat selections per tier. This proves only numerical supply; semantic duplicates, factual quality, complete-content review, rights, and actual selector replay remain open.

| Category | 200-point source indices | 400-point indices | 600-point indices | Current status |
| --- | --- | --- | --- | --- |
| تاريخ | 4, 13, 53, 54 | 21, 25, 30, 64 | 36, 39, 45, 46 | All twelve await editorial/rights approval; 25 and 45 need wording revision. |
| تكنولوجيا | 2, 4, 11, 12 | 25, 31, 33, 65 | 36, 38, 50, 72 | All twelve await editorial/rights approval; 38 and 50 need revision; 33, 36 and 72 benefit from precision. |

## Factual triage of nuanced candidates

These institutional-source checks help an editor decide exact wording; they are not signed review or rights receipts. Retain the original row/key and create a new revision if wording changes. Verify accepted-answer variants separately.

| Source key | Triage | Recommended prompt → answer | Evidence |
| --- | --- | --- | --- |
| تاريخ #25 | Rewrite | «في أي عام دخلت سفينة إنديفور بقيادة جيمس كوك خليج بوتاني؟» → 1770. Avoid a claim that Cook “discovered” Australia. | [National Museum of Australia, Botany Bay](https://www.nma.gov.au/exhibitions/encounters/places/botany-bay) |
| تاريخ #45 | Rewrite | «في أي عام بدأ أعضاء الكونغرس توقيع النسخة الرسمية على الرق من إعلان الاستقلال؟» → 1776. Distinguish adoption from the later signing process. | [US National Archives, Declaration](https://www.archives.gov/milestone-documents/declaration-of-independence) |
| تكنولوجيا #33 | Keep answer; precision option | «من كتب أول مقترح للشبكة العنكبوتية العالمية في مارس 1989؟» → تيم بيرنرز لي. | [CERN, birth of the web](https://home.cern/science/computing/the-birth-of-the-web/short-history-web/) |
| تكنولوجيا #36 | Keep answer; precision option | «في أي مختبر طوّر جون باردين ووالتر براتين أول ترانزستور نقطي عام 1947؟» → مختبرات بيل. | [Nokia Bell Labs history](https://www.nokia.com/bell-labs/unix-history/blcontributions.html), [Nobel transistor history](https://educationalgames.nobelprize.org/educational/physics/transistor/history/index.html) |
| تكنولوجيا #38 | Rewrite answer | «من بنى أول نموذج أولي لفأرة الحاسوب في مختبر SRI عام 1964؟» → بيل إنجليش. The source distinguishes prototype builder from Engelbart's invention/patent. | [SRI, computer mouse history](https://www.sri.com/hoi/computer-mouse-and-interactive-computing/) |
| تكنولوجيا #50 | Rewrite product wording | «ما اسم وحدة التخزين القرصية التي قدّمتها IBM مع نظام RAMAC عام 1956؟» → وحدة تخزين الأقراص IBM 350. | [IBM storage history](https://www.ibm.com/support/pages/ibm-storage-development-celebrates-40-years-tucson-arizona) |
| تكنولوجيا #72 | Keep answer; precision option | «ما اسم الشركة الناشئة التي استحوذت عليها Google عام 2005 وواصلت منها تطوير Android؟» → Android Inc. | [Google founders’ letter](https://googleblog.blogspot.com/2009/05/2008-founders-letter.html), [Google SEC subsidiary list](https://www.sec.gov/Archives/edgar/data/1288776/000119312508032690/dex2101.htm) |

**Next editorial gate:** independently inspect every proposed row and accepted answer, record an exact complete-content hash, reviewer decision and provenance/rights receipt, then run actual first/repeat selectors on sealed revisions. The owner’s general code/content permission supports intake but does not substitute for per-row quality review or media rights evidence. None of this pilot supplies LIST, study, kids, drawing or Huroof letter-mode coverage.
