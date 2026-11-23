# INT-4R3-E disposable PostgreSQL issuer-role probe — 2026-10-02

**Scope:** Local PostgreSQL 18.4 for Windows, dedicated trust-authenticated cluster on `127.0.0.1:55483`, using synthetic `probe_*` roles only. This followed the Database specialist's PASS to run a dedicated disposable role-provisioning probe. It did not connect to the integrated app database, either old service, or a managed provider.

**Question:** Can a non-superuser DBA with `CREATEROLE` create a temporary `NOLOGIN CREATEROLE` creator, use `SET LOCAL ROLE` to create a locked issuer login, and have a separate non-superuser `CREATEROLE` provisioner drop the temporary creator so the issuer has zero membership edges?

**Observed sequence:**

1. The dedicated superuser created `probe_dba` and `probe_provisioner`, both non-superuser logins with `CREATEROLE` and without `CREATEDB`, replication or `BYPASSRLS`.
2. `probe_dba` created `probe_temp_creator NOLOGIN CREATEROLE`, explicitly gained `SET` access, and granted `probe_provisioner` `ADMIN`/`SET` access. The pre-drop membership query showed four edges, including the automatic `probe_issuer_login → probe_temp_creator` `ADMIN` edge.
3. In a committed `probe_dba` transaction, `SET LOCAL ROLE probe_temp_creator` created `probe_issuer_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD NULL CONNECTION LIMIT 0`.
4. A fresh `probe_provisioner` session executed `DROP ROLE probe_temp_creator` successfully.
5. A superuser readback returned `server_version=18.4`, temporary creator absent, issuer present, `rolcanlogin=true`, `rolinherit=false`, every privileged role flag false, `rolconnlimit=0`, null password and **zero membership edges**. `CONNECT` to the synthetic `postgres` database was true through its default `PUBLIC` privilege; this probe did not attempt to harden a production database's `PUBLIC` defaults.

The first PowerShell automation attempt stalled after `pg_ctl` launch and was interrupted before creating any roles. The direct PostgreSQL CLI commands above then ran against the same dedicated cluster. The cluster was stopped with `pg_ctl -m fast -w stop`; subsequent `127.0.0.1:55483` listener check was false. The startup/stop log is retained privately at [`postgres-start-stop.log`](../../output/int4-r3e-role-probe-20261002/postgres-start-stop.log), SHA-256 `011FCCAEC39A67159B3D25F1C07EE6FF427C85B6554932022079322CB994C6A9` at capture. A recursive removal of the stopped disposable cluster files was automatically rejected by command approval policy even after the resolved path was verified inside the intended output directory; those inactive files remain at `output/int4-r3e-role-probe-20261002/cluster-20261002201231` pending permitted cleanup.

**Limit:** This proves the proposed role-membership cleanup on one local PostgreSQL 18.4 build. It does not prove the actual managed provider allows the same role lifecycle, has the named admin principals, or grants the intended SQL privileges. R3-E migration, production issuer, receipt issuance and content activation remain blocked on the exact Database/Security/Gate reviews and host/provider verification.
