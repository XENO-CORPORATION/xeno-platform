/**
 * XenoOS Collaboration API Routes
 * Enables Figma-style real-time collaboration on OS containers
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { authMiddleware } from '../middleware/auth.js';
import { pool } from '../middleware/database.js';

const router = express.Router();

// Helper function to generate secure tokens
const generateToken = () => crypto.randomBytes(32).toString('hex');

// Participant colors for assignment
const PARTICIPANT_COLORS = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B',
  '#EF4444', '#6366F1', '#14B8A6', '#F97316', '#06B6D4'
];

/**
 * POST /api/collaboration/sessions
 * Create a new collaborative session for a container
 */
router.post('/sessions', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { containerId, name, maxParticipants, permissions, expiresIn } = req.body;

    if (!containerId) {
      return res.status(400).json({ error: 'Container ID is required' });
    }

    // Verify user owns the container
    const containerCheck = await pool.query(
      'SELECT id FROM containers WHERE id = $1 AND user_id = $2',
      [containerId, userId]
    );

    if (containerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have permission to share this container' });
    }

    // Check if active session already exists for this container
    const existingSession = await pool.query(
      'SELECT * FROM os_collaborative_sessions WHERE container_id = $1 AND owner_id = $2 AND is_active = true',
      [containerId, userId]
    );

    if (existingSession.rows.length > 0) {
      // Return existing session with proper format
      const session = existingSession.rows[0];
      const participants = await pool.query(
        'SELECT * FROM os_session_participants WHERE session_id = $1 AND is_active = true',
        [session.id]
      );

      return res.json({
        success: true,
        session: {
          id: session.id,
          containerId: session.container_id,
          name: session.name,
          shareToken: session.share_token,
          shareUrl: `${process.env.FRONTEND_URL || 'https://xeno-studio.com'}/os/join/${session.share_token}`,
          maxParticipants: session.max_participants,
          permissions: session.permissions,
          expiresAt: session.expires_at,
          createdAt: session.created_at,
          participants: participants.rows
        },
        message: 'Returning existing active session'
      });
    }

    // Calculate expiration
    let expiresAt = null;
    if (expiresIn) {
      const hours = parseInt(expiresIn);
      if (!isNaN(hours) && hours > 0) {
        expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
      }
    }

    // Create new session
    const shareToken = generateToken();
    const sessionResult = await pool.query(
      `INSERT INTO os_collaborative_sessions
       (container_id, owner_id, name, share_token, max_participants, permissions, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        containerId,
        userId,
        name || 'Collaborative Session',
        shareToken,
        maxParticipants || 10,
        JSON.stringify(permissions || { canEdit: true, canDelete: false, canCreateFiles: true }),
        expiresAt
      ]
    );

    const session = sessionResult.rows[0];

    // Get user info for adding as first participant
    const userResult = await pool.query(
      'SELECT display_name, avatar_url FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];

    // Add owner as first participant
    await pool.query(
      `INSERT INTO os_session_participants
       (session_id, user_id, display_name, avatar_url, color, permissions)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.id,
        userId,
        user?.display_name || 'Owner',
        user?.avatar_url,
        PARTICIPANT_COLORS[0],
        JSON.stringify({ canEdit: true, canDelete: true, canCreateFiles: true, isOwner: true })
      ]
    );

    res.status(201).json({
      success: true,
      session: {
        id: session.id,
        containerId: session.container_id,
        name: session.name,
        shareToken: session.share_token,
        shareUrl: `${process.env.FRONTEND_URL || 'https://xeno-studio.com'}/os/join/${session.share_token}`,
        maxParticipants: session.max_participants,
        permissions: session.permissions,
        expiresAt: session.expires_at,
        createdAt: session.created_at
      }
    });
  } catch (error) {
    console.error('Error creating collaborative session:', error);
    res.status(500).json({ error: 'Failed to create collaborative session' });
  }
});

/**
 * GET /api/collaboration/sessions/:sessionId
 * Get session details
 */
router.get('/sessions/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    // SECURITY: scope to owner/participants — previously ANY authenticated user
    // could fetch any session by id, and the row includes share_token (which
    // grants join access).
    const sessionResult = await pool.query(
      `SELECT s.*,
              CASE WHEN s.owner_id = $2 THEN true ELSE false END as is_owner
       FROM os_collaborative_sessions s
       WHERE s.id = $1 AND s.is_active = true
         AND (
           s.owner_id = $2
           OR EXISTS (
             SELECT 1 FROM os_session_participants p
             WHERE p.session_id = s.id AND p.user_id = $2
           )
         )`,
      [sessionId, userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    // Get participants
    const participants = await pool.query(
      `SELECT p.*, u.email
       FROM os_session_participants p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.session_id = $1 AND p.is_active = true
       ORDER BY p.joined_at ASC`,
      [sessionId]
    );

    res.json({
      success: true,
      session: {
        ...session,
        participants: participants.rows
      }
    });
  } catch (error) {
    console.error('Error getting session:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

/**
 * POST /api/collaboration/sessions/:token/join
 * Join a collaborative session via share token
 */
router.post('/sessions/:token/join', authMiddleware, async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;

    // Find session by token
    const sessionResult = await pool.query(
      `SELECT * FROM os_collaborative_sessions
       WHERE share_token = $1 AND is_active = true
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [token]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }

    const session = sessionResult.rows[0];

    // Check if already a participant
    const existingParticipant = await pool.query(
      'SELECT * FROM os_session_participants WHERE session_id = $1 AND user_id = $2',
      [session.id, userId]
    );

    if (existingParticipant.rows.length > 0) {
      // Reactivate if inactive
      if (!existingParticipant.rows[0].is_active) {
        await pool.query(
          `UPDATE os_session_participants
           SET is_active = true, last_seen_at = NOW()
           WHERE session_id = $1 AND user_id = $2`,
          [session.id, userId]
        );
      }

      const participants = await pool.query(
        'SELECT * FROM os_session_participants WHERE session_id = $1 AND is_active = true',
        [session.id]
      );

      return res.json({
        success: true,
        session: {
          id: session.id,
          containerId: session.container_id,
          ownerId: session.owner_id,
          name: session.name,
          shareToken: session.share_token,
          maxParticipants: session.max_participants,
          permissions: session.permissions,
          participants: participants.rows
        },
        participant: existingParticipant.rows[0],
        message: 'Rejoined session'
      });
    }

    // Check max participants
    const participantCount = await pool.query(
      'SELECT COUNT(*) FROM os_session_participants WHERE session_id = $1 AND is_active = true',
      [session.id]
    );

    if (parseInt(participantCount.rows[0].count) >= session.max_participants) {
      return res.status(403).json({ error: 'Session is full' });
    }

    // Get user info
    const userResult = await pool.query(
      'SELECT display_name, avatar_url FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];

    // Get next available color
    const usedColors = await pool.query(
      'SELECT color FROM os_session_participants WHERE session_id = $1',
      [session.id]
    );
    const usedColorSet = new Set(usedColors.rows.map(r => r.color));
    const availableColor = PARTICIPANT_COLORS.find(c => !usedColorSet.has(c)) || PARTICIPANT_COLORS[0];

    // Add as participant
    const participantResult = await pool.query(
      `INSERT INTO os_session_participants
       (session_id, user_id, display_name, avatar_url, color, permissions)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        session.id,
        userId,
        user?.display_name || 'Guest',
        user?.avatar_url,
        availableColor,
        JSON.stringify(session.permissions)
      ]
    );

    // Get all participants
    const participants = await pool.query(
      'SELECT * FROM os_session_participants WHERE session_id = $1 AND is_active = true',
      [session.id]
    );

    res.json({
      success: true,
      session: {
        id: session.id,
        containerId: session.container_id,
        ownerId: session.owner_id,
        name: session.name,
        shareToken: session.share_token,
        maxParticipants: session.max_participants,
        permissions: session.permissions,
        participants: participants.rows
      },
      participant: participantResult.rows[0]
    });
  } catch (error) {
    console.error('Error joining session:', error);
    res.status(500).json({ error: 'Failed to join session' });
  }
});

/**
 * POST /api/collaboration/sessions/:sessionId/invite
 * Send invitation to a user
 */
router.post('/sessions/:sessionId/invite', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;
    const { email, permissions, message } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Verify user is owner or has invite permission
    const sessionResult = await pool.query(
      'SELECT * FROM os_collaborative_sessions WHERE id = $1 AND owner_id = $2 AND is_active = true',
      [sessionId, userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have permission to invite users' });
    }

    const session = sessionResult.rows[0];

    // Check if user with email exists
    const invitedUserResult = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    const invitedUserId = invitedUserResult.rows[0]?.id;

    // Check for existing pending invitation
    const existingInvite = await pool.query(
      `SELECT * FROM os_session_invitations
       WHERE session_id = $1 AND invited_email = $2 AND status = 'pending'`,
      [sessionId, email.toLowerCase()]
    );

    if (existingInvite.rows.length > 0) {
      return res.status(400).json({ error: 'Invitation already sent to this email' });
    }

    // Create invitation
    const invitationToken = generateToken();
    const inviteResult = await pool.query(
      `INSERT INTO os_session_invitations
       (session_id, invited_by, invited_email, invited_user_id, invitation_token, permissions, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        sessionId,
        userId,
        email.toLowerCase(),
        invitedUserId,
        invitationToken,
        JSON.stringify(permissions || { canEdit: true }),
        message
      ]
    );

    const invitation = inviteResult.rows[0];

    // TODO: Send email notification
    // await sendInvitationEmail(email, session, invitation);

    res.json({
      success: true,
      invitation: {
        id: invitation.id,
        email: invitation.invited_email,
        inviteUrl: `${process.env.FRONTEND_URL || 'https://xeno-studio.com'}/os/invite/${invitationToken}`,
        expiresAt: invitation.expires_at
      }
    });
  } catch (error) {
    console.error('Error sending invitation:', error);
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

/**
 * POST /api/collaboration/invitations/:token/accept
 * Accept an invitation
 */
router.post('/invitations/:token/accept', authMiddleware, async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.user.id;

    // Find invitation
    const inviteResult = await pool.query(
      `SELECT i.*, s.share_token
       FROM os_session_invitations i
       JOIN os_collaborative_sessions s ON i.session_id = s.id
       WHERE i.invitation_token = $1 AND i.status = 'pending' AND i.expires_at > NOW()`,
      [token]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invitation not found or expired' });
    }

    const invitation = inviteResult.rows[0];

    // Update invitation status
    await pool.query(
      `UPDATE os_session_invitations
       SET status = 'accepted', accepted_at = NOW()
       WHERE id = $1`,
      [invitation.id]
    );

    // Join the session using the share token
    // Redirect to the join endpoint logic
    res.json({
      success: true,
      shareToken: invitation.share_token,
      message: 'Invitation accepted. Use the share token to join the session.'
    });
  } catch (error) {
    console.error('Error accepting invitation:', error);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

/**
 * POST /api/collaboration/sessions/:sessionId/leave
 * Leave a collaborative session
 */
router.post('/sessions/:sessionId/leave', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    // Mark participant as inactive
    await pool.query(
      `UPDATE os_session_participants
       SET is_active = false, last_seen_at = NOW()
       WHERE session_id = $1 AND user_id = $2`,
      [sessionId, userId]
    );

    // Log activity
    await pool.query(
      `INSERT INTO os_session_activity (session_id, user_id, action_type, action_data)
       VALUES ($1, $2, 'user_left', $3)`,
      [sessionId, userId, JSON.stringify({ timestamp: new Date().toISOString() })]
    );

    res.json({ success: true, message: 'Left session' });
  } catch (error) {
    console.error('Error leaving session:', error);
    res.status(500).json({ error: 'Failed to leave session' });
  }
});

/**
 * DELETE /api/collaboration/sessions/:sessionId
 * End a collaborative session (owner only)
 */
router.delete('/sessions/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const sessionResult = await pool.query(
      'SELECT * FROM os_collaborative_sessions WHERE id = $1 AND owner_id = $2',
      [sessionId, userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have permission to end this session' });
    }

    // Mark session as inactive
    await pool.query(
      'UPDATE os_collaborative_sessions SET is_active = false, updated_at = NOW() WHERE id = $1',
      [sessionId]
    );

    // Mark all participants as inactive
    await pool.query(
      'UPDATE os_session_participants SET is_active = false WHERE session_id = $1',
      [sessionId]
    );

    res.json({ success: true, message: 'Session ended' });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

/**
 * PATCH /api/collaboration/sessions/:sessionId/cursor
 * Update cursor position (called frequently, optimized)
 */
router.patch('/sessions/:sessionId/cursor', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;
    const { x, y, windowId } = req.body;

    await pool.query(
      `UPDATE os_session_participants
       SET cursor_x = $1, cursor_y = $2, cursor_window_id = $3,
           last_seen_at = NOW(), last_cursor_update = NOW()
       WHERE session_id = $4 AND user_id = $5`,
      [x, y, windowId, sessionId, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating cursor:', error);
    res.status(500).json({ error: 'Failed to update cursor' });
  }
});

/**
 * GET /api/collaboration/sessions/:sessionId/participants
 * Get active participants with cursor positions
 */
router.get('/sessions/:sessionId/participants', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    // SECURITY: only the owner or a participant may list participants
    const membership = await pool.query(
      `SELECT 1 FROM os_collaborative_sessions s
       WHERE s.id = $1 AND s.is_active = true
         AND (
           s.owner_id = $2
           OR EXISTS (
             SELECT 1 FROM os_session_participants p
             WHERE p.session_id = s.id AND p.user_id = $2
           )
         )`,
      [sessionId, userId]
    );
    if (membership.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const participants = await pool.query(
      `SELECT id, user_id, display_name, avatar_url, cursor_x, cursor_y,
              cursor_window_id, color, permissions, joined_at, last_seen_at
       FROM os_session_participants
       WHERE session_id = $1 AND is_active = true
       ORDER BY joined_at ASC`,
      [sessionId]
    );

    res.json({
      success: true,
      participants: participants.rows
    });
  } catch (error) {
    console.error('Error getting participants:', error);
    res.status(500).json({ error: 'Failed to get participants' });
  }
});

/**
 * GET /api/collaboration/my-sessions
 * Get all sessions user owns or is participating in
 */
router.get('/my-sessions', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get owned sessions
    const ownedSessions = await pool.query(
      `SELECT s.*,
              (SELECT COUNT(*) FROM os_session_participants WHERE session_id = s.id AND is_active = true) as participant_count
       FROM os_collaborative_sessions s
       WHERE s.owner_id = $1 AND s.is_active = true
       ORDER BY s.last_activity_at DESC`,
      [userId]
    );

    // Get participating sessions (not owned)
    const participatingSessions = await pool.query(
      `SELECT s.*, p.color as my_color, p.joined_at as my_joined_at,
              (SELECT COUNT(*) FROM os_session_participants WHERE session_id = s.id AND is_active = true) as participant_count
       FROM os_collaborative_sessions s
       JOIN os_session_participants p ON s.id = p.session_id
       WHERE p.user_id = $1 AND p.is_active = true AND s.owner_id != $1 AND s.is_active = true
       ORDER BY s.last_activity_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      owned: ownedSessions.rows,
      participating: participatingSessions.rows
    });
  } catch (error) {
    console.error('Error getting sessions:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

/**
 * POST /api/collaboration/sessions/:sessionId/activity
 * Log session activity (file operations, window changes, etc.)
 */
router.post('/sessions/:sessionId/activity', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;
    const { actionType, actionData } = req.body;

    await pool.query(
      `INSERT INTO os_session_activity (session_id, user_id, action_type, action_data)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, userId, actionType, JSON.stringify(actionData)]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error logging activity:', error);
    res.status(500).json({ error: 'Failed to log activity' });
  }
});

/**
 * PATCH /api/collaboration/sessions/:sessionId/participants/:participantId/kick
 * Remove a participant from session (owner only)
 */
router.patch('/sessions/:sessionId/participants/:participantId/kick', authMiddleware, async (req, res) => {
  try {
    const { sessionId, participantId } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const sessionResult = await pool.query(
      'SELECT * FROM os_collaborative_sessions WHERE id = $1 AND owner_id = $2',
      [sessionId, userId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(403).json({ error: 'Only session owner can remove participants' });
    }

    // Cannot kick yourself
    const participant = await pool.query(
      'SELECT user_id FROM os_session_participants WHERE id = $1',
      [participantId]
    );

    if (participant.rows.length > 0 && participant.rows[0].user_id === userId) {
      return res.status(400).json({ error: 'Cannot remove yourself' });
    }

    await pool.query(
      'UPDATE os_session_participants SET is_active = false WHERE id = $1 AND session_id = $2',
      [participantId, sessionId]
    );

    res.json({ success: true, message: 'Participant removed' });
  } catch (error) {
    console.error('Error kicking participant:', error);
    res.status(500).json({ error: 'Failed to remove participant' });
  }
});

export default router;
