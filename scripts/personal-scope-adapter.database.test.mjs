/**
 * XENO-WORKFORCE-01 SES-01: "Global New Chat defaults to personal conversation ownership with no
 * organizational assignment. Backing personal account scope is not presented as a forced
 * user-created workspace."  §12: "resolve personal workspace wrappers through one adapter."
 *
 * The defect this closes was measured and recorded in chat-workspace-scope.database.test.mjs: the
 * web client sends the caller's PERSONAL workspace as its active context, so a web New Chat was
 * parented to that wrapper -- and anyone admitted to the wrapper (a Studio plan includes 25 seats)
 * could read every chat its owner had started. Built: services/personalScope.js, the one adapter,
 * called by every path that turns an active context into a resource scope; and migration
 * 20260924210000, which returns resources already parented to a wrapper to their owner.
 *
 * Driven through the REAL chat router against the REAL migrated schema (chatproof).
 *
 * Asserted:
 *   1. A New Chat under the caller's own personal wrapper is PERSONALLY owned -- owner_user_id is the
 *      caller, workspace_id is NULL, and the tuple is `owner@user`, never `parent@workspace`.
 *   2. The disclosure is closed: a person admitted to that wrapper as a viewer cannot read the
 *      chat, and it is absent from their conversation list -- the exact reproduction that was
 *      recorded as the defect now reads 404.
 *   3. It still works as the owner's own scope: the owner lists it, reads it and posts to it under
 *      the same active context, and a project created there is personal too.
 *   4. A TEAM workspace is unchanged: a chat created in one is parented to it and its members read it.
 *   5. Another person's personal wrapper is not a place a caller can put anything.
 *   6. The migration moves exactly the rows with one plausible owner, replaces the parent tuple with
 *      an owner tuple, lists anything it would not decide, and moves nothing on a second run.
 *   7. The label: the personal scope is presented as "Personal", never as the manufactured
 *      "<name>'s Workspace", on every surface that names the active scope.
 *
 * Run: TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/chatproof \
 *      node --test scripts/personal-scope-adapter.database.test.mjs
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - the adapter treats a personal wrapper as a workspace   -> "a web New Chat is owned by its person"
 *   - conversation create ignores the adapter               -> "a web New Chat is owned by its person"
 *   - another person's wrapper is accepted                  -> "another person's personal wrapper is not a place to create"
 *   - the list ignores personally owned chats               -> "the owner still lists it under their own scope"
 *   - project create ignores the adapter                    -> "a project under the personal scope is personal"
 *   - the migration moves a row somebody else created       -> "a row with a second plausible owner is left for a person"
 *   - the migration keeps the parent tuple                  -> "the migrated row is no longer readable through the wrapper"
 *   - the taskbar shows the wrapper's manufactured name     -> "the taskbar names the scope through the one label"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import pg from 'pg';
import chatRoutes from '../src/server/routes/chatRoutes.js';
import { writeTuples, check } from '../src/server/utils/authzReBAC.js';

const url = process.env.TEST_DATABASE_URL;
const MIGRATION = new URL('../src/server/database/migrations/20260924210000-personal-wrapper-is-not-a-container.sql', import.meta.url);

test('a personal workspace backs its owner\'s scope and is never a container (SES-01)', { skip: !url }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  const marker = `ses01-${crypto.randomUUID().slice(0, 8)}`;
  const user = async (name) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
    VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`, [`${marker}-${name}`, `${marker}-${name}@example.test`])).rows[0].id;
  const [owner, colleague, stranger] = [await user('owner'), await user('colleague'), await user('stranger')];
  const workspace = async (ownerId, type, slug) => {
    const id = (await pool.query(`INSERT INTO workspaces(owner_user_id,workspace_type,name,slug) VALUES($1,$2,$3,$4) RETURNING id`,
      [ownerId, type, `${slug}'s Workspace`, `${marker}-${slug}`])).rows[0].id;
    await writeTuples(pool, { writes: [{ object: `workspace:${id}`, relation: 'owner', subject: `user:${ownerId}` }] });
    return id;
  };
  const personal = await workspace(owner, 'personal', 'owner');
  const strangersPersonal = await workspace(stranger, 'personal', 'stranger');
  const team = await workspace(owner, 'team', 'team');
  // What an accepted invite writes, into the owner's PERSONAL workspace and into the team.
  await writeTuples(pool, { writes: [
    { object: `workspace:${personal}`, relation: 'viewer', subject: `user:${colleague}` },
    { object: `workspace:${team}`, relation: 'viewer', subject: `user:${colleague}` },
  ] });

  let as = owner;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; req.user = { id: as }; next(); });
  app.use(chatRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (actor, method, path, { ws, body } = {}) => {
    as = actor;
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(ws ? { 'x-xeno-workspace': ws } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const tuples = async (id) => (await pool.query(`SELECT relation, subject_type, subject_id FROM relationship_tuples
    WHERE object_type='conversation' AND object_id=$1 ORDER BY relation`, [id])).rows;

  try {
    let chat;
    await t.test('a New Chat under the caller\'s own personal wrapper is personally owned', async () => {
      const created = await call(owner, 'POST', '/conversations', { ws: personal, body: { title: 'my private thoughts' } });
      assert.equal(created.status, 200, JSON.stringify(created.body));
      chat = created.body.conversation;
      assert.equal(chat.owner_user_id, owner, 'a web New Chat is owned by its person');
      assert.equal(chat.workspace_id, null, 'a web New Chat has no organizational assignment');
      assert.deepEqual(await tuples(chat.id), [{ relation: 'owner', subject_type: 'user', subject_id: owner }],
        'the only edge is the owner\'s own -- nothing a wrapper member could inherit through');
    });

    await t.test('the disclosure is closed: a member admitted to the wrapper reads nothing', async () => {
      const read = await call(colleague, 'GET', `/conversations/${chat.id}`, { ws: personal });
      assert.equal(read.status, 404, 'a colleague admitted to the personal wrapper cannot read its owner\'s chat');
      const bare = await call(colleague, 'GET', `/conversations/${chat.id}`);
      assert.equal(bare.status, 404, '-- with or without the wrapper as context');
      const listed = await call(colleague, 'GET', '/conversations', { ws: personal });
      assert.ok(!listed.body.conversations.some((c) => c.id === chat.id), 'nor does it appear in their list');
      assert.equal((await check(pool, { object: `conversation:${chat.id}`, relation: 'viewer', subject: `user:${colleague}` })).allowed, false);
    });

    await t.test('it still works as the owner\'s own scope', async () => {
      const listed = await call(owner, 'GET', '/conversations', { ws: personal });
      assert.ok(listed.body.conversations.some((c) => c.id === chat.id), 'the owner still lists it under their own scope');
      assert.equal((await call(owner, 'GET', `/conversations/${chat.id}`, { ws: personal })).status, 200);
      const posted = await call(owner, 'POST', `/conversations/${chat.id}/messages`, { ws: personal, body: { role: 'user', content: 'hello' } });
      assert.equal(posted.status, 200, `the owner writes to it under the same context: ${JSON.stringify(posted.body)}`);
      const project = await call(owner, 'POST', '/projects', { ws: personal, body: { name: 'personal project' } });
      assert.equal(project.status, 200);
      assert.equal(project.body.project.owner_user_id, owner, 'a project under the personal scope is personal');
      assert.equal(project.body.project.workspace_id, null);
      const projects = await call(owner, 'GET', '/projects', { ws: personal });
      assert.ok(projects.body.projects.some((p) => p.id === project.body.project.id), 'and is listed there');
    });

    await t.test('a team workspace is unchanged: a chat there is the team\'s', async () => {
      const created = await call(owner, 'POST', '/conversations', { ws: team, body: { title: 'team thread' } });
      assert.equal(created.body.conversation.workspace_id, team);
      assert.equal(created.body.conversation.owner_user_id, null);
      assert.equal((await call(colleague, 'GET', `/conversations/${created.body.conversation.id}`, { ws: team })).status, 200,
        'a team member reads the team\'s chat, as before');
    });

    await t.test('another person\'s personal wrapper is not a place to create anything', async () => {
      await writeTuples(pool, { writes: [{ object: `workspace:${strangersPersonal}`, relation: 'editor', subject: `user:${owner}` }] });
      const created = await call(owner, 'POST', '/conversations', { ws: strangersPersonal, body: { title: 'x' } });
      assert.equal(created.status, 404, "another person's personal wrapper is not a place to create");
      const project = await call(owner, 'POST', '/projects', { ws: strangersPersonal, body: { name: 'x' } });
      assert.equal(project.status, 404);
      const listed = await call(owner, 'GET', '/conversations', { ws: strangersPersonal });
      assert.deepEqual(listed.body.conversations, [], 'and it lists none of the caller\'s chats');
    });

    await t.test('the migration returns existing rows to their owner, and decides nothing it cannot', async () => {
      // The pre-adapter shape, exactly as the old code wrote it.
      const legacy = async (createdBy) => {
        const id = (await pool.query(`INSERT INTO chat_conversations(user_id,owner_user_id,created_by_user_id,title,workspace_id)
          VALUES($1,NULL,$1,'legacy',$2) RETURNING id`, [createdBy, personal])).rows[0].id;
        await writeTuples(pool, { writes: [{ object: `conversation:${id}`, relation: 'parent', subject: `workspace:${personal}` }] });
        return id;
      };
      const ownersOld = await legacy(owner);
      const colleaguesOld = await legacy(colleague);
      assert.equal((await call(colleague, 'GET', `/conversations/${ownersOld}`)).status, 200,
        'the precondition: before the migration a wrapper member reads the owner\'s legacy chat');

      const [up, down] = (await readFile(MIGRATION, 'utf8')).split(/^--\s*DOWN\b/m);
      await pool.query(up);
      const moved = (await pool.query('SELECT owner_user_id, workspace_id FROM chat_conversations WHERE id=$1', [ownersOld])).rows[0];
      assert.deepEqual(moved, { owner_user_id: owner, workspace_id: null });
      assert.equal((await call(colleague, 'GET', `/conversations/${ownersOld}`)).status, 404,
        'the migrated row is no longer readable through the wrapper');
      assert.deepEqual(await tuples(ownersOld), [{ relation: 'owner', subject_type: 'user', subject_id: owner }]);

      const left = (await pool.query('SELECT owner_user_id, workspace_id FROM chat_conversations WHERE id=$1', [colleaguesOld])).rows[0];
      assert.deepEqual(left, { owner_user_id: null, workspace_id: personal }, 'a row with a second plausible owner is left for a person');
      const issues = (await pool.query(`SELECT object_id FROM personal_wrapper_migration_issues WHERE wrapper_id=$1`, [personal])).rows.map((r) => r.object_id);
      assert.deepEqual(issues, [colleaguesOld], '-- and is listed where a person can see it');

      await pool.query(up);
      assert.deepEqual(await tuples(ownersOld), [{ relation: 'owner', subject_type: 'user', subject_id: owner }], 'a second run moves nothing');
      await pool.query(down);
      await pool.query(up);
    });

    await t.test('the personal scope is presented as Personal, never as a manufactured workspace', async () => {
      const read = (p) => readFile(new URL(`../src/${p}`, import.meta.url), 'utf8');
      const [label, taskbar, overview, projects] = await Promise.all([read('lib/workspaceLabel.ts'),
        read('components/overview/OverviewTaskbar.tsx'), read('components/overview/Overview.tsx'), read('components/account/ProjectsPage.tsx')]);
      assert.match(label, /workspace_type === 'personal' \? PERSONAL_SCOPE_LABEL : workspace\.name/);
      assert.match(label, /PERSONAL_SCOPE_LABEL = 'Personal'/);
      for (const [name, src, pattern] of [['taskbar', taskbar, /scopeLabel\(activeWorkspace\)/], ['switcher rows', taskbar, /<strong>\{scopeLabel\(workspace\)\}<\/strong>/],
        ['breadcrumb', overview, /scopeLabel\(activeWorkspace\)/], ['projects eyebrow', projects, /scopeLabel\(activeWorkspace\)/]]) {
        assert.match(src, pattern, `the ${name} names the scope through the one label`);
      }
      assert.doesNotMatch(taskbar, /activeWorkspace\?\.name|<strong>\{workspace\.name\}<\/strong>|'Personal workspace'/,
        'the personal scope is presented as Personal');
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
