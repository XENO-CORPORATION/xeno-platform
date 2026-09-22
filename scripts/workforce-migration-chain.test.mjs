/**
 * The workforce migration chain must be APPLIABLE from an empty database.
 *
 * This gate exists because it was already broken. On 2026-09-22 `origin/main` carried three
 * workforce migrations — team-membership snapshots, divisions, handoffs — whose foundation
 * (`20260905120000-workforce-resources` and two siblings) had never been committed. Two of the
 * three failed on their FIRST statement with `relation "workforce_resources" does not exist`, and
 * nothing reported it, because every workforce suite builds its own predecessors by name: each
 * one passes in a world where the chain as a whole cannot run.
 *
 * So this asserts the property no per-migration suite can: that applying every workforce migration
 * in timestamp order, on an empty database, succeeds. A migration that lands without its
 * predecessor fails HERE even though its own suite is green.
 *
 * Run: WORKFORCE_TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/workforceproof \
 *      node --test scripts/workforce-migration-chain.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const MIGRATIONS = new URL('../src/server/database/migrations/', import.meta.url);

/** Tables the workforce chain legitimately depends on but does not own. */
const PLATFORM_PRELUDE = `
  CREATE TABLE users(id UUID PRIMARY KEY);
  CREATE TABLE workspaces(
    id UUID PRIMARY KEY, owner_user_id UUID REFERENCES users(id),
    name TEXT NOT NULL, slug TEXT NOT NULL);
  CREATE TABLE api_keys(id UUID PRIMARY KEY, user_id UUID REFERENCES users(id));
`;

test('every workforce migration applies in order from an empty database', async (t) => {
  const connectionString = process.env.WORKFORCE_TEST_DATABASE_URL;
  assert.ok(connectionString, 'WORKFORCE_TEST_DATABASE_URL required; no skipped SQL proof');
  assert.equal(new URL(connectionString).pathname, '/workforceproof',
    'refusing to run against any database but the disposable proof fixture');

  const schema = `workforce_chain_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 });

  const files = (await readdir(MIGRATIONS))
    .filter(f => f.endsWith('.sql') && /workforce/.test(f))
    .sort();                       // filenames are timestamp-prefixed, so lexical IS chronological

  let createdSchema = false;
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); createdSchema = true;
    await pool.query(PLATFORM_PRELUDE);

    await t.test('the chain is non-empty and starts at the foundation', () => {
      assert.ok(files.length >= 7, `expected the full workforce chain, found ${files.length}`);
      assert.ok(files[0].includes('workforce-resources'),
        `the chain must begin with the resource table, not ${files[0]} -- everything else FKs into it`);
    });

    await t.test('each migration applies on the state its predecessors left', async () => {
      const applied = [];
      for (const file of files) {
        const [up] = (await readFile(new URL(file, MIGRATIONS), 'utf8')).split('-- DOWN');
        try {
          await pool.query(up);
        } catch (error) {
          assert.fail(
            `${file} could not apply after [${applied.join(', ') || 'nothing'}]: ${error.message}\n` +
            `A migration that cannot apply from an empty database is unreachable in production ` +
            `however green its own suite is.`);
        }
        applied.push(file);
      }
      assert.equal(applied.length, files.length);
    });

    await t.test('the chain leaves no dangling foreign key', async () => {
      // A FK whose target is missing cannot exist in PostgreSQL -- so the real risk is the
      // inverse: a workforce table nobody references and nothing creates. Assert instead that
      // every workforce FK resolves to a table this chain or the prelude created.
      const { rows } = await pool.query(`
        SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.contype = 'f' AND n.nspname = $1`, [schema]);
      assert.ok(rows.length > 0, 'the workforce chain declares no foreign keys at all -- implausible');
      for (const { parent } of rows) {
        const bare = parent.replace(/^.*\./, '');
        assert.ok(/^(workforce_|users$|workspaces$|api_keys$)/.test(bare),
          `workforce schema references ${bare}, which is neither workforce-owned nor in the prelude`);
      }
    });

    await t.test('the foundation tables exist once the chain has run', async () => {
      const { rows } = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename LIKE 'workforce%'`, [schema]);
      const present = new Set(rows.map(r => r.tablename));
      for (const required of ['workforce_resources', 'workforce_workspace_assignments',
                              'workforce_team_memberships', 'workforce_divisions',
                              'workforce_handoffs', 'workforce_operations']) {
        assert.ok(present.has(required), `${required} missing after the full chain`);
      }
    });
  } finally {
    if (createdSchema) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
