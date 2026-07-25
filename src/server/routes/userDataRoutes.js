import express from 'express';

const router = express.Router();

// ============================================
// DATABASE INITIALIZATION
// ============================================

// SECURITY: same gate as authRoutes /init — in production, DDL endpoints require
// the SETUP_TOKEN, not just any authenticated user.
function requireSetupToken(req, res) {
  if (process.env.NODE_ENV !== 'production') return true;
  const expected = process.env.SETUP_TOKEN;
  const provided = req.headers['x-setup-token'] || req.body?.setupToken;
  if (!expected || provided !== expected) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return false;
  }
  return true;
}

// POST /api/user-data/init - Initialize user data tables
router.post('/init', async (req, res) => {
  try {
    if (!requireSetupToken(req, res)) return;
    // Create user_settings table
    await req.db.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        settings JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create user_files table for tracking uploaded/recent files
    await req.db.query(`
      CREATE TABLE IF NOT EXISTS user_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255),
        file_type VARCHAR(100),
        mime_type VARCHAR(100),
        file_size INTEGER,
        storage_path VARCHAR(500),
        storage_type VARCHAR(50) DEFAULT 'local',
        metadata JSONB DEFAULT '{}',
        last_used_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        deleted_at TIMESTAMP
      )
    `);

    // Create user_usage table for tracking API usage
    await req.db.query(`
      CREATE TABLE IF NOT EXISTS user_usage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        model_id VARCHAR(255) NOT NULL,
        provider VARCHAR(100),
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        request_count INTEGER DEFAULT 0,
        estimated_cost DECIMAL(10, 6) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, date, model_id)
      )
    `);

    // Create indexes
    await req.db.query(`CREATE INDEX IF NOT EXISTS idx_user_files_user ON user_files(user_id, deleted_at)`);
    await req.db.query(`CREATE INDEX IF NOT EXISTS idx_user_files_last_used ON user_files(user_id, last_used_at DESC)`);
    await req.db.query(`CREATE INDEX IF NOT EXISTS idx_user_usage_user_date ON user_usage(user_id, date DESC)`);
    await req.db.query(`CREATE INDEX IF NOT EXISTS idx_user_usage_model ON user_usage(user_id, model_id)`);

    console.log('✅ User data tables initialized successfully');
    res.json({ success: true, message: 'User data tables initialized' });
  } catch (error) {
    console.error('❌ Failed to initialize user data tables:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// USER SETTINGS OPERATIONS
// ============================================

// GET /api/user-data/settings - Get user settings
router.get('/settings', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const result = await req.db.query(
      'SELECT settings FROM user_settings WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      // Return default settings if none exist
      return res.json({
        success: true,
        settings: {
          chat: {
            wideMode: false,
            alignment: 'center',
            showTokenCount: true,
          },
          appearance: {
            theme: 'dark',
            fontSize: 'medium',
          },
          models: {
            defaultModel: null,
            favoriteModels: [],
          },
        },
      });
    }

    res.json({ success: true, settings: result.rows[0].settings });
  } catch (error) {
    console.error('Error getting user settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/user-data/settings - Update user settings
router.put('/settings', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { settings } = req.body;
    if (!settings) {
      return res.status(400).json({ success: false, error: 'Settings required' });
    }

    // Upsert settings
    const result = await req.db.query(
      `INSERT INTO user_settings (user_id, settings, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET settings = $2, updated_at = NOW()
       RETURNING settings`,
      [userId, JSON.stringify(settings)]
    );

    res.json({ success: true, settings: result.rows[0].settings });
  } catch (error) {
    console.error('Error updating user settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/user-data/settings - Partially update user settings
router.patch('/settings', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { path, value } = req.body;
    if (!path) {
      return res.status(400).json({ success: false, error: 'Path required' });
    }

    // Use jsonb_set to update nested values
    // Path should be like 'chat.wideMode' or 'appearance.theme'
    const pathArray = `{${path.replace(/\./g, ',')}}`;

    const result = await req.db.query(
      `INSERT INTO user_settings (user_id, settings, updated_at)
       VALUES ($1, jsonb_set('{}', $2::text[], $3::jsonb), NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         settings = jsonb_set(COALESCE(user_settings.settings, '{}'), $2::text[], $3::jsonb),
         updated_at = NOW()
       RETURNING settings`,
      [userId, pathArray, JSON.stringify(value)]
    );

    res.json({ success: true, settings: result.rows[0].settings });
  } catch (error) {
    console.error('Error patching user settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// USER FILES OPERATIONS
// ============================================

// GET /api/user-data/files - Get user's recent files
router.get('/files', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { limit = 20, include_deleted = false } = req.query;

    let query = `
      SELECT id, filename, original_name, file_type, mime_type, file_size,
             storage_path, storage_type, metadata, last_used_at, created_at
      FROM user_files
      WHERE user_id = $1
    `;

    if (!include_deleted) {
      query += ' AND deleted_at IS NULL';
    }

    query += ' ORDER BY last_used_at DESC LIMIT $2';

    const result = await req.db.query(query, [userId, parseInt(limit)]);

    res.json({ success: true, files: result.rows });
  } catch (error) {
    console.error('Error getting user files:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/user-data/files - Add/track a file
router.post('/files', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { filename, original_name, file_type, mime_type, file_size, storage_path, storage_type, metadata } = req.body;

    if (!filename) {
      return res.status(400).json({ success: false, error: 'Filename required' });
    }

    const result = await req.db.query(
      `INSERT INTO user_files (user_id, filename, original_name, file_type, mime_type, file_size, storage_path, storage_type, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [userId, filename, original_name || filename, file_type, mime_type, file_size, storage_path, storage_type || 'local', metadata || {}]
    );

    res.json({ success: true, file: result.rows[0] });
  } catch (error) {
    console.error('Error adding user file:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/user-data/files/:id/touch - Update last_used_at
router.put('/files/:id/touch', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id } = req.params;

    const result = await req.db.query(
      `UPDATE user_files
       SET last_used_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    res.json({ success: true, file: result.rows[0] });
  } catch (error) {
    console.error('Error touching user file:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/user-data/files/:id - Soft delete a file
router.delete('/files/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id } = req.params;
    const { permanent = false } = req.query;

    if (permanent === 'true') {
      await req.db.query(
        'DELETE FROM user_files WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
    } else {
      await req.db.query(
        'UPDATE user_files SET deleted_at = NOW() WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user file:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// USER USAGE OPERATIONS
// ============================================

// GET /api/user-data/usage - Get usage statistics
router.get('/usage', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { start_date, end_date, model_id } = req.query;

    let query = `
      SELECT date, model_id, provider, prompt_tokens, completion_tokens,
             total_tokens, request_count, estimated_cost
      FROM user_usage
      WHERE user_id = $1
    `;
    const params = [userId];
    let paramIndex = 2;

    if (start_date) {
      query += ` AND date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      query += ` AND date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    if (model_id) {
      query += ` AND model_id = $${paramIndex}`;
      params.push(model_id);
      paramIndex++;
    }

    query += ' ORDER BY date DESC';

    const result = await req.db.query(query, params);

    // Also get totals
    const totalsResult = await req.db.query(
      `SELECT
         SUM(prompt_tokens) as total_prompt_tokens,
         SUM(completion_tokens) as total_completion_tokens,
         SUM(total_tokens) as total_tokens,
         SUM(request_count) as total_requests,
         SUM(estimated_cost) as total_cost
       FROM user_usage
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      usage: result.rows,
      totals: totalsResult.rows[0],
    });
  } catch (error) {
    console.error('Error getting user usage:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/user-data/usage - Track usage (called after each API request)
router.post('/usage', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { model_id, provider, prompt_tokens = 0, completion_tokens = 0, estimated_cost = 0 } = req.body;

    if (!model_id) {
      return res.status(400).json({ success: false, error: 'Model ID required' });
    }

    const total_tokens = prompt_tokens + completion_tokens;

    // Upsert usage record for today
    const result = await req.db.query(
      `INSERT INTO user_usage (user_id, date, model_id, provider, prompt_tokens, completion_tokens, total_tokens, request_count, estimated_cost)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, 1, $7)
       ON CONFLICT (user_id, date, model_id)
       DO UPDATE SET
         prompt_tokens = user_usage.prompt_tokens + $4,
         completion_tokens = user_usage.completion_tokens + $5,
         total_tokens = user_usage.total_tokens + $6,
         request_count = user_usage.request_count + 1,
         estimated_cost = user_usage.estimated_cost + $7,
         updated_at = NOW()
       RETURNING *`,
      [userId, model_id, provider, prompt_tokens, completion_tokens, total_tokens, estimated_cost]
    );

    res.json({ success: true, usage: result.rows[0] });
  } catch (error) {
    console.error('Error tracking user usage:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/user-data/usage/summary - Get usage summary
router.get('/usage/summary', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Get today's usage
    const todayResult = await req.db.query(
      `SELECT
         SUM(total_tokens) as tokens,
         SUM(request_count) as requests,
         SUM(estimated_cost) as cost
       FROM user_usage
       WHERE user_id = $1 AND date = CURRENT_DATE`,
      [userId]
    );

    // Get this month's usage
    const monthResult = await req.db.query(
      `SELECT
         SUM(total_tokens) as tokens,
         SUM(request_count) as requests,
         SUM(estimated_cost) as cost
       FROM user_usage
       WHERE user_id = $1 AND date >= DATE_TRUNC('month', CURRENT_DATE)`,
      [userId]
    );

    // Get all-time usage
    const allTimeResult = await req.db.query(
      `SELECT
         SUM(total_tokens) as tokens,
         SUM(request_count) as requests,
         SUM(estimated_cost) as cost
       FROM user_usage
       WHERE user_id = $1`,
      [userId]
    );

    // Get top models by usage
    const topModelsResult = await req.db.query(
      `SELECT model_id, SUM(total_tokens) as tokens, SUM(request_count) as requests
       FROM user_usage
       WHERE user_id = $1
       GROUP BY model_id
       ORDER BY tokens DESC
       LIMIT 5`,
      [userId]
    );

    res.json({
      success: true,
      summary: {
        today: todayResult.rows[0],
        thisMonth: monthResult.rows[0],
        allTime: allTimeResult.rows[0],
        topModels: topModelsResult.rows,
      },
    });
  } catch (error) {
    console.error('Error getting usage summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
