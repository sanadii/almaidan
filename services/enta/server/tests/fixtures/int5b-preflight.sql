-- READ-ONLY target evidence; never infer instance identity from a listener.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT current_database(),session_user,current_user,current_setting('server_version'),inet_server_addr(),inet_server_port();
SELECT extname,n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE extname='pgcrypto';
SELECT migration_name,finished_at,rolled_back_at FROM public."_prisma_migrations" ORDER BY started_at;
SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolinherit FROM pg_roles
 WHERE rolname IN ('enta_runtime','enta_finance_executor','enta_outbox_worker','enta_huroof_reserver','enta_huroof_provisioner','enta_huroof_reconciler') ORDER BY rolname;
SELECT pg_get_userbyid(roleid) AS granted_role,pg_get_userbyid(member) AS member,pg_get_userbyid(grantor) AS grantor,admin_option,inherit_option,set_option FROM pg_auth_members ORDER BY granted_role,member;
SELECT nspname,pg_get_userbyid(nspowner) AS owner,nspacl FROM pg_namespace WHERE nspname IN ('public','int4_crypto');
SELECT pg_get_userbyid(defaclrole) AS owner,defaclnamespace::regnamespace,defaclobjtype,defaclacl FROM pg_default_acl;
SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('Wallet','WalletEntry','Admission','Reservation','AdmissionEvent','AdmissionOutbox','HuroofAdmissionProof','CatalogValidationReceipt','ActiveCatalogPointer') ORDER BY c.relname;
SELECT p.oid::regprocedure,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (left(p.proname,6)='int5a_' OR left(p.proname,6)='int5b_') ORDER BY p.proname;
SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 WHERE c.relname IN ('Wallet','WalletEntry','Admission','Reservation','AdmissionOutbox','HuroofAdmissionProof') AND NOT t.tgisinternal ORDER BY c.relname,t.tgname;
SELECT (SELECT count(*) FROM public."Game") AS games,(SELECT count(*) FROM public."LegacyUnpinnedGame") AS legacy_games,
 (SELECT count(*) FROM public."Admission") AS admissions,(SELECT count(*) FROM public."WalletEntry") AS entries,
 (SELECT count(*) FROM public."Game" g LEFT JOIN public."LegacyUnpinnedGame" l ON l."gameId"=g."id" WHERE l."gameId" IS NULL) AS ambiguous_games;
COMMIT;
