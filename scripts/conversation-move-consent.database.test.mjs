/**
 * XENO-WORKFORCE-01 SES-05: "Moving/sharing a conversation is separate from mode/root changes. Show
 * the target audience and included historical content; no silent transfer of private history. Active
 * provider ownership handoff must settle before a scope move."  §11.1: `agent.session.move` takes a
 * "source, destination/audience, consent revision".
 *
 * Before: a move was `project_id` on the general `PUT /conversations/:id`, beside title and model. It
 * re-parented the whole history into the project with no word of who could then read it.
 * Built: services/conversationMove.js and two routes, POST .../move/preview and .../move, plus the
 * consented move dialog in the chat UI (ChatMoveModal.tsx).
 *
 * Driven through the REAL chat router against the REAL migrated schema.
 *
 * Asserted:
 *   1. SEPARATE. The general update refuses `project_id` outright and changes nothing -- a rename can
 *      no longer carry a move.
 *   2. SHOWN. The preview names every principal who will be able to READ the chat after the move --
 *      computed by the same authority check the read path uses, so it matches reality: each listed
 *      person reads it afterwards, and nobody unlisted does -- and states the history that goes with
 *      it (message count and range). The preview changes nothing.
 *   3. CONSENTED. A move without the preview's consent revision is refused; a revision that no longer
 *      matches -- because a reader was added to the project, or a message was added to the chat --
 *      is refused and nothing moves. Only the current revision moves it.
 *   4. SETTLED. While a scheduled run is claimed or executing against the chat, the move is refused.
 *   5. AUTHORITY. A viewer of the chat, or someone without edit on the project, cannot preview or move.
 *
 * Run: TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/chatproof \
 *      node --test scripts/conversation-move-consent.database.test.mjs
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - the general update still moves on project_id        -> "a rename can no longer carry a move"
 *   - the audience omits the project's workspace readers  -> "the preview names everyone who will read it"
 *   - the consent revision ignores the audience           -> "a reader added since the preview makes the consent stale"
 *   - the consent revision ignores the history            -> "a message added since the preview makes the consent stale"
 *   - the move skips the consent check                    -> "a move without consent is refused"
 *   - the move skips the settle check                     -> "a move waits for running work to settle"
 *   - the move needs no admin on the conversation         -> "a viewer of the chat cannot move it"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';
import chatRoutes from '../src/server/routes/chatRoutes.js';
import { writeTuples, check } from '../src/server/utils/authzReBAC.js';

const url = process.env.TEST_DATABASE_URL;

test('moving a chat into a project shows its audience and history, and needs that consent (SES-05)', { skip: !url }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  const marker = `ses05-${crypto.randomUUID().slice(0, 8)}`;
  const user = async (name) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
    VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`, [`${marker}-${name}`, `${marker}-${name}@example.test`])).rows[0].id;
  const [owner, teammate, projectGuest, outsider, latecomer, reader] =
    [await user('owner'), await user('teammate'), await user('guest'), await user('outsider'), await user('late'), await user('reader')];
  const team = (await pool.query(`INSERT INTO workspaces(owner_user_id,workspace_type,name,slug) VALUES($1,'team','Studio',$2) RETURNING id`,
    [owner, `${marker}-team`])).rows[0].id;
  await writeTuples(pool, { writes: [
    { object: `workspace:${team}`, relation: 'owner', subject: `user:${owner}` },
    { object: `workspace:${team}`, relation: 'viewer', subject: `user:${teammate}` },
  ] });
  const project = (await pool.query(`INSERT INTO chat_projects(user_id,owner_user_id,workspace_id,created_by_user_id,updated_by_user_id,name)
    VALUES(NULL,NULL,$1,$2,$2,'Launch') RETURNING id`, [team, owner])).rows[0].id;
  await writeTuples(pool, { writes: [
    { object: `project:${project}`, relation: 'parent', subject: `workspace:${team}` },
    { object: `project:${project}`, relation: 'viewer', subject: `user:${projectGuest}` },
  ] });

  let as = owner;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; req.user = { id: as }; next(); });
  app.use(chatRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (actor, method, path, body) => {
    as = actor;
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const newChat = async (title) => {
    const chat = (await call(owner, 'POST', '/conversations', { title })).body.conversation;
    for (const content of ['first thought', 'a reply', 'private detail']) {
      await call(owner, 'POST', `/conversations/${chat.id}/messages`, { role: 'user', content });
    }
    return chat;
  };
  const scope = async (id) => (await pool.query('SELECT project_id, owner_user_id, workspace_id FROM chat_conversations WHERE id=$1', [id])).rows[0];
  const canRead = async (id, who) => (await check(pool, { object: `conversation:${id}`, relation: 'viewer', subject: `user:${who}` })).allowed;

  try {
    const chat = await newChat('private planning');

    await t.test('the general update refuses a move outright', async () => {
      const renamed = await call(owner, 'PUT', `/conversations/${chat.id}`, { title: 'renamed', project_id: project });
      assert.equal(renamed.status, 400, 'a rename can no longer carry a move');
      assert.equal(renamed.body.code, 'move_is_a_separate_action');
      assert.deepEqual(await scope(chat.id), { project_id: null, owner_user_id: owner, workspace_id: null }, 'and nothing moved');
      assert.equal((await call(owner, 'PUT', `/conversations/${chat.id}`, { title: 'renamed' })).status, 200, 'a plain rename still works');
    });

    let preview;
    await t.test('the preview shows exactly who will read it and what history goes with it', async () => {
      const r = await call(owner, 'POST', `/conversations/${chat.id}/move/preview`, { project_id: project });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      preview = r.body.move;
      const listed = preview.audience.map((p) => p.userId).sort();
      assert.deepEqual(listed, [owner, teammate, projectGuest].sort(), 'the preview names everyone who will read it');
      assert.ok(preview.audience.find((p) => p.userId === owner).isYou);
      assert.equal(preview.includedHistory.messages, 3, 'the preview states the history that goes with it');
      assert.equal(preview.includedHistory.scope, 'entire-conversation');
      assert.match(preview.consentRevision, /^[0-9a-f]{64}$/);
      assert.deepEqual(await scope(chat.id), { project_id: null, owner_user_id: owner, workspace_id: null }, 'the preview changes nothing');
      assert.equal(await canRead(chat.id, teammate), false, '-- the teammate cannot read it yet');
    });

    await t.test('a move needs the current consent, and a changed audience or history invalidates it', async () => {
      const bare = await call(owner, 'POST', `/conversations/${chat.id}/move`, { project_id: project });
      assert.equal(bare.status, 400, 'a move without consent is refused');
      assert.equal(bare.body.code, 'consent_required');

      await writeTuples(pool, { writes: [{ object: `project:${project}`, relation: 'viewer', subject: `user:${latecomer}` }] });
      const staleAudience = await call(owner, 'POST', `/conversations/${chat.id}/move`, { project_id: project, consent_revision: preview.consentRevision });
      assert.equal(staleAudience.status, 409, 'a reader added since the preview makes the consent stale');
      assert.equal(staleAudience.body.code, 'consent_stale');
      assert.equal((await scope(chat.id)).project_id, null, 'and nothing moved');

      const second = (await call(owner, 'POST', `/conversations/${chat.id}/move/preview`, { project_id: project })).body.move;
      assert.ok(second.audience.some((p) => p.userId === latecomer), 'the new preview names the new reader');
      await call(owner, 'POST', `/conversations/${chat.id}/messages`, { role: 'user', content: 'one more thing' });
      const staleHistory = await call(owner, 'POST', `/conversations/${chat.id}/move`, { project_id: project, consent_revision: second.consentRevision });
      assert.equal(staleHistory.status, 409, 'a message added since the preview makes the consent stale');

      const third = (await call(owner, 'POST', `/conversations/${chat.id}/move/preview`, { project_id: project })).body.move;
      assert.equal(third.includedHistory.messages, 4);
      const moved = await call(owner, 'POST', `/conversations/${chat.id}/move`, { project_id: project, consent_revision: third.consentRevision });
      assert.equal(moved.status, 200, JSON.stringify(moved.body));
      assert.equal((await scope(chat.id)).project_id, project);
    });

    await t.test('what was shown is what happened: every listed reader reads it, nobody else does', async () => {
      for (const who of [owner, teammate, projectGuest, latecomer]) assert.equal(await canRead(chat.id, who), true, `${who} was listed and reads it`);
      for (const who of [outsider, reader]) assert.equal(await canRead(chat.id, who), false, 'an unlisted person does not');
      assert.ok(!preview.audience.some((p) => [outsider, reader].includes(p.userId)), '-- and neither was listed');
    });

    await t.test('a move waits for running work to settle', async () => {
      const busy = await newChat('busy');
      // The task as the scheduler writes one (chat-project-database-integration.test.mjs), bound to this chat.
      const task = (await pool.query(`INSERT INTO chat_scheduled_tasks(
          user_id,created_by_user_id,run_as_user_id,conversation_id,title,prompt,model_id,cadence,cadence_label,
          status,next_run_at,schedule_kind,timezone,timezone_source,dtstart_local,rrule
        ) VALUES($1,$1,$1,$2,'Digest','Summarise','gpt-5.6','daily','Every day','active',NOW()+INTERVAL '1 day',
          'recurring','UTC','user_confirmed',date_trunc('second',NOW() AT TIME ZONE 'UTC'),'FREQ=DAILY') RETURNING id`,
      [owner, busy.id])).rows[0].id;
      await pool.query(`INSERT INTO chat_scheduled_runs(task_id,occurrence_key,scheduled_for,status,conversation_id,lease_owner,lease_expires_at)
        VALUES($1,'k1',now(),'running',$2,'worker-1',now()+interval '5 minutes')`, [task, busy.id]);
      const p = (await call(owner, 'POST', `/conversations/${busy.id}/move/preview`, { project_id: project })).body.move;
      const refused = await call(owner, 'POST', `/conversations/${busy.id}/move`, { project_id: project, consent_revision: p.consentRevision });
      assert.equal(refused.status, 409, 'a move waits for running work to settle');
      assert.equal(refused.body.code, 'execution_not_settled');
      await pool.query(`UPDATE chat_scheduled_runs SET status='succeeded', completed_at=now() WHERE task_id=$1`, [task]);
      const ok = await call(owner, 'POST', `/conversations/${busy.id}/move`, { project_id: project, consent_revision: p.consentRevision });
      assert.equal(ok.status, 200, 'and proceeds once it has');
    });

    await t.test('only someone who administers the chat and can edit the project may move it', async () => {
      const other = await newChat('guarded');
      // The reader CAN edit the project, so the only thing standing between them and moving the chat
      // is that they merely view it. Without the project grant this case would be refused by the
      // project check and would say nothing about the conversation one.
      await writeTuples(pool, { writes: [
        { object: `conversation:${other.id}`, relation: 'viewer', subject: `user:${reader}` },
        { object: `project:${project}`, relation: 'editor', subject: `user:${reader}` },
      ] });
      assert.equal((await call(reader, 'POST', `/conversations/${other.id}/move/preview`, { project_id: project })).status, 404,
        'a viewer of the chat cannot move it');
      const own = (await call(outsider, 'POST', '/conversations', { title: 'mine' })).body.conversation;
      assert.equal((await call(outsider, 'POST', `/conversations/${own.id}/move/preview`, { project_id: project })).status, 404,
        'nor can someone without edit on the project');
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
