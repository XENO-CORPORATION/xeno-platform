/**
 * Blog & Changelog API Routes
 * Public read access, admin write access
 */

import express from 'express';

const router = express.Router();

/**
 * GET /api/blog
 * List published blog posts (public)
 * Query params: category, limit, offset
 */
router.get('/', async (req, res) => {
  try {
    const pool = req.db;
    const { category, limit = 20, offset = 0 } = req.query;

    let query = `
      SELECT id, slug, title, excerpt, cover_image, category, tags,
             author_name, author_avatar, published_at
      FROM blog_posts
      WHERE published = true
    `;
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    query += ` ORDER BY published_at DESC`;

    params.push(parseInt(limit));
    query += ` LIMIT $${params.length}`;

    params.push(parseInt(offset));
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    // Also get total count for pagination
    let countQuery = `SELECT COUNT(*) FROM blog_posts WHERE published = true`;
    const countParams = [];
    if (category && category !== 'all') {
      countParams.push(category);
      countQuery += ` AND category = $${countParams.length}`;
    }
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      posts: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (err) {
    console.error('[Blog] List error:', err.message);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

/**
 * GET /api/blog/categories
 * List available categories with post counts
 */
router.get('/categories', async (req, res) => {
  try {
    const pool = req.db;
    const result = await pool.query(`
      SELECT category, COUNT(*) as count
      FROM blog_posts
      WHERE published = true
      GROUP BY category
      ORDER BY count DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[Blog] Categories error:', err.message);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * GET /api/blog/:slug
 * Get a single post by slug (public)
 */
router.get('/:slug', async (req, res) => {
  try {
    const pool = req.db;
    const result = await pool.query(
      `SELECT * FROM blog_posts WHERE slug = $1 AND published = true`,
      [req.params.slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Blog] Get error:', err.message);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

export default router;
