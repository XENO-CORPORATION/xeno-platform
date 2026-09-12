/**
 * Chat Customize contract.
 *
 * Authenticated state is server-authoritative. The small stores below exist only
 * for unauthenticated development drafts and as read-through display caches.
 */

import {
  listChatSkills,
  setChatSkillEnabled,
} from './chatSkillsLibrary';
import { chatService } from '@/services/chatService';
import { userDataService } from '@/services/userDataService';

export type ChatPersona = {
  id: string;
  label: string;
  /** Short line for table / list. */
  summary: string;
  prompt: string;
  updatedAt: number;
};

export type CustomizeProfile = {
  /** Global “how to respond” instructions (all new chats). */
  instructions: string;
  activePersonaId: string | null;
  updatedAt: number;
};

export type ChatSkill = {
  id: string;
  name: string;
  summary: string;
  author: string;
  enabled: boolean;
  updatedAt: number;
};

export type ConnectorStatus = 'connected' | 'not_connected';

export type ChatConnector = {
  id: string;
  name: string;
  type: string;
  status: ConnectorStatus;
  updatedAt: number;
};

export type ChatPlugin = {
  id: string;
  name: string;
  summary: string;
  author: string;
  installed: boolean;
  updatedAt: number;
};

export type MemoryEntry = {
  id: string;
  text: string;
  updatedAt: number;
};

export type MemorySettings = {
  generateFromChats: boolean;
  entries: MemoryEntry[];
  updatedAt: number;
};

const day = 24 * 60 * 60 * 1000;
const now = Date.now();

/** Built-in personas — shared catalog until backend owns them. */
let personasStore: ChatPersona[] = [];

let profileStore: CustomizeProfile = {
  instructions: '',
  activePersonaId: null,
  updatedAt: now - 1 * day,
};

let connectorsStore: ChatConnector[] = [];

let pluginsStore: ChatPlugin[] = [];

let memoryStore: MemorySettings = {
  generateFromChats: false,
  entries: [],
  updatedAt: now - 2 * day,
};

const matches = (haystack: string, query: string): boolean =>
  haystack.toLowerCase().includes(query.trim().toLowerCase());

const randomId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  }
  return `${prefix}-${Date.now().toString(36)}`;
};

export type ListQueryInput = {
  query?: string;
  /** Skills only: null = New chat draft; string = that conversation. */
  conversationId?: string | null;
};

export type ListConnectorsInput = ListQueryInput & {
  status?: ConnectorStatus | 'all';
};

/**
 * Lists personas for the Customize table.
 * Fetches from backend /api/chat/personas when authenticated, with local cache fallback.
 */
export const listPersonas = async (
  input: ListQueryInput = {},
): Promise<ChatPersona[]> => {
  try {
    if (chatService.isAuthenticated()) {
      const serverPersonas = await chatService.getPersonas();
      if (serverPersonas && Array.isArray(serverPersonas)) {
        const mapped: ChatPersona[] = serverPersonas.map((p) => ({
          id: p.id,
          label: p.name || p.label || 'Untitled Persona',
          summary: p.description || p.prompt.slice(0, 80),
          prompt: p.prompt,
          updatedAt: p.updated_at ? new Date(p.updated_at).getTime() : Date.now(),
        }));
        // An authenticated empty response is authoritative; never retain local rows.
        personasStore = mapped;
      }
    }
  } catch (err) {
    console.error('[chatCustomize] Failed to fetch personas from backend:', err);
    if (chatService.isAuthenticated()) throw err;
  }

  const q = (input.query ?? '').trim().toLowerCase();
  let rows = [...personasStore];
  if (q) {
    rows = rows.filter(
      (persona) =>
        matches(persona.label, q) ||
        matches(persona.summary, q) ||
        matches(persona.prompt, q),
    );
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
};

export const getPersona = async (id: string): Promise<ChatPersona | null> =>
  personasStore.find((persona) => persona.id === id) ?? null;

/** Account customization profile. */
export const getCustomizeProfile = async (): Promise<CustomizeProfile> => {
  if (!chatService.isAuthenticated()) return { ...profileStore };
  const settings = await userDataService.getSettings();
  const chat = settings.chat as any;
  profileStore = {
    instructions: typeof chat?.accountInstructions === 'string' ? chat.accountInstructions : '',
    activePersonaId: typeof chat?.activePersonaId === 'string' ? chat.activePersonaId : null,
    updatedAt: Date.now(),
  };
  return { ...profileStore };
};

/** Persist account instructions before updating the display cache. */
export const saveCustomizeInstructions = async (
  instructions: string,
): Promise<CustomizeProfile> => {
  if (chatService.isAuthenticated()) {
    await userDataService.updateSetting('chat.accountInstructions', instructions.trim());
  }
  profileStore = {
    ...profileStore,
    instructions: instructions.trim(),
    updatedAt: Date.now(),
  };
  return { ...profileStore };
};

/** Persist active persona before updating the display cache. */
export const setActivePersona = async (
  personaId: string | null,
): Promise<CustomizeProfile> => {
  if (chatService.isAuthenticated()) {
    await userDataService.updateSetting('chat.activePersonaId', personaId);
  }
  profileStore = {
    ...profileStore,
    activePersonaId: personaId,
    updatedAt: Date.now(),
  };
  return { ...profileStore };
};

/** New-chat draft scope — same idea as pending chat skills. */
export const PENDING_CHAT_PERSONA_SCOPE = 'pending-new-chat';

const resolvePersonaScope = (conversationId: string | null | undefined): string =>
  conversationId?.trim() ? conversationId : PENDING_CHAT_PERSONA_SCOPE;

/** Persona id chosen for a chat (or New chat draft). Missing key = unset. */
let chatPersonaByScope: Record<string, string | null> = {};

/** Backend: GET /api/chat/conversations/:id/persona */
export const getChatPersonaId = async (
  conversationId: string | null | undefined,
): Promise<string | null> => {
  if (chatService.isAuthenticated() && conversationId?.trim()) {
    const conversation = await chatService.getConversation(conversationId);
    return conversation?.persona_id ?? null;
  }
  const scope = resolvePersonaScope(conversationId);
  return scope in chatPersonaByScope ? chatPersonaByScope[scope] : null;
};

/** Backend: PUT /api/chat/conversations/:id/persona */
export const setChatPersonaId = async (
  conversationId: string | null | undefined,
  personaId: string | null,
): Promise<string | null> => {
  if (chatService.isAuthenticated() && conversationId?.trim()) {
    const updated = await chatService.updateConversation(conversationId, { persona_id: personaId });
    if (!updated) throw new Error('Persona selection was not saved.');
    return updated.persona_id ?? null;
  }
  const scope = resolvePersonaScope(conversationId);
  chatPersonaByScope = {
    ...chatPersonaByScope,
    [scope]: personaId,
  };
  return personaId;
};

/** Move New-chat draft persona onto the real conversation id. */
export const bindPendingChatPersona = async (
  conversationId: string,
): Promise<void> => {
  if (!(PENDING_CHAT_PERSONA_SCOPE in chatPersonaByScope)) return;
  const pending = chatPersonaByScope[PENDING_CHAT_PERSONA_SCOPE];
  const { [PENDING_CHAT_PERSONA_SCOPE]: _removed, ...rest } = chatPersonaByScope;
  chatPersonaByScope = {
    ...rest,
    [conversationId]:
      conversationId in rest ? rest[conversationId] : pending,
  };
};

/** Clear New-chat draft persona (e.g. user clicks New chat again). */
export const clearPendingChatPersona = async (): Promise<void> => {
  if (!(PENDING_CHAT_PERSONA_SCOPE in chatPersonaByScope)) return;
  const { [PENDING_CHAT_PERSONA_SCOPE]: _removed, ...rest } = chatPersonaByScope;
  chatPersonaByScope = rest;
};

/**
 * Backend: GET /api/chat/customize/skills?conversationId=
 * Lists library skills with On/Off resolved for this chat (or New chat draft).
 */
export const listSkills = async (
  input: ListQueryInput = {},
): Promise<ChatSkill[]> => {
  const rows = await listChatSkills({
    query: input.query,
    conversationId: input.conversationId,
  });
  return rows.map((skill) => ({
    id: skill.id,
    name: skill.name,
    summary: skill.summary,
    author: skill.author,
    enabled: skill.enabled,
    updatedAt: skill.updatedAt,
  }));
};

/** Backend: PATCH /api/chat/customize/skills/:id (per conversation / pending). */
export const setSkillEnabled = async (
  id: string,
  enabled: boolean,
  conversationId?: string | null,
): Promise<ChatSkill | null> => {
  const updated = await setChatSkillEnabled(conversationId, id, enabled);
  if (!updated) return null;
  return {
    id: updated.id,
    name: updated.name,
    summary: updated.summary,
    author: updated.author,
    enabled: updated.enabled,
    updatedAt: updated.updatedAt,
  };
};

/** Backend: GET /api/chat/customize/connectors */
export const listConnectors = async (
  input: ListConnectorsInput = {},
): Promise<ChatConnector[]> => {
  if (chatService.isAuthenticated()) {
    connectorsStore = (await chatService.getConnectors()).map((row) => ({
      id: row.connector_key || row.id,
      name: row.name || row.connector_key,
      type: row.type || 'Connector',
      status: row.status === 'connected' ? 'connected' : 'not_connected',
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    }));
  }
  const status = input.status ?? 'all';
  const q = input.query ?? '';
  let rows = connectorsStore.filter((row) =>
    status === 'all' ? true : row.status === status,
  );
  if (q.trim()) {
    rows = rows.filter(
      (row) => matches(row.name, q) || matches(row.type, q),
    );
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
};

/** Backend-qualified connector transition; unqualified catalogs fail closed. */
export const setConnectorStatus = async (
  id: string,
  status: ConnectorStatus,
): Promise<ChatConnector | null> => {
  if (chatService.isAuthenticated()) {
    const row = await chatService.setConnectorStatus(id, status);
    if (!row) throw new Error('Connector status was not saved.');
  }
  const stamp = Date.now();
  let updated: ChatConnector | null = null;
  connectorsStore = connectorsStore.map((row) => {
    if (row.id !== id) return row;
    updated = { ...row, status, updatedAt: stamp };
    return updated;
  });
  return updated;
};

/** Backend: GET /api/chat/customize/plugins */
export const listPlugins = async (
  input: ListQueryInput = {},
): Promise<ChatPlugin[]> => {
  if (chatService.isAuthenticated()) {
    pluginsStore = (await chatService.getPlugins()).map((row) => ({
      id: row.listing_id || row.id,
      name: row.name || row.listing_id,
      summary: row.summary || '',
      author: row.author || 'Marketplace',
      installed: row.enabled !== false,
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    }));
  }
  const q = input.query ?? '';
  let rows = [...pluginsStore];
  if (q.trim()) {
    rows = rows.filter(
      (plugin) =>
        matches(plugin.name, q) ||
        matches(plugin.summary, q) ||
        matches(plugin.author, q),
    );
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
};

/** Backend-qualified Marketplace transition; unqualified catalogs fail closed. */
export const setPluginInstalled = async (
  id: string,
  installed: boolean,
): Promise<ChatPlugin | null> => {
  if (chatService.isAuthenticated()) {
    const row = await chatService.setPluginInstalled(id, installed);
    if (!row) throw new Error('Plugin installation was not saved.');
  }
  const stamp = Date.now();
  let updated: ChatPlugin | null = null;
  pluginsStore = pluginsStore.map((plugin) => {
    if (plugin.id !== id) return plugin;
    updated = { ...plugin, installed, updatedAt: stamp };
    return updated;
  });
  return updated;
};

/** Backend: GET /api/chat/customize/memory */
export const getMemorySettings = async (): Promise<MemorySettings> => {
  try {
    if (chatService.isAuthenticated()) {
      const [serverMemories, settings] = await Promise.all([
        chatService.getMemories(),
        userDataService.getSettings(),
      ]);
      if (Array.isArray(serverMemories)) {
        const mappedEntries: MemoryEntry[] = serverMemories.map((m) => ({
          id: m.id,
          text: m.content,
          updatedAt: m.updated_at ? new Date(m.updated_at).getTime() : Date.now(),
        }));
        memoryStore = {
          ...memoryStore,
          generateFromChats: Boolean((settings.chat as any)?.memoryGenerateFromChats),
          entries: mappedEntries,
          updatedAt: Date.now(),
        };
      }
    }
  } catch (err) {
    console.error('[chatCustomize] Failed to get memories from backend:', err);
    if (chatService.isAuthenticated()) throw err;
  }

  return {
    generateFromChats: memoryStore.generateFromChats,
    entries: [...memoryStore.entries],
    updatedAt: memoryStore.updatedAt,
  };
};

/** Backend: PUT /api/chat/customize/memory */
export const setMemoryGenerateFromChats = async (
  enabled: boolean,
): Promise<MemorySettings> => {
  if (chatService.isAuthenticated()) {
    await userDataService.updateSetting('chat.memoryGenerateFromChats', enabled);
  }
  memoryStore = {
    ...memoryStore,
    generateFromChats: enabled,
    updatedAt: Date.now(),
  };
  return getMemorySettings();
};

/** Backend: POST /api/chat/customize/memory — server id when authenticated. */
export const addMemoryEntry = async (text: string): Promise<MemorySettings> => {
  const content = text.trim();
  if (!content) {
    return {
      generateFromChats: memoryStore.generateFromChats,
      entries: [...memoryStore.entries],
      updatedAt: memoryStore.updatedAt,
    };
  }

  const stamp = Date.now();

  try {
    if (chatService.isAuthenticated()) {
      const serverMemory = await chatService.addMemory(content);
      if (serverMemory) {
        const entry: MemoryEntry = {
          id: serverMemory.id,
          text: serverMemory.content,
          updatedAt: serverMemory.updated_at
            ? new Date(serverMemory.updated_at).getTime()
            : stamp,
        };
        memoryStore = {
          ...memoryStore,
          entries: [entry, ...memoryStore.entries],
          updatedAt: stamp,
        };
        return {
          generateFromChats: memoryStore.generateFromChats,
          entries: [...memoryStore.entries],
          updatedAt: memoryStore.updatedAt,
        };
      }
      throw new Error('Memory creation returned no durable record.');
    }
  } catch (err) {
    console.error('[chatCustomize] Failed to add memory on backend:', err);
    if (chatService.isAuthenticated()) throw err;
  }

  const entry: MemoryEntry = {
    id: randomId('mem'),
    text: content,
    updatedAt: stamp,
  };
  memoryStore = {
    ...memoryStore,
    entries: [entry, ...memoryStore.entries],
    updatedAt: stamp,
  };
  return {
    generateFromChats: memoryStore.generateFromChats,
    entries: [...memoryStore.entries],
    updatedAt: memoryStore.updatedAt,
  };
};

/** Backend: DELETE /api/chat/customize/memory/:id */
export const deleteMemoryEntry = async (id: string): Promise<MemorySettings> => {
  try {
    if (chatService.isAuthenticated()) {
      const deleted = await chatService.deleteMemory(id);
      if (!deleted) throw new Error('Memory deletion was not saved.');
    }
  } catch (err) {
    console.error('[chatCustomize] Failed to delete memory from backend:', err);
    if (chatService.isAuthenticated()) throw err;
  }

  memoryStore = {
    ...memoryStore,
    entries: memoryStore.entries.filter((entry) => entry.id !== id),
    updatedAt: Date.now(),
  };
  return getMemorySettings();
};
