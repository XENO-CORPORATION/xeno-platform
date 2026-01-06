/**
 * IMAGE STUDIO DATABASE HOOK
 *
 * Enhances the existing useConversationHistory hook with database integration.
 * Handles:
 * - Project creation and management
 * - Session/history synchronization with database
 * - Auto-save functionality
 * - User authentication integration
 *
 * This hook wraps around the existing localStorage-based system and adds
 * database persistence for multi-device sync and long-term storage.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { imageStudioService, ImageProject, CreateImageProjectRequest } from '../../../../../services/imageStudioService';
import { authService } from '../../../../../services/authService';
import { ChatMessage, ImageGenerationSession } from '../core/types';

export interface UseImageStudioDatabaseReturn {
  // Current Project
  currentProject: ImageProject | null;
  projectLoading: boolean;
  projectError: string | null;

  // Project Management
  createProject: (params?: CreateImageProjectRequest) => Promise<ImageProject | null>;
  loadProject: (projectId: string) => Promise<void>;
  updateCurrentProject: (updates: Partial<ImageProject>) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;

  // Auto-save
  enableAutoSave: boolean;
  setEnableAutoSave: (enabled: boolean) => void;
  lastSavedAt: Date | null;
  isSaving: boolean;

  // Session Management
  saveSessionToDatabase: (messages: ChatMessage[], title?: string) => Promise<void>;
  loadSessionsFromDatabase: () => Promise<void>;

  // Authentication
  isAuthenticated: boolean;
  currentUser: any;
}

interface UseImageStudioDatabaseOptions {
  autoSaveInterval?: number; // milliseconds (default: 5000)
  autoSaveEnabled?: boolean; // default: true
}

export const useImageStudioDatabase = (
  messages: ChatMessage[],
  generationSettings: any,
  options: UseImageStudioDatabaseOptions = {}
): UseImageStudioDatabaseReturn => {

  const {
    autoSaveInterval = 5000,
    autoSaveEnabled = true
  } = options;

  // Authentication
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Project State
  const [currentProject, setCurrentProject] = useState<ImageProject | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  // Auto-save State
  const [enableAutoSave, setEnableAutoSave] = useState(autoSaveEnabled);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Refs
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveDataRef = useRef<string>('');

  // Check authentication status
  useEffect(() => {
    const checkAuth = () => {
      const authenticated = authService.isAuthenticated();
      const user = authService.getCurrentUser();
      setIsAuthenticated(authenticated);
      setCurrentUser(user);
    };

    checkAuth();

    // Re-check on storage events (multi-tab sync)
    const handleStorageChange = () => {
      checkAuth();
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  /**
   * Create a new project in the database
   */
  const createProject = useCallback(async (params: CreateImageProjectRequest = {}): Promise<ImageProject | null> => {
    if (!isAuthenticated) {
      console.warn('Cannot create project: User not authenticated');
      setProjectError('User not authenticated');
      return null;
    }

    setProjectLoading(true);
    setProjectError(null);

    try {
      const result = await imageStudioService.createProject({
        title: params.title || 'Untitled Project',
        description: params.description || '',
        model: params.model || generationSettings?.model || 'flux-kontext',
        seed: params.seed || generationSettings?.seed,
        guidance_scale: params.guidance_scale || generationSettings?.guidanceScale || 7.0,
        aspect_ratio: params.aspect_ratio || generationSettings?.aspectRatio || '1:1',
        num_images: params.num_images || generationSettings?.numImages || 1,
        style_type: params.style_type,
        style_content: params.style_content,
        style_name: params.style_name,
        canvas_data: params.canvas_data
      });

      if (result.success && result.project) {
        setCurrentProject(result.project);
        console.log('✅ Project created:', result.project.id);
        return result.project;
      } else {
        throw new Error(result.error || 'Failed to create project');
      }
    } catch (error: any) {
      console.error('❌ Create project error:', error);
      setProjectError(error.message);
      return null;
    } finally {
      setProjectLoading(false);
    }
  }, [isAuthenticated, generationSettings]);

  /**
   * Load an existing project from the database
   */
  const loadProject = useCallback(async (projectId: string): Promise<void> => {
    if (!isAuthenticated) {
      setProjectError('User not authenticated');
      return;
    }

    setProjectLoading(true);
    setProjectError(null);

    try {
      const result = await imageStudioService.getProject(projectId);

      if (result.success && result.project) {
        setCurrentProject(result.project);
        console.log('✅ Project loaded:', result.project.id);
      } else {
        throw new Error(result.error || 'Failed to load project');
      }
    } catch (error: any) {
      console.error('❌ Load project error:', error);
      setProjectError(error.message);
    } finally {
      setProjectLoading(false);
    }
  }, [isAuthenticated]);

  /**
   * Update the current project in the database
   */
  const updateCurrentProject = useCallback(async (updates: Partial<ImageProject>): Promise<void> => {
    if (!currentProject) {
      console.warn('No current project to update');
      return;
    }

    if (!isAuthenticated) {
      console.warn('Cannot update project: User not authenticated');
      return;
    }

    setIsSaving(true);

    try {
      const result = await imageStudioService.updateProject(currentProject.id, updates);

      if (result.success && result.project) {
        setCurrentProject(result.project);
        setLastSavedAt(new Date());
        console.log('💾 Project updated:', currentProject.id);
      } else {
        throw new Error(result.error || 'Failed to update project');
      }
    } catch (error: any) {
      console.error('❌ Update project error:', error);
      setProjectError(error.message);
    } finally {
      setIsSaving(false);
    }
  }, [currentProject, isAuthenticated]);

  /**
   * Delete a project
   */
  const deleteProject = useCallback(async (projectId: string): Promise<void> => {
    if (!isAuthenticated) {
      setProjectError('User not authenticated');
      return;
    }

    setProjectLoading(true);
    setProjectError(null);

    try {
      const result = await imageStudioService.deleteProject(projectId);

      if (result.success) {
        if (currentProject?.id === projectId) {
          setCurrentProject(null);
        }
        console.log('🗑️ Project deleted:', projectId);
      } else {
        throw new Error(result.error || 'Failed to delete project');
      }
    } catch (error: any) {
      console.error('❌ Delete project error:', error);
      setProjectError(error.message);
    } finally {
      setProjectLoading(false);
    }
  }, [isAuthenticated, currentProject]);

  /**
   * Save current session/chat to database
   */
  const saveSessionToDatabase = useCallback(async (
    messagesToSave: ChatMessage[],
    title?: string
  ): Promise<void> => {
    if (!currentProject) {
      console.warn('No current project - session not saved to database');
      return;
    }

    if (!isAuthenticated || messagesToSave.length === 0) {
      return;
    }

    try {
      const firstUserMessage = messagesToSave.find(msg => msg.sender === 'user');
      const sessionTitle = title || firstUserMessage?.text?.slice(0, 50) || 'Untitled Session';

      const result = await imageStudioService.saveSession({
        project_id: currentProject.id,
        session_title: sessionTitle,
        messages: messagesToSave.map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.text,
          images: msg.imageData ? [msg.imageData] : [],
          timestamp: msg.timestamp || Date.now()
        })),
        settings_snapshot: generationSettings
      });

      if (result.success) {
        console.log('💬 Session saved to database');
      } else {
        console.error('Failed to save session:', result.error);
      }
    } catch (error: any) {
      console.error('❌ Save session error:', error);
    }
  }, [currentProject, isAuthenticated, generationSettings]);

  /**
   * Load sessions from database (for history modal)
   */
  const loadSessionsFromDatabase = useCallback(async (): Promise<void> => {
    if (!currentProject || !isAuthenticated) {
      return;
    }

    try {
      const result = await imageStudioService.getSessions(currentProject.id);

      if (result.success && result.sessions) {
        console.log(`📂 Loaded ${result.sessions.length} sessions from database`);
        // Sessions can be used to populate history modal
        // The consuming component can access these via the service directly
      } else {
        console.error('Failed to load sessions:', result.error);
      }
    } catch (error: any) {
      console.error('❌ Load sessions error:', error);
    }
  }, [currentProject, isAuthenticated]);

  /**
   * Auto-save functionality
   * Periodically saves the current project state to the database
   */
  useEffect(() => {
    if (!enableAutoSave || !currentProject || !isAuthenticated || messages.length === 0) {
      return;
    }

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Create a hash of current state to detect changes
    const currentStateHash = JSON.stringify({
      messages: messages.map(m => ({ id: m.id, text: m.text, sender: m.sender })),
      settings: generationSettings
    });

    // Only save if data has changed
    if (currentStateHash === lastSaveDataRef.current) {
      return;
    }

    // Set up auto-save timer
    autoSaveTimerRef.current = setTimeout(async () => {
      console.log('⏰ Auto-save triggered');

      // Save sessions to database
      await saveSessionToDatabase(messages);

      // Update last save hash
      lastSaveDataRef.current = currentStateHash;
    }, autoSaveInterval);

    // Cleanup timer
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [enableAutoSave, currentProject, isAuthenticated, messages, generationSettings, autoSaveInterval, saveSessionToDatabase]);

  /**
   * Save on unmount or project change
   */
  useEffect(() => {
    return () => {
      // Save on unmount if there are unsaved changes
      if (currentProject && messages.length > 0) {
        saveSessionToDatabase(messages).catch(console.error);
      }
    };
  }, [currentProject, messages, saveSessionToDatabase]);

  return {
    // Current Project
    currentProject,
    projectLoading,
    projectError,

    // Project Management
    createProject,
    loadProject,
    updateCurrentProject,
    deleteProject,

    // Auto-save
    enableAutoSave,
    setEnableAutoSave,
    lastSavedAt,
    isSaving,

    // Session Management
    saveSessionToDatabase,
    loadSessionsFromDatabase,

    // Authentication
    isAuthenticated,
    currentUser
  };
};
