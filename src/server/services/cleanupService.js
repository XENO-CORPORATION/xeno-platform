/**
 * Cleanup Service
 * Automatically deletes old conversions after retention period
 */

import cron from 'node-cron';
import fs from 'fs';
import { getOldConversions, deleteOldConversion } from '../models/conversionModels.js';

const RETENTION_DAYS = parseInt(process.env.CONVERSION_RETENTION_DAYS || '7');

/**
 * Delete physical files associated with a conversion
 */
async function deleteConversionFiles(conversion) {
  const filesToDelete = [];
  
  if (conversion.file_path && fs.existsSync(conversion.file_path)) {
    filesToDelete.push(conversion.file_path);
  }
  
  if (conversion.output_path && fs.existsSync(conversion.output_path)) {
    filesToDelete.push(conversion.output_path);
  }
  
  for (const filePath of filesToDelete) {
    try {
      fs.unlinkSync(filePath);
      console.log(`[Cleanup] Deleted file: ${filePath}`);
    } catch (error) {
      console.error(`[Cleanup] Error deleting file ${filePath}:`, error.message);
    }
  }
}

/**
 * Run cleanup process
 */
async function runCleanup() {
  console.log(`[Cleanup] Starting cleanup process for conversions older than ${RETENTION_DAYS} days`);
  
  try {
    // Get old conversions from database
    const oldConversions = await getOldConversions(RETENTION_DAYS);
    
    console.log(`[Cleanup] Found ${oldConversions.length} old conversions to delete`);
    
    let deletedCount = 0;
    let errorCount = 0;
    
    // Delete each conversion
    for (const conversion of oldConversions) {
      try {
        // Delete physical files
        await deleteConversionFiles(conversion);
        
        // Delete database records and update storage usage
        await deleteOldConversion(conversion.id);
        
        deletedCount++;
      } catch (error) {
        console.error(`[Cleanup] Error deleting conversion ${conversion.id}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`[Cleanup] Cleanup complete. Deleted: ${deletedCount}, Errors: ${errorCount}`);
  } catch (error) {
    console.error('[Cleanup] Cleanup process failed:', error);
  }
}

/**
 * Initialize cleanup service
 */
export function initCleanupService() {
  console.log(`[Cleanup] Initializing cleanup service (retention: ${RETENTION_DAYS} days)`);
  
  // Run cleanup daily at 2 AM
  cron.schedule('0 2 * * *', () => {
    console.log('[Cleanup] Running scheduled cleanup');
    runCleanup();
  });
  
  // Optionally run cleanup on startup (uncomment if desired)
  // console.log('[Cleanup] Running initial cleanup on startup');
  // runCleanup();
  
  console.log('[Cleanup] Cleanup service initialized (scheduled for 2:00 AM daily)');
}

// Manual cleanup function for testing/admin use
export { runCleanup };

export default {
  initCleanupService,
  runCleanup
};

