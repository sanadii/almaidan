# RR-ST50-PUB PUB-02 — concrete protocol proposal

Start here: [index](README.md) · [implementation](IMPLEMENTATION-PLAN.md) · [milestones](MILESTONES.md) · [handover](HANDOVER.md) · [governing publication plan](RR-ST50-PRIVATE-PUBLICATION-PLAN.md).

2026-10-08. Status: PROPOSED FOR DATABASE/SECURITY/ROOT ADOPTION. Separate Astra medium planner supplied this protocol; Root persists it. No implementation, execution or publication authority. Preserve earlier plan findings as dated history.

## Accepted basis and dependencies

PUB-01 material acceptance: `output/t44-continuation-root-20261008/ROOT-RR-ST50-QUALIFIED-MATERIAL-ACCEPTANCE-V1.json`, SHA a62ee1972c7f8c87a56a317d1284d86cf90019b95b700605c46810e3750601bb. Qualified412-member seal SHA36390956a9141560af9ba9f15362c9b8c3e47d5317550bf6e3d0fa6f51ef1e3c. Semantic digest1fd90ac3c08315c57e9a57d4e77b2ea0f8039803e32ab88d60581ba586f02cb9.

Namespace: `questionReviewImports/rr-st50-qualified-userdata-1fd90ac3c08315c57e9a57d4e77b2ea0f8039803e32ab88d60581ba586f02cb9`, project huroof-a3ee7, database(default).

Actual `RR-ST50-PREPARE2-1/CONTENT-PACKAGE.json` has68 documents: root,54 historicalBodies,11 historicalRoleByteChunks,manifest,inactive historical completion template. Accepted measurement:19 groups/max5 documents, typed aggregate3802941/envelope3820334/maxdocument123373/maxgroup222841/maxreservedwire226986 bytes. Aggregate/envelope headroom391363/373970. These68-document measurements do not certify prospective69-document fit.

Current813 MODEL/6813 saved plus MODEL/8170 blanks; exact selected50 join accepted. Captured763 stays dated immutable data. Publication adds zero review/playable/public/human credit.

| Task | Owner/dependency | Acceptance | State |
|---|---|---|---|
| PUB-02.A | Root + Database/Security; PUB-01 | Adopt protocol, caps, provider/public bounds, concurrency qualifications | Proposed |
| PUB-02.B | Forge/PUB-03; .A | Strict schemas, isolated Source/fixtures, original68 bodies and19 groups preserved, no execution | Held |
| PUB-02.C | Root/Security/PUB-04–05; .B | Once-admitted literal69-document/receipt/batch/wire/request-bound/restoration checks | Held |
| PUB-02.D | Database/Security/Gate/Root/PUB-06; .C | Integrated implementation/risk/cap acceptance before separately granted live stages | Held |

Protocol adoption permits Source authoring only; measurement remains PUB-04–06. No prospective fit PASS.

## Schemas, receipt and caps

Strict versioned schemas rejecting unknown fields: `rr-st50-publication-protocol-v1` (project/database/namespace/material/seal/digest/ordered68 paths and hashes/19 groups/receipt/protected paths/budgets/trust); `rr-st50-publication-admission-v1` (one stage/fresh slot/Source/runtime/provider/Gate/protocol hashes/prerequisites/latest ledger/identity/expiry/output/write allowance); `rr-st50-publication-observation-v1` (sanitized authority/counts/typed bodies+versions/readset+membership digests/transaction outcomes/closing); `rr-st50-operational-receipt-v1`; `rr-st50-publication-result-v1` (stage-specific acknowledged/unknown effects/evidence/completeness/limits).

New receipt path `<namespace>/completion/operational-qualified-v1`; preserve `<namespace>/completion/inactive-qualified-template-v1` byte-for-byte. Receipt binds accepted package/seal/semantic identity/all68 body-member digest/latest ledger and selected-ID join/accepted VERIFY-ARCHIVE and CALIBRATE hashes/protected-public binding/receipt-stage identity+policy+Source/zero additional credits. It attests preceding checks only, never later readback/VERIFY-FINAL/REPEAT, circular self-hash or future commit time.

Proposed receipt typed-body ceiling32768 bytes; actual/worst-case bounded dynamic fields need literal measurement and actual receipt remeasurement before grant. Original19 ordered groups unchanged; receipt is separate20th one-document group. Missing-only subsets preserve original order and need literal measurement; no automatic regrouping.

Unchanged caps:131072/document;262144 complete batch+commit wire;10docs/batch;4194304 aggregate+complete envelope;depth24;4096 JSON-safe transaction-token content reservation. Overflow STOP/versioned decision, no cap increase.

## Readset and exhaustive document membership

Full point readset71 paths =68 private bodies +proposed receipt +`runtime/activeRelease` +exact `releases/<id>` referenced by pointer. Complete protected fields/create+update versions and pointer binding required. Proposed public typed-body ceiling262144 bytes/document; current fit unknown; missing/oversized/changed state STOP without truncation or expansion.

Audit: one owned transaction, four batchGet calls≤20 paths, then projected all-descendant enumeration beneath exact namespace ordered by full document name/page100; explicit empty terminal response after nonempty page. Expected descendants67 before receipt/68 after; root point-read. Maximum2 query pages including terminal. First unexpected/foreign/duplicate/skipped/missing/cursor fault/nonterminal overrun STOP; no unknown branch expansion.

Enumeration must cover arbitrary descendant documents including missing intermediate parents. Source/service grammar needs review/fake tests and fresh live compatibility. Empty collections are outside document membership. A point-read allowlist or collection enumeration alone is insufficient. Use exact owned RW token throughout receipt readset/membership checks; retain timestamps without unsupported global-monotonic/single-readTime assertions. Precise transaction guarantee needs Database disposition; no global writer exclusion or lasting integrity claim.

## Stage DAG and effects

ARCHIVE → VERIFY-ARCHIVE → CALIBRATE → RECEIPT → VERIFY-FINAL → REPEAT. Each arrow requires Root acceptance plus fresh finite admission/output slot. Every stage freshly checks adopted principal and all five exact permissions with the same bearer used for its Firestore requests.

ARCHIVE: complete opening audit, receipt absent/existing bodies exact. At most19 fixed one-use group slots: each fresh RW transaction rereads public pair/root/receipt absence/group members, checks exact existing bodies and stable observed versions, creates only missing exact bodies with exists:false. At mostone commit/nonempty group; zero commit for complete group; immediate complete group+public readback. Complete closing audit. Partial correct private creates preserved.

VERIFY-ARCHIVE: independent fresh full68-body/version/membership/public audit, receipt absent; independently restore qualified user data from readback.

CALIBRATE: one RW transaction/full71-path readset/exhaustive projected membership/complete proposed receipt validation then acknowledged rollback. ZERO writes/commit dispatch. Actual feasibility within transaction budget required before receipt.

RECEIPT: fresh authority/new RW transaction repeats full readset/membership; requires accepted private versions/public binding/receipt absence. Create only exact new receipt with exists:false LAST. Retain acknowledgement +fresh closing audit; unknown commit outcome STOP.

VERIFY-FINAL: fresh69-body/version/membership/public audit and qualified restoration. REPEAT: distinct invocation/identical exhaustive verification/no begin-RW/commit/write transport; private versions unchanged from accepted VERIFY-FINAL. Zero-write flag alone insufficient.

## Hard proposed budgets

Every application request/raw byte charged before parsing, including failures/wrappers/transaction controls/metadata. No application retries/redirects. Limits are STOP boundaries, not performance predictions.

| Stage | Requests | Query pages | Document response records | Total raw bytes | Stage time |
|---|---:|---:|---:|---:|---:|
| ARCHIVE |100|4|640|50331648|900s|
| VERIFY-ARCHIVE |12|2|160|8388608|240s|
| CALIBRATE |12|2|160|8388608|180s|
| RECEIPT incl closing |20|4|320|16777216|300s|
| VERIFY-FINAL |12|2|160|8388608|240s|
| REPEAT |12|2|160|8388608|240s|

Audit requests:begin1+batchGet4+queries2+rollback1=8; authority2. Archivegroup begin1+pointread1+commit-or-rollback1+readback1=4; total2+8+19×4+8=94, margin≤100 only bounded failure cleanup, never retry. Two audits≤278 docrecords;19group reads/readbacks≤9each yields342,total620≤640.

Per response:identity/IAM/control/commit65536;projection262144;fullbatchGet3145728. Outgoing non-write controls65536;write wires unchanged262144. Four≤20-path batches cover71;≤20private maxbody contributes2621440. Place bounded public pair so worst-case total/framing≤3MiB; prove arrangement/framing offline.8MiB allowance covers measured3.8MiB plus bounded publics/receipt/projection/control overhead; no current fit claim.

Request30s outsideRW;RW min(5s,remaining transaction/stage). RW total20s/idle10s;RO total120s/idle30s. Bounded5s rollback cleanup reserved within stage; unacknowledged cleanup UNKNOWN. CALIBRATE must establish actual prospectiveRW feasibility. Provider acquisition90s included stage total; exact policy separately identifies SDK-internal traffic/at-most2 internal retries, never counted as application retry/Firestore calls. Policy mismatch STOP, no automatic increase.

## Authority, tests, failure handling and exclusions

AUTH-RR01 mechanism is conceptual adaptation only with new lineage: no Source/fixture/live/credential/grant/slot transfers. Fresh exact provider/runtime/Source pins/full external preflight every child; no B03 offline exception transfer. Held Source/credential memory/SDK internal retries/alternate FS/installed distribution+OS trust/incomplete graph/check-to-load races/no native containment require exact Root/Security adoption. No credential/bearer/raw provider errors logged. Stage-local observation cannot serve as reusable grant.

Before every stage join latest Root ledger/exact50; changed ledger requires new binding, never package mutation. Reserve each invocation/group before child/provider effects. Expiring grants bind exact protocol/Source/runtime/provider/material/ledger/protected state/operation/prerequisites/Gate.

Fake checks:complete/partial/existing archive;all68+receipt restoration;extras under missing parents;pagination terminal/duplicate/cursor faults;public body/version/ABA;typed/lexeme mutation;historical receipt confusion;circular/future receipt attestations;limits±1;stage request formulas;provider/runtime/admission/identity/each permission;lostcommit/rollback failure/spent slots;zero-commitREPEAT. Unexpected acceptance must fail harness.

Onfailure preserve correct creates/slots/evidence. Only rollback owned active transaction within protocol before uncertain commit. No compensating delete/overwrite. Lost commit ACK requires separately admitted readonly reconciliation, never resend. No schema/rules/IAM/public/learner/default-project/lock/Mortality/Git changes. Completion supplies private publication WITH LIMITS only, zero review/playable increment.

## Load-bearing questions before adoption

1. Database confirm exact all-descendant query grammar/missing-parent/transaction service compatibility; existing RT05 reference does not establish fresh compatibility.
2. Database accept precise projected-membership/public-state transaction concurrency guarantee; no global exclusion.
3. Public sizes unknown: offline framing proof and live fit for256KiB/public and3MiBresponse.
4.32KiBreceipt arithmetic headroom is not actual69-document/envelope/wire measurement.
5. Exact successor provider review must separately qualify SDK-internal retries/local-effects policy.

Next: Database/Security PUB-02.A review. Root records decisions before PUB-03 Source-only assignment. No source/runtime/auth/database execution occurred during planning; telemetry unavailable.

## PUB-02.A Root disposition after Database/Security review

2026-10-08: ADOPTED FOR PUB-03 SOURCE-ONLY AUTHORING WITH LIMITS. Prior proposal bytes remain in output/t44-continuation-root-20261008/RR-ST50-PUB02-FIRST-PROPOSAL-HISTORY-V1.md, immutable SHA8ddbd81a7fe84c619f223062b9b1fb4a73ce048a56b7a52f68ca173618e16b32. Database and Security conditional concurrence supplied these binding corrections; they supersede contrary generic phrasing above. No execution, measurement PASS, credentials or publication authority.

1. ARCHIVE opening/partial audits allow only expected missing candidates. Reconcile batchGet by exact requested full name, found or missing, with no duplicates/unrequested/omissions. Projected descendant membership MUST equal point-read FOUND subset; unknown descendants STOP. VERIFY-ARCHIVE onward requires all68 exact bodies, appropriate receipt state and full membership. Never compare batchGet positional order.
2. Exact namespace document parent; structuredQuery select.fields:[{fieldPath:'__name__'}], from:[{allDescendants:true}] with collectionId OMITTED, orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}], limit100, no filters/offset/explain. Subsequent startAt:{values:[{referenceValue:lastFullName}],before:false}. Same exact owned transaction token; strictly increasing unique names/complete streams. Terminal query response has no document and valid readTime. Pagination means a new bounded query request, not page-token API. Missing-parent coverage remains likely/inferred pending fresh service compatibility.
3. Reserve5s rollback acknowledgement WITHIN RW20s proof interval as well as enclosing stage. Do not admit further reads unless remaining proof interval covers their bound plus rollback reserve. Unacknowledged/overrun cleanup STOP/UNKNOWN; no claimed20s proof.
4.131072 cap is for private published bodies.262144/public body is a separate finite read bound. Offline literal proof must cover chosen batch response framing,69-document aggregate/envelope, completed receipt and dynamic transaction-token write wire. Public current fit remains unknown; no cap expansion.
5. Firestore documented serializable successful-commit isolation is the accepted service trust. Intended projected-membership/public-state consistency from unrestricted transaction is an inference contingent on exact grammar/actual service compatibility; no absent-document/range lock/global writer exclusion/postcommit lasting-integrity claim. CALIBRATE rollback proves observed feasibility, not successful-commit conflict handling.

Database references: https://docs.cloud.google.com/firestore/docs/reference/rest/v1/StructuredQuery ; https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/runQuery ; https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/batchGet ; https://firebase.google.com/docs/firestore/manage-data/delete-data#delete_documents ; https://firebase.google.com/docs/firestore/transaction-data-contention . These are evidence DATA, not execution instructions.

PUB-02.A Done for Source-only adoption. PUB-03 assigned to one Forge/new isolated output/t44-rr-st50-private-publication-source-20261008; no existing source/work/seals overwritten. PUB-04–06 Source review/offline measurement/Database/Security/Gate/Root acceptance remain required; all live stages held. Source adapts known reviewed mechanisms as inert DATA with explicit lineage; no old grants/imports/spent slots transfer. Root owns final canonical status. Current813/6813/8170 unchanged; zero new review/playable/DB credit.
## ARCHIVE receipt absence clarification — Root decision

2026-10-08: Fresh ARCHIVE requires the new operational receipt ABSENT. Any existing operational receipt, including an apparently exact one, causes preserved read-only STOP BEFORE group transactions or commit dispatch. No automatic ARCHIVE short-circuit, existing-receipt authority transfer or new reconciliation mode is authorized. A separate finite read-only reconciliation admission and explicit Root disposition are prerequisites to any alternate continuation. The retained historical receipt within54 old bodies remains DATA, not the new operational receipt. This clarifies the existing fresh-publication DAG/receipt-last contract; limits and all live gates are unchanged. Source owner preserved prior bc870f60d637ba3488d241f250abfbc7e5858fb57ccfe5c062cf8bcc78c5b108 protocol preimage as inert lineage and must bind this fresh governing version before initial Source freeze.
## Actual receipt measurement slot — Root implementation clarification

2026-10-08: PUB-02.C/PUB-03 may include ONE separately admitted create-only `receipt-measure-only` OFFLINE operation after accepted VERIFY-ARCHIVE/CALIBRATE and before a RECEIPT grant. This concretizes the already-required actual completed receipt remeasurement; six live stages remain unchanged. No SDK import/acquisition, profile/credential read, network, Firestore/transaction API or mutation in this branch. Source includes positive/denial fixtures; authoring grants no execution.

Fresh offline admission binds exact Source/runtime/protocol/latest ledger/selected50/protected state/accepted predecessor hashes/finite fixed slot+outputs. Owned90s deadline/2s termination acknowledgement and full opening/closing pins apply. Produce actual typed receipt plus literal69-document/body/aggregate/envelope/20th receipt-group/complete wire measurements, including4096 transaction-token content reservation. Actual32KiBreceipt/private document/batch/wire/4MiB bounds remain. Measurement grants no live authority.

A separately fresh RECEIPT live grant binds the exact body/measurement; production code independently remeasures it before dispatch. Drift STOP, no automatic regeneration or retry. Receipt-stage identity binding uses adopted expected verified subject/five permissions/policy/Source and assertion of checks preceding creation. Never require an unknown future UserInfo evidence hash/time, own live-grant hash circularity, future commit metadata or subsequent VERIFY/REPEAT proof in the body. Only already accepted predecessor observations/versions are available before measurement. Preserve the prior6b5936b7d255afdfaf45fae802acdbd91066b0acc0ecf7011adafa5e127e9799 protocol in immutable Root history and explicit Source lineage before fresh freeze. Source review/offline execution/Database/Security/Gate/Root acceptance and all live grants remain held.
## PUB-02.R — current deployed client-access rules prerequisite

Status: PROPOSED pending Root/Database/Security adoption. Preserve unexecuted PUB-03 pre-amendment Source; resume rules-related authoring only after adoption. AUTH-RULES-RO01 RULES-07 accepted capture/semantic review is prerequisite to PUB-06 and EVERY live admission. Bind exactrelease name/rulesetName/create+update timestamps/full ruleset-source manifestSHA/reviewedSourceSHA/RootSecurityacceptanceSHA. Local/historical rules/IAM proof insufficient.

Add2GETs per live stage with stage's same verified bearer: opening acceptedRulesRelease AFTERidentity/IAM BEFOREanyFirestoretransaction/commit; closing AFTERfinalFirestore readback BEFOREacceptedsuccess. Both exactly matchacceptedrelease binding. Neverfollownewruleset/fetchnewSource withinPUB; changed/missing/denied/oversized STOP andseparatecapture/newdecision. ARCHIVE brackets whole19group stage, NOTeachgroup; Root/Securitymustadopt non-atomicinterval. Additionalpergroupchecks needseparaterevision.

Perrelease rawlimit65536; add131072 perstageaggregate. NormalARCHIVE94→96, cap100. VERIFY-ARCHIVE/CALIBRATE/VERIFY-FINAL/REPEAT normal10→12, cap12→13 SOLELYoneownedfailurecleanup request. RECEIPT normal18→20, cap20→21 samecleanupreserve. Reserve isNOTretry/refresh/extra commit/rulesreread/pagination/continuation authority; onlyoneeligibleownedrollback beforeuncertaincommitdispatch, otherwiseUNKNOWN. Existingstagetimebounds unchanged/newcalls fitremaining/noextension. Fakeproof fullsuccess+cleanupcounters required.

Newaggregate rawcaps:ARCHIVE50462720;VERIFY-ARCHIVE/CALIBRATE/VERIFY-FINAL/REPEAT8519680;RECEIPT16908288. Privatebody/batch/envelope/writewirecaps unchanged. Receiptbinds acceptedruleevidence andreceiptstageOPENINGbinding only; nofutureclosing claim. Stage result/VERIFY-FINAL/REPEAT retainactualclosing. Remeasureall69 afternewreceiptfields.

Closing ruledrift AFTERacknowledgedcreates/receiptcommit haltsfurtherstages, preservesevidence/docs, privacyacceptanceUNKNOWN/reportobservedchange. No deletion/deploy/overwrite/autocontinue. Rulesrelease/Firestorecommitnon-atomic, propagation/intermediate/futurechanges unexcluded. Specifiedclientruleboundary only, notprivilegedserver/IAMprivacy. No unconditionalprivate-throughout/permanentprivacy claim. Addedfakes:pre-effect/postcommitdrift;sameruleset changedupdateTime;Source/acceptanceSHA mismatch;unauthorizedRulesURLs;bearerchange;403/oversize;cleanupreserve misuse;futureclosingreceiptclaim.

Next: Database/Security review, Rootadoption/newgoverningpin thenPUB03 Sourceonlyresumes. FreshRootSource/offline/Gate/grants remainrequired. Immutablepriora49ddffee8e4be8556d20d6bdcba4c18eeec14d234d2d2aac9e67c70b5fdbbc7 retainedexternalRoot. No effectsauthorized.
## PUB-02.R Root disposition — Source only

2026-10-08: ADOPTED WITH LIMITS afterDatabase/Security review. ResumePUB03 rules-related Sourceauthoring againstthisversion; preserveallunexecutedpre-amendmentpreimages andexactpriorb6091667f95085f784834c1db16df2c02b1288441f65474d94cbb5105d193c8d DATAlineage. RULES07semanticallyacceptedcapture includesexplicitfreshProjectGET:numberbinding plusfullRulesSource andrelease timestamps. SixcaptureAPIrequests areNOT extraPUBcalls; PUB opening/closingtwoRulesGETs and96/12/20normalrequests,100/13/21caps andsingleeligiblecleanupreserve remain. Cleanupneverresendsdispatched/uncertainrollback/commit. Onlyspecifiedclientboundary observed; whole19groupinterval/rulesmanagementtransactionnon-atomic/propagation/intermediate/future/privilegedserver privacylimits explicitlyadopted. No ruledeploy/IAM/schema/default/lock/preview changes. Newreceiptbinding requiresliteral69remeasure; nofutureclosingclaim. AllSourcefullreview/offline/DatabaseSecurityGateRoot/newfiniteactualgrants remain; noeffects authorized byadoption. FreezeSourcegoverningprotocolafterthisappend; subsequentexecutionstatuscanonical4/separateevidence only.