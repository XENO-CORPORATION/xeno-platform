import express from 'express';
import crypto from 'crypto';
import { workspaceFromReq, isWorkspaceMember, linkResourceToWorkspace, UUID_RE } from '../utils/workspaceContext.js';
import { computeNextRun, executeScheduledTask } from '../workers/chatScheduledWorker.js';

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
    const owned = await req.db.query(
      `SELECT 1 FROM chat_conversations
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [conversationId, req.user.id],
    );
    if (owned.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Referenced resource not found', code: 'referenced_resource_not_found' });
      return true;
    }
  }

  if (messageId) {
    const owned = await req.db.query(
      `SELECT 1 FROM chat_messages
       WHERE id = $1 AND user_id = $2
         AND ($3::uuid IS NULL OR conversation_id = $3)`,
      [messageId, req.user.id, conversationId],
    );
    if (owned.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Referenced resource not found', code: 'referenced_resource_not_found' });
      return true;
    }
  }

  if (projectId) {
    const owned = await req.db.query(
      `SELECT 1 FROM chat_projects WHERE id = $1 AND user_id = $2 AND is_archived = FALSE`,
      [projectId, req.user.id],
    );
    if (owned.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Referenced resource not found', code: 'referenced_resource_not_found' });
      return true;
    }
  }

  return false;
}

const router = express.Router();

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
        c.is_archived,
        (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = c.id) as message_count
      FROM chat_conversations c
      WHERE c.user_id = $1
        AND c.deleted_at IS NULL
        AND c.interface_id = $2
    `;

    const params = [userId, interface_id];

    if (!include_archived || include_archived === 'false') {
      query += ` AND c.is_archived = FALSE`;
    }

    query += ` ORDER BY c.updated_at DESC LIMIT $3 OFFSET $4`;
    params.push(limit, offset);

    const result = await req.db.query(query, params);
    console.log('[Conversations] Found', result.rows.length, 'conversations for user:', userId);

    res.json({
      success: true,
      conversations: result.rows,
      total: result.rowCount
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

    // Get conversation
    const convResult = await req.db.query(
      `SELECT * FROM chat_conversations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [id, userId]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    // Get messages
    const messagesResult = await req.db.query(
      `SELECT * FROM chat_messages WHERE conversation_id = $1 ORDER BY message_index ASC`,
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

    if (await rejectUnownedChatReferences(req, res, { projectId: project_id })) return;

    // Workspace tenancy (Phase 5): stamp workspace_id + write the ReBAC parent tuple
    // when the request carries an x-xeno-workspace the caller belongs to.
    const wsCtx = workspaceFromReq(req);
    const wsId = (wsCtx && await isWorkspaceMember(req.db, wsCtx, userId)) ? wsCtx : null;

    const result = await req.db.query(
      `INSERT INTO chat_conversations (user_id, title, model_id, system_prompt, persona_id, interface_id, workspace_id, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, title, model_id, system_prompt, persona_id, interface_id, wsId, project_id || null]
    );
    if (wsId) {
      await linkResourceToWorkspace(req.db, { workspaceId: wsId, userId, objectType: 'conversation', objectId: result.rows[0].id });
    }

    res.json({
      success: true,
      conversation: result.rows[0]
    });
  } catch (error) {
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
    const { title, model_id, system_prompt, persona_id, is_archived } = req.body;

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

    updates.push(`updated_at = NOW()`);

    values.push(id, userId);

    const result = await req.db.query(
      `UPDATE chat_conversations
       SET ${updates.join(', ')}
       WHERE id = $${paramCount++} AND user_id = $${paramCount} AND deleted_at IS NULL
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    res.json({
      success: true,
      conversation: result.rows[0]
    });
  } catch (error) {
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

    if (permanent === 'true') {
      // Hard delete
      await req.db.query(
        `DELETE FROM chat_conversations WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
    } else {
      // Soft delete
      await req.db.query(
        `UPDATE chat_conversations SET deleted_at = NOW() WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
    }

    res.json({ success: true });
  } catch (error) {
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
      prompt_tokens,
      completion_tokens,
      total_tokens
    } = req.body;

    // Verify conversation belongs to user
    const convCheck = await req.db.query(
      `SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [conversationId, userId]
    );

    if (convCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    // Get next message index
    const indexResult = await req.db.query(
      `SELECT COALESCE(MAX(message_index), -1) + 1 as next_index FROM chat_messages WHERE conversation_id = $1`,
      [conversationId]
    );
    const messageIndex = indexResult.rows[0].next_index;

    // Insert message
    const result = await req.db.query(
      `INSERT INTO chat_messages (
        conversation_id, user_id, role, content, model_id,
        thinking, has_thinking, attachments, search_context,
        prompt_tokens, completion_tokens, total_tokens, message_index
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        conversationId, userId, role, content, model_id,
        thinking, has_thinking,
        attachments ? JSON.stringify(attachments) : null,
        search_context ? JSON.stringify(search_context) : null,
        prompt_tokens, completion_tokens, total_tokens, messageIndex
      ]
    );

    // Update conversation's last_message_at and updated_at
    await req.db.query(
      `UPDATE chat_conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [conversationId]
    );

    // Auto-update title from first user message if title is default
    if (role === 'user' && messageIndex === 0) {
      const title = content.substring(0, 60) + (content.length > 60 ? '...' : '');
      await req.db.query(
        `UPDATE chat_conversations SET title = $1 WHERE id = $2 AND title = 'New Chat'`,
        [title, conversationId]
      );
    }

    res.json({
      success: true,
      message: result.rows[0]
    });
  } catch (error) {
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

    // Verify conversation belongs to user
    const convCheck = await req.db.query(
      `SELECT id FROM chat_conversations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [conversationId, userId]
    );

    if (convCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
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
          conversation_id, user_id, role, content, model_id,
          thinking, has_thinking, attachments, search_context,
          prompt_tokens, completion_tokens, total_tokens, message_index
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`,
        [
          conversationId, userId, msg.role, msg.content, msg.model_id,
          msg.thinking, msg.has_thinking || false,
          msg.attachments ? JSON.stringify(msg.attachments) : null,
          msg.search_context ? JSON.stringify(msg.search_context) : null,
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

    // Verify message belongs to user
    const msgCheck = await req.db.query(
      `SELECT id FROM chat_messages WHERE id = $1 AND user_id = $2`,
      [messageId, userId]
    );

    if (msgCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    // Build update query dynamically based on provided fields
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(content);
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

    values.push(messageId, userId);
    const result = await req.db.query(
      `UPDATE chat_messages SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND user_id = $${paramIndex} RETURNING *`,
      values
    );

    res.json({
      success: true,
      message: result.rows[0]
    });
  } catch (error) {
    console.error('Failed to update message:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/chat/messages/:id - Delete a single message.
// Used by the chat module's edit/regenerate truncation to drop the trailing
// (pre-edit / pre-regenerate) turns durably, so they don't resurrect on reload.
// Ownership-scoped by user_id, mirroring PUT /messages/:id.
router.delete('/messages/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id: messageId } = req.params;
    const result = await req.db.query(
      `DELETE FROM chat_messages WHERE id = $1 AND user_id = $2 RETURNING id`,
      [messageId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    res.json({ success: true, id: result.rows[0].id });
  } catch (error) {
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
    const { expires_in_days = 7 } = req.body;

    // Verify conversation belongs to user
    const convCheck = await req.db.query(
      `SELECT id, title FROM chat_conversations WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [conversationId, userId]
    );

    if (convCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }

    // Generate unique share token
    const shareToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expires_in_days);

    // Create share record
    const result = await req.db.query(
      `INSERT INTO chat_shared_conversations (conversation_id, owner_id, share_token, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [conversationId, userId, shareToken, expiresAt]
    );

    const shareUrl = `${req.protocol}://${req.get('host')}/overview/office/word?share=${shareToken}`;

    res.json({
      success: true,
      share: {
        ...result.rows[0],
        share_url: shareUrl,
        conversation_title: convCheck.rows[0].title
      }
    });
  } catch (error) {
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
      `SELECT s.*, c.title, c.model_id, c.system_prompt, u.email as owner_email, u.display_name as owner_name
       FROM chat_shared_conversations s
       JOIN chat_conversations c ON c.id = s.conversation_id
       JOIN users u ON u.id = s.owner_id
       WHERE s.share_token = $1 AND s.expires_at > NOW() AND s.revoked_at IS NULL`,
      [token]
    );

    if (shareResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Share link not found or expired' });
    }

    const share = shareResult.rows[0];

    // Get conversation messages
    const messagesResult = await req.db.query(
      `SELECT id, role, content, model_id, thinking, has_thinking, attachments, created_at, message_index
       FROM chat_messages WHERE conversation_id = $1 ORDER BY message_index ASC`,
      [share.conversation_id]
    );

    res.json({
      success: true,
      share: {
        id: share.id,
        conversation_id: share.conversation_id,
        title: share.title,
        model_id: share.model_id,
        system_prompt: share.system_prompt,
        owner_name: share.owner_name || share.owner_email,
        expires_at: share.expires_at,
        messages: messagesResult.rows
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
      `SELECT s.*, c.title, c.model_id, c.system_prompt, c.interface_id
       FROM chat_shared_conversations s
       JOIN chat_conversations c ON c.id = s.conversation_id
       WHERE s.share_token = $1 AND s.expires_at > NOW() AND s.revoked_at IS NULL`,
      [token]
    );

    if (shareResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Share link not found or expired' });
    }

    const share = shareResult.rows[0];

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

    // Create a new conversation for the accepting user
    const newConvResult = await req.db.query(
      `INSERT INTO chat_conversations (user_id, title, model_id, system_prompt, interface_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, `${share.title} (Shared)`, share.model_id, share.system_prompt, share.interface_id || 'word-processor']
    );

    const newConversation = newConvResult.rows[0];

    // Copy all messages to the new conversation
    const messagesResult = await req.db.query(
      `SELECT role, content, model_id, thinking, has_thinking, attachments, search_context,
              prompt_tokens, completion_tokens, total_tokens, message_index
       FROM chat_messages WHERE conversation_id = $1 ORDER BY message_index ASC`,
      [share.conversation_id]
    );

    for (const msg of messagesResult.rows) {
      await req.db.query(
        `INSERT INTO chat_messages (
          conversation_id, user_id, role, content, model_id,
          thinking, has_thinking, attachments, search_context,
          prompt_tokens, completion_tokens, total_tokens, message_index
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          newConversation.id, userId, msg.role, msg.content, msg.model_id,
          msg.thinking, msg.has_thinking, msg.attachments, msg.search_context,
          msg.prompt_tokens, msg.completion_tokens, msg.total_tokens, msg.message_index
        ]
      );
    }

    // Record the acceptance
    await req.db.query(
      `INSERT INTO chat_share_acceptances (share_id, user_id, new_conversation_id)
       VALUES ($1, $2, $3)`,
      [share.id, userId, newConversation.id]
    );

    // Update share accept count
    await req.db.query(
      `UPDATE chat_shared_conversations SET accept_count = accept_count + 1 WHERE id = $1`,
      [share.id]
    );

    res.json({
      success: true,
      conversation: {
        ...newConversation,
        messages: messagesResult.rows
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

    // Revoke all active shares for this conversation
    await req.db.query(
      `UPDATE chat_shared_conversations SET revoked_at = NOW()
       WHERE conversation_id = $1 AND owner_id = $2 AND revoked_at IS NULL`,
      [conversationId, userId]
    );

    res.json({ success: true });
  } catch (error) {
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

    const result = await req.db.query(
      `SELECT * FROM chat_shared_conversations
       WHERE conversation_id = $1 AND owner_id = $2
       ORDER BY created_at DESC`,
      [conversationId, userId]
    );

    res.json({
      success: true,
      shares: result.rows
    });
  } catch (error) {
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
        `INSERT INTO chat_conversations (user_id, title, model_id, system_prompt, persona_id, interface_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
            `INSERT INTO chat_messages (conversation_id, user_id, role, content, model_id, thinking, has_thinking, attachments, message_index, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
               WHERE a.user_id = $1 AND a.is_archived = FALSE`;
    const params = [userId];

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

    params.push(limit, offset);
    sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await req.db.query(sql, params);
    res.json({ success: true, artifacts: rows, limit, offset });
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
    const { rows } = await req.db.query(
      `SELECT a.*, c.title AS conversation_title 
       FROM chat_artifacts a 
       LEFT JOIN chat_conversations c ON a.conversation_id = c.id
       WHERE a.id = $1 AND a.user_id = $2`,
      [id, userId]
    );

    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Artifact not found' });
    res.json({ success: true, artifact: rows[0] });
  } catch (error) {
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

    const { rows } = await req.db.query(
      `INSERT INTO chat_artifacts (
        user_id, conversation_id, message_id, title, kind, language, content, preview_text
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [userId, conversation_id || null, message_id || null, title, kind, language || null, content, preview]
    );

    res.json({ success: true, artifact: rows[0] });
  } catch (error) {
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
    await req.db.query(`DELETE FROM chat_artifacts WHERE id = $1 AND user_id = $2`, [id, userId]);
    res.json({ success: true });
  } catch (error) {
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

    const { status, sort = 'next', query } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let sql = `SELECT * FROM chat_scheduled_tasks WHERE user_id = $1`;
    const params = [userId];

    if (status && status !== 'all') {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    if (query && query.trim()) {
      params.push(`%${query.trim()}%`);
      sql += ` AND (title ILIKE $${params.length} OR prompt ILIKE $${params.length} OR cadence_label ILIKE $${params.length})`;
    }

    if (sort === 'name') sql += ` ORDER BY title ASC`;
    else if (sort === 'updated') sql += ` ORDER BY updated_at DESC`;
    else sql += ` ORDER BY next_run_at ASC`;

    params.push(limit, offset);
    sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await req.db.query(sql, params);
    res.json({ success: true, tasks: rows, limit, offset });
  } catch (error) {
    console.error('Failed to list scheduled tasks:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/chat/scheduled - Create scheduled task
router.post('/scheduled', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { title, prompt, cadence = 'daily', cadence_label, model_id = 'google/gemini-2.5-flash-preview-05-20', conversation_id, project_id } = req.body;
    if (!title || !prompt) {
      return res.status(400).json({ success: false, error: 'title and prompt are required' });
    }
    if (await rejectUnownedChatReferences(req, res, {
      conversationId: conversation_id,
      projectId: project_id,
    })) return;

    const label = cadence_label || (cadence === 'daily' ? 'Every day' : cadence === 'weekly' ? 'Every week' : 'Once');
    const nextRun = computeNextRun(cadence, new Date());

    const { rows } = await req.db.query(
      `INSERT INTO chat_scheduled_tasks (
        user_id, conversation_id, project_id, title, prompt, model_id, cadence, cadence_label, next_run_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [userId, conversation_id || null, project_id || null, title, prompt, model_id, cadence, label, nextRun]
    );

    res.json({ success: true, task: rows[0] });
  } catch (error) {
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
    const { title, prompt, cadence, cadence_label, status, model_id } = req.body;

    const existing = await req.db.query(`SELECT * FROM chat_scheduled_tasks WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, error: 'Task not found' });

    const task = existing.rows[0];
    const newCadence = cadence || task.cadence;
    const nextRun = (cadence && cadence !== task.cadence) ? computeNextRun(newCadence, new Date()) : task.next_run_at;

    const { rows } = await req.db.query(
      `UPDATE chat_scheduled_tasks SET
        title = COALESCE($1, title),
        prompt = COALESCE($2, prompt),
        cadence = COALESCE($3, cadence),
        cadence_label = COALESCE($4, cadence_label),
        status = COALESCE($5, status),
        model_id = COALESCE($6, model_id),
        next_run_at = $7,
        updated_at = NOW()
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [title, prompt, cadence, cadence_label, status, model_id, nextRun, id, userId]
    );

    res.json({ success: true, task: rows[0] });
  } catch (error) {
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
    await req.db.query(`DELETE FROM chat_scheduled_tasks WHERE id = $1 AND user_id = $2`, [id, userId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete scheduled task:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/chat/scheduled/:id/run - Immediate trigger of scheduled task
router.post('/scheduled/:id/run', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    const { rows } = await req.db.query(`SELECT * FROM chat_scheduled_tasks WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Task not found' });

    const result = await executeScheduledTask(req.db, rows[0]);
    res.json({ success: true, result });
  } catch (error) {
    console.error('Failed to execute scheduled task:', error);
    res.status(500).json({ success: false, error: error.message || 'Execution failed' });
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
    let sql = `SELECT * FROM chat_skills WHERE user_id = $1`;
    const params = [userId];

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
    res.json({ success: true, skills: rows });
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
    if (await rejectUnownedChatReferences(req, res, { conversationId: conversation_id })) return;

    const { rows } = await req.db.query(
      `INSERT INTO chat_skills (
        user_id, name, summary, body, author, source, visibility, conversation_id, category
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [userId, name, summary || body.slice(0, 100), body, author, source, visibility, conversation_id || null, category]
    );

    res.json({ success: true, skill: rows[0] });
  } catch (error) {
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

    const { rows } = await req.db.query(
      `UPDATE chat_skills SET
        name = COALESCE($1, name),
        summary = COALESCE($2, summary),
        body = COALESCE($3, body),
        is_enabled = COALESCE($4, is_enabled),
        updated_at = NOW()
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [name, summary, body, is_enabled, id, userId]
    );

    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Skill not found' });
    res.json({ success: true, skill: rows[0] });
  } catch (error) {
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
    await req.db.query(`DELETE FROM chat_skills WHERE id = $1 AND user_id = $2`, [id, userId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete skill:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// PROJECTS & KNOWLEDGE FILES ROUTES
// ============================================

// GET /api/chat/projects - List projects with pagination
router.get('/projects', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const { rows } = await req.db.query(
      `SELECT p.*, 
              (SELECT COUNT(*) FROM chat_project_files WHERE project_id = p.id) AS file_count,
              (SELECT COUNT(*) FROM chat_conversations WHERE project_id = p.id) AS chat_count
       FROM chat_projects p
       WHERE p.user_id = $1 AND p.is_archived = FALSE
       ORDER BY p.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    res.json({ success: true, projects: rows, limit, offset });
  } catch (error) {
    console.error('Failed to list projects:', error);
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

    const { rows } = await req.db.query(
      `INSERT INTO chat_projects (
        user_id, name, description, custom_instructions, settings
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [userId, name, description || null, custom_instructions || null, settings ? JSON.stringify(settings) : '{}']
    );

    res.json({ success: true, project: rows[0] });
  } catch (error) {
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

    const { rows } = await req.db.query(
      `UPDATE chat_projects SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        custom_instructions = COALESCE($3, custom_instructions),
        settings = COALESCE($4, settings),
        is_archived = COALESCE($5, is_archived),
        updated_at = NOW()
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [name, description, custom_instructions, settings ? JSON.stringify(settings) : null, is_archived, id, userId]
    );

    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Project not found' });
    res.json({ success: true, project: rows[0] });
  } catch (error) {
    console.error('Failed to update project:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/chat/projects/:id - Delete project
router.delete('/projects/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { id } = req.params;
    await req.db.query(`DELETE FROM chat_projects WHERE id = $1 AND user_id = $2`, [id, userId]);
    res.json({ success: true });
  } catch (error) {
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
    const { rows } = await req.db.query(
      `SELECT * FROM chat_project_files WHERE project_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
      [projectId, userId]
    );

    res.json({ success: true, files: rows });
  } catch (error) {
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
    const { name, file_type, file_size, content_text } = req.body;

    if (!name || !content_text) {
      return res.status(400).json({ success: false, error: 'File name and text content are required' });
    }
    if (await rejectUnownedChatReferences(req, res, { projectId })) return;

    const { rows } = await req.db.query(
      `INSERT INTO chat_project_files (
        project_id, user_id, name, file_type, file_size, content_text
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [projectId, userId, name, file_type || 'text/plain', file_size || content_text.length, content_text]
    );

    res.json({ success: true, file: rows[0] });
  } catch (error) {
    console.error('Failed to add project file:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/chat/projects/:id/files/:fileId - Delete file from project
router.delete('/projects/:id/files/:fileId', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { fileId } = req.params;
    await req.db.query(`DELETE FROM chat_project_files WHERE id = $1 AND user_id = $2`, [fileId, userId]);
    res.json({ success: true });
  } catch (error) {
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
