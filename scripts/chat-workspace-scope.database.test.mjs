import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { chatWorkspaceScope } from '../src/server/middleware/chatWorkspaceScope.js';
import { writeTuples } from '../src/server/utils/authzReBAC.js';

test('real database rejects a project from another workspace even for a member of both', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const marker = `scope-${crypto.randomUUID()}`;
    const userId = (await client.query(`INSERT INTO users(username,email,password_hash,display_name)
      VALUES($1,$2,'test-fixture-only',$1) RETURNING id`, [marker, `${marker}@xeno.test`])).rows[0].id;
    const ids = [];
    for (const name of ['A', 'B']) {
      const ws = (await client.query(`INSERT INTO workspaces(owner_user_id,name,slug)
        VALUES($1,$2,$3) RETURNING id`, [userId, name, `${marker}-${name}`])).rows[0].id;
      ids.push(ws);
      await writeTuples(client, { writes: [{ object: `workspace:${ws}`, relation: 'owner', subject: `user:${userId}` }] });
    }
    const projectId = (await client.query(`INSERT INTO chat_projects(workspace_id,name)
      VALUES($1,'Scoped project') RETURNING id`, [ids[1]])).rows[0].id;
    const conversationId = (await client.query(`INSERT INTO chat_conversations(project_id,title)
      VALUES($1,'Scoped conversation') RETURNING id`, [projectId])).rows[0].id;
    for (const path of [`/projects/${projectId}/files`, `/conversations/${conversationId}/messages`]) {
      for (const [index, expected] of [[0, 404], [1, 200]]) {
        let status = 200, forwarded = false;
        const req = { db: client, user: { id: userId }, headers: { 'x-xeno-workspace': ids[index] }, query: {}, body: {}, path };
        const res = { status(value) { status = value; return this; }, json() { return this; } };
        await chatWorkspaceScope(req, res, () => { forwarded = true; });
        assert.equal(status, expected);
        assert.equal(forwarded, expected === 200);
      }
    }
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
