import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const modelPath = new URL('../../../../output/part2-e3-20261017/composition-prereq-r2/capacity-model.ts', import.meta.url);
const modelOptions = { skip: !statSync(modelPath, { throwIfNoEntry: false }) && 'Retained R2 capacity-model artifact is unavailable' };
const native4 = {physicalProtocol:4,format:'MIXED_BOARD',retainedRules:'enta-format-1',mode:'CLASSIC'} as const;

test('retained R2 source capacity model rejects omitted and altered holder inventories',modelOptions,async()=>{
 const {account,holders}=await import(modelPath.href);
 const all=holders(native4);assert.equal(account(native4,all).status,'UNPROVEN');assert.throws(()=>account(native4,all.slice(1)),/SOURCE_HOLDER_OMITTED_OR_CHANGED/);
 const altered=(all as Array<Record<string,unknown>>).map((item,i)=>i===0?{...item,upperUtf8:1}:item);assert.throws(()=>account(native4,altered),/SOURCE_HOLDER_OMITTED_OR_CHANGED/);
});
test('retained R2 source controls reject unresolved bounds and known maximum plus one',modelOptions,async()=>{
 const {assertOwnedBound,holders}=await import(modelPath.href);
 const all=holders(native4) as Array<{id:string;upperUtf8:number|null}>;
 const known=all.find(x=>x.id==='host.external.JSON'),unknown=all.find(x=>x.id==='host.catalog.full');assert.ok(known);assert.ok(unknown);assert.equal(known.upperUtf8,65536);assert.doesNotThrow(()=>assertOwnedBound(known,65536));assert.throws(()=>assertOwnedBound(known,65537),/HOLDER_UPPER_PLUS_ONE_REJECTED/);assert.throws(()=>assertOwnedBound(unknown,1),/HOLDER_BOUND_UNRESOLVED/);
});

const candidate=readFileSync(resolve('services/enta/server/prisma/migrations/20261028140000_pro262_capacity_supplier/migration.sql'),'utf8');
const roles=readFileSync(resolve('services/enta/server/prisma/roles/pro262_capacity_supplier_roles.sql'),'utf8');
function sourceBody(name:string):string {const start=candidate.indexOf(`CREATE FUNCTION public.${name}(`);assert.ok(start>=0,name);const end=candidate.indexOf('END $$;',start);assert.ok(end>start,name);return candidate.slice(start,end);}
test('candidate source binds actual spool, fixed probe and canonical request without SQL execution',()=>{
 const spool=sourceBody('pro262_capacity_spool_commit'),probe=sourceBody('pro262_capacity_replay_probe'),equal=sourceBody('pro262_capacity_assert_spool_request');
 assert.match(candidate,/PRO262_CAP_IMPLEMENTATION_INCOMPLETE/);assert.match(roles,/PRO262_CAP_ROLE_CLOSURE_INCOMPLETE/);
 assert.ok(spool.indexOf('maxBodyBytes')<spool.indexOf("convert_from(v_body,'UTF8')"));assert.match(spool,/digest\(v_body,'sha256'\)/);
 for(const fixed of ['e3_comp_retry','eng03_06_successor_setup','eng03_06_successor_retry'])assert.ok(probe.includes(fixed));
 assert.ok(probe.indexOf('IF v_outcome IS NOT NULL')<probe.indexOf('INSERT INTO public."Pro262CapacityReplayMiss"'));assert.match(equal,/v_request IS DISTINCT FROM s\."request"/);
});
test('candidate source counts occupied replay and archive work and holds on incomplete cleanup',()=>{
 const issue=sourceBody('pro262_capacity_issue'),reserve=sourceBody('pro262_capacity_reserve_launch'),gate=sourceBody('pro262_capacity_archive_gate'),release=sourceBody('pro262_capacity_release_control');
 for(const body of [reserve,gate])for(const name of ['Pro311NativeAdmission','Pro311PreflightAdmission','Pro262CapacityAdmission','Pro262CapacityReplay','Pro262CapacityLaunchReservation'])assert.ok(body.includes(name));assert.match(issue,/Pro262CapacityLaunchReservation/);assert.match(issue,/assert_launch_integrity/);
 assert.match(candidate,/CREATE TRIGGER "AAC_pro262_capacity_archive_gate" BEFORE INSERT ON public\."Pro311NativeAdmission"/);assert.match(candidate,/CREATE TRIGGER "AAC_pro262_capacity_archive_gate" BEFORE INSERT ON public\."Pro311PreflightAdmission"/);
 assert.match(release,/backend_live/);assert.match(release,/Pro262CapacityControlCleanupReceipt/);assert.match(release,/Pro262CapacityReplayCleanupReceipt/);assert.match(release,/state"<>'RELEASED'/);
});
test('pre-parser app hook is explicit and follows namespace check, source inspection only',()=>{
 const app=readFileSync(resolve('services/enta/server/src/app.ts'),'utf8');const namespace=app.indexOf('assertDeploymentNamespace('),hook=app.indexOf('isCapacityHttpIngress(dependencies.capacityIngress)'),parser=app.indexOf('app.use(express.json(');assert.ok(namespace>=0&&namespace<hook&&hook<parser);assert.match(app,/capacityIngress\?: RequestHandler/);
});

test('candidate role source limits producer to fixed calls and preserves activity-reader edges',()=>{
 assert.match(roles,/GRANT EXECUTE ON FUNCTION public\.pro262_capacity_read_spool\(TEXT,BIGINT,TEXT\).*TO pro262_producer/);
 assert.match(roles,/GRANT EXECUTE ON FUNCTION public\.pro262_capacity_backend_start\(\),public\.pro262_capacity_backend_live\(NAME,INTEGER,TIMESTAMPTZ\) TO pro262_capacity_owner/);
 assert.doesNotMatch(roles,/GRANT EXECUTE ON FUNCTION public\.pro311_own_backend_start\(\).*TO pro262_capacity_owner/);
 assert.match(roles,/PRO262_CAP_UNEXPECTED_EFFECTIVE_EXECUTE/);assert.match(roles,/PRO262_CAP_UNEXPECTED_EFFECTIVE_RELATION/);assert.match(roles,/PRO262_CAP_OWNER_COLUMN_UPDATE/);
});

test('candidate source fences uncertain private launches before cleanup, text inspection only',()=>{
 const prepare=sourceBody('pro262_capacity_prepare_connection'),release=sourceBody('pro262_capacity_release_control'),observe=sourceBody('pro262_capacity_observe_connection');
 assert.match(prepare,/rolconnlimit=1/);assert.match(prepare,/INSERT INTO public\."Pro262CapacityConnectionIntent"/);
 assert.ok(release.indexOf("intent.\"state\"='OPENING'")<release.indexOf('SET "state"=\'RELEASED\''));assert.match(release,/intent\."state"='BOUND'.*backend_live/);assert.match(release,/Pro262CapacityConnectionObservation/);assert.match(observe,/CLEANUP_OBSERVATION/);assert.match(observe,/SESSION_USER/);
 const ingress=readFileSync(resolve('services/enta/server/src/history-rematch/capacity-ingress.ts'),'utf8');assert.ok(ingress.indexOf("'prepareConnection',[control.id,'REPLAY']")<ingress.indexOf('lifecycle.replay('));assert.ok(ingress.indexOf("'prepareConnection',[control.id,'PRODUCER']")<ingress.indexOf('lifecycle.operation('));
});

test('closed launch source fences principal OIDs and refreshes all-incarnation activity before release',()=>{
 const register=sourceBody('pro262_capacity_register_control'),seal=sourceBody('pro262_capacity_quarantine_control'),observe=sourceBody('pro262_capacity_accept_closed_scope'),absent=sourceBody('pro262_capacity_control_backends_absent'),release=sourceBody('pro262_capacity_release_control');
 assert.match(register,/r\.oid/);assert.match(register,/Pro262CapacityPrincipalLease/);assert.match(seal,/state"='SEALED'/);
 for(const key of ['priorAttemptsQuiesced','credentialsClosed','socketsDrained','sourceIdentity','supervisorIdentity','credentialEpoch','launchEpoch','replayOid','producerOid'])assert.ok(observe.includes(key));
 assert.ok(absent.indexOf('pg_stat_clear_snapshot')<absent.indexOf('pg_stat_activity'));assert.match(absent,/principalOid"=a\.usesysid/);assert.doesNotMatch(absent,/backendStart|backendPid/);assert.match(absent,/<>2/);
 assert.ok(release.indexOf('Pro262CapacityClosedScopeReceipt')<release.indexOf('pro262_capacity_control_backends_absent'));assert.ok(release.indexOf('pro262_capacity_control_backends_absent')<release.indexOf('SET "state"=\'CLOSED\''));assert.match(roles,/pro262_capacity_accept_closed_scope\(TEXT,TEXT,JSONB,BYTEA\).*TO pro262_cleanup_publisher/);assert.doesNotMatch(roles,/GRANT pg_read_all_stats/);
});

test('closed-scope receipt requires the precharged source-specific finite envelope before decode',()=>{
 const provision=sourceBody('pro262_capacity_control_provision'),receipt=sourceBody('pro262_capacity_accept_closed_scope'),register=sourceBody('pro262_capacity_register_control');
 assert.match(provision,/principal-launch-and-closed-scope-v2/);assert.match(provision,/maxClosedScopeBytes/);assert.ok(register.indexOf('Pro262CapacityControlCharge')<register.indexOf('INSERT INTO public."Pro262CapacityPrincipalLease"'));
 assert.ok(receipt.indexOf('maxClosedScopeBytes')<receipt.indexOf("decode(v_observation->>'evidence'"));assert.match(receipt,/principal-launch-and-closed-scope-v2/);
});

test('prelaunch source counts both domains and transfers exact vector under the global lock',()=>{
 const reserve=sourceBody('pro262_capacity_reserve_launch'),integrity=sourceBody('pro262_capacity_assert_launch_integrity'),replay=sourceBody('pro262_capacity_register_replay'),issue=sourceBody('pro262_capacity_issue'),gate=sourceBody('pro262_capacity_archive_gate'),release=sourceBody('pro262_capacity_release_control');
 for(const name of ['Pro311NativeAdmission','Pro311PreflightAdmission','Pro262CapacityAdmission','Pro262CapacityReplay','Pro262CapacityLaunchReservation'])for(const body of [reserve,gate])assert.ok(body.includes(name));
 assert.match(reserve,/baselineBackend"\+used_backend\+backend>d\."backendCapacity"/);assert.match(reserve,/baselineShared"\+used_shared\+shared>d\."sharedCapacity"/);assert.match(reserve,/RETURN 'EXISTING'/);
 for(const body of [replay,issue]){assert.match(body,/Pro311ControlDomain/);assert.match(body,/reservedBackendBytes/);assert.match(body,/reservedSharedBytes/);assert.match(body,/profileHash/);assert.match(body,/state"='TRANSFERRED'/);assert.ok(body.indexOf('INSERT INTO public.')<body.lastIndexOf('state"=\'TRANSFERRED\''));}
 assert.match(integrity,/targetFence/);assert.match(integrity,/r\."controlKey"=l\."controlKey"/);assert.ok(release.indexOf('control_backends_absent')<release.indexOf('Pro262CapacityLaunchReservation" x SET "state"=\'RELEASED\''));
 const ingress=readFileSync(resolve('services/enta/server/src/history-rematch/capacity-ingress.ts'),'utf8');assert.ok(ingress.indexOf("'reserveLaunch',[control.id,'REPLAY']")<ingress.indexOf('lifecycle.replay('));assert.ok(ingress.indexOf("'reserveLaunch',[control.id,'PRODUCER']")<ingress.indexOf('lifecycle.operation('));
});

test('operation cleanup receipt is bounded by qualified holder and one durable record',()=>{
 const receipt=sourceBody('pro262_capacity_accept_cleanup');assert.match(candidate,/UNIQUE \("admissionId","fence"\)/);assert.ok(receipt.indexOf("holderSchedule'->>'cleanup'")<receipt.indexOf("decode(v_observation->>'evidence'"));assert.match(receipt,/Pro262CapacityDebit/);
});

test('operation physical release checks closed control scope and all principal incarnations before decrement',()=>{
 const release=sourceBody('pro262_capacity_release'),control=sourceBody('pro262_capacity_release_control'),closed=sourceBody('pro262_capacity_accept_closed_scope');
 for(const name of ['Pro262CapacityClosedScopeReceipt','Pro262CapacityPrincipalLease','pro262_capacity_control_backends_absent'])assert.ok(release.includes(name));
 assert.ok(release.indexOf('pro262_capacity_control_backends_absent')<release.indexOf('SET "state"=\'RELEASED\''));assert.ok(release.indexOf('Pro262CapacityControlReservation')<release.indexOf('LOCK TABLE public."Pro262CapacityAdmission"'));
 assert.doesNotMatch(closed,/Pro262CapacityAdmission.*state.*RELEASED/);assert.match(control,/a\."state"<>'RELEASED'/);
});

test('new PLpgSQL declarations have no names matching qualified candidate columns',()=>{
 const columnNames=new Set(Array.from(candidate.matchAll(/\.\s*"([A-Za-z_][A-Za-z_0-9]*)"/g),m=>m[1].toLowerCase()));
 const functions=Array.from(candidate.matchAll(/CREATE(?: OR REPLACE)? FUNCTION public\.(pro262_capacity_\w+)\(([\s\S]*?)\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/gi));assert.ok(functions.length>60);
 for(const [,name,args,body] of functions){const vars:string[]=[];for(const arg of args.split(',')){const match=arg.match(/^\s*([A-Za-z_]\w*)\s+/);if(match)vars.push(match[1].toLowerCase());}const decl=body.match(/\bDECLARE\b([\s\S]*?)\bBEGIN\b/i);if(decl)for(const segment of decl[1].split(';')){const match=segment.match(/^\s*([A-Za-z_]\w*)\s+/);if(match)vars.push(match[1].toLowerCase());}assert.deepEqual(vars.filter(v=>columnNames.has(v)),[],name);}
 for(const name of ['pro262_capacity_quarantine','pro262_capacity_recheck','pro262_capacity_release','pro262_capacity_control_charge','pro262_capacity_observe_connection'])assert.match(sourceBody(name),/\bv_(?:fence|kind)\b/);
});

test('observer slot source binds independent bootstrap, permanent debit and target event before capture',()=>{
 const provision=sourceBody('pro262_capacity_provision_observer_input'),claim=sourceBody('pro262_capacity_claim_observer_input'),launch=sourceBody('pro262_capacity_reserve_launch');
 for(const key of ['targetControlKey','targetKind','targetCredentialEpoch','targetLaunchEpoch','expectedEventKey','baselineAllocationProof','prepaidStorageIdentity'])assert.ok(provision.includes(key),key);
 assert.match(provision,/Pro262CapacityControlCharge/);assert.match(provision,/Pro262CapacityControlBaseline/);assert.match(claim,/expectedEventKey/);assert.match(claim,/Pro262CapacityPrincipalLease/);assert.match(launch,/targetCredentialEpoch/);assert.match(launch,/targetLaunchEpoch/);
 for(const name of ['pro262_capacity_accept_cleanup','pro262_capacity_accept_replay_cleanup','pro262_capacity_accept_control_cleanup','pro262_capacity_accept_closed_scope','pro262_capacity_accept_install_observation','pro262_capacity_observe_connection']){const body=sourceBody(name);assert.ok(body.indexOf('assert_observer_claim')<body.indexOf('convert_from(p_captured'),name);assert.match(body,/targetControlKey/);assert.match(body,/\"captured\" IS DISTINCT FROM p_captured/);assert.match(body,/\"inputClaimId\" IS DISTINCT FROM p_input_claim_id/);}
});

test('owning wrappers lock and recheck subject before and after each guarded heavy read',()=>{
 for(const [wrapper,guard,heavy] of [['pro262_capacity_enta_catalog','pro262_capacity_enta_subject','public.int8_catalog'],['pro262_capacity_enta_exposure','pro262_capacity_enta_subject','public.e3_comp_exposure_frontier'],['pro262_capacity_pg_policy','pro262_capacity_pg_subject_lock','public.eng03_03_policy_read'],['pro262_capacity_pg_lobby','pro262_capacity_pg_subject_lock','public.eng03_03_lobby_load'],['pro262_capacity_pg_content','pro262_capacity_pg_subject_lock','public.eng03_03_content_load'],['pro262_capacity_pg_custody','pro262_capacity_pg_subject_lock','public.eng03_03_custody_policy']]){const body=sourceBody(wrapper),first=body.indexOf(guard),read=body.indexOf(heavy);assert.ok(first>=0&&read>first&&body.indexOf(guard,read)>read,wrapper);}
 const enta=sourceBody('pro262_capacity_enta_subject'),pg=sourceBody('pro262_capacity_pg_subject_lock');for(const term of ['E3PhysicalProfile','ActiveCatalogPointer','CatalogValidationReceipt','EntaFormatRelease','EntaCompetitiveRelease','pro262_capacity_assert_native_subject'])assert.ok(enta.includes(term),term);for(const term of ['HuroofIdentityPolicyHead','HuroofContentPointer','HuroofContentRevision','HuroofMatchPin','pro262_capacity_assert_native_subject'])assert.ok(pg.includes(term),term);
});

test('installed trust source has one non-revoked generation per lane',()=>{
 assert.match(candidate,/CREATE UNIQUE INDEX "Pro262CapacityTrust_install_lane_current"[\s\S]*?"scope"->'lane'[\s\S]*?"purpose"='INSTALL_OBSERVATION' AND NOT "revoked"/);
 assert.match(sourceBody('pro262_capacity_assert_process_installation'),/FOR SHARE NOWAIT/);
});

test('CAP-A1 process coordinate source checks cover registration, bind, current use and cleanup',()=>{
 for(const name of ['pro262_capacity_register_replay','pro262_capacity_register_issuance','pro262_capacity_bind_connection','pro262_capacity_assert_process_installation','pro262_capacity_accept_cleanup','pro262_capacity_accept_replay_cleanup','pro262_capacity_release','pro262_capacity_release_control']){const body=sourceBody(name);assert.match(body,/Pro262CapacityProcessObservation/,name);assert.match(body,/processTree/,name);assert.match(body,/credentialEpoch/,name);assert.match(body,/launchEpoch/,name);}
 for(const name of ['pro262_capacity_register_replay','pro262_capacity_register_issuance']){const body=sourceBody(name);assert.ok(body.indexOf('Pro262CapacityProcessObservation')<body.indexOf('bind_connection'),name);}
});
test('CAP-A2 source joins exact cleanup trust group and bound before claim and payload',()=>{
 for(const name of ['pro262_capacity_provision_observer_input','pro262_capacity_claim_observer_input','pro262_capacity_assert_observer_claim','pro262_capacity_read_observer_input_limit','pro262_capacity_read_cleanup_limit']){const body=sourceBody(name);assert.match(body,/inputEnvelope/,name);assert.match(body,/inputBound/,name);assert.match(body,/baselineAllocationProof/,name);assert.match(body,/maxInputBytes|v_max/,name);}
 for(const name of ['pro262_capacity_accept_cleanup','pro262_capacity_accept_replay_cleanup','pro262_capacity_accept_control_cleanup','pro262_capacity_accept_closed_scope','pro262_capacity_observe_connection']){const body=sourceBody(name);assert.match(body,/observerTrustId/,name);assert.match(body,/observerTrustGeneration/,name);assert.ok(body.indexOf('assert_observer_claim')<body.indexOf('convert_from(p_captured'),name);}
});
