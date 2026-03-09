/**
 * Tutorials & Learning Resources API Routes
 * Public read access
 */

import express from 'express';

const router = express.Router();

/**
 * GET /api/learn
 * List published tutorials
 * Query: category, type, difficulty, limit, offset
 */
router.get('/', async (req, res) => {
  try {
    const { category, type, difficulty, limit = 20, offset = 0 } = req.query;
    let query = `
      SELECT id, slug, title, description, type, category, difficulty,
             duration, cover_image, video_url, author_name, sort_order, published_at
      FROM tutorials
      WHERE published = true
    `;
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }
    if (type && type !== 'all') {
      params.push(type);
      query += ` AND type = $${params.length}`;
    }
    if (difficulty && difficulty !== 'all') {
      params.push(difficulty);
      query += ` AND difficulty = $${params.length}`;
    }

    query += ` ORDER BY sort_order ASC, published_at DESC`;
    params.push(parseInt(limit));
    query += ` LIMIT $${params.length}`;
    params.push(parseInt(offset));
    query += ` OFFSET $${params.length}`;

    const result = await req.db.query(query, params);

    let countQuery = `SELECT COUNT(*) FROM tutorials WHERE published = true`;
    const countParams = [];
    if (category && category !== 'all') {
      countParams.push(category);
      countQuery += ` AND category = $${countParams.length}`;
    }
    if (type && type !== 'all') {
      countParams.push(type);
      countQuery += ` AND type = $${countParams.length}`;
    }
    const countResult = await req.db.query(countQuery, countParams);

    res.json({
      tutorials: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (err) {
    console.error('[Learn] List error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tutorials' });
  }
});

/**
 * GET /api/learn/categories
 * List categories with counts
 */
router.get('/categories', async (req, res) => {
  try {
    const result = await req.db.query(`
      SELECT category, COUNT(*) as count
      FROM tutorials WHERE published = true
      GROUP BY category ORDER BY count DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[Learn] Categories error:', err.message);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * GET /api/learn/:slug
 * Get single tutorial by slug
 */
router.get('/:slug', async (req, res) => {
  try {
    const result = await req.db.query(
      `SELECT * FROM tutorials WHERE slug = $1 AND published = true`,
      [req.params.slug]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tutorial not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Learn] Get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tutorial' });
  }
});

export default router;
