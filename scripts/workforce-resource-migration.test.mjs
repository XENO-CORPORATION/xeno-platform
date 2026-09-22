import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Deliberately fails without an explicit disposable target; absence is not proof.
const connectionString = process.env.WORKFORCE_TEST_DATABASE_URL;
test('workforce resource persistence against isolated PostgreSQL', async t => {
  assert.ok(connectionString, 'WORKFORCE_TEST_DATABASE_URL is required; use an owned disposable loopback workforceproof database');
  const target = new URL(connectionString);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.equal(target.pathname, '/workforceproof');
  assert.equal(target.search, '', 'Connection options must not redirect the test target');
  const schema = `workforce_${randomBytes(12).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 });
  const migration = await readFile(new URL('../src/server/database/migrations/20260905120000-workforce-resources.sql', import.meta.url), 'utf8');
  const [up, down] = migration.split('-- DOWN');
  const owner = randomUUID(), creator = randomUUID(), workspace = randomUUID();
  const agent = randomUUID(), team = randomUUID(), companyAgent = randomUUID();
  const hash = 'a'.repeat(64);
  const denied = (sql, values, code) => assert.rejects(pool.query(sql, values), e => e.code === code);
  let createdSchema = false;
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    createdSchema = true;
    await pool.query('CREATE TABLE users(id UUID PRIMARY KEY); CREATE TABLE agent_identities(id UUID PRIMARY KEY, marker TEXT NOT NULL)');
    await pool.query('INSERT INTO users(id) VALUES ($1),($2);', [owner, creator]);
    await pool.query('INSERT INTO agent_identities VALUES ($1, $2)', [randomUUID(), 'legacy-retained']);
    await pool.query((await readFile(new URL('../src/server/database/migrations/20260711120000-workspaces.sql', import.meta.url), 'utf8')).split('-- DOWN')[0]);
    await pool.query('INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,$3,$4)', [workspace, owner, 'Company', `company-${workspace}`]);
    const legacy = (await pool.query('SELECT * FROM agent_identities')).rows;

    await t.test('empty schema rollback and reapply preserve canonical users/workspaces/identities', async () => {
      await pool.query(up);
      await pool.query(down);
      assert.equal((await pool.query("SELECT to_regclass('workforce_resources') AS relation")).rows[0].relation, null);
      await pool.query(up);
      assert.deepEqual((await pool.query('SELECT * FROM agent_identities')).rows, legacy);
      assert.equal((await pool.query('SELECT count(*) FROM users')).rows[0].count, '2');
      assert.equal((await pool.query('SELECT id FROM workspaces')).rows[0].id, workspace);
    });

    await t.test('personal and company ownership share canonical resource IDs independently of creator', async () => {
      await pool.query(`INSERT INTO workforce_resources(id,kind,owner_user_id,created_by_user_id,name)
        VALUES ($1,'agent',$2,$3,'Personal'), ($4,'team',$2,$3,'Reusable team')`, [agent, owner, creator, team]);
      await pool.query(`INSERT INTO workforce_resources(id,kind,owner_workspace_id,created_by_user_id,name)
        VALUES ($1,'agent',$2,$3,'Company agent')`, [companyAgent, workspace, creator]);
      const row = (await pool.query('SELECT * FROM workforce_resources WHERE id=$1', [companyAgent])).rows[0];
      assert.equal(row.owner_user_id, null);
      assert.equal(row.owner_workspace_id, workspace);
      assert.equal(row.created_by_user_id, creator);
      assert.equal(row.status, 'active');
      assert.equal(row.revision, '1');
    });

    await t.test('owner XOR and canonical foreign keys reject unknown or contradictory owners', async () => {
      await denied("INSERT INTO workforce_resources(kind,name) VALUES ('agent','Missing')", [], '23514');
      await denied("INSERT INTO workforce_resources(kind,name,owner_user_id,owner_workspace_id) VALUES ('agent','Both',$1,$2)", [owner, workspace], '23514');
      await denied("INSERT INTO workforce_resources(kind,name,owner_user_id) VALUES ('agent','Unknown',$1)", [randomUUID()], '23503');
      await denied("INSERT INTO workforce_resources(kind,name,owner_workspace_id) VALUES ('agent','Unknown',$1)", [randomUUID()], '23503');
      await denied('UPDATE workforce_resources SET created_by_user_id=$1 WHERE id=$2', [randomUUID(), agent], '23503');
    });

    await t.test('kind, lifecycle, name and revision constraints fail closed', async () => {
      for (const [column, value] of [['kind', 'principal'], ['status', 'deleted'], ['name', ' '], ['revision', '0']]) {
        await denied(`UPDATE workforce_resources SET ${column}=$1 WHERE id=$2`, [value, agent], '23514');
      }
      await pool.query("UPDATE workforce_resources SET status='archived',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND revision=1", [team]);
      assert.equal((await pool.query('SELECT revision FROM workforce_resources WHERE id=$1', [team])).rows[0].revision, '2');
    });

    const insertVersion = (resourceId, version = 1) => pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,created_by_user_id)
      VALUES($1,$2,$3,$4,$5)`, [resourceId, version, { instructions: 'Pinned instructions', skills: [], requestedCapabilities: [] }, hash, creator]);

    await t.test('versions reference agents only and reject missing resources', async () => {
      await assert.rejects(insertVersion(team), e => e.code === '23503');
      await assert.rejects(insertVersion(randomUUID()), e => e.code === '23503');
      await insertVersion(agent);
      await insertVersion(companyAgent);
      await denied("UPDATE workforce_resources SET kind='team' WHERE id=$1", [agent], '23503');
      await denied(`INSERT INTO workforce_agent_versions(resource_id,resource_kind,version,content,content_hash)
        VALUES($1,'team',1,'{}',$2)`, [team, hash], '23514');
    });

    await t.test('version/hash/schema and pinned metadata have checked shapes', async () => {
      for (const [column, value] of [['version', 0], ['schema_version', 0], ['content_hash', 'not-a-hash'], ['content', '[]'], ['provenance', '[]'], ['license', '[]']]) {
        const fields = { resource_id: agent, version: 2, content: '{}', content_hash: hash, [column]: value };
        const keys = Object.keys(fields);
        await denied(`INSERT INTO workforce_agent_versions(${keys.join(',')}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(fields), '23514');
      }
    });

    await t.test('concurrent writers cannot reuse one resource/version identity', async () => {
      const outcomes = await Promise.allSettled([insertVersion(agent, 2), insertVersion(agent, 2)]);
      assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(outcomes.find(r => r.status === 'rejected').reason.code, '23505');
      assert.equal((await pool.query('SELECT count(*) FROM workforce_agent_versions WHERE resource_id=$1 AND version=2', [agent])).rows[0].count, '1');
    });

    await t.test('immutable versions reject mutation, deletion, and creator-erasure bypass', async () => {
      await denied("UPDATE workforce_agent_versions SET content='{}' WHERE resource_id=$1", [agent], '23514');
      await denied('UPDATE workforce_agent_versions SET created_by_user_id=NULL WHERE resource_id=$1', [agent], '23514');
      await denied("UPDATE workforce_agent_versions SET created_by_user_id=NULL,content='{}' WHERE resource_id=$1", [agent], '23514');
      await denied('UPDATE workforce_agent_versions SET version=5 WHERE resource_id=$1', [agent], '23514');
      await denied('DELETE FROM workforce_agent_versions WHERE resource_id=$1', [agent], '23514');
      await denied('DELETE FROM workforce_resources WHERE id=$1', [agent], '23503');
      await denied('TRUNCATE workforce_agent_versions', [], '23514');
      await denied('TRUNCATE workforce_resources CASCADE', [], '23514');
    });

    await t.test('creator erasure preserves company resources and every byte of pinned definition', async () => {
      const before = (await pool.query('SELECT * FROM workforce_agent_versions ORDER BY resource_id,version')).rows;
      await pool.query('DELETE FROM users WHERE id=$1', [creator]);
      const after = (await pool.query('SELECT * FROM workforce_agent_versions ORDER BY resource_id,version')).rows;
      assert.deepEqual(after, before.map(row => ({ ...row, created_by_user_id: null })));
      const resource = (await pool.query('SELECT * FROM workforce_resources WHERE id=$1', [companyAgent])).rows[0];
      assert.equal(resource.created_by_user_id, null);
      assert.equal(resource.owner_workspace_id, workspace);
      assert.equal((await pool.query('SELECT count(*) FROM workforce_resources')).rows[0].count, '3');
    });

    await t.test('canonical owner deletion cannot cascade away retained company or personal work', async () => {
      await denied('DELETE FROM users WHERE id=$1', [owner], '23503');
      await denied('DELETE FROM workspaces WHERE id=$1', [workspace], '23503');
      assert.deepEqual((await pool.query('SELECT * FROM agent_identities')).rows, legacy);
    });

    await t.test('populated rollback refuses data loss and leaves relations intact', async () => {
      await denied(down, [], '23514');
      assert.equal((await pool.query('SELECT count(*) FROM workforce_agent_versions')).rows[0].count, '3');
      assert.equal((await pool.query('SELECT count(*) FROM workforce_resources')).rows[0].count, '3');
    });
  } finally {
    if (createdSchema) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
