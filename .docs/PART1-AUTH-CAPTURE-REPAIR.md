# Part 1 bounded authentication capture repair

Start here: [daily parts](DAILY-PARTS.md) · [speed plan](REVIEW-SPEED-PLAN.md) · [implementation](IMPLEMENTATION-PLAN.md) · [handover](HANDOVER.md).

Scope: Part1 / SPEED-02 only, explicitly authorized October9. Astra medium supplied the consequential repair plan; Root persists and refines it with Security and Database review. This document is design authority, not a live operation grant. Parts2–7 remain unstarted.

## Evidence and concrete defect

Legacy Source manifest a92eb10c91562b87a27f3a3c61ac5cc6ed7a33d802af83dda87e22b150af4f5e passed73 child and22 parent offline checks. Its one admitted capture stopped at PROVIDER after one acquisition and zero application control requests,4.119941s; CAPTURE-1 is spent. SDK internal traffic and the underlying refresh failure were not established by its generic diagnostic.

Installed firebase-tools/lib/auth.js:485–504,610–615 requires exact sorted cached/requested scope arrays and expiry exceeding15min. Requesting three hardcoded scopes when the cached profile explicitly records [] forces refresh. That establishes the unwanted refresh path, not the concealed underlying failure. Cached metadata observed today had a future expiry; secrets were neither printed nor retained.

Preserve the old Source,973-file boundary, grants, retained artifacts and spent slots unchanged. New operation uses a reusable separately reviewed Node-only source and finite immutable external grants; do not clone historical trees or invent a new codec for every attempt.

## Proposed boundary, with Security refinements

- Require the exact expected signed-in account, present well-formed stored scope ARRAY, cached access and refresh credentials, and expiry greater than now+15min+90s. Explicit [] is legal; missing/null/malformed/duplicate/nonstring scopes stop. Never replace [] with asserted granted scopes.
- Check SDK haveValidTokens before getAccessToken. Pass copied arrays because SDK sorting mutates them. Invoke once only with valid cache, no separately authorized refresh. Verify returned bearer, expiry and scope set against the observed cached values; reject bearer equal to refresh credential. Recheck margin before acquisition. On insufficient/changed cache stop; do not log in, rewrite credential files, refresh or change the default project.
- Record storedScopes honestly, scopeServerVerified:false and freshIssuance:false. Empty metadata proves neither absent nor granted server scopes. Fresh same-bearer identity/IAM/project/Rules calls prove only those observed operations. Qualify SDK internal behavior, filesystem races and incomplete dependency coverage; do not claim a complete transitive graph or atomic loaded-file proof.
- New trust boundary pins own Source, installed Node and the49 observed SDK provider dependency files, while explicitly trusting the installed vendor/OS distribution with limitations. Old Python/historical973 files are unexecuted dependencies of this new mode and remain untouched. Root/Security/Database must adopt the NEW boundary before Source implementation; acceptance of old grants never transfers.
- First mode performs ONLY six bounded control requests: expected account UserInfo, exact five IAM permissions, explicit huroof-a3ee7 project, opening cloud.firestore release, its exact referenced Ruleset, closing same release. Maximum90s whole operation plus2s owned-child termination acknowledgment, no application retries/redirects/pages,0 document reads/writes. Preserve raw project/Rules bytes before parsing; never retain raw identity/IAM/provider failures or credentials. The five control responses cap65536bytes each and Ruleset1048576bytes, total1376256.
- Current official FirebaseProject schema documents seven fields (name, projectId, projectNumber, displayName, state, annotations, etag), with projectNumber an int64 STRING. Current reference has no resources field. Unknown returned shapes stop; do not discard fields to manufacture acceptance. Source reference: https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects (checked October9).
- Keep exact Rules source filenames as DATA; ordinal artifact names, strict Unicode before UTF8, validated names/project identity, raw hashing and opening/closing release equality including nanoseconds. Root/Security inspect the actual captured Rules semantics before any bank access.
- Diagnostics contain fixed owned stages/codes, booleans/counts and bounded HTTP status only. Stages cover credential-preflight, provider-load, acquire, result, UserInfo, IAM, project, opening-release, Ruleset, closing-release, evidence-write, closing-pins and termination. Never persist exception messages/names/stacks, raw SDK bodies, tokens, profile or credential values. Unknown errors stay unknown.
- Current question-bank inventory/novelty is a separate finite mode and admission AFTER actual Rules/privacy acceptance. Its collection paths, pagination, bytes, time and snapshot semantics require Database/Security review. No data write, IAM/rule/schema/default/release change is authorized by this capture.

## Ordered tasks and acceptance

| ID | Owner / dependencies | Outcome / checks | State |
|---|---|---|---|
| AUTH-FIX-01 | Root / Security / Database | Adopt cache-only and new Node/vendor boundary; preserve all legacy authorities. | Root and Security conditional Source-only adoption; Database pending |
| AUTH-FIX-02 | One Source writer;01 | One reusable finite capture/grant protocol and strict adapters; Source manifest freeze. | Pending |
| AUTH-FIX-03 | Root / Security / Gate;02 | Full own Source review and adversarial offline checks; fresh load-bearing Root check and Source gate. | Pending |
| AUTH-FIX-04 | Root;03 | Fresh one-use external capture grant; six-request actual read-only run, complete/partial retention and closing pins. | Pending |
| AUTH-FIX-05 | Root / Security;04 | Full captured Rules semantic review, actual stable release tuple and qualified current access/privacy acceptance. | Pending |
| AUTH-FIX-06 | Root / Database / Security;05 | Separately adopt/admit bounded current-bank inventory and reconcile baseline/index. | Pending |

Required offline cases: explicit [] scopes and mutable-sort defense; missing/malformed/duplicate/nonstring scope metadata; returned mismatch; wrong account; absent cache; expiry below margin or changed during run; unexpected refresh path; bearer equal to refresh; acquisition count; honest scope metadata; same bearer and explicit project/default preservation; exact project grammar; pins/stale grants/spent slots; byte/time caps, partial outcomes, safe diagnostic redaction and unknown-child termination. Tests must reject the expected owned denial, not pass for unrelated errors. Verify0 application retry/profile/rule/deploy/document mutation paths.

New attempt means new external finite grant and spent slot. Source version changes only when Source changes. Every failure preserves partial evidence, spends its slot and stops; diagnosis precedes any newly admitted attempt. Do not overwrite credentials, auto resend, delete locks or weaken TLS.

## Impact, rollback and parallel work

Expected impact is using a valid SDK cache without the demonstrated scope-forced refresh. Speed and actual access remain unproved until the run. No schema/IAM/rules/default/release/document changes; preserve previews, user data, foreign processes and legacy evidence. Rollback is stop/preserve partials, not destructive state restoration.

Factual pilot work may continue within two read-only helpers and one Source writer. Authentication or draft completion adds no accepted review/playability credit. Part1 remains incomplete until pipeline, pilot quality/linkage/current baseline and measured forecasting pass.

Next action: finish Database domain adoption, then Source-only Forge assignment; no live execution inherited from this plan.

## AUTH-FIX01.A — cached bearer without SDK execution

October9 Astra refinement, adopted by Root, Database and Security WITH LIMITS for Source/offline authoring only. This supersedes SDK getAccessToken acquisition and the49-file SDK execution boundary above. A precheck cannot categorically prevent the SDK refresh branch if time/cache validity changes. The replacement capturer has no refresh capability. Expiry must be an actual safe integer, not coerced; expiry and scope metadata remain client metadata. Path/reparse/descriptor observations are sampled safeguards, not atomic containment.

Read the exact admitted credential-profile path once into bounded owned memory, maximum65536bytes. Check every ancestor/file reparse status, regular-file identity, before/open/after metadata, complete EOF, strict UTF8/JSON and duplicate-key rejection before selecting credentials. Preserve no raw profile or secrets in outputs. Require exact adopted account, explicitly present validated scopes array ([] remains []), finite numeric expiry exceeding current time by15min+90s, separately validated access/refresh token grammar and access != refresh. No fallback account, alternate credential source or missing-value coercion.

Retain only the access credential required for requests after validation. Releasing JavaScript references is not secure erasure. Do not import/load/invoke Firebase Tools/auth SDK, configstore, refresh/login helpers or subprocesses. No refresh or credential-profile write route exists. SDK49 and Python973 files do not belong to the new executing closure; historical Source/seals/grants/spent slots remain unchanged. Trust boundary is exact owned Source, installed Node and adopted OS/runtime trust, qualified for runtime provenance, metadata/read races and lack of native containment.

Use the same captured bearer for all six fixed requests; recheck expiry before each dispatch and enforce90s with monotonic time. Uncertain clock validity, expiry or identity failure stops without reacquisition/retry. Report scopeMetadataSource:stored-profile, observed providerScopes honestly, scopeServerVerified:false and freshIssuance:false. Server responses establish only observed endpoint access.

Diagnostics use credential-snapshot and bearer-validation, fixed owned codes and safe counts. Add offline proofs of absent SDK/refresh/subprocess/credential-write routes; strict snapshot/path/size/metadata/EOF/parser handling; empty/missing/malformed scope distinctions; wrong account/access=refresh; expiry boundaries/clock changes/monotonic deadline; identical bearer six calls/no401–403 retry; secret-free evidence and preserved partial/spent state.

AUTH-FIX02 now authors this SDK-free variant after domain adoption. Fresh Source/offline/Gate/one-use admission remain necessary; no prior execution grant transfers.

## AUTH-FIX01.B — expiry margin for the SDK-free operation

October9 Root/Database/Security Source-only adoption WITH LIMITS. This supersedes the15min inherited SDK cache-selection threshold ONLY for the new SDK-free capturer. Require actual safe-integer millisecond client expiry strictly greater than observed wall time plus the remaining WHOLE90s operation budget plus60000ms safety margin, at selection and before every dispatch. Equality fails. One admitted operation clock includes parent preflight, snapshot and native acknowledgement; never reset it per request. Retain nonnegative monotonic elapsed, wall/monotonic divergence at most1000ms, request deadline min(30000,remaining),90s parent cap and2s owned termination acknowledgement.

SDK15min behavior no longer executes. The60s margin is a local policy, not server expiry/security verification or fresh issuance. Same-bearer fresh identity/IAM/project/Rules responses establish observed endpoint access;401/403/expiry/drift stop with preserved partial evidence and no retry, reacquisition, login or refresh. Legacy SDK/15min Source/grants/spent history remain unchanged.

Before Source freeze, fixtures cover threshold±1ms/equality, margin erosion before every dispatch, forward/backward clock jumps, native acknowledgement wait, total deadline and absence of fallback. Existing byte/request/effect/trust scope is unchanged.
