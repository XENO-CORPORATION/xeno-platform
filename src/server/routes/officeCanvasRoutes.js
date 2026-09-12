import express from 'express';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/auth.js';
import { requireEntitlement } from '../middleware/requireEntitlement.js';

const router = express.Router();

const generateShareToken = () => crypto.randomBytes(20).toString('hex');

router.use(authMiddleware);

const ACCESS_QUERY = `
  SELECT c.id, c.owner_id, c.name, c.canvas_state, c.version, c.share_token, c.is_public_edit, c.created_at, c.updated_at,
         (c.owner_id = $2) AS is_owner,
         COALESCE(col.role, 'owner') AS role
  FROM office_canvases c
  LEFT JOIN office_canvas_collaborators col
    ON col.canvas_id = c.id AND col.user_id = $2
  WHERE c.id = $1 AND (c.owner_id = $2 OR col.user_id = $2)
  LIMIT 1
`;

// GET /api/office-canvas/canvases
router.get('/canvases', async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await req.db.query(
      `SELECT c.id, c.owner_id, c.name, c.version, c.share_token, c.is_public_edit, c.created_at, c.updated_at,
              (c.owner_id = $1) AS is_owner,
              COALESCE(col.role, 'owner') AS role
       FROM office_canvases c
       LEFT JOIN office_canvas_collaborators col
         ON col.canvas_id = c.id AND col.user_id = $1
       WHERE c.owner_id = $1 OR col.user_id = $1
       ORDER BY c.updated_at DESC`,
      [userId]
    );

    res.json({ success: true, canvases: result.rows });
  } catch (error) {
    console.error('List canvases error:', error);
    res.status(500).json({ success: false, error: 'Failed to list canvases' });
  }
});

// POST /api/office-canvas/canvases
//
// A server-stored canvas IS a "private cloud project" — the Pro lever in
// `XENO MONETIZATION - STRATEGY.md` §4. Free is the standalone local Tool: the app
// works, full-res local export works, nothing is watermarked; what Pro buys is the
// document living in the cloud across devices.
//
// Only CREATE is gated. Reading, updating and deleting an existing canvas stay open
// so that a lapsed subscription degrades to read-and-export rather than holding the
// customer's own documents hostage — the thing every "downgrade" horror story is
// about, and the opposite of the trust posture in §9.
router.post('/canvases', requireEntitlement('privateProjects'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, canvasState } = req.body || {};

    const result = await req.db.query(
      `INSERT INTO office_canvases (owner_id, name, canvas_state)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id, owner_id, name, version, share_token, is_public_edit, created_at, updated_at`,
      [
        userId,
        typeof name === 'string' && name.trim() ? name.trim() : 'Untitled Canvas',
        JSON.stringify(canvasState || {})
      ]
    );

    res.status(201).json({ success: true, canvas: result.rows[0] });
  } catch (error) {
    console.error('Create canvas error:', error);
    res.status(500).json({ success: false, error: 'Failed to create canvas' });
  }
});

// GET /api/office-canvas/canvases/:canvasId
router.get('/canvases/:canvasId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { canvasId } = req.params;

    const result = await req.db.query(ACCESS_QUERY, [canvasId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Canvas not found or access denied' });
    }

    res.json({ success: true, canvas: result.rows[0] });
  } catch (error) {
    console.error('Get canvas error:', error);
    res.status(500).json({ success: false, error: 'Failed to get canvas' });
  }
});

// PUT /api/office-canvas/canvases/:canvasId
router.put('/canvases/:canvasId', requireEntitlement('cloudSync'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { canvasId } = req.params;
    const { name, canvasState, expectedVersion } = req.body || {};

    const access = await req.db.query(ACCESS_QUERY, [canvasId, userId]);

    if (access.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Canvas not found or access denied' });
    }

    const accessRow = access.rows[0];

    // SECURITY: role enforcement — a 'viewer' collaborator can read but never
    // write. Only the owner or an 'editor' may update the canvas.
    const effectiveRole = accessRow.is_owner ? 'owner' : accessRow.role;
    if (effectiveRole !== 'owner' && effectiveRole !== 'editor') {
      return res.status(403).json({ success: false, error: 'Viewers cannot modify this canvas' });
    }

    const safeExpectedVersion =
      typeof expectedVersion === 'number'
        ? expectedVersion
        : accessRow.version;

    const updates = [];
    const values = [];

    if (typeof name === 'string') {
      values.push(name.trim() || 'Untitled Canvas');
      updates.push(`name = $${values.length}`);
    }

    if (canvasState !== undefined) {
      values.push(JSON.stringify(canvasState || {}));
      updates.push(`canvas_state = $${values.length}::jsonb`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid updates provided' });
    }

    updates.push('version = version + 1');
    updates.push('updated_at = NOW()');

    values.push(canvasId, userId, safeExpectedVersion);

    const result = await req.db.query(
      `UPDATE office_canvases c
       SET ${updates.join(', ')}
       WHERE c.id = $${values.length - 2}
       AND c.version = $${values.length}
       AND (
         c.owner_id = $${values.length - 1}
         OR EXISTS (
           SELECT 1 FROM office_canvas_collaborators col
           WHERE col.canvas_id = c.id AND col.user_id = $${values.length - 1}
         )
       )
       RETURNING c.*, (c.owner_id = $${values.length - 1}) AS is_owner`,
      values
    );

    if (result.rows.length === 0) {
      const latest = await req.db.query(ACCESS_QUERY, [canvasId, userId]);
      if (latest.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Canvas not found or access denied' });
      }

      return res.status(409).json({
        success: false,
        error: 'Version conflict. Reload latest canvas and retry.',
        latest: latest.rows[0]
      });
    }

    res.json({ success: true, canvas: result.rows[0] });
  } catch (error) {
    console.error('Update canvas error:', error);
    res.status(500).json({ success: false, error: 'Failed to update canvas' });
  }
});

// DELETE /api/office-canvas/canvases/:canvasId (owner only)
router.delete('/canvases/:canvasId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { canvasId } = req.params;

    const result = await req.db.query(
      `DELETE FROM office_canvases WHERE id = $1 AND owner_id = $2 RETURNING id`,
      [canvasId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Canvas not found or not owner' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete canvas error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete canvas' });
  }
});

// POST /api/office-canvas/canvases/:canvasId/share (owner only)
// Turning ON sharing is the collaboration lever (Team). Disabling it is NOT gated —
// a user must always be able to revoke a share link, whatever their plan. A gate that
// can trap a document in a shared state is a security bug wearing a billing costume.
router.post('/canvases/:canvasId/share', requireEntitlement('collaboration'), async (req, res) => {
  try {
    const userId = req.user.id;
    const { canvasId } = req.params;

    const token = generateShareToken();
    const result = await req.db.query(
      `UPDATE office_canvases
       SET share_token = COALESCE(share_token, $1), is_public_edit = true, updated_at = NOW()
       WHERE id = $2 AND owner_id = $3
       RETURNING id, share_token`,
      [token, canvasId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Canvas not found or not owner' });
    }

    const shareToken = result.rows[0].share_token;
    res.json({
      success: true,
      shareToken,
      shareUrl: `${process.env.FRONTEND_URL || ''}/overview/office/canvas?share=${shareToken}`
    });
  } catch (error) {
    console.error('Share canvas error:', error);
    res.status(500).json({ success: false, error: 'Failed to share canvas' });
  }
});

// POST /api/office-canvas/canvases/:canvasId/share/disable (owner only)
router.post('/canvases/:canvasId/share/disable', async (req, res) => {
  try {
    const userId = req.user.id;
    const { canvasId } = req.params;

    const result = await req.db.query(
      `UPDATE office_canvases
       SET is_public_edit = false, share_token = NULL, updated_at = NOW()
       WHERE id = $1 AND owner_id = $2
       RETURNING id`,
      [canvasId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Canvas not found or not owner' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Disable share error:', error);
    res.status(500).json({ success: false, error: 'Failed to disable sharing' });
  }
});

// GET /api/office-canvas/canvases/:canvasId/collaborators
router.get('/canvases/:canvasId/collaborators', async (req, res) => {
  try {
    const userId = req.user.id;
    const { canvasId } = req.params;

    const access = await req.db.query(ACCESS_QUERY, [canvasId, userId]);
    if (access.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Canvas not found or access denied' });
    }

    const rows = await req.db.query(
      `SELECT c.canvas_id, c.user_id, c.role, c.added_by, c.created_at,
              u.display_name, u.email, u.avatar_url
       FROM office_canvas_collaborators c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.canvas_id = $1
       ORDER BY c.created_at ASC`,
      [canvasId]
    );

    res.json({ success: true, collaborators: rows.rows });
  } catch (error) {
    console.error('List collaborators error:', error);
    res.status(500).json({ success: false, error: 'Failed to list collaborators' });
  }
});

// DELETE /api/office-canvas/canvases/:canvasId/collaborators/:collaboratorUserId
router.delete('/canvases/:canvasId/collaborators/:collaboratorUserId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { canvasId, collaboratorUserId } = req.params;

    const ownerCheck = await req.db.query(
      `SELECT id FROM office_canvases WHERE id = $1 AND owner_id = $2 LIMIT 1`,
      [canvasId, userId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'Only owner can remove collaborators' });
    }

    await req.db.query(
      `DELETE FROM office_canvas_collaborators WHERE canvas_id = $1 AND user_id = $2`,
      [canvasId, collaboratorUserId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Remove collaborator error:', error);
    res.status(500).json({ success: false, error: 'Failed to remove collaborator' });
  }
});

// POST /api/office-canvas/join/:token
router.post('/join/:token', async (req, res) => {
  try {
    const userId = req.user.id;
    const { token } = req.params;

    const canvasResult = await req.db.query(
      `SELECT id, owner_id, share_token
       FROM office_canvases
       WHERE share_token = $1 AND is_public_edit = true
       LIMIT 1`,
      [token]
    );

    if (canvasResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Invalid or inactive share link' });
    }

    const canvas = canvasResult.rows[0];

    if (canvas.owner_id !== userId) {
      await req.db.query(
        `INSERT INTO office_canvas_collaborators (canvas_id, user_id, role, added_by)
         VALUES ($1, $2, 'editor', $3)
         ON CONFLICT (canvas_id, user_id) DO NOTHING`,
        [canvas.id, userId, canvas.owner_id]
      );
    }

    const fullCanvas = await req.db.query(ACCESS_QUERY, [canvas.id, userId]);

    res.json({ success: true, canvas: fullCanvas.rows[0] });
  } catch (error) {
    console.error('Join canvas error:', error);
    res.status(500).json({ success: false, error: 'Failed to join canvas' });
  }
});

export default router;
