import { useState, useEffect, useCallback, useRef } from 'react';
import { ImageGenerationSession, ChatMessage } from '../core/types';
import { useImagePreloader } from '../core/utils';
import { imageStudioService } from '../../../../../services/imageStudioService';

interface UseConversationHistoryReturn {
  // State
  generationHistory: ImageGenerationSession[];
  activeSessionId: string | null;
  isHistoryOpen: boolean;
  historySearchTerm: string;
  editingSessionId: string | null;
  editTitleText: string;
  deleteConfirmationModal: {
    isOpen: boolean;
    sessionId: string | null;
    sessionTitle: string | null;
  };
  
  // Setters
  setGenerationHistory: React.Dispatch<React.SetStateAction<ImageGenerationSession[]>>;
  setActiveSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setHistorySearchTerm: React.Dispatch<React.SetStateAction<string>>;
  setEditingSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditTitleText: React.Dispatch<React.SetStateAction<string>>;
  setDeleteConfirmationModal: React.Dispatch<React.SetStateAction<{
    isOpen: boolean;
    sessionId: string | null;
    sessionTitle: string | null;
  }>>;
  
  // Actions
  toggleHistory: () => void;
  handleLoadSession: (sessionId: string) => Promise<void>;
  handleDeleteSession: (sessionId: string) => Promise<void>;
  handleDeleteMultipleSessions: (sessionIds: string[]) => Promise<void>;
  handleSaveSessionTitle: () => void;
  handleNewSession: () => void;
  handleCancelDelete: () => void;
  createOrUpdateSession: (messages: ChatMessage[], settings?: any) => void;
  
  // Refs
  isCreatingSessionRef: React.MutableRefObject<boolean>;
  isUpdatingSessionRef: React.MutableRefObject<boolean>;
}

export const useConversationHistory = (
  messages: ChatMessage[],
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setInputValue: React.Dispatch<React.SetStateAction<string>>,
  setAttachedFiles: React.Dispatch<React.SetStateAction<any[]>>,
  setSelectedModel: React.Dispatch<React.SetStateAction<'gpt-image-2' | 'gpt-image-1' | 'flux-kontext'>>,
  setSeed: React.Dispatch<React.SetStateAction<string>>,
  setAspectRatio: React.Dispatch<React.SetStateAction<string>>,
  setNumImages: React.Dispatch<React.SetStateAction<number>>
): UseConversationHistoryReturn => {
  // State
  const [generationHistory, setGenerationHistory] = useState<ImageGenerationSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitleText, setEditTitleText] = useState('');
  const [deleteConfirmationModal, setDeleteConfirmationModal] = useState<{
    isOpen: boolean;
    sessionId: string | null;
    sessionTitle: string | null;
  }>({ isOpen: false, sessionId: null, sessionTitle: null });

  // Refs to prevent double session creation and updates
  const isCreatingSessionRef = useRef(false);
  const isUpdatingSessionRef = useRef(false);

  // Image preloader
  const { preloadImages, preloadAllConversationImages } = useImagePreloader();

  // Load generation history from localStorage on mount
  useEffect(() => {
    const loadHistory = async () => {
      // Load localStorage sessions
      const savedHistory = localStorage.getItem('imageStudioHistory');
      let localStorageSessions: ImageGenerationSession[] = [];

      if (savedHistory) {
        try {
          const parsedHistory: ImageGenerationSession[] = JSON.parse(savedHistory);
          if (Array.isArray(parsedHistory)) {
            localStorageSessions = parsedHistory;

            // Clean up orphaned image cache entries
            cleanupOrphanedImageCache(parsedHistory);
          } else {
            console.warn("Invalid image studio history format found in localStorage. Ignored.");
            localStorage.removeItem('imageStudioHistory');
          }
        } catch (error) {
          console.error("Error parsing image studio history from localStorage:", error);
          localStorage.removeItem('imageStudioHistory');
        }
      }

      // Load database projects if authenticated
      let databaseProjects: ImageGenerationSession[] = [];
      if (imageStudioService.isAuthenticated()) {
        try {
          const result = await imageStudioService.getProjects({
            limit: 50,
            sort: 'updated_at',
            order: 'DESC'
          });

          if (result.success && result.projects) {
            // Convert database projects to ImageGenerationSession format
            databaseProjects = result.projects.map(project => ({
              id: project.id,
              title: project.title,
              timestamp: new Date(project.created_at).getTime(),
              messages: [], // We'll load messages when user clicks on the project
              model: project.model as 'gpt-image-2' | 'gpt-image-1' | 'flux-kontext',
              seed: project.seed,
              aspectRatio: project.aspect_ratio,
              numImages: project.num_images,
              guidanceScale: project.guidance_scale,
              isFromDatabase: true // Flag to identify database projects
            }));
            console.log(`📂 Loaded ${databaseProjects.length} projects from database`);
          }
        } catch (error) {
          console.error('Error loading database projects:', error);
        }
      }

      // Merge localStorage sessions and database projects
      const mergedHistory = [...databaseProjects, ...localStorageSessions];
      setGenerationHistory(mergedHistory);
    };

    loadHistory();
  }, []);

  // Helper function to clean up orphaned image cache entries
  const cleanupOrphanedImageCache = (sessions: ImageGenerationSession[]) => {
    try {
      // Collect all valid cache keys from current sessions
      const validCacheKeys = new Set<string>();
      sessions.forEach(session => {
        session.messages.forEach(message => {
          if (message.imageData && message.imageData.startsWith('cache:')) {
            const cacheKey = message.imageData.replace('cache:', '');
            validCacheKeys.add(`imageCache_${cacheKey}`);
          }
        });
      });

      // Find and remove orphaned cache entries
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('imageCache_') && !validCacheKeys.has(key)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
      });

      if (keysToRemove.length > 0) {
        console.log(`🧹 Cleaned up ${keysToRemove.length} orphaned image cache entries`);
      }
    } catch (error) {
      console.error('Error during image cache cleanup:', error);
    }
  };

  // Save generation history to localStorage whenever it changes (with smart optimization)
  useEffect(() => {
    if (generationHistory.length > 0) {
      try {
        // Create optimized version for storage with smart image handling
        const optimizedHistory = generationHistory.map(session => ({
          ...session,
          messages: session.messages.map(message => {
            const optimizedMessage = { ...message };
            
            // Smart image data handling: keep URLs, cache base64 separately
            if (optimizedMessage.imageData) {
              // If it's a URL (http/https), keep it as-is
              if (optimizedMessage.imageData.startsWith('http://') || optimizedMessage.imageData.startsWith('https://')) {
                // Keep URLs - they're small and needed for display
              }
              // If it's base64 data URI, store reference and cache separately
              else if (optimizedMessage.imageData.startsWith('data:')) {
                // Create a cache key for this image
                const imageHash = btoa(optimizedMessage.imageData.substring(0, 100)).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
                const cacheKey = `img_${message.id}_${imageHash}`;
                
                // Store the full image data in a separate cache
                try {
                  localStorage.setItem(`imageCache_${cacheKey}`, optimizedMessage.imageData);
                  // Replace with cache reference
                  optimizedMessage.imageData = `cache:${cacheKey}`;
                } catch (cacheError) {
                  // If caching fails (storage full), keep original but truncated
                  console.warn('Image cache storage failed, keeping truncated version:', cacheError);
                  optimizedMessage.imageData = optimizedMessage.imageData.substring(0, 200) + '...';
                }
              }
              // If it's too long and not a URL or data URI, truncate
              else if (optimizedMessage.imageData.length > 200) {
                optimizedMessage.imageData = optimizedMessage.imageData.substring(0, 200) + '...';
            }
            }
            
            // Keep user attachments as they're smaller and needed for conversation context
            return optimizedMessage;
          })
        }));
        
        localStorage.setItem('imageStudioHistory', JSON.stringify(optimizedHistory));
      } catch (error) {
        console.error("Error saving image studio history to localStorage:", error);
      }
    } else if (localStorage.getItem('imageStudioHistory')) { 
      localStorage.removeItem('imageStudioHistory');
    }
  }, [generationHistory]);

  // Preload images immediately when a session is loaded
  useEffect(() => {
    if (activeSessionId && generationHistory.length > 0) {
      const currentSession = generationHistory.find(session => session.id === activeSessionId);
      if (currentSession && currentSession.messages.length > 0) {
        // High priority preload for current session
        preloadAllConversationImages(currentSession.messages);
      }
    }
  }, [activeSessionId, generationHistory, preloadAllConversationImages]);

  // Actions
  const toggleHistory = () => {
    setIsHistoryOpen(!isHistoryOpen);
  };

  const handleLoadSession = useCallback(async (sessionId: string) => {
    let sessionToLoad = generationHistory.find(session => session.id === sessionId);
    
    if (sessionToLoad) {
      setActiveSessionId(sessionId);
      
      let messagesToLoad = sessionToLoad.messages;

      // 1. If it's from database and has no messages, load them
      if (sessionToLoad.isFromDatabase && messagesToLoad.length === 0) {
        try {
          const result = await imageStudioService.getSessions(sessionId);
          if (result.success && result.sessions && result.sessions.length > 0) {
            // Use the most recent session
            const dbSession = result.sessions[0];
            
            // Map database messages to local format
            messagesToLoad = dbSession.messages.map((msg: any) => ({
              id: msg.id || `db-msg-${Date.now()}-${Math.random()}`,
              sender: msg.role === 'user' ? 'user' : 'ai',
              text: msg.content,
              imageData: msg.images?.[0],
              timestamp: msg.timestamp || new Date(dbSession.created_at).getTime()
            }));

            // Update the session in history so we don't fetch again
            setGenerationHistory(prev => prev.map(s => 
              s.id === sessionId ? { ...s, messages: messagesToLoad } : s
            ));
            
            console.log(`📂 Loaded ${messagesToLoad.length} messages from database for project ${sessionId}`);
          }
        } catch (error) {
          console.error('Error loading session messages from database:', error);
        }
      }

      // Resolve cached image references and collect URLs for preloading
      const imageUrls: string[] = [];
      const resolvedMessages = messagesToLoad.map(message => {
        const resolvedMessage = { ...message };
        
        // Resolve cached image references
        if (resolvedMessage.imageData && resolvedMessage.imageData.startsWith('cache:')) {
          const cacheKey = resolvedMessage.imageData.replace('cache:', '');
          const cachedImageData = localStorage.getItem(`imageCache_${cacheKey}`);
          
          if (cachedImageData) {
            resolvedMessage.imageData = cachedImageData;
            console.log(`✅ Resolved cached image for message ${message.id}`);
          } else {
            console.warn(`⚠️ Cached image not found for key: ${cacheKey}, message: ${message.id}`);
            // Keep the cache reference - the UI will handle missing images gracefully
          }
        }
        
        // Collect image URLs for preloading
        if (resolvedMessage.imageData) {
          const isUrl = resolvedMessage.imageData.startsWith('http://') || resolvedMessage.imageData.startsWith('https://');
          const isDataUri = resolvedMessage.imageData.startsWith('data:');
          if (isUrl || isDataUri) {
            imageUrls.push(resolvedMessage.imageData);
          }
        }
        if (resolvedMessage.userImageAttachment?.base64Data) {
          imageUrls.push(`data:${resolvedMessage.userImageAttachment.type};base64,${resolvedMessage.userImageAttachment.base64Data}`);
        }
        
        return resolvedMessage;
      });

      // Preload images in parallel while setting up the session
      const preloadPromise = imageUrls.length > 0 ? preloadImages(imageUrls) : Promise.resolve();
      
      // Set resolved messages immediately for fast UI response
      setMessages(resolvedMessages);
      
      // Load session settings if available
      if (sessionToLoad.settings) {
        setSelectedModel((sessionToLoad.settings.model as any) || 'gpt-image-2');
        if (sessionToLoad.settings.seed) {
          setSeed(sessionToLoad.settings.seed);
        }
        if (sessionToLoad.settings.aspectRatio) {
          setAspectRatio(sessionToLoad.settings.aspectRatio);
        }
        if (sessionToLoad.settings.numImages) {
          setNumImages(sessionToLoad.settings.numImages);
        }
      }
      
      setIsHistoryOpen(false);
      setInputValue('');

      // Wait for image preloading to complete in the background
      await preloadPromise;
      
      console.log(`🎉 Successfully loaded session ${sessionId} with ${resolvedMessages.length} messages and ${imageUrls.length} images`);
    } else {
      console.error("Could not find session to load:", sessionId);
    }
  }, [generationHistory, preloadImages, setMessages, setSelectedModel, setSeed, setAspectRatio, setNumImages, setInputValue, setGenerationHistory]);

  const handleDeleteSession = async (sessionId: string) => {
    // Find the session to delete and clean up its cached images
    const sessionToDelete = generationHistory.find(session => session.id === sessionId);
    
    if (sessionToDelete) {
      // 1. Delete from database if applicable
      if (sessionToDelete.isFromDatabase) {
        try {
          const result = await imageStudioService.deleteProject(sessionId);
          if (result.success) {
            console.log(`🗑️ Deleted project from database: ${sessionId}`);
          } else {
            console.error(`❌ Failed to delete project from database: ${result.error}`);
          }
        } catch (error) {
          console.error(`❌ Error deleting project from database: ${sessionId}`, error);
        }
      }

      // 2. Clean up cached images for this session
      sessionToDelete.messages.forEach(message => {
        if (message.imageData && message.imageData.startsWith('cache:')) {
          const cacheKey = message.imageData.replace('cache:', '');
          localStorage.removeItem(`imageCache_${cacheKey}`);
        }
      });
      console.log(`🧹 Cleaned up cached images for deleted session: ${sessionId}`);
    }

    const updatedHistory = generationHistory.filter(session => session.id !== sessionId);
    setGenerationHistory(updatedHistory);

    if (activeSessionId === sessionId) {
      // If deleting active session, start new session
      handleNewSession();
    }
  };

  const handleDeleteMultipleSessions = async (sessionIds: string[]) => {
    // Find sessions to delete and clean up their cached images
    const sessionsToDelete = generationHistory.filter(session => sessionIds.includes(session.id));
    
    for (const session of sessionsToDelete) {
      // 1. Delete from database if applicable
      if (session.isFromDatabase) {
        try {
          await imageStudioService.deleteProject(session.id);
          console.log(`🗑️ Deleted project from database: ${session.id}`);
        } catch (error) {
          console.error(`❌ Error deleting project from database: ${session.id}`, error);
        }
      }

      // 2. Clean up cached images for each session
      session.messages.forEach(message => {
        if (message.imageData && message.imageData.startsWith('cache:')) {
          const cacheKey = message.imageData.replace('cache:', '');
          localStorage.removeItem(`imageCache_${cacheKey}`);
        }
      });
    }
    
    console.log(`🧹 Cleaned up cached images for ${sessionsToDelete.length} deleted sessions`);

    const updatedHistory = generationHistory.filter(session => !sessionIds.includes(session.id));
    setGenerationHistory(updatedHistory);

    // If deleting active session, start new session
    if (activeSessionId && sessionIds.includes(activeSessionId)) {
      handleNewSession();
    }
  };

  const handleSaveSessionTitle = () => {
    if (editingSessionId && editTitleText.trim()) {
      setGenerationHistory(prev => prev.map(session => 
        session.id === editingSessionId 
          ? { ...session, title: editTitleText.trim(), timestamp: Date.now() }
          : session
      ));
      setEditingSessionId(null);
      setEditTitleText('');
    }
  };

  const handleNewSession = () => {
    setMessages([]);
    setActiveSessionId(null);
    setInputValue('');
    setAttachedFiles([]);
    // Reset guard flags
    isCreatingSessionRef.current = false;
    isUpdatingSessionRef.current = false;
  };

  const handleCancelDelete = () => {
    setDeleteConfirmationModal({ isOpen: false, sessionId: null, sessionTitle: null });
  };

  const createOrUpdateSession = useCallback((messages: ChatMessage[], settings?: any) => {
    if (messages.length === 0) return;

    const now = Date.now();
    
    if (activeSessionId) {
      // Update existing session
      if (isUpdatingSessionRef.current) return;
      isUpdatingSessionRef.current = true;

      setGenerationHistory(prev => {
        const updated = prev.map(session => {
          if (session.id === activeSessionId) {
            return {
              ...session,
              messages: [...messages],
              timestamp: now,
              settings: settings || session.settings
            };
          }
          return session;
        });
        
        setTimeout(() => {
          isUpdatingSessionRef.current = false;
        }, 100);
        
        return updated;
      });
    } else {
      // Create new session
      if (isCreatingSessionRef.current) return;
      isCreatingSessionRef.current = true;

      const firstUserMessage = messages.find(msg => msg.sender === 'user');
      const sessionTitle = firstUserMessage?.text?.slice(0, 50) || 'New Conversation';
      
      const newSession: ImageGenerationSession = {
        id: `session-${now}-${Math.random().toString(36).substr(2, 9)}`,
        title: sessionTitle,
        timestamp: now,
        messages: [...messages],
        settings
      };

      setGenerationHistory(prev => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      
      setTimeout(() => {
        isCreatingSessionRef.current = false;
      }, 100);
    }
  }, [activeSessionId]);

  return {
    // State
    generationHistory,
    activeSessionId,
    isHistoryOpen,
    historySearchTerm,
    editingSessionId,
    editTitleText,
    deleteConfirmationModal,
    
    // Setters
    setGenerationHistory,
    setActiveSessionId,
    setIsHistoryOpen,
    setHistorySearchTerm,
    setEditingSessionId,
    setEditTitleText,
    setDeleteConfirmationModal,
    
    // Actions
    toggleHistory,
    handleLoadSession,
    handleDeleteSession,
    handleDeleteMultipleSessions,
    handleSaveSessionTitle,
    handleNewSession,
    handleCancelDelete,
    createOrUpdateSession,
    
    // Refs
    isCreatingSessionRef,
    isUpdatingSessionRef
  };
}; 