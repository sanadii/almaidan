# AUTH-RULES-RO01 — current Firestore rules capture

Start here: [index](README.md) · [implementation](IMPLEMENTATION-PLAN.md) · [milestones](MILESTONES.md) · [handover](HANDOVER.md).

Status: PLANNED; Source authoring only after Root adopts this scope with Security/Database concurrence. Separate Astra medium planner supplied this plan. No execution grant.

## Outcome and basis

Capture current production default-Firestore release, complete referenced ruleset and closing release observation for Root/Security review. Establish observed Source identity and reviewed client-access semantics for questionImports and questionReviewImports.

Local firestore.rules SHAa151e6c9a9a0c9eb51ace8a4d08d7f69902feaecc897e59e62db5c0831edb096 grants room-projection gets and otherwise denies clients. T42 Gate/October2 record earlier matching deployment; INT-000.R2 explicitly says current rules unverified. None proves currentOct8 boundary. AUTH-RR01 is identity/IAM only; reviewed in-memory provider mechanism is adaptation DATA with new lineage, never grant/slot/Source/result transfer.

## Exact five requests and budgets

One bearer throughout, in order:

1. Exact Google UserInfo GET, adopted account/verified email/subject SHA enforced.
2. Exact huroof-a3ee7 testIamPermissions POST, existing five datastore permissions.
3. GET https://firebaserules.googleapis.com/v1/projects/huroof-a3ee7/releases/cloud.firestore
4. GET https://firebaserules.googleapis.com/v1/ plus validated rulesetName from3.
5. Repeat exactly3.

No discovery/list/alternative-release fallback/getExecutable/rules testing/create/patch/delete/deploy/Firestore document operations. Preserve demo default/auth configuration/locks/preview. RulesetName is one nonempty identifier under literal projects/huroof-a3ee7/rulesets/; reject traversal/encoded separators/query/fragment/foreign project/host; construct URL from validated components. Returned ruleset name exactly equals request. Datastore IAM does not prove Rules API permission;403 diagnostic STOP, never scope/IAM repair or automatic consent.

Maximum5applicationrequests/0retry/0redirect/0pages. Raw limits:UserInfo/IAM/each release65536;ruleset1048576;aggregate1310720 bytes. Charge before strictUTF8/duplicate-key JSON/completeEOF parsing; no truncation/partial acceptance/normalization/newline rewriting. Invocation90s includes provider+allrequests; each min(30s,remaining); ownedACK2s. Timeout/unacknowledged exit UNKNOWN/no automaticretry. SDK internal traffic/at-most2 retries separately qualified, not five apprequests; fresh policy retains memory-adapter/unexcludedalternateFS qualifications.

Create-exclusive fresh output slot before provider/child effects. Retain sanitized complete successful Rules API raw response bytes/SHA/all Source files/independent UTF8 content hashes/metadata/time/opening-closing pins. Never bearer/refresh/profile/provider-error body. Returned filenames are DATA: ordinal generated output names only, originalnames manifest; no returned path used for writes.

## Schema and review

Release:name/rulesetName/createTime/updateTime; complete validated opening/closing objects equal, both raw retained. Bind exact names/timestamps, no inventedETag/versioncounter. Ruleset:name/source/createTime/metadata/attachment_point; preserve every file name/content/fingerprint. Service fingerprints are generic bytes, not assumedSHA/signatures; locally compute contentSHA.

Complete known schema required. Unexpected fields/ambiguous attachment/unknown structure/duplicate filenames/incomplete Source preserve evidence and STOP for Root/Security. Blank/omitted attachment_point may identify default; populated value needs exact validated default-project/database binding. No implicit project-number lookup. Initially recognized bundle exactlyone firestore.rules whose decoded exactUTF8 bytes match localreviewedSHA; Root/Security still read complete Source/overlappingmatch semantics. Changed/additional files inherit no acceptance even ifone matches.

Statuses: CAPTURE_COMPLETE (bounded fullresponses/stable endpoints); SOURCE_REVIEW_ACCEPTED_WITH_LIMITS (Root/Security exactsemantic+identity review); UNKNOWN/DRIFT/DENIED (preserved, noPUB prerequisite). Generic validator proves structure/identity/bounds only, never arbitraryrules semantics/propagation/universal privacy/future stability.

## Tasks

| ID | Owner/dependency | Acceptance | Status |
|---|---|---|---|
| RULES-01 | Root +Security/Database | Adopt scope/grammar/budgets/provider/privacy claims | Proposed |
| RULES-02 | OneForge;01 | Isolated Source/schema/5request machine/evidence/launcher/admission/fakes, no execution | Held |
| RULES-03 | Root/Security/Gate;02 | Full Source/runtime/provider/transport/output review, fresh offline grant | Held |
| RULES-04 | Forge;03 | Once-admitted production-path fake suite/seal/completion | Held |
| RULES-05 | Root/Security/Gate;04 | Accept Source/offline andfreshfinitecapture-only grant | Held |
| RULES-06 | Rootexecutor;05 | One5request capture/full closing/sanitized artifacts | Held |
| RULES-07 | Root/Security;06 | Full capturedSource/releasebinding semantics decision andPUB evidence | Held |

Fakes:identity/subject/email/eachpermission;Rules403/404;foreignruleset/pathinjection;releasechange/ABAupdateTime;timestampmalformation;incomplete/oversized Source;extrafiles/duplicate filenames orkeys/hostilefilenames;unexpected predicateacceptance;runtime/Source/admissiondrift;deadline/spentslots/credentialredaction. A changed Source containing deny-all mustnot pass merely bysubstring.

## Limits, failure, references

Rules management outsideFirestoretransactions; equalendpoints do not exclude intermediatechanges/propagationdelay/futurepolicychange. Clientrule review isnot allprivilegedservers/IAM/data-servingfunctions audit. No deployment/documentmutation: noDBrollback; preservepartial/spent, neverrestorecredentialsoverconcurrentwork. Diagnose andnewfinitegrant foranyrepeat.

Official evidence: [Release GET](https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/get), [Ruleset GET](https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets/get), [Release schema](https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases), [Ruleset schema](https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets), [deployment/propagation](https://firebase.google.com/docs/rules/manage-deploy). Defaultrelease cloud.firestore is equivalent to cloud.firestore/(default); choose declaredroute only. Releases reference immutable rulesets; propagation can take severalminutes, no invented precisecertifiablewaitingthreshold.

Next after RULES-01 adoption: RULES-02 Sourceonly. Alllivecapture/PUB held. Token telemetry unavailable.

## RULES-01.A — explicit fresh project-number binding

PROPOSED for renewed Database/Security concurrence and Rootadoption. SeparateAstra supplies this scope amendment; supersedes five-requestsequence only. ExactlySIX same-bearer applicationrequests:1UserInfo;2IAMfive;3GET https://firebase.googleapis.com/v1beta1/projects/huroof-a3ee7;4openingRulesrelease;5fullreferencedruleset;6closingRulesrelease. ProjectGET no body/query/redirect/retry/alternative/discovery. FailureSTOP; nofallbackhistorical metadata/no newconsent/scopeschange.

Project HTTP200/strictknownFirebaseProject: name exactlyprojects/huroof-a3ee7,projectId huroof-a3ee7,projectNumber ACTUALcanonicalpositive decimalSTRING withinpositivesigned-int64 range preservedwithoutNumbercoercion,stateACTIVE. DocumentedoptionaldisplayName/etagstrings andannotationsobjectstringvalues retained withabsence distinct; unknownfields STOPforreview. Completebounded raw response/SHA/time retained. Projectetag isnotRulesrelease version.

UseFRESHprojectNumber forpopulatedattachment_point exactlyfirestore.googleapis.com/projects/<number>/databases/(default). Missing/blankdefaultinterpretation retained; otherforms STOP/nosilentnormalization. Historical245740172770 iscorroborating only/notauthority; recordmatch, discrepancySTOPsemanticacceptance forRoot/DBreconciliation, no repin/substitution. Historicalfilescurrently1530/40007fc405477125e0209ae264e31ae2a71e490ed603966585a5f16e177101b6 and5220/0eb012169aff57fb331368d2bef48b0e7fb4b4382ef10a84f2b37ef6edd8b43e haveunverifiedoriginalcaptureprovenance/currentmapping; do not useinstead offreshGET.

6applicationrequests/0retryredirect/0pages,projectresponse65536;fivecontrols65536+ruleset1048576=1376256 totalrawbytes.90swhole/requestmin30sremaining/ownedACK2s unchanged,SDKinternaltrafficseparate. Newfakes:numericratherthanstring/unsafeNumbercoercion/malformed-outofrange/wrongname-ID/inactive-missingstate/unknownschema/oversize-403-404/historicalnumbermismatch/attachmentnumbermismatch. RULES07 bindsprojectresponseSHA+number; PUBadmissions referenceacceptedcapture, NOadditionalprojectGET inPUBstages/allPUBbudgetsunchanged.

Official [Project GET](https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects/get) acceptscloud-platform/currentalreadyreviewedscopes; [Project schema](https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects) recordsimmutableidentifiers/int64string andresponse.nameusingprojectID. Rootalso readofficialcurrentJSONschema: name/projectId/projectNumber/displayName/state/annotations/etag, noresourcesfield incurrentdocumentedschema. SourceunknownfieldSTOP remains; no implicit oldschema fallback. Priorfive-requestconcurrence doesnotcoverthisaddition. NextrenewDB/SecuritythenRootadoptandSourceauthoring; no effects.
## RULES-01 Root adoption — Source only

2026-10-08: ADOPTED WITH LIMITS after renewed Database/Security six-request concurrence. RULES-02 assigned isolated output/t44-auth-rules-ro01-production-capture-20261008 only. Allsix exactroutes/1376256raw/90s/2s/once/Source-offline-Gate-semantic stages binding. Preserve optional absence versusnull/blank; validate decodedUnicode beforeUTF8, fullsuccessfulRules/projectrawresponses independently. GoogleUserInfo rawpersonalresponse/credential/providererrors notpersisted; onlyconstructednecessaryidentityhash/permission evidence. No unknownschema/service/attachment inheritedacceptance orhistoricalnumberfallback. Historicalnumber245740172770 corroboration only, freshProjectGET authoritativewithinobservations. Source edits tooldAuth/oldsealedmaterials/canonicalSourceplans/SDK/profile/Git/foreign processes forbidden. No imports/syntax/helpers/tests/children/provider/credentials/API/DB until freshfullRoot/Security/Gate Sourceadmission. Existing Sourcecapture/protocol grants do nottransfer.

RULES-01 Done forSource-onlyadoption. Capture/source semantics/publication unverified andheld. Root ownsfinalstatus; Sourceauthor noeffects. Newhelper estimate20–40m Source plus20–40mreview/offline subject tofailures; fullgoalETAunknown. Telemetryunavailable.