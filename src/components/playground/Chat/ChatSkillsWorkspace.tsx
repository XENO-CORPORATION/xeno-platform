import React, { useEffect, useMemo, useState } from 'react';
import { IconButton } from '@xenosystem/elements-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Plus, Search, Trash2, Trash2Decl } from '@/lib/icons';
import {
  addCatalogSkillToLibrary,
  addGlobalSkillToChat,
  createLibrarySkill,
  deleteLibrarySkill,
  importLibrarySkill,
  listAddableSkillsForChat,
  listCatalogSkills,
  listChatSkills,
  listLibrarySkills,
  MAX_ADD_LEAF_SKILLS,
  setChatSkillEnabled,
  SKILL_CATEGORY_LABEL,
  SKILL_CATEGORY_ORDER,
  type AddableSkill,
  type CatalogSkill,
  type ChatSkillRow,
  type LibrarySkill,
  type SkillCategoryId,
  type SkillVisibility,
} from './chatSkillsLibrary';
import {
  buildSettingsStaggerItemVariants,
  settingsSectionOrchestratorVariants,
} from './chatSettingsStagger';

export type SkillsPanel = 'library' | 'create' | 'catalog' | 'import';

export type ChatSkillsWorkspaceProps = {
  visibility: SkillVisibility;
  conversationId: string | null;
  /** Show On/Off column (This chat only). */
  showEnabled: boolean;
  helpText: string;
  /** Fill parent height; lists scroll inside if needed. */
  fillHeight?: boolean;
};

const RADIUS = 'rounded-[6px]';

const SOURCE_LABEL: Record<LibrarySkill['source'], string> = {
  built_in: 'Built-in',
  created: 'Created',
  catalog: 'Catalog',
  imported: 'Imported',
};

/**
 * Shared Library / Create / Add / Import workspace
 * (chat-local library, or account Global skills).
 */
const ChatSkillsWorkspace: React.FC<ChatSkillsWorkspaceProps> = ({
  visibility,
  conversationId,
  showEnabled,
  helpText,
  fillHeight = false,
}) => {
  const [panel, setPanel] = useState<SkillsPanel>('library');
  const [skills, setSkills] = useState<Array<LibrarySkill | ChatSkillRow>>([]);
  const [catalog, setCatalog] = useState<CatalogSkill[]>([]);
  const [addable, setAddable] = useState<AddableSkill[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createSummary, setCreateSummary] = useState('');
  const [createBody, setCreateBody] = useState('');
  const [importName, setImportName] = useState('');
  const [importPlatform, setImportPlatform] = useState('claude');
  const [importBody, setImportBody] = useState('');
  /** Add drill-down: source → category → skills (≤ MAX_ADD_LEAF_SKILLS). */
  const [addSource, setAddSource] = useState<'global' | 'catalog' | null>(null);
  const [addCategory, setAddCategory] = useState<SkillCategoryId | null>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const staggerItemVariants = buildSettingsStaggerItemVariants(reduceMotion);

  const addableGlobals = useMemo(
    () => addable.filter((item) => item.kind === 'global'),
    [addable],
  );
  const addableCatalog = useMemo(
    () => addable.filter((item) => item.kind === 'catalog'),
    [addable],
  );

  const addPool = useMemo(() => {
    if (visibility === 'global') {
      return catalog.map((item) => ({
        id: item.id,
        name: item.name,
        summary: item.summary,
        author: item.author,
        kind: 'catalog' as const,
        category: item.category,
      }));
    }
    if (addSource === 'global') return addableGlobals;
    if (addSource === 'catalog') return addableCatalog;
    return [];
  }, [
    visibility,
    catalog,
    addSource,
    addableGlobals,
    addableCatalog,
  ]);

  const addCategories = useMemo(() => {
    const counts = new Map<SkillCategoryId, number>();
    for (const item of addPool) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return SKILL_CATEGORY_ORDER.filter((id) => (counts.get(id) ?? 0) > 0).map(
      (id) => ({
        id,
        label: SKILL_CATEGORY_LABEL[id],
        count: counts.get(id) ?? 0,
      }),
    );
  }, [addPool]);

  const addLeafSkills = useMemo(() => {
    if (!addCategory) return [];
    return addPool
      .filter((item) => item.category === addCategory)
      .slice(0, MAX_ADD_LEAF_SKILLS);
  }, [addPool, addCategory]);

  const resetAddBrowse = () => {
    setAddSource(null);
    setAddCategory(null);
  };

  const refresh = async (search = query) => {
    if (visibility === 'global') {
      setSkills(await listLibrarySkills({ query: search }));
      setCatalog(
        await listCatalogSkills({
          query: search,
          forVisibility: 'global',
        }),
      );
      setAddable([]);
    } else {
      setSkills(
        await listChatSkills({
          query: search,
          conversationId,
        }),
      );
      setAddable(
        await listAddableSkillsForChat({
          query: search,
          conversationId,
        }),
      );
      setCatalog([]);
    }
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await refresh('');
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibility, conversationId]);

  useEffect(() => {
    if (panel !== 'library' && panel !== 'catalog') return;
    void refresh(panel === 'catalog' ? '' : query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, panel]);

  useEffect(() => {
    if (panel !== 'catalog') return;
    if (visibility === 'global') {
      setAddSource('catalog');
      setAddCategory(null);
    } else {
      resetAddBrowse();
    }
  }, [panel, visibility]);

  const handleAddSkill = async (
    item: { id: string },
    kind: 'global' | 'catalog',
  ) => {
    if (kind === 'global') {
      await addGlobalSkillToChat(item.id, conversationId);
    } else {
      await addCatalogSkillToLibrary(item.id, {
        visibility,
        conversationId,
      });
    }
    resetAddBrowse();
    setPanel('library');
    await refresh(query);
  };

  const renderAddTile = (
    item: { id: string; name: string; summary: string },
    kind: 'global' | 'catalog',
    index: number,
    total: number,
  ) => (
    <motion.div
      key={`${kind}-${item.id}`}
      custom={{ index, total }}
      variants={staggerItemVariants}
      className={`chat-skills-row flex items-center gap-2 border px-2.5 py-2 ${RADIUS}`}
      style={{
        borderColor: 'var(--chat-border)',
        backgroundColor: 'var(--chat-surface)',
      }}
    >
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-[var(--chat-text)]">
          {item.name}
        </span>
        <span className="mt-0.5 block truncate text-[10.5px] text-[var(--chat-muted)]">
          {item.summary}
        </span>
      </div>
      <button
        type="button"
        onClick={() => {
          void handleAddSkill(item, kind);
        }}
        className={`${RADIUS} inline-flex h-7 flex-shrink-0 items-center gap-0.5 px-2 text-[11px] font-medium`}
        style={{
          backgroundColor: 'var(--chat-control)',
          color: 'var(--chat-text)',
        }}
        aria-label={`Add ${item.name}`}
      >
        <Plus size={11} aria-hidden="true" />
        Add
      </button>
    </motion.div>
  );

  const renderBrowseCard = (
    key: string,
    title: string,
    hint: string,
    count: number,
    onOpen: () => void,
    index: number,
    total: number,
  ) => (
    <motion.button
      key={key}
      type="button"
      custom={{ index, total }}
      variants={staggerItemVariants}
      onClick={onOpen}
      className={`chat-skills-row flex items-center gap-3 border px-3 py-3 text-left ${RADIUS}`}
      style={{
        borderColor: 'var(--chat-border)',
        backgroundColor: 'var(--chat-surface)',
      }}
    >
      <div className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-[var(--chat-text)]">
          {title}
        </span>
        <span className="mt-0.5 block text-[11px] text-[var(--chat-muted)]">
          {hint}
        </span>
      </div>
      <span className="flex-shrink-0 text-[11px] text-[var(--chat-muted)]">
        {count}
      </span>
      <ChevronRight
        size={16}
        aria-hidden="true"
        className="flex-shrink-0 text-[var(--chat-muted)]"
      />
    </motion.button>
  );

  const handleCreate = async () => {
    if (!createBody.trim() || saving) return;
    setSaving(true);
    try {
      await createLibrarySkill({
        name: createName,
        summary: createSummary,
        body: createBody,
        visibility,
        conversationId,
      });
      setCreateName('');
      setCreateSummary('');
      setCreateBody('');
      setPanel('library');
      await refresh(query);
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async () => {
    if (!importBody.trim() || saving) return;
    setSaving(true);
    try {
      await importLibrarySkill({
        name: importName,
        body: importBody,
        platform: importPlatform,
        visibility,
        conversationId,
      });
      setImportName('');
      setImportBody('');
      setPanel('library');
      await refresh(query);
    } finally {
      setSaving(false);
    }
  };

  const addBackLabel =
    panel === 'catalog'
      ? addCategory != null
        ? 'Categories'
        : visibility === 'chat' && addSource != null
          ? 'Sources'
          : null
      : null;

  const handleAddBack = () => {
    if (addCategory != null) {
      setAddCategory(null);
      return;
    }
    if (visibility === 'chat') {
      setAddSource(null);
    }
  };

  // Chrome (help + tabs) only — panel body staggers inside AnimatePresence.
  const chromeStaggerTotal = 2;

  // fillHeight (Chat settings modal): skip chrome enter stagger — nested motion
  // was leaving children at opacity 0, so the Skills block looked empty.
  const staggerEntrance = !fillHeight;

  const panelMotionKey =
    panel === 'catalog'
      ? `catalog-${addSource ?? 'root'}-${addCategory ?? 'cats'}`
      : panel;

  return (
    <motion.div
      // Remount when data arrives so chrome can stagger (account Settings).
      key={loading ? 'loading' : 'ready'}
      className={`flex flex-col gap-3 ${
        fillHeight ? 'h-full min-h-0 overflow-hidden' : ''
      }`}
      variants={
        staggerEntrance ? settingsSectionOrchestratorVariants : undefined
      }
      initial={staggerEntrance ? 'hidden' : false}
      animate={staggerEntrance ? 'visible' : undefined}
      exit={staggerEntrance ? 'hidden' : undefined}
    >
      {loading ? (
        <motion.p
          custom={{ index: 0, total: 1 }}
          variants={staggerItemVariants}
          className="py-8 text-[12.5px] text-[var(--chat-muted)]"
        >
          Loading…
        </motion.p>
      ) : (
        <>
      <motion.p
        custom={{ index: 0, total: chromeStaggerTotal }}
        variants={staggerItemVariants}
        className="flex-shrink-0 text-[12.5px] text-[var(--chat-muted)]"
      >
        {helpText}
      </motion.p>
      <motion.div
        custom={{ index: 1, total: chromeStaggerTotal }}
        variants={staggerItemVariants}
        className="flex flex-shrink-0 flex-nowrap items-center gap-1.5"
      >
        <div className="flex min-w-0 flex-shrink-0 flex-nowrap gap-0.5">
          {(
            [
              ['library', 'Library'],
              ['create', 'Create'],
              ['catalog', 'Add'],
              ['import', 'Import'],
            ] as const
          ).map(([id, label]) => {
            const active = panel === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPanel(id)}
                className={`${RADIUS} px-2.5 py-1.5 text-[11.5px] font-medium transition-colors`}
                style={{
                  backgroundColor: active
                    ? 'var(--chat-control)'
                    : 'transparent',
                  color: active ? 'var(--chat-text)' : 'var(--chat-muted)',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {panel === 'library' && (
          <label
            // mr-1.5 keeps the field off the settings body's right edge. That body scrolls
            // vertically, so it clips horizontally, and its edge landed exactly on this
            // field — close enough that the global :focus-visible ring, which paints
            // outside the border box, was sliced clean off whenever the field was focused.
            className="relative ml-auto mr-1.5 block min-w-0 max-w-[14rem] flex-1"
          >
            <span className="sr-only">Search skills</span>
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--chat-muted)]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className={`h-9 w-full border bg-transparent pl-8 pr-3 text-[12.5px] text-[var(--chat-text)] outline-none placeholder:text-[var(--chat-muted)] ${RADIUS}`}
              style={{ borderColor: 'var(--chat-border)' }}
            />
          </label>
        )}
        {addBackLabel && (
          <button
            type="button"
            onClick={handleAddBack}
            className={`${RADIUS} ml-auto inline-flex flex-shrink-0 items-center gap-1 px-2 py-1.5 text-[11.5px] font-medium text-[var(--chat-muted)] hover:text-[var(--chat-text)]`}
          >
            <ChevronLeft size={14} aria-hidden="true" />
            {addBackLabel}
          </button>
        )}
      </motion.div>

        <div
          className={`flex flex-col gap-2 ${
            fillHeight ? 'min-h-0 flex-1 overflow-hidden' : ''
          }`}
        >
          <AnimatePresence mode="wait" initial={false}>
            {panel === 'library' ? (
              skills.length === 0 ? (
                <motion.div
                  key="library-empty"
                  className={fillHeight ? 'min-h-0 flex-1' : undefined}
                  variants={settingsSectionOrchestratorVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                >
                  <motion.p
                    custom={{ index: 0, total: 1 }}
                    variants={staggerItemVariants}
                    className="py-8 text-center text-[12.5px] text-[var(--chat-muted)]"
                  >
                    No skills yet. Create, Add, or Import one.
                  </motion.p>
                </motion.div>
              ) : (
                <motion.div
                  key="library"
                  className={`flex min-h-0 flex-col gap-2 overflow-y-auto hide-scrollbar ${
                    fillHeight ? 'flex-1' : ''
                  }`}
                  variants={settingsSectionOrchestratorVariants}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                >
                  {skills.map((skill, index) => {
                    const enabled =
                      'enabled' in skill ? Boolean(skill.enabled) : false;
                    // Account built-ins stay; chat copies (even from built-in globals) can be removed.
                    const canDelete =
                      skill.visibility === 'chat' ||
                      skill.source !== 'built_in';
                    const total = skills.length;
                    return (
                      <motion.div
                        key={skill.id}
                        custom={{ index, total }}
                        variants={staggerItemVariants}
                        className={`chat-skills-row border ${RADIUS}`}
                        style={{ borderColor: 'var(--chat-border)' }}
                      >
                        <div className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                          <div className="min-w-0 flex-1">
                            <span className="block font-medium text-[var(--chat-text)]">
                              {skill.name}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-[var(--chat-muted)]">
                              {skill.summary}
                            </span>
                          </div>
                          <span className="hidden flex-shrink-0 text-[var(--chat-muted)] sm:block">
                            {SOURCE_LABEL[skill.source]}
                          </span>
                          {showEnabled && (
                            <button
                              type="button"
                              role="switch"
                              aria-checked={enabled}
                              onClick={() => {
                                void (async () => {
                                  await setChatSkillEnabled(
                                    conversationId,
                                    skill.id,
                                    !enabled,
                                  );
                                  await refresh(query);
                                })();
                              }}
                              className={`${RADIUS} min-w-[3.25rem] flex-shrink-0 px-2 py-1 text-[11.5px] font-medium`}
                              style={{
                                backgroundColor: enabled
                                  ? 'var(--chat-control)'
                                  : 'transparent',
                                color: enabled
                                  ? 'var(--chat-text)'
                                  : 'var(--chat-muted)',
                                border: '1px solid var(--chat-border)',
                              }}
                            >
                              {enabled ? 'On' : 'Off'}
                            </button>
                          )}
                          {canDelete &&
                          (visibility === 'global'
                            ? skill.visibility === 'global'
                            : skill.visibility === 'chat') ? (
                            <IconButton
                              icon={Trash2Decl}
                              variant="ghost"
                              size="sm"
                              iconSize={13}
                              onClick={() => {
                                void (async () => {
                                  await deleteLibrarySkill(skill.id);
                                  await refresh(query);
                                })();
                              }}
                              aria-label={`Delete ${skill.name}`}
                              title="Delete"
                            />
                          ) : (
                            <span className="inline-block h-7 w-7 flex-shrink-0" />
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </motion.div>
              )
            ) : panel === 'create' ? (
              <motion.div
                key="create"
                className={`flex flex-col gap-3 ${
                  fillHeight ? 'min-h-0 flex-1 overflow-hidden' : ''
                }`}
                variants={settingsSectionOrchestratorVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
              >
                <motion.label
                  custom={{ index: 0, total: 4 }}
                  variants={staggerItemVariants}
                  className="block"
                >
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                    Name
                  </span>
                  <input
                    type="text"
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                    placeholder="Condition report"
                    className={`h-10 w-full border bg-transparent px-3 text-[13px] outline-none placeholder:text-[var(--chat-muted)] ${RADIUS}`}
                    style={{
                      borderColor: 'var(--chat-border)',
                      backgroundColor: 'var(--chat-surface)',
                    }}
                  />
                </motion.label>
                <motion.label
                  custom={{ index: 1, total: 4 }}
                  variants={staggerItemVariants}
                  className="block"
                >
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                    Summary
                  </span>
                  <input
                    type="text"
                    value={createSummary}
                    onChange={(event) => setCreateSummary(event.target.value)}
                    placeholder="One line for the library list"
                    className={`h-10 w-full border bg-transparent px-3 text-[13px] outline-none placeholder:text-[var(--chat-muted)] ${RADIUS}`}
                    style={{
                      borderColor: 'var(--chat-border)',
                      backgroundColor: 'var(--chat-surface)',
                    }}
                  />
                </motion.label>
                <motion.label
                  custom={{ index: 2, total: 4 }}
                  variants={staggerItemVariants}
                  className="block"
                >
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                    Instructions
                  </span>
                  <textarea
                    value={createBody}
                    onChange={(event) => setCreateBody(event.target.value)}
                    rows={5}
                    placeholder="What should the model do when this skill is on?"
                    className={`w-full resize-none border bg-transparent px-3 py-2.5 text-[13px] leading-relaxed outline-none placeholder:text-[var(--chat-muted)] ${RADIUS}`}
                    style={{
                      borderColor: 'var(--chat-border)',
                      backgroundColor: 'var(--chat-surface)',
                      maxHeight: '8rem',
                    }}
                  />
                </motion.label>
                <motion.div
                  custom={{ index: 3, total: 4 }}
                  variants={staggerItemVariants}
                  className="flex justify-end gap-2"
                >
                  <button
                    type="button"
                    onClick={() => setPanel('library')}
                    className={`${RADIUS} h-9 px-3 text-[12.5px] text-[var(--chat-muted)] hover:text-[var(--chat-text)]`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={!createBody.trim() || saving}
                    className={`${RADIUS} h-9 px-3 text-[12.5px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40`}
                    style={{
                      backgroundColor: 'var(--chat-control)',
                      color: 'var(--chat-text)',
                    }}
                  >
                    {saving ? 'Creating…' : 'Create skill'}
                  </button>
                </motion.div>
              </motion.div>
            ) : panel === 'catalog' ? (
              (() => {
                const totalAddable =
                  visibility === 'chat' ? addable.length : catalog.length;
                if (totalAddable === 0) {
                  return (
                    <motion.div
                      key="catalog-empty"
                      variants={settingsSectionOrchestratorVariants}
                      initial="hidden"
                      animate="visible"
                      exit="hidden"
                    >
                      <motion.p
                        custom={{ index: 0, total: 1 }}
                        variants={staggerItemVariants}
                        className="py-8 text-center text-[12.5px] text-[var(--chat-muted)]"
                      >
                        Nothing left to add.
                      </motion.p>
                    </motion.div>
                  );
                }

                const leafKind: 'global' | 'catalog' =
                  visibility === 'global' ? 'catalog' : addSource ?? 'catalog';

                if (visibility === 'chat' && addSource == null) {
                  const sourceCards = [
                    addableGlobals.length > 0
                      ? ({
                          id: 'source-global' as const,
                          title: 'Global',
                          hint: 'From your account',
                          count: addableGlobals.length,
                          onOpen: () => {
                            setAddSource('global');
                            setAddCategory(null);
                          },
                        })
                      : null,
                    addableCatalog.length > 0
                      ? ({
                          id: 'source-catalog' as const,
                          title: 'Catalog',
                          hint: 'From the marketplace',
                          count: addableCatalog.length,
                          onOpen: () => {
                            setAddSource('catalog');
                            setAddCategory(null);
                          },
                        })
                      : null,
                  ].filter(Boolean) as Array<{
                    id: string;
                    title: string;
                    hint: string;
                    count: number;
                    onOpen: () => void;
                  }>;
                  return (
                    <motion.div
                      key={panelMotionKey}
                      className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${
                        fillHeight ? 'min-h-0 flex-1 content-start overflow-hidden' : ''
                      }`}
                      variants={settingsSectionOrchestratorVariants}
                      initial="hidden"
                      animate="visible"
                      exit="hidden"
                    >
                      {sourceCards.map((card, index) =>
                        renderBrowseCard(
                          card.id,
                          card.title,
                          card.hint,
                          card.count,
                          card.onOpen,
                          index,
                          sourceCards.length,
                        ),
                      )}
                    </motion.div>
                  );
                }

                if (addCategory == null) {
                  return (
                    <motion.div
                      key={panelMotionKey}
                      className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${
                        fillHeight ? 'min-h-0 flex-1 content-start overflow-hidden' : ''
                      }`}
                      variants={settingsSectionOrchestratorVariants}
                      initial="hidden"
                      animate="visible"
                      exit="hidden"
                    >
                      {addCategories.map((category, index) =>
                        renderBrowseCard(
                          category.id,
                          category.label,
                          `${category.count} skill${category.count === 1 ? '' : 's'}`,
                          category.count,
                          () => setAddCategory(category.id),
                          index,
                          addCategories.length,
                        ),
                      )}
                    </motion.div>
                  );
                }

                const leafTotal = 1 + addLeafSkills.length;
                return (
                  <motion.div
                    key={panelMotionKey}
                    className={`grid grid-cols-1 content-start gap-1.5 overflow-hidden sm:grid-cols-2 lg:grid-cols-3 ${
                      fillHeight ? 'min-h-0 flex-1' : ''
                    }`}
                    variants={settingsSectionOrchestratorVariants}
                    initial="hidden"
                    animate="visible"
                    exit="hidden"
                  >
                    <motion.p
                      custom={{ index: 0, total: leafTotal }}
                      variants={staggerItemVariants}
                      className="col-span-full text-[11px] text-[var(--chat-muted)]"
                    >
                      {SKILL_CATEGORY_LABEL[addCategory]}
                      {addLeafSkills.length > 0
                        ? ` · ${addLeafSkills.length}`
                        : ''}
                    </motion.p>
                    {addLeafSkills.map((item, index) =>
                      renderAddTile(item, leafKind, index + 1, leafTotal),
                    )}
                  </motion.div>
                );
              })()
            ) : (
              <motion.div
                key="import"
                className={`flex flex-col gap-3 ${
                  fillHeight ? 'min-h-0 flex-1 overflow-hidden' : ''
                }`}
                variants={settingsSectionOrchestratorVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
              >
                <motion.p
                  custom={{ index: 0, total: 4 }}
                  variants={staggerItemVariants}
                  className="flex-shrink-0 text-[12.5px] text-[var(--chat-muted)]"
                >
                  Paste a skill body (e.g. SKILL.md). Mock import — no file
                  upload yet.
                </motion.p>
                <motion.div
                  custom={{ index: 1, total: 4 }}
                  variants={staggerItemVariants}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                      Name
                    </span>
                    <input
                      type="text"
                      value={importName}
                      onChange={(event) => setImportName(event.target.value)}
                      placeholder="Imported skill"
                      className={`h-10 w-full border bg-transparent px-3 text-[13px] outline-none placeholder:text-[var(--chat-muted)] ${RADIUS}`}
                      style={{
                        borderColor: 'var(--chat-border)',
                        backgroundColor: 'var(--chat-surface)',
                      }}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                      Platform
                    </span>
                    <select
                      value={importPlatform}
                      onChange={(event) =>
                        setImportPlatform(event.target.value)
                      }
                      className={`h-10 w-full border bg-transparent px-3 text-[13px] outline-none ${RADIUS}`}
                      style={{
                        borderColor: 'var(--chat-border)',
                        backgroundColor: 'var(--chat-surface)',
                        color: 'var(--chat-text)',
                      }}
                    >
                      <option value="claude">Claude</option>
                      <option value="agentskills">Agent Skills</option>
                      <option value="file">File / other</option>
                    </select>
                  </label>
                </motion.div>
                <motion.label
                  custom={{ index: 2, total: 4 }}
                  variants={staggerItemVariants}
                  className="block"
                >
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                    Skill body
                  </span>
                  <textarea
                    value={importBody}
                    onChange={(event) => setImportBody(event.target.value)}
                    rows={5}
                    placeholder="# Skill name&#10;&#10;When this skill is relevant…"
                    className={`w-full resize-none border bg-transparent px-3 py-2.5 font-mono text-[12px] leading-relaxed outline-none placeholder:text-[var(--chat-muted)] ${RADIUS}`}
                    style={{
                      borderColor: 'var(--chat-border)',
                      backgroundColor: 'var(--chat-surface)',
                      maxHeight: '8rem',
                    }}
                  />
                </motion.label>
                <motion.div
                  custom={{ index: 3, total: 4 }}
                  variants={staggerItemVariants}
                  className="flex justify-end gap-2"
                >
                  <button
                    type="button"
                    onClick={() => setPanel('library')}
                    className={`${RADIUS} h-9 px-3 text-[12.5px] text-[var(--chat-muted)] hover:text-[var(--chat-text)]`}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleImport()}
                    disabled={!importBody.trim() || saving}
                    className={`${RADIUS} h-9 px-3 text-[12.5px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40`}
                    style={{
                      backgroundColor: 'var(--chat-control)',
                      color: 'var(--chat-text)',
                    }}
                  >
                    {saving ? 'Importing…' : 'Import skill'}
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        </>
      )}
    </motion.div>
  );
};

export default ChatSkillsWorkspace;
