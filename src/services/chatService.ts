// Chat Service - API integration for conversations and personas
// Replaces localStorage-based chat history with database persistence

const API_BASE = '/api/chat';

// ============================================
// TYPES
// ============================================

export interface ChatMessage {
  id?: string;
  conversation_id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model_id?: string;
  thinking?: string;
  has_thinking?: boolean;
  attachments?: ChatAttachment[];
  search_context?: unknown;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  created_at?: string;
  message_index?: number;
  // Legacy fields for compatibility
  sender?: 'user' | 'ai';
  text?: string;
  timestamp?: number;
  modelId?: string;
  hasThinking?: boolean;
  files?: ChatAttachment[];
}

export interface ChatAttachment {
  type: 'image' | 'document' | 'code';
  name: string;
  content: string;
  mimeType?: string;
}

export interface Conversation {
  id: string;
  user_id?: string;
  title: string;
  model_id?: string;
  system_prompt?: string;
  persona_id?: string;
  interface_id?: string;
  created_at?: string;
  updated_at?: string;
  last_message_at?: string;
  is_archived?: boolean;
  message_count?: number;
  messages?: ChatMessage[];
  // Legacy fields for compatibility
  timestamp?: number;
  systemPrompt?: string;
}

export interface Persona {
  id: string;
  user_id?: string;
  name: string;
  description?: string;
  prompt: string;
  icon?: string;
  color?: string;
  use_count?: number;
  last_used_at?: string;
  created_at?: string;
  updated_at?: string;
  sort_order?: number;
  is_favorite?: boolean;
  // For UI display - predefined personas
  label?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  error?: string;
  data?: T;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('xenoos_auth_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const handleResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
};

// ============================================
// CONVERSATION API
// ============================================

export const chatService = {
  // Initialize chat tables (call once on app startup)
  async initTables(): Promise<{ success: boolean; message?: string }> {
    try {
      const response = await fetch(`${API_BASE}/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      return await response.json();
    } catch (error) {
      console.error('Failed to initialize chat tables:', error);
      return { success: false, message: (error as Error).message };
    }
  },

  // List conversations
  async getConversations(options: {
    interface_id?: string;
    include_archived?: boolean;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ conversations: Conversation[]; total: number }> {
    const params = new URLSearchParams();
    if (options.interface_id) params.set('interface_id', options.interface_id);
    if (options.include_archived) params.set('include_archived', 'true');
    if (options.limit) params.set('limit', options.limit.toString());
    if (options.offset) params.set('offset', options.offset.toString());

    const response = await fetch(`${API_BASE}/conversations?${params}`, {
      headers: getAuthHeaders(),
    });

    const data = await handleResponse<{ conversations: Conversation[]; total: number }>(response);
    return { conversations: data.conversations || [], total: data.total || 0 };
  },

  // Get single conversation with messages
  async getConversation(id: string): Promise<Conversation | null> {
    try {
      const response = await fetch(`${API_BASE}/conversations/${id}`, {
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{ conversation: Conversation }>(response);
      return data.conversation || null;
    } catch (error) {
      console.error('Failed to get conversation:', error);
      return null;
    }
  },

  // Create new conversation
  async createConversation(data: {
    title?: string;
    model_id?: string;
    system_prompt?: string;
    persona_id?: string;
    interface_id?: string;
  }): Promise<Conversation | null> {
    try {
      const response = await fetch(`${API_BASE}/conversations`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });

      const result = await handleResponse<{ conversation: Conversation }>(response);
      return result.conversation || null;
    } catch (error) {
      console.error('Failed to create conversation:', error);
      return null;
    }
  },

  // Update conversation
  async updateConversation(
    id: string,
    data: {
      title?: string;
      model_id?: string;
      system_prompt?: string;
      persona_id?: string;
      is_archived?: boolean;
    }
  ): Promise<Conversation | null> {
    try {
      const response = await fetch(`${API_BASE}/conversations/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });

      const result = await handleResponse<{ conversation: Conversation }>(response);
      return result.conversation || null;
    } catch (error) {
      console.error('Failed to update conversation:', error);
      return null;
    }
  },

  // Delete conversation
  async deleteConversation(id: string, permanent = false): Promise<boolean> {
    try {
      const response = await fetch(
        `${API_BASE}/conversations/${id}?permanent=${permanent}`,
        {
          method: 'DELETE',
          headers: getAuthHeaders(),
        }
      );

      await handleResponse<{ success: boolean }>(response);
      return true;
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      return false;
    }
  },

  // Add message to conversation
  async addMessage(
    conversationId: string,
    message: {
      role: 'user' | 'assistant' | 'system';
      content: string;
      model_id?: string;
      thinking?: string;
      has_thinking?: boolean;
      attachments?: ChatAttachment[];
      search_context?: unknown;
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    }
  ): Promise<ChatMessage | null> {
    try {
      const response = await fetch(
        `${API_BASE}/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(message),
        }
      );

      const result = await handleResponse<{ message: ChatMessage }>(response);
      return result.message || null;
    } catch (error) {
      console.error('Failed to add message:', error);
      return null;
    }
  },

  // Add multiple messages at once
  async addMessagesBatch(
    conversationId: string,
    messages: ChatMessage[]
  ): Promise<ChatMessage[]> {
    try {
      const response = await fetch(
        `${API_BASE}/conversations/${conversationId}/messages/batch`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ messages }),
        }
      );

      const result = await handleResponse<{ messages: ChatMessage[] }>(response);
      return result.messages || [];
    } catch (error) {
      console.error('Failed to add messages batch:', error);
      return [];
    }
  },

  // Update a message
  async updateMessage(
    messageId: string,
    updates: {
      content?: string;
      thinking?: string;
      has_thinking?: boolean;
    }
  ): Promise<ChatMessage | null> {
    try {
      const response = await fetch(
        `${API_BASE}/messages/${messageId}`,
        {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(updates),
        }
      );

      const result = await handleResponse<{ message: ChatMessage }>(response);
      return result.message || null;
    } catch (error) {
      console.error('Failed to update message:', error);
      return null;
    }
  },

  // Delete a single message (used by the chat module's edit/regenerate truncation so
  // pre-edit/regenerate assistant turns don't resurrect on reload). Returns true on success.
  async deleteMessage(messageId: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/messages/${messageId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      await handleResponse<{ success: boolean }>(response);
      return true;
    } catch (error) {
      console.error('Failed to delete message:', error);
      return false;
    }
  },

  // ============================================
  // PERSONA API
  // ============================================

  // Get user's custom personas
  async getPersonas(): Promise<Persona[]> {
    try {
      const response = await fetch(`${API_BASE}/personas`, {
        headers: getAuthHeaders(),
      });

      const data = await handleResponse<{ personas: Persona[] }>(response);
      return data.personas || [];
    } catch (error) {
      console.error('Failed to get personas:', error);
      return [];
    }
  },

  // Create custom persona
  async createPersona(data: {
    name: string;
    description?: string;
    prompt: string;
    icon?: string;
    color?: string;
  }): Promise<Persona | null> {
    try {
      const response = await fetch(`${API_BASE}/personas`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });

      const result = await handleResponse<{ persona: Persona }>(response);
      return result.persona || null;
    } catch (error) {
      console.error('Failed to create persona:', error);
      return null;
    }
  },

  // Update persona
  async updatePersona(
    id: string,
    data: {
      name?: string;
      description?: string;
      prompt?: string;
      icon?: string;
      color?: string;
      is_favorite?: boolean;
      sort_order?: number;
    }
  ): Promise<Persona | null> {
    try {
      const response = await fetch(`${API_BASE}/personas/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });

      const result = await handleResponse<{ persona: Persona }>(response);
      return result.persona || null;
    } catch (error) {
      console.error('Failed to update persona:', error);
      return null;
    }
  },

  // Delete persona
  async deletePersona(id: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/personas/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      await handleResponse<{ success: boolean }>(response);
      return true;
    } catch (error) {
      console.error('Failed to delete persona:', error);
      return false;
    }
  },

  // Track persona usage
  async trackPersonaUsage(id: string): Promise<void> {
    try {
      await fetch(`${API_BASE}/personas/${id}/use`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
    } catch (error) {
      console.error('Failed to track persona usage:', error);
    }
  },

  // ============================================
  // SYNC API
  // ============================================

  // Sync local conversations to server (migration from localStorage)
  async syncFromLocalStorage(
    conversations: Conversation[]
  ): Promise<{ synced: number; conversations: Conversation[] }> {
    try {
      const response = await fetch(`${API_BASE}/sync`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ conversations }),
      });

      const result = await handleResponse<{
        synced: number;
        conversations: Conversation[];
      }>(response);
      return {
        synced: result.synced || 0,
        conversations: result.conversations || [],
      };
    } catch (error) {
      console.error('Failed to sync conversations:', error);
      return { synced: 0, conversations: [] };
    }
  },

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return !!localStorage.getItem('xenoos_auth_token');
  },

  // Convert legacy message format to new format
  normalizeMessage(msg: ChatMessage): ChatMessage {
    return {
      ...msg,
      role: msg.role || (msg.sender === 'ai' ? 'assistant' : 'user'),
      content: msg.content || msg.text || '',
      model_id: msg.model_id || msg.modelId,
      has_thinking: msg.has_thinking || msg.hasThinking,
      attachments: msg.attachments || msg.files,
    };
  },

  // Convert legacy conversation format to new format
  normalizeConversation(conv: Conversation): Conversation {
    return {
      ...conv,
      system_prompt: conv.system_prompt || conv.systemPrompt,
      created_at: conv.created_at || (conv.timestamp ? new Date(conv.timestamp).toISOString() : undefined),
      messages: conv.messages?.map(this.normalizeMessage),
    };
  },

  // ============================================
  // SHARE API
  // ============================================

  // Create a share link for a conversation
  async createShareLink(conversationId: string, expiresInDays = 7): Promise<{
    share_token: string;
    share_url: string;
    expires_at: string;
    conversation_title: string;
  } | null> {
    try {
      const response = await fetch(`${API_BASE}/conversations/${conversationId}/share`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ expires_in_days: expiresInDays }),
      });

      const result = await handleResponse<{ share: {
        share_token: string;
        share_url: string;
        expires_at: string;
        conversation_title: string;
      } }>(response);
      return result.share || null;
    } catch (error) {
      console.error('Failed to create share link:', error);
      return null;
    }
  },

  // Get shared conversation details (no auth required)
  async getSharedConversation(token: string): Promise<{
    id: string;
    conversation_id: string;
    title: string;
    model_id: string;
    system_prompt: string;
    owner_name: string;
    expires_at: string;
    messages: ChatMessage[];
  } | null> {
    try {
      const response = await fetch(`${API_BASE}/share/${token}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to get shared conversation');
      }

      return result.share || null;
    } catch (error) {
      console.error('Failed to get shared conversation:', error);
      return null;
    }
  },

  // Accept a shared conversation and copy to user's account
  async acceptSharedConversation(token: string): Promise<Conversation | null> {
    try {
      const response = await fetch(`${API_BASE}/share/${token}/accept`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });

      const result = await handleResponse<{ conversation: Conversation }>(response);
      return result.conversation || null;
    } catch (error) {
      console.error('Failed to accept shared conversation:', error);
      return null;
    }
  },

  // Revoke all share links for a conversation
  async revokeShareLinks(conversationId: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/conversations/${conversationId}/share`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      await handleResponse<{ success: boolean }>(response);
      return true;
    } catch (error) {
      console.error('Failed to revoke share links:', error);
      return false;
    }
  },

  // List all share links for a conversation
  async getShareLinks(conversationId: string): Promise<{
    id: string;
    share_token: string;
    expires_at: string;
    created_at: string;
    revoked_at: string | null;
    accept_count: number;
  }[]> {
    try {
      const response = await fetch(`${API_BASE}/conversations/${conversationId}/shares`, {
        headers: getAuthHeaders(),
      });

      const result = await handleResponse<{ shares: any[] }>(response);
      return result.shares || [];
    } catch (error) {
      console.error('Failed to list share links:', error);
      return [];
    }
  },
};

export default chatService;
