-- Source-only role candidate; do not execute under R6 STOP.
BEGIN;
DO $roles$
DECLARE r TEXT;
BEGIN
 FOREACH r IN ARRAY ARRAY['huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',r); END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=r AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolinherit)) THEN RAISE EXCEPTION 'unsafe role attributes %',r; END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_runtime','huroof_pg_executor','huroof_pg_service_executor','huroof_pg_realtime_reader','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=r AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AND NOT rolinherit) THEN RAISE EXCEPTION 'existing role unavailable or unsafe %',r; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AND NOT rolinherit) THEN RAISE EXCEPTION 'owner role unavailable or unsafe'; END IF;
END $roles$;
DO $inventory$
DECLARE item RECORD;
BEGIN
 FOR item IN SELECT * FROM (VALUES ('public.eng03_05_lock_namespace(TEXT)','void'),
('public.eng03_05_assert_admin(JSONB,TEXT)','jsonb'),
('public.eng03_05_principal(JSONB)','jsonb'),
('public.eng03_05_rate_take(JSONB)','jsonb'),
('public.eng03_05_snapshot_documents_root(BYTEA)','text'),
('public.eng03_05_snapshot_read(JSONB,TEXT,TEXT)','jsonb'),
('public.eng03_05_media_authorize(JSONB,JSONB)','jsonb'),
('public.eng03_05_replay(JSONB,JSONB,TEXT,TEXT)','jsonb'),
('public.eng03_05_append_audit(TEXT,TEXT,TEXT)','void'),
('public.eng03_05_settings_get(JSONB)','jsonb'),
('public.eng03_05_settings_update(JSONB,JSONB,JSONB)','jsonb'),
('public.eng03_05_registry_change(JSONB,JSONB,TEXT,TEXT,JSONB)','jsonb'),
('public.eng03_05_sync_complete(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_draft_save(JSONB,JSONB,TEXT,JSONB)','jsonb'),
('public.eng03_05_draft_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_draft_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_draft_archive(JSONB,JSONB,TEXT)','jsonb'),
('public.eng03_05_draft_chain_guard()','trigger'),
('public.eng03_05_review_submit(JSONB,JSONB,TEXT)','jsonb'),
('public.eng03_05_review_decide(JSONB,JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_review_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_review_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_category_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_category_update(JSONB,JSONB,TEXT,JSONB)','jsonb'),
('public.eng03_05_room_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_room_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_category_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_audit_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_operation_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_raw_put(JSONB,JSONB,TEXT,BYTEA,TEXT,TEXT,BYTEA)','jsonb'),
('public.eng03_05_registry_lookup(JSONB,TEXT)','jsonb'),
('public.eng03_05_correction_get(JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_correction_save(JSONB,JSONB,TEXT,TEXT,TEXT,JSONB)','jsonb'),
('public.eng03_05_review_chain_guard()','trigger'),
('public.eng03_05_metadata_chain_guard()','trigger'),
('public.eng03_05_settings_chain_guard()','trigger'),
('public.eng03_05_correction_chain_guard()','trigger'),
('public.eng03_05_inspection_get(JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_revision_append(JSONB,JSONB,JSONB)','jsonb'),
('public.eng03_05_assert_evidence(JSONB,JSONB)','void'),
('public.eng03_05_prepare_snapshot(JSONB,JSONB,TEXT,TEXT)','jsonb'),
('public.eng03_05_prepare_profile(JSONB,JSONB,TEXT,BIGINT)','jsonb'),
('public.eng03_05_profile_prepare(JSONB,TEXT,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_pointer_prepare(JSONB,TEXT,TEXT,BIGINT)','jsonb'),
('public.eng03_05_profile_append(JSONB,JSONB,JSONB)','jsonb'),
('public.eng03_05_media_append(JSONB,JSONB,TEXT,BIGINT,TEXT,JSONB)','jsonb'),
('public.eng03_05_pointer_move(JSONB,JSONB,JSONB)','jsonb')) AS expected(signature,result_type) LOOP
  IF pg_catalog.to_regprocedure(item.signature) IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles o ON o.oid=p.proowner WHERE p.oid=pg_catalog.to_regprocedure(item.signature)::oid AND p.prokind='f' AND p.prorettype=pg_catalog.to_regtype(item.result_type)::oid AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog'] AND o.rolname IN (current_user,'huroof_pg_owner')) THEN RAISE EXCEPTION 'unexpected routine identity %',item.signature; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'eng03\_05\_%' ESCAPE '\' AND p.oid NOT IN (SELECT pg_catalog.to_regprocedure(signature)::oid FROM (VALUES ('public.eng03_05_lock_namespace(TEXT)','void'),
('public.eng03_05_assert_admin(JSONB,TEXT)','jsonb'),
('public.eng03_05_principal(JSONB)','jsonb'),
('public.eng03_05_rate_take(JSONB)','jsonb'),
('public.eng03_05_snapshot_documents_root(BYTEA)','text'),
('public.eng03_05_snapshot_read(JSONB,TEXT,TEXT)','jsonb'),
('public.eng03_05_media_authorize(JSONB,JSONB)','jsonb'),
('public.eng03_05_replay(JSONB,JSONB,TEXT,TEXT)','jsonb'),
('public.eng03_05_append_audit(TEXT,TEXT,TEXT)','void'),
('public.eng03_05_settings_get(JSONB)','jsonb'),
('public.eng03_05_settings_update(JSONB,JSONB,JSONB)','jsonb'),
('public.eng03_05_registry_change(JSONB,JSONB,TEXT,TEXT,JSONB)','jsonb'),
('public.eng03_05_sync_complete(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_draft_save(JSONB,JSONB,TEXT,JSONB)','jsonb'),
('public.eng03_05_draft_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_draft_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_draft_archive(JSONB,JSONB,TEXT)','jsonb'),
('public.eng03_05_draft_chain_guard()','trigger'),
('public.eng03_05_review_submit(JSONB,JSONB,TEXT)','jsonb'),
('public.eng03_05_review_decide(JSONB,JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_review_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_review_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_category_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_category_update(JSONB,JSONB,TEXT,JSONB)','jsonb'),
('public.eng03_05_room_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_room_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_category_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_audit_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_operation_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_raw_put(JSONB,JSONB,TEXT,BYTEA,TEXT,TEXT,BYTEA)','jsonb'),
('public.eng03_05_registry_lookup(JSONB,TEXT)','jsonb'),
('public.eng03_05_correction_get(JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_correction_save(JSONB,JSONB,TEXT,TEXT,TEXT,JSONB)','jsonb'),
('public.eng03_05_review_chain_guard()','trigger'),
('public.eng03_05_metadata_chain_guard()','trigger'),
('public.eng03_05_settings_chain_guard()','trigger'),
('public.eng03_05_correction_chain_guard()','trigger'),
('public.eng03_05_inspection_get(JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_revision_append(JSONB,JSONB,JSONB)','jsonb'),
('public.eng03_05_assert_evidence(JSONB,JSONB)','void'),
('public.eng03_05_prepare_snapshot(JSONB,JSONB,TEXT,TEXT)','jsonb'),
('public.eng03_05_prepare_profile(JSONB,JSONB,TEXT,BIGINT)','jsonb'),
('public.eng03_05_profile_prepare(JSONB,TEXT,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_pointer_prepare(JSONB,TEXT,TEXT,BIGINT)','jsonb'),
('public.eng03_05_profile_append(JSONB,JSONB,JSONB)','jsonb'),
('public.eng03_05_media_append(JSONB,JSONB,TEXT,BIGINT,TEXT,JSONB)','jsonb'),
('public.eng03_05_pointer_move(JSONB,JSONB,JSONB)','jsonb')) expected(signature,result_type))) THEN RAISE EXCEPTION 'unexpected 05 routine overload'; END IF;
END $inventory$;
DO $table_inventory$
DECLARE name TEXT;
BEGIN
 FOREACH name IN ARRAY ARRAY['HuroofAdminPrincipal','HuroofAdminAuthzInvariant','HuroofAdminOperation','HuroofAdminIdentitySyncOutcome','HuroofAdminAudit','HuroofAdminRateWindow','HuroofAdminQuestionDraftRevision','HuroofAdminReviewRevision','HuroofAdminPublishedQuestionInspection','HuroofAdminCategoryCorrectionRevision','HuroofAdminCategoryMetadataRevision','HuroofAdminSettingsRevision'] LOOP
  IF (SELECT count(*) FROM pg_catalog.pg_class cl JOIN pg_catalog.pg_namespace n ON n.oid=cl.relnamespace JOIN pg_catalog.pg_roles o ON o.oid=cl.relowner WHERE n.nspname='public' AND cl.relname=name AND cl.relkind IN ('r','p') AND o.rolname IN (current_user,'huroof_pg_owner'))<>1 THEN RAISE EXCEPTION 'unexpected table identity %',name; END IF;
 END LOOP;
END $table_inventory$;
ALTER TABLE public."HuroofAdminPrincipal" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofAdminAuthzInvariant" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofAdminOperation" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofAdminIdentitySyncOutcome" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofAdminAudit" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofAdminRateWindow" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofAdminQuestionDraftRevision" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofAdminReviewRevision" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofAdminPublishedQuestionInspection" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofAdminCategoryCorrectionRevision" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofAdminCategoryMetadataRevision" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofAdminSettingsRevision" OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_lock_namespace(TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_assert_admin(JSONB,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_principal(JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_rate_take(JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_snapshot_documents_root(BYTEA) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_snapshot_read(JSONB,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_media_authorize(JSONB,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_replay(JSONB,JSONB,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_append_audit(TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_settings_get(JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_settings_update(JSONB,JSONB,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_registry_change(JSONB,JSONB,TEXT,TEXT,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_sync_complete(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_draft_save(JSONB,JSONB,TEXT,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_draft_get(JSONB,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_draft_list(JSONB,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_draft_archive(JSONB,JSONB,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_draft_chain_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_review_submit(JSONB,JSONB,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_review_decide(JSONB,JSONB,TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_review_get(JSONB,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_review_list(JSONB,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_category_get(JSONB,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_category_update(JSONB,JSONB,TEXT,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_room_get(JSONB,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_room_list(JSONB,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_category_list(JSONB,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_audit_list(JSONB,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_operation_get(JSONB,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_raw_put(JSONB,JSONB,TEXT,BYTEA,TEXT,TEXT,BYTEA) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_registry_lookup(JSONB,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_correction_get(JSONB,TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_correction_save(JSONB,JSONB,TEXT,TEXT,TEXT,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_review_chain_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_metadata_chain_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_settings_chain_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_correction_chain_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_inspection_get(JSONB,TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_revision_append(JSONB,JSONB,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_assert_evidence(JSONB,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_prepare_snapshot(JSONB,JSONB,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_prepare_profile(JSONB,JSONB,TEXT,BIGINT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_profile_prepare(JSONB,TEXT,TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_pointer_prepare(JSONB,TEXT,TEXT,BIGINT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_profile_append(JSONB,JSONB,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_media_append(JSONB,JSONB,TEXT,BIGINT,TEXT,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_05_pointer_move(JSONB,JSONB,JSONB) OWNER TO huroof_pg_owner;
REVOKE ALL ON TABLE public."HuroofAdminPrincipal" FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON TABLE public."HuroofAdminAuthzInvariant" FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON TABLE public."HuroofAdminOperation" FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON TABLE public."HuroofAdminIdentitySyncOutcome" FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON TABLE public."HuroofAdminAudit" FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON TABLE public."HuroofAdminRateWindow" FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON TABLE public."HuroofAdminQuestionDraftRevision" FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON TABLE public."HuroofAdminReviewRevision" FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON TABLE public."HuroofAdminPublishedQuestionInspection" FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON TABLE public."HuroofAdminCategoryCorrectionRevision" FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON TABLE public."HuroofAdminCategoryMetadataRevision" FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON TABLE public."HuroofAdminSettingsRevision" FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_lock_namespace(TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_assert_admin(JSONB,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_principal(JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_rate_take(JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_snapshot_documents_root(BYTEA) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_snapshot_read(JSONB,TEXT,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_media_authorize(JSONB,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_replay(JSONB,JSONB,TEXT,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_append_audit(TEXT,TEXT,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_settings_get(JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_settings_update(JSONB,JSONB,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_registry_change(JSONB,JSONB,TEXT,TEXT,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_sync_complete(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_draft_save(JSONB,JSONB,TEXT,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_draft_get(JSONB,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_draft_list(JSONB,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_draft_archive(JSONB,JSONB,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_draft_chain_guard() FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_review_submit(JSONB,JSONB,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_review_decide(JSONB,JSONB,TEXT,TEXT,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_review_get(JSONB,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_review_list(JSONB,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_category_get(JSONB,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_category_update(JSONB,JSONB,TEXT,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_room_get(JSONB,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_room_list(JSONB,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_category_list(JSONB,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_audit_list(JSONB,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_operation_get(JSONB,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_raw_put(JSONB,JSONB,TEXT,BYTEA,TEXT,TEXT,BYTEA) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_registry_lookup(JSONB,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_correction_get(JSONB,TEXT,TEXT,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_correction_save(JSONB,JSONB,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_review_chain_guard() FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_metadata_chain_guard() FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_settings_chain_guard() FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_correction_chain_guard() FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_inspection_get(JSONB,TEXT,TEXT,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_revision_append(JSONB,JSONB,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_assert_evidence(JSONB,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_prepare_snapshot(JSONB,JSONB,TEXT,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_prepare_profile(JSONB,JSONB,TEXT,BIGINT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_profile_prepare(JSONB,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_pointer_prepare(JSONB,TEXT,TEXT,BIGINT) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_profile_append(JSONB,JSONB,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_media_append(JSONB,JSONB,TEXT,BIGINT,TEXT,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
REVOKE ALL ON FUNCTION public.eng03_05_pointer_move(JSONB,JSONB,JSONB) FROM PUBLIC,huroof_pg_admin_reader,huroof_pg_admin_registry,huroof_pg_admin_sync,huroof_pg_material_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_result_importer,huroof_pg_service_executor,huroof_pg_realtime_reader,enta_finance_executor,enta_runtime;
GRANT EXECUTE ON FUNCTION public.eng03_05_principal(JSONB) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_rate_take(JSONB) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_snapshot_read(JSONB,TEXT,TEXT) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_media_authorize(JSONB,JSONB) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_operation_get(JSONB,TEXT) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_room_get(JSONB,TEXT) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_room_list(JSONB,JSONB) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_draft_get(JSONB,TEXT) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_draft_list(JSONB,JSONB) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_review_get(JSONB,TEXT) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_review_list(JSONB,JSONB) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_category_get(JSONB,TEXT) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_category_list(JSONB,JSONB) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_correction_get(JSONB,TEXT,TEXT,TEXT) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_inspection_get(JSONB,TEXT,TEXT,TEXT) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_audit_list(JSONB,JSONB) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_settings_get(JSONB) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_registry_lookup(JSONB,TEXT) TO huroof_pg_admin_reader;
GRANT EXECUTE ON FUNCTION public.eng03_05_raw_put(JSONB,JSONB,TEXT,BYTEA,TEXT,TEXT,BYTEA) TO huroof_pg_content_editor;
GRANT EXECUTE ON FUNCTION public.eng03_05_revision_append(JSONB,JSONB,JSONB) TO huroof_pg_content_editor;
GRANT EXECUTE ON FUNCTION public.eng03_05_draft_save(JSONB,JSONB,TEXT,JSONB) TO huroof_pg_content_editor;
GRANT EXECUTE ON FUNCTION public.eng03_05_draft_archive(JSONB,JSONB,TEXT) TO huroof_pg_content_editor;
GRANT EXECUTE ON FUNCTION public.eng03_05_review_submit(JSONB,JSONB,TEXT) TO huroof_pg_content_editor;
GRANT EXECUTE ON FUNCTION public.eng03_05_category_update(JSONB,JSONB,TEXT,JSONB) TO huroof_pg_content_editor;
GRANT EXECUTE ON FUNCTION public.eng03_05_correction_save(JSONB,JSONB,TEXT,TEXT,TEXT,JSONB) TO huroof_pg_content_editor;
GRANT EXECUTE ON FUNCTION public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT) TO huroof_pg_content_editor;
GRANT EXECUTE ON FUNCTION public.eng03_05_review_decide(JSONB,JSONB,TEXT,TEXT,TEXT) TO huroof_pg_content_reviewer;
GRANT EXECUTE ON FUNCTION public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT) TO huroof_pg_content_reviewer;
GRANT EXECUTE ON FUNCTION public.eng03_05_registry_change(JSONB,JSONB,TEXT,TEXT,JSONB) TO huroof_pg_admin_registry;
GRANT EXECUTE ON FUNCTION public.eng03_05_settings_update(JSONB,JSONB,JSONB) TO huroof_pg_admin_registry;
GRANT EXECUTE ON FUNCTION public.eng03_05_sync_complete(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT) TO huroof_pg_admin_sync;
GRANT EXECUTE ON FUNCTION public.eng03_05_principal(JSONB) TO huroof_pg_content_publisher;
GRANT EXECUTE ON FUNCTION public.eng03_05_rate_take(JSONB) TO huroof_pg_content_publisher;
GRANT EXECUTE ON FUNCTION public.eng03_05_operation_get(JSONB,TEXT) TO huroof_pg_content_publisher;
GRANT EXECUTE ON FUNCTION public.eng03_05_profile_prepare(JSONB,TEXT,TEXT,TEXT,TEXT) TO huroof_pg_content_publisher;
GRANT EXECUTE ON FUNCTION public.eng03_05_pointer_prepare(JSONB,TEXT,TEXT,BIGINT) TO huroof_pg_content_publisher;
GRANT EXECUTE ON FUNCTION public.eng03_05_profile_append(JSONB,JSONB,JSONB) TO huroof_pg_content_publisher;
GRANT EXECUTE ON FUNCTION public.eng03_05_pointer_move(JSONB,JSONB,JSONB) TO huroof_pg_content_publisher;
GRANT EXECUTE ON FUNCTION public.eng03_05_principal(JSONB) TO huroof_pg_material_executor;
GRANT EXECUTE ON FUNCTION public.eng03_05_rate_take(JSONB) TO huroof_pg_material_executor;
GRANT EXECUTE ON FUNCTION public.eng03_05_snapshot_read(JSONB,TEXT,TEXT) TO huroof_pg_material_executor;
GRANT EXECUTE ON FUNCTION public.eng03_05_operation_get(JSONB,TEXT) TO huroof_pg_material_executor;
GRANT EXECUTE ON FUNCTION public.eng03_05_media_append(JSONB,JSONB,TEXT,BIGINT,TEXT,JSONB) TO huroof_pg_material_executor;
-- Minimal catalog read and row-lock capability; selection columns remain non-writable.
GRANT SELECT ON TABLE public."ActiveCatalogPointer" TO huroof_pg_owner;
GRANT UPDATE ("updatedAt") ON TABLE public."ActiveCatalogPointer" TO huroof_pg_owner;
DO $owner_dependencies$
DECLARE owner_oid OID := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_owner'); rel TEXT;
BEGIN
 FOREACH rel IN ARRAY ARRAY['public."DeploymentNamespace"','public."FirebaseIdentity"','public."ActiveCatalogPointer"','public."CatalogValidationReceipt"','public."CatalogReleaseSeal"','public."HuroofContentPointer"','public."HuroofContentRevision"','public."HuroofRawArtifact"','public."HuroofMediaRevision"','public."HuroofRoom"','public."HuroofMember"'] LOOP
  IF NOT pg_catalog.has_table_privilege(owner_oid,rel,'SELECT') THEN RAISE EXCEPTION 'owner lacks existing read dependency %',rel; END IF;
 END LOOP;
 IF NOT pg_catalog.has_column_privilege(owner_oid,'public."ActiveCatalogPointer"','updatedAt','UPDATE') OR pg_catalog.has_table_privilege(owner_oid,'public."ActiveCatalogPointer"','SELECT WITH GRANT OPTION') OR pg_catalog.has_table_privilege(owner_oid,'public."ActiveCatalogPointer"','UPDATE') OR pg_catalog.has_column_privilege(owner_oid,'public."ActiveCatalogPointer"','updatedAt','UPDATE WITH GRANT OPTION') OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='public."ActiveCatalogPointer"'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'updatedAt' AND pg_catalog.has_column_privilege(owner_oid,a.attrelid,a.attname,'UPDATE')) THEN RAISE EXCEPTION 'catalog owner capability exceeds or lacks bounded row lock'; END IF;
 IF NOT pg_catalog.has_table_privilege(owner_oid,'public."HuroofContentPointer"','UPDATE') THEN RAISE EXCEPTION 'owner lacks required row-lock capability'; END IF;
 FOREACH rel IN ARRAY ARRAY['public."HuroofRawArtifact"','public."HuroofContentRevision"','public."HuroofContentPointer"','public."HuroofContentAudit"','public."HuroofMediaRevision"'] LOOP
  IF NOT pg_catalog.has_table_privilege(owner_oid,rel,'INSERT') THEN RAISE EXCEPTION 'owner lacks existing insert dependency %',rel; END IF;
 END LOOP;
 IF NOT pg_catalog.has_function_privilege(owner_oid,'public.eng03_03_assert_current(text,text,text,text)','EXECUTE') OR NOT pg_catalog.has_function_privilege(owner_oid,'public.int5b_hash_json(jsonb)','EXECUTE') OR NOT pg_catalog.has_function_privilege(owner_oid,'public.int5b_canonical_json(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'owner lacks exact existing helper capability'; END IF;
END $owner_dependencies$;
DO $verify_acl$
DECLARE item RECORD;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles member ON member.oid=m.member WHERE member.rolname IN ('huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher')) THEN RAISE EXCEPTION 'executor group membership forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole WHERE r.rolname IN ('huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher')) THEN RAISE EXCEPTION 'executor default ACL forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='public' AND f.prokind='f' AND f.prosecdef AND f.proname<>'eng03_05_media_append' AND position('eng03_05_media_append' in pg_catalog.pg_get_functiondef(f.oid))>0 AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN ('huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_runtime','huroof_pg_service_executor','huroof_pg_realtime_reader','enta_runtime') AND pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE'))) THEN RAISE EXCEPTION 'general-callable media forwarding wrapper'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles src CROSS JOIN pg_catalog.pg_roles dst WHERE NOT src.rolsuper AND src.rolname<>'huroof_pg_owner' AND src.oid<>dst.oid AND dst.rolname IN ('huroof_pg_owner','huroof_pg_content_publisher','huroof_pg_admin_sync','huroof_pg_material_executor') AND pg_catalog.pg_has_role(src.oid,dst.oid,'MEMBER')) THEN RAISE EXCEPTION 'unexpected privileged role member'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class cl JOIN pg_catalog.pg_namespace n ON n.oid=cl.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(cl.relacl,pg_catalog.acldefault('r',cl.relowner))) a WHERE n.nspname='public' AND cl.relname IN ('HuroofAdminPrincipal','HuroofAdminAuthzInvariant','HuroofAdminOperation','HuroofAdminIdentitySyncOutcome','HuroofAdminAudit','HuroofAdminRateWindow','HuroofAdminQuestionDraftRevision','HuroofAdminReviewRevision','HuroofAdminPublishedQuestionInspection','HuroofAdminCategoryCorrectionRevision','HuroofAdminCategoryMetadataRevision','HuroofAdminSettingsRevision') AND (cl.relowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_owner') OR a.grantee<>cl.relowner)) THEN RAISE EXCEPTION 'unexpected table owner or ACL'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles src CROSS JOIN pg_catalog.pg_roles dst WHERE src.rolname IN ('huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_runtime','huroof_pg_executor','huroof_pg_service_executor','huroof_pg_realtime_reader','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_finance_executor','enta_runtime') AND dst.rolname IN ('huroof_pg_owner','huroof_pg_content_publisher','huroof_pg_admin_sync','huroof_pg_material_executor') AND src.oid<>dst.oid AND pg_catalog.pg_has_role(src.oid,dst.oid,'MEMBER')) THEN RAISE EXCEPTION 'forbidden transitive role membership'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN ('huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher') AND (pg_catalog.has_schema_privilege(r.oid,'public','CREATE') OR pg_catalog.has_schema_privilege(r.oid,'int4_crypto','CREATE'))) THEN RAISE EXCEPTION 'schema create forbidden'; END IF;
 FOR item IN SELECT * FROM (VALUES ('public.eng03_05_lock_namespace(TEXT)','void'),
('public.eng03_05_assert_admin(JSONB,TEXT)','jsonb'),
('public.eng03_05_principal(JSONB)','jsonb'),
('public.eng03_05_rate_take(JSONB)','jsonb'),
('public.eng03_05_snapshot_documents_root(BYTEA)','text'),
('public.eng03_05_snapshot_read(JSONB,TEXT,TEXT)','jsonb'),
('public.eng03_05_media_authorize(JSONB,JSONB)','jsonb'),
('public.eng03_05_replay(JSONB,JSONB,TEXT,TEXT)','jsonb'),
('public.eng03_05_append_audit(TEXT,TEXT,TEXT)','void'),
('public.eng03_05_settings_get(JSONB)','jsonb'),
('public.eng03_05_settings_update(JSONB,JSONB,JSONB)','jsonb'),
('public.eng03_05_registry_change(JSONB,JSONB,TEXT,TEXT,JSONB)','jsonb'),
('public.eng03_05_sync_complete(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_draft_save(JSONB,JSONB,TEXT,JSONB)','jsonb'),
('public.eng03_05_draft_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_draft_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_draft_archive(JSONB,JSONB,TEXT)','jsonb'),
('public.eng03_05_draft_chain_guard()','trigger'),
('public.eng03_05_review_submit(JSONB,JSONB,TEXT)','jsonb'),
('public.eng03_05_review_decide(JSONB,JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_review_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_review_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_category_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_category_update(JSONB,JSONB,TEXT,JSONB)','jsonb'),
('public.eng03_05_room_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_room_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_category_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_audit_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_operation_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_raw_put(JSONB,JSONB,TEXT,BYTEA,TEXT,TEXT,BYTEA)','jsonb'),
('public.eng03_05_registry_lookup(JSONB,TEXT)','jsonb'),
('public.eng03_05_correction_get(JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_correction_save(JSONB,JSONB,TEXT,TEXT,TEXT,JSONB)','jsonb'),
('public.eng03_05_review_chain_guard()','trigger'),
('public.eng03_05_metadata_chain_guard()','trigger'),
('public.eng03_05_settings_chain_guard()','trigger'),
('public.eng03_05_correction_chain_guard()','trigger'),
('public.eng03_05_inspection_get(JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_revision_append(JSONB,JSONB,JSONB)','jsonb'),
('public.eng03_05_assert_evidence(JSONB,JSONB)','void'),
('public.eng03_05_prepare_snapshot(JSONB,JSONB,TEXT,TEXT)','jsonb'),
('public.eng03_05_prepare_profile(JSONB,JSONB,TEXT,BIGINT)','jsonb'),
('public.eng03_05_profile_prepare(JSONB,TEXT,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_pointer_prepare(JSONB,TEXT,TEXT,BIGINT)','jsonb'),
('public.eng03_05_profile_append(JSONB,JSONB,JSONB)','jsonb'),
('public.eng03_05_media_append(JSONB,JSONB,TEXT,BIGINT,TEXT,JSONB)','jsonb'),
('public.eng03_05_pointer_move(JSONB,JSONB,JSONB)','jsonb')) AS expected(signature,result_type) LOOP
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a LEFT JOIN pg_catalog.pg_roles gr ON gr.oid=a.grantee WHERE p.oid=pg_catalog.to_regprocedure(item.signature)::oid AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner AND NOT EXISTS(SELECT 1 FROM (VALUES ('public.eng03_05_principal(JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_rate_take(JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_snapshot_read(JSONB,TEXT,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_media_authorize(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_operation_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_room_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_room_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_draft_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_draft_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_review_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_review_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_category_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_category_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_correction_get(JSONB,TEXT,TEXT,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_inspection_get(JSONB,TEXT,TEXT,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_audit_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_settings_get(JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_registry_lookup(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_raw_put(JSONB,JSONB,TEXT,BYTEA,TEXT,TEXT,BYTEA)','huroof_pg_content_editor'),
('public.eng03_05_revision_append(JSONB,JSONB,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_draft_save(JSONB,JSONB,TEXT,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_draft_archive(JSONB,JSONB,TEXT)','huroof_pg_content_editor'),
('public.eng03_05_review_submit(JSONB,JSONB,TEXT)','huroof_pg_content_editor'),
('public.eng03_05_category_update(JSONB,JSONB,TEXT,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_correction_save(JSONB,JSONB,TEXT,TEXT,TEXT,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT)','huroof_pg_content_editor'),
('public.eng03_05_review_decide(JSONB,JSONB,TEXT,TEXT,TEXT)','huroof_pg_content_reviewer'),
('public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT)','huroof_pg_content_reviewer'),
('public.eng03_05_registry_change(JSONB,JSONB,TEXT,TEXT,JSONB)','huroof_pg_admin_registry'),
('public.eng03_05_settings_update(JSONB,JSONB,JSONB)','huroof_pg_admin_registry'),
('public.eng03_05_sync_complete(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT)','huroof_pg_admin_sync'),
('public.eng03_05_principal(JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_rate_take(JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_operation_get(JSONB,TEXT)','huroof_pg_content_publisher'),
('public.eng03_05_profile_prepare(JSONB,TEXT,TEXT,TEXT,TEXT)','huroof_pg_content_publisher'),
('public.eng03_05_pointer_prepare(JSONB,TEXT,TEXT,BIGINT)','huroof_pg_content_publisher'),
('public.eng03_05_profile_append(JSONB,JSONB,JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_pointer_move(JSONB,JSONB,JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_principal(JSONB)','huroof_pg_material_executor'),
('public.eng03_05_rate_take(JSONB)','huroof_pg_material_executor'),
('public.eng03_05_snapshot_read(JSONB,TEXT,TEXT)','huroof_pg_material_executor'),
('public.eng03_05_operation_get(JSONB,TEXT)','huroof_pg_material_executor'),
('public.eng03_05_media_append(JSONB,JSONB,TEXT,BIGINT,TEXT,JSONB)','huroof_pg_material_executor')) allowed(signature,role_name) WHERE allowed.signature=item.signature AND allowed.role_name=gr.rolname)) THEN RAISE EXCEPTION 'unexpected routine execute grant %',item.signature; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM (VALUES ('public.eng03_05_principal(JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_rate_take(JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_snapshot_read(JSONB,TEXT,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_media_authorize(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_operation_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_room_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_room_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_draft_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_draft_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_review_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_review_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_category_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_category_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_correction_get(JSONB,TEXT,TEXT,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_inspection_get(JSONB,TEXT,TEXT,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_audit_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_settings_get(JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_registry_lookup(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_raw_put(JSONB,JSONB,TEXT,BYTEA,TEXT,TEXT,BYTEA)','huroof_pg_content_editor'),
('public.eng03_05_revision_append(JSONB,JSONB,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_draft_save(JSONB,JSONB,TEXT,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_draft_archive(JSONB,JSONB,TEXT)','huroof_pg_content_editor'),
('public.eng03_05_review_submit(JSONB,JSONB,TEXT)','huroof_pg_content_editor'),
('public.eng03_05_category_update(JSONB,JSONB,TEXT,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_correction_save(JSONB,JSONB,TEXT,TEXT,TEXT,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT)','huroof_pg_content_editor'),
('public.eng03_05_review_decide(JSONB,JSONB,TEXT,TEXT,TEXT)','huroof_pg_content_reviewer'),
('public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT)','huroof_pg_content_reviewer'),
('public.eng03_05_registry_change(JSONB,JSONB,TEXT,TEXT,JSONB)','huroof_pg_admin_registry'),
('public.eng03_05_settings_update(JSONB,JSONB,JSONB)','huroof_pg_admin_registry'),
('public.eng03_05_sync_complete(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT)','huroof_pg_admin_sync'),
('public.eng03_05_principal(JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_rate_take(JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_operation_get(JSONB,TEXT)','huroof_pg_content_publisher'),
('public.eng03_05_profile_prepare(JSONB,TEXT,TEXT,TEXT,TEXT)','huroof_pg_content_publisher'),
('public.eng03_05_pointer_prepare(JSONB,TEXT,TEXT,BIGINT)','huroof_pg_content_publisher'),
('public.eng03_05_profile_append(JSONB,JSONB,JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_pointer_move(JSONB,JSONB,JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_principal(JSONB)','huroof_pg_material_executor'),
('public.eng03_05_rate_take(JSONB)','huroof_pg_material_executor'),
('public.eng03_05_snapshot_read(JSONB,TEXT,TEXT)','huroof_pg_material_executor'),
('public.eng03_05_operation_get(JSONB,TEXT)','huroof_pg_material_executor'),
('public.eng03_05_media_append(JSONB,JSONB,TEXT,BIGINT,TEXT,JSONB)','huroof_pg_material_executor')) allowed(signature,role_name) WHERE NOT pg_catalog.has_function_privilege(allowed.role_name,allowed.signature,'EXECUTE')) THEN RAISE EXCEPTION 'missing required routine execute grant'; END IF;
END $verify_acl$;
-- Exact source candidate; installation and ACL verification require separate authority.
COMMIT;
