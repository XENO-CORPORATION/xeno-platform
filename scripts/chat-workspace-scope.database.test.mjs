/* ⚠️ XENO-WORKFORCE-01 SES-01 IS NOT CITED, AND THE REASON IS A MEASURED PRIVACY DEFECT.
 *
 * SES-01: "Global New Chat defaults to personal conversation ownership with no organizational
 * assignment. Backing personal account scope is not presented as a forced user-created workspace."
 *
 * The SERVER default holds: POST /api/chat/conversations with no workspace context writes
 * owner_user_id = the caller, workspace_id NULL and a `conversation#owner@user` tuple.
 *
 * The web client never reaches that default. chatService.ts and ChatWithLLM.tsx attach
 * `x-xeno-workspace` from localStorage on every request, and WorkspaceContext.tsx sets that key to
 * the caller's PERSONAL workspace by default. So a web New Chat is created with workspace_id = the
 * personal workspace, owner_user_id NULL and a `conversation#parent@workspace` tuple -- ownership
 * by containment, not by the person. Measured against PostgreSQL through the real chat router,
 * 2026-09-23:
 *
 *   - a user is admitted to someone's personal workspace as `viewer` (what an accepted invite writes)
 *   - GET that person's web-created chat -> 200, message content visible
 *   - GET the same person's API-created chat -> 404
 *
 * A personal workspace CAN take members: invites carry no workspace_type check, and the seat limit
 * resolves from the owner's plan -- `studio` includes 25 seats. The Team page invites into the
 * ACTIVE workspace, which defaults to the personal one. So a Studio owner who invites a colleague
 * from that page hands them every chat they ever started on the web.
 *
 * LATENT, NOT LIVE -- production measured 2026-09-23 (aggregate counts, no content read): 17 active
 * personal workspaces, NONE with a member other than its owner and NO pending invite to one; 26
 * conversations parented to a personal workspace, 0 readable by anyone but their owner. The path
 * exists and nobody has walked it yet. Re-measure before relying on that:
 *   personal workspaces whose relationship_tuples name a user other than owner_user_id.
 *
 * NOT repaired here: the fix is the spec's own prescription (§12, "resolve personal workspace
 * wrappers through one adapter"), and it spans conversation creation, the scoped list query, the
 * pooled-billing tag the header also drives, and a migration of existing conversations already
 * parented to personal workspaces -- an ownership-model change with a production data migration.
 */
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
