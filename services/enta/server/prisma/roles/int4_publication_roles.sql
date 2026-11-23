-- DBA-only prerequisite for the INT-4R migration.
-- Run from a separately authenticated database-owner session, never from the
-- Enta application migration identity. Managed PostgreSQL may require a
-- provider-admin identity with CREATE privilege for the schema/extension and
-- CREATEROLE for the NOLOGIN roles. Login membership is deployment-specific
-- and provisioned separately after review. Never grant application logins the
-- reviewer, publisher, validator, or activator roles.
CREATE SCHEMA IF NOT EXISTS int4_crypto AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA int4_crypto FROM PUBLIC;
GRANT USAGE ON SCHEMA int4_crypto TO PUBLIC;

DO $$ DECLARE extension_schema TEXT; BEGIN
  SELECT n.nspname INTO extension_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';
  IF extension_schema IS NOT NULL AND extension_schema <> 'int4_crypto' THEN
    RAISE EXCEPTION 'pgcrypto exists in schema %, database owner must run ALTER EXTENSION pgcrypto SET SCHEMA int4_crypto before provisioning', extension_schema;
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA int4_crypto;
REVOKE ALL ON SCHEMA int4_crypto FROM PUBLIC;
GRANT USAGE ON SCHEMA int4_crypto TO PUBLIC;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pgcrypto' AND n.nspname = 'int4_crypto'
  ) THEN RAISE EXCEPTION 'pgcrypto must be installed in restricted int4_crypto schema'; END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enta_runtime') THEN CREATE ROLE enta_runtime NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_assembler') THEN CREATE ROLE catalog_assembler NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_reviewer') THEN CREATE ROLE catalog_reviewer NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_publisher') THEN CREATE ROLE catalog_publisher NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_validator') THEN CREATE ROLE catalog_validator NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalog_activator') THEN CREATE ROLE catalog_activator NOLOGIN; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('enta_runtime','catalog_assembler','catalog_reviewer','catalog_publisher','catalog_validator','catalog_activator') AND rolcanlogin) THEN
    RAISE EXCEPTION 'INT-4R role groups must remain NOLOGIN; provision login roles separately';
  END IF;
END $$;
