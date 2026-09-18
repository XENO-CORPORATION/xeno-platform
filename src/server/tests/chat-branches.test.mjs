/**
 * Chat branches, end to end against a real Postgres and the REAL chat router.
 *
 * The defect (production, 2026-09-18): editing a message only changed it on screen; the resend
 * appended a new assistant reply to the flat list, the edited text was never saved and the old
 * reply never retired — after a reload the original message had two answers under it.
 *
 * The model now (ChatGPT's and Claude's): a tree. An edit is a SIBLING under the edited message's
 * parent with its own reply chain; a regenerate is a sibling reply under the same user message;
 * the conversation remembers the leaf the person is on; GET returns the active path as `messages`
 * and every row as `branches`; a share exposes the active path only; deleting a branch's node
 * cascades its subtree and never leaves the leaf dangling.
 *
 *   node src/server/tests/chat-branches.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import chatRoutes from '../routes/chatRoutes.js';
import { runAllMigrations } from '../services/migrationRunner.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  await runAllMigrations(pool);
  const marker = `branches-${Date.now()}`;
  const userId = (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`,
    [marker, `${marker}@example.test`],
  )).rows[0].id;

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { req.db = pool; req.user = { id: userId }; next(); });
  app.use('/api/chat', chatRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/chat`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };
  const ids = (list) => list.map((m) => m.id);
  let passed = 0;
  const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };

  try {
    // ── a straight thread: u1 → a1 → u2 → a2 ────────────────────────────────────────────
    const conv = (await call('POST', '/conversations', { title: 'branches', model_id: 'grok-4.6' })).json.conversation;
    const u1 = (await call('POST', `/conversations/${conv.id}/messages`, { role: 'user', content: 'hello' })).json.message;
    const a1 = (await call('POST', `/conversations/${conv.id}/messages`, { role: 'assistant', content: 'Hello. What can I help with?' })).json.message;
    const u2 = (await call('POST', `/conversations/${conv.id}/messages`, { role: 'user', content: 'tell me about gaming' })).json.message;
    const a2 = (await call('POST', `/conversations/${conv.id}/messages`, { role: 'assistant', content: 'Gaming, take one.' })).json.message;
    check(u1.parent_id === null && a1.parent_id === u1.id && u2.parent_id === a1.id && a2.parent_id === u2.id, 'a normal send follows the leaf: each message hangs off the one before');
    let got = (await call('GET', `/conversations/${conv.id}`)).json.conversation;
    check(got.active_leaf_id === a2.id, 'the newest message is the leaf');
    check(ids(got.messages).join(',') === [u1, a1, u2, a2].map((m) => m.id).join(','), 'GET returns the path root → leaf as `messages`');

    // ── EDIT u2 → a sibling u2' under a1, with its own reply ─────────────────────────────
    const u2b = (await call('POST', `/conversations/${conv.id}/messages`, { role: 'user', content: 'tell me about ESPORTS', parent_id: a1.id })).json.message;
    check(u2b.parent_id === a1.id, 'the edited version hangs off the SAME parent as the original — a sibling');
    const a2b = (await call('POST', `/conversations/${conv.id}/messages`, { role: 'assistant', content: 'Esports, take one.' })).json.message;
    check(a2b.parent_id === u2b.id, 'the reply that follows hangs off the edited version (the leaf moved to it)');
    got = (await call('GET', `/conversations/${conv.id}`)).json.conversation;
    check(ids(got.messages).join(',') === [u1, a1, u2b, a2b].map((m) => m.id).join(','), 'after the edit the thread shown is the NEW version and its reply — not the old text with two answers');
    check(got.branches.length === 6, 'and every row of every branch is still there');
    check(got.branches.some((m) => m.id === u2.id && m.content === 'tell me about gaming'), 'the original version is untouched');

    // ── REGENERATE a1 → a sibling reply under u1 ─────────────────────────────────────────
    const a1b = (await call('POST', `/conversations/${conv.id}/messages`, { role: 'assistant', content: 'Hi there — what shall we do?', parent_id: u1.id })).json.message;
    check(a1b.parent_id === u1.id, 'a regenerated reply is a sibling under the user message it answers');
    got = (await call('GET', `/conversations/${conv.id}`)).json.conversation;
    check(ids(got.messages).join(',') === [u1.id, a1b.id].join(','), 'the thread shown is now the regenerated branch (its own, empty-so-far chain)');

    // ── SWITCH back to the first reply: lands on its newest chain (the edited one) ───────
    const sw = (await call('PUT', `/conversations/${conv.id}/active-leaf`, { message_id: a1.id })).json;
    check(sw.success && sw.active_leaf_id === a2b.id, 'switching to a1 lands on the newest reply chain beneath it (the edit)');
    got = (await call('GET', `/conversations/${conv.id}`)).json.conversation;
    check(ids(got.messages).join(',') === [u1, a1, u2b, a2b].map((m) => m.id).join(','), 'and a reload shows that branch');
    const sw2 = (await call('PUT', `/conversations/${conv.id}/active-leaf`, { message_id: u2.id })).json;
    check(sw2.active_leaf_id === a2.id, 'switching to the ORIGINAL version lands on its reply');
    got = (await call('GET', `/conversations/${conv.id}`)).json.conversation;
    check(ids(got.messages).join(',') === [u1, a1, u2, a2].map((m) => m.id).join(','), 'the original thread is fully recoverable');

    // ── refusals ────────────────────────────────────────────────────────────────────────
    const bad = await call('POST', `/conversations/${conv.id}/messages`, { role: 'user', content: 'x', parent_id: '00000000-0000-4000-8000-000000000000' });
    check(bad.status === 400 && bad.json.code === 'invalid_parent', 'a parent from another conversation (or nowhere) is refused, not silently re-rooted');
    const badLeaf = await call('PUT', `/conversations/${conv.id}/active-leaf`, { message_id: '00000000-0000-4000-8000-000000000000' });
    check(badLeaf.status === 404, 'switching to a message not in the conversation is refused');

    // ── a batch chains, and hangs off the given parent ───────────────────────────────────
    const batch = (await call('POST', `/conversations/${conv.id}/messages/batch`, { parent_id: a2.id, messages: [{ role: 'user', content: 'and PC?' }, { role: 'assistant', content: 'PC, take one.' }] })).json.messages;
    check(batch[0].parent_id === a2.id && batch[1].parent_id === batch[0].id, 'a batch is one chain hanging off the requested parent');
    got = (await call('GET', `/conversations/${conv.id}`)).json.conversation;
    check(got.active_leaf_id === batch[1].id, 'and its last message is the leaf');

    // ── delete the leaf's subtree: the leaf lands on the parent, never dangles ───────────
    const del = await call('DELETE', `/messages/${batch[0].id}`);
    check(del.status === 200, 'deleting a message succeeds');
    got = (await call('GET', `/conversations/${conv.id}`)).json.conversation;
    check(!got.branches.some((m) => m.id === batch[1].id), 'its reply went with it (the subtree cascades)');
    check(got.active_leaf_id === a2.id, 'the leaf moved to the deleted node\'s parent');

    // ── share: the active branch only ────────────────────────────────────────────────────
    const { serializePublicConversationMessages } = await import('../routes/chatRoutes.js');
    const { activePath } = await import('../utils/chatBranches.js');
    const rows = (await pool.query('SELECT id, role, content, model_id, created_at, message_index, parent_id FROM chat_messages WHERE conversation_id = $1', [conv.id])).rows;
    const shared = serializePublicConversationMessages(activePath(rows, got.active_leaf_id));
    check(ids(shared).join(',') === [u1, a1, u2, a2].map((m) => m.id).join(','), 'what is shared is the branch the owner is on — never an edited-away version');

    console.log(`\n${passed} checks passed`);
  } finally {
    server.close();
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
