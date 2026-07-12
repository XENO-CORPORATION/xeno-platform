/**
 * Video Studio API Routes
 * Authenticated endpoints for video project management, rendering, and export
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { tagResourceWorkspace } from '../utils/workspaceContext.js';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import videoUtilsService from '../services/videoUtilsService.js';

const router = express.Router();
const execPromise = promisify(exec);

// Ensure video storage directories exist
const VIDEOS_DIR = path.join(process.cwd(), 'storage', 'videos');
const THUMBNAILS_DIR = path.join(process.cwd(), 'storage', 'thumbnails');
const ASSETS_DIR = path.join(process.cwd(), 'storage', 'assets');

[VIDEOS_DIR, THUMBNAILS_DIR, ASSETS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Middleware to verify user authentication
 * Assumes auth middleware has already attached req.user
 */
const requireAuth = (req, res, next) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
  next();
};

// ============================================
// PROJECT MANAGEMENT ENDPOINTS
// ============================================

/**
 * POST /api/video/projects/create
 * Create a new video project
 */
router.post('/projects/create', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      title = 'Untitled Project',
      description = '',
      width = 1920,
      height = 1080,
      fps = 24,
      duration = 10,
      quality = 'high',
      aspect_ratio = '16:9',
      generation_steps = 50,
      output_format = 'mp4',
      project_metadata = null
    } = req.body;

    const projectId = uuidv4();

    const result = await req.db.query(`
      INSERT INTO video_projects (
        id, user_id, title, description, width, height, fps, duration,
        quality, aspect_ratio, generation_steps, output_format, project_metadata, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft')
      RETURNING *
    `, [
      projectId, userId, title, description, width, height, fps, duration,
      quality, aspect_ratio, generation_steps, output_format, JSON.stringify(project_metadata)
    ]);

    await tagResourceWorkspace(req.db, req, { objectType: 'video_project', objectId: projectId, table: 'video_projects' });

    res.json({
      success: true,
      project: result.rows[0]
    });

  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create project',
      message: error.message
    });
  }
});

/**
 * GET /api/video/projects
 * Get all projects for current user
 */
router.get('/projects', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM video_projects WHERE user_id = $1';
    const params = [userId];

    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }

    query += ' ORDER BY updated_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await req.db.query(query, params);

    res.json({
      success: true,
      projects: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch projects'
    });
  }
});

/**
 * GET /api/video/projects/:projectId
 * Get a specific project
 */
router.get('/projects/:projectId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;

    const result = await req.db.query(
      'SELECT * FROM video_projects WHERE id = $1 AND user_id = $2',
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
      'UPDATE video_projects SET last_opened_at = NOW() WHERE id = $1',
      [projectId]
    );

    res.json({
      success: true,
      project: result.rows[0]
    });

  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch project'
    });
  }
});

/**
 * PUT /api/video/projects/:projectId
 * Update project settings and timeline
 */
router.put('/projects/:projectId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;
    const {
      title,
      description,
      timeline_data,
      width,
      height,
      fps,
      duration,
      quality,
      aspect_ratio
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
    if (timeline_data !== undefined) {
      updates.push(`timeline_data = $${paramIndex++}`);
      values.push(JSON.stringify(timeline_data));
    }
    if (width !== undefined) {
      updates.push(`width = $${paramIndex++}`);
      values.push(width);
    }
    if (height !== undefined) {
      updates.push(`height = $${paramIndex++}`);
      values.push(height);
    }
    if (fps !== undefined) {
      updates.push(`fps = $${paramIndex++}`);
      values.push(fps);
    }
    if (duration !== undefined) {
      updates.push(`duration = $${paramIndex++}`);
      values.push(duration);
    }
    if (quality !== undefined) {
      updates.push(`quality = $${paramIndex++}`);
      values.push(quality);
    }
    if (aspect_ratio !== undefined) {
      updates.push(`aspect_ratio = $${paramIndex++}`);
      values.push(aspect_ratio);
    }

    updates.push('updated_at = NOW()');

    const result = await req.db.query(`
      UPDATE video_projects 
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

    res.json({
      success: true,
      project: result.rows[0]
    });

  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update project',
      message: error.message
    });
  }
});

/**
 * DELETE /api/video/projects/:projectId
 * Delete a project and its assets
 */
router.delete('/projects/:projectId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;

    // Get project to clean up files
    const projectResult = await req.db.query(
      'SELECT output_video_url, thumbnail_url FROM video_projects WHERE id = $1 AND user_id = $2',
      [projectId, userId]
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    // Delete project (CASCADE will delete assets and jobs)
    await req.db.query(
      'DELETE FROM video_projects WHERE id = $1 AND user_id = $2',
      [projectId, userId]
    );

    // TODO: Clean up associated files asynchronously

    res.json({
      success: true,
      message: 'Project deleted successfully'
    });

  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete project'
    });
  }
});

// ============================================
// ASSET MANAGEMENT ENDPOINTS
// ============================================

/**
 * POST /api/video/assets/upload
 * Upload asset to project
 */
router.post('/assets/upload', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      project_id,
      name,
      type, // video, image, audio
      format,
      file_url,
      duration,
      width,
      height,
      file_size,
      source = 'upload'
    } = req.body;

    if (!project_id || !name || !type || !file_url) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Get project to access workflow settings
    const projectResult = await req.db.query(
      'SELECT project_metadata FROM video_projects WHERE id = $1 AND user_id = $2',
      [project_id, userId]
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    const workflowSettings = projectResult.rows[0].project_metadata || {};

    // Extract project settings for media management
    const importBehavior = workflowSettings.importBehavior || 'reference';
    const fileOrganization = workflowSettings.fileOrganization || 'by-type';

    // Handle media management (copy/transcode) based on import behavior
    let finalFileUrl = file_url;

    if ((importBehavior === 'copy' || importBehavior === 'copy-transcode') && file_url) {
      try {
        const sourcePath = file_url.startsWith('/storage/')
          ? path.join(process.cwd(), file_url.replace('/storage/', 'storage/'))
          : file_url;

        // Determine destination path based on organization strategy
        const projectFolder = path.join(process.cwd(), 'storage', 'projects', project_id);

        let destFolder = projectFolder;
        if (fileOrganization === 'by-type') {
          destFolder = path.join(projectFolder, type); // video, image, audio folders
        } else if (fileOrganization === 'by-date') {
          const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
          destFolder = path.join(projectFolder, date);
        }

        // Create destination folder
        if (!fs.existsSync(destFolder)) {
          fs.mkdirSync(destFolder, { recursive: true });
        }

        const fileName = path.basename(sourcePath);
        const destPath = path.join(destFolder, fileName);

        console.log(`📁 Media Management: ${importBehavior} - ${fileOrganization}`);
        console.log(`   Source: ${sourcePath}`);
        console.log(`   Destination: ${destPath}`);

        // Copy file to project folder
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, destPath);
          finalFileUrl = `/storage/projects/${project_id}/${path.relative(projectFolder, destPath).replace(/\\/g, '/')}`;
          console.log(`✅ File copied to: ${finalFileUrl}`);

          // TODO: Implement transcode logic if copy-transcode is selected
          if (importBehavior === 'copy-transcode') {
            console.log('⚠️  Transcoding not yet implemented, file copied only');
          }
        }
      } catch (copyError) {
        console.warn('⚠️  File copy failed (non-critical):', copyError.message);
        // Continue with original file_url if copy fails
      }
    }

    // Process video asset with AI utilities (thumbnails, metadata, waveforms)
    let thumbnailUrl = null;
    let metadata = null;

    if (type === 'video' && finalFileUrl) {
      try {
        // Convert URL path to filesystem path
        const videoPath = finalFileUrl.startsWith('/storage/')
          ? path.join(process.cwd(), finalFileUrl.replace('/storage/', 'storage/'))
          : finalFileUrl;

        console.log(`📦 Processing uploaded video asset: ${name}`);

        const processingResults = await videoUtilsService.processUploadedAsset(
          videoPath,
          workflowSettings
        );

        thumbnailUrl = processingResults.thumbnailUrl;
        metadata = processingResults.metadata;

        // Override provided values with extracted metadata (if available)
        if (metadata) {
          if (!duration && metadata.duration) {
            duration = metadata.duration;
          }
          if (!width && metadata.video?.width) {
            width = metadata.video.width;
          }
          if (!height && metadata.video?.height) {
            height = metadata.video.height;
          }
          if (!file_size && metadata.size) {
            file_size = metadata.size;
          }
        }

        console.log(`✅ Asset processing complete for ${name}`);
      } catch (processingError) {
        console.warn('⚠️  Asset processing failed (non-critical):', processingError.message);
        // Continue with asset upload even if processing fails
      }
    }

    const assetId = uuidv4();

    const result = await req.db.query(`
      INSERT INTO video_assets (
        id, project_id, user_id, name, type, format, file_url,
        duration, width, height, file_size, source, thumbnail_url, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [
      assetId, project_id, userId, name, type, format, finalFileUrl,
      duration, width, height, file_size, source, thumbnailUrl,
      metadata ? JSON.stringify(metadata) : null
    ]);

    res.json({
      success: true,
      asset: result.rows[0]
    });

  } catch (error) {
    console.error('Upload asset error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload asset',
      message: error.message
    });
  }
});

/**
 * GET /api/video/assets/:projectId
 * Get all assets for a project
 */
router.get('/assets/:projectId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;

    const result = await req.db.query(
      'SELECT * FROM video_assets WHERE project_id = $1 AND user_id = $2 ORDER BY uploaded_at DESC',
      [projectId, userId]
    );

    res.json({
      success: true,
      assets: result.rows
    });

  } catch (error) {
    console.error('Get assets error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch assets'
    });
  }
});

// ============================================
// RENDERING ENDPOINTS
// ============================================

/**
 * POST /api/video/render
 * Queue a rendering job for a project
 */
router.post('/render', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { project_id, render_settings = {} } = req.body;

    if (!project_id) {
      return res.status(400).json({
        success: false,
        error: 'Project ID required'
      });
    }

    // Verify project exists and belongs to user
    const projectResult = await req.db.query(
      'SELECT * FROM video_projects WHERE id = $1 AND user_id = $2',
      [project_id, userId]
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    const project = projectResult.rows[0];

    // Calculate estimated credits cost (simple formula for now)
    const estimatedCredits = Math.ceil(
      (project.width * project.height * project.duration * project.fps) / 1000000
    );

    // Check user has enough credits
    const userResult = await req.db.query(
      'SELECT credits FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows[0].credits < estimatedCredits) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        required: estimatedCredits,
        available: userResult.rows[0].credits
      });
    }

    // Create render job
    const jobId = uuidv4();
    const totalFrames = Math.ceil(project.duration * project.fps);

    const jobResult = await req.db.query(`
      INSERT INTO video_render_jobs (
        id, project_id, user_id, render_settings, status,
        total_frames, credits_used
      )
      VALUES ($1, $2, $3, $4, 'queued', $5, $6)
      RETURNING *
    `, [
      jobId, project_id, userId, JSON.stringify(render_settings),
      totalFrames, estimatedCredits
    ]);

    // Update project status
    await req.db.query(
      'UPDATE video_projects SET status = $1 WHERE id = $2',
      ['rendering', project_id]
    );

    // TODO: Trigger actual rendering process in Docker container

    res.json({
      success: true,
      job: jobResult.rows[0],
      estimated_credits: estimatedCredits
    });

  } catch (error) {
    console.error('Render error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to queue render job',
      message: error.message
    });
  }
});

/**
 * GET /api/video/render/:jobId/status
 * Get rendering job status
 */
router.get('/render/:jobId/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { jobId } = req.params;

    const result = await req.db.query(
      'SELECT * FROM video_render_jobs WHERE id = $1 AND user_id = $2',
      [jobId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Render job not found'
      });
    }

    res.json({
      success: true,
      job: result.rows[0]
    });

  } catch (error) {
    console.error('Get job status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch job status'
    });
  }
});

/**
 * POST /api/video/render/:jobId/cancel
 * Cancel a rendering job
 */
router.post('/render/:jobId/cancel', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { jobId } = req.params;

    const result = await req.db.query(`
      UPDATE video_render_jobs 
      SET status = 'cancelled', completed_at = NOW()
      WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'processing')
      RETURNING *
    `, [jobId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Cannot cancel job (not found or already completed)'
      });
    }

    // TODO: Stop Docker container if running

    res.json({
      success: true,
      message: 'Render job cancelled'
    });

  } catch (error) {
    console.error('Cancel job error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel job'
    });
  }
});

/**
 * POST /api/video/export
 * Export project as downloadable file
 */
router.post('/export', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { project_id, format = 'mp4', quality = 'high' } = req.body;

    // Get project
    const projectResult = await req.db.query(
      'SELECT * FROM video_projects WHERE id = $1 AND user_id = $2',
      [project_id, userId]
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    const project = projectResult.rows[0];

    if (project.status !== 'completed' || !project.output_video_url) {
      return res.status(400).json({
        success: false,
        error: 'Project must be rendered before export'
      });
    }

    // Return download URL
    res.json({
      success: true,
      download_url: project.output_video_url,
      format: project.output_format,
      file_size: project.file_size
    });

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export project'
    });
  }
});

// ============================================
// SESSION MANAGEMENT (History)
// ============================================

/**
 * POST /api/video/sessions/save
 * Save current session/version
 */
router.post('/sessions/save', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      project_id,
      session_title,
      timeline_snapshot,
      settings_snapshot,
      message_count = 0
    } = req.body;

    const sessionId = uuidv4();

    const result = await req.db.query(`
      INSERT INTO video_project_sessions (
        id, project_id, user_id, session_title,
        timeline_snapshot, settings_snapshot, message_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      sessionId, project_id, userId, session_title,
      JSON.stringify(timeline_snapshot),
      JSON.stringify(settings_snapshot),
      message_count
    ]);

    res.json({
      success: true,
      session: result.rows[0]
    });

  } catch (error) {
    console.error('Save session error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save session'
    });
  }
});

/**
 * GET /api/video/sessions/:projectId
 * Get all sessions for a project
 */
router.get('/sessions/:projectId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.params;

    const result = await req.db.query(
      'SELECT * FROM video_project_sessions WHERE project_id = $1 AND user_id = $2 ORDER BY created_at DESC',
      [projectId, userId]
    );

    res.json({
      success: true,
      sessions: result.rows
    });

  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sessions'
    });
  }
});

export default router;
