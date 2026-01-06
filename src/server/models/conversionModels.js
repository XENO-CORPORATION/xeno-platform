/**
 * Conversion Models
 * Database operations for file conversion system
 */

import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Storage limit in bytes (50GB default - increased for testing)
const STORAGE_LIMIT_BYTES = parseInt(process.env.STORAGE_LIMIT_GB || '50') * 1024 * 1024 * 1024;

/**
 * Create a new conversion file record
 */
export async function createConversionFile(userId, originalName, storedFilename, filePath, fileSize, mimeType) {
  const query = `
    INSERT INTO conversion_files (user_id, original_name, stored_filename, file_path, file_size, mime_type)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const values = [userId, originalName, storedFilename, filePath, fileSize, mimeType];
  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Get conversion file by ID
 */
export async function getConversionFileById(fileId, userId) {
  const query = `
    SELECT * FROM conversion_files 
    WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
  `;
  const result = await pool.query(query, [fileId, userId]);
  return result.rows[0];
}

/**
 * Create a new conversion record
 */
export async function createConversion(fileId, userId, inputFormat, outputFormat, settings) {
  const query = `
    INSERT INTO conversions (file_id, user_id, input_format, output_format, settings, status)
    VALUES ($1, $2, $3, $4, $5, 'pending')
    RETURNING *
  `;
  const values = [fileId, userId, inputFormat, outputFormat, JSON.stringify(settings)];
  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Update conversion status
 */
export async function updateConversionStatus(conversionId, status, progress, outputPath = null, outputSize = null, errorMessage = null) {
  let query;
  let values;

  if (status === 'processing') {
    query = `
      UPDATE conversions 
      SET status = $1, progress = $2, started_at = COALESCE(started_at, NOW())
      WHERE id = $3
      RETURNING *
    `;
    values = [status, progress, conversionId];
  } else if (status === 'completed') {
    query = `
      UPDATE conversions 
      SET status = $1, progress = $2, output_path = $3, output_size = $4, completed_at = NOW()
      WHERE id = $5
      RETURNING *
    `;
    values = [status, progress, outputPath, outputSize, conversionId];
  } else if (status === 'failed') {
    query = `
      UPDATE conversions 
      SET status = $1, error_message = $2, completed_at = NOW()
      WHERE id = $3
      RETURNING *
    `;
    values = [status, errorMessage, conversionId];
  } else {
    query = `
      UPDATE conversions 
      SET status = $1, progress = $2
      WHERE id = $3
      RETURNING *
    `;
    values = [status, progress, conversionId];
  }

  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Get conversion by ID
 */
export async function getConversionById(conversionId, userId) {
  const query = `
    SELECT c.*, cf.original_name, cf.stored_filename, cf.file_path, cf.mime_type, cf.file_size
    FROM conversions c
    JOIN conversion_files cf ON c.file_id = cf.id
    WHERE c.id = $1 AND c.user_id = $2
  `;
  const result = await pool.query(query, [conversionId, userId]);
  return result.rows[0];
}

/**
 * Get conversion history for a user
 */
export async function getConversionHistory(userId, limit = 50, offset = 0) {
  const query = `
    SELECT c.*, cf.original_name, cf.stored_filename, cf.mime_type, cf.file_size
    FROM conversions c
    JOIN conversion_files cf ON c.file_id = cf.id
    WHERE c.user_id = $1
    ORDER BY c.created_at DESC
    LIMIT $2 OFFSET $3
  `;
  const result = await pool.query(query, [userId, limit, offset]);
  return result.rows;
}

/**
 * Check if user has exceeded storage limit
 */
export async function checkStorageLimit(userId, additionalSize) {
  const query = `
    SELECT total_size FROM user_storage_usage WHERE user_id = $1
  `;
  const result = await pool.query(query, [userId]);
  
  const currentSize = result.rows[0]?.total_size || 0;
  const newTotalSize = currentSize + additionalSize;
  
  return {
    withinLimit: newTotalSize <= STORAGE_LIMIT_BYTES,
    currentSize,
    newTotalSize,
    limit: STORAGE_LIMIT_BYTES,
    available: STORAGE_LIMIT_BYTES - currentSize
  };
}

/**
 * Update user storage usage
 */
export async function updateStorageUsage(userId, fileSizeDelta, fileCountDelta) {
  const query = `
    INSERT INTO user_storage_usage (user_id, total_files, total_size, last_updated)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (user_id) 
    DO UPDATE SET 
      total_files = user_storage_usage.total_files + $2,
      total_size = user_storage_usage.total_size + $3,
      last_updated = NOW()
    RETURNING *
  `;
  const values = [userId, fileCountDelta, fileSizeDelta];
  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Get user storage usage
 */
export async function getStorageUsage(userId) {
  const query = `
    SELECT * FROM user_storage_usage WHERE user_id = $1
  `;
  const result = await pool.query(query, [userId]);
  
  if (result.rows.length === 0) {
    return {
      user_id: userId,
      total_files: 0,
      total_size: 0,
      limit: STORAGE_LIMIT_BYTES
    };
  }
  
  return {
    ...result.rows[0],
    limit: STORAGE_LIMIT_BYTES
  };
}

/**
 * Delete conversion and associated files
 */
export async function deleteConversion(conversionId, userId) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get conversion details
    const conversionQuery = `
      SELECT c.*, cf.file_size, cf.stored_filename, cf.file_path
      FROM conversions c
      JOIN conversion_files cf ON c.file_id = cf.id
      WHERE c.id = $1 AND c.user_id = $2
    `;
    const conversionResult = await client.query(conversionQuery, [conversionId, userId]);
    
    if (conversionResult.rows.length === 0) {
      throw new Error('Conversion not found');
    }
    
    const conversion = conversionResult.rows[0];
    
    // Calculate storage to free up
    let totalSizeFreed = conversion.file_size;
    if (conversion.output_size) {
      totalSizeFreed += conversion.output_size;
    }
    
    // Delete conversion record
    await client.query('DELETE FROM conversions WHERE id = $1', [conversionId]);
    
    // Update storage usage
    await client.query(`
      UPDATE user_storage_usage 
      SET total_files = total_files - 1,
          total_size = total_size - $1,
          last_updated = NOW()
      WHERE user_id = $2
    `, [totalSizeFreed, userId]);
    
    await client.query('COMMIT');
    
    return {
      conversion,
      filesToDelete: [conversion.file_path, conversion.output_path].filter(Boolean)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get old conversions for cleanup (older than retention days)
 */
export async function getOldConversions(retentionDays) {
  const query = `
    SELECT c.*, cf.file_path, cf.stored_filename
    FROM conversions c
    JOIN conversion_files cf ON c.file_id = cf.id
    WHERE c.completed_at < NOW() - INTERVAL '${retentionDays} days'
    AND c.status = 'completed'
  `;
  const result = await pool.query(query);
  return result.rows;
}

/**
 * Delete old conversion (for cleanup service)
 */
export async function deleteOldConversion(conversionId) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get conversion and file details
    const query = `
      SELECT c.*, cf.file_size, cf.user_id
      FROM conversions c
      JOIN conversion_files cf ON c.file_id = cf.id
      WHERE c.id = $1
    `;
    const result = await client.query(query, [conversionId]);
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    
    const conversion = result.rows[0];
    const totalSize = conversion.file_size + (conversion.output_size || 0);
    
    // Delete conversion
    await client.query('DELETE FROM conversions WHERE id = $1', [conversionId]);
    
    // Update storage usage
    await client.query(`
      UPDATE user_storage_usage 
      SET total_files = GREATEST(0, total_files - 1),
          total_size = GREATEST(0, total_size - $1),
          last_updated = NOW()
      WHERE user_id = $2
    `, [totalSize, conversion.user_id]);
    
    await client.query('COMMIT');
    
    return conversion;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export default {
  createConversionFile,
  getConversionFileById,
  createConversion,
  updateConversionStatus,
  getConversionById,
  getConversionHistory,
  checkStorageLimit,
  updateStorageUsage,
  getStorageUsage,
  deleteConversion,
  getOldConversions,
  deleteOldConversion
};

