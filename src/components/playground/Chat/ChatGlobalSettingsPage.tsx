import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Search, Settings, Trash2 } from 'lucide-react';
import ChatSkillsWorkspace from './ChatSkillsWorkspace';
import {
  deleteMemoryEntry,
  getCustomizeProfile,
  getMemorySettings,
  listConnectors,
  listPersonas,
  listPlugins,
  saveCustomizeInstructions,
  setActivePersona,
  setConnectorStatus,
  setMemoryGenerateFromChats,
  setPluginInstalled,
  type ChatConnector,
  type ChatPersona,
  type ChatPlugin,
  type ConnectorStatus,
  type MemoryEntry,
} from './chatCustomize';
import {
  buildSettingsStaggerItemVariants,
  settingsSectionOrchestratorVariants,
} from './chatSettingsStagger';

export type ChatGlobalSettingsPageProps = {
  pageLeft: number;
  onClose: () => void;
  onApplyPersona: (persona: ChatPersona | null) => void;
  onSaveInstructionsLive?: (instructions: string) => void;
};

type Section =
  | 'skills'
  | 'instructions'
  | 'personas'
  | 'memory'
  | 'connectors'
  | 'plugins';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'skills', label: 'Skills' },
  { id: 'instructions', label: 'Instructions' },
  { id: 'personas', label: 'Personas' },
  { id: 'memory', label: 'Memory' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'plugins', label: 'Plugins' },
];

const RADIUS = 'rounded-[6px]';

const SettingsSectionShell: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className, children }) => (
  <motion.div
    className={className}
    variants={settingsSectionOrchestratorVariants}
    initial="hidden"
    animate="visible"
    exit="hidden"
  >
    {children}
  </motion.div>
);

const formatUpdated = (ts: number): string => {
  const diff = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'Today';
  if (diff < 2 * day) return 'Yesterday';
  const days = Math.floor(diff / day);
  if (days < 14) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

/**
 * Account-level Chat LLM settings hub (sidebar).
 * Library: Skills / Instructions / Personas / Memory / Connectors / Plugins.
 * This-chat On/Off + install: Chat settings → Customize, or ⋯ → Customize (toggles only).
 * Preferences (layout) stay in Chat settings → Preferences.
 */
const ChatGlobalSettingsPage: React.FC<ChatGlobalSettingsPageProps> = ({
  pageLeft,
  onApplyPersona,
  onSaveInstructionsLive,
}) => {
  const [section, setSection] = useState<Section>('skills');
  const [instructions, setInstructions] = useState('');
  const [savedInstructions, setSavedInstructions] = useState('');
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [personas, setPersonas] = useState<ChatPersona[]>([]);
  const [connectors, setConnectors] = useState<ChatConnector[]>([]);
  const [connectorFilter, setConnectorFilter] = useState<ConnectorStatus | 'all'>(
    'all',
  );
  const [plugins, setPlugins] = useState<ChatPlugin[]>([]);
  const [memoryOn, setMemoryOn] = useState(false);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const reduceMotion = useReducedMotion() ?? false;
  const staggerItemVariants = buildSettingsStaggerItemVariants(reduceMotion);

  const dirty = instructions !== savedInstructions;

  const refreshProfile = async () => {
    const profile = await getCustomizeProfile();
    setInstructions(profile.instructions);
    setSavedInstructions(profile.instructions);
    setActivePersonaId(profile.activePersonaId);
  };

  const refreshSection = async (next: Section, search = query) => {
    if (next === 'personas') {
      setPersonas(await listPersonas({ query: search }));
      return;
    }
    if (next === 'connectors') {
      setConnectors(
        await listConnectors({ query: search, status: connectorFilter }),
      );
      return;
    }
    if (next === 'plugins') {
      setPlugins(await listPlugins({ query: search }));
      return;
    }
    if (next === 'memory') {
      const memory = await getMemorySettings();
      setMemoryOn(memory.generateFromChats);
      setMemoryEntries(memory.entries);
    }
  };

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await refreshProfile();
      if (section !== 'skills' && section !== 'instructions') {
        await refreshSection(section);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (section === 'skills' || section === 'instructions') return;
    void refreshSection(section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, query, connectorFilter]);

  const handleSaveInstructions = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const profile = await saveCustomizeInstructions(instructions);
      setSavedInstructions(profile.instructions);
      onSaveInstructionsLive?.(profile.instructions);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1400);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectPersona = async (persona: ChatPersona) => {
    const nextId = activePersonaId === persona.id ? null : persona.id;
    const profile = await setActivePersona(nextId);
    setActivePersonaId(profile.activePersonaId);
    if (nextId) {
      onApplyPersona(persona);
    } else {
      onApplyPersona(null);
    }
  };

  const searchPlaceholder =
    section === 'personas'
      ? 'Search personas'
      : section === 'connectors'
        ? 'Search connectors'
        : section === 'plugins'
          ? 'Search plugins'
          : 'Search';

  return (
    <div
      className="absolute inset-0 z-[45] flex flex-col main-content-transition"
      style={{
        left: pageLeft,
        backgroundColor: 'var(--chat-canvas)',
        color: 'var(--chat-text)',
      }}
      role="dialog"
      aria-label="Settings"
    >
      <style>{`
        .chat-global-settings-row {
          transition: background-color 140ms ease;
        }
        .chat-global-settings-row:hover,
        .chat-global-settings-row[data-active='true'] {
          background-color: var(--chat-surface);
        }
        .chat-skills-row {
          transition: background-color 140ms ease;
        }
        .chat-skills-row:hover {
          background-color: var(--chat-surface);
        }
      `}</style>

      <div className="mx-auto flex h-full w-full max-w-[48rem] flex-col px-4 sm:px-6">
        <div className="flex min-h-[2.75rem] flex-shrink-0 items-center gap-2.5 pt-6 pb-3 md:min-h-[3rem] md:pt-8 md:pb-4">
          <Settings
            size={18}
            className="flex-shrink-0 text-[var(--chat-muted)]"
            aria-hidden="true"
          />
          <h1 className="flex-shrink-0 font-display text-[1.15rem] font-medium tracking-tight text-[var(--chat-text)]">
            Settings
          </h1>
          <span
            className="h-4 w-px flex-shrink-0"
            style={{ backgroundColor: 'var(--chat-border)' }}
            aria-hidden="true"
          />
          <p className="min-w-0 truncate text-[12.5px] text-[var(--chat-muted)]">
            Account-level Chat LLM settings. Profile and layout stay in Chat
            settings.
          </p>
        </div>

        <div
          className={`mb-4 flex w-full flex-shrink-0 gap-0.5 overflow-x-auto border p-0.5 hide-scrollbar ${RADIUS}`}
          style={{
            borderColor: 'var(--chat-border)',
            backgroundColor: 'var(--chat-surface)',
          }}
          role="tablist"
          aria-label="Settings sections"
        >
          {SECTIONS.map(({ id, label }) => {
            const active = section === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setQuery('');
                  setSection(id);
                }}
                className={`${RADIUS} flex-shrink-0 px-2.5 py-1.5 text-[12px] font-medium transition-colors`}
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

        <div className="min-h-0 flex-1 overflow-y-auto pb-8 hide-scrollbar">
          <AnimatePresence mode="wait" initial={false}>
            {loading && section !== 'skills' ? (
              <motion.p
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-8 text-[12.5px] text-[var(--chat-muted)]"
              >
                Loading…
              </motion.p>
            ) : section === 'skills' ? (
              <ChatSkillsWorkspace
                key="skills"
                visibility="global"
                conversationId={null}
                showEnabled={false}
                helpText="Account Global library (Create / Add / Import). To put a skill on an open chat: Chat settings → Customize → Add. Quick On/Off: ⋯ → Customize."
              />
            ) : section === 'instructions' ? (
              <SettingsSectionShell
                key="instructions"
                className="flex h-full min-h-[20rem] flex-col gap-3"
              >
                <motion.label
                  custom={{ index: 0, total: 2 }}
                  variants={staggerItemVariants}
                  className="block flex-1"
                >
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--chat-muted)]">
                    Global instructions
                  </span>
                  <textarea
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    rows={10}
                    placeholder="What should XENO know about how you work, and how should it respond?"
                    className={`w-full resize-y border bg-transparent px-3 py-2.5 text-[13px] leading-relaxed text-[var(--chat-text)] outline-none placeholder:text-[var(--chat-muted)] ${RADIUS}`}
                    style={{
                      borderColor: 'var(--chat-border)',
                      backgroundColor: 'var(--chat-surface)',
                      minHeight: '12rem',
                    }}
                  />
                </motion.label>
                <motion.div
                  custom={{ index: 1, total: 2 }}
                  variants={staggerItemVariants}
                  className="flex items-center justify-between gap-3"
                >
                  <p className="text-[11.5px] text-[var(--chat-muted)]">
                    Applies to new chats. Personas can layer a stronger role on
                    top.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleSaveInstructions()}
                    disabled={!dirty || saving}
                    className={`${RADIUS} h-9 flex-shrink-0 px-3 text-[12.5px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40`}
                    style={{
                      backgroundColor: 'var(--chat-control)',
                      color: 'var(--chat-text)',
                    }}
                  >
                    {savedFlash ? 'Saved' : saving ? 'Saving…' : 'Save'}
                  </button>
                </motion.div>
              </SettingsSectionShell>
            ) : section === 'memory' ? (
              <SettingsSectionShell
                key="memory"
                className="flex flex-col gap-4"
              >
                {(() => {
                  const memoryTotal =
                    1 + Math.max(1, memoryEntries.length || 1);
                  return (
                    <>
                      <motion.div
                        custom={{ index: 0, total: memoryTotal }}
                        variants={staggerItemVariants}
                        className={`flex items-center justify-between gap-3 border px-3 py-2.5 ${RADIUS}`}
                        style={{
                          borderColor: 'var(--chat-border)',
                          backgroundColor: 'var(--chat-surface)',
                        }}
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-[var(--chat-text)]">
                            Generate memory from chats
                          </p>
                          <p className="mt-0.5 text-[11.5px] text-[var(--chat-muted)]">
                            Allow XENO to store short facts from conversations.
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={memoryOn}
                          onClick={() => {
                            void (async () => {
                              const next =
                                await setMemoryGenerateFromChats(!memoryOn);
                              setMemoryOn(next.generateFromChats);
                              setMemoryEntries(next.entries);
                            })();
                          }}
                          className={`relative h-5 w-9 flex-shrink-0 border transition-colors ${RADIUS}`}
                          style={{
                            borderColor: 'var(--chat-border)',
                            backgroundColor: memoryOn
                              ? 'var(--chat-control)'
                              : 'var(--chat-canvas)',
                          }}
                        >
                          <span
                            className={`absolute top-0.5 block h-3.5 w-3.5 rounded-[3px] transition-transform ${
                              memoryOn
                                ? 'translate-x-[18px]'
                                : 'translate-x-0.5'
                            }`}
                            style={{ backgroundColor: 'var(--chat-text)' }}
                          />
                        </button>
                      </motion.div>

                      {memoryEntries.length === 0 ? (
                        <motion.p
                          custom={{ index: 1, total: memoryTotal }}
                          variants={staggerItemVariants}
                          className="py-6 text-center text-[12.5px] text-[var(--chat-muted)]"
                        >
                          No memory entries yet
                        </motion.p>
                      ) : (
                        memoryEntries.map((entry, index) => (
                          <motion.div
                            key={entry.id}
                            custom={{
                              index: index + 1,
                              total: memoryTotal,
                            }}
                            variants={staggerItemVariants}
                            className={`overflow-hidden border ${RADIUS}`}
                            style={{ borderColor: 'var(--chat-border)' }}
                          >
                            <div className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                              <p className="min-w-0 flex-1 text-[var(--chat-text)]">
                                {entry.text}
                              </p>
                              <span className="flex-shrink-0 whitespace-nowrap text-[var(--chat-muted)]">
                                {formatUpdated(entry.updatedAt)}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  void (async () => {
                                    const next = await deleteMemoryEntry(
                                      entry.id,
                                    );
                                    setMemoryEntries(next.entries);
                                  })();
                                }}
                                className={`${RADIUS} inline-flex h-7 w-7 flex-shrink-0 items-center justify-center text-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-danger)]`}
                                aria-label="Delete memory entry"
                                title="Delete"
                              >
                                <Trash2 size={13} aria-hidden="true" />
                              </button>
                            </div>
                          </motion.div>
                        ))
                      )}
                    </>
                  );
                })()}
              </SettingsSectionShell>
            ) : section === 'personas' ? (
              <SettingsSectionShell
                key="personas"
                className="flex flex-col gap-3"
              >
                {(() => {
                  const rowCount = Math.max(1, personas.length);
                  const total = 1 + rowCount;
                  return (
                    <>
                      <motion.div
                        custom={{ index: 0, total }}
                        variants={staggerItemVariants}
                        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <p className="text-[12.5px] text-[var(--chat-muted)]">
                          Applies to the open chat (new or existing). Click again
                          to clear. Create/edit personas stay in this library.
                        </p>
                        <label className="relative block w-full sm:w-[12rem]">
                          <span className="sr-only">{searchPlaceholder}</span>
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
                      </motion.div>
                      {personas.length === 0 ? (
                        <motion.p
                          custom={{ index: 1, total }}
                          variants={staggerItemVariants}
                          className="py-8 text-center text-[12.5px] text-[var(--chat-muted)]"
                        >
                          No matching personas
                        </motion.p>
                      ) : (
                        personas.map((persona, index) => {
                          const isActive = activePersonaId === persona.id;
                          return (
                            <motion.div
                              key={persona.id}
                              custom={{ index: index + 1, total }}
                              variants={staggerItemVariants}
                              role="button"
                              tabIndex={0}
                              data-active={isActive ? 'true' : 'false'}
                              onClick={() => void handleSelectPersona(persona)}
                              onKeyDown={(event) => {
                                if (
                                  event.key === 'Enter' ||
                                  event.key === ' '
                                ) {
                                  event.preventDefault();
                                  void handleSelectPersona(persona);
                                }
                              }}
                              className={`chat-global-settings-row cursor-pointer border outline-none ${RADIUS}`}
                              style={{
                                borderColor: 'var(--chat-border)',
                                backgroundColor: isActive
                                  ? 'var(--chat-surface)'
                                  : 'transparent',
                              }}
                            >
                              <div className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                                <span className="min-w-0 flex-1 font-medium text-[var(--chat-text)]">
                                  {persona.label}
                                  <span className="mt-0.5 block truncate text-[11px] font-normal text-[var(--chat-muted)] sm:hidden">
                                    {persona.summary}
                                  </span>
                                </span>
                                <span className="hidden max-w-[12rem] flex-1 truncate text-[var(--chat-muted)] sm:block">
                                  {persona.summary}
                                </span>
                                <span className="flex-shrink-0 whitespace-nowrap text-[var(--chat-muted)]">
                                  {formatUpdated(persona.updatedAt)}
                                </span>
                                <span className="w-6 flex-shrink-0 text-right">
                                  {isActive ? (
                                    <Check
                                      size={14}
                                      className="ml-auto text-[var(--chat-accent)]"
                                      aria-label="Active"
                                    />
                                  ) : (
                                    <span className="text-[var(--chat-muted)]">
                                      —
                                    </span>
                                  )}
                                </span>
                              </div>
                            </motion.div>
                          );
                        })
                      )}
                    </>
                  );
                })()}
              </SettingsSectionShell>
            ) : section === 'connectors' ? (
              <SettingsSectionShell
                key="connectors"
                className="flex flex-col gap-3"
              >
                {(() => {
                  const rowCount = Math.max(1, connectors.length);
                  const total = 1 + rowCount;
                  return (
                    <>
                      <motion.div
                        custom={{ index: 0, total }}
                        variants={staggerItemVariants}
                        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <p className="text-[12.5px] text-[var(--chat-muted)]">
                          Link external services (mock connect/disconnect).
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex gap-0.5">
                            {(
                              [
                                ['all', 'All'],
                                ['connected', 'Connected'],
                                ['not_connected', 'Not connected'],
                              ] as const
                            ).map(([id, label]) => {
                              const active = connectorFilter === id;
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => setConnectorFilter(id)}
                                  className={`${RADIUS} px-2 py-1 text-[11.5px] transition-colors`}
                                  style={{
                                    backgroundColor: active
                                      ? 'var(--chat-control)'
                                      : 'transparent',
                                    color: active
                                      ? 'var(--chat-text)'
                                      : 'var(--chat-muted)',
                                  }}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                          <label className="relative block w-full sm:w-[12rem]">
                            <span className="sr-only">{searchPlaceholder}</span>
                            <Search
                              size={14}
                              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--chat-muted)]"
                              aria-hidden="true"
                            />
                            <input
                              type="search"
                              value={query}
                              onChange={(event) =>
                                setQuery(event.target.value)
                              }
                              placeholder="Search"
                              className={`h-9 w-full border bg-transparent pl-8 pr-3 text-[12.5px] text-[var(--chat-text)] outline-none placeholder:text-[var(--chat-muted)] ${RADIUS}`}
                              style={{ borderColor: 'var(--chat-border)' }}
                            />
                          </label>
                        </div>
                      </motion.div>
                      {connectors.length === 0 ? (
                        <motion.p
                          custom={{ index: 1, total }}
                          variants={staggerItemVariants}
                          className="py-8 text-center text-[12.5px] text-[var(--chat-muted)]"
                        >
                          No matching connectors
                        </motion.p>
                      ) : (
                        connectors.map((connector, index) => {
                          const connected =
                            connector.status === 'connected';
                          return (
                            <motion.div
                              key={connector.id}
                              custom={{ index: index + 1, total }}
                              variants={staggerItemVariants}
                              className={`chat-global-settings-row border ${RADIUS}`}
                              style={{ borderColor: 'var(--chat-border)' }}
                            >
                              <div className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                                <span className="min-w-0 flex-1 font-medium text-[var(--chat-text)]">
                                  {connector.name}
                                </span>
                                <span className="flex-shrink-0 text-[var(--chat-muted)]">
                                  {connector.type}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void (async () => {
                                      await setConnectorStatus(
                                        connector.id,
                                        connected
                                          ? 'not_connected'
                                          : 'connected',
                                      );
                                      setConnectors(
                                        await listConnectors({
                                          query,
                                          status: connectorFilter,
                                        }),
                                      );
                                    })();
                                  }}
                                  className={`${RADIUS} flex-shrink-0 px-2 py-1 text-[11.5px] font-medium`}
                                  style={{
                                    backgroundColor: 'var(--chat-control)',
                                    color: 'var(--chat-text)',
                                  }}
                                >
                                  {connected ? 'Disconnect' : 'Connect'}
                                </button>
                              </div>
                            </motion.div>
                          );
                        })
                      )}
                    </>
                  );
                })()}
              </SettingsSectionShell>
            ) : (
              <SettingsSectionShell
                key="plugins"
                className="flex flex-col gap-3"
              >
                {(() => {
                  const rowCount = Math.max(1, plugins.length);
                  const total = 1 + rowCount;
                  return (
                    <>
                      <motion.div
                        custom={{ index: 0, total }}
                        variants={staggerItemVariants}
                        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <p className="text-[12.5px] text-[var(--chat-muted)]">
                          Install packs of skills and connectors.
                        </p>
                        <label className="relative block w-full sm:w-[12rem]">
                          <span className="sr-only">{searchPlaceholder}</span>
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
                      </motion.div>
                      {plugins.length === 0 ? (
                        <motion.p
                          custom={{ index: 1, total }}
                          variants={staggerItemVariants}
                          className="py-8 text-center text-[12.5px] text-[var(--chat-muted)]"
                        >
                          No matching plugins
                        </motion.p>
                      ) : (
                        plugins.map((plugin, index) => (
                          <motion.div
                            key={plugin.id}
                            custom={{ index: index + 1, total }}
                            variants={staggerItemVariants}
                            className={`chat-global-settings-row border ${RADIUS}`}
                            style={{ borderColor: 'var(--chat-border)' }}
                          >
                            <div className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                              <span className="min-w-0 flex-1">
                                <span className="block font-medium text-[var(--chat-text)]">
                                  {plugin.name}
                                </span>
                                <span className="mt-0.5 block text-[11px] text-[var(--chat-muted)]">
                                  {plugin.summary}
                                </span>
                              </span>
                              <span className="hidden flex-shrink-0 whitespace-nowrap text-[var(--chat-muted)] sm:block">
                                {plugin.author}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  void (async () => {
                                    await setPluginInstalled(
                                      plugin.id,
                                      !plugin.installed,
                                    );
                                    setPlugins(await listPlugins({ query }));
                                  })();
                                }}
                                className={`${RADIUS} flex-shrink-0 px-2 py-1 text-[11.5px] font-medium`}
                                style={{
                                  backgroundColor: 'var(--chat-control)',
                                  color: 'var(--chat-text)',
                                }}
                              >
                                {plugin.installed ? 'Remove' : 'Install'}
                              </button>
                            </div>
                          </motion.div>
                        ))
                      )}
                    </>
                  );
                })()}
              </SettingsSectionShell>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default ChatGlobalSettingsPage;
