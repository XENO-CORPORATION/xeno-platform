/**
 * XenoOS File System API Routes
 * Comprehensive REST API for persistent file system operations
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';

const router = express.Router();

// Configure multer for file uploads
const uploadDir = path.join(process.cwd(), 'src/server/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniquePrefix = uuidv4();
    cb(null, `${uniquePrefix}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  }
});

// Middleware to get user ID from JWT token
// SECURITY FIX: Removed hardcoded test user — all filesystem access now requires authentication
const getUserId = async (req, res, next) => {
  try {
    // Use authenticated user from authMiddleware if available
    if (req.user && req.user.id) {
      req.userId = req.user.id;
      return next();
    }

    // Fall back to JWT verification
    const jwt = await import('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required for filesystem access'
      });
    }

    const decoded = jwt.default.verify(token, JWT_SECRET);
    const userCheck = await req.db.query('SELECT id FROM users WHERE id = $1 AND is_active = true', [decoded.userId]);

    if (userCheck.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    req.userId = decoded.userId;
    next();
  } catch (error) {
    console.error('Filesystem auth error:', error.message);
    res.status(401).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

// Helper function to calculate file checksum
const calculateChecksum = (filePath) => {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
};

// Helper function to get MIME type
const getMimeType = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
  };
  return mimeTypes[ext] || 'application/octet-stream';
};

// GET /api/filesystem - List files and folders in a directory
router.get('/', getUserId, async (req, res) => {
  try {
    const { parentId, path: dirPath, includeDeleted = false } = req.query;
    const userId = req.userId;

    let query;
    let queryParams;

    if (parentId) {
      query = `
        SELECT fe.*, fp.permission,
               CASE WHEN fe.type = 'file' THEN fv.version_number ELSE NULL END as current_version
        FROM filesystem_entries fe
        LEFT JOIN file_permissions fp ON fe.id = fp.entry_id AND fp.user_id = $1
        LEFT JOIN file_versions fv ON fe.id = fv.file_id AND fv.version_number = (
          SELECT MAX(version_number) FROM file_versions WHERE file_id = fe.id
        )
        WHERE fe.user_id = $1 AND fe.parent_id = $2
      `;
      queryParams = [userId, parentId];
    } else if (dirPath) {
      query = `
        SELECT fe.*, fp.permission,
               CASE WHEN fe.type = 'file' THEN fv.version_number ELSE NULL END as current_version
        FROM filesystem_entries fe
        LEFT JOIN file_permissions fp ON fe.id = fp.entry_id AND fp.user_id = $1
        LEFT JOIN file_versions fv ON fe.id = fv.file_id AND fv.version_number = (
          SELECT MAX(version_number) FROM file_versions WHERE file_id = fe.id
        )
        WHERE fe.user_id = $1 AND fe.path = $2
      `;
      queryParams = [userId, dirPath];
    } else {
      // Get root directory
      query = `
        SELECT fe.*, fp.permission,
               CASE WHEN fe.type = 'file' THEN fv.version_number ELSE NULL END as current_version
        FROM filesystem_entries fe
        LEFT JOIN file_permissions fp ON fe.id = fp.entry_id AND fp.user_id = $1
        LEFT JOIN file_versions fv ON fe.id = fv.file_id AND fv.version_number = (
          SELECT MAX(version_number) FROM file_versions WHERE file_id = fe.id
        )
        WHERE fe.user_id = $1 AND fe.parent_id IS NULL
      `;
      queryParams = [userId];
    }

    if (!includeDeleted) {
      query += ' AND (fe.is_deleted = false OR fe.is_deleted IS NULL)';
    }

    query += ' ORDER BY fe.type, fe.name';

    const result = await req.db.query(query, queryParams);

    res.json({
      success: true,
      data: {
        entries: result.rows,
        count: result.rows.length
      }
    });

  } catch (error) {
    console.error('List filesystem entries error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list filesystem entries',
      message: error.message
    });
  }
});

// POST /api/filesystem/folders - Create a new folder
router.post('/folders', getUserId, async (req, res) => {
  try {
    const { name, parentId } = req.body;
    const userId = req.userId;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Folder name is required'
      });
    }

    // Check if parent exists and user has access
    if (parentId) {
      const parentQuery = 'SELECT * FROM filesystem_entries WHERE id = $1 AND user_id = $2';
      const parentResult = await req.db.query(parentQuery, [parentId, userId]);

      if (parentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Parent directory not found'
        });
      }

      if (parentResult.rows[0].type !== 'folder') {
        return res.status(400).json({
          success: false,
          error: 'Parent must be a folder'
        });
      }
    }

    // Check for duplicate names
    const duplicateQuery = 'SELECT * FROM filesystem_entries WHERE user_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND name = $3 AND is_deleted = false';
    const duplicateResult = await req.db.query(duplicateQuery, [userId, parentId, name]);

    if (duplicateResult.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'A file or folder with this name already exists'
      });
    }

    // Calculate path
    let fullPath;
    if (parentId) {
      const pathQuery = 'SELECT get_full_path($1) as path';
      const pathResult = await req.db.query(pathQuery, [parentId]);
      fullPath = pathResult.rows[0].path + '/' + name;
    } else {
      fullPath = '/' + name;
    }

    // Create folder
    const insertQuery = `
      INSERT INTO filesystem_entries (user_id, parent_id, name, type, path)
      VALUES ($1, $2, $3, 'folder', $4)
      RETURNING *
    `;

    const result = await req.db.query(insertQuery, [userId, parentId, name, fullPath]);
    const newFolder = result.rows[0];

    // Log operation
    await req.db.query(`
      INSERT INTO file_operations_log (entry_id, user_id, operation, new_path, new_name, metadata)
      VALUES ($1, $2, 'create', $3, $4, $5)
    `, [newFolder.id, userId, fullPath, name, { type: 'folder' }]);

    res.status(201).json({
      success: true,
      data: newFolder,
      message: 'Folder created successfully'
    });

  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create folder',
      message: error.message
    });
  }
});

// POST /api/filesystem/upload - Upload files
router.post('/upload', getUserId, upload.array('files'), async (req, res) => {
  try {
    const { parentId } = req.body;
    const userId = req.userId;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      });
    }

    // Check if parent exists and user has access
    if (parentId) {
      const parentQuery = 'SELECT * FROM filesystem_entries WHERE id = $1 AND user_id = $2 AND type = \'folder\'';
      const parentResult = await req.db.query(parentQuery, [parentId, userId]);

      if (parentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Parent directory not found'
        });
      }
    }

    const uploadedFiles = [];

    for (const file of files) {
      try {
        // Calculate checksum
        const checksum = calculateChecksum(file.path);
        const mimeType = getMimeType(file.originalname);

        // Get parent path
        let parentPath = '/';
        if (parentId) {
          const pathQuery = 'SELECT get_full_path($1) as path';
          const pathResult = await req.db.query(pathQuery, [parentId]);
          parentPath = pathResult.rows[0].path;
        }

        const filePath = parentPath + '/' + file.originalname;

        // Check for duplicate names
        const duplicateQuery = 'SELECT * FROM filesystem_entries WHERE user_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND name = $3 AND is_deleted = false';
        const duplicateResult = await req.db.query(duplicateQuery, [userId, parentId, file.originalname]);

        let fileEntry;
        if (duplicateResult.rows.length > 0) {
          // Update existing file
          const updateQuery = `
            UPDATE filesystem_entries
            SET size = $1, mime_type = $2, checksum = $3, updated_at = NOW(), last_accessed_at = NOW()
            WHERE id = $4
            RETURNING *
          `;
          const updateResult = await req.db.query(updateQuery, [file.size, mimeType, checksum, duplicateResult.rows[0].id]);
          fileEntry = updateResult.rows[0];
        } else {
          // Create new file entry
          const insertQuery = `
            INSERT INTO filesystem_entries (user_id, parent_id, name, type, path, size, mime_type, checksum)
            VALUES ($1, $2, $3, 'file', $4, $5, $6, $7)
            RETURNING *
          `;
          const insertResult = await req.db.query(insertQuery, [userId, parentId, file.originalname, filePath, file.size, mimeType, checksum]);
          fileEntry = insertResult.rows[0];
        }

        // Create version entry
        const versionQuery = `
          INSERT INTO file_versions (file_id, version_number, size, checksum, storage_path, created_by)
          VALUES ($1, COALESCE((SELECT MAX(version_number) FROM file_versions WHERE file_id = $1), 0) + 1, $2, $3, $4, $5)
          RETURNING *
        `;
        await req.db.query(versionQuery, [fileEntry.id, file.size, checksum, file.path, userId]);

        // Log operation
        await req.db.query(`
          INSERT INTO file_operations_log (entry_id, user_id, operation, new_path, new_name, metadata)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [fileEntry.id, userId, duplicateResult.rows.length > 0 ? 'update' : 'create', filePath, file.originalname, {
          size: file.size,
          mimeType,
          checksum
        }]);

        uploadedFiles.push({
          ...fileEntry,
          tempPath: file.path,
          originalName: file.originalname
        });

      } catch (fileError) {
        console.error(`Error processing file ${file.originalname}:`, fileError);
        // Continue with other files
      }
    }

    res.status(201).json({
      success: true,
      data: {
        files: uploadedFiles,
        count: uploadedFiles.length
      },
      message: `${uploadedFiles.length} file(s) uploaded successfully`
    });

  } catch (error) {
    console.error('Upload files error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload files',
      message: error.message
    });
  }
});

// GET /api/filesystem/:id - Get file/folder details
router.get('/:id', getUserId, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const query = `
      SELECT fe.*, fp.permission,
             CASE WHEN fe.type = 'file' THEN fv.version_number ELSE NULL END as current_version,
             CASE WHEN fe.type = 'file' THEN fv.checksum ELSE NULL END as current_checksum
      FROM filesystem_entries fe
      LEFT JOIN file_permissions fp ON fe.id = fp.entry_id AND fp.user_id = $1
      LEFT JOIN file_versions fv ON fe.id = fv.file_id AND fv.version_number = (
        SELECT MAX(version_number) FROM file_versions WHERE file_id = fe.id
      )
      WHERE fe.id = $2 AND fe.user_id = $1
    `;

    const result = await req.db.query(query, [userId, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File or folder not found'
      });
    }

    const entry = result.rows[0];

    // Get versions for files
    let versions = [];
    if (entry.type === 'file') {
      const versionsQuery = `
        SELECT fv.*, u.username as created_by_name
        FROM file_versions fv
        LEFT JOIN users u ON fv.created_by = u.id
        WHERE fv.file_id = $1
        ORDER BY fv.version_number DESC
      `;
      const versionsResult = await req.db.query(versionsQuery, [id]);
      versions = versionsResult.rows;
    }

    res.json({
      success: true,
      data: {
        ...entry,
        versions
      }
    });

  } catch (error) {
    console.error('Get filesystem entry error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get filesystem entry',
      message: error.message
    });
  }
});

// PUT /api/filesystem/:id - Rename or move file/folder
router.put('/:id', getUserId, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, parentId } = req.body;
    const userId = req.userId;

    // Get current entry
    const currentQuery = 'SELECT * FROM filesystem_entries WHERE id = $1 AND user_id = $2';
    const currentResult = await req.db.query(currentQuery, [id, userId]);

    if (currentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File or folder not found'
      });
    }

    const currentEntry = currentResult.rows[0];

    // Check if new parent exists and is accessible
    if (parentId && parentId !== currentEntry.parent_id) {
      const parentQuery = 'SELECT * FROM filesystem_entries WHERE id = $1 AND user_id = $2 AND type = \'folder\'';
      const parentResult = await req.db.query(parentQuery, [parentId, userId]);

      if (parentResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'New parent directory not found'
        });
      }
    }

    // Check for naming conflicts
    if (name && name !== currentEntry.name) {
      const conflictQuery = 'SELECT * FROM filesystem_entries WHERE user_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND name = $3 AND id != $4 AND is_deleted = false';
      const conflictResult = await req.db.query(conflictQuery, [userId, parentId || currentEntry.parent_id, name, id]);

      if (conflictResult.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'A file or folder with this name already exists in the target location'
        });
      }
    }

    // Update entry
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (name && name !== currentEntry.name) {
      updateFields.push(`name = $${paramCount++}`);
      updateValues.push(name);
    }

    if (parentId !== undefined && parentId !== currentEntry.parent_id) {
      updateFields.push(`parent_id = $${paramCount++}`);
      updateValues.push(parentId || null);

      // Calculate new path
      let newPath;
      if (parentId) {
        const pathQuery = 'SELECT get_full_path($1) as path';
        const pathResult = await req.db.query(pathQuery, [parentId]);
        newPath = pathResult.rows[0].path + '/' + (name || currentEntry.name);
      } else {
        newPath = '/' + (name || currentEntry.name);
      }

      updateFields.push(`path = $${paramCount++}`);
      updateValues.push(newPath);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No changes specified'
      });
    }

    updateFields.push(`updated_at = NOW()`);
    updateValues.push(id); // Add ID at the end

    const updateQuery = `
      UPDATE filesystem_entries
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const updateResult = await req.db.query(updateQuery, updateValues);
    const updatedEntry = updateResult.rows[0];

    // Log operation
    await req.db.query(`
      INSERT INTO file_operations_log (entry_id, user_id, operation, old_path, new_path, old_name, new_name, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      id,
      userId,
      parentId !== undefined && parentId !== currentEntry.parent_id ? 'move' : 'rename',
      currentEntry.path,
      updatedEntry.path,
      currentEntry.name,
      updatedEntry.name,
      { type: updatedEntry.type }
    ]);

    res.json({
      success: true,
      data: updatedEntry,
      message: `${updatedEntry.type === 'folder' ? 'Folder' : 'File'} ${parentId !== undefined && parentId !== currentEntry.parent_id ? 'moved' : 'renamed'} successfully`
    });

  } catch (error) {
    console.error('Update filesystem entry error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update filesystem entry',
      message: error.message
    });
  }
});

// DELETE /api/filesystem/:id - Delete file/folder
router.delete('/:id', getUserId, async (req, res) => {
  try {
    const { id } = req.params;
    const { permanent = false } = req.query;
    const userId = req.userId;

    // Get entry to delete
    const entryQuery = 'SELECT * FROM filesystem_entries WHERE id = $1 AND user_id = $2';
    const entryResult = await req.db.query(entryQuery, [id, userId]);

    if (entryResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File or folder not found'
      });
    }

    const entry = entryResult.rows[0];

    if (permanent) {
      // Permanently delete
      await req.db.query('DELETE FROM filesystem_entries WHERE id = $1', [id]);

      // Log operation
      await req.db.query(`
        INSERT INTO file_operations_log (user_id, operation, old_path, old_name, metadata)
        VALUES ($1, 'delete_permanent', $2, $3, $4)
      `, [userId, entry.path, entry.name, { type: entry.type }]);
    } else {
      // Soft delete
      await req.db.query(
        'UPDATE filesystem_entries SET is_deleted = true, deleted_at = NOW() WHERE id = $1',
        [id]
      );

      // Log operation
      await req.db.query(`
        INSERT INTO file_operations_log (entry_id, user_id, operation, old_path, old_name, metadata)
        VALUES ($1, $2, 'delete', $3, $4, $5)
      `, [id, userId, entry.path, entry.name, { type: entry.type }]);
    }

    res.json({
      success: true,
      message: `${entry.type === 'folder' ? 'Folder' : 'File'} ${permanent ? 'permanently deleted' : 'moved to trash'} successfully`
    });

  } catch (error) {
    console.error('Delete filesystem entry error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete filesystem entry',
      message: error.message
    });
  }
});

// GET /api/filesystem/:id/download - Download file
router.get('/:id/download', getUserId, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Get file entry
    const fileQuery = 'SELECT fe.*, fv.storage_path FROM filesystem_entries fe LEFT JOIN file_versions fv ON fe.id = fv.file_id AND fv.version_number = (SELECT MAX(version_number) FROM file_versions WHERE file_id = fe.id) WHERE fe.id = $1 AND fe.user_id = $2 AND fe.type = \'file\'';
    const fileResult = await req.db.query(fileQuery, [id, userId]);

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    const fileEntry = fileResult.rows[0];

    if (!fs.existsSync(fileEntry.storage_path)) {
      return res.status(404).json({
        success: false,
        error: 'File data not found on disk'
      });
    }

    // Update last accessed time
    await req.db.query('UPDATE filesystem_entries SET last_accessed_at = NOW() WHERE id = $1', [id]);

    // Log access
    await req.db.query(`
      INSERT INTO file_operations_log (entry_id, user_id, operation, metadata)
      VALUES ($1, $2, 'download', $3)
    `, [id, userId, { filename: fileEntry.name, size: fileEntry.size }]);

    // Set headers and stream file
    res.setHeader('Content-Type', fileEntry.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileEntry.name}"`);
    res.setHeader('Content-Length', fileEntry.size);

    const fileStream = fs.createReadStream(fileEntry.storage_path);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Download file error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download file',
      message: error.message
    });
  }
});

// GET /api/filesystem/search - Search files and folders
router.get('/search', getUserId, async (req, res) => {
  try {
    const { query: searchQuery, type, limit = 50 } = req.query;
    const userId = req.userId;

    if (!searchQuery || searchQuery.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    let searchSQL = `
      SELECT fe.*, fp.permission,
             CASE WHEN fe.type = 'file' THEN fv.version_number ELSE NULL END as current_version
      FROM filesystem_entries fe
      LEFT JOIN file_permissions fp ON fe.id = fp.entry_id AND fp.user_id = $1
      LEFT JOIN file_versions fv ON fe.id = fv.file_id AND fv.version_number = (
        SELECT MAX(version_number) FROM file_versions WHERE file_id = fe.id
      )
      WHERE fe.user_id = $1 AND fe.is_deleted = false
      AND (fe.name ILIKE $2 OR fe.path ILIKE $2)
    `;

    const searchParams = [userId, `%${searchQuery}%`];

    if (type && (type === 'file' || type === 'folder')) {
      searchSQL += ' AND fe.type = $3';
      searchParams.push(type);
    }

    searchSQL += ' ORDER BY fe.type, fe.name LIMIT $' + (searchParams.length + 1);
    searchParams.push(parseInt(limit));

    const result = await req.db.query(searchSQL, searchParams);

    res.json({
      success: true,
      data: {
        entries: result.rows,
        count: result.rows.length,
        query: searchQuery
      }
    });

  } catch (error) {
    console.error('Search filesystem error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search filesystem',
      message: error.message
    });
  }
});

// GET /api/filesystem/:id/history - Get file operation history
router.get('/:id/history', getUserId, async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 100 } = req.query;
    const userId = req.userId;

    // Verify user has access to this entry
    const entryQuery = 'SELECT * FROM filesystem_entries WHERE id = $1 AND user_id = $2';
    const entryResult = await req.db.query(entryQuery, [id, userId]);

    if (entryResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'File or folder not found'
      });
    }

    // Get operation history
    const historyQuery = `
      SELECT fol.*, u.username as performed_by_name
      FROM file_operations_log fol
      LEFT JOIN users u ON fol.user_id = u.id
      WHERE fol.entry_id = $1
      ORDER BY fol.performed_at DESC
      LIMIT $2
    `;

    const historyResult = await req.db.query(historyQuery, [id, parseInt(limit)]);

    res.json({
      success: true,
      data: {
        entry: entryResult.rows[0],
        history: historyResult.rows,
        count: historyResult.rows.length
      }
    });

  } catch (error) {
    console.error('Get file history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get file history',
      message: error.message
    });
  }
});

export default router;
