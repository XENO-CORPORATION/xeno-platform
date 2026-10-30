/**
 * The database role the running application connects as (`xeno_app`), and what it may do.
 *
 * Until 2026-10-30 the backend connected as `postgres`, a superuser, so the ledger's triggers were a tripwire: the
 * same credential that served a request could disable them. `xeno_app` reads and writes data and nothing else: no
 * DDL, no ownership, no `session_replication_role`. Schema changes run in the separate `migrate` job
 * (database/run-startup-migrations.mjs), the only holder of the superuser credential.
 *
 * Applied at the end of every migration run, so a table added by any migration is granted without a second step.
 * The role is created NOLOGIN here; LOGIN and its password are set on the box (docs/DATABASE-ROLES.md), because a
 * password never belongs in a migration.
 *
 * Narrowed below the general grant: the ledger journal is append-only, and the chain's own records move only through
 * the SECURITY DEFINER functions in migrate-account-v2.js.
 */
export const RUNTIME_ROLE = 'xeno_app';

const SQL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUNTIME_ROLE}') THEN
    CREATE ROLE ${RUNTIME_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; -- two migrators on a fresh cluster
END $$;
GRANT USAGE ON SCHEMA public TO ${RUNTIME_ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RUNTIME_ROLE};
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${RUNTIME_ROLE};
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${RUNTIME_ROLE};
DO $$ BEGIN
  IF to_regclass('public.credit_transactions') IS NOT NULL THEN
    REVOKE UPDATE, DELETE ON credit_transactions FROM ${RUNTIME_ROLE};
  END IF;
  IF to_regclass('public.ledger_chain_heads') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE ON ledger_chain_heads, ledger_chain_epochs FROM ${RUNTIME_ROLE};
    REVOKE UPDATE, DELETE ON ledger_chain_attestations, ledger_chain_checkpoints FROM ${RUNTIME_ROLE};
    REVOKE EXECUTE ON FUNCTION ledger_chain_reseal(uuid, text, text) FROM PUBLIC, ${RUNTIME_ROLE};
  END IF;
END $$;
`;

export async function applyRuntimeGrants(pool) {
  await pool.query(SQL);
}
