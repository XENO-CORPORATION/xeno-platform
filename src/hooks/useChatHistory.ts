// useChatHistory - Hook for managing chat history with database persistence
// Falls back to localStorage when user is not authenticated

import { useState, useEffect, useCallback, useRef } from 'react';
import { chatService, Conversation, ChatMessage } from '@/services/chatService';

interface UseChatHistoryOptions {
  interfaceId: string;
  onError?: (error: Error) => void;
}

interface UseChatHistoryReturn {
  // State
  conversations: Conversation[];
  isLoading: boolean;
  isSyncing: boolean;
  isAuthenticated: boolean;

  // Actions
  loadConversations: () => Promise<void>;
  createConversation: (data: {
    title?: string;
    model_id?: string;
    system_prompt?: string;
    persona_id?: string;
  }) => Promise<Conversation | null>;
  updateConversation: (id: string, data: Partial<Conversation>) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  addMessage: (conversationId: string, message: Partial<ChatMessage>) => Promise<ChatMessage | null>;
  getConversation: (id: string) => Promise<Conversation | null>;
  syncLocalToServer: () => Promise<number>;

  // For compatibility with existing code
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
}

// Storage key prefix
const STORAGE_KEY_PREFIX = 'chatHistory_';

export function useChatHistory({ interfaceId, onError }: UseChatHistoryOptions): UseChatHistoryReturn {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Track if we've already initialized tables
  const tablesInitialized = useRef(false);
  // Track pending saves to batch them
  const pendingSave = useRef<NodeJS.Timeout | null>(null);

  // Check authentication status
  useEffect(() => {
    const checkAuth = () => {
      const hasToken = !!localStorage.getItem('xenoos_auth_token');
      setIsAuthenticated(hasToken);
    };

    checkAuth();

    // Listen for auth changes
    window.addEventListener('storage', checkAuth);
    return () => window.removeEventListener('storage', checkAuth);
  }, []);

  // Initialize tables once
  useEffect(() => {
    if (!tablesInitialized.current) {
      tablesInitialized.current = true;
      chatService.initTables().catch(console.error);
    }
  }, []);

  // Load conversations from localStorage
  const loadFromLocalStorage = useCallback((): Conversation[] => {
    const storageKey = `${STORAGE_KEY_PREFIX}${interfaceId}`;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (error) {
      console.error('Error loading from localStorage:', error);
    }
    return [];
  }, [interfaceId]);

  // Save to localStorage (fallback)
  const saveToLocalStorage = useCallback((convs: Conversation[]) => {
    const storageKey = `${STORAGE_KEY_PREFIX}${interfaceId}`;
    try {
      if (convs.length > 0) {
        localStorage.setItem(storageKey, JSON.stringify(convs));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  }, [interfaceId]);

  // Load conversations
  const loadConversations = useCallback(async () => {
    setIsLoading(true);
    try {
      if (isAuthenticated) {
        // Load from database
        const { conversations: dbConversations } = await chatService.getConversations({
          interface_id: interfaceId,
        });

        // Also check localStorage for any unsynced conversations
        const localConvs = loadFromLocalStorage();

        // If there are local conversations that aren't in the database, offer to sync
        if (localConvs.length > 0 && dbConversations.length === 0) {
          // Auto-sync local to database on first load
          setConversations(localConvs);
        } else {
          // Use database conversations
          setConversations(dbConversations);
        }
      } else {
        // Not authenticated, use localStorage
        const localConvs = loadFromLocalStorage();
        setConversations(localConvs);
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
      onError?.(error as Error);
      // Fall back to localStorage
      const localConvs = loadFromLocalStorage();
      setConversations(localConvs);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, interfaceId, loadFromLocalStorage, onError]);

  // Initial load
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Create conversation
  const createConversation = useCallback(async (data: {
    title?: string;
    model_id?: string;
    system_prompt?: string;
    persona_id?: string;
  }): Promise<Conversation | null> => {
    try {
      if (isAuthenticated) {
        const conv = await chatService.createConversation({
          ...data,
          interface_id: interfaceId,
        });
        if (conv) {
          setConversations(prev => [conv, ...prev]);
        }
        return conv;
      } else {
        // Create locally
        const newConv: Conversation = {
          id: `convo-${Date.now()}`,
          title: data.title || 'New Chat',
          timestamp: Date.now(),
          messages: [],
          systemPrompt: data.system_prompt,
          model_id: data.model_id,
          persona_id: data.persona_id,
        };
        setConversations(prev => {
          const updated = [newConv, ...prev];
          saveToLocalStorage(updated);
          return updated;
        });
        return newConv;
      }
    } catch (error) {
      console.error('Error creating conversation:', error);
      onError?.(error as Error);
      return null;
    }
  }, [isAuthenticated, interfaceId, saveToLocalStorage, onError]);

  // Update conversation
  const updateConversation = useCallback(async (id: string, data: Partial<Conversation>) => {
    try {
      if (isAuthenticated) {
        await chatService.updateConversation(id, data);
      }

      // Update local state
      setConversations(prev => {
        const updated = prev.map(c =>
          c.id === id ? { ...c, ...data, updated_at: new Date().toISOString() } : c
        );
        if (!isAuthenticated) {
          saveToLocalStorage(updated);
        }
        return updated;
      });
    } catch (error) {
      console.error('Error updating conversation:', error);
      onError?.(error as Error);
    }
  }, [isAuthenticated, saveToLocalStorage, onError]);

  // Delete conversation
  const deleteConversation = useCallback(async (id: string) => {
    try {
      if (isAuthenticated) {
        await chatService.deleteConversation(id);
      }

      setConversations(prev => {
        const updated = prev.filter(c => c.id !== id);
        if (!isAuthenticated) {
          saveToLocalStorage(updated);
        }
        return updated;
      });
    } catch (error) {
      console.error('Error deleting conversation:', error);
      onError?.(error as Error);
    }
  }, [isAuthenticated, saveToLocalStorage, onError]);

  // Add message to conversation
  const addMessage = useCallback(async (
    conversationId: string,
    message: Partial<ChatMessage>
  ): Promise<ChatMessage | null> => {
    try {
      if (isAuthenticated) {
        const savedMessage = await chatService.addMessage(conversationId, {
          role: message.role || 'user',
          content: message.content || message.text || '',
          model_id: message.model_id || message.modelId,
          thinking: message.thinking || message.thinkingContent,
          has_thinking: message.has_thinking || message.hasThinking,
          attachments: message.attachments || message.files,
        });
        return savedMessage;
      } else {
        // Add to local conversation
        const newMessage: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: message.role || 'user',
          content: message.content || message.text || '',
          created_at: new Date().toISOString(),
          ...message,
        };

        setConversations(prev => {
          const updated = prev.map(c => {
            if (c.id === conversationId) {
              return {
                ...c,
                messages: [...(c.messages || []), newMessage],
                updated_at: new Date().toISOString(),
              };
            }
            return c;
          });
          saveToLocalStorage(updated);
          return updated;
        });

        return newMessage;
      }
    } catch (error) {
      console.error('Error adding message:', error);
      onError?.(error as Error);
      return null;
    }
  }, [isAuthenticated, saveToLocalStorage, onError]);

  // Get single conversation with messages
  const getConversation = useCallback(async (id: string): Promise<Conversation | null> => {
    try {
      if (isAuthenticated) {
        return await chatService.getConversation(id);
      } else {
        return conversations.find(c => c.id === id) || null;
      }
    } catch (error) {
      console.error('Error getting conversation:', error);
      return conversations.find(c => c.id === id) || null;
    }
  }, [isAuthenticated, conversations]);

  // Sync local conversations to server
  const syncLocalToServer = useCallback(async (): Promise<number> => {
    if (!isAuthenticated) return 0;

    setIsSyncing(true);
    try {
      const localConvs = loadFromLocalStorage();
      if (localConvs.length === 0) return 0;

      const { synced, conversations: syncedConvs } = await chatService.syncFromLocalStorage(localConvs);

      if (synced > 0) {
        // Clear localStorage after successful sync
        const storageKey = `${STORAGE_KEY_PREFIX}${interfaceId}`;
        localStorage.removeItem(storageKey);

        // Update state with synced conversations
        setConversations(syncedConvs);
      }

      return synced;
    } catch (error) {
      console.error('Error syncing to server:', error);
      onError?.(error as Error);
      return 0;
    } finally {
      setIsSyncing(false);
    }
  }, [isAuthenticated, interfaceId, loadFromLocalStorage, onError]);

  // Auto-save to localStorage when not authenticated
  useEffect(() => {
    if (!isAuthenticated && conversations.length > 0) {
      // Debounce saves
      if (pendingSave.current) {
        clearTimeout(pendingSave.current);
      }
      pendingSave.current = setTimeout(() => {
        saveToLocalStorage(conversations);
      }, 500);
    }

    return () => {
      if (pendingSave.current) {
        clearTimeout(pendingSave.current);
      }
    };
  }, [conversations, isAuthenticated, saveToLocalStorage]);

  return {
    conversations,
    isLoading,
    isSyncing,
    isAuthenticated,
    loadConversations,
    createConversation,
    updateConversation,
    deleteConversation,
    addMessage,
    getConversation,
    syncLocalToServer,
    setConversations,
  };
}

export default useChatHistory;
