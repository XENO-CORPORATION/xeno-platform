/**
 * The message tree (utils/chatBranches.js): an edit or a regenerate is a sibling branch, never an
 * overwrite. These pin the path a client is shown, where a branch switch lands, and the sibling
 * set a ‹ i/n › control moves between — the pure half of chat-message-branches (2026-09-18).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { activePath, deepestLeafUnder, newestOf, siblingsOf } from '../src/server/utils/chatBranches.js';

const t0 = Date.parse('2026-09-18T10:00:00Z');
const row = (id, parent, role, index) => ({ id, parent_id: parent, role, message_index: index, created_at: new Date(t0 + index * 1000).toISOString() });
// u1 ─ a1 ─ u2 ─ a2            (the original thread)
//            └ u2' ─ a2'       (u2 edited → sibling u2', its own reply)
//       └ a1'                  (a1 regenerated)
const rows = [
  row('u1', null, 'user', 0), row('a1', 'u1', 'assistant', 1), row('u2', 'a1', 'user', 2), row('a2', 'u2', 'assistant', 3),
  row('u2b', 'a1', 'user', 4), row('a2b', 'u2b', 'assistant', 5),
  row('a1b', 'u1', 'assistant', 6),
];
const ids = (list) => list.map((r) => r.id);

test('the active path is root → leaf in reading order, and only that branch', () => {
  assert.deepEqual(ids(activePath(rows, 'a2b')), ['u1', 'a1', 'u2b', 'a2b']);
  assert.deepEqual(ids(activePath(rows, 'a2')), ['u1', 'a1', 'u2', 'a2']);
  assert.deepEqual(ids(activePath(rows, 'a1b')), ['u1', 'a1b']);
});

test('an unknown or missing leaf falls back to the newest message — a pre-migration row is never unreachable', () => {
  assert.deepEqual(ids(activePath(rows, null)), ['u1', 'a1b']);
  assert.deepEqual(ids(activePath(rows, 'nope')), ['u1', 'a1b']);
  assert.equal(newestOf(rows).id, 'a1b');
  assert.deepEqual(activePath([], 'x'), []);
});

test('a branch switch lands on the newest reply chain beneath the chosen version', () => {
  assert.equal(deepestLeafUnder(rows, 'u2'), 'a2');
  assert.equal(deepestLeafUnder(rows, 'u2b'), 'a2b');
  assert.equal(deepestLeafUnder(rows, 'a1'), 'a2b', 'under a1 the newest chain is the edited one');
  assert.equal(deepestLeafUnder(rows, 'a1b'), 'a1b', 'a leaf is its own landing');
});

test('siblings are the versions a ‹ i/n › control moves between: same parent, same role, creation order', () => {
  assert.deepEqual(ids(siblingsOf(rows, 'u2b')), ['u2', 'u2b'], 'the edited message and its original');
  assert.deepEqual(ids(siblingsOf(rows, 'a1')), ['a1', 'a1b'], 'the reply and its regenerate');
  assert.deepEqual(ids(siblingsOf(rows, 'u1')), ['u1'], 'the root alone');
  assert.deepEqual(siblingsOf(rows, 'ghost'), []);
});

test('the migration chains existing rows into one straight branch and picks the last as the leaf', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../src/server/database/migrations/20260918210000-chat-message-branches.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES chat_messages\(id\) ON DELETE CASCADE/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS active_leaf_id UUID/);
  assert.match(sql, /LAG\(id\) OVER \(PARTITION BY conversation_id ORDER BY message_index, created_at\)/, 'each row follows the one before it');
  assert.match(sql, /WHERE m\.id = p\.id AND m\.parent_id IS NULL/, 'and never rewrites a parent already set');
  assert.match(sql, /DISTINCT ON \(conversation_id\)[\s\S]*ORDER BY conversation_id, message_index DESC/, 'the leaf is the last message');
});

// ── reachability: the tree is only a fix if every write goes through it ──────────────────────
// Each check names the wiring that, removed, reproduces the production defect (an edit shown
// on screen and not saved; a regenerate appended beside its predecessor instead of as a sibling).
const src = async (rel) => (await import('node:fs')).readFileSync(new URL(rel, import.meta.url), 'utf8');

test('client: an EDIT persists as a sibling under the edited message\'s parent, and the reply follows it', async () => {
  const chat = await src('../src/components/playground/Chat/ChatWithLLM.tsx');
  const edit = chat.slice(chat.indexOf('const handleSaveEdit'), chat.indexOf('const handleCancelEdit'));
  assert.match(edit, /chatService\.addMessage\(conversationId, \{[\s\S]*?parent_id: newVersion\.parentDbId \?\? null,/, 'the edited version is saved as a sibling (same parent as the original)');
  assert.match(edit, /rememberPersisted\(newVersion\.id, persisted\)/, 'and its db id is remembered so the reply hangs off it');
  assert.match(edit, /await fetchAiResponse\(truncatedHistory/, 'then a fresh reply is requested on the new branch');
});

test('client: an assistant reply persists under the user message it answers (a regenerate = a sibling reply)', async () => {
  const chat = await src('../src/components/playground/Chat/ChatWithLLM.tsx');
  assert.match(chat, /const answeredDbId = dbIdOf\(answered\);[\s\S]{0,900}\.\.\.\(answeredDbId \? \{ parent_id: answeredDbId \} : \{\}\),/, 'the assistant persist names its parent');
});

test('client: the ‹ i/n › control is on BOTH bubbles and a switch goes through the server, then re-derives the path', async () => {
  const chat = await src('../src/components/playground/Chat/ChatWithLLM.tsx');
  assert.equal((chat.match(/\{renderBranchControl\(message\)\}/g) || []).length, 2, 'user bubble and assistant bubble');
  const sw = chat.slice(chat.indexOf('const switchBranch = useCallback'), chat.indexOf('const renderBranchControl'));
  assert.match(sw, /chatService\.setActiveLeaf\(conversationId, siblingDbId\)/, 'the server records the leaf — a reload agrees');
  assert.match(sw, /branchActivePath\(rows, result\.active_leaf_id\)/, 'the thread shown is derived from the rows, root → leaf');
  assert.match(sw, /setMessages\(path\.map\(dbMessageToLocal\)\)/);
  const ctl = chat.slice(chat.indexOf('const renderBranchControl'), chat.indexOf('// --- Event Delegation Handlers'));
  assert.match(ctl, /if \(info\.total < 2\) return null;/, 'a single version shows no control');
  assert.match(ctl, /data-branch-nav=/);
  const load = chat.match(/setBranchRows\(asBranchRows\(fullConversation\.branches \?\? fullConversation\.messages\)\)/);
  assert.ok(load, 'loading a conversation keeps every branch, not just the active path');
});

test('service: the client can name a parent on a single message, on a batch, and switch the leaf', async () => {
  const svc = await src('../src/services/chatService.ts');
  assert.match(svc, /parent_id\?: string \| null;/);
  assert.match(svc, /async setActiveLeaf\(conversationId: string, messageId: string\)/);
  assert.match(svc, /`\$\{API_BASE\}\/conversations\/\$\{conversationId\}\/active-leaf`/);
  assert.match(svc, /options\.parent_id !== undefined \? \{ parent_id: options\.parent_id \} : \{\}/, 'a batch can hang off a given parent');
});

test('routes: every insert resolves its parent; GET returns the active path AND every branch; delete repairs the leaf; a share exposes the active path only', async () => {
  const routes = await src('../src/server/routes/chatRoutes.js');
  assert.match(routes, /router\.put\('\/conversations\/:id\/active-leaf'/);
  assert.match(routes, /const leafId = deepestLeafUnder\(rows, message_id\);/, 'a switch lands on the newest chain beneath the chosen message');
  assert.equal((routes.match(/await resolveParentForInsert\(/g) || []).length, 2, 'single insert and batch both resolve the parent');
  assert.match(routes, /messages: path,\s*branches: allRows,?/s, 'GET returns both');
  assert.match(routes, /active_leaf_id: leafId,/);
  assert.match(routes, /DELETE FROM chat_messages WHERE id = \$1 RETURNING id, parent_id, conversation_id/);
  assert.match(routes, /const fallback = gone\.parent_id/, 'the leaf moves to the deleted node\'s parent');
  assert.equal((routes.match(/serializePublicConversationMessages\(activePath\(messagesResult\.rows, sharedLeaf\)\)/g) || []).length, 2, 'both share readers walk the branch the owner is on');
});

test('worker: a scheduled run lands ON the thread (parent = the active leaf) and moves the leaf', async () => {
  const worker = await src('../src/server/workers/chatScheduledWorker.js');
  assert.match(worker, /SELECT active_leaf_id FROM chat_conversations WHERE id = \$1/);
  assert.match(worker, /\[conversationId, task\.run_as_user_id, task\.prompt, task\.model_id, nextIndex, run\.id, parentId\]/);
  assert.match(worker, /\[conversationId, task\.run_as_user_id, assistantText, task\.model_id, nextIndex \+ 1, run\.id, userMessageId\]/);
  assert.match(worker, /UPDATE chat_conversations SET active_leaf_id = \$2 WHERE id = \$1/);
});
