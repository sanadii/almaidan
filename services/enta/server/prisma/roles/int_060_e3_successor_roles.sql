-- INERT exact private install closure. Source-only; no installed ACL claim.
ALTER TABLE public."E3PhysicalProfile" OWNER TO enta_finance_executor;
REVOKE ALL ON TABLE public."E3PhysicalProfile" FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
CREATE TRIGGER "E3PhysicalProfile_no_truncate" BEFORE TRUNCATE ON public."E3PhysicalProfile" FOR EACH STATEMENT EXECUTE FUNCTION public.e3_comp_immutable();
ALTER TABLE public."E3OriginalTerminal" OWNER TO enta_finance_executor;
REVOKE ALL ON TABLE public."E3OriginalTerminal" FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
CREATE TRIGGER "E3OriginalTerminal_no_truncate" BEFORE TRUNCATE ON public."E3OriginalTerminal" FOR EACH STATEMENT EXECUTE FUNCTION public.e3_comp_immutable();
ALTER TABLE public."E3StartReservation" OWNER TO enta_finance_executor;
REVOKE ALL ON TABLE public."E3StartReservation" FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
CREATE TRIGGER "E3StartReservation_no_truncate" BEFORE TRUNCATE ON public."E3StartReservation" FOR EACH STATEMENT EXECUTE FUNCTION public.e3_comp_immutable();
ALTER TABLE public."E3AdmissionInsertWitness" OWNER TO enta_finance_executor;
REVOKE ALL ON TABLE public."E3AdmissionInsertWitness" FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
CREATE TRIGGER "E3AdmissionInsertWitness_no_truncate" BEFORE TRUNCATE ON public."E3AdmissionInsertWitness" FOR EACH STATEMENT EXECUTE FUNCTION public.e3_comp_immutable();
ALTER TABLE public."E3ImmutableSeal" OWNER TO enta_finance_executor;
REVOKE ALL ON TABLE public."E3ImmutableSeal" FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
CREATE TRIGGER "E3ImmutableSeal_no_truncate" BEFORE TRUNCATE ON public."E3ImmutableSeal" FOR EACH STATEMENT EXECUTE FUNCTION public.e3_comp_immutable();
ALTER FUNCTION public.e3_comp_immutable() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_immutable() FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_admission_insert() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_admission_insert() FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_stage_guard() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_stage_guard() FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_deferred_close() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_deferred_close() FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_original_terminal(TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_original_terminal(TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_native_request(JSONB,JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_native_request(JSONB,JSONB) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_assert_stage_material(TEXT,JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_assert_stage_material(TEXT,JSONB) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_actual_native(TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_actual_native(TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_assert_closure(TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_assert_closure(TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_validate_external(JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_validate_external(JSONB) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_retry(TEXT,TEXT,TEXT,JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_retry(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_parent(TEXT,TEXT,TEXT,JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_parent(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_terminal_guard() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_terminal_guard() FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_create_stage(TEXT,TEXT,TEXT,JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_create_stage(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_finalize(TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_finalize(TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_native4_commit(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_native4_commit(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_legacy_receipt(TEXT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_legacy_receipt(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_retained_commit(TEXT,TEXT,TEXT,JSONB,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_retained_commit(TEXT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_history_utc_gate() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_history_utc_gate() FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_exposure_frontier(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_exposure_frontier(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
GRANT EXECUTE ON FUNCTION public.e3_comp_retry(TEXT,TEXT,TEXT,JSONB) TO enta_gameplay_runtime;
GRANT EXECUTE ON FUNCTION public.e3_comp_parent(TEXT,TEXT,TEXT,JSONB) TO enta_gameplay_runtime;
GRANT EXECUTE ON FUNCTION public.e3_comp_native4_commit(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,TEXT) TO enta_gameplay_runtime;
GRANT EXECUTE ON FUNCTION public.e3_comp_retained_commit(TEXT,TEXT,TEXT,JSONB,TEXT) TO enta_gameplay_runtime;
GRANT EXECUTE ON FUNCTION public.e3_comp_exposure_frontier(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO enta_gameplay_runtime;

ALTER TABLE public."E3SuccessorLink" OWNER TO enta_finance_executor;
REVOKE ALL ON TABLE public."E3SuccessorLink" FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.e3_comp_link_guard() OWNER TO enta_finance_executor;
ALTER FUNCTION public.e3_comp_link_closed() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.e3_comp_link_guard(),public.e3_comp_link_closed() FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
-- Source admission assertions; these are not installed-ACL evidence.
DO $e3_successor_acl$
DECLARE sig TEXT; tbl TEXT;
BEGIN
 FOREACH sig IN ARRAY ARRAY['public.e3_comp_retry(text,text,text,jsonb)','public.e3_comp_parent(text,text,text,jsonb)','public.e3_comp_native4_commit(text,text,text,jsonb,jsonb,jsonb,jsonb,text)','public.e3_comp_retained_commit(text,text,text,jsonb,text)','public.e3_comp_exposure_frontier(text,text,text,text,text,text,text)','public.int6_enta_lock_wallet(text,text,text)','public.int8_catalog(text,text,text,text)'] LOOP
  IF NOT pg_catalog.has_function_privilege('enta_gameplay_runtime',sig,'EXECUTE') THEN RAISE EXCEPTION 'E3 required backend function unavailable: %',sig; END IF;
 END LOOP;
 FOREACH sig IN ARRAY ARRAY['public.e3_comp_link_guard()','public.e3_comp_link_closed()','public.e3_comp_create_stage(text,text,text,jsonb)','public.e3_comp_finalize(text)','public.e3_comp_admission_insert()','public.e3_comp_assert_closure(text)'] LOOP
  IF pg_catalog.has_function_privilege('enta_gameplay_runtime',sig,'EXECUTE') OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=pg_catalog.to_regprocedure(sig) AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'E3 private function exposed: %',sig; END IF;
 END LOOP;
 FOREACH tbl IN ARRAY ARRAY['public."E3StartReservation"','public."E3AdmissionInsertWitness"','public."E3ImmutableSeal"','public."E3SuccessorLink"'] LOOP
  IF pg_catalog.has_table_privilege('enta_gameplay_runtime',tbl,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a WHERE c.oid=pg_catalog.to_regclass(tbl) AND a.grantee=0) THEN RAISE EXCEPTION 'E3 private table exposed: %',tbl; END IF;
 END LOOP;
END $e3_successor_acl$;
