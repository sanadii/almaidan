-- DRAFT ONLY. Requires the managed-PostgreSQL owner. Do not run before the
-- exact R3-E Database/Security/Gate reviews and the target-database audit.
DO $$
BEGIN
  IF session_user<>'enta_catalog_bootstrap_dba' OR current_user<>session_user THEN
    RAISE EXCEPTION 'role provisioning requires the named bootstrap DBA session';
  END IF;
END $$;
-- The custodian is an existing, independently audited managed-DB principal.
-- Never create a password or application credential for it. Provision the
-- owner/login separately; the issuer login never joins owner/workflow roles.

CREATE ROLE catalog_issuer
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE ROLE enta_catalog_issuer_login
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- The bootstrap DBA first grants the permanent sole custodian edge from its
-- independently audited account. The migration preflight pins this grantor.
GRANT catalog_issuer TO enta_catalog_migration_custodian
  WITH ADMIN OPTION, INHERIT FALSE, SET FALSE;

-- Bind the isolated issuer host's managed identity through the database
-- provider's secretless/short-lived credential mechanism. The issuer login
-- receives no membership; only direct SELECT and fixed-function EXECUTE.
