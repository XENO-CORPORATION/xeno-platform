import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, Clock, Pause, Play, Search, Trash2 } from 'lucide-react';
import {
  SCHEDULED_STATUS_LABEL,
  createScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
  setScheduledTaskStatus,
  type ChatScheduledTask,
  type ScheduledStatus,
} from './chatScheduled';
import {
  buildSettingsStaggerItemVariants,
  settingsSectionOrchestratorVariants,
} from './chatSettingsStagger';

type ScheduledSort = 'next' | 'updated' | 'name';
type StatusFilter = ScheduledStatus | 'all';

export type ChatScheduledPageProps = {
  /** Left offset when history sidebar is open (same as Projects / Artifacts). */
  pageLeft: number;
  onClose: () => void;
};

const SORT_LABELS: Record<ScheduledSort, string> = {
  next: 'Next run',
  updated: 'Last updated',
  name: 'Name',
};

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
];

/** Small corner radius — square XENO chrome, not pill cards. */
const RADIUS = 'rounded-[6px]';

const formatNextRun = (ts: number): string => {
  const diff = ts - Date.now();
  if (diff < 0) return 'Overdue';
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  if (diff < hour) return '< 1h';
  if (diff < day) {
    const hours = Math.max(1, Math.round(diff / hour));
    return `in ${hours}h`;
  }
  const days = Math.round(diff / day);
  if (days === 1) return 'Tomorrow';
  if (days < 14) return `in ${days}d`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

/**
 * Full-page Scheduled hub — dense table (not Artifacts cards, not ChatGPT suggestions).
 * Data only through chatScheduled.ts so the backend can swap in later.
 */
const ChatScheduledPage: React.FC<ChatScheduledPageProps> = ({ pageLeft, onClose }) => {
  const [rows, setRows] = useState<ChatScheduledTask[]>([]);
  /** Filter key currently shown — updates with rows so stagger waits for fetch. */
  const [listKey, setListKey] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ScheduledSort>('next');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const reduceMotion = useReducedMotion() ?? false;
  const staggerItemVariants = buildSettingsStaggerItemVariants(reduceMotion);

  const refresh = async () => {
    // Swap key + rows together after fetch so exit/enter stagger matches the new filter.
    const next = await listScheduledTasks({ query, status, sort });
    setRows(next);
    setListKey(status);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status, sort]);

  useEffect(() => {
    if (!isSortOpen) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-scheduled-sort-menu]')) return;
      setIsSortOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [isSortOpen]);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  useEffect(() => {
    if (selectedId && !rows.some((row) => row.id === selectedId)) {
      setSelectedId(null);
    }
  }, [rows, selectedId]);

  const handleCreate = async () => {
    const text = draft.trim();
    if (!text || creating) return;
    setCreating(true);
    try {
      const title =
        text.length > 48 ? `${text.slice(0, 45).trimEnd()}…` : text;
      await createScheduledTask({
        title,
        prompt: text,
        cadence: 'daily',
        cadenceLabel: 'Daily · 09:00',
      });
      setDraft('');
      setStatus('all');
      await refresh();
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (task: ChatScheduledTask) => {
    const next: ScheduledStatus = task.status === 'active' ? 'paused' : 'active';
    await setScheduledTaskStatus(task.id, next);
    await refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteScheduledTask(id);
    if (selectedId === id) setSelectedId(null);
    await refresh();
  };

  const toggleSelected = (id: string) => {
    setSelectedId((current) => (current === id ? null : id));
  };

  return (
    <div
      className="absolute inset-0 z-[45] flex flex-col main-content-transition"
      style={{
        left: pageLeft,
        backgroundColor: 'var(--chat-canvas)',
        color: 'var(--chat-text)',
      }}
      role="dialog"
      aria-label="Scheduled"
    >
      <style>{`
        .chat-scheduled-row {
          transition: background-color 140ms ease;
        }
        .chat-scheduled-row:hover,
        .chat-scheduled-row[data-selected='true'] {
          background-color: var(--chat-elevated);
        }
        .chat-scheduled-action {
          transition: transform 160ms ease, background-color 160ms ease, color 160ms ease;
        }
        .chat-scheduled-action:active {
          transform: scale(0.96);
        }
      `}</style>

      <div className="mx-auto flex h-full w-full max-w-[56rem] flex-col px-4 sm:px-6">
        <div className="flex min-h-[2.75rem] flex-shrink-0 items-center justify-between gap-3 pt-6 pb-4 md:min-h-[3rem] md:pt-8 md:pb-5">
          <div className="relative" data-scheduled-sort-menu="">
            <button
              type="button"
              onClick={() => setIsSortOpen((open) => !open)}
              className={`group relative flex items-center overflow-hidden ${RADIUS} py-1.5 pr-3 pl-3 text-[12.5px] hover:pl-8`}
              style={{
                backgroundColor: 'var(--chat-control)',
                color: 'var(--chat-text)',
                willChange: 'padding',
                transition: 'padding 600ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
              aria-haspopup="menu"
              aria-expanded={isSortOpen}
              aria-label={`Sort by ${SORT_LABELS[sort]}`}
            >
              <ChevronDown
                size={13}
                className="pointer-events-none absolute left-2.5 z-0 translate-x-5 text-[var(--chat-muted)] opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                style={{
                  willChange: 'opacity, transform',
                  transition:
                    'opacity 600ms cubic-bezier(0.22, 1, 0.36, 1), transform 600ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}
                aria-hidden="true"
              />
              <span
                className="relative z-10 pl-0.5 font-medium text-[var(--chat-text)]"
                style={{ backgroundColor: 'var(--chat-control)' }}
              >
                {SORT_LABELS[sort]}
              </span>
            </button>
            {isSortOpen && (
              <div
                role="menu"
                className={`chat-history-popover absolute left-0 top-full z-10 mt-1.5 min-w-full w-max overflow-hidden ${RADIUS} border p-1`}
                style={{
                  backgroundColor: 'var(--chat-elevated)',
                  borderColor: 'var(--chat-border)',
                  boxShadow:
                    '0 12px 28px -8px color-mix(in srgb, var(--chat-text) 18%, transparent)',
                }}
              >
                {(Object.keys(SORT_LABELS) as ScheduledSort[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSort(value);
                      setIsSortOpen(false);
                    }}
                    className={`flex w-full items-center ${RADIUS} px-2.5 py-1.5 text-left text-[12.5px] text-[var(--chat-text)] transition-colors hover:bg-[var(--chat-hover)]`}
                  >
                    <span>{SORT_LABELS[value]}</span>
                    {sort === value && (
                      <Check
                        size={13}
                        className="ml-auto text-[var(--chat-accent)]"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className={`${RADIUS} px-3 py-1.5 text-[12.5px] text-[var(--chat-muted)] transition-colors hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)]`}
          >
            Close
          </button>
        </div>

        <div className="mb-4 flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <Clock
              size={18}
              className="flex-shrink-0 text-[var(--chat-muted)]"
              aria-hidden="true"
            />
            <h2 className="flex-shrink-0 font-display text-[1.15rem] font-medium tracking-tight text-[var(--chat-text)]">
              Scheduled
            </h2>
            <span
              className="h-4 w-px flex-shrink-0"
              style={{ backgroundColor: 'var(--chat-border)' }}
              aria-hidden="true"
            />
            <p className="min-w-0 truncate text-[12.5px] text-[var(--chat-muted)]">
              Time-based runs — managed as a table, not a card gallery.
            </p>
          </div>
          <label className="relative block w-full sm:max-w-[14rem]">
            <span className="sr-only">Search scheduled tasks</span>
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
        </div>

        <div className="mb-3 flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleCreate();
                }
              }}
              placeholder="New task…"
              className={`h-9 min-w-0 flex-1 border bg-transparent px-2.5 text-[12.5px] text-[var(--chat-text)] outline-none placeholder:text-[var(--chat-muted)] ${RADIUS}`}
              style={{ borderColor: 'var(--chat-border)' }}
              aria-label="New scheduled task"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!draft.trim() || creating}
              className={`${RADIUS} h-9 flex-shrink-0 px-3 text-[12.5px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40`}
              style={{
                backgroundColor: 'var(--chat-control)',
                color: 'var(--chat-text)',
              }}
            >
              {creating ? 'Adding…' : 'Add'}
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((filter) => {
              const active = status === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setStatus(filter.id)}
                  className={`${RADIUS} px-2.5 py-1 text-[12px] transition-colors`}
                  style={{
                    backgroundColor: active ? 'var(--chat-control)' : 'transparent',
                    color: active ? 'var(--chat-text)' : 'var(--chat-muted)',
                  }}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto pb-8 hide-scrollbar">
          <AnimatePresence mode="wait" initial={false}>
            {loading ? (
              <motion.p
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="px-1 py-8 text-[12.5px] text-[var(--chat-muted)]"
              >
                Loading…
              </motion.p>
            ) : (
              <motion.div
                key={listKey}
                className="flex flex-col gap-2"
                variants={settingsSectionOrchestratorVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
              >
                {rows.length === 0 ? (
                  <motion.div
                    custom={{ index: 0, total: 1 }}
                    variants={staggerItemVariants}
                    className="px-1 py-10 text-center"
                  >
                    <p className="text-[13px] font-medium text-[var(--chat-text)]">
                      No scheduled tasks
                    </p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--chat-muted)]">
                      Add a task above. Runs and notifications land here when the
                      scheduler is live.
                    </p>
                  </motion.div>
                ) : (
                  rows.map((task, index) => {
                    const isSelected = selectedId === task.id;
                    const isActive = task.status === 'active';
                    const total = rows.length;
                    return (
                      <motion.div
                        key={task.id}
                        custom={{ index, total }}
                        variants={staggerItemVariants}
                        role="button"
                        tabIndex={0}
                        data-selected={isSelected ? 'true' : 'false'}
                        onClick={() => toggleSelected(task.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleSelected(task.id);
                          }
                        }}
                        className={`chat-scheduled-row cursor-pointer border outline-none ${RADIUS}`}
                        style={{
                          borderColor: 'var(--chat-border)',
                          backgroundColor: isSelected
                            ? 'var(--chat-elevated)'
                            : 'transparent',
                        }}
                      >
                        <div className="flex items-center gap-3 px-3 py-2.5 text-[12.5px]">
                          <span
                            className={`inline-block flex-shrink-0 px-1.5 py-0.5 text-[10.5px] font-medium ${RADIUS}`}
                            style={{
                              backgroundColor: 'var(--chat-canvas)',
                              color: isActive
                                ? 'var(--chat-text)'
                                : 'var(--chat-muted)',
                              border: '1px solid var(--chat-border)',
                            }}
                          >
                            {SCHEDULED_STATUS_LABEL[task.status]}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium text-[var(--chat-text)]">
                            {task.title}
                          </span>
                          <span className="hidden flex-shrink-0 whitespace-nowrap text-[var(--chat-muted)] sm:block">
                            {task.cadenceLabel}
                          </span>
                          <span className="flex-shrink-0 whitespace-nowrap text-[var(--chat-muted)]">
                            {formatNextRun(task.nextRunAt)}
                          </span>
                          <div className="flex flex-shrink-0 items-center justify-end gap-0.5">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleToggleStatus(task);
                              }}
                              className={`chat-scheduled-action flex h-7 w-7 items-center justify-center text-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)] ${RADIUS}`}
                              aria-label={
                                isActive
                                  ? `Pause ${task.title}`
                                  : `Resume ${task.title}`
                              }
                              title={isActive ? 'Pause' : 'Resume'}
                            >
                              {isActive ? (
                                <Pause size={13} aria-hidden="true" />
                              ) : (
                                <Play size={13} aria-hidden="true" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleDelete(task.id);
                              }}
                              className={`chat-scheduled-action flex h-7 w-7 items-center justify-center text-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-danger)] ${RADIUS}`}
                              aria-label={`Delete ${task.title}`}
                              title="Delete"
                            >
                              <Trash2 size={13} aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                )}

                {selected && (
                  <motion.div
                    custom={{
                      index: Math.max(0, rows.length),
                      total: Math.max(1, rows.length + 1),
                    }}
                    variants={staggerItemVariants}
                    className="mt-1 border-t pt-3"
                    style={{ borderColor: 'var(--chat-border)' }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-[var(--chat-text)]">
                          {selected.title}
                        </p>
                        <p className="mt-1 text-[11.5px] text-[var(--chat-muted)]">
                          <span className="font-mono">{selected.id}</span>
                          <span className="mx-1.5">·</span>
                          {selected.cadenceLabel}
                        </p>
                        <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--chat-muted)]">
                          {selected.prompt}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDelete(selected.id)}
                        className={`${RADIUS} flex-shrink-0 px-2.5 py-1 text-[12px] text-[var(--chat-danger)] transition-colors hover:bg-[var(--chat-hover)]`}
                      >
                        Delete
                      </button>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default ChatScheduledPage;
