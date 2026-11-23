# Enta live local acceptance — 2026-11-05

This report records bounded HTTP and source verification by the Enta acceptance worker. It does not assert full browser completion. All services were local, existing data was preserved, and only new test identities, matches, rooms and immutable test overlay records were added. No process was stopped by this worker.

## Fresh live room journeys

Evidence: `D:/projects/huroof_wa_oloof/local/almaidan/rooms-http-acceptance-1793852181762.json`. Actual Auth Emulator, PostgreSQL and loopback Enta API. Each journey created a room, joined two independently credentialed guests, attached a read-only display, played/scored a round, early-finished and found the result in history. These are HOST_ENDED results, not natural full-match completion.

| Engine / format | Room | Match |
|---|---|---|
| Classic | E1-JEH5BGZC | 5d0d70ae-67df-44f4-bc23-978857213adc |
| Kids | E1-NMVH8V77 | 74acc400-d61a-4cd8-8c6f-945bc92463f1 |
| Round / list | E1-6RN2FZ37 | cd143d22-3454-4c31-b198-276c10fde659 |
| Round / acting | E1-9NM6Y538 | 2f832a90-834b-4ea5-b645-3ccb55171e48 |
| Round / mixed | E1-5P46K4JR | 9cfba2de-f227-472f-a58c-a8220be7a220 |
| Competitive / tier | E1-Y56ZGZGW | a5bfea34-b5b6-4bb3-8e7a-36c43f03cb48 |
| Competitive / list | E1-23TADQ5X | 5901d42f-a917-482e-b364-c02db782bd37 |
| Competitive / acting | E1-7DC22KLQ | 4d4de27d-3dce-4772-a407-4f2b00ba4c67 |
| Competitive / mixed | E1-8F463HWG | b6c35fde-c7b0-40cb-9d81-3acde0d2faab |

Both mixed modes exercised an authorized drawing canvas append and display readback. Acting/drawing private prompts were present only for the designated actor; the other guest was denied.

## Typed submissions, deadlines and recovery

Reproducible runner: `services/enta/server/src/local-development/rooms-live-recovery.ts`. Evidence: `D:/projects/huroof_wa_oloof/local/almaidan/rooms-live-recovery-1793852246690.json`.

- Round/list E1-ZZEFHMYZ, parent `1dc19e9e-936b-4e0d-bdfd-3a6df2a0da66`, successor `83aa2c1a-e095-48e1-b454-17fb85a66dc7`.
- Competitive/list E1-TR79AZ7G, parent `70267db0-2c7a-4e49-bd51-ab359b62248d`, successor `ae4c0f45-8eb8-4d88-a421-5e19351e214c`.
- Both passed typed submission, normalized duplicate/empty rejection, privacy from other guest/display, real elapsed server deadline, original retry after close, host-only adjudication, idempotent rematch, unchanged parent result and history.
- After the independently completed service restart, existing kids E1-HZ7QY2PJ / `3483f65b-909a-4f93-a1cd-2ee04e1a29a7` remained FINISHED at 1200/1200. This existing record was read only.

## Exact retained content source repair

Legacy classic/kids rematches now resolve their predecessor's exact release identity and root. Original, practice and valid immutable overlay sources are supported; missing or changed sources fail explicitly. An active overlay with matching category IDs can no longer silently change rematch provenance. Published overlay archives use complete temporary writes plus atomic immutable publication; existing corrupt hash objects are preserved and rejected.

- `legacy-rematch-source.test.ts`: original source while overlay active, retained overlay while original active, exact retry, parent unchanged, unknown root rejected.
- `content-overlay-archive.test.ts`: atomic publication, identical existing object, truncated existing object rejection without replacement.
- Independent reviewer reproduced 4/4 tests and reviewed release/root resolution, archive validation, cache identity and import initialization; no blocking finding remained.
- `service.test.ts` 4/4 and real-content/actual PostgreSQL tests 2/2 passed. App and focused strict server compilation passed.
- After the parent reloaded Enta normally, the independent Huroof/admin worker verified actual original-source and archived-overlay HTTP rematches, unseen questions, stable retries, and exact restoration of the original active head. Evidence: `D:/projects/huroof_wa_oloof/local/almaidan/admin-publication-http-1793853443982.json`.

## Supplemental admin inspection

Admin-only projections now include 554 category IDs and 116,068 entries: 115,636 original plus 432 independently reviewed authored-local entries. Six categories each for kids/list/acting/drawing are searchable and paged with their distinct source IDs. Previews expose source/revision hashes, kids age band, answers, performer targets, list items and points. Authored entries remain immutable: both category and question draft requests are rejected by the original-source validator.

`content-admin-catalogue.test.ts` verifies all 24 categories/432 entries, immutable draft rejection, IDs, source metadata and pagination across the original/authored boundary. The two tests and strict application/server compilation passed. After the parent's normal coordinated Enta reload, `content-admin-browse-live.ts` passed against actual loopback services. Evidence: `D:/projects/huroof_wa_oloof/local/almaidan/content-admin-browse-live-1793853584182.json`. It checked all 24 authored categories / 432 prompts (six categories and 108 entries per format), the 554-category / 116,068-entry combined catalogue, cross-source pagination, private admin targets/answers/hashes, guest 403 and invalid-token 401, and unchanged original active release. The content was read only. This is API evidence; rendered admin review belongs to the parent.

## Evidence limits

This worker did not perform browser review, full nine-mode natural completion, media playback, or Huroof runtime review. Their prior evidence and the parent's current browser work remain separate. Two initial recovery-runner failures were test harness expectations of HTTP 200 for normal 201 creation; fixed before successful execution. No production, payment, original release or existing match mutations were performed.
