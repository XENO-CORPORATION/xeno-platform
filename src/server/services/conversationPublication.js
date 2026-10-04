import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { check } from '../utils/authzReBAC.js';

// PUB-11: a public conversation is not a public transcript. The
// default surface is owner-selected updates — excerpts the owner
// picks, never the live log. Full transcript or full live publication
// names an explicit inclusion scope and publishes only with every
// participant's consent to that exact scope; a withdrawn consent
// downgrades the surface back to updates at once. Public artifact
// links carry their own state plus expiry and purge retention, fully
// independent of any conversation publication.
const FULL_MODES = ['transcript', 'live_full'];

function isPool(poolOrClient) {
  return poolOrClient && typeof poolOrClient.totalCount === 'number';
}

async function withTx(poolOrClient, fn) {
  if (!isPool(poolOrClient)) return fn(poolOrClient);
  const client = await poolOrClient.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function conversationOwner(executor, conversationId) {
  const { rows } = await executor.query(
    `SELECT owner_user_id FROM chat_conversations WHERE id = $1 AND deleted_at IS NULL`,
    [conversationId],
  );
  if (rows.length === 0) throw new Error('Conversation not found');
  return rows[0].owner_user_id;
}

async function isConversationAdmin(executor, conversationId, actorUserId) {
  const owner = await conversationOwner(executor, conversationId);
  if (owner && String(owner) === String(actorUserId)) return true;
  const verdict = await check(executor, {
    object: `conversation:${conversationId}`,
    relation: 'admin',
    subject: `user:${actorUserId}`,
  });
  return verdict.allowed === true;
}

function notFound() {
  throw new Error('publication_not_found');
}

// Every voice in the room: the owner, every message author, every
// live participant. Full publication needs all of them.
async function participants(executor, conversationId) {
  const owner = await conversationOwner(executor, conversationId);
  const authors = (await executor.query(
    `SELECT DISTINCT COALESCE(created_by_user_id, user_id) AS id
       FROM chat_messages WHERE conversation_id = $1`,
    [conversationId],
  )).rows.map((r) => String(r.id));
  const live = (await executor.query(
    `SELECT DISTINCT user_id AS id FROM chat_live_participants
      WHERE conversation_id = $1 AND revoked_at IS NULL`,
    [conversationId],
  )).rows.map((r) => String(r.id));
  const voices = [...authors, ...live];
  if (owner !== null && owner !== undefined) voices.unshift(String(owner));
  return [...new Set(voices)];
}

function scopeHashOf(scope) {
  return crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex');
}

function checkedScope(mode, scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('full publication names an explicit scope');
  }
  const keys = Object.keys(scope);
  if (keys.length === 0 || keys.length > 12) throw new Error('full publication names an explicit scope');
  if (scope.includeMessages !== true) throw new Error('full publication includes messages explicitly');
  if (mode === 'live_full' && scope.includeEvents !== true) {
    throw new Error('live publication includes events explicitly');
  }
  return scope;
}

// The default surface: the owner picks messages and the public reads
// exactly those excerpts. Publishing updates over a full mode is an
// explicit owner downgrade; it clears the scope and its consents.
export async function publishSelectedUpdates(poolOrClient, { conversationId, actorUserId, messageIds }) {
  if (!conversationId) throw new Error('conversationId is required');
  if (!actorUserId) throw new Error('actorUserId is required');
  if (!Array.isArray(messageIds) || messageIds.length === 0 || messageIds.length > 50) {
    throw new Error('messageIds names one to fifty messages');
  }
  return withTx(poolOrClient, async (executor) => {
    if (!(await isConversationAdmin(executor, conversationId, actorUserId))) {
      throw new Error('publication_not_authorized');
    }
    const { rows } = await executor.query(
      `SELECT id, content FROM chat_messages WHERE conversation_id = $1 AND id = ANY($2::uuid[])
        ORDER BY message_index, created_at, id`,
      [conversationId, [...new Set(messageIds)]],
    );
    if (rows.length !== new Set(messageIds).size) throw new Error('updates reference own messages only');
    await executor.query(
      `INSERT INTO conversation_publications (conversation_id, mode, state, published_by_user_id, published_at)
        VALUES ($1, 'updates', 'published', $2, now())
        ON CONFLICT (conversation_id) DO UPDATE SET mode = 'updates', state = 'published',
          scope = NULL, scope_hash = NULL, published_by_user_id = $2, published_at = now(), revoked_at = NULL`,
      [conversationId, actorUserId],
    );
    await executor.query(`DELETE FROM publication_consents WHERE conversation_id = $1`, [conversationId]);
    await executor.query(`DELETE FROM conversation_publication_updates WHERE conversation_id = $1`, [conversationId]);
    for (const row of rows) {
      await executor.query(
        `INSERT INTO conversation_publication_updates (conversation_id, message_id, excerpt, published_by_user_id)
          VALUES ($1, $2, $3, $4)`,
        [conversationId, row.id, String(row.content ?? '').slice(0, 8000), actorUserId],
      );
    }
    return { conversationId, mode: 'updates', state: 'published', updateCount: rows.length };
  });
}

export async function readPublishedUpdates(poolOrClient, conversationId) {
  const pub = (await poolOrClient.query(
    `SELECT mode FROM conversation_publications WHERE conversation_id = $1 AND state = 'published'`,
    [conversationId],
  )).rows[0];
  if (!pub) notFound();
  const { rows } = await poolOrClient.query(
    `SELECT u.message_id AS "messageId", u.excerpt, u.created_at AS "createdAt"
       FROM conversation_publication_updates u
       LEFT JOIN chat_messages m ON m.id = u.message_id
      WHERE u.conversation_id = $1
      ORDER BY m.message_index NULLS LAST, u.created_at, u.id`,
    [conversationId],
  );
  return rows;
}

export async function requestFullPublication(poolOrClient, { conversationId, actorUserId, mode, scope }) {
  if (!FULL_MODES.includes(mode)) throw new Error('Unknown full-publication mode');
  const inclusion = checkedScope(mode, scope);
  return withTx(poolOrClient, async (executor) => {
    if (!(await isConversationAdmin(executor, conversationId, actorUserId))) {
      throw new Error('publication_not_authorized');
    }
    const hash = scopeHashOf(inclusion);
    await executor.query(
      `INSERT INTO conversation_publications (conversation_id, mode, state, scope, scope_hash, published_by_user_id)
        VALUES ($1, $2, 'pending', $3, $4, $5)
        ON CONFLICT (conversation_id) DO UPDATE SET mode = $2, state = 'pending',
          scope = $3, scope_hash = $4, published_by_user_id = $5,
          published_at = NULL, revoked_at = NULL`,
      [conversationId, mode, JSON.stringify(inclusion), hash, actorUserId],
    );
    // Stale consents linger under their old hash on purpose: coverage
    // matches the live hash, so a scope change invalidates them.
    return { conversationId, mode, state: 'pending', scopeHash: hash };
  });
}

export async function recordPublicationConsent(poolOrClient, { conversationId, userId, scopeHash }) {
  if (!conversationId) throw new Error('conversationId is required');
  if (!userId) throw new Error('userId is required');
  return withTx(poolOrClient, async (executor) => {
    const pub = (await executor.query(
      `SELECT scope_hash AS "scopeHash", state FROM conversation_publications WHERE conversation_id = $1 FOR UPDATE`,
      [conversationId],
    )).rows[0];
    if (!pub || pub.state !== 'pending') throw new Error('no_pending_publication');
    if (pub.scopeHash !== scopeHash) throw new Error('consent_scope_mismatch');
    if (!(await participants(executor, conversationId)).includes(String(userId))) {
      throw new Error('consent_not_a_participant');
    }
    await executor.query(
      `INSERT INTO publication_consents (conversation_id, user_id, scope_hash)
        VALUES ($1, $2, $3)
        ON CONFLICT (conversation_id, user_id) DO UPDATE SET scope_hash = $3, consented_at = now()`,
      [conversationId, userId, scopeHash],
    );
    return { conversationId, userId, scopeHash };
  });
}

// Who has not consented to the live scope hash. Empty means covered.
async function missingConsents(executor, conversationId, scopeHash) {
  const want = await participants(executor, conversationId);
  const have = new Set((await executor.query(
    `SELECT user_id AS id FROM publication_consents WHERE conversation_id = $1 AND scope_hash = $2`,
    [conversationId, scopeHash],
  )).rows.map((r) => String(r.id)));
  return want.filter((id) => !have.has(id));
}

export async function publishFullConversation(poolOrClient, { conversationId, actorUserId }) {
  return withTx(poolOrClient, async (executor) => {
    if (!(await isConversationAdmin(executor, conversationId, actorUserId))) {
      throw new Error('publication_not_authorized');
    }
    const pub = (await executor.query(
      `SELECT mode, state, scope_hash AS "scopeHash" FROM conversation_publications
        WHERE conversation_id = $1 FOR UPDATE`,
      [conversationId],
    )).rows[0];
    if (!pub || pub.state !== 'pending' || !FULL_MODES.includes(pub.mode)) {
      throw new Error('no_pending_publication');
    }
    const missing = await missingConsents(executor, conversationId, pub.scopeHash);
    if (missing.length > 0) {
      throw Object.assign(new Error('participant_consents_missing'), { missing });
    }
    await executor.query(
      `UPDATE conversation_publications SET state = 'published', published_at = now()
        WHERE conversation_id = $1`,
      [conversationId],
    );
    return { conversationId, mode: pub.mode, state: 'published' };
  });
}

// A withdrawn consent downgrades a live full surface back to updates
// at once; the default surface never needed consent and survives.
export async function withdrawPublicationConsent(poolOrClient, { conversationId, userId }) {
  return withTx(poolOrClient, async (executor) => {
    await executor.query(
      `DELETE FROM publication_consents WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    const pub = (await executor.query(
      `SELECT mode, state FROM conversation_publications WHERE conversation_id = $1 FOR UPDATE`,
      [conversationId],
    )).rows[0];
    if (pub && pub.state === 'published' && FULL_MODES.includes(pub.mode)) {
      await executor.query(
        `UPDATE conversation_publications SET mode = 'updates', scope = NULL, scope_hash = NULL
          WHERE conversation_id = $1`,
        [conversationId],
      );
      await executor.query(`DELETE FROM publication_consents WHERE conversation_id = $1`, [conversationId]);
      return { conversationId, mode: 'updates', state: 'published', downgraded: true };
    }
    return { conversationId, downgraded: false };
  });
}

export async function revokePublication(poolOrClient, { conversationId, actorUserId }) {
  return withTx(poolOrClient, async (executor) => {
    if (!(await isConversationAdmin(executor, conversationId, actorUserId))) {
      throw new Error('publication_not_authorized');
    }
    const { rowCount } = await executor.query(
      `UPDATE conversation_publications SET state = 'revoked', revoked_at = now() WHERE conversation_id = $1`,
      [conversationId],
    );
    if (rowCount === 0) throw new Error('Conversation was never published');
    return { conversationId, state: 'revoked' };
  });
}

// Full reads re-verify consent coverage inside the read transaction:
// no window exists where a withdrawn consent still serves.
async function liveFullPublication(executor, conversationId, modes) {
  const pub = (await executor.query(
    `SELECT mode, scope_hash AS "scopeHash" FROM conversation_publications
      WHERE conversation_id = $1 AND state = 'published' FOR UPDATE`,
    [conversationId],
  )).rows[0];
  if (!pub || !modes.includes(pub.mode)) notFound();
  if ((await missingConsents(executor, conversationId, pub.scopeHash)).length > 0) notFound();
  return pub;
}

export async function readPublishedTranscript(poolOrClient, conversationId) {
  return withTx(poolOrClient, async (executor) => {
    await liveFullPublication(executor, conversationId, ['transcript', 'live_full']);
    const { rows } = await executor.query(
      `SELECT id, COALESCE(created_by_user_id, user_id) AS "authorId", role, content,
              message_index AS "messageIndex", created_at AS "createdAt"
         FROM chat_messages WHERE conversation_id = $1 ORDER BY message_index, created_at, id`,
      [conversationId],
    );
    return rows;
  });
}

export async function readPublishedLiveEvents(poolOrClient, { conversationId, after = 0, limit = 100 }) {
  if (!Number.isSafeInteger(after) || after < 0) throw new Error('Cursor must be a non-negative integer');
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Limit must be between 1 and 200');
  return withTx(poolOrClient, async (executor) => {
    await liveFullPublication(executor, conversationId, ['live_full']);
    const { rows } = await executor.query(
      `SELECT sequence, event_type AS "eventType", actor_user_id AS "actorId", payload, created_at AS "createdAt"
         FROM chat_collaboration_events WHERE conversation_id = $1 AND sequence > $2
         ORDER BY sequence ASC LIMIT $3`,
      [conversationId, after, limit],
    );
    return rows;
  });
}

// Public artifact links: their own state and retention, independent
// of any conversation publication. The token is shown once; only its
// digest is stored. Expiry kills reads; purge_after sweeps the row.
export async function publishArtifactLink(poolOrClient, {
  actorUserId, artifactId, revision, ttlSeconds = 86400, retentionDays = 30, projectId = null,
}) {
  if (!actorUserId) throw new Error('actorUserId is required');
  if (!artifactId) throw new Error('artifactId is required');
  const rev = Number(revision);
  if (!Number.isInteger(rev) || rev < 0) throw new Error('revision must be a non-negative integer');
  const ttl = Number(ttlSeconds);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 90 * 86400) {
    throw new Error('ttlSeconds must be between a minute and ninety days');
  }
  const retention = Number(retentionDays);
  if (!Number.isInteger(retention) || retention < 1 || retention > 365) {
    throw new Error('retentionDays must be between one and 365 days');
  }
  // PUB-13: a link may attribute a project so visibility retreat can
  // reach exactly those links; unattributed links stay publisher-scoped.
  if (projectId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
    throw new Error('invalid project attribution');
  }
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  const digest = crypto.createHash('sha256').update(token).digest('hex');
  const row = await withTx(poolOrClient, async (executor) => {
    const artifact = (await executor.query(
      `SELECT owner_user_id FROM artifacts WHERE id = $1 AND deleted_at IS NULL`, [artifactId],
    )).rows[0];
    if (!artifact) throw new Error('Artifact not found');
    if (String(artifact.owner_user_id) !== String(actorUserId)) throw new Error('artifact_link_not_authorized');
    const revRow = (await executor.query(
      `SELECT 1 FROM artifact_revisions WHERE artifact_id = $1 AND revision = $2`, [artifactId, rev],
    )).rows[0];
    if (!revRow) throw new Error('Artifact revision not found');
    if (projectId !== null) {
      const project = (await executor.query(
        `SELECT 1 FROM chat_projects WHERE id = $1`, [projectId],
      )).rows[0];
      if (!project) throw new Error('Project not found');
    }
    const { rows } = await executor.query(
      `INSERT INTO artifact_public_links (artifact_id, revision, link_token_digest, state,
          expires_at, purge_after, published_by_user_id, project_id)
        VALUES ($1, $2, $3, 'published', now() + make_interval(secs => $4), now() + make_interval(days => $5), $6, $7)
        RETURNING id AS "linkId", artifact_id AS "artifactId", revision, state, expires_at AS "expiresAt",
          purge_after AS "purgeAfter"`,
      [artifactId, rev, digest, ttl, retention, actorUserId, projectId],
    );
    return rows[0];
  });
  return { ...row, token };
}

export async function resolveArtifactLink(poolOrClient, token) {
  if (typeof token !== 'string' || !token) throw new Error('artifact_link_not_found');
  const digest = crypto.createHash('sha256').update(token).digest('hex');
  const link = (await poolOrClient.query(
    `SELECT * FROM artifact_public_links WHERE link_token_digest = $1`, [digest],
  )).rows[0];
  if (!link) throw new Error('artifact_link_not_found');
  if (link.state === 'revoked') throw new Error('artifact_link_revoked');
  if (link.state === 'expired' || new Date(link.expires_at) <= new Date()) {
    // The flip commits on its own: it must survive the refusal it causes.
    await poolOrClient.query(`UPDATE artifact_public_links SET state = 'expired' WHERE id = $1`, [link.id]);
    throw new Error('artifact_link_expired');
  }
  return { linkId: link.id, artifactId: link.artifact_id, revision: Number(link.revision) };
}

export async function revokeArtifactLink(poolOrClient, { actorUserId, linkId }) {
  return withTx(poolOrClient, async (executor) => {
    const link = (await executor.query(
      `SELECT l.*, a.owner_user_id AS "ownerId" FROM artifact_public_links l
         JOIN artifacts a ON a.id = l.artifact_id WHERE l.id = $1 FOR UPDATE OF l`,
      [linkId],
    )).rows[0];
    if (!link) throw new Error('Artifact link not found');
    if (String(link.ownerId) !== String(actorUserId)) throw new Error('artifact_link_not_authorized');
    await executor.query(
      `UPDATE artifact_public_links SET state = 'revoked', revoked_at = now() WHERE id = $1`, [linkId],
    );
    return { linkId, state: 'revoked' };
  });
}

export async function purgeExpiredArtifactLinks(poolOrClient) {
  const { rows } = await poolOrClient.query(
    `DELETE FROM artifact_public_links WHERE purge_after <= now() RETURNING id`,
  );
  return { purged: rows.length };
}
