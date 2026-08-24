/**
 * Chat LLM skills libraries.
 *
 * - Global (account Settings): Create / Add / Import → account catalog of skills.
 * - Chat Customize: Library = skills installed on this chat only; Add = account
 *   globals + marketplace catalog to install into this chat; then On/Off.
 */

export type LibrarySkillSource = 'built_in' | 'created' | 'catalog' | 'imported';

export type SkillVisibility = 'global' | 'chat';

export type LibrarySkill = {
  id: string;
  name: string;
  summary: string;
  /** Full skill body (instructions). */
  body: string;
  author: string;
  source: LibrarySkillSource;
  /** global = account library; chat = only one conversation. */
  visibility: SkillVisibility;
  /**
   * When visibility === 'chat': conversation id, or PENDING_CHAT_SKILLS_SCOPE
   * for the New chat draft. Null when global.
   */
  conversationId: string | null;
  /** If cloned into a chat from a global or catalog row, the source id. */
  originId: string | null;
  createdAt: number;
  updatedAt: number;
};

/** Row for UI lists — includes effective On/Off for a chat scope. */
export type ChatSkillRow = LibrarySkill & {
  enabled: boolean;
};

export type CreateLibrarySkillInput = {
  name: string;
  summary: string;
  body: string;
  visibility: SkillVisibility;
  /** Required when visibility === 'chat' (null = New chat draft). */
  conversationId?: string | null;
};

export type ImportLibrarySkillInput = {
  name: string;
  summary?: string;
  body: string;
  /** e.g. "claude" | "agentskills" | "file" */
  platform: string;
  visibility: SkillVisibility;
  conversationId?: string | null;
};

export type CatalogSkill = {
  id: string;
  name: string;
  summary: string;
  body: string;
  author: string;
  category: SkillCategoryId;
};

/** Max skills shown on one Add leaf screen (zero scroll, no pagination). */
export const MAX_ADD_LEAF_SKILLS = 12;

export type SkillCategoryId =
  | 'communication'
  | 'treatment'
  | 'logistics'
  | 'lab'
  | 'materials'
  | 'studio'
  | 'general';

export const SKILL_CATEGORY_LABEL: Record<SkillCategoryId, string> = {
  communication: 'Communication',
  treatment: 'Treatment',
  logistics: 'Logistics',
  lab: 'Lab & analysis',
  materials: 'Materials',
  studio: 'Studio ops',
  general: 'General',
};

/** Browse order inside Global / Catalog. */
export const SKILL_CATEGORY_ORDER: SkillCategoryId[] = [
  'communication',
  'treatment',
  'logistics',
  'lab',
  'materials',
  'studio',
  'general',
];

/**
 * Category for each mock skill id. Leaf groups must stay ≤ MAX_ADD_LEAF_SKILLS
 * so Add can drill down without scroll or pagination.
 */
const SKILL_CATEGORY_BY_ID: Record<string, SkillCategoryId> = {
  'skill-condition-report': 'treatment',
  'skill-client-email': 'communication',
  'skill-palette-extract': 'treatment',
  'skill-loan-pack': 'logistics',
  'skill-photo-set': 'logistics',
  'skill-estimate-scope': 'treatment',
  'skill-storage-move': 'logistics',
  'skill-meeting-minutes': 'communication',
  'skill-label-copy': 'communication',
  'skill-vendor-brief': 'communication',
  'skill-insurance-claim': 'logistics',
  'skill-treatment-proposal': 'treatment',
  'skill-mount-spec': 'treatment',
  'skill-courier-brief': 'logistics',
  'skill-inventory-diff': 'logistics',
  'skill-solvent-plan': 'treatment',
  'skill-donor-update': 'communication',
  'skill-frame-assessment': 'treatment',
  'skill-sample-log': 'treatment',
  'skill-exhibit-schedule': 'logistics',
  'skill-light-budget': 'logistics',
  'skill-pest-trap-log': 'logistics',
  'skill-access-request': 'communication',
  'catalog-lab-checklist': 'lab',
  'catalog-treatment-risk': 'lab',
  'catalog-packing-spec': 'studio',
  'catalog-climate-log': 'lab',
  'catalog-bid-response': 'studio',
  'catalog-ethics-check': 'lab',
  'catalog-material-id': 'lab',
  'catalog-press-blurb': 'studio',
  'catalog-uv-exam': 'lab',
  'catalog-xray-brief': 'lab',
  'catalog-varnish-options': 'materials',
  'catalog-tear-mending': 'materials',
  'catalog-gilding-touch': 'materials',
  'catalog-textile-clean': 'materials',
  'catalog-metal-corrosion': 'materials',
  'catalog-stone-desalt': 'materials',
  'catalog-wood-pest': 'materials',
  'catalog-photo-rights': 'studio',
  'catalog-grant-snippet': 'studio',
  'catalog-training-drill': 'studio',
  'catalog-incident-report': 'studio',
  'catalog-storage-audit': 'studio',
  // Customize dialog mock skills (layout demo when a chat has none installed)
  'mock-customize-intake': 'logistics',
  'mock-customize-condition': 'treatment',
  'mock-customize-glossary': 'communication',
  'mock-customize-timeline': 'studio',
  'mock-customize-qc': 'lab',
  'mock-customize-handoff': 'communication',
  'mock-customize-solvent': 'materials',
  'mock-customize-packing': 'logistics',
  'mock-customize-email': 'communication',
  'mock-customize-estimate': 'treatment',
};

export const resolveSkillCategory = (id: string): SkillCategoryId =>
  SKILL_CATEGORY_BY_ID[id] ?? 'general';


const day = 24 * 60 * 60 * 1000;
const now = Date.now();

export const PENDING_CHAT_SKILLS_SCOPE = 'pending-new-chat';

const randomId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `skill-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  }
  return `skill-${Date.now().toString(36)}`;
};

const resolveChatScope = (conversationId: string | null | undefined): string =>
  conversationId?.trim() ? conversationId : PENDING_CHAT_SKILLS_SCOPE;

/** Seed: account Global skills (install into a chat via Add). */
let libraryStore: LibrarySkill[] = [];

const catalogStore: Array<Omit<CatalogSkill, 'category'>> = [];

export type ListLibraryInput = {
  query?: string;
};

const matches = (text: string, query: string): boolean =>
  text.toLowerCase().includes(query.trim().toLowerCase());

const filterByQuery = (rows: LibrarySkill[], query: string): LibrarySkill[] => {
  if (!query.trim()) return rows;
  return rows.filter(
    (skill) =>
      matches(skill.name, query) ||
      matches(skill.summary, query) ||
      matches(skill.author, query) ||
      matches(skill.body, query),
  );
};

import { chatService } from '@/services/chatService';

/** Backend: GET /api/chat/skills/library (Profile — global only). */
export const listLibrarySkills = async (
  input: ListLibraryInput = {},
): Promise<LibrarySkill[]> => {
  try {
    if (chatService.isAuthenticated()) {
      const serverSkills = await chatService.getSkills({ visibility: 'global' });
      if (Array.isArray(serverSkills)) {
        const mapped: LibrarySkill[] = serverSkills.map((row) => ({
          id: row.id,
          name: row.name,
          summary: row.summary,
          body: row.body,
          author: row.author || 'You',
          source: row.source || 'created',
          visibility: row.visibility || 'global',
          conversationId: row.conversation_id || null,
          originId: row.origin_id || null,
          createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
          updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
        }));
        const existingIds = new Set(mapped.map((s) => s.id));
        libraryStore = [...mapped, ...libraryStore.filter((s) => !existingIds.has(s.id))];
      }
    }
  } catch (err) {
    console.warn('[chatSkillsLibrary] Failed to list skills from backend:', err);
  }

  const rows = filterByQuery(
    libraryStore.filter((skill) => skill.visibility === 'global'),
    input.query ?? '',
  );
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
};

export type ListCatalogInput = ListLibraryInput & {
  /**
   * When listing catalog for a chat, hide names already installed on that chat.
   * When listing for global library, hide names already owned globally.
   */
  conversationId?: string | null;
  forVisibility?: SkillVisibility;
};

/** Backend: GET /api/chat/skills/catalog */
export const listCatalogSkills = async (
  input: ListCatalogInput = {},
): Promise<CatalogSkill[]> => {
  const q = input.query ?? '';
  const forChat = input.forVisibility === 'chat';
  const scope = forChat ? resolveChatScope(input.conversationId) : null;
  const owned = new Set(
    libraryStore
      .filter((skill) => {
        if (forChat && scope) {
          return (
            skill.visibility === 'chat' && skill.conversationId === scope
          );
        }
        return skill.visibility === 'global';
      })
      .map((skill) => skill.name.toLowerCase()),
  );
  let rows = catalogStore.filter((skill) => !owned.has(skill.name.toLowerCase()));
  if (q.trim()) {
    rows = rows.filter(
      (skill) =>
        matches(skill.name, q) ||
        matches(skill.summary, q) ||
        matches(skill.author, q),
    );
  }
  return rows.map((skill) => ({
    ...skill,
    category: resolveSkillCategory(skill.id),
  }));
};

const buildSkill = (
  partial: Omit<LibrarySkill, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string;
  },
): LibrarySkill => {
  const stamp = Date.now();
  return {
    id: partial.id ?? randomId(),
    name: partial.name,
    summary: partial.summary,
    body: partial.body,
    author: partial.author,
    source: partial.source,
    visibility: partial.visibility,
    conversationId: partial.conversationId,
    originId: partial.originId ?? null,
    createdAt: stamp,
    updatedAt: stamp,
  };
};

const resolveCreateScope = (
  visibility: SkillVisibility,
  conversationId?: string | null,
): string | null => {
  if (visibility === 'global') return null;
  return resolveChatScope(conversationId);
};

type ChatSkillOverrideMap = Record<string, boolean>;

/** conversation scope → skillId → enabled */
let chatSkillOverrides: Record<string, ChatSkillOverrideMap> = {};

/**
 * Effective On/Off for a chat.
 * Chat-local skills default On (installed / created for that chat).
 */
export const isSkillEnabledForChat = (
  conversationId: string | null | undefined,
  skillId: string,
): boolean => {
  const scope = resolveChatScope(conversationId);
  const override = chatSkillOverrides[scope]?.[skillId];
  if (override !== undefined) return override;
  const skill = libraryStore.find((row) => row.id === skillId);
  if (!skill) return false;
  return (
    skill.visibility === 'chat' && skill.conversationId === scope
  );
};

/** Backend: PATCH /api/chat/conversations/:id/skills/:skillId */
export const setChatSkillEnabled = async (
  conversationId: string | null | undefined,
  skillId: string,
  enabled: boolean,
): Promise<ChatSkillRow | null> => {
  const skill = libraryStore.find((row) => row.id === skillId);
  if (!skill || skill.visibility !== 'chat') return null;
  const scope = resolveChatScope(conversationId);
  if (skill.conversationId !== scope) return null;
  chatSkillOverrides = {
    ...chatSkillOverrides,
    [scope]: {
      ...(chatSkillOverrides[scope] ?? {}),
      [skillId]: enabled,
    },
  };
  return {
    ...skill,
    enabled,
    updatedAt: Date.now(),
  };
};

/** Backend: POST /api/chat/skills/library */
export const createLibrarySkill = async (
  input: CreateLibrarySkillInput,
): Promise<LibrarySkill> => {
  const scope = resolveCreateScope(input.visibility, input.conversationId);

  try {
    if (chatService.isAuthenticated()) {
      const serverSkill = await chatService.createSkill({
        name: input.name.trim() || 'Untitled skill',
        summary: input.summary.trim(),
        body: input.body.trim(),
        visibility: input.visibility,
        conversation_id: scope ?? undefined,
      });

      if (serverSkill) {
        const skill: LibrarySkill = {
          id: serverSkill.id,
          name: serverSkill.name,
          summary: serverSkill.summary,
          body: serverSkill.body,
          author: serverSkill.author || 'You',
          source: serverSkill.source || 'created',
          visibility: serverSkill.visibility || input.visibility,
          conversationId: serverSkill.conversation_id || scope,
          originId: null,
          createdAt: serverSkill.created_at ? new Date(serverSkill.created_at).getTime() : Date.now(),
          updatedAt: serverSkill.updated_at ? new Date(serverSkill.updated_at).getTime() : Date.now(),
        };
        libraryStore = [skill, ...libraryStore];
        if (skill.visibility === 'chat' && skill.conversationId) {
          await setChatSkillEnabled(skill.conversationId, skill.id, true);
        }
        return skill;
      }
    }
  } catch (err) {
    console.warn('[chatSkillsLibrary] Failed to create skill on backend:', err);
  }

  const skill = buildSkill({
    name: input.name.trim() || 'Untitled skill',
    summary: input.summary.trim(),
    body: input.body.trim(),
    author: 'You',
    source: 'created',
    visibility: input.visibility,
    conversationId: scope,
    originId: null,
  });
  libraryStore = [skill, ...libraryStore];
  if (skill.visibility === 'chat' && skill.conversationId) {
    await setChatSkillEnabled(skill.conversationId, skill.id, true);
  }
  return skill;
};

/** Backend: POST /api/chat/skills/library/from-catalog */
export const addCatalogSkillToLibrary = async (
  catalogId: string,
  options: {
    visibility: SkillVisibility;
    conversationId?: string | null;
  },
): Promise<LibrarySkill | null> => {
  const catalog = catalogStore.find((item) => item.id === catalogId);
  if (!catalog) return null;
  const skill = buildSkill({
    name: catalog.name,
    summary: catalog.summary,
    body: catalog.body,
    author: catalog.author,
    source: 'catalog',
    visibility: options.visibility,
    conversationId: resolveCreateScope(
      options.visibility,
      options.conversationId,
    ),
    originId: catalog.id,
  });
  libraryStore = [skill, ...libraryStore];
  if (skill.visibility === 'chat' && skill.conversationId) {
    await setChatSkillEnabled(skill.conversationId, skill.id, true);
  }
  return skill;
};

/**
 * Backend: POST /api/chat/skills/import
 * Mock accepts pasted SKILL.md-style body (+ name).
 */
export const importLibrarySkill = async (
  input: ImportLibrarySkillInput,
): Promise<LibrarySkill> => {
  const skill = buildSkill({
    name: input.name.trim() || 'Imported skill',
    summary: (input.summary ?? `Imported from ${input.platform}`).trim(),
    body: input.body.trim(),
    author: 'Imported',
    source: 'imported',
    visibility: input.visibility,
    conversationId: resolveCreateScope(input.visibility, input.conversationId),
    originId: null,
  });
  libraryStore = [skill, ...libraryStore];
  if (skill.visibility === 'chat' && skill.conversationId) {
    await setChatSkillEnabled(skill.conversationId, skill.id, true);
  }
  return skill;
};

export type ListChatSkillsInput = ListLibraryInput & {
  /** null / undefined = New chat draft (pending scope). */
  conversationId?: string | null;
};

/** Skills installed on a chat (local only — not account globals). */
export const listChatSkills = async (
  input: ListChatSkillsInput = {},
): Promise<ChatSkillRow[]> => {
  const scope = resolveChatScope(input.conversationId);
  const visible = libraryStore.filter(
    (skill) =>
      skill.visibility === 'chat' && skill.conversationId === scope,
  );
  const rows = filterByQuery(visible, input.query ?? '');
  return rows
    .map((skill) => ({
      ...skill,
      enabled: isSkillEnabledForChat(input.conversationId, skill.id),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
};

export type AddableSkillKind = 'global' | 'catalog';

/** Row for Chat Customize → Add (account globals + marketplace not yet on this chat). */
export type AddableSkill = {
  id: string;
  name: string;
  summary: string;
  author: string;
  kind: AddableSkillKind;
  category: SkillCategoryId;
};

const chatOwnsSkill = (scope: string, originId: string, name: string): boolean =>
  libraryStore.some(
    (skill) =>
      skill.visibility === 'chat' &&
      skill.conversationId === scope &&
      (skill.originId === originId ||
        skill.name.toLowerCase() === name.toLowerCase()),
  );

/**
 * Backend: GET /api/chat/conversations/:id/skills/addable
 * Account globals + catalog entries not yet installed on this chat.
 */
export const listAddableSkillsForChat = async (
  input: ListChatSkillsInput = {},
): Promise<AddableSkill[]> => {
  const scope = resolveChatScope(input.conversationId);
  const q = input.query ?? '';
  const globals: AddableSkill[] = libraryStore
    .filter(
      (skill) =>
        skill.visibility === 'global' &&
        !chatOwnsSkill(scope, skill.id, skill.name),
    )
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      summary: skill.summary,
      author: skill.author,
      kind: 'global' as const,
      category: resolveSkillCategory(skill.id),
    }));
  const catalog = await listCatalogSkills({
    query: '',
    forVisibility: 'chat',
    conversationId: input.conversationId,
  });
  const catalogRows: AddableSkill[] = catalog.map((item) => ({
    id: item.id,
    name: item.name,
    summary: item.summary,
    author: item.author,
    kind: 'catalog' as const,
    category: item.category,
  }));
  let rows = [...globals, ...catalogRows];
  if (q.trim()) {
    rows = rows.filter(
      (skill) =>
        matches(skill.name, q) ||
        matches(skill.summary, q) ||
        matches(skill.author, q),
    );
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
};

/** Backend: POST /api/chat/conversations/:id/skills/from-global */
export const addGlobalSkillToChat = async (
  globalSkillId: string,
  conversationId?: string | null,
): Promise<LibrarySkill | null> => {
  const global = libraryStore.find(
    (skill) => skill.id === globalSkillId && skill.visibility === 'global',
  );
  if (!global) return null;
  const scope = resolveChatScope(conversationId);
  if (chatOwnsSkill(scope, global.id, global.name)) return null;
  const skill = buildSkill({
    name: global.name,
    summary: global.summary,
    body: global.body,
    author: global.author,
    source: global.source,
    visibility: 'chat',
    conversationId: scope,
    originId: global.id,
  });
  libraryStore = [skill, ...libraryStore];
  await setChatSkillEnabled(scope, skill.id, true);
  return skill;
};

/**
 * Bind New-chat draft: move pending local skills + On/Off overrides
 * onto the real conversation id.
 */
export const bindPendingChatSkills = async (
  conversationId: string,
): Promise<void> => {
  libraryStore = libraryStore.map((skill) => {
    if (
      skill.visibility === 'chat' &&
      skill.conversationId === PENDING_CHAT_SKILLS_SCOPE
    ) {
      return { ...skill, conversationId, updatedAt: Date.now() };
    }
    return skill;
  });

  const pending = chatSkillOverrides[PENDING_CHAT_SKILLS_SCOPE];
  if (!pending || Object.keys(pending).length === 0) return;
  const { [PENDING_CHAT_SKILLS_SCOPE]: _removed, ...rest } = chatSkillOverrides;
  chatSkillOverrides = {
    ...rest,
    [conversationId]: {
      ...(rest[conversationId] ?? {}),
      ...pending,
    },
  };
};

/** Clear New-chat draft skills + toggles (e.g. user clicks New chat again). */
export const clearPendingChatSkills = async (): Promise<void> => {
  libraryStore = libraryStore.filter(
    (skill) =>
      !(
        skill.visibility === 'chat' &&
        skill.conversationId === PENDING_CHAT_SKILLS_SCOPE
      ),
  );
  if (!(PENDING_CHAT_SKILLS_SCOPE in chatSkillOverrides)) return;
  const { [PENDING_CHAT_SKILLS_SCOPE]: _removed, ...rest } = chatSkillOverrides;
  chatSkillOverrides = rest;
};

/** Backend: DELETE /api/chat/skills/library/:id */
export const deleteLibrarySkill = async (id: string): Promise<void> => {
  try {
    if (chatService.isAuthenticated()) {
      await chatService.deleteSkill(id);
    }
  } catch (err) {
    console.warn('[chatSkillsLibrary] Failed to delete skill on backend:', err);
  }
  libraryStore = libraryStore.filter((skill) => skill.id !== id);
  chatSkillOverrides = Object.fromEntries(
    Object.entries(chatSkillOverrides).map(([scope, map]) => {
      const { [id]: _removed, ...rest } = map;
      return [scope, rest];
    }),
  );
};

/** Backend: GET /api/chat/skills/library/:id */
export const getLibrarySkill = async (
  id: string,
): Promise<LibrarySkill | null> =>
  libraryStore.find((skill) => skill.id === id) ?? null;

/** Chat profile stub for Chat LLM settings. Backend: GET/PUT /api/chat/profile */
export type ChatProfile = {
  displayName: string;
  /** Persona id from the shared catalog, or null = none. */
  defaultPersonaId: string | null;
  updatedAt: number;
};

let chatProfileStore: ChatProfile = {
  displayName: '',
  defaultPersonaId: null,
  updatedAt: now - 1 * day,
};

export const getChatProfile = async (): Promise<ChatProfile> => ({
  ...chatProfileStore,
});

export const saveChatProfile = async (
  input: Partial<Pick<ChatProfile, 'displayName' | 'defaultPersonaId'>>,
): Promise<ChatProfile> => {
  chatProfileStore = {
    ...chatProfileStore,
    ...input,
    displayName:
      input.displayName !== undefined
        ? input.displayName.trim() || chatProfileStore.displayName
        : chatProfileStore.displayName,
    defaultPersonaId:
      input.defaultPersonaId !== undefined
        ? input.defaultPersonaId
        : chatProfileStore.defaultPersonaId,
    updatedAt: Date.now(),
  };
  return { ...chatProfileStore };
};
