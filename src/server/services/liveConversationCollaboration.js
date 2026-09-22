import crypto from 'crypto';
import { check, writeTuples } from '../utils/authzReBAC.js';
import { scopesForClient } from '../config/oidcAuthorityPolicy.js';
import { UUID_RE } from '../utils/workspaceContext.js';
import { withTransaction } from './chatProjectAuthority.js';
import { issuer } from '../config/hosts.js';

const ROLES = new Set(['viewer', 'commenter', 'contributor']);
const ROLE_RELATION = Object.freeze({
  viewer: 'collaboration_viewer',
  commenter: 'collaboration_commenter',
  contributor: 'collaboration_contributor',
});
const TOKEN_RE = /^[a-f0-9]{64}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const MAX_CONTENT_BYTES = 32768;
const MAX_WRITES_PER_MINUTE = 30;
const MAX_ACTIVE_SHARES = 20;
const LOCAL_CONVERSATION_ID_RE = /^[^\x00-\x1f]{1,240}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const INSTALLATION_ID_RE = /^[A-Za-z0-9_-]{43}$/;
const SYNC_EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export class LiveCollaborationError extends Error {
  constructor(code, status = 400, message = code, details = null) {
    super(message);
    this.name = 'LiveCollaborationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const hidden = () => new LiveCollaborationError('collaboration_not_found', 404, 'Collaboration resource not found.');
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const relationFor = (role) => ROLE_RELATION[role];

export function assertLiveCollaborationAuthority(req) {
  const auth = req.auth;
  if (auth?.kind !== 'oidc' || !auth.dpopJkt) {
    throw new LiveCollaborationError('sender_bound_account_required', 401, 'Sender-bound account authentication is required.');
  }
  const granted = new Set(String(auth.scope || '').split(/\s+/).filter(Boolean));
  const ceiling = new Set(scopesForClient(auth.clientId) || []);
  if (!granted.has('collaboration:use') || !ceiling.has('collaboration:use')) {
    throw new LiveCollaborationError('insufficient_scope', 403, 'The collaboration:use scope is required.');
  }
}

function validateToken(token) {
  if (!TOKEN_RE.test(String(token || ''))) throw hidden();
  return hash(token);
}

function validateConversationId(conversationId) {
  if (!UUID_RE.test(String(conversationId || ''))) throw new LiveCollaborationError('invalid_conversation_id', 400, 'Conversation id must be a UUID.');
}

function validateRole(role) {
  if (!ROLES.has(role)) throw new LiveCollaborationError('invalid_collaboration_role', 400, 'Role must be viewer, commenter, or contributor.');
}

async function requireConversationAdmin(db, conversationId, userId) {
  const verdict = await check(db, { object: `conversation:${conversationId}`, relation: 'admin', subject: `user:${userId}` });
  if (!verdict.allowed) throw hidden();
}

async function lockConversation(db, conversationId) {
  const row = (await db.query('SELECT id FROM chat_conversations WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [conversationId])).rows[0];
  if (!row) throw hidden();
}

async function appendEvent(db, conversationId, eventType, { actorUserId = null, participantId = null, messageId = null, commentId = null, payload = {} } = {}) {
  await db.query(
    `INSERT INTO chat_collaboration_event_heads(conversation_id,last_sequence)
     VALUES($1,0) ON CONFLICT(conversation_id) DO NOTHING`,
    [conversationId],
  );
  const head = (await db.query(
    `UPDATE chat_collaboration_event_heads SET last_sequence=last_sequence+1
     WHERE conversation_id=$1 RETURNING last_sequence`,
    [conversationId],
  )).rows[0];
  return (await db.query(
    `INSERT INTO chat_collaboration_events(
       conversation_id,sequence,event_type,actor_user_id,participant_id,message_id,comment_id,payload
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
    [conversationId, head.last_sequence, eventType, actorUserId, participantId, messageId, commentId, JSON.stringify(payload)],
  )).rows[0];
}

export async function createLiveShare(pool, { conversationId, ownerId, role, visibility = 'public', expiresInDays = 7 }) {
  validateConversationId(conversationId);
  validateRole(role);
  if (!['public', 'workspace'].includes(visibility)) throw new LiveCollaborationError('invalid_share_visibility', 400, 'Visibility must be public or workspace.');
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) throw new LiveCollaborationError('invalid_share_expiry', 400, 'Expiry must be between 1 and 30 days.');
  const token = crypto.randomBytes(32).toString('hex');
  const tokenDigest = hash(token);
  const result = await withTransaction(pool, async (db) => {
    await lockConversation(db, conversationId);
    await requireConversationAdmin(db, conversationId, ownerId);
    const conversation = (await db.query(
      `SELECT c.title,COALESCE(c.workspace_id,p.workspace_id) workspace_id
       FROM chat_conversations c LEFT JOIN chat_projects p ON p.id=c.project_id WHERE c.id=$1`,
      [conversationId],
    )).rows[0];
    if (visibility === 'workspace' && !conversation.workspace_id) throw new LiveCollaborationError('workspace_share_requires_workspace', 400, 'Workspace sharing requires a workspace conversation.');
    const active = Number((await db.query(
      `SELECT count(*) count FROM chat_shared_conversations
       WHERE conversation_id=$1 AND mode='live' AND revoked_at IS NULL AND expires_at>now()`,
      [conversationId],
    )).rows[0].count);
    if (active >= MAX_ACTIVE_SHARES) throw new LiveCollaborationError('active_share_limit', 429, 'Too many active collaboration links.');
    const share = (await db.query(
      `INSERT INTO chat_shared_conversations(
         conversation_id,owner_id,share_token,token_digest,visibility,workspace_id,expires_at,mode,participant_role
       ) VALUES($1,$2,NULL,$3,$4,$5,now()+($6*interval '1 day'),'live',$7) RETURNING *`,
      [conversationId, ownerId, tokenDigest, visibility, visibility === 'workspace' ? conversation.workspace_id : null, expiresInDays, role],
    )).rows[0];
    await appendEvent(db, conversationId, 'share.created', { actorUserId: ownerId, payload: { share_id: share.id, role, visibility } });
    return { share, title: conversation.title };
  });
  return {
    ...result.share,
    share_token: undefined,
    token_digest: undefined,
    mode: 'live',
    share_url: `${issuer()}/overview/chat/shared/${token}`,
    conversation_title: result.title,
  };
}

async function liveShareByDigest(db, digest, { lock = false } = {}) {
  const suffix = lock ? ' FOR UPDATE OF s' : '';
  return (await db.query(
    `SELECT s.*,c.title,c.model_id,c.created_at conversation_created_at,
            u.email owner_email,u.display_name owner_name
     FROM chat_shared_conversations s
     JOIN chat_conversations c ON c.id=s.conversation_id AND c.deleted_at IS NULL
     JOIN users u ON u.id=s.owner_id
     WHERE s.token_digest=$1 AND s.mode='live' AND s.expires_at>now() AND s.revoked_at IS NULL${suffix}`,
    [digest],
  )).rows[0] || null;
}

export async function findLiveShareForPreview(db, token) {
  const share = await liveShareByDigest(db, validateToken(token));
  if (!share) throw hidden();
  return share;
}

export async function acceptLiveShare(pool, { token, userId }) {
  const digest = validateToken(token);
  return withTransaction(pool, async (db) => {
    const discovered = await liveShareByDigest(db, digest);
    if (!discovered) throw hidden();
    await lockConversation(db, discovered.conversation_id);
    const share = await liveShareByDigest(db, digest, { lock: true });
    if (!share) throw hidden();
    if (share.owner_id === userId) throw new LiveCollaborationError('owner_cannot_join', 409, 'The conversation owner already has access.');
    if (share.visibility === 'workspace') {
      const access = await check(db, { object: `workspace:${share.workspace_id}`, relation: 'viewer', subject: `user:${userId}` });
      if (!access.allowed) throw hidden();
    }
    const existing = (await db.query(
      'SELECT * FROM chat_live_participants WHERE conversation_id=$1 AND user_id=$2 FOR UPDATE',
      [share.conversation_id, userId],
    )).rows[0];
    if (existing?.revoked_at) throw new LiveCollaborationError('participation_revoked', 409, 'This participation was revoked.');
    if (existing) return { participant: existing, replayed: true, conversation_id: share.conversation_id };
    const participant = (await db.query(
      `INSERT INTO chat_live_participants(conversation_id,user_id,accepted_share_id,role)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [share.conversation_id, userId, share.id, share.participant_role],
    )).rows[0];
    await writeTuples(db, { writes: [{ object: `conversation:${share.conversation_id}`, relation: relationFor(participant.role), subject: `user:${userId}` }] });
    await db.query('UPDATE chat_shared_conversations SET accept_count=accept_count+1 WHERE id=$1', [share.id]);
    const event = await appendEvent(db, share.conversation_id, 'participant.joined', {
      actorUserId: userId, participantId: participant.id, payload: { role: participant.role },
    });
    return { participant, event, replayed: false, conversation_id: share.conversation_id };
  });
}

async function activeParticipant(db, conversationId, userId, { lock = false } = {}) {
  const suffix = lock ? ' FOR UPDATE OF p' : '';
  const participant = (await db.query(
    `SELECT p.* FROM chat_live_participants p
     JOIN chat_shared_conversations s ON s.id=p.accepted_share_id
     WHERE p.conversation_id=$1 AND p.user_id=$2 AND p.revoked_at IS NULL
       AND s.mode='live' AND s.revoked_at IS NULL${suffix}`,
    [conversationId, userId],
  )).rows[0];
  if (!participant) throw hidden();
  const tuple = await check(db, { object: `conversation:${conversationId}`, relation: relationFor(participant.role), subject: `user:${userId}` });
  if (!tuple.allowed) throw hidden();
  return participant;
}

function validateEntry({ kind, content, idempotencyKey, expectedActorId, userId, strict = false }) {
  if (strict) {
    if (!UUID_RE.test(String(expectedActorId || ''))) {
      throw new LiveCollaborationError('invalid_expected_actor', 400, 'A valid expected actor id is required.');
    }
    if (String(expectedActorId).toLowerCase() !== String(userId).toLowerCase()) {
      throw new LiveCollaborationError('collaboration_actor_changed', 409, 'The authenticated collaboration actor changed.');
    }
  }
  if (!['comment', 'message'].includes(kind)) throw new LiveCollaborationError('invalid_entry_kind', 400, 'Kind must be comment or message.');
  if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    throw new LiveCollaborationError('invalid_entry_content', 400, 'Content must be between 1 and 32768 bytes.');
  }
  if (!IDEMPOTENCY_RE.test(String(idempotencyKey || ''))) throw new LiveCollaborationError('invalid_idempotency_key', 400, 'A valid idempotency key is required.');
}

function replayLiveEntryResult(result, idempotencyKey) {
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || !result.event || typeof result.event !== 'object' || Array.isArray(result.event)
    || !result.event.payload || typeof result.event.payload !== 'object' || Array.isArray(result.event.payload)
    || !['comment.appended', 'message.appended'].includes(result.event.event_type)) {
    throw new LiveCollaborationError('collaboration_receipt_corrupt', 503, 'Stored collaboration receipt is invalid.');
  }
  if (result.event.payload.source_event_id === idempotencyKey) return result;
  if (result.event.payload.source_event_id !== undefined) {
    throw new LiveCollaborationError('idempotency_conflict', 409, 'Stored collaboration event identity changed.');
  }
  // Before source_event_id shipped, the receipt primary key already was the
  // immutable actor-scoped operation identity. Derive only from that exact key.
  return {
    ...result,
    event: { ...result.event, payload: { ...result.event.payload, source_event_id: idempotencyKey } },
  };
}

export async function appendLiveEntry(pool, { conversationId, userId, expectedActorId, kind, content, idempotencyKey, strict = false }) {
  validateConversationId(conversationId);
  // The v2 identity comparison precedes transaction admission and receipt
  // lookup so an account switch can never replay the former actor's success.
  validateEntry({ kind, content, idempotencyKey, expectedActorId, userId, strict });
  // Preserve the exact v1 hash on the legacy route. Strict clients use only v2.
  const requestHash = hash(JSON.stringify(strict ? { kind, content, expected_actor_id: expectedActorId } : { kind, content }));
  return withTransaction(pool, async (db) => {
    await lockConversation(db, conversationId);
    const participant = await activeParticipant(db, conversationId, userId, { lock: true });
    const existing = (await db.query(
      `SELECT request_hash,result FROM chat_collaboration_idempotency
       WHERE conversation_id=$1 AND actor_user_id=$2 AND idempotency_key=$3`,
      [conversationId, userId, idempotencyKey],
    )).rows[0];
    if (existing) {
      if (existing.request_hash !== requestHash) throw new LiveCollaborationError('idempotency_conflict', 409, 'Idempotency key payload changed.');
      return { ...replayLiveEntryResult(existing.result, idempotencyKey), replayed: true };
    }
    if (participant.role === 'viewer' || (kind === 'message' && participant.role !== 'contributor')) throw hidden();
    const recent = Number((await db.query(
      `SELECT count(*) count FROM chat_collaboration_idempotency
       WHERE conversation_id=$1 AND actor_user_id=$2 AND created_at>now()-interval '1 minute'`,
      [conversationId, userId],
    )).rows[0].count);
    if (recent >= MAX_WRITES_PER_MINUTE) throw new LiveCollaborationError('collaboration_rate_limited', 429, 'Collaboration write rate exceeded.');
    let message = null;
    let comment = null;
    if (kind === 'message') {
      const messageIndex = Number((await db.query(
        'SELECT COALESCE(MAX(message_index),-1)+1 next_index FROM chat_messages WHERE conversation_id=$1',
        [conversationId],
      )).rows[0].next_index);
      message = (await db.query(
        `INSERT INTO chat_messages(conversation_id,user_id,created_by_user_id,role,content,message_index)
         VALUES($1,$2,$2,'user',$3,$4) RETURNING id,conversation_id,created_by_user_id,role,content,message_index,created_at`,
        [conversationId, userId, content, messageIndex],
      )).rows[0];
      await db.query('UPDATE chat_conversations SET last_message_at=now(),updated_at=now() WHERE id=$1', [conversationId]);
    } else {
      comment = (await db.query(
        `INSERT INTO chat_collaboration_comments(conversation_id,created_by_user_id,content)
         VALUES($1,$2,$3) RETURNING *`,
        [conversationId, userId, content],
      )).rows[0];
    }
    const event = await appendEvent(db, conversationId, kind === 'message' ? 'message.appended' : 'comment.appended', {
      actorUserId: userId, participantId: participant.id, messageId: message?.id, commentId: comment?.id,
      payload: { kind, content, role: participant.role, message_index: message?.message_index ?? null, source_event_id: idempotencyKey },
    });
    const result = { conversation_id: conversationId, event, message, comment, replayed: false };
    await db.query(
      `INSERT INTO chat_collaboration_idempotency(conversation_id,actor_user_id,idempotency_key,request_hash,result)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [conversationId, userId, idempotencyKey, requestHash, JSON.stringify(result)],
    );
    return result;
  });
}

export async function readLiveEvents(pool, { conversationId, userId, after = 0, limit = 100 }) {
  validateConversationId(conversationId);
  if (!Number.isSafeInteger(after) || after < 0) throw new LiveCollaborationError('invalid_cursor', 400, 'Cursor must be a non-negative integer.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new LiveCollaborationError('invalid_limit', 400, 'Limit must be between 1 and 200.');
  return withTransaction(pool, async (db) => {
    await lockConversation(db, conversationId);
    const admin = await check(db, { object: `conversation:${conversationId}`, relation: 'admin', subject: `user:${userId}` });
    if (!admin.allowed) await activeParticipant(db, conversationId, userId);
    const current = Number((await db.query(
      'SELECT last_sequence FROM chat_collaboration_event_heads WHERE conversation_id=$1', [conversationId],
    )).rows[0]?.last_sequence || 0);
    if (after > current) throw new LiveCollaborationError('cursor_ahead', 409, 'Cursor is ahead of the conversation event log.');
    const queriedEvents = (await db.query(
      `SELECT sequence,event_type,actor_user_id,participant_id,message_id,comment_id,payload,created_at
       FROM chat_collaboration_events WHERE conversation_id=$1 AND sequence>$2
       ORDER BY sequence ASC LIMIT $3`,
      [conversationId, after, limit],
    )).rows;
    const events = [];
    let responseBytes = 0;
    for (const event of queriedEvents) {
      const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
      if (events.length && responseBytes + bytes > 1_048_576) break;
      events.push(event); responseBytes += bytes;
    }
    const cursor = events.length ? Number(events.at(-1).sequence) : after;
    return { conversation_id: conversationId, events, cursor, current_cursor: current, has_more: cursor < current };
  });
}

/** Resolve a local Agent conversation to one Platform-owned UUID. The DPoP JKT
 * is the installation incarnation; neither the renderer nor a caller chooses it. */
export async function registerAgentConversation(pool, {
  localConversationId, userId, clientId, installationId, title = 'Agent conversation', modelId = null,
}) {
  if (!LOCAL_CONVERSATION_ID_RE.test(String(localConversationId || ''))
    || !CLIENT_ID_RE.test(String(clientId || ''))
    || !INSTALLATION_ID_RE.test(String(installationId || ''))) {
    throw new LiveCollaborationError('invalid_agent_conversation_identity', 400, 'Invalid Agent conversation identity.');
  }
  if (typeof title !== 'string' || !title.trim() || Buffer.byteLength(title, 'utf8') > 240
    || (modelId !== null && (typeof modelId !== 'string' || Buffer.byteLength(modelId, 'utf8') > 160))) {
    throw new LiveCollaborationError('invalid_agent_conversation_metadata', 400, 'Invalid Agent conversation metadata.');
  }
  return withTransaction(pool, async (db) => {
    const identity = `${userId}:${clientId}:${installationId}:${localConversationId}`;
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`agent-conversation:${identity}`]);
    const existing = (await db.query(
      `SELECT m.conversation_id,c.title,c.model_id FROM chat_agent_conversation_mappings m
       JOIN chat_conversations c ON c.id=m.conversation_id AND c.deleted_at IS NULL
       WHERE m.owner_user_id=$1 AND m.client_id=$2 AND m.installation_id=$3 AND m.local_conversation_id=$4`,
      [userId, clientId, installationId, localConversationId],
    )).rows[0];
    if (existing) return { conversation_id: existing.conversation_id, title: existing.title, model_id: existing.model_id, replayed: true };
    const conversation = (await db.query(
      `INSERT INTO chat_conversations(user_id,owner_user_id,created_by_user_id,title,model_id,interface_id)
       VALUES($1,$1,$1,$2,$3,'xeno-agent-interface') RETURNING id,title,model_id`,
      [userId, title.trim(), modelId],
    )).rows[0];
    await writeTuples(db, { writes: [{ object: `conversation:${conversation.id}`, relation: 'owner', subject: `user:${userId}` }] });
    await db.query(
      `INSERT INTO chat_agent_conversation_mappings(conversation_id,owner_user_id,client_id,installation_id,local_conversation_id)
       VALUES($1,$2,$3,$4,$5)`,
      [conversation.id, userId, clientId, installationId, localConversationId],
    );
    return { conversation_id: conversation.id, title: conversation.title, model_id: conversation.model_id, replayed: false };
  });
}

function validateOwnerSync({ eventId, kind, content, tool, sourceMessageId, revision, expectedRevision, state, strict = false }) {
  if (!SYNC_EVENT_ID_RE.test(String(eventId || ''))) throw new LiveCollaborationError('invalid_sync_event_id', 400, 'Invalid sync event id.');
  if (!['user', 'assistant', 'tool'].includes(kind)) throw new LiveCollaborationError('invalid_sync_event_kind', 400, 'Invalid sync event kind.');
  const versionFields = [sourceMessageId, revision, expectedRevision, state];
  const versioned = versionFields.some(value => value !== undefined && value !== null);
  if (versioned && versionFields.some(value => value === undefined || value === null)) {
    throw new LiveCollaborationError('invalid_sync_revision', 400, 'Revisioned message sync requires source_message_id, revision, expected_revision, and state.');
  }
  if (kind === 'tool') {
    if (versioned) throw new LiveCollaborationError('invalid_sync_revision', 400, 'Tool lifecycle events cannot carry message revisions.');
    if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string' || !tool.name.trim()
      || Buffer.byteLength(tool.name, 'utf8') > 120 || !['started', 'completed', 'failed'].includes(tool.status)) {
      throw new LiveCollaborationError('invalid_sync_tool', 400, 'Invalid sanitized tool lifecycle.');
    }
    return false;
  }
  if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    throw new LiveCollaborationError('invalid_sync_content', 400, 'Invalid synced message content.');
  }
  if (strict && !versioned) {
    throw new LiveCollaborationError('invalid_sync_revision', 400, 'The v2 owner message route requires source_message_id, revision, expected_revision, and state.');
  }
  if (versioned) {
    if (!SYNC_EVENT_ID_RE.test(String(sourceMessageId || ''))
      || !Number.isSafeInteger(revision) || revision < 1
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || revision !== expectedRevision + 1
      || !['streaming', 'complete'].includes(state)) {
      throw new LiveCollaborationError('invalid_sync_revision', 400, 'Invalid revisioned message identity or base revision.');
    }
  }
  return versioned;
}

function replayOwnerSyncResult(result, eventId) {
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || !result.event || typeof result.event !== 'object' || Array.isArray(result.event)
    || !result.event.payload || typeof result.event.payload !== 'object' || Array.isArray(result.event.payload)
    || !['owner.message.synced', 'owner.tool.synced'].includes(result.event.event_type)) {
    throw new LiveCollaborationError('sync_receipt_corrupt', 503, 'Stored sync receipt is invalid.');
  }
  if (result.event.payload.source_event_id === eventId) return result;
  if (result.event.payload.source_event_id !== undefined) {
    throw new LiveCollaborationError('sync_receipt_corrupt', 503, 'Stored sync event identity changed.');
  }
  // Pre-source_event_id receipts are still bound to their immutable primary
  // key. Derive only from the exact receipt key used for this replay.
  return {
    ...result,
    event: { ...result.event, payload: { ...result.event.payload, source_event_id: eventId } },
  };
}

/** The owner remains the sole execution writer. This endpoint mirrors display
 * events only; it never dispatches an agent or stores tool arguments/results. */
export async function syncAgentConversationEvent(pool, {
  conversationId, userId, clientId, installationId, eventId, kind, content = null, tool = null,
  sourceMessageId = null, revision = null, expectedRevision = null, state = null, strict = false,
}) {
  validateConversationId(conversationId);
  if (!CLIENT_ID_RE.test(String(clientId || '')) || !INSTALLATION_ID_RE.test(String(installationId || ''))) throw hidden();
  const versioned = validateOwnerSync({ eventId, kind, content, tool, sourceMessageId, revision, expectedRevision, state, strict });
  // Preserve the exact legacy hash so pre-v2 receipts remain replayable.
  const requestHash = hash(JSON.stringify(versioned
    ? { kind, content, source_message_id: sourceMessageId, revision, expected_revision: expectedRevision, state }
    : { kind, content: kind === 'tool' ? null : content, tool: kind === 'tool' ? { name: tool.name, status: tool.status } : null }));
  return withTransaction(pool, async (db) => {
    await lockConversation(db, conversationId);
    await requireConversationAdmin(db, conversationId, userId);
    const mapping = (await db.query(
      `SELECT 1 FROM chat_agent_conversation_mappings
       WHERE conversation_id=$1 AND owner_user_id=$2 AND client_id=$3 AND installation_id=$4`,
      [conversationId, userId, clientId, installationId],
    )).rows[0];
    if (!mapping) throw hidden();
    const existing = (await db.query(
      'SELECT request_hash,result FROM chat_agent_sync_receipts WHERE conversation_id=$1 AND owner_user_id=$2 AND event_id=$3',
      [conversationId, userId, eventId],
    )).rows[0];
    if (existing) {
      if (existing.request_hash !== requestHash) throw new LiveCollaborationError('sync_event_conflict', 409, 'Sync event payload changed.');
      return { ...replayOwnerSyncResult(existing.result, eventId), replayed: true };
    }
    let message = null;
    let legacyAdopted = false;
    if (kind !== 'tool' && versioned) {
      let current = (await db.query(
        `SELECT id,conversation_id,created_by_user_id,role,content,message_index,created_at,
                source_message_id,source_revision::float8 revision,source_state state
         FROM chat_messages WHERE conversation_id=$1 AND source_message_id=$2 FOR UPDATE`,
        [conversationId, sourceMessageId],
      )).rows[0];
      if (current) {
        if (current.role !== kind) throw new LiveCollaborationError('sync_message_identity_conflict', 409, 'Synced message role changed.');
        if (current.state === 'complete' && state === 'streaming') {
          throw new LiveCollaborationError('sync_message_state_conflict', 409, 'A completed synced message cannot return to streaming.');
        }
        if (Number(current.revision) !== expectedRevision) {
          throw new LiveCollaborationError('sync_revision_conflict', 409, 'Synced message base revision changed.', { current_revision: Number(current.revision) });
        }
        message = (await db.query(
          `UPDATE chat_messages SET content=$3,source_revision=$4,source_state=$5
           WHERE id=$1 AND conversation_id=$2 AND source_revision=$6
           RETURNING id,conversation_id,created_by_user_id,role,content,message_index,created_at,
                     source_message_id,source_revision::float8 revision,source_state state`,
          [current.id, conversationId, content, revision, state, expectedRevision],
        )).rows[0];
        if (!message) throw new LiveCollaborationError('sync_revision_conflict', 409, 'Synced message base revision changed.');
      } else {
        if (expectedRevision !== 0) {
          throw new LiveCollaborationError('sync_revision_conflict', 409, 'Synced message does not have the expected base revision.', { current_revision: 0 });
        }
        // A v1 Agent client used its stable message event id as the immutable
        // receipt id. Adopt only that exact owner/conversation receipt and the
        // exact canonical message row it recorded; never correlate by content.
        const legacy = (await db.query(
          `SELECT m.id,m.role
           FROM chat_agent_sync_receipts r
           JOIN chat_messages m ON m.id::text=r.result#>>'{message,id}' AND m.conversation_id=r.conversation_id
           WHERE r.conversation_id=$1 AND r.owner_user_id=$2 AND r.event_id=$3
             AND r.result#>>'{event,event_type}'='owner.message.synced'
             AND m.source_message_id IS NULL
           FOR UPDATE OF m`,
          [conversationId, userId, sourceMessageId],
        )).rows[0];
        if (legacy) {
          if (legacy.role !== kind) throw new LiveCollaborationError('sync_message_identity_conflict', 409, 'Synced message role changed.');
          message = (await db.query(
            `UPDATE chat_messages SET content=$3,source_message_id=$4,source_revision=1,source_state=$5
             WHERE id=$1 AND conversation_id=$2 AND source_message_id IS NULL
             RETURNING id,conversation_id,created_by_user_id,role,content,message_index,created_at,
                       source_message_id,source_revision::float8 revision,source_state state`,
            [legacy.id, conversationId, content, sourceMessageId, state],
          )).rows[0];
          if (!message) throw new LiveCollaborationError('sync_revision_conflict', 409, 'Legacy message adoption raced another revision.');
          legacyAdopted = true;
        } else {
          const ambiguousLegacyReceipt = (await db.query(
            `SELECT 1 FROM chat_agent_sync_receipts
             WHERE conversation_id=$1 AND owner_user_id=$2 AND event_id=$3`,
            [conversationId, userId, sourceMessageId],
          )).rows[0];
          if (ambiguousLegacyReceipt) {
            throw new LiveCollaborationError('sync_legacy_adoption_conflict', 409, 'Legacy sync receipt cannot be safely adopted.');
          }
          const messageIndex = Number((await db.query(
            'SELECT COALESCE(MAX(message_index),-1)+1 next_index FROM chat_messages WHERE conversation_id=$1', [conversationId],
          )).rows[0].next_index);
          message = (await db.query(
            `INSERT INTO chat_messages(
               conversation_id,user_id,created_by_user_id,role,content,message_index,source_message_id,source_revision,source_state
             ) VALUES($1,$2,$2,$3,$4,$5,$6,1,$7)
             RETURNING id,conversation_id,created_by_user_id,role,content,message_index,created_at,
                       source_message_id,source_revision::float8 revision,source_state state`,
            [conversationId, userId, kind, content, messageIndex, sourceMessageId, state],
          )).rows[0];
        }
      }
      await db.query('UPDATE chat_conversations SET last_message_at=now(),updated_at=now() WHERE id=$1', [conversationId]);
    } else if (kind !== 'tool') {
      const messageIndex = Number((await db.query(
        'SELECT COALESCE(MAX(message_index),-1)+1 next_index FROM chat_messages WHERE conversation_id=$1', [conversationId],
      )).rows[0].next_index);
      message = (await db.query(
        `INSERT INTO chat_messages(conversation_id,user_id,created_by_user_id,role,content,message_index)
         VALUES($1,$2,$2,$3,$4,$5) RETURNING id,conversation_id,created_by_user_id,role,content,message_index,created_at`,
        [conversationId, userId, kind, content, messageIndex],
      )).rows[0];
      await db.query('UPDATE chat_conversations SET last_message_at=now(),updated_at=now() WHERE id=$1', [conversationId]);
    }
    const payload = kind === 'tool'
      ? { kind: 'tool', tool: { name: tool.name, status: tool.status }, source_event_id: eventId }
      : {
          kind: 'message', role: kind, content, message_index: message.message_index, source_event_id: eventId,
          ...(versioned ? {
            source_message_id: sourceMessageId, revision, state, legacy_adopted: legacyAdopted,
          } : {}),
        };
    const event = await appendEvent(db, conversationId, kind === 'tool' ? 'owner.tool.synced' : 'owner.message.synced', {
      actorUserId: userId, messageId: message?.id, payload,
    });
    const result = { conversation_id: conversationId, event, message };
    await db.query(
      `INSERT INTO chat_agent_sync_receipts(conversation_id,owner_user_id,event_id,request_hash,result)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [conversationId, userId, eventId, requestHash, JSON.stringify(result)],
    );
    return { ...result, replayed: false };
  });
}

export async function listLiveParticipants(pool, { conversationId, ownerId }) {
  validateConversationId(conversationId);
  return withTransaction(pool, async (db) => {
    await lockConversation(db, conversationId);
    await requireConversationAdmin(db, conversationId, ownerId);
    const participants = (await db.query(
      `SELECT p.id,p.user_id,p.role,p.accepted_at,u.email,u.display_name
       FROM chat_live_participants p JOIN users u ON u.id=p.user_id
       WHERE p.conversation_id=$1 AND p.revoked_at IS NULL ORDER BY p.accepted_at,p.id`,
      [conversationId],
    )).rows;
    return { conversation_id: conversationId, participants };
  });
}

async function revokeParticipantRows(db, conversationId, rows, revokedBy) {
  for (const participant of rows) {
    await db.query(
      'UPDATE chat_live_participants SET revoked_at=now(),revoked_by_user_id=$2 WHERE id=$1 AND revoked_at IS NULL',
      [participant.id, revokedBy],
    );
    await writeTuples(db, { deletes: [{ object: `conversation:${conversationId}`, relation: relationFor(participant.role), subject: `user:${participant.user_id}` }] });
    await appendEvent(db, conversationId, 'participant.revoked', {
      actorUserId: revokedBy, participantId: participant.id, payload: { user_id: participant.user_id },
    });
  }
}

export async function revokeLiveParticipant(pool, { conversationId, participantUserId, ownerId }) {
  validateConversationId(conversationId);
  if (!UUID_RE.test(String(participantUserId || ''))) throw new LiveCollaborationError('invalid_participant_id', 400, 'Participant id must be a UUID.');
  return withTransaction(pool, async (db) => {
    await lockConversation(db, conversationId);
    await requireConversationAdmin(db, conversationId, ownerId);
    const rows = (await db.query(
      'SELECT * FROM chat_live_participants WHERE conversation_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE',
      [conversationId, participantUserId],
    )).rows;
    if (!rows.length) throw hidden();
    await revokeParticipantRows(db, conversationId, rows, ownerId);
    return { conversation_id: conversationId, user_id: participantUserId, revoked: true };
  });
}

export async function revokeLiveShare(pool, { conversationId, shareId, ownerId }) {
  validateConversationId(conversationId);
  if (!UUID_RE.test(String(shareId || ''))) throw new LiveCollaborationError('invalid_share_id', 400, 'Share id must be a UUID.');
  return withTransaction(pool, async (db) => {
    await lockConversation(db, conversationId);
    await requireConversationAdmin(db, conversationId, ownerId);
    const share = (await db.query(
      `SELECT * FROM chat_shared_conversations
       WHERE id=$1 AND conversation_id=$2 AND mode='live' AND revoked_at IS NULL FOR UPDATE`,
      [shareId, conversationId],
    )).rows[0];
    if (!share) throw hidden();
    await db.query('UPDATE chat_shared_conversations SET revoked_at=now() WHERE id=$1', [shareId]);
    const participants = (await db.query(
      'SELECT * FROM chat_live_participants WHERE accepted_share_id=$1 AND revoked_at IS NULL FOR UPDATE', [shareId],
    )).rows;
    await revokeParticipantRows(db, conversationId, participants, ownerId);
    const event = await appendEvent(db, conversationId, 'share.revoked', { actorUserId: ownerId, payload: { share_id: shareId } });
    return { conversation_id: conversationId, share_id: shareId, revoked: true, participant_count: participants.length, event };
  });
}

export function sendLiveCollaborationError(res, error) {
  if (!(error instanceof LiveCollaborationError)) return false;
  res.status(error.status).json({ success: false, error: error.message, code: error.code, ...(error.details || {}) });
  return true;
}

export const LIVE_COLLABORATION_RELATIONS = Object.freeze({ ...ROLE_RELATION });
