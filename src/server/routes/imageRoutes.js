/**
 * IMAGE STUDIO API ROUTES
 *
 * Handles all Image Studio project management, including:
 * - Project CRUD operations
 * - Session management (chat history)
 * - Asset management (images)
 *
 * All routes require authentication via authMiddleware.
 * Pattern follows videoRoutes.js for consistency.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';

const router = express.Router();

// ============================================
// REPLICATE API PROXY ROUTES (No auth required - uses server-side token)
// ============================================
// These routes proxy requests to Replicate API to avoid CORS issues
// They must be defined BEFORE the auth middleware

/**
 * CREATE PREDICTION (PROXY)
 * POST /api/image/replicate/predictions
 */
router.post('/replicate/predictions', async (req, res) => {
  try {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Replicate API token is not configured on the server'
      });
    }

    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${REPLICATE_API_TOKEN}`
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Replicate API error:', data);
      return res.status(response.status).json(data);
    }

    console.log(`🎨 Created Replicate prediction: ${data.id}`);
    res.json(data);

  } catch (error) {
    console.error('❌ Replicate proxy error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create prediction'
    });
  }
});

/**
 * GET PREDICTION STATUS (PROXY)
 * GET /api/image/replicate/predictions/:predictionId
 */
router.get('/replicate/predictions/:predictionId', async (req, res) => {
  try {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
    const { predictionId } = req.params;

    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Replicate API token is not configured on the server'
      });
    }

    const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${REPLICATE_API_TOKEN}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Replicate API error:', data);
      return res.status(response.status).json(data);
    }

    res.json(data);

  } catch (error) {
    console.error('❌ Replicate proxy error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get prediction status'
    });
  }
});

/**
 * CANCEL PREDICTION (PROXY)
 * POST /api/image/replicate/predictions/:predictionId/cancel
 */
router.post('/replicate/predictions/:predictionId/cancel', async (req, res) => {
  try {
    const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
    const { predictionId } = req.params;

    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'Replicate API token is not configured on the server'
      });
    }

    const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${REPLICATE_API_TOKEN}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Replicate API error:', data);
      return res.status(response.status).json(data);
    }

    console.log(`🛑 Cancelled Replicate prediction: ${predictionId}`);
    res.json(data);

  } catch (error) {
    console.error('❌ Replicate proxy error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel prediction'
    });
  }
});

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

const requireAuth = (req, res, next) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
  next();
};

// Apply auth to all routes BELOW this point
router.use(requireAuth);

// ============================================
// PROJECT MANAGEMENT ROUTES
// ============================================

/**
 * CREATE PROJECT
 * POST /api/image/projects/create
 *
 * Creates a new Image Studio project for the authenticated user
 */
router.post('/projects/create', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      title = 'Untitled Project',
      description = '',
      model = 'flux-kontext',
      seed,
      guidance_scale = 7.0,
      aspect_ratio = '1:1',
      num_images = 1,
      style_type,
      style_content,
      style_name,
      canvas_data
    } = req.body;

    const projectId = uuidv4();

    const result = await req.db.query(`
      INSERT INTO image_projects (
        id, user_id, title, description, model, seed, guidance_scale,
        aspect_ratio, num_images, style_type, style_content, style_name,
        canvas_data, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft')
      RETURNING *
    `, [
      projectId, userId, title, description, model, seed, guidance_scale,
      aspect_ratio, num_images, style_type, style_content, style_name,
      canvas_data ? JSON.stringify(canvas_data) : null
    ]);

    console.log(`✅ Created image project: ${projectId} for user: ${userId}`);

    res.json({
      success: true,
      project: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Create image project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create project'
    });
  }
});

/**
 * GET ALL USER PROJECTS
 * GET /api/image/projects
 *
 * Retrieves all projects for the authenticated user with pagination
 */
router.get('/projects', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      limit = 50,
      offset = 0,
      status,
      sort = 'updated_at',
      order = 'DESC'
    } = req.query;

    let query = `
      SELECT * FROM image_projects
      WHERE user_id = $1
    `;
    const params = [userId];
    let paramIndex = 2;

    // Filter by status if provided
    if (status && status !== 'all') {
      query += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    // Sorting
    const allowedSorts = ['updated_at', 'created_at', 'title', 'last_opened_at'];
    const sortColumn = allowedSorts.includes(sort) ? sort : 'updated_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortColumn} ${sortOrder}`;

    // Pagination
    query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await req.db.query(query, params);

    // Get total count
    const countResult = await req.db.query(
      'SELECT COUNT(*) FROM image_projects WHERE user_id = $1',
      [userId]
    );

    res.json({
      success: true,
      projects: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('❌ Fetch image projects error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch projects'
    });
  }
});

/**
 * GET SPECIFIC PROJECT
 * GET /api/image/projects/:projectId
 *
 * Retrieves a specific project by ID (must belong to authenticated user)
 */
router.get('/projects/:projectId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;

    const result = await req.db.query(
      'SELECT * FROM image_projects WHERE id = $1 AND user_id = $2',
      [projectId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    // Update last opened timestamp
    await req.db.query(
      'UPDATE image_projects SET last_opened_at = NOW() WHERE id = $1',
      [projectId]
    );

    console.log(`📂 Loaded image project: ${projectId} for user: ${userId}`);

    res.json({
      success: true,
      project: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Fetch image project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch project'
    });
  }
});

/**
 * UPDATE PROJECT
 * PUT /api/image/projects/:projectId
 *
 * Updates project fields (title, canvas_data, settings, status, etc.)
 */
router.put('/projects/:projectId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;
    const {
      title,
      description,
      canvas_data,
      model,
      seed,
      guidance_scale,
      aspect_ratio,
      num_images,
      style_type,
      style_content,
      style_name,
      status,
      thumbnail_url,
      primary_image_url
    } = req.body;

    // Build dynamic update query
    const updates = [];
    const values = [projectId, userId];
    let paramIndex = 3;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (canvas_data !== undefined) {
      updates.push(`canvas_data = $${paramIndex++}`);
      values.push(JSON.stringify(canvas_data));
    }
    if (model !== undefined) {
      updates.push(`model = $${paramIndex++}`);
      values.push(model);
    }
    if (seed !== undefined) {
      updates.push(`seed = $${paramIndex++}`);
      values.push(seed);
    }
    if (guidance_scale !== undefined) {
      updates.push(`guidance_scale = $${paramIndex++}`);
      values.push(guidance_scale);
    }
    if (aspect_ratio !== undefined) {
      updates.push(`aspect_ratio = $${paramIndex++}`);
      values.push(aspect_ratio);
    }
    if (num_images !== undefined) {
      updates.push(`num_images = $${paramIndex++}`);
      values.push(num_images);
    }
    if (style_type !== undefined) {
      updates.push(`style_type = $${paramIndex++}`);
      values.push(style_type);
    }
    if (style_content !== undefined) {
      updates.push(`style_content = $${paramIndex++}`);
      values.push(style_content);
    }
    if (style_name !== undefined) {
      updates.push(`style_name = $${paramIndex++}`);
      values.push(style_name);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    if (thumbnail_url !== undefined) {
      updates.push(`thumbnail_url = $${paramIndex++}`);
      values.push(thumbnail_url);
    }
    if (primary_image_url !== undefined) {
      updates.push(`primary_image_url = $${paramIndex++}`);
      values.push(primary_image_url);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    // updated_at is auto-updated by trigger
    updates.push('updated_at = NOW()');

    const result = await req.db.query(`
      UPDATE image_projects
      SET ${updates.join(', ')}
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    console.log(`💾 Updated image project: ${projectId}`);

    res.json({
      success: true,
      project: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Update image project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update project'
    });
  }
});

/**
 * DELETE PROJECT
 * DELETE /api/image/projects/:projectId
 *
 * Deletes a project and all associated sessions/assets
 */
router.delete('/projects/:projectId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;

    const result = await req.db.query(
      'DELETE FROM image_projects WHERE id = $1 AND user_id = $2 RETURNING id',
      [projectId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    console.log(`🗑️ Deleted image project: ${projectId}`);

    res.json({
      success: true,
      message: 'Project deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete image project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete project'
    });
  }
});

// ============================================
// SESSION MANAGEMENT ROUTES (Chat History)
// ============================================

/**
 * SAVE SESSION
 * POST /api/image/sessions/save
 *
 * Saves a chat history checkpoint/session
 */
router.post('/sessions/save', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      project_id,
      session_title = 'Untitled Session',
      messages = [],
      canvas_snapshot,
      settings_snapshot
    } = req.body;

    if (!project_id) {
      return res.status(400).json({
        success: false,
        error: 'project_id is required'
      });
    }

    // Verify project belongs to user
    const projectCheck = await req.db.query(
      'SELECT id FROM image_projects WHERE id = $1 AND user_id = $2',
      [project_id, userId]
    );

    if (projectCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    const sessionId = uuidv4();

    const result = await req.db.query(`
      INSERT INTO image_project_sessions (
        id, project_id, user_id, session_title, messages,
        canvas_snapshot, settings_snapshot, message_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      sessionId,
      project_id,
      userId,
      session_title,
      JSON.stringify(messages),
      canvas_snapshot ? JSON.stringify(canvas_snapshot) : null,
      settings_snapshot ? JSON.stringify(settings_snapshot) : null,
      messages.length
    ]);

    console.log(`💬 Saved session: ${sessionId} for project: ${project_id}`);

    res.json({
      success: true,
      session: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Save session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save session'
    });
  }
});

/**
 * GET PROJECT SESSIONS
 * GET /api/image/sessions/:projectId
 *
 * Retrieves all sessions for a specific project
 */
router.get('/sessions/:projectId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;

    // Verify project belongs to user
    const projectCheck = await req.db.query(
      'SELECT id FROM image_projects WHERE id = $1 AND user_id = $2',
      [projectId, userId]
    );

    if (projectCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    const result = await req.db.query(`
      SELECT * FROM image_project_sessions
      WHERE project_id = $1 AND user_id = $2
      ORDER BY created_at DESC
    `, [projectId, userId]);

    res.json({
      success: true,
      sessions: result.rows
    });

  } catch (error) {
    console.error('❌ Fetch sessions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sessions'
    });
  }
});

/**
 * DELETE SESSION
 * DELETE /api/image/sessions/:sessionId
 *
 * Deletes a specific session
 */
router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;

    const result = await req.db.query(
      'DELETE FROM image_project_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
      [sessionId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    console.log(`🗑️ Deleted session: ${sessionId}`);

    res.json({
      success: true,
      message: 'Session deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete session'
    });
  }
});

// ============================================
// ASSET MANAGEMENT ROUTES
// ============================================

/**
 * CREATE ASSET
 * POST /api/image/assets/create
 *
 * Creates a new image asset record
 */
router.post('/assets/create', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      project_id,
      session_id,
      name,
      type = 'generated',
      format = 'png',
      file_url,
      thumbnail_url,
      width,
      height,
      file_size,
      model_used,
      prompt,
      negative_prompt,
      seed,
      guidance_scale,
      generation_time,
      source = 'generation',
      metadata
    } = req.body;

    if (!file_url || !name) {
      return res.status(400).json({
        success: false,
        error: 'file_url and name are required'
      });
    }

    const assetId = uuidv4();

    const result = await req.db.query(`
      INSERT INTO image_assets (
        id, project_id, session_id, user_id, name, type, format,
        file_url, thumbnail_url, width, height, file_size,
        model_used, prompt, negative_prompt, seed, guidance_scale,
        generation_time, source, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *
    `, [
      assetId, project_id, session_id, userId, name, type, format,
      file_url, thumbnail_url, width, height, file_size,
      model_used, prompt, negative_prompt, seed, guidance_scale,
      generation_time, source,
      metadata ? JSON.stringify(metadata) : null
    ]);

    console.log(`🖼️ Created asset: ${assetId} for project: ${project_id}`);

    res.json({
      success: true,
      asset: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Create asset error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create asset'
    });
  }
});

/**
 * GET PROJECT ASSETS
 * GET /api/image/assets/:projectId
 *
 * Retrieves all assets for a specific project
 */
router.get('/assets/:projectId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;
    const { type, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT * FROM image_assets
      WHERE project_id = $1 AND user_id = $2
    `;
    const params = [projectId, userId];
    let paramIndex = 3;

    if (type) {
      query += ` AND type = $${paramIndex++}`;
      params.push(type);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await req.db.query(query, params);

    res.json({
      success: true,
      assets: result.rows
    });

  } catch (error) {
    console.error('❌ Fetch assets error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assets'
    });
  }
});

/**
 * DELETE ASSET
 * DELETE /api/image/assets/:assetId
 *
 * Deletes a specific asset
 */
router.delete('/assets/:assetId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { assetId } = req.params;

    const result = await req.db.query(
      'DELETE FROM image_assets WHERE id = $1 AND user_id = $2 RETURNING id',
      [assetId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Asset not found'
      });
    }

    console.log(`🗑️ Deleted asset: ${assetId}`);

    res.json({
      success: true,
      message: 'Asset deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete asset error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete asset'
    });
  }
});

// ============================================
// GENERATION HISTORY ROUTES (Midjourney-style)
// ============================================

/**
 * INITIALIZE GENERATIONS TABLE
 * POST /api/image/generations/init
 *
 * Creates the image_generations table if it doesn't exist
 */
router.post('/generations/init', async (req, res) => {
  try {
    await req.db.query(`
      CREATE TABLE IF NOT EXISTS image_generations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        prompt TEXT NOT NULL,
        image_urls JSONB NOT NULL DEFAULT '[]',
        model VARCHAR(100) NOT NULL,
        aspect_ratio VARCHAR(20),
        resolution VARCHAR(20),
        count INTEGER DEFAULT 1,
        provider VARCHAR(50),
        generation_time_ms INTEGER,
        is_favorite BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add is_favorite column if it doesn't exist (migration for existing tables)
    await req.db.query(`
      ALTER TABLE image_generations
      ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT false
    `);

    // Add reference_images column if it doesn't exist (migration for existing tables)
    await req.db.query(`
      ALTER TABLE image_generations
      ADD COLUMN IF NOT EXISTS reference_images JSONB DEFAULT '[]'
    `);

    await req.db.query(`
      CREATE INDEX IF NOT EXISTS idx_image_generations_user
        ON image_generations(user_id)
    `);

    await req.db.query(`
      CREATE INDEX IF NOT EXISTS idx_image_generations_user_created
        ON image_generations(user_id, created_at DESC)
    `);

    await req.db.query(`
      CREATE INDEX IF NOT EXISTS idx_image_generations_user_favorites
        ON image_generations(user_id, is_favorite) WHERE is_favorite = true
    `);

    console.log('✅ Image generations table initialized');

    res.json({
      success: true,
      message: 'Image generations table initialized'
    });

  } catch (error) {
    console.error('❌ Init generations table error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize generations table'
    });
  }
});

/**
 * SAVE GENERATION
 * POST /api/image/generations
 *
 * Saves a new image generation to history
 */
router.post('/generations', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      prompt,
      image_urls,
      model,
      aspect_ratio,
      resolution,
      count = 1,
      provider,
      generation_time_ms,
      reference_images = []
    } = req.body;

    if (!prompt || !image_urls || !model) {
      return res.status(400).json({
        success: false,
        error: 'prompt, image_urls, and model are required'
      });
    }

    const generationId = uuidv4();

    const result = await req.db.query(`
      INSERT INTO image_generations (
        id, user_id, prompt, image_urls, model,
        aspect_ratio, resolution, count, provider, generation_time_ms, reference_images
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      generationId,
      userId,
      prompt,
      JSON.stringify(image_urls),
      model,
      aspect_ratio,
      resolution,
      count,
      provider,
      generation_time_ms,
      JSON.stringify(reference_images)
    ]);

    console.log(`🎨 Saved generation: ${generationId} for user: ${userId}`);

    res.json({
      success: true,
      generation: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Save generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save generation'
    });
  }
});

/**
 * GET USER GENERATIONS
 * GET /api/image/generations
 *
 * Retrieves generation history for authenticated user with pagination
 * Query params:
 *   - limit: number of records (default 20)
 *   - offset: pagination offset (default 0)
 *   - favorites_only: if 'true', only return favorites
 */
router.get('/generations', async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, offset = 0, favorites_only = 'false' } = req.query;
    const favoritesOnly = favorites_only === 'true';

    let query, countQuery;
    let params = [userId, parseInt(limit), parseInt(offset)];

    if (favoritesOnly) {
      query = `
        SELECT * FROM image_generations
        WHERE user_id = $1 AND is_favorite = true
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;
      countQuery = 'SELECT COUNT(*) FROM image_generations WHERE user_id = $1 AND is_favorite = true';
    } else {
      query = `
        SELECT * FROM image_generations
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;
      countQuery = 'SELECT COUNT(*) FROM image_generations WHERE user_id = $1';
    }

    const result = await req.db.query(query, params);
    const countResult = await req.db.query(countQuery, [userId]);

    res.json({
      success: true,
      generations: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('❌ Fetch generations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch generations'
    });
  }
});

/**
 * TOGGLE FAVORITE
 * PATCH /api/image/generations/:generationId/favorite
 *
 * Toggles the favorite status of a generation
 */
router.patch('/generations/:generationId/favorite', async (req, res) => {
  try {
    const userId = req.user.id;
    const { generationId } = req.params;

    // Toggle the is_favorite status
    const result = await req.db.query(`
      UPDATE image_generations
      SET is_favorite = NOT is_favorite
      WHERE id = $1 AND user_id = $2
      RETURNING id, is_favorite
    `, [generationId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Generation not found'
      });
    }

    const { is_favorite } = result.rows[0];
    console.log(`${is_favorite ? '⭐' : '☆'} Toggled favorite for generation: ${generationId}`);

    res.json({
      success: true,
      generationId,
      is_favorite
    });

  } catch (error) {
    console.error('❌ Toggle favorite error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle favorite'
    });
  }
});

/**
 * DELETE GENERATION
 * DELETE /api/image/generations/:generationId
 *
 * Deletes a specific generation from history
 */
router.delete('/generations/:generationId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { generationId } = req.params;

    const result = await req.db.query(
      'DELETE FROM image_generations WHERE id = $1 AND user_id = $2 RETURNING id',
      [generationId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Generation not found'
      });
    }

    console.log(`🗑️ Deleted generation: ${generationId}`);

    res.json({
      success: true,
      message: 'Generation deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete generation'
    });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

router.get('/health', (req, res) => {
  res.json({ success: true, service: 'image-studio', timestamp: new Date().toISOString() });
});

export default router;
