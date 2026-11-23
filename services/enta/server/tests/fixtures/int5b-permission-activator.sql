-- Fresh test-only login; password is loaded from private environment, never CLI args/logs.
\set ON_ERROR_STOP on
\set ECHO none
\getenv activator_password INT5B_PRIVATE_ACTIVATOR_PASSWORD
BEGIN;
DO $$ BEGIN
 IF inet_server_port()<>55440 OR current_setting('server_encoding')<>'UTF8' OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=session_user) THEN RAISE EXCEPTION 'owned UTF8 DBA only'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='int5b_v3_catalog_activator') THEN RAISE EXCEPTION 'new test activator name must be absent'; END IF;
END $$;
CREATE ROLE int5b_v3_catalog_activator LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'activator_password';
GRANT catalog_activator TO int5b_v3_catalog_activator WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
COMMIT;
