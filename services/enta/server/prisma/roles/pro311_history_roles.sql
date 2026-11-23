-- PRO311 source-only role closure. Install atomically with all four new functions.
ALTER FUNCTION public.pro311_enta_history(TEXT,TEXT,TEXT,JSONB) OWNER TO enta_finance_executor;
ALTER FUNCTION public.pro311_enta_original_result(TEXT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
ALTER FUNCTION public.pro311_huroof_history(TEXT,TEXT,TEXT,TEXT,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_huroof_result(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) OWNER TO huroof_pg_owner;
REVOKE ALL ON FUNCTION public.pro311_enta_history(TEXT,TEXT,TEXT,JSONB),public.pro311_enta_original_result(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime,enta_outbox_worker,huroof_pg_runtime;
REVOKE ALL ON FUNCTION public.pro311_huroof_history(TEXT,TEXT,TEXT,TEXT,JSONB),public.pro311_huroof_result(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) FROM PUBLIC,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_result_importer,enta_runtime,enta_gameplay_runtime;
GRANT EXECUTE ON FUNCTION public.pro311_enta_history(TEXT,TEXT,TEXT,JSONB),public.pro311_enta_original_result(TEXT,TEXT,TEXT,TEXT) TO enta_gameplay_runtime;
GRANT EXECUTE ON FUNCTION public.pro311_huroof_history(TEXT,TEXT,TEXT,TEXT,JSONB),public.pro311_huroof_result(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT) TO huroof_pg_runtime;
