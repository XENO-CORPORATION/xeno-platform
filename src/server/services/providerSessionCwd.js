// SES-02: provider cwd for directory-less chat.
//
// Chat never requires a directory selection: conversations carry nullable
// project_id/workspace_id, and personal chats bind neither. When a provider
// needs a cwd anyway, the host -- not the client -- supplies isolated
// session storage: a deterministic directory under a host-owned session root,
// recorded with the scope label 'session-isolated'. This resolver refuses
// bound conversations outright: a project root is an explicit authorized
// grant (SES-03) and the session path must never shadow, widen, or stand in
// for one. There is no code path here that can return a project directory.
//
// NOTE: proven standalone with Postgres + filesystem. Adoption into provider
// execution call sites (remote runner, TUI spawns) is the rollout step that
// follows; those call sites currently accept client-supplied cwd and are
// tracked separately, not silently fixed by this change.
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const uuid = (value) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) bad('bad_input', 'invalid_id');
  return value;
};

function sessionRootChecked(root) {
  if (typeof root !== 'string' || !root || !path.isAbsolute(root)) bad('bad_input', 'invalid_session_root');
  let st;
  try {
    st = statSync(root);
  } catch {
    bad('bad_input', 'invalid_session_root');
  }
  if (!st.isDirectory()) bad('bad_input', 'invalid_session_root');
  return root;
}

async function withClient(poolOrClient, fn) {
  if (typeof poolOrClient.connect === 'function') {
    const client = await poolOrClient.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }
  return fn(poolOrClient);
}

/**
 * Resolve (creating on first use) the isolated session cwd for a
 * directory-less conversation. Returns { path, scope, conversationId } with
 * scope always 'session-isolated'. Refuses bound or missing conversations.
 */
export async function resolveProviderCwd(poolOrClient, { conversationId, sessionRoot }) {
  const id = uuid(conversationId);
  const root = sessionRootChecked(sessionRoot);
  return withClient(poolOrClient, async (client) => {
    const conv = (await client.query(
      'SELECT id, project_id, workspace_id FROM chat_conversations WHERE id=$1',
      [id],
    )).rows[0];
    if (!conv) bad('not_found', 'conversation_not_found');
    if (conv.project_id !== null || conv.workspace_id !== null) bad('denied', 'project_root_bound');
    const dir = path.join(root, `xeno-session-${id}`);
    mkdirSync(dir, { recursive: true });
    const row = (await client.query(
      `INSERT INTO provider_session_workdirs(conversation_id, path, scope) VALUES($1,$2,'session-isolated')
       ON CONFLICT (conversation_id) DO UPDATE SET conversation_id=provider_session_workdirs.conversation_id
       RETURNING path, scope`,
      [id, dir],
    )).rows[0];
    return { path: row.path, scope: row.scope, conversationId: id };
  });
}
