import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import { workspaceFromReq, isWorkspaceMember, UUID_RE } from '../utils/workspaceContext.js';
import { check, listObjectTuples, writeTuples } from '../utils/authzReBAC.js';
import { computeNextRun, executeScheduledTask, sanitizeScheduledRunError } from '../workers/chatScheduledWorker.js';
import { assertAuthorizedLibraryAttachments, deleteLibraryItem, getAuthorizedLibraryFile, listLibraryItems, resolveManagedLibraryPath } from '../services/libraryAssets.js';
import {
  createAuthorizedProject,
  linkAssetToProject,
  requireResourceRelation,
  sendChatAuthorityError,
  unlinkAssetFromProject,
  userPrincipal,
  withTransaction,
} from '../services/chatProjectAuthority.js';
import { calculateNextScheduleOccurrence, calculateScheduleOccurrences } from '../services/chatScheduleRecurrence.js';
import { CHAT_PROJECT_CONTRACTS } from '../config/chatProjectContracts.js';
import { requireActivated } from '../services/accountActivation.js';
import { chatWebContextService, ChatWebContextError } from '../services/chatWebContext.js';

/** Local `convo-<timestamp>` ids are UI-only. Sending one to Postgres is a 500. */
function rejectIfNotPersistedConversationId(res, conversationId) {
  if (UUID_RE.test(conversationId)) return false;
  res.status(400).json({
    success: false,
    error: 'Conversation id must be a persisted UUID.',
    code: 'invalid_conversation_id',
  });
  return true;
}

const PRIVATE_SHARE_REFERENCE = /(?:https?:\/\/[^\s<>)\]]+)?\/(?:api\/library(?:\/[^\s<>)\]]*)?|overview\/chat\/library(?:\/[^\s<>)\]]*)?)/gi;
const INLINE_PRIVATE_ID = /(["']?(?:asset_id|chunk_id|context_record_id|context_manifest|safe_sources)["']?\s*[:=]\s*["']?)[0-9a-f]{8}-[0-9a-f-]{27,}/gi;
const INLINE_CAPABILITY = /\b(grant|sig|token)=([^\s&#)\]]+)/gi;
const EMBEDDED_BYTES = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi;

function sanitizePublicMessageContent(content) {
  return String(content ?? '')
    .replace(EMBEDDED_BYTES, '[private embedded bytes removed]')
    .replace(PRIVATE_SHARE_REFERENCE, '[private Library reference removed]')
    .replace(INLINE_PRIVATE_ID, '$1[private id removed]')
    .replace(INLINE_CAPABILITY, '$1=[private capability removed]');
}

export function serializePublicConversationMessages(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.role === 'user' || row?.role === 'assistant')
    .map((row) => ({
      id: row.id,
      role: row.role,
      content: sanitizePublicMessageContent(row.content),
      model_id: row.model_id || null,
      created_at: row.created_at,
      message_index: row.message_index,
    }));
}

/**
 * Optional foreign ids on the full-scale chat surfaces are an authorization
 * boundary, not just foreign keys. PostgreSQL proves that a row exists; these
 * checks prove that it belongs to the authenticated user before it can be linked.
 */
async function rejectUnownedChatReferences(req, res, {
  conversationId = null,
  messageId = null,
  projectId = null,
} = {}) {
  for (const [kind, id] of [['conversation', conversationId], ['message', messageId], ['project', projectId]]) {
    if (id && !UUID_RE.test(id)) {
      res.status(400).json({ success: false, error: `${kind} id must be a UUID`, code: 'invalid_reference_id' });
      return true;
    }
  }

  if (conversationId) {
    const relation = await check(req.db, { object: `conversation:${conversationId}`, relation: 'viewer', subject: `user:${req.user.id}` });
    if (!relation.allowed) {
      res.status(404).json({ success: false, error: 'Referenced resource not found', code: 'referenced_resource_not_found' });
      return true;
    }
  }

  if (messageId) {
    const message = await req.db.query(
      `SELECT conversation_id FROM chat_messages
       WHERE id = $1 AND ($2::uuid IS NULL OR conversation_id = $2)`,
      [messageId, conversationId],
    );
    if (message.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Referenced resource not found', code: 'referenced_resource_not_found' });
      return true;
    }
    const relation = await check(req.db, {
      object: `conversation:${message.rows[0].conversation_id}`,
      relation: 'reviewer',
      subject: `user:${req.user.id}`,
    });
    if (!relation.allowed) {
      res.status(404).json({ success: false, error: 'Referenced resource not found', code: 'referenced_resource_not_found' });
      return true;
    }
  }

  if (projectId) {
    const relation = await check(req.db, { object: `project:${projectId}`, relation: 'viewer', subject: `user:${req.user.id}` });
    if (!relation.allowed) {
      res.status(404).json({ success: false, error: 'Referenced resource not found', code: 'referenced_resource_not_found' });
      return true;
    }
  }

  return false;
}

const router = express.Router();

async function persistWebContextReceipt(db, { userId, conversationId, userMessageId, result }) {
  if (result.sources.length === 0) return null;
  const serializedContext = JSON.stringify(result.searchContext);
  if (Buffer.byteLength(serializedContext, 'utf8') > 64 * 1024) {
    throw new ChatWebContextError('web_context_evidence_too_large', 'Web research evidence exceeded its safe bound.', {
      status: 502,
      requestId: result.requestId,
    });
  }
  const requestHash = crypto.createHash('sha256')
    .update(`${userId}\0${conversationId}\0${userMessageId}\0${result.requestId}`)
    .digest('hex');
  const queryHash = crypto.createHash('sha256').update(String(result.searchContext.query)).digest('hex');
  const receipt = (await db.query(
    `INSERT INTO chat_web_context_receipts(
       user_id,conversation_id,user_message_id,request_id,request_hash,query_hash,search_context
     ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
     RETURNING id`,
    [userId, conversationId, userMessageId, result.requestId, requestHash, queryHash, serializedContext],
  )).rows[0];
  return receipt.id;
}

function projectWebContextResponse(result, webContextReceiptId) {
  return {
    operation: 'search-and-fetch',
    query: result.searchContext.query,
    sources: result.sources,
    job: result.job || null,
    webContextReceiptId,
    searchContext: result.searchContext,
  };
}

async function resolveWebContextTurn(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ ok: false, error: { code: 'unauthorized', message: 'Authentication required.', retryable: false } });
    return null;
  }
  const { query, count, mode, conversationId, depth = 'quick' } = req.body || {};
  if (mode !== 'research') {
    res.status(400).json({ ok: false, error: { code: 'invalid_web_context_mode', message: 'Research mode is required.', retryable: false } });
    return null;
  }
  if (depth !== 'quick' && depth !== 'deep') {
    res.status(400).json({ ok: false, error: { code: 'invalid_web_context_depth', message: 'Research depth must be quick or deep.', retryable: false } });
    return null;
  }
  if (!UUID_RE.test(String(conversationId || ''))) {
    res.status(400).json({ ok: false, error: { code: 'invalid_conversation_id', message: 'A persisted conversation is required.', retryable: false } });
    return null;
  }
  await requireResourceRelation(req.db, userPrincipal(userId), 'conversation', conversationId, 'reviewer');
  const latestUserMessage = (await req.db.query(
    `SELECT id FROM chat_messages
     WHERE conversation_id=$1 AND user_id=$2 AND role='user'
     ORDER BY message_index DESC LIMIT 1`,
    [conversationId, userId],
  )).rows[0];
  if (!latestUserMessage) {
    res.status(409).json({
      ok: false,
      error: { code: 'web_context_user_turn_missing', message: 'Save the user turn before starting web research.', retryable: true },
    });
    return null;
  }
  return { userId, query, count, conversationId, depth, userMessageId: latestUserMessage.id };
}

// POST /api/chat/web-context/search - canonical public-web research seam.
// The browser supplies intent only. Tenant, actor, budgets, provider authority,
// and persisted evidence are all owned by the server.
router.post('/web-context/search', requireActivated, async (req, res) => {
  const startedAt = Date.now();
  let userId = req.user?.id;

  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException('Client disconnected', 'AbortError'));
  req.once('aborted', abort);
  res.once('close', () => { if (!res.writableEnded) abort(); });

  try {
    const turn = await resolveWebContextTurn(req, res);
    if (!turn) return;
    userId = turn.userId;

    const result = await chatWebContextService.searchAndFetch({
      actorId: turn.userId,
      conversationId: turn.conversationId,
      userMessageId: turn.userMessageId,
      query: turn.query,
      count: turn.count,
      depth: turn.depth,
      signal: controller.signal,
    });
    const webContextReceiptId = await persistWebContextReceipt(req.db, {
      userId: turn.userId, conversationId: turn.conversationId, userMessageId: turn.userMessageId, result,
    });

    console.log('[ChatWebContext] completed', {
      requestId: result.requestId,
      userId,
      sourceCount: result.sources.length,
      terminalReason: result.terminalReason,
      durationMs: Date.now() - startedAt,
    });
    return res.json({
      ok: true,
      provenance: {
        kind: 'xeno-web-context',
        contractVersion: '1.0.0',
        requestId: result.requestId,
        evidenceId: result.searchEvidence?.evidenceId || null,
        retrievedAt: result.searchEvidence?.retrievedAt || null,
        terminalReason: result.terminalReason,
      },
      data: projectWebContextResponse(result, webContextReceiptId),
    });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    const shaped = error instanceof ChatWebContextError
      ? error
      : new ChatWebContextError('web_context_unavailable', 'Web research is temporarily unavailable.', {
          retryable: true,
          cause: error,
        });
    console.warn('[ChatWebContext] failed', {
      requestId: shaped.requestId,
      userId,
      code: shaped.code,
      durationMs: Date.now() - startedAt,
    });
    if (res.headersSent || controller.signal.aborted) return;
    return res.status(shaped.status || 503).json({
      ok: false,
      error: {
        code: shaped.code,
        message: shaped.message,
        retryable: Boolean(shaped.retryable),
        ...(shaped.requestId ? { requestId: shaped.requestId } : {}),
      },
    });
  }
});

// POST /api/chat/web-context/stream - authenticated canonical Research stream.
// Validation happens before switching protocols. After that, progress is the exact
// authority-free XENO Web Context projection and every failure is an SSE event.
router.post('/web-context/stream', requireActivated, async (req, res) => {
  const startedAt = Date.now();
  let turn;
  try {
    turn = await resolveWebContextTurn(req, res);
    if (!turn) return;
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    return res.status(503).json({ ok: false, error: { code: 'web_context_unavailable', message: 'Web research is temporarily unavailable.', retryable: true } });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(new DOMException('Client disconnected', 'AbortError'));
  };
  req.once('aborted', abort);
  res.once('close', () => { if (!res.writableEnded) abort(); });
  const writeEvent = (event, data) => {
    if (res.destroyed || res.writableEnded) return false;
    return res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await chatWebContextService.searchAndFetch({
      actorId: turn.userId,
      conversationId: turn.conversationId,
      userMessageId: turn.userMessageId,
      query: turn.query,
      count: turn.count,
      depth: turn.depth,
      signal: controller.signal,
      onProgress: (progress) => { writeEvent('progress', progress); },
    });
    const webContextReceiptId = await persistWebContextReceipt(req.db, {
      userId: turn.userId, conversationId: turn.conversationId, userMessageId: turn.userMessageId, result,
    });
    writeEvent('result', projectWebContextResponse(result, webContextReceiptId));
    writeEvent('done', { ok: true });
    console.log('[ChatWebContext] stream completed', {
      requestId: result.requestId,
      userId: turn.userId,
      sourceCount: result.sources.length,
      terminalReason: result.terminalReason,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (!controller.signal.aborted) {
      const shaped = error instanceof ChatWebContextError
        ? error
        : new ChatWebContextError('web_context_unavailable', 'Web research is temporarily unavailable.', { retryable: true, cause: error });
      writeEvent('error', {
        code: shaped.code,
        message: shaped.message,
        retryable: Boolean(shaped.retryable),
        ...(shaped.requestId ? { requestId: shaped.requestId } : {}),
      });
      writeEvent('done', { ok: false });
      console.warn('[ChatWebContext] stream failed', {
        requestId: shaped.requestId,
        userId: turn.userId,
        code: shaped.code,
        durationMs: Date.now() - startedAt,
      });
    }
  } finally {
    if (!res.destroyed && !res.writableEnded) res.end();
  }
});

// ============================================
// DATABASE INITIALIZATION
// ============================================

// POST /api/chat/init - Initialize chat tables
// SECURITY: This should only run in development or via a migration script
router.post('/init', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, error: 'Database initialization disabled in production. Use migration scripts.' });
    }
    // Create conversations table
    await req.db.query(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL DEFAULT 'New Chat',
        model_id VARCHAR(255),
        system_prompt TEXT,
        persona_id VARCHAR(50),
        interface_id VARCHAR(100) DEFAULT 'playground',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        last_message_at TIMESTAMP,
        deleted_at TIMESTAMP,
        is_archived BOOLEAN DEFAULT FALSE
      )
    `);

    // Create messages table
    await req.db.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        model_id VARCHAR(255),
        thinking TEXT,
        has_thinking BOOLEAN DEFAULT FALSE,
        attachments JSONB,
        search_context JSONB,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        message_index INTEGER NOT NULL
      )
    `);

    // Create personas table
    await req.db.query(`
      CREATE TABLE IF NOT EXISTS chat_personas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        description VARCHAR(500),
        prompt TEXT NOT NULL,
        icon VARCHAR(50),
        color VARCHAR(20),
        use_count INTEGER DEFAULT 0,
        last_used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        sort_order INTEGER DEFAULT 0,
        is_favorite BOOLEAN DEFAULT FALSE
      )
    `);

    // Create shared conversations table
    await req.db.query(`
      CREATE TABLE IF NOT EXISTS chat_shared_conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
        owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        share_token VARCHAR(64) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        revoked_at TIMESTAMP,
        accept_count INTEGER DEFAULT 0
      )
    `);

    // Create share acceptances table (tracks who accepted which shares)
    await req.db.query(`
      CREATE TABLE IF NOT EXISTS chat_share_acceptances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        share_id UUID NOT NULL REFERENCES chat_shared_conversations(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        new_conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
        accepted_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(share_id, user_id)
      )
    `);

    // Create indexes
    await req.db.query(`CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON chat_conversations(user_id, deleted_at)`);
    await req.db.query(`CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated ON chat_conversations(user_id, updated_at DESC)`);
    await req.db.query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, message_index)`);
    await req.db.query(`CREATE INDEX IF NOT EXISTS idx_chat_personas_user ON chat_personas(user_id, sort_order)`);
    await req.db.query(`CREATE INDEX IF NOT EXISTS idx_chat_shared_token ON chat_shared_conversations(share_token)`);
    await req.db.query(`CREATE INDEX IF NOT EXISTS idx_chat_shared_conv ON chat_shared_conversations(conversation_id, owner_id)`);

    console.log('✅ Chat tables initialized successfully');
    res.json({ success: true, message: 'Chat tables initialized' });
  } catch (error) {
    console.error('❌ Failed to initialize chat tables:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// CONVERSATION CRUD OPERATIONS
// ============================================

// GET /api/chat/conversations - List user's conversations
router.get('/conversations', async (req, res) => {
  try {
    console.log('[Conversations] GET request, user:', req.user?.id, req.user?.email);
    const userId = req.user?.id;
    if (!userId) {
      console.log('[Conversations] No user ID found');
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { interface_id = 'playground', include_archived = false } = req.query;
    // SECURITY: Sanitize and clamp pagination parameters to prevent abuse
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    let query = `
      SELECT
        c.id, c.title, c.model_id, c.system_prompt, c.persona_id,
        c.interface_id, c.created_at, c.updated_at, c.last_message_at,
        c.is_archived, c.project_id,
        (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = c.id) as message_count
      FROM chat_conversations c
      WHERE c.deleted_at IS NULL
        AND c.interface_id = $1
    `;

    const params = [interface_id];

    if (!include_archived || include_archived === 'false') {
      query += ` AND c.is_archived = FALSE`;
    }

    query += ` ORDER BY c.updated_at DESC`;

    const result = await req.db.query(query, params);
    const authorized = [];
    for (const conversation of result.rows) {
      const verdict = await check(req.db, {
        object: `conversation:${conversation.id}`,
        relation: 'viewer',
        subject: `user:${userId}`,
      });
      if (verdict.allowed) authorized.push(conversation);
    }
    const rows = authorized.slice(offset, offset + limit);
    console.log('[Conversations] Found', rows.length, 'authorized conversations for user:', userId);

    res.json({
      success: true,
      conversations: rows,
      total: authorized.length
    });
  } catch (error) {
    console.error('[Conversations] Failed to fetch:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/chat/conversations/:id - Get single conversation with messages
router.get('/conversations/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id } = req.params;
    if (rejectIfNotPersistedConversationId(res, id)) return;

    await requireResourceRelation(req.db, userPrincipal(userId), 'conversation', id, 'viewer');
    const convResult = await req.db.query(
      `SELECT * FROM chat_conversations WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    // Get messages
    const messagesResult = await req.db.query(
      `SELECT m.*,
              COALESCE(cm.context_manifest->'sources', '[]'::jsonb) AS project_sources
       FROM chat_messages m
       LEFT JOIN chat_message_context_manifests cm ON cm.message_id = m.id
       WHERE m.conversation_id = $1 ORDER BY m.message_index ASC`,
      [id]
    );

    res.json({
      success: true,
      conversation: {
        ...convResult.rows[0],
        messages: messagesResult.rows
      }
    });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to fetch conversation:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/chat/conversations - Create new conversation
router.post('/conversations', async (req, res) => {
  try {
    console.log('[Conversations] POST create request, user:', req.user?.id, 'body:', JSON.stringify(req.body));
    const userId = req.user?.id;
    if (!userId) {
      console.log('[Conversations] POST - No user ID found');
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { title = 'New Chat', model_id, system_prompt, persona_id, interface_id = 'playground', project_id } = req.body;

    if (project_id) await requireResourceRelation(req.db, userPrincipal(userId), 'project', project_id, 'reviewer');
    const wsCtx = workspaceFromReq(req);
    const wsId = (wsCtx && await isWorkspaceMember(req.db, wsCtx, userId)) ? wsCtx : null;
    const conversation = await withTransaction(req.db, async (tx) => {
      const project = project_id
        ? (await tx.query('SELECT workspace_id FROM chat_projects WHERE id = $1', [project_id])).rows[0]
        : null;
      const conversationWorkspaceId = project_id ? null : wsId;
      const conversationOwnerId = project_id || conversationWorkspaceId ? null : userId;
      const result = await tx.query(
        `INSERT INTO chat_conversations (
           user_id, owner_user_id, created_by_user_id, title, model_id, system_prompt,
           persona_id, interface_id, workspace_id, project_id
         ) VALUES ($1, $2, $1, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [userId, conversationOwnerId, title, model_id, system_prompt, persona_id,
          interface_id, conversationWorkspaceId, project_id || null],
      );
      await writeTuples(tx, {
        writes: [{
          object: `conversation:${result.rows[0].id}`,
          relation: project_id || conversationWorkspaceId ? 'parent' : 'owner',
          subject: project_id
            ? `project:${project_id}`
            : conversationWorkspaceId ? `workspace:${conversationWorkspaceId}` : `user:${userId}`,
        }],
      });
      return result.rows[0];
    });

    res.json({
      success: true,
      conversation,
    });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to create conversation:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/chat/conversations/:id - Update conversation
router.put('/conversations/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id } = req.params;
    if (rejectIfNotPersistedConversationId(res, id)) return;
    const { title, model_id, system_prompt, persona_id, is_archived, project_id } = req.body;

    await requireResourceRelation(req.db, userPrincipal(userId), 'conversation', id, 'editor');
    if (project_id !== undefined && project_id !== null) {
      await requireResourceRelation(req.db, userPrincipal(userId), 'project', project_id, 'editor');
    }

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(title);
    }
    if (model_id !== undefined) {
      updates.push(`model_id = $${paramCount++}`);
      values.push(model_id);
    }
    if (system_prompt !== undefined) {
      updates.push(`system_prompt = $${paramCount++}`);
      values.push(system_prompt);
    }
    if (persona_id !== undefined) {
      updates.push(`persona_id = $${paramCount++}`);
      values.push(persona_id);
    }
    if (is_archived !== undefined) {
      updates.push(`is_archived = $${paramCount++}`);
      values.push(is_archived);
    }
    if (project_id !== undefined) {
      updates.push(`project_id = $${paramCount++}`);
      values.push(project_id || null);
      if (project_id) {
        updates.push('owner_user_id = NULL');
        updates.push('workspace_id = NULL');
      }
    }

    updates.push(`updated_at = NOW()`);

    const result = await withTransaction(req.db, async (tx) => {
      const current = await tx.query(
        'SELECT id, project_id FROM chat_conversations WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [id],
      );
      if (current.rows.length === 0) return current;
      if (project_id === null && current.rows[0].project_id) {
        const detachError = new Error('A project conversation cannot be detached into unscoped access.');
        detachError.code = 'project_detach_forbidden';
        throw detachError;
      }
      values.push(id);
      const updated = await tx.query(
        `UPDATE chat_conversations
         SET ${updates.join(', ')}
         WHERE id = $${paramCount} AND deleted_at IS NULL
         RETURNING *`,
        values,
      );
      if (project_id !== undefined && project_id !== current.rows[0].project_id) {
        await tx.query(
          `DELETE FROM relationship_tuples
           WHERE object_type = 'conversation' AND object_id = $1 AND relation IN ('owner', 'parent')`,
          [id],
        );
        await writeTuples(tx, { writes: [{
          object: `conversation:${id}`,
          relation: project_id ? 'parent' : 'owner',
          subject: project_id ? `project:${project_id}` : `user:${userId}`,
        }] });
      }
      return updated;
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    res.json({
      success: true,
      conversation: result.rows[0]
    });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    if (error.code === 'project_detach_forbidden') {
      return res.status(409).json({ success: false, error: error.message, code: error.code });
    }
    console.error('Failed to update conversation:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/chat/conversations/:id - Soft delete conversation
router.delete('/conversations/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id } = req.params;
    if (rejectIfNotPersistedConversationId(res, id)) return;
    const { permanent = false } = req.query;

    await requireResourceRelation(req.db, userPrincipal(userId), 'conversation', id, 'admin');
    let result;
    if (permanent === 'true') {
      // Hard delete
      result = await req.db.query(
        `DELETE FROM chat_conversations WHERE id = $1 RETURNING id`,
        [id]
      );
    } else {
      // Soft delete
      result = await req.db.query(
        `UPDATE chat_conversations SET deleted_at = NOW() WHERE id = $1 RETURNING id`,
        [id]
      );
    }
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Conversation not found' });
    res.json({ success: true });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to delete conversation:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// MESSAGE OPERATIONS
// ============================================

// POST /api/chat/conversations/:id/messages - Add message to conversation
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id: conversationId } = req.params;
    if (rejectIfNotPersistedConversationId(res, conversationId)) return;
    const {
      role,
      content,
      model_id,
      thinking,
      has_thinking = false,
      attachments,
      search_context,
      web_context_receipt_id,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      context_record_id
    } = req.body;

    if (search_context !== undefined && search_context !== null) {
      return res.status(400).json({
        success: false,
        error: 'Web Context provenance is server-owned. Persist it with a valid receipt.',
        code: 'client_search_context_forbidden',
      });
    }

    if (web_context_receipt_id && (!UUID_RE.test(web_context_receipt_id) || role !== 'assistant')) {
      return res.status(400).json({
        success: false,
        error: 'A valid Web Context receipt may only be attached to an assistant message.',
        code: 'invalid_web_context_receipt',
      });
    }

    if (context_record_id && (!UUID_RE.test(context_record_id) || role !== 'assistant')) {
      return res.status(400).json({
        success: false,
        error: 'A valid context record may only be attached to an assistant message.',
        code: 'invalid_context_record',
      });
    }

    await requireResourceRelation(req.db, userPrincipal(userId), 'conversation', conversationId, 'reviewer');

    try {
      await assertAuthorizedLibraryAttachments(req.db, userPrincipal(userId), attachments);
    } catch (attachmentError) {
      const invalid = attachmentError.code === 'invalid_attachments' || attachmentError.code === 'invalid_library_asset_id';
      return res.status(invalid ? 400 : 404).json({
        success: false,
        error: attachmentError.message,
        code: attachmentError.code,
      });
    }

    const savedMessage = await withTransaction(req.db, async (tx) => {
      await tx.query('SELECT id FROM chat_conversations WHERE id = $1 FOR UPDATE', [conversationId]);
      let generationContext = null;
      let webContextReceipt = null;
      if (context_record_id) {
        generationContext = (await tx.query(
          `SELECT id, project_id, response_hash, context_manifest, safe_sources
           FROM chat_generation_contexts
           WHERE id=$1 AND conversation_id=$2 AND user_id=$3
             AND consumed_message_id IS NULL AND expires_at > NOW()
           FOR UPDATE`,
          [context_record_id, conversationId, userId],
        )).rows[0];
        if (!generationContext) {
          throw Object.assign(new Error('Project context record is invalid, expired, or already consumed.'), {
            code: 'invalid_context_record', status: 409,
          });
        }
        const responseHash = crypto.createHash('sha256').update(String(content || '')).digest('hex');
        if (!generationContext.response_hash || generationContext.response_hash !== responseHash) {
          throw Object.assign(new Error('Project context record does not match this assistant response.'), {
            code: 'invalid_context_record', status: 409,
          });
        }
      }
      if (web_context_receipt_id) {
        webContextReceipt = (await tx.query(
          `SELECT id, search_context
           FROM chat_web_context_receipts
           WHERE id=$1 AND conversation_id=$2 AND user_id=$3
             AND consumed_message_id IS NULL AND expires_at > NOW()
             AND user_message_id = (
               SELECT id FROM chat_messages
               WHERE conversation_id=$2 AND user_id=$3 AND role='user'
               ORDER BY message_index DESC LIMIT 1
             )
           FOR UPDATE`,
          [web_context_receipt_id, conversationId, userId],
        )).rows[0];
        if (!webContextReceipt) {
          throw Object.assign(new Error('Web Context receipt is invalid, expired, or already consumed.'), {
            code: 'invalid_web_context_receipt', status: 409,
          });
        }
      }
      const messageIndex = Number((await tx.query(
        `SELECT COALESCE(MAX(message_index), -1) + 1 as next_index
         FROM chat_messages WHERE conversation_id = $1`,
        [conversationId],
      )).rows[0].next_index);
      const inserted = (await tx.query(
        `INSERT INTO chat_messages (
          conversation_id, user_id, created_by_user_id, role, content, model_id,
          thinking, has_thinking, attachments, search_context,
          prompt_tokens, completion_tokens, total_tokens, message_index
        ) VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING *`,
        [conversationId, userId, role, content, model_id, thinking, has_thinking,
          attachments ? JSON.stringify(attachments) : null,
          webContextReceipt ? JSON.stringify(webContextReceipt.search_context) : null,
          prompt_tokens, completion_tokens, total_tokens, messageIndex],
      )).rows[0];
      if (generationContext) {
        await tx.query(
          `INSERT INTO chat_message_context_manifests(message_id,project_id,context_manifest)
           VALUES($1,$2,$3::jsonb)`,
          [inserted.id, generationContext.project_id, JSON.stringify(generationContext.context_manifest)],
        );
        await tx.query(
          'UPDATE chat_generation_contexts SET consumed_message_id=$2 WHERE id=$1',
          [generationContext.id, inserted.id],
        );
        inserted.project_sources = generationContext.safe_sources;
      } else {
        inserted.project_sources = [];
      }
      if (webContextReceipt) {
        await tx.query(
          'UPDATE chat_web_context_receipts SET consumed_message_id=$2 WHERE id=$1',
          [webContextReceipt.id, inserted.id],
        );
      }
      await tx.query(
        `UPDATE chat_conversations SET last_message_at=NOW(),updated_at=NOW(),
           title=CASE WHEN $2='user' AND $3=0 AND title='New Chat' THEN $4 ELSE title END
         WHERE id=$1`,
        [conversationId, role, messageIndex, content.substring(0, 60) + (content.length > 60 ? '...' : '')],
      );
      return inserted;
    });

    res.json({
      success: true,
      message: savedMessage
    });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    if (error.code === 'invalid_context_record' || error.code === 'invalid_web_context_receipt') {
      return res.status(error.status || 409).json({ success: false, error: error.message, code: error.code });
    }
    console.error('Failed to add message:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/chat/conversations/:id/messages/batch - Add multiple messages at once
router.post('/conversations/:id/messages/batch', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id: conversationId } = req.params;
    if (rejectIfNotPersistedConversationId(res, conversationId)) return;
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: 'Messages array required' });
    }

    if (messages.some((message) => message?.search_context != null || message?.web_context_receipt_id != null)) {
      return res.status(400).json({
        success: false,
        error: 'Authoritative Web Context evidence cannot be persisted through the batch endpoint.',
        code: 'client_search_context_forbidden',
      });
    }

    await requireResourceRelation(req.db, userPrincipal(userId), 'conversation', conversationId, 'reviewer');

    try {
      for (const message of messages) {
        await assertAuthorizedLibraryAttachments(req.db, userPrincipal(userId), message.attachments);
      }
    } catch (attachmentError) {
      const invalid = attachmentError.code === 'invalid_attachments' || attachmentError.code === 'invalid_library_asset_id';
      return res.status(invalid ? 400 : 404).json({
        success: false,
        error: attachmentError.message,
        code: attachmentError.code,
      });
    }

    // Get starting message index
    const indexResult = await req.db.query(
      `SELECT COALESCE(MAX(message_index), -1) + 1 as next_index FROM chat_messages WHERE conversation_id = $1`,
      [conversationId]
    );
    let messageIndex = indexResult.rows[0].next_index;

    // Insert all messages
    const insertedMessages = [];
    for (const msg of messages) {
      const result = await req.db.query(
        `INSERT INTO chat_messages (
          conversation_id, user_id, created_by_user_id, role, content, model_id,
          thinking, has_thinking, attachments, search_context,
          prompt_tokens, completion_tokens, total_tokens, message_index
        ) VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`,
        [
          conversationId, userId, msg.role, msg.content, msg.model_id,
          msg.thinking, msg.has_thinking || false,
          msg.attachments ? JSON.stringify(msg.attachments) : null,
          null,
          msg.prompt_tokens, msg.completion_tokens, msg.total_tokens, messageIndex++
        ]
      );
      insertedMessages.push(result.rows[0]);
    }

    // Update conversation timestamps
    await req.db.query(
      `UPDATE chat_conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [conversationId]
    );

    res.json({
      success: true,
      messages: insertedMessages
    });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to add messages batch:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/chat/messages/:id - Update a message
router.put('/messages/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id: messageId } = req.params;
    const { content, thinking, has_thinking } = req.body;

    const msgCheck = await req.db.query(
      `SELECT id, conversation_id FROM chat_messages WHERE id = $1`,
      [messageId]
    );

    if (msgCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }
    await requireResourceRelation(
      req.db,
      userPrincipal(userId),
      'conversation',
      msgCheck.rows[0].conversation_id,
      'reviewer',
    );

    // Build update query dynamically based on provided fields
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(content);
      updates.push('search_context = NULL');
    }
    if (thinking !== undefined) {
      updates.push(`thinking = $${paramIndex++}`);
      values.push(thinking);
    }
    if (has_thinking !== undefined) {
      updates.push(`has_thinking = $${paramIndex++}`);
      values.push(has_thinking);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(messageId);
    const result = await req.db.query(
      `UPDATE chat_messages SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    res.json({
      success: true,
      message: result.rows[0]
    });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to update message:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/chat/messages/:id - Delete a single message.
// Used by the chat module's edit/regenerate truncation to drop the trailing
// (pre-edit / pre-regenerate) turns durably, so they don't resurrect on reload.
// Authorization inherits from the owning conversation/project.
router.delete('/messages/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id: messageId } = req.params;
    const message = await req.db.query('SELECT conversation_id FROM chat_messages WHERE id = $1', [messageId]);
    if (message.rows.length === 0) return res.status(404).json({ success: false, error: 'Message not found' });
    await requireResourceRelation(
      req.db,
      userPrincipal(userId),
      'conversation',
      message.rows[0].conversation_id,
      'reviewer',
    );
    const result = await req.db.query(
      `DELETE FROM chat_messages WHERE id = $1 RETURNING id`,
      [messageId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to delete message:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// PERSONA OPERATIONS
// ============================================

// GET /api/chat/personas - List user's custom personas
router.get('/personas', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const result = await req.db.query(
      `SELECT * FROM chat_personas WHERE user_id = $1 ORDER BY is_favorite DESC, sort_order ASC, created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      personas: result.rows
    });
  } catch (error) {
    console.error('Failed to fetch personas:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/chat/personas - Create custom persona
router.post('/personas', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { name, description, prompt, icon, color } = req.body;

    if (!name || !prompt) {
      return res.status(400).json({ success: false, error: 'Name and prompt are required' });
    }

    const result = await req.db.query(
      `INSERT INTO chat_personas (user_id, name, description, prompt, icon, color)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, name, description, prompt, icon, color]
    );

    res.json({
      success: true,
      persona: result.rows[0]
    });
  } catch (error) {
    console.error('Failed to create persona:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/chat/personas/:id - Update persona
router.put('/personas/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id } = req.params;
    const { name, description, prompt, icon, color, is_favorite, sort_order } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) { updates.push(`name = $${paramCount++}`); values.push(name); }
    if (description !== undefined) { updates.push(`description = $${paramCount++}`); values.push(description); }
    if (prompt !== undefined) { updates.push(`prompt = $${paramCount++}`); values.push(prompt); }
    if (icon !== undefined) { updates.push(`icon = $${paramCount++}`); values.push(icon); }
    if (color !== undefined) { updates.push(`color = $${paramCount++}`); values.push(color); }
    if (is_favorite !== undefined) { updates.push(`is_favorite = $${paramCount++}`); values.push(is_favorite); }
    if (sort_order !== undefined) { updates.push(`sort_order = $${paramCount++}`); values.push(sort_order); }

    updates.push(`updated_at = NOW()`);
    values.push(id, userId);

    const result = await req.db.query(
      `UPDATE chat_personas SET ${updates.join(', ')}
       WHERE id = $${paramCount++} AND user_id = $${paramCount}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Persona not found' });
    }

    res.json({
      success: true,
      persona: result.rows[0]
    });
  } catch (error) {
    console.error('Failed to update persona:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/chat/personas/:id - Delete persona
router.delete('/personas/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id } = req.params;

    await req.db.query(
      `DELETE FROM chat_personas WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete persona:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/chat/personas/:id/use - Track persona usage
router.post('/personas/:id/use', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id } = req.params;

    await req.db.query(
      `UPDATE chat_personas SET use_count = use_count + 1, last_used_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to track persona usage:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// SYNC OPERATIONS
// ============================================

// ============================================
// SHARE OPERATIONS
// ============================================

// POST /api/chat/conversations/:id/share - Create a share link for a conversation
router.post('/conversations/:id/share', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id: conversationId } = req.params;
    if (rejectIfNotPersistedConversationId(res, conversationId)) return;
    const { expires_in_days = 7, visibility = 'public' } = req.body;
    if (!['public', 'workspace'].includes(visibility)) {
      return res.status(400).json({ success: false, error: 'visibility must be public or workspace', code: 'invalid_share_visibility' });
    }
    const expiryDays = Number(expires_in_days);
    if (!Number.isInteger(expiryDays) || expiryDays < 1 || expiryDays > 30) {
      return res.status(400).json({ success: false, error: 'expires_in_days must be between 1 and 30', code: 'invalid_share_expiry' });
    }

    await requireResourceRelation(req.db, userPrincipal(userId), 'conversation', conversationId, 'admin');
    const convCheck = await req.db.query(
      `SELECT c.id, c.title, COALESCE(c.workspace_id, p.workspace_id) AS workspace_id
       FROM chat_conversations c
       LEFT JOIN chat_projects p ON p.id = c.project_id
       WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [conversationId],
    );

    if (convCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }
    if (visibility === 'workspace' && !convCheck.rows[0].workspace_id) {
      return res.status(400).json({ success: false, error: 'Workspace sharing requires a workspace conversation', code: 'workspace_share_requires_workspace' });
    }

    // Generate unique share token
    const shareToken = crypto.randomBytes(32).toString('hex');
    const tokenDigest = crypto.createHash('sha256').update(shareToken).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    // Create share record
    const result = await req.db.query(
      `INSERT INTO chat_shared_conversations (
         conversation_id, owner_id, share_token, token_digest, visibility, workspace_id, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [conversationId, userId, shareToken, tokenDigest, visibility, visibility === 'workspace' ? convCheck.rows[0].workspace_id : null, expiresAt]
    );

    const shareUrl = `${req.protocol}://${req.get('host')}/overview/chat/shared/${shareToken}`;

    res.json({
      success: true,
      share: {
        ...result.rows[0],
        share_url: shareUrl,
        conversation_title: convCheck.rows[0].title
      }
    });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to create share link:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/chat/share/:token - Get shared conversation details (public endpoint - no auth required)
router.get('/share/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Get share record
    const shareResult = await req.db.query(
      `SELECT s.*, c.title, c.model_id, c.created_at AS conversation_created_at,
              u.email as owner_email, u.display_name as owner_name
       FROM chat_shared_conversations s
       JOIN chat_conversations c ON c.id = s.conversation_id
       JOIN users u ON u.id = s.owner_id
       WHERE s.token_digest = $1
         AND s.expires_at > NOW() AND s.revoked_at IS NULL`,
      [crypto.createHash('sha256').update(token).digest('hex')]
    );

    if (shareResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Share link not found or expired' });
    }

    const share = shareResult.rows[0];
    if (share.visibility === 'workspace') {
      if (!req.user?.id) return res.status(401).json({ success: false, error: 'Authentication required for workspace share' });
      const access = await check(req.db, {
        object: `workspace:${share.workspace_id}`,
        relation: 'viewer',
        subject: `user:${req.user.id}`,
      });
      if (!access.allowed) return res.status(404).json({ success: false, error: 'Share link not found or expired' });
    }

    // Get conversation messages
    const messagesResult = await req.db.query(
      `SELECT id, role, content, model_id, created_at, message_index
       FROM chat_messages WHERE conversation_id = $1 ORDER BY message_index ASC`,
      [share.conversation_id]
    );
    const publicMessages = serializePublicConversationMessages(messagesResult.rows);

    res.json({
      success: true,
      share: {
        id: share.id,
        conversation_id: share.conversation_id,
        title: share.title,
        model_id: share.model_id,
        created_at: share.conversation_created_at,
        owner_name: share.owner_name || share.owner_email,
        expires_at: share.expires_at,
        messages: publicMessages
      }
    });
  } catch (error) {
    console.error('Failed to get shared conversation:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/chat/share/:token/accept - Accept a shared conversation and copy to user's account
router.post('/share/:token/accept', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { token } = req.params;

    // Get share record
    const shareResult = await req.db.query(
      `SELECT s.*, c.title, c.model_id, c.interface_id
       FROM chat_shared_conversations s
       JOIN chat_conversations c ON c.id = s.conversation_id
       WHERE s.token_digest = $1
         AND s.expires_at > NOW() AND s.revoked_at IS NULL`,
      [crypto.createHash('sha256').update(token).digest('hex')]
    );

    if (shareResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Share link not found or expired' });
    }

    const share = shareResult.rows[0];
    if (share.visibility === 'workspace') {
      const access = await check(req.db, {
        object: `workspace:${share.workspace_id}`,
        relation: 'viewer',
        subject: `user:${userId}`,
      });
      if (!access.allowed) return res.status(404).json({ success: false, error: 'Share link not found or expired' });
    }

    // Check if user already accepted this share
    const existingCheck = await req.db.query(
      `SELECT id FROM chat_conversations WHERE id = ANY(
        SELECT new_conversation_id FROM chat_share_acceptances WHERE share_id = $1 AND user_id = $2
      )`,
      [share.id, userId]
    );

    if (existingCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'You have already accepted this shared conversation',
        existing_conversation_id: existingCheck.rows[0].id
      });
    }

    const messagesResult = await req.db.query(
      `SELECT id, role, content, model_id, created_at, message_index
       FROM chat_messages WHERE conversation_id = $1 ORDER BY message_index ASC`,
      [share.conversation_id]
    );
    const publicMessages = serializePublicConversationMessages(messagesResult.rows);
    const newConversation = await withTransaction(req.db, async (tx) => {
      const newConvResult = await tx.query(
        `INSERT INTO chat_conversations (
           user_id, owner_user_id, created_by_user_id, title, model_id, system_prompt, interface_id
         ) VALUES ($1, $1, $1, $2, $3, NULL, $4)
         RETURNING *`,
        [userId, `${share.title} (Shared)`, share.model_id, share.interface_id || 'playground'],
      );
      const created = newConvResult.rows[0];
      await writeTuples(tx, { writes: [{ object: `conversation:${created.id}`, relation: 'owner', subject: `user:${userId}` }] });
      for (const msg of publicMessages) {
        await tx.query(
          `INSERT INTO chat_messages (
            conversation_id, user_id, created_by_user_id, role, content, model_id,
            thinking, has_thinking, attachments, search_context,
            prompt_tokens, completion_tokens, total_tokens, message_index
          ) VALUES ($1,$2,$2,$3,$4,$5,$6,$7,NULL,NULL,$8,$9,$10,$11)`,
          [created.id, userId, msg.role, msg.content, msg.model_id,
            null, false, null, null, null, msg.message_index],
        );
      }
      await tx.query(
        `INSERT INTO chat_share_acceptances (share_id, user_id, new_conversation_id) VALUES ($1,$2,$3)`,
        [share.id, userId, created.id],
      );
      await tx.query('UPDATE chat_shared_conversations SET accept_count = accept_count + 1 WHERE id = $1', [share.id]);
      return created;
    });

    res.json({
      success: true,
      conversation: {
        ...newConversation,
        messages: publicMessages
      }
    });
  } catch (error) {
    console.error('Failed to accept shared conversation:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/chat/conversations/:id/share - Revoke a share link
router.delete('/conversations/:id/share', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id: conversationId } = req.params;
    if (rejectIfNotPersistedConversationId(res, conversationId)) return;
    await requireResourceRelation(req.db, userPrincipal(userId), 'conversation', conversationId, 'admin');

    // Revoke all active shares for this conversation
    await req.db.query(
      `UPDATE chat_shared_conversations SET revoked_at = NOW()
       WHERE conversation_id = $1 AND revoked_at IS NULL`,
      [conversationId]
    );

    res.json({ success: true });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to revoke share link:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/chat/conversations/:id/shares - List all share links for a conversation
router.get('/conversations/:id/shares', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id: conversationId } = req.params;
    if (rejectIfNotPersistedConversationId(res, conversationId)) return;
    await requireResourceRelation(req.db, userPrincipal(userId), 'conversation', conversationId, 'admin');

    const result = await req.db.query(
      `SELECT id, conversation_id, visibility, workspace_id, expires_at, revoked_at, accept_count, created_at
       FROM chat_shared_conversations
       WHERE conversation_id = $1
       ORDER BY created_at DESC`,
      [conversationId]
    );

    res.json({
      success: true,
      shares: result.rows
    });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to list share links:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// SYNC OPERATIONS
// ============================================

// POST /api/chat/sync - Sync local conversations to server (for migration)
router.post('/sync', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { conversations } = req.body;

    if (!Array.isArray(conversations)) {
      return res.status(400).json({ success: false, error: 'Conversations array required' });
    }

    const syncedConversations = [];

    for (const conv of conversations) {
      // Create conversation
      const convResult = await req.db.query(
        `INSERT INTO chat_conversations (
           user_id, owner_user_id, created_by_user_id, title, model_id, system_prompt,
           persona_id, interface_id, created_at, updated_at
         ) VALUES ($1, $1, $1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          userId,
          conv.title || 'Imported Chat',
          conv.model_id,
          conv.systemPrompt || conv.system_prompt,
          conv.persona_id,
          conv.interface_id || 'playground',
          conv.timestamp ? new Date(conv.timestamp) : new Date(),
          new Date()
        ]
      );

      const newConversation = convResult.rows[0];

      // Insert messages
      if (Array.isArray(conv.messages)) {
        for (let i = 0; i < conv.messages.length; i++) {
          const msg = conv.messages[i];
          await req.db.query(
            `INSERT INTO chat_messages (
               conversation_id, user_id, created_by_user_id, role, content, model_id,
               thinking, has_thinking, attachments, message_index, created_at
             ) VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              newConversation.id,
              userId,
              msg.role || msg.sender,
              msg.content || msg.text,
              msg.model_id || msg.modelId,
              msg.thinking,
              msg.hasThinking || false,
              msg.files ? JSON.stringify(msg.files) : null,
              i,
              msg.timestamp ? new Date(msg.timestamp) : new Date()
            ]
          );
        }
      }

      syncedConversations.push(newConversation);
    }

    res.json({
      success: true,
      synced: syncedConversations.length,
      conversations: syncedConversations
    });
  } catch (error) {
    console.error('Failed to sync conversations:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// ACCOUNT LIBRARY ROUTES
// ============================================

// The Library is a read model over the account-owned stores that already back
// chat artifacts, uploads, and image generation. Keeping the read model here
// avoids creating a fourth storage silo while giving the UI one stable contract.
router.get('/library', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const result = await listLibraryItems(req.db, userId, req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Failed to list account library:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Streams only blobs created by the platform upload pipeline. `user_files`
// also contains client-side recent-file metadata, whose storage_path is not a
// trusted server path and must never become a filesystem read primitive.
router.get('/library/file/:id/content', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid file id' });
    }

    const file = await getAuthorizedLibraryFile(req.db, userPrincipal(userId), req.params.id);
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    if (!file.ingestion_safe) return res.status(423).json({ success: false, error: 'File is still in security quarantine', code: 'asset_quarantined' });
    const resolved = resolveManagedLibraryPath(file.storage_path);
    if (!resolved) {
      return res.status(404).json({ success: false, error: 'File data not found' });
    }

    const name = String(file.original_name || file.filename || 'download').replace(/[\r\n"]/g, '_');
    const inlineMime = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
    const disposition = req.query.download === '1' || !inlineMime.has(file.mime_type)
      ? 'attachment'
      : 'inline';
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', String(file.file_size || fs.statSync(resolved).size));
    res.setHeader('Content-Disposition', `${disposition}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    fs.createReadStream(resolved).pipe(res);
  } catch (error) {
    console.error('Failed to stream library file:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/library/:source/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid library item id' });
    }

    const source = String(req.params.source);
    const result = await deleteLibraryItem(req.db, userPrincipal(userId), source, req.params.id);
    if (result.unsupported) return res.status(400).json({ success: false, error: 'Unsupported library source' });
    if (result.conflict) return res.status(409).json({ success: false, error: 'Library asset is linked to an active project', code: 'asset_has_project_references', reference_count: result.referenceCount });

    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Library item not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete library item:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// ARTIFACTS ROUTES
// ============================================

// GET /api/chat/artifacts - List artifacts with filter, sort, and pagination
router.get('/artifacts', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { kind, sort = 'updated', query } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let sql = `SELECT a.*, c.title AS conversation_title 
               FROM chat_artifacts a 
               LEFT JOIN chat_conversations c ON a.conversation_id = c.id
               WHERE a.is_archived = FALSE`;
    const params = [];

    if (kind && kind !== 'all') {
      params.push(kind);
      sql += ` AND a.kind = $${params.length}`;
    }

    if (query && query.trim()) {
      params.push(`%${query.trim()}%`);
      sql += ` AND (a.title ILIKE $${params.length} OR a.preview_text ILIKE $${params.length})`;
    }

    if (sort === 'name') sql += ` ORDER BY a.title ASC`;
    else if (sort === 'created') sql += ` ORDER BY a.created_at DESC`;
    else sql += ` ORDER BY a.updated_at DESC`;

    const { rows: candidates } = await req.db.query(sql, params);
    const authorized = [];
    for (const artifact of candidates) {
      const verdict = await check(req.db, {
        object: `artifact:${artifact.id}`,
        relation: 'viewer',
        subject: `user:${userId}`,
      });
      if (verdict.allowed) authorized.push(artifact);
    }
    res.json({ success: true, artifacts: authorized.slice(offset, offset + limit), limit, offset });
  } catch (error) {
    console.error('Failed to list artifacts:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/chat/artifacts/:id - Get single artifact
router.get('/artifacts/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    await requireResourceRelation(req.db, userPrincipal(userId), 'artifact', id, 'viewer');
    const { rows } = await req.db.query(
      `SELECT a.*, c.title AS conversation_title 
       FROM chat_artifacts a 
       LEFT JOIN chat_conversations c ON a.conversation_id = c.id
       WHERE a.id = $1`,
      [id]
    );

    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Artifact not found' });
    res.json({ success: true, artifact: rows[0] });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to get artifact:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/chat/artifacts - Create or save artifact
router.post('/artifacts', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { title, kind, language, content, preview_text, conversation_id, message_id } = req.body;
    if (!title || !kind || !content) {
      return res.status(400).json({ success: false, error: 'title, kind, and content are required' });
    }
    if (await rejectUnownedChatReferences(req, res, {
      conversationId: conversation_id,
      messageId: message_id,
    })) return;

    const preview = preview_text || content.slice(0, 160).replace(/[\r\n]+/g, ' ');

    const artifact = await withTransaction(req.db, async (tx) => {
      const conversation = conversation_id
        ? (await tx.query('SELECT owner_user_id, project_id, workspace_id FROM chat_conversations WHERE id = $1', [conversation_id])).rows[0]
        : null;
      const artifactOwnerId = conversation
        ? conversation.owner_user_id
        : userId;
      const { rows } = await tx.query(
        `INSERT INTO chat_artifacts (
          user_id, conversation_id, message_id, title, kind, language, content, preview_text,
          owner_user_id, created_by_user_id, project_id, workspace_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$1,$10,$11)
        RETURNING *`,
        [userId, conversation_id || null, message_id || null, title, kind, language || null,
          content, preview, artifactOwnerId || null, conversation?.project_id || null,
          conversation?.project_id ? null : conversation?.workspace_id || null],
      );
      await writeTuples(tx, { writes: [{
        object: `artifact:${rows[0].id}`,
        relation: conversation?.project_id || conversation?.workspace_id ? 'parent' : 'owner',
        subject: conversation?.project_id
          ? `project:${conversation.project_id}`
          : conversation?.workspace_id ? `workspace:${conversation.workspace_id}` : `user:${userId}`,
      }] });
      return rows[0];
    });

    res.json({ success: true, artifact });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to create artifact:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/chat/artifacts/:id - Delete artifact
router.delete('/artifacts/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    await requireResourceRelation(req.db, userPrincipal(userId), 'artifact', id, 'admin');
    const result = await req.db.query('DELETE FROM chat_artifacts WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Artifact not found' });
    res.json({ success: true });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to delete artifact:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// SCHEDULED AUTOMATION TASKS ROUTES
// ============================================

// GET /api/chat/scheduled - List scheduled tasks with pagination
router.get('/scheduled', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { status, sort = 'next', query, project_id } = req.query;
    if (project_id && await rejectUnownedChatReferences(req, res, { projectId: project_id })) return;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let sql = `SELECT * FROM chat_scheduled_tasks WHERE TRUE`;
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    if (query && query.trim()) {
      params.push(`%${query.trim()}%`);
      sql += ` AND (title ILIKE $${params.length} OR prompt ILIKE $${params.length} OR cadence_label ILIKE $${params.length})`;
    }

    if (project_id) {
      params.push(project_id);
      sql += ` AND project_id = $${params.length}`;
    }

    if (sort === 'name') sql += ` ORDER BY title ASC`;
    else if (sort === 'updated') sql += ` ORDER BY updated_at DESC`;
    else sql += ` ORDER BY next_run_at ASC`;

    const { rows: candidates } = await req.db.query(sql, params);
    const authorized = [];
    for (const task of candidates) {
      const verdict = await check(req.db, {
        object: `schedule:${task.id}`, relation: 'viewer', subject: `user:${userId}`,
      });
      if (verdict.allowed) authorized.push(task);
    }
    res.json({ success: true, tasks: authorized.slice(offset, offset + limit), limit, offset });
  } catch (error) {
    console.error('Failed to list scheduled tasks:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/scheduled/preview', async (req, res) => {
  try {
    const occurrences = calculateScheduleOccurrences({
      scheduleKind: req.body?.schedule_kind,
      dtstartLocal: req.body?.dtstart_local,
      timeZone: req.body?.timezone,
      rrule: req.body?.rrule || null,
      after: req.body?.after || null,
      limit: req.body?.limit || 5,
    });
    res.json({ success: true, occurrences: occurrences.map((date) => date.toISOString()) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message, code: error.code || 'invalid_recurrence' });
  }
});

// POST /api/chat/scheduled - Create scheduled task
router.post('/scheduled', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const {
      title, prompt, cadence = 'daily', cadence_label,
      model_id = 'google/gemini-2.5-flash-preview-05-20', conversation_id, project_id,
      next_run_at, schedule_kind, timezone = 'UTC', dtstart_local, rrule,
      misfire_policy = 'run_once', overlap_policy = 'skip',
      max_catch_up_runs = 1, catch_up_window_seconds = 86400, max_attempts = 3,
    } = req.body;
    if (!title || !prompt) {
      return res.status(400).json({ success: false, error: 'title and prompt are required' });
    }
    if (conversation_id) await requireResourceRelation(req.db, userPrincipal(userId), 'conversation', conversation_id, 'reviewer');
    if (project_id) await requireResourceRelation(req.db, userPrincipal(userId), 'project', project_id, 'editor');

    const label = cadence_label || (cadence === 'daily' ? 'Every day' : cadence === 'weekly' ? 'Every week' : 'Once');
    const requestedNextRun = next_run_at ? new Date(next_run_at) : null;
    if (requestedNextRun && Number.isNaN(requestedNextRun.getTime())) {
      return res.status(400).json({ success: false, error: 'next_run_at must be a valid ISO timestamp' });
    }
    if (requestedNextRun && requestedNextRun.getTime() <= Date.now()) {
      return res.status(400).json({ success: false, error: 'next_run_at must be in the future' });
    }
    const kind = schedule_kind || (cadence === 'once' ? 'once' : 'recurring');
    const localStart = dtstart_local || (requestedNextRun || computeNextRun(cadence, new Date())).toISOString().slice(0, 19);
    const recurrenceRule = kind === 'recurring'
      ? (rrule || (cadence === 'weekly' ? 'FREQ=WEEKLY' : cadence === 'monthly' ? 'FREQ=MONTHLY' : 'FREQ=DAILY'))
      : null;
    const nextRun = calculateNextScheduleOccurrence({
      scheduleKind: kind,
      dtstartLocal: localStart,
      timeZone: timezone,
      rrule: recurrenceRule,
      after: new Date(Date.now() - 1000),
    });
    if (!nextRun) return res.status(400).json({ success: false, error: 'Schedule has no future occurrence' });

    const task = await withTransaction(req.db, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO chat_scheduled_tasks (
          user_id, created_by_user_id, run_as_user_id, conversation_id, project_id,
          title, prompt, model_id, cadence, cadence_label, next_run_at,
          schedule_kind, timezone, timezone_source, dtstart_local, rrule,
          misfire_policy, overlap_policy, max_catch_up_runs, catch_up_window_seconds, max_attempts
        ) VALUES ($1,$1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'user_confirmed',$12,$13,$14,$15,$16,$17,$18)
        RETURNING *`,
        [
          userId, conversation_id || null, project_id || null, title, prompt, model_id, cadence, label, nextRun,
          kind, timezone, localStart, recurrenceRule, misfire_policy, overlap_policy,
          max_catch_up_runs, catch_up_window_seconds, max_attempts,
        ],
      );
      await writeTuples(tx, { writes: [{
        object: `schedule:${rows[0].id}`,
        relation: project_id ? 'parent' : 'owner',
        subject: project_id ? `project:${project_id}` : `user:${userId}`,
      }] });
      return rows[0];
    });

    res.json({ success: true, task });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    if (['invalid_timezone', 'invalid_recurrence'].includes(error.code)) {
      return res.status(400).json({ success: false, error: error.message, code: error.code });
    }
    console.error('Failed to create scheduled task:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/chat/scheduled/:id - Update scheduled task
router.put('/scheduled/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    const { title, prompt, cadence, cadence_label, status, model_id, schedule_kind, timezone, dtstart_local, rrule } = req.body;

    await requireResourceRelation(req.db, userPrincipal(userId), 'schedule', id, 'editor');
    const existing = await req.db.query('SELECT * FROM chat_scheduled_tasks WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, error: 'Task not found' });

    const task = existing.rows[0];
    const kind = schedule_kind || task.schedule_kind;
    const zone = timezone || task.timezone;
    const local = dtstart_local || String(task.dtstart_local).replace(' ', 'T').replace(/Z$/, '').slice(0, 19);
    const rule = kind === 'recurring' ? (rrule ?? task.rrule) : null;
    const recurrenceChanged = schedule_kind !== undefined || timezone !== undefined || dtstart_local !== undefined || rrule !== undefined;
    const nextRun = recurrenceChanged ? calculateNextScheduleOccurrence({
      scheduleKind: kind, dtstartLocal: local, timeZone: zone, rrule: rule, after: new Date(),
    }) : task.next_run_at;

    const { rows } = await req.db.query(
      `UPDATE chat_scheduled_tasks SET
        title = COALESCE($1, title),
        prompt = COALESCE($2, prompt),
        cadence = COALESCE($3, cadence),
        cadence_label = COALESCE($4, cadence_label),
        status = COALESCE($5, status),
        model_id = COALESCE($6, model_id),
        next_run_at = $7,
        schedule_kind = $9,
        timezone = $10,
        dtstart_local = $11,
        rrule = $12,
        updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [title, prompt, cadence, cadence_label, status, model_id, nextRun, id, kind, zone, local, rule]
    );

    res.json({ success: true, task: rows[0] });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    if (['invalid_timezone', 'invalid_recurrence'].includes(error.code)) {
      return res.status(400).json({ success: false, error: error.message, code: error.code });
    }
    console.error('Failed to update scheduled task:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/chat/scheduled/:id - Delete scheduled task
router.delete('/scheduled/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    await requireResourceRelation(req.db, userPrincipal(userId), 'schedule', id, 'editor');
    await req.db.query(
      "UPDATE chat_scheduled_tasks SET status = 'cancelled', paused_reason = 'cancelled_by_user', updated_at = NOW() WHERE id = $1",
      [id],
    );
    res.json({ success: true });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to delete scheduled task:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/chat/scheduled/:id/run - Immediate trigger of scheduled task
router.post(['/scheduled/:id/run', '/scheduled/:id/run-now'], async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    await requireResourceRelation(req.db, userPrincipal(userId), 'schedule', id, 'editor');
    const { rows } = await req.db.query('SELECT * FROM chat_scheduled_tasks WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Task not found' });

    const result = await executeScheduledTask(req.db, rows[0]);
    res.json({ success: true, result });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to execute scheduled task:', error);
    res.status(500).json({ success: false, error: error.message || 'Execution failed' });
  }
});

router.get('/scheduled/:id/runs', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    await requireResourceRelation(req.db, userPrincipal(userId), 'schedule', req.params.id, 'viewer');
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const { rows } = await req.db.query(
      `SELECT id, task_id, occurrence_key, scheduled_for, status, attempt_count, conversation_id,
              model_id, provider_request_id, error_code, created_at, started_at, completed_at
       FROM chat_scheduled_runs WHERE task_id = $1 ORDER BY scheduled_for DESC LIMIT $2`,
      [req.params.id, limit],
    );
    res.json({
      success: true,
      runs: rows.map((row) => ({
        ...row,
        error_message: row.error_code ? sanitizeScheduledRunError(row.error_code) : null,
      })),
    });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to list scheduled runs:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/scheduled-runs/:id/retry', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const current = (await req.db.query(
      `SELECT r.*,t.id AS schedule_id FROM chat_scheduled_runs r
       JOIN chat_scheduled_tasks t ON t.id=r.task_id WHERE r.id=$1`,
      [req.params.id],
    )).rows[0];
    if (!current) return res.status(404).json({ success: false, error: 'Run not found', code: 'run_not_found' });
    await requireResourceRelation(req.db, userPrincipal(userId), 'schedule', current.schedule_id, 'editor');
    if (!['failed', 'reconciliation_required'].includes(current.status)) {
      return res.status(409).json({ success: false, error: 'Only failed or reconciliation-required runs can be retried', code: 'run_not_retryable' });
    }
    if (current.status === 'reconciliation_required' && req.body?.acknowledge_duplicate_charge !== true) {
      return res.status(409).json({
        success: false,
        error: 'The prior provider outcome is unknown. Retrying may create another provider charge.',
        code: 'duplicate_charge_acknowledgement_required',
      });
    }
    const run = (await req.db.query(
      `UPDATE chat_scheduled_runs SET status='pending',error_code=NULL,error_message=NULL,
       lease_owner=NULL,lease_expires_at=NULL,completed_at=NULL,
       gateway_retry_authorized=($2::boolean),manual_retry_authorized=TRUE,updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [req.params.id, current.status === 'reconciliation_required'],
    )).rows[0];
    res.json({ success: true, run });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to retry scheduled run:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// SKILLS LIBRARY ROUTES
// ============================================

// GET /api/chat/skills - List skills
router.get('/skills', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { visibility, conversation_id } = req.query;
    let sql = `SELECT * FROM chat_skills WHERE TRUE`;
    const params = [];

    if (visibility) {
      params.push(visibility);
      sql += ` AND visibility = $${params.length}`;
    }
    if (conversation_id) {
      params.push(conversation_id);
      sql += ` AND conversation_id = $${params.length}`;
    }

    sql += ` ORDER BY updated_at DESC`;
    const { rows } = await req.db.query(sql, params);
    const authorized = [];
    for (const skill of rows) {
      const verdict = await check(req.db, {
        object: `skill:${skill.id}`, relation: 'viewer', subject: `user:${userId}`,
      });
      if (verdict.allowed) authorized.push(skill);
    }
    res.json({ success: true, skills: authorized });
  } catch (error) {
    console.error('Failed to list skills:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/chat/skills - Create skill
router.post('/skills', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { name, summary, body, author = 'You', source = 'created', visibility = 'global', conversation_id, category = 'general' } = req.body;
    if (!name || !body) return res.status(400).json({ success: false, error: 'name and body are required' });
    if (conversation_id) {
      await requireResourceRelation(req.db, userPrincipal(userId), 'conversation', conversation_id, 'editor');
    }
    const skill = await withTransaction(req.db, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO chat_skills (
          user_id, owner_user_id, created_by_user_id, name, summary, body,
          author, source, visibility, conversation_id, category
        ) VALUES ($1, $2, $1, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        [userId, conversation_id ? null : userId, name, summary || body.slice(0, 100),
          body, author, source, visibility, conversation_id || null, category],
      );
      await writeTuples(tx, { writes: [{
        object: `skill:${rows[0].id}`,
        relation: conversation_id ? 'parent' : 'owner',
        subject: conversation_id ? `conversation:${conversation_id}` : `user:${userId}`,
      }] });
      return rows[0];
    });

    res.json({ success: true, skill });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to create skill:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/chat/skills/:id - Update skill
router.put('/skills/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    const { name, summary, body, is_enabled } = req.body;

    await requireResourceRelation(req.db, userPrincipal(userId), 'skill', id, 'editor');
    const { rows } = await req.db.query(
      `UPDATE chat_skills SET
        name = COALESCE($1, name),
        summary = COALESCE($2, summary),
        body = COALESCE($3, body),
        is_enabled = COALESCE($4, is_enabled),
        updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [name, summary, body, is_enabled, id]
    );

    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Skill not found' });
    res.json({ success: true, skill: rows[0] });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to update skill:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/chat/skills/:id - Delete skill
router.delete('/skills/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    await requireResourceRelation(req.db, userPrincipal(userId), 'skill', id, 'admin');
    const removed = await withTransaction(req.db, async (tx) => {
      const deleted = await tx.query(`DELETE FROM chat_skills WHERE id = $1 RETURNING id`, [id]);
      if (deleted.rowCount) {
        await tx.query("DELETE FROM relationship_tuples WHERE object_type='skill' AND object_id=$1", [id]);
      }
      return deleted;
    });
    if (!removed.rowCount) return res.status(404).json({ success: false, error: 'Skill not found' });
    res.json({ success: true });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to delete skill:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// PROJECTS & KNOWLEDGE FILES ROUTES
// ============================================

router.get('/customize/connectors', async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const qualified = new Map(CHAT_PROJECT_CONTRACTS.catalogs.connectors.map((entry) => [entry.key, entry]));
  const { rows } = await req.db.query(
    'SELECT id, connector_key, status, updated_at FROM chat_connector_connections WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId],
  );
  res.json({
    success: true,
    connectors: rows.filter((row) => qualified.has(row.connector_key)).map((row) => ({ ...qualified.get(row.connector_key), ...row })),
  });
});

router.put('/customize/connectors/:key', async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const definition = CHAT_PROJECT_CONTRACTS.catalogs.connectors.find((entry) => entry.key === req.params.key);
  if (!definition) return res.status(404).json({ success: false, error: 'Connector is not qualified' });
  return res.status(501).json({ success: false, error: 'Connector verification flow is not implemented' });
});

router.get('/customize/plugins', async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const qualified = new Map(CHAT_PROJECT_CONTRACTS.catalogs.plugins.map((entry) => [entry.listingId, entry]));
  const { rows } = await req.db.query(
    'SELECT id, listing_id, version, enabled, entitlement_status, updated_at FROM chat_plugin_installations WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId],
  );
  res.json({
    success: true,
    plugins: rows.filter((row) => qualified.has(row.listing_id)).map((row) => ({ ...qualified.get(row.listing_id), ...row })),
  });
});

router.put('/customize/plugins/:listingId', async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const definition = CHAT_PROJECT_CONTRACTS.catalogs.plugins.find((entry) => entry.listingId === req.params.listingId);
  if (!definition) return res.status(404).json({ success: false, error: 'Plugin is not qualified' });
  return res.status(501).json({ success: false, error: 'Marketplace installation flow is not implemented' });
});

// GET /api/chat/projects - List projects with pagination
router.get('/projects', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const includeArchived = req.query.include_archived === 'true';

    const { rows: candidates } = await req.db.query(
      `SELECT p.*, 
              (SELECT COUNT(*) FROM chat_project_assets WHERE project_id = p.id) AS file_count,
              (SELECT COUNT(*) FROM chat_conversations WHERE project_id = p.id) AS chat_count
       FROM chat_projects p
       WHERE ($1::boolean OR p.is_archived = FALSE)
       ORDER BY p.updated_at DESC`,
      [includeArchived]
    );
    const authorized = [];
    for (const project of candidates) {
      const capabilities = {};
      for (const relation of ['viewer', 'reviewer', 'editor', 'admin', 'owner']) {
        capabilities[relation] = (await check(req.db, {
          object: `project:${project.id}`,
          relation,
          subject: `user:${userId}`,
        })).allowed;
      }
      if (capabilities.viewer) authorized.push({ ...project, capabilities });
    }
    const rows = authorized.slice(offset, offset + limit);

    res.json({ success: true, projects: rows, limit, offset });
  } catch (error) {
    console.error('Failed to list projects:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/projects/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const principal = userPrincipal(userId);
    await requireResourceRelation(req.db, principal, 'project', req.params.id, 'viewer');
    const project = (await req.db.query(
      `SELECT p.*,
        (SELECT count(*)::integer FROM chat_project_assets WHERE project_id=p.id) AS file_count,
        (SELECT count(*)::integer FROM chat_conversations WHERE project_id=p.id AND deleted_at IS NULL) AS chat_count
       FROM chat_projects p WHERE p.id=$1`,
      [req.params.id],
    )).rows[0];
    if (!project) return res.status(404).json({ success: false, error: 'Project not found', code: 'project_not_found' });
    const capabilities = {};
    for (const relation of ['viewer', 'reviewer', 'editor', 'admin', 'owner']) {
      capabilities[relation] = (await check(req.db, {
        object: `project:${req.params.id}`, relation, subject: `user:${userId}`,
      })).allowed;
    }
    res.json({ success: true, project, capabilities });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to get project:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/chat/projects - Create project
router.post('/projects', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { name, description, custom_instructions, settings } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Project name is required' });

    const project = await createAuthorizedProject(req.db, {
      principal: userPrincipal(userId),
      workspaceId: workspaceFromReq(req),
      name,
      description,
      customInstructions: custom_instructions,
      settings,
    });

    res.json({ success: true, project });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to create project:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/chat/projects/:id - Update project
router.put('/projects/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    const { name, description, custom_instructions, settings, is_archived } = req.body;

    await requireResourceRelation(req.db, userPrincipal(userId), 'project', id, 'editor');
    const { rows } = await req.db.query(
      `UPDATE chat_projects SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        instructions_revision = CASE
          WHEN $3::text IS NOT NULL AND $3::text IS DISTINCT FROM custom_instructions
          THEN instructions_revision + 1 ELSE instructions_revision END,
        custom_instructions = COALESCE($3, custom_instructions),
        settings = CASE WHEN $4::jsonb IS NULL THEN settings ELSE settings || $4::jsonb END,
        is_archived = COALESCE($5, is_archived),
        updated_by_user_id = $7,
        updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [name, description, custom_instructions, settings ? JSON.stringify(settings) : null, is_archived, id, userId]
    );

    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Project not found' });
    res.json({ success: true, project: rows[0] });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to update project:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/projects/:id/access', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    await requireResourceRelation(req.db, userPrincipal(userId), 'project', req.params.id, 'admin');
    const grants = await listObjectTuples(req.db, `project:${req.params.id}`);
    const userIds = grants
      .filter((grant) => grant.subject.startsWith('user:'))
      .map((grant) => grant.subject.slice('user:'.length));
    const identities = userIds.length ? (await req.db.query(
      `SELECT id,display_name,username,email FROM users WHERE id=ANY($1::uuid[])`,
      [userIds],
    )).rows : [];
    const identityById = new Map(identities.map((identity) => [String(identity.id), identity]));
    res.json({
      success: true,
      grants: grants.map((grant) => ({
        ...grant,
        identity: grant.subject.startsWith('user:')
          ? identityById.get(grant.subject.slice('user:'.length)) || null
          : null,
      })),
    });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to list project access:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.put('/projects/:id/access/user/by-email', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    await requireResourceRelation(req.db, userPrincipal(userId), 'project', req.params.id, 'admin');
    const email = String(req.body?.email || '').trim().toLowerCase();
    const relation = String(req.body?.relation || '');
    if (!email || !['viewer', 'reviewer', 'editor', 'admin'].includes(relation)) {
      return res.status(400).json({ success: false, error: 'Valid email and project relation are required', code: 'invalid_project_grant' });
    }
    const identity = (await req.db.query(
      `SELECT id,display_name,username,email FROM users WHERE lower(email)=$1 AND deleted_at IS NULL`,
      [email],
    )).rows[0];
    if (!identity) return res.status(404).json({ success: false, error: 'Account not found', code: 'account_not_found' });
    await withTransaction(req.db, async (tx) => {
      await tx.query(
        `DELETE FROM relationship_tuples WHERE object_type='project' AND object_id=$1
         AND subject_type='user' AND subject_id=$2 AND relation IN ('viewer','reviewer','editor','admin')`,
        [req.params.id, identity.id],
      );
      await writeTuples(tx, { writes: [{ object: `project:${req.params.id}`, relation, subject: `user:${identity.id}` }] });
    });
    res.json({ success: true, grant: { relation, subject: `user:${identity.id}`, identity } });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to grant project access by email:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.put('/projects/:id/access/:subjectType/:subjectId', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    await requireResourceRelation(req.db, userPrincipal(userId), 'project', req.params.id, 'admin');
    const { subjectType, subjectId } = req.params;
    const relation = String(req.body?.relation || '');
    if (!['user', 'agent'].includes(subjectType) || !UUID_RE.test(subjectId)
        || !['viewer', 'reviewer', 'editor', 'admin'].includes(relation)) {
      return res.status(400).json({ success: false, error: 'Invalid project grant', code: 'invalid_project_grant' });
    }
    await withTransaction(req.db, async (tx) => {
      await tx.query(
        `DELETE FROM relationship_tuples WHERE object_type='project' AND object_id=$1
         AND subject_type=$2 AND subject_id=$3 AND relation IN ('viewer','reviewer','editor','admin')`,
        [req.params.id, subjectType, subjectId],
      );
      await writeTuples(tx, { writes: [{ object: `project:${req.params.id}`, relation, subject: `${subjectType}:${subjectId}` }] });
    });
    res.json({ success: true, grant: { relation, subject: `${subjectType}:${subjectId}` } });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to update project access:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/projects/:id/access/:subjectType/:subjectId', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    await requireResourceRelation(req.db, userPrincipal(userId), 'project', req.params.id, 'admin');
    const { subjectType, subjectId } = req.params;
    if (!['user', 'agent'].includes(subjectType) || !UUID_RE.test(subjectId)) {
      return res.status(400).json({ success: false, error: 'Invalid project subject', code: 'invalid_project_grant' });
    }
    await req.db.query(
      `DELETE FROM relationship_tuples WHERE object_type='project' AND object_id=$1
       AND subject_type=$2 AND subject_id=$3 AND relation IN ('viewer','reviewer','editor','admin')`,
      [req.params.id, subjectType, subjectId],
    );
    res.json({ success: true });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to revoke project access:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/chat/projects/:id - Delete project
router.delete('/projects/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    await requireResourceRelation(req.db, userPrincipal(userId), 'project', id, 'admin');
    await withTransaction(req.db, async (tx) => {
      const archived = await tx.query(
        `UPDATE chat_projects
         SET is_archived = TRUE, updated_at = NOW(), updated_by_user_id = $2
         WHERE id = $1 AND is_archived = FALSE
         RETURNING id`,
        [id, userId],
      );
      if (!archived.rowCount) {
        const error = new Error('Project not found');
        error.status = 404;
        throw error;
      }
      await tx.query(
        `UPDATE chat_scheduled_tasks
         SET status = 'paused', paused_reason = 'project_archived', updated_at = NOW()
         WHERE project_id = $1 AND status IN ('active', 'needs_review')`,
        [id],
      );
    });
    res.json({ success: true });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    if (error?.status === 404) return res.status(404).json({ success: false, error: error.message, code: 'project_not_found' });
    console.error('Failed to delete project:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/chat/projects/:id/files - List files in project
router.get('/projects/:id/files', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id: projectId } = req.params;
    await requireResourceRelation(req.db, userPrincipal(userId), 'project', projectId, 'viewer');
    const { rows } = await req.db.query(
      `SELECT pa.id, pa.project_id, pa.asset_id AS storage_key, pa.retrieval_enabled, pa.created_at,
              COALESCE(f.original_name, f.filename) AS name,
              COALESCE(f.mime_type, f.file_type, 'application/octet-stream') AS file_type,
              f.file_size,
              '/api/library/assets/' || f.id::text || '/content' AS content_url,
              i.state AS ingestion_state, i.error_code, i.error_message
       FROM chat_project_assets pa
       JOIN user_files f ON f.id = pa.asset_id AND f.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT state, error_code, error_message FROM library_asset_ingestions
         WHERE asset_id = f.id ORDER BY created_at DESC LIMIT 1
       ) i ON TRUE
       WHERE pa.project_id = $1
       ORDER BY pa.created_at DESC`,
      [projectId]
    );

    res.json({ success: true, files: rows });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to list project files:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/chat/projects/:id/files - Add file to project
router.post('/projects/:id/files', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id: projectId } = req.params;
    const { storage_key } = req.body;
    if (!UUID_RE.test(String(storage_key || ''))) {
      return res.status(400).json({ success: false, error: 'Stored asset id must be a UUID' });
    }
    const linked = await linkAssetToProject(req.db, {
      principal: userPrincipal(userId),
      projectId,
      assetId: storage_key,
    });
    const file = await getAuthorizedLibraryFile(req.db, userPrincipal(userId), storage_key);

    res.json({
      success: true,
      file: {
        ...linked,
        storage_key,
        name: file.original_name || file.filename,
        file_type: file.mime_type,
        file_size: file.file_size,
        content_url: `/api/library/assets/${storage_key}/content`,
        ingestion_state: file.ingestion_state,
      },
    });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to add project file:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/chat/projects/:id/files/:fileId - Delete file from project
router.delete('/projects/:id/files/:fileId', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id: projectId, fileId } = req.params;
    const relation = await req.db.query(
      'SELECT asset_id FROM chat_project_assets WHERE id = $1 AND project_id = $2',
      [fileId, projectId],
    );
    const assetId = relation.rows[0]?.asset_id || fileId;
    await unlinkAssetFromProject(req.db, { principal: userPrincipal(userId), projectId, assetId });
    res.json({ success: true });
  } catch (error) {
    if (sendChatAuthorityError(res, error)) return;
    console.error('Failed to delete project file:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// MEMORIES ROUTES
// ============================================

// GET /api/chat/memories - List user memories
router.get('/memories', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { rows } = await req.db.query(
      `SELECT * FROM chat_user_memories WHERE user_id = $1 AND is_active = TRUE ORDER BY updated_at DESC`,
      [userId]
    );

    res.json({ success: true, memories: rows });
  } catch (error) {
    console.error('Failed to list memories:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/chat/memories - Add memory
router.post('/memories', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { content, source_conversation_id } = req.body;
    if (!content) return res.status(400).json({ success: false, error: 'Content is required' });
    if (await rejectUnownedChatReferences(req, res, { conversationId: source_conversation_id })) return;

    const { rows } = await req.db.query(
      `INSERT INTO chat_user_memories (user_id, content, source_conversation_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [userId, content, source_conversation_id || null]
    );

    res.json({ success: true, memory: rows[0] });
  } catch (error) {
    console.error('Failed to add memory:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/chat/memories/:id - Delete memory
router.delete('/memories/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    await req.db.query(`DELETE FROM chat_user_memories WHERE id = $1 AND user_id = $2`, [id, userId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete memory:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
