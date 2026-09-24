/**
 * XENO-WORKFORCE-01 HAND-06: "No silent history transfer. As with SES-05, a handoff shows the target
 * audience and the included historical content. Handing work to another division does not disclose
 * the sender's private transcript."  (T98: "no transcript disclosed to the target beyond the declared
 * audience".)
 *
 * Implemented by 20260924200000-workforce-handoff-disclosure.sql. Real PostgreSQL, the real
 * workforce chain, real chat conversations and messages in all three scopes (personal, workspace,
 * project).
 *
 * Asserted:
 *   1. SILENCE IS NOTHING. A handoff that declares nothing discloses nothing, even once accepted.
 *   2. IT SHOWS BEFORE ANYONE AGREES. The manifest lists exactly the included messages (which
 *      conversation, which role, when) while the handoff is still only offered, and carries no
 *      content. The audience is on the row for the target to read.
 *   3. EXACTLY THE DECLARED HISTORY, EXACTLY THE DECLARED AUDIENCE, ONLY ONCE ACCEPTED. The target
 *      reads the two declared messages of a four-message private transcript and never the other
 *      two. A member of the receiving division outside the audience reads nothing. An offered,
 *      declined or expired handoff discloses nothing to anyone.
 *   4. ONLY THE SENDER'S TO GIVE. A sender may include its own transcript or its source
 *      workspace's history, including that workspace's projects. It may not include another
 *      person's private conversation, another workspace's conversation, or a project owned
 *      elsewhere.
 *   5. FIXED AT THE OFFER. Neither the audience nor the included messages change after the offer,
 *      so what the target accepted is what it gets. The audience must include the target.
 *
 * Run: WORKFORCE_TEST_DATABASE_URL=postgresql://t:t@127.0.0.1:5432/workforceproof \
 *      node --test scripts/workforce-handoff-disclosure.test.mjs
 *
 * Mutation-checked (each fails the named assertion; restored passes):
 *   - the disclosure may change after the offer          -> "the audience cannot be widened after the offer"
 *   - any private conversation is disclosable            -> "another person's private transcript is not the sender's to disclose"
 *   - any workspace conversation is disclosable          -> "another workspace's history is not the sender's to disclose"
 *   - any project conversation is disclosable            -> "a project owned elsewhere is not the sender's to disclose"
 *   - history is readable before acceptance              -> "an offered handoff discloses nothing yet"
 *   - history ignores the audience                       -> "a reader outside the declared audience reads nothing"
 *   - history returns the whole conversation             -> "only the declared messages cross, never the rest of the transcript"
 *   - the audience need not include the target           -> "a disclosure must reach the principal doing the work"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { requireProofDatabase, workforceProofUnavailable } from './lib/workforce-proof-database.mjs';

const MIGRATIONS = new URL('../src/server/database/migrations/', import.meta.url);
const THIS = '20260924200000-workforce-handoff-disclosure.sql';

test('a handoff shows its audience and included history, and discloses nothing else (HAND-06)', { skip: workforceProofUnavailable() }, async (t) => {
  const connectionString = requireProofDatabase(process.env.WORKFORCE_TEST_DATABASE_URL);
  const schema = `workforce_disclosure_${randomBytes(10).toString('hex')}`;
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 });
  let created = false;

  const [owner, sender, target, bystander, colleague, outsider] = Array.from({ length: 6 }, () => randomUUID());
  const [company, otherCompany] = [randomUUID(), randomUUID()];
  const refuse = (promise, pattern, message) => assert.rejects(promise,
    (e) => e.code === '23514' && (!pattern || pattern.test(e.message)), message);

  const conversation = async ({ ownerUser = null, workspace = null, project = null }) => (await pool.query(
    `INSERT INTO chat_conversations(user_id, owner_user_id, workspace_id, project_id) VALUES($1,$2,$3,$4) RETURNING id`,
    [ownerUser ?? sender, ownerUser, workspace, project])).rows[0].id;
  const messages = async (conversationId, texts) => {
    const ids = [];
    for (const [i, content] of texts.entries()) {
      ids.push((await pool.query(`INSERT INTO chat_messages(conversation_id, user_id, role, content, message_index)
        VALUES($1,$2,$3,$4,$5) RETURNING id`, [conversationId, sender, i % 2 ? 'assistant' : 'user', content, i])).rows[0].id);
    }
    return ids;
  };
  const offer = ({ disclosed = [], audience = [], sourceWorkspace = company } = {}) => pool.query(
    `INSERT INTO workforce_handoffs(source_principal_id, target_principal_id, work_ref_type, work_ref_id,
       source_workspace_id, target_workspace_id, disclosed_message_ids, disclosure_audience)
     VALUES($1,$2,'task',$3,$4,$4,$5::uuid[],$6::uuid[]) RETURNING *`,
    [sender, target, randomUUID(), sourceWorkspace, disclosed, audience]);
  const accept = (id) => pool.query(`UPDATE workforce_handoffs SET state='accepted', accepted_at=now(), payer_account_id=$2,
    revision=revision+1 WHERE id=$1 RETURNING *`, [id, target]);
  const resolve = (id, state) => pool.query(`UPDATE workforce_handoffs SET state=$2, resolved_at=now(), revision=revision+1
    WHERE id=$1`, [id, state]);
  const manifest = async (id) => (await pool.query('SELECT * FROM workforce_handoff_disclosure_manifest($1)', [id])).rows;
  const history = async (id, reader) => (await pool.query('SELECT * FROM workforce_handoff_disclosed_history($1,$2)', [id, reader])).rows;

  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
    // The chat tables as the chat migrations leave them: a conversation has exactly one scope.
    await pool.query(`CREATE TABLE users(id UUID PRIMARY KEY);
      CREATE TABLE api_keys(id UUID PRIMARY KEY, user_id UUID REFERENCES users(id));
      CREATE TABLE chat_projects(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID, owner_user_id UUID REFERENCES users(id),
        workspace_id UUID, name TEXT NOT NULL DEFAULT 'p', is_archived BOOLEAN NOT NULL DEFAULT false,
        CHECK ((owner_user_id IS NULL) <> (workspace_id IS NULL)));
      CREATE TABLE chat_conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID, owner_user_id UUID REFERENCES users(id),
        workspace_id UUID, project_id UUID REFERENCES chat_projects(id), title TEXT NOT NULL DEFAULT 'New Chat',
        CHECK (num_nonnulls(owner_user_id, project_id, workspace_id) = 1));
      CREATE TABLE chat_messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID NOT NULL REFERENCES chat_conversations(id),
        user_id UUID, role VARCHAR(20) NOT NULL, content TEXT NOT NULL, message_index INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT now())`);
    for (const id of [owner, sender, target, bystander, colleague, outsider]) await pool.query('INSERT INTO users VALUES($1)', [id]);
    const chain = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')
      && (/workforce/.test(f) || f === '20260711120000-workspaces.sql')).sort().filter((f) => f !== THIS);
    for (const f of chain) await pool.query((await readFile(new URL(f, MIGRATIONS), 'utf8')).split('-- DOWN')[0]);
    await pool.query(`INSERT INTO workspaces(id,owner_user_id,name,slug) VALUES($1,$2,'Company','company'),($3,$2,'Other','other')`,
      [company, owner, otherCompany]);
    const [up, down] = (await readFile(new URL(THIS, MIGRATIONS), 'utf8')).split('-- DOWN');
    await pool.query(up); await pool.query(down); await pool.query(up);

    // The sender's private transcript: four messages, two of which it chooses to hand on.
    const privateChat = await conversation({ ownerUser: sender });
    const [m1, m2, secret1, secret2] = await messages(privateChat, ['the brief', 'draft plan', 'salary talk', 'personal note']);

    await t.test('a handoff that declares nothing discloses nothing, even once accepted', async () => {
      const h = (await offer()).rows[0];
      assert.deepEqual(h.disclosed_message_ids, []);
      assert.deepEqual(h.disclosure_audience, []);
      await accept(h.id);
      assert.deepEqual(await manifest(h.id), []);
      assert.deepEqual(await history(h.id, target), [], 'silence discloses nothing');
    });

    await t.test('the offer shows its audience and the included history before anyone agrees', async () => {
      const h = (await offer({ disclosed: [m1, m2], audience: [target] })).rows[0];
      assert.deepEqual(h.disclosure_audience, [target], 'the audience is on the offer for the target to read');
      const shown = await manifest(h.id);
      assert.deepEqual(shown.map((r) => r.message_id), [m1, m2], 'the manifest lists exactly the included messages');
      assert.deepEqual(shown.map((r) => r.role), ['user', 'assistant']);
      assert.ok(shown.every((r) => r.conversation_id === privateChat && !('content' in r)),
        'the manifest names the source conversation and carries no content');
      assert.deepEqual(await history(h.id, target), [], 'an offered handoff discloses nothing yet');
    });

    await t.test('once accepted: exactly the declared messages, exactly to the declared audience', async () => {
      const h = (await offer({ disclosed: [m1, m2], audience: [target, colleague] })).rows[0];
      await accept(h.id);
      const read = await history(h.id, target);
      assert.deepEqual(read.map((r) => r.content), ['the brief', 'draft plan'],
        'only the declared messages cross, never the rest of the transcript');
      assert.ok(!read.some((r) => [secret1, secret2].includes(r.message_id)));
      assert.deepEqual((await history(h.id, colleague)).length, 2, 'a declared wider audience reads what was declared');
      assert.deepEqual(await history(h.id, bystander), [], 'a reader outside the declared audience reads nothing');
      assert.deepEqual(await history(h.id, sender), [], 'even the sender reads through a handoff only if it declared itself');
    });

    await t.test('a declined or expired handoff discloses nothing to its audience', async () => {
      for (const state of ['declined', 'expired']) {
        const h = (await offer({ disclosed: [m1], audience: [target] })).rows[0];
        await resolve(h.id, state);
        assert.deepEqual(await history(h.id, target), [], `a ${state} handoff discloses nothing`);
        assert.equal((await manifest(h.id)).length, 1, 'what WAS offered stays visible as a record');
      }
    });

    await t.test('only history the sender may disclose: its own, or its source workspace\'s', async () => {
      const [ownerPrivate] = await messages(await conversation({ ownerUser: outsider }), ['someone else']);
      await refuse(offer({ disclosed: [ownerPrivate], audience: [target] }), /only its own transcript/,
        "another person's private transcript is not the sender's to disclose");

      const [wsMsg] = await messages(await conversation({ workspace: company }), ['team thread']);
      assert.equal((await offer({ disclosed: [wsMsg], audience: [target] })).rowCount, 1, 'the source workspace\'s history may go');
      const [otherWsMsg] = await messages(await conversation({ workspace: otherCompany }), ['their thread']);
      await refuse(offer({ disclosed: [otherWsMsg], audience: [target] }), /only its own transcript/,
        "another workspace's history is not the sender's to disclose");

      const companyProject = (await pool.query(`INSERT INTO chat_projects(workspace_id) VALUES($1) RETURNING id`, [company])).rows[0].id;
      const elsewhereProject = (await pool.query(`INSERT INTO chat_projects(workspace_id) VALUES($1) RETURNING id`, [otherCompany])).rows[0].id;
      const [projMsg] = await messages(await conversation({ project: companyProject }), ['project note']);
      assert.equal((await offer({ disclosed: [projMsg], audience: [target] })).rowCount, 1, 'a source-workspace project may go');
      const [elsewhereMsg] = await messages(await conversation({ project: elsewhereProject }), ['foreign project']);
      await refuse(offer({ disclosed: [elsewhereMsg], audience: [target] }), /only its own transcript/,
        'a project owned elsewhere is not the sender\'s to disclose');

      await refuse(offer({ disclosed: [randomUUID()], audience: [target] }), /messages that exist/, 'a declared message must exist');
      await refuse(offer({ disclosed: [m1, m1], audience: [target] }), /once/, 'each message is declared once');
      await refuse(offer({ disclosed: [m1], audience: [target, randomUUID()] }), /real principals/, 'the audience names real principals');
    });

    await t.test('the disclosure is fixed at the offer and must reach the target', async () => {
      await refuse(offer({ disclosed: [m1], audience: [colleague] }), /reaches_target/,
        'a disclosure must reach the principal doing the work');
      const h = (await offer({ disclosed: [m1], audience: [target] })).rows[0];
      await refuse(pool.query(`UPDATE workforce_handoffs SET disclosure_audience=disclosure_audience||$2::uuid, revision=revision+1 WHERE id=$1`,
        [h.id, bystander]), /immutable/, 'the audience cannot be widened after the offer');
      await refuse(pool.query(`UPDATE workforce_handoffs SET disclosed_message_ids=disclosed_message_ids||$2::uuid, revision=revision+1 WHERE id=$1`,
        [h.id, secret1]), /immutable/, 'no message can be added after the target looked');
      await accept(h.id);
      assert.deepEqual((await history(h.id, target)).map((r) => r.message_id), [m1], 'what was accepted is what is read');
      await refuse(pool.query(down), /rollback refused/, 'declared disclosures are retained');
    });
  } finally {
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
