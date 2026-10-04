// VIEW-05: scope-bound query keys and revisions fence stale reads,
// optimistic mutations and subscription polls. Every read names its
// (scope, key); every write bumps that key's revision. A response carrying
// an older revision than current is STALE -- even when the content compares
// equal (the A->B->A fence) -- and carries no rows, so a stale snapshot can
// never be silently applied.
//
// The six view states are distinct outcomes of one read path: loading (the
// reader handle before its first read resolves), unavailable (the read did
// not complete for reasons outside the domain -- e.g. transport failure),
// denied, empty, stale and archived. A seventh, fresh, carries rows at the
// current revision. Nothing here invents data: keys map to real tables
// (conversation lists, message lists), scopes to real authorization.
import { check } from '../utils/authzReBAC.js';

const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseScope(scope) {
  if (typeof scope !== 'string') bad('bad_input', 'invalid_scope');
  const m = /^(personal|project):(.+)$/.exec(scope);
  if (!m || !UUID.test(m[2])) bad('bad_input', 'invalid_scope');
  return { kind: m[1], id: m[2] };
}

function parseKey(key) {
  if (key === 'conversations') return { kind: 'conversations' };
  const m = /^messages:(.+)$/.exec(typeof key === 'string' ? key : '');
  if (m && UUID.test(m[1])) return { kind: 'messages', conversationId: m[1] };
  bad('bad_input', 'unknown_key');
}

async function holdsProject(client, userId, projectId) {
  for (const relation of ['owner', 'editor']) {
    if ((await check(client, { object: `project:${projectId}`, relation, subject: `user:${userId}` })).allowed) return true;
  }
  return false;
}

async function withTx(poolOrClient, fn) {
  if (typeof poolOrClient.connect === 'function') {
    const client = await poolOrClient.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return fn(poolOrClient);
}

async function currentRevision(client, scope, key) {
  await client.query(
    `INSERT INTO scoped_read_revisions(scope, key, revision) VALUES($1,$2,0) ON CONFLICT (scope, key) DO NOTHING`,
    [scope, key],
  );
  return Number((await client.query(
    'SELECT revision FROM scoped_read_revisions WHERE scope=$1 AND key=$2', [scope, key])).rows[0].revision);
}

async function bumpRevision(client, scope, key) {
  return Number((await client.query(
    `INSERT INTO scoped_read_revisions(scope, key, revision) VALUES($1,$2,1)
     ON CONFLICT (scope, key) DO UPDATE SET revision = scoped_read_revisions.revision + 1, updated_at = now()
     RETURNING revision`,
    [scope, key],
  )).rows[0].revision);
}

/** Authorize a scope read. Returns null when allowed, else the denial state. */
async function authorizeScope(client, parsed, actor) {
  if (parsed.kind === 'personal') {
    return parsed.id === actor ? null : { state: 'denied' };
  }
  const project = (await client.query('SELECT id, is_archived FROM chat_projects WHERE id=$1', [parsed.id])).rows[0];
  if (!project) return { state: 'denied' };
  if (project.is_archived) return { state: 'archived' };
  return (await holdsProject(client, actor, parsed.id)) ? null : { state: 'denied' };
}

async function readRows(client, parsedScope, parsedKey) {
  if (parsedKey.kind === 'conversations') {
    const column = parsedScope.kind === 'personal' ? 'owner_user_id' : 'project_id';
    return (await client.query(
      `SELECT id, title, mode FROM chat_conversations WHERE ${column}=$1 ORDER BY updated_at DESC, id`,
      [parsedScope.id],
    )).rows;
  }
  const conv = (await client.query(
    'SELECT id, owner_user_id, project_id FROM chat_conversations WHERE id=$1', [parsedKey.conversationId])).rows[0];
  if (!conv) return null;
  const member = parsedScope.kind === 'personal'
    ? conv.owner_user_id === parsedScope.id
    : conv.project_id === parsedScope.id;
  if (!member) return null;
  return (await client.query(
    'SELECT message_index, role, content FROM chat_messages WHERE conversation_id=$1 ORDER BY message_index',
    [parsedKey.conversationId],
  )).rows;
}

/**
 * Read a scoped key. knownRevision fences A->B->A: when provided and behind
 * the current revision the result is stale WITHOUT rows.
 */
export async function readScoped(poolOrClient, { scope, key, actorUserId, knownRevision }) {
  const parsedScope = parseScope(scope);
  const parsedKey = parseKey(key);
  if (typeof actorUserId !== 'string' || !UUID.test(actorUserId)) bad('bad_input', 'invalid_actor');
  if (knownRevision !== undefined && (!Number.isInteger(knownRevision) || knownRevision < 0)) {
    bad('bad_input', 'invalid_revision');
  }
  try {
    return await withTx(poolOrClient, async (client) => {
      const denial = await authorizeScope(client, parsedScope, actorUserId);
      if (denial) return denial.state === 'archived'
        ? { state: 'archived', revision: await currentRevision(client, scope, key) }
        : { state: 'denied' };
      const revision = await currentRevision(client, scope, key);
      if (knownRevision !== undefined && knownRevision < revision) return { state: 'stale', revision };
      const rows = await readRows(client, parsedScope, parsedKey);
      if (rows === null) return { state: 'denied' };
      if (rows.length === 0) return { state: 'empty', revision };
      return { state: 'fresh', revision, rows };
    });
  } catch (error) {
    if (error && typeof error.code === 'string' && ['bad_input', 'denied', 'conflict', 'not_found'].includes(error.code)) throw error;
    return { state: 'unavailable' };
  }
}

/**
 * Optimistic scoped mutation. The write callback runs inside the revision
 * transaction; a behind expectedRevision refuses WITHOUT running it.
 */
export async function mutateScoped(poolOrClient, { scope, key, actorUserId, expectedRevision, write }) {
  const parsedScope = parseScope(scope);
  const parsedKey = parseKey(key);
  void parsedKey;
  if (typeof actorUserId !== 'string' || !UUID.test(actorUserId)) bad('bad_input', 'invalid_actor');
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) bad('bad_input', 'invalid_revision');
  if (typeof write !== 'function') bad('bad_input', 'invalid_write');
  return withTx(poolOrClient, async (client) => {
    const denial = await authorizeScope(client, parsedScope, actorUserId);
    if (denial) bad('denied', denial.state === 'archived' ? 'scope_archived' : 'mutation_not_authorized');
    const revision = await currentRevision(client, scope, key);
    if (expectedRevision < revision) return { state: 'stale', revision, applied: false };
    const result = await write(client);
    const next = await bumpRevision(client, scope, key);
    return { state: 'fresh', revision: next, applied: true, result };
  });
}

/** Subscription fencing without sockets: learn exactly whether fromRevision is behind. */
export async function pollScoped(poolOrClient, { scope, key, actorUserId, fromRevision }) {
  const parsedScope = parseScope(scope);
  parseKey(key);
  if (typeof actorUserId !== 'string' || !UUID.test(actorUserId)) bad('bad_input', 'invalid_actor');
  if (!Number.isInteger(fromRevision) || fromRevision < 0) bad('bad_input', 'invalid_revision');
  return withTx(poolOrClient, async (client) => {
    const denial = await authorizeScope(client, parsedScope, actorUserId);
    if (denial) return denial.state === 'archived'
      ? { state: 'archived', changed: true, revision: await currentRevision(client, scope, key) }
      : { state: 'denied', changed: false };
    const revision = await currentRevision(client, scope, key);
    const changed = fromRevision !== revision;
    return { state: changed ? 'stale' : 'fresh', changed, revision };
  });
}

/** UI-facing reader handle: observably 'loading' until the first read resolves. */
export function createScopedReader(poolOrClient, args) {
  const reader = { state: 'loading', result: null };
  reader.done = readScoped(poolOrClient, args).then(
    (result) => { reader.state = result.state; reader.result = result; return result; },
    (error) => {
      if (!error || typeof error.code !== 'string') {
        reader.state = 'unavailable';
        reader.result = { state: 'unavailable' };
        return reader.result;
      }
      throw error;
    },
  );
  return reader;
}
