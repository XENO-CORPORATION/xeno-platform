/**
 * Chat Customize contract.
 *
 * UI calls these functions only. Today they are in-memory mocks; a real backend
 * replaces the bodies without changing ChatCustomizePage / ChatWithLLM.
 */

import {
  listChatSkills,
  setChatSkillEnabled,
} from './chatSkillsLibrary';

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
let personasStore: ChatPersona[] = [
  {
    id: 'conservator',
    label: 'Conservator',
    summary: 'Calm client tone · reversible steps',
    prompt:
      'You are a conservation professional. Prefer concise answers. Use conservation vocabulary carefully. When unsure about materials, ask before recommending treatments. Keep tone calm and professional for client-facing drafts.',
    updatedAt: now - 2 * day,
  },
  {
    id: 'studio-notes',
    label: 'Studio notes',
    summary: 'Lab notes · short, dated bullets',
    prompt:
      'You help write studio lab notes. Prefer short dated bullets, materials named plainly, and clear next actions. No fluff.',
    updatedAt: now - 5 * day,
  },
  {
    id: 'engineer',
    label: 'Engineer',
    summary: 'Code, debug, system design',
    prompt:
      'You are an expert software engineer. Help with coding, debugging, system design, and technical problem-solving. Provide clear, efficient solutions with best practices.',
    updatedAt: now - 40 * day,
  },
  {
    id: 'lawyer',
    label: 'Lawyer',
    summary: 'Legal information · not advice',
    prompt:
      'You are an experienced legal professional. Provide legal information, help draft documents, explain legal concepts, and offer guidance on legal matters. Note: This is not legal advice.',
    updatedAt: now - 40 * day,
  },
  {
    id: 'copywriter',
    label: 'Copywriter',
    summary: 'Marketing and clear messaging',
    prompt:
      'You are a skilled copywriter and content creator. Help craft compelling copy, marketing content, blog posts, and creative writing with engaging tone and clear messaging.',
    updatedAt: now - 40 * day,
  },
];

let profileStore: CustomizeProfile = {
  instructions:
    'Prefer concise answers. Keep English technical terms. When explaining, check understanding with a short question.',
  activePersonaId: 'conservator',
  updatedAt: now - 1 * day,
};

let connectorsStore: ChatConnector[] = [
  {
    id: 'conn-gmail',
    name: 'Gmail',
    type: 'Web',
    status: 'not_connected',
    updatedAt: now - 60 * day,
  },
  {
    id: 'conn-drive',
    name: 'Google Drive',
    type: 'Web',
    status: 'not_connected',
    updatedAt: now - 60 * day,
  },
  {
    id: 'conn-slack',
    name: 'Slack',
    type: 'Web',
    status: 'connected',
    updatedAt: now - 4 * day,
  },
  {
    id: 'conn-github',
    name: 'GitHub',
    type: 'Web',
    status: 'not_connected',
    updatedAt: now - 90 * day,
  },
];

let pluginsStore: ChatPlugin[] = [
  {
    id: 'plugin-studio-pack',
    name: 'Studio pack',
    summary: 'Condition notes + client digest skills',
    author: 'XENO',
    installed: true,
    updatedAt: now - 6 * day,
  },
  {
    id: 'plugin-research',
    name: 'Research pack',
    summary: 'Source check + citation helpers',
    author: 'XENO',
    installed: false,
    updatedAt: now - 15 * day,
  },
];

let memoryStore: MemorySettings = {
  generateFromChats: false,
  entries: [
    {
      id: 'mem-1',
      text: 'Prefers conservation vocabulary; ask before recommending irreversible treatments.',
      updatedAt: now - 2 * day,
    },
    {
      id: 'mem-2',
      text: 'Client emails should stay calm and short.',
      updatedAt: now - 9 * day,
    },
  ],
  updatedAt: now - 2 * day,
};

const matches = (haystack: string, query: string): boolean =>
  haystack.toLowerCase().includes(query.trim().toLowerCase());

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
 * Mock: filter in memory. Backend: GET /api/chat/customize/personas
 */
export const listPersonas = async (
  input: ListQueryInput = {},
): Promise<ChatPersona[]> => {
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

/** Mock profile — UI can call this; wire to GET later. */
export const getCustomizeProfile = async (): Promise<CustomizeProfile> => ({
  ...profileStore,
});

/** Mock save instructions — wire to PUT later. */
export const saveCustomizeInstructions = async (
  instructions: string,
): Promise<CustomizeProfile> => {
  profileStore = {
    ...profileStore,
    instructions: instructions.trim(),
    updatedAt: Date.now(),
  };
  return { ...profileStore };
};

/** Mock set active persona — wire to PUT later. */
export const setActivePersona = async (
  personaId: string | null,
): Promise<CustomizeProfile> => {
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
  const scope = resolvePersonaScope(conversationId);
  return scope in chatPersonaByScope ? chatPersonaByScope[scope] : null;
};

/** Backend: PUT /api/chat/conversations/:id/persona */
export const setChatPersonaId = async (
  conversationId: string | null | undefined,
  personaId: string | null,
): Promise<string | null> => {
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

/** Backend: POST/DELETE connect — mock toggles status. */
export const setConnectorStatus = async (
  id: string,
  status: ConnectorStatus,
): Promise<ChatConnector | null> => {
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

/** Backend: POST install / DELETE uninstall — mock toggles installed. */
export const setPluginInstalled = async (
  id: string,
  installed: boolean,
): Promise<ChatPlugin | null> => {
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
export const getMemorySettings = async (): Promise<MemorySettings> => ({
  generateFromChats: memoryStore.generateFromChats,
  entries: [...memoryStore.entries],
  updatedAt: memoryStore.updatedAt,
});

/** Backend: PUT /api/chat/customize/memory */
export const setMemoryGenerateFromChats = async (
  enabled: boolean,
): Promise<MemorySettings> => {
  memoryStore = {
    ...memoryStore,
    generateFromChats: enabled,
    updatedAt: Date.now(),
  };
  return getMemorySettings();
};

/** Backend: DELETE /api/chat/customize/memory/:id */
export const deleteMemoryEntry = async (id: string): Promise<MemorySettings> => {
  memoryStore = {
    ...memoryStore,
    entries: memoryStore.entries.filter((entry) => entry.id !== id),
    updatedAt: Date.now(),
  };
  return getMemorySettings();
};
