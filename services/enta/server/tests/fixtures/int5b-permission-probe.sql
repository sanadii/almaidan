-- Fixed disposable probe, installed AFTER candidate SQL; no arbitrary inputs.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('maydan_perm3_20261005_empty_int5b_test','maydan_perm3_20261005_legacy_int5b_test') OR inet_server_port()<>55440 OR current_setting('server_encoding')<>'UTF8' OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=session_user) THEN RAISE EXCEPTION 'exact owned DBA target required'; END IF;
 IF to_regprocedure('public.int5b_test_pointer_guard()') IS NOT NULL THEN RAISE EXCEPTION 'probe already exists'; END IF;
END $$;
CREATE FUNCTION public.int5b_test_pointer_guard() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 BEGIN
  UPDATE public."ActiveCatalogPointer" SET "updatedAt"=clock_timestamp() WHERE id='singleton';
 EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'INT5B_FIXED_GUARD session_user=% current_user=% original=%',session_user,current_user,SQLERRM USING ERRCODE=SQLSTATE;
 END;
END $$;
ALTER FUNCTION public.int5b_test_pointer_guard() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int5b_test_pointer_guard() FROM PUBLIC,enta_runtime,enta_huroof_reserver,enta_huroof_provisioner,enta_huroof_reconciler,int5b_utf8_e_reserver,int5b_utf8_e_provisioner,int5b_utf8_e_reconciler,int5b_utf8_l_reserver,int5b_utf8_l_provisioner,int5b_utf8_l_reconciler,int5b_v3_catalog_activator;
-- Only each fresh target's actual reserver test session receives probe execution.
DO $$ BEGIN
 IF current_database()='maydan_perm3_20261005_empty_int5b_test' THEN GRANT EXECUTE ON FUNCTION public.int5b_test_pointer_guard() TO int5b_utf8_e_reserver;
 ELSE GRANT EXECUTE ON FUNCTION public.int5b_test_pointer_guard() TO int5b_utf8_l_reserver; END IF;
END $$;
COMMIT;
