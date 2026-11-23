-- Remove only the exact owned disposable probe after recording evidence.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database() NOT IN ('maydan_perm3_20261005_empty_int5b_test','maydan_perm3_20261005_legacy_int5b_test') OR inet_server_port()<>55440 OR current_setting('server_encoding')<>'UTF8' OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=session_user) THEN RAISE EXCEPTION 'exact owned DBA target required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.int5b_test_pointer_guard()') AND proowner='enta_finance_executor'::regrole) THEN RAISE EXCEPTION 'exact owned probe missing'; END IF;
END $$;
DROP FUNCTION public.int5b_test_pointer_guard();
COMMIT;
