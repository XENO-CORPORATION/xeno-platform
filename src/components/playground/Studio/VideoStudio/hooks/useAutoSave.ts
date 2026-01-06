/**
 * Auto-Save Hook
 * Automatically saves project state to database at intervals defined by workflow settings
 */

import { useEffect, useRef, useCallback } from 'react';
import videoStudioService from '../../../../../services/videoStudioService';

export interface AutoSaveOptions {
  projectId: string;
  autoSaveInterval: number; // in seconds
  enabled: boolean;
  onSave?: () => void;
  onError?: (error: Error) => void;
}

export interface ProjectState {
  timeline_data?: any;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  [key: string]: any;
}

/**
 * Hook to enable auto-save functionality
 * Saves project state at regular intervals
 */
export function useAutoSave(
  projectState: ProjectState,
  options: AutoSaveOptions
) {
  const {
    projectId,
    autoSaveInterval,
    enabled,
    onSave,
    onError
  } = options;

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedStateRef = useRef<string>('');
  const isSavingRef = useRef<boolean>(false);

  /**
   * Save project state to database
   */
  const saveProject = useCallback(async () => {
    if (isSavingRef.current || !projectId) {
      return;
    }

    try {
      isSavingRef.current = true;

      // Serialize current state
      const currentStateStr = JSON.stringify(projectState);

      // Skip save if state hasn't changed
      if (currentStateStr === lastSavedStateRef.current) {
        console.log('⏭️  Auto-save skipped (no changes detected)');
        return;
      }

      console.log('💾 Auto-saving project...');

      await videoStudioService.updateProject(projectId, projectState);

      // Update last saved state
      lastSavedStateRef.current = currentStateStr;

      console.log('✅ Auto-save completed');

      onSave?.();
    } catch (error) {
      console.error('❌ Auto-save failed:', error);
      onError?.(error as Error);
    } finally {
      isSavingRef.current = false;
    }
  }, [projectId, projectState, onSave, onError]);

  /**
   * Schedule next auto-save
   */
  const scheduleAutoSave = useCallback(() => {
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    if (!enabled || autoSaveInterval <= 0) {
      return;
    }

    // Schedule next save
    saveTimeoutRef.current = setTimeout(() => {
      saveProject();
      scheduleAutoSave(); // Reschedule for next interval
    }, autoSaveInterval * 1000);
  }, [enabled, autoSaveInterval, saveProject]);

  /**
   * Manual save function (for explicit saves)
   */
  const manualSave = useCallback(async () => {
    // Clear scheduled save since we're doing manual
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    await saveProject();

    // Reschedule auto-save
    scheduleAutoSave();
  }, [saveProject, scheduleAutoSave]);

  /**
   * Initialize auto-save
   */
  useEffect(() => {
    if (enabled && autoSaveInterval > 0) {
      console.log(`🔄 Auto-save enabled (interval: ${autoSaveInterval}s)`);
      scheduleAutoSave();
    } else {
      console.log('⏸️  Auto-save disabled');
    }

    // Cleanup on unmount
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [enabled, autoSaveInterval, scheduleAutoSave]);

  /**
   * Save on unmount (if there are unsaved changes)
   */
  useEffect(() => {
    return () => {
      const currentStateStr = JSON.stringify(projectState);
      if (currentStateStr !== lastSavedStateRef.current && !isSavingRef.current) {
        // Synchronous save on unmount
        console.log('💾 Saving changes before unmount...');
        videoStudioService.updateProject(projectId, projectState)
          .then(() => console.log('✅ Final save completed'))
          .catch((err) => console.error('❌ Final save failed:', err));
      }
    };
  }, [projectId, projectState]);

  return {
    manualSave,
    isSaving: isSavingRef.current
  };
}
