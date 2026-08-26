// Chat Service - API integration for conversations and personas
// Replaces localStorage-based chat history with database persistence

const API_BASE = '/api/chat';

/** Same shape as server `UUID_RE`. Local `convo-<ts>` ids must never hit the API. */
export const PERSISTED_CONVERSATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPersistedConversationId(id: string | null | undefined): id is string {
  return typeof id === 'string' && PERSISTED_CONVERSATION_ID_RE.test(id);
}

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

export type LibraryTab = 'all' | 'images' | 'files';
export type LibrarySort = 'updated' | 'created' | 'name' | 'size';
export type LibrarySource = 'artifact' | 'file' | 'generation' | 'image_asset';

export interface LibraryItemRecord {
  id: string;
  source: LibrarySource;
  source_id: string;
  name: string;
  category: 'images' | 'files';
  item_type: 'image' | 'video' | 'audio' | 'file' | 'document' | 'code' | 'html';
  mime_type?: string;
  size_bytes?: number | string | null;
  description?: string;
  preview_url?: string | null;
  conversation_id?: string | null;
  conversation_title?: string | null;
  created_at: string;
  updated_at: string;
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
  project_id?: string | null;
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
  const workspace = localStorage.getItem('xeno_active_workspace_id');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    // Phase 5: active workspace → conversations get tagged with workspace_id + a parent tuple.
    ...(isPersistedConversationId(workspace) ? { 'x-xeno-workspace': workspace } : {}),
  };
};

const handleResponse = async <T>(response: Response): Promise<T> => {
  const raw = await response.text();
  let data: { success?: boolean; error?: string };
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      `API request failed with status ${response.status}. Non-JSON response.`,
    );
  }
  if (!response.ok || !data.success) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
  return data as T;
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
    if (!isPersistedConversationId(id)) {
      return null;
    }
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
    project_id?: string;
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
    if (!isPersistedConversationId(id)) {
      return null;
    }
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
    if (!isPersistedConversationId(id)) {
      return false;
    }
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
    if (!isPersistedConversationId(conversationId)) {
      return null;
    }
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
    if (!isPersistedConversationId(conversationId)) {
      return [];
    }
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
    created_at: string;
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

  // ============================================
  // ACCOUNT LIBRARY API
  // ============================================

  async getLibraryItems(params?: {
    tab?: LibraryTab;
    sort?: LibrarySort;
    query?: string;
    limit?: number;
  }): Promise<LibraryItemRecord[]> {
    try {
      const qs = new URLSearchParams();
      if (params?.tab) qs.set('tab', params.tab);
      if (params?.sort) qs.set('sort', params.sort);
      if (params?.query) qs.set('query', params.query);
      if (params?.limit) qs.set('limit', String(params.limit));
      const response = await fetch(`${API_BASE}/library?${qs.toString()}`, {
        headers: getAuthHeaders(),
      });
      const result = await handleResponse<{ items: LibraryItemRecord[] }>(response);
      return result.items || [];
    } catch (error) {
      console.error('Failed to get account library:', error);
      throw error;
    }
  },

  async deleteLibraryItem(source: LibrarySource, id: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/library/${source}/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      await handleResponse<{ success: boolean }>(response);
      return true;
    } catch (error) {
      console.error('Failed to delete library item:', error);
      return false;
    }
  },

  async uploadLibraryFile(file: File, source = 'library'): Promise<{
    id: string;
    name: string;
    size: number;
    type: string;
    content_url: string;
  }> {
    const token = localStorage.getItem('xenoos_auth_token');
    const form = new FormData();
    form.append('image', file);
    form.append('source', source);
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const result = await handleResponse<{ file: {
      id: string;
      name: string;
      size: number;
      type: string;
      content_url: string;
    } }>(response);
    return result.file;
  },

  // ============================================
  // ARTIFACTS API
  // ============================================

  async getArtifacts(params?: { kind?: string; sort?: string; query?: string }): Promise<any[]> {
    try {
      const qs = new URLSearchParams();
      if (params?.kind) qs.set('kind', params.kind);
      if (params?.sort) qs.set('sort', params.sort);
      if (params?.query) qs.set('query', params.query);

      const response = await fetch(`${API_BASE}/artifacts?${qs.toString()}`, {
        headers: getAuthHeaders(),
      });
      const result = await handleResponse<{ artifacts: any[] }>(response);
      return result.artifacts || [];
    } catch (error) {
      console.error('Failed to get artifacts:', error);
      return [];
    }
  },

  async getArtifact(id: string): Promise<any | null> {
    try {
      const response = await fetch(`${API_BASE}/artifacts/${id}`, {
        headers: getAuthHeaders(),
      });
      const result = await handleResponse<{ artifact: any }>(response);
      return result.artifact || null;
    } catch (error) {
      console.error('Failed to get artifact:', error);
      return null;
    }
  },

  async createArtifact(data: {
    title: string;
    kind: string;
    content: string;
    language?: string;
    preview_text?: string;
    conversation_id?: string;
    message_id?: string;
  }): Promise<any | null> {
    try {
      const response = await fetch(`${API_BASE}/artifacts`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      const result = await handleResponse<{ artifact: any }>(response);
      return result.artifact || null;
    } catch (error) {
      console.error('Failed to create artifact:', error);
      return null;
    }
  },

  async deleteArtifact(id: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/artifacts/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      await handleResponse<{ success: boolean }>(response);
      return true;
    } catch (error) {
      console.error('Failed to delete artifact:', error);
      return false;
    }
  },

  // ============================================
  // SCHEDULED AUTOMATION TASKS API
  // ============================================

  async getScheduledTasks(params?: { status?: string; sort?: string; query?: string }): Promise<any[]> {
    try {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      if (params?.sort) qs.set('sort', params.sort);
      if (params?.query) qs.set('query', params.query);

      const response = await fetch(`${API_BASE}/scheduled?${qs.toString()}`, {
        headers: getAuthHeaders(),
      });
      const result = await handleResponse<{ tasks: any[] }>(response);
      return result.tasks || [];
    } catch (error) {
      console.error('Failed to get scheduled tasks:', error);
      return [];
    }
  },

  async createScheduledTask(data: {
    title: string;
    prompt: string;
    cadence?: string;
    cadence_label?: string;
    model_id?: string;
    conversation_id?: string;
    project_id?: string;
  }): Promise<any | null> {
    try {
      const response = await fetch(`${API_BASE}/scheduled`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      const result = await handleResponse<{ task: any }>(response);
      return result.task || null;
    } catch (error) {
      console.error('Failed to create scheduled task:', error);
      return null;
    }
  },

  async updateScheduledTask(id: string, data: Partial<{
    title: string;
    prompt: string;
    cadence: string;
    cadence_label: string;
    status: string;
    model_id: string;
  }>): Promise<any | null> {
    try {
      const response = await fetch(`${API_BASE}/scheduled/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      const result = await handleResponse<{ task: any }>(response);
      return result.task || null;
    } catch (error) {
      console.error('Failed to update scheduled task:', error);
      return null;
    }
  },

  async deleteScheduledTask(id: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/scheduled/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      await handleResponse<{ success: boolean }>(response);
      return true;
    } catch (error) {
      console.error('Failed to delete scheduled task:', error);
      return false;
    }
  },

  async runScheduledTask(id: string): Promise<any | null> {
    try {
      const response = await fetch(`${API_BASE}/scheduled/${id}/run`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const result = await handleResponse<{ success: boolean; result: any }>(response);
      return result.result || null;
    } catch (error) {
      console.error('Failed to run scheduled task:', error);
      return null;
    }
  },

  // ============================================
  // SKILLS LIBRARY API
  // ============================================

  async getSkills(params?: { visibility?: string; conversation_id?: string }): Promise<any[]> {
    try {
      const qs = new URLSearchParams();
      if (params?.visibility) qs.set('visibility', params.visibility);
      if (params?.conversation_id) qs.set('conversation_id', params.conversation_id);

      const response = await fetch(`${API_BASE}/skills?${qs.toString()}`, {
        headers: getAuthHeaders(),
      });
      const result = await handleResponse<{ skills: any[] }>(response);
      return result.skills || [];
    } catch (error) {
      console.error('Failed to get skills:', error);
      return [];
    }
  },

  async createSkill(data: {
    name: string;
    summary?: string;
    body: string;
    author?: string;
    source?: string;
    visibility?: string;
    conversation_id?: string;
    category?: string;
  }): Promise<any | null> {
    try {
      const response = await fetch(`${API_BASE}/skills`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      const result = await handleResponse<{ skill: any }>(response);
      return result.skill || null;
    } catch (error) {
      console.error('Failed to create skill:', error);
      return null;
    }
  },

  async updateSkill(id: string, data: Partial<{
    name: string;
    summary: string;
    body: string;
    is_enabled: boolean;
  }>): Promise<any | null> {
    try {
      const response = await fetch(`${API_BASE}/skills/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      const result = await handleResponse<{ skill: any }>(response);
      return result.skill || null;
    } catch (error) {
      console.error('Failed to update skill:', error);
      return null;
    }
  },

  async deleteSkill(id: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/skills/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      await handleResponse<{ success: boolean }>(response);
      return true;
    } catch (error) {
      console.error('Failed to delete skill:', error);
      return false;
    }
  },

  // ============================================
  // PROJECTS & FILES API
  // ============================================

  async getProjects(): Promise<any[]> {
    try {
      const response = await fetch(`${API_BASE}/projects`, {
        headers: getAuthHeaders(),
      });
      const result = await handleResponse<{ projects: any[] }>(response);
      return result.projects || [];
    } catch (error) {
      console.error('Failed to get projects:', error);
      return [];
    }
  },

  async createProject(data: {
    name: string;
    description?: string;
    custom_instructions?: string;
    settings?: any;
  }): Promise<any | null> {
    try {
      const response = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      const result = await handleResponse<{ project: any }>(response);
      return result.project || null;
    } catch (error) {
      console.error('Failed to create project:', error);
      return null;
    }
  },

  async updateProject(id: string, data: Partial<{
    name: string;
    description: string;
    custom_instructions: string;
    settings: any;
    is_archived: boolean;
  }>): Promise<any | null> {
    try {
      const response = await fetch(`${API_BASE}/projects/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(data),
      });
      const result = await handleResponse<{ project: any }>(response);
      return result.project || null;
    } catch (error) {
      console.error('Failed to update project:', error);
      return null;
    }
  },

  async deleteProject(id: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/projects/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      await handleResponse<{ success: boolean }>(response);
      return true;
    } catch (error) {
      console.error('Failed to delete project:', error);
      return false;
    }
  },

  async getProjectFiles(projectId: string): Promise<any[]> {
    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}/files`, {
        headers: getAuthHeaders(),
      });
      const result = await handleResponse<{ files: any[] }>(response);
      return result.files || [];
    } catch (error) {
      console.error('Failed to get project files:', error);
      return [];
    }
  },

  async addProjectFile(projectId: string, file: {
    name: string;
    file_type?: string;
    file_size?: number;
    content_text: string;
  }): Promise<any | null> {
    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}/files`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(file),
      });
      const result = await handleResponse<{ file: any }>(response);
      return result.file || null;
    } catch (error) {
      console.error('Failed to add project file:', error);
      return null;
    }
  },

  async deleteProjectFile(projectId: string, fileId: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}/files/${fileId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      await handleResponse<{ success: boolean }>(response);
      return true;
    } catch (error) {
      console.error('Failed to delete project file:', error);
      return false;
    }
  },

  // ============================================
  // MEMORIES API
  // ============================================

  async getMemories(): Promise<any[]> {
    try {
      const response = await fetch(`${API_BASE}/memories`, {
        headers: getAuthHeaders(),
      });
      const result = await handleResponse<{ memories: any[] }>(response);
      return result.memories || [];
    } catch (error) {
      console.error('Failed to get memories:', error);
      return [];
    }
  },

  async addMemory(content: string, sourceConversationId?: string): Promise<any | null> {
    try {
      const response = await fetch(`${API_BASE}/memories`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ content, source_conversation_id: sourceConversationId }),
      });
      const result = await handleResponse<{ memory: any }>(response);
      return result.memory || null;
    } catch (error) {
      console.error('Failed to add memory:', error);
      return null;
    }
  },

  async deleteMemory(id: string): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE}/memories/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      await handleResponse<{ success: boolean }>(response);
      return true;
    } catch (error) {
      console.error('Failed to delete memory:', error);
      return false;
    }
  },
};

export default chatService;
