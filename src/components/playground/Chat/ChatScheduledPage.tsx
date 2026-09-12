import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button, IconButton, MenuItem, TextInput, useGooPill, useMenu } from '@xenosystem/elements-react';
import { Clock, Pause, Trash2Decl, SearchDecl, ChevronDownDecl, PauseDecl, PlayDecl } from '@/lib/icons';
import {
  SCHEDULED_STATUS_LABEL,
  createScheduledTask,
  deleteScheduledTask,
  listScheduledRuns,
  listScheduledTasks,
  setScheduledTaskStatus,
  type ChatScheduledRun,
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

const formatRunTimestamp = (value: number | null): string =>
  value ? new Date(value).toLocaleString() : '—';

const detectedTimezone = (): string => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
};

const nextDailyNine = () => {
  const next = new Date();
  next.setHours(9, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    timestamp: next.getTime(),
    local: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T09:00:00`,
  };
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
  /* The sort menu here is the same shape as every menu in ChatWithLLM — `chat-history-popover`,
     p-1, buttons with `menuitem` — and was the only one still painting its own hover background
     instead of letting the pill travel. `.chat-goo` is declared in the chat shell, which is this
     page's parent, so the class is already in scope. */
  /* One ref for both: the pill measures the rows against this panel and the keyboard moves focus
     inside it. See ChatWithLLM for the same pairing across nine menus. */
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const sortGoo = useGooPill<HTMLDivElement>({ hostRef: sortMenuRef });
  const sortMenuKbd = useMenu<HTMLDivElement>({
    open: isSortOpen,
    onClose: () => setIsSortOpen(false),
    menuRef: sortMenuRef,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRuns, setSelectedRuns] = useState<ChatScheduledRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [timezone, setTimezone] = useState(() => detectedTimezone());
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion() ?? false;
  const staggerItemVariants = buildSettingsStaggerItemVariants(reduceMotion);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      // Swap key + rows together after fetch so exit/enter stagger matches the new filter.
      const next = await listScheduledTasks({ query, status, sort });
      setRows(next);
      setListKey(status);
    } catch (cause) {
      console.error('[ChatScheduledPage] Failed to load scheduled tasks:', cause);
      setRows([]);
      setError('Scheduled tasks could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
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

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) {
      setSelectedRuns([]);
      setRunsError(null);
      return;
    }
    setRunsLoading(true);
    setRunsError(null);
    void listScheduledRuns(selectedId)
      .then((runs) => {
        if (!cancelled) setSelectedRuns(runs);
      })
      .catch((cause) => {
        console.error('[ChatScheduledPage] Failed to load run history:', cause);
        if (!cancelled) {
          setSelectedRuns([]);
          setRunsError('Run history could not be loaded.');
        }
      })
      .finally(() => {
        if (!cancelled) setRunsLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedId]);

  const handleCreate = async () => {
    const text = draft.trim();
    if (!text || !timezone.trim() || creating) return;
    setCreating(true);
    try {
      const title =
        text.length > 48 ? `${text.slice(0, 45).trimEnd()}…` : text;
      const firstRun = nextDailyNine();
      await createScheduledTask({
        title,
        prompt: text,
        cadence: 'daily',
        cadenceLabel: 'Daily · 09:00',
        nextRunAt: firstRun.timestamp,
        scheduleKind: 'recurring',
        timezone: timezone.trim(),
        dtstartLocal: firstRun.local,
        rrule: 'FREQ=DAILY',
      });
      setDraft('');
      setStatus('all');
      await refresh();
    } catch (cause) {
      console.error('[ChatScheduledPage] Failed to create scheduled task:', cause);
      setError('The scheduled task could not be saved.');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (task: ChatScheduledTask) => {
    try {
      const next: ScheduledStatus = task.status === 'active' ? 'paused' : 'active';
      await setScheduledTaskStatus(task.id, next);
      await refresh();
    } catch (cause) {
      console.error('[ChatScheduledPage] Failed to update scheduled task:', cause);
      setError('The scheduled task could not be updated.');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteScheduledTask(id);
      if (selectedId === id) setSelectedId(null);
      await refresh();
    } catch (cause) {
      console.error('[ChatScheduledPage] Failed to delete scheduled task:', cause);
      setError('The scheduled task could not be deleted.');
    }
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
            {/* The artifacts page's sort trigger, and it converts the same way now that `iconReveal`
                exists. Two pages carrying the same unconvertible control was the argument for
                answering it once in the library rather than commenting it a third time. */}
            <Button
              variant="secondary"
              size="sm"
              iconSize={13}
              iconReveal
              leadingIcon={ChevronDownDecl}
              onClick={() => setIsSortOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={isSortOpen}
              aria-label={`Sort by ${SORT_LABELS[sort]}`}
            >
              {SORT_LABELS[sort]}
            </Button>
            {isSortOpen && (
              <div
                {...(() => { const { ref: _g, className: _c, ...handlers } = sortGoo.hostProps; return handlers; })()}
                {...sortMenuKbd.menuProps}
                className={`${sortGoo.hostProps.className} chat-goo chat-history-popover absolute left-0 top-full z-10 mt-1.5 min-w-full w-max overflow-hidden ${RADIUS} border p-1`}
                style={{
                  backgroundColor: 'var(--chat-elevated)',
                  borderColor: 'var(--chat-border)',
                  boxShadow:
                    '0 12px 28px -8px color-mix(in srgb, var(--chat-text) 18%, transparent)',
                }}
              >
                {/* First child, so the pill paints behind the rows rather than over them. */}
                {sortGoo.pill}
                {(Object.keys(SORT_LABELS) as ScheduledSort[]).map((value) => (
                  <MenuItem
                    key={value}
                    selected={sort === value}
                    onSelect={() => setSort(value)}
                  >
                    {SORT_LABELS[value]}
                  </MenuItem>
                ))}
              </div>
            )}
          </div>

          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
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
          <TextInput
            leadingIcon={SearchDecl}
            size="lg"
            type="search"
            className="w-full sm:max-w-[14rem]"
            aria-label="Search scheduled tasks"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
          />
        </div>

        <div className="mb-3 flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {/* `TextInput lg`. The box matches on every count that has a token: 36px is lg, the
                component's `--xeno-radius-md` is 6px which is this page's RADIUS, and the border and
                focus ring come from the same `--chat-border` / `--chat-muted` pair this wrote by
                hand. The fill goes from `bg-transparent` to the component's `--xeno-canvas`, which on
                this page IS what was showing through.
                The type does not move. `.xeno-input` sets no font-size and `.xeno-input-field` is
                `font: inherit`, so a field takes the type of the place it sits in — worth knowing,
                because §7 warned about that for Textarea and it is not true of this one.
                `className` lands on the WRAPPER, which is the box that has to flex. */}
            <TextInput
              size="lg"
              type="text"
              className="min-w-0 flex-1"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleCreate();
                }
              }}
              placeholder="New task…"
              aria-label="New scheduled task"
            />
            <TextInput
              size="lg"
              type="text"
              className="w-full sm:w-[10rem]"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="Europe/Berlin"
              aria-label="Schedule timezone"
              title="Daily at 09:00 in this IANA timezone"
            />
            {/* The global settings page's Save, down to the class string: a `--chat-control` fill
                with full text ink is `secondary` minus its hairline, and `h-9` is `lg`. It gains the
                hairline, which is what gives its edge something to hold against the field beside it.
                Disabled becomes the availability axis instead of three utility classes. */}
            <Button
              variant="secondary"
              size="lg"
              className="flex-shrink-0"
              onClick={() => void handleCreate()}
              disabled={!draft.trim() || !timezone.trim() || creating}
            >
              {creating ? 'Adding…' : 'Add'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((filter) => {
              const active = status === filter.id;
              return (
                // The artifacts page's kind filters, byte for byte. `quiet` holds both states and
                // `data-selection` says which; an inactive chip picks up the hairline that gives the
                // row its shape between selections.
                <Button
                  key={filter.id}
                  variant="quiet"
                  size="xs"
                  data-selection={active ? 'on' : 'off'}
                  aria-pressed={active}
                  onClick={() => setStatus(filter.id)}
                >
                  {filter.label}
                </Button>
              );
            })}
          </div>
        </div>

        {error && (
          <div
            className="mb-3 rounded-[6px] border px-3 py-2 text-[12px]"
            style={{ borderColor: 'var(--chat-danger)', color: 'var(--chat-danger)' }}
            role="alert"
          >
            {error}
          </div>
        )}

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
                            <IconButton
                              icon={isActive ? PauseDecl : PlayDecl}
                              variant="ghost"
                              size="sm"
                              iconSize={13}
                              className="chat-scheduled-action flex-shrink-0"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleToggleStatus(task);
                              }}
                              aria-label={
                                isActive
                                  ? `Pause ${task.title}`
                                  : `Resume ${task.title}`
                              }
                              title={isActive ? 'Pause' : 'Resume'}
                            />
                            <IconButton
                              icon={Trash2Decl}
                              variant="ghost"
                              size="sm"
                              iconSize={13}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleDelete(task.id);
                              }}
                              aria-label={`Delete ${task.title}`}
                              title="Delete"
                            />
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
                      {/* `danger`, per §3.2, and the same rest-state change the artifacts page's
                          Delete took: red on the card becomes muted behind a hairline until you
                          reach for it, and then the word and its outline both go red. */}
                      <Button
                        variant="danger"
                        size="xs"
                        className="flex-shrink-0"
                        onClick={() => void handleDelete(selected.id)}
                      >
                        Delete
                      </Button>
                    </div>
                    <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--chat-border)' }}>
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--chat-muted)]">
                        Run history
                      </h3>
                      {runsLoading ? (
                        <p className="mt-2 text-[12px] text-[var(--chat-muted)]">Loading runs…</p>
                      ) : runsError ? (
                        <p className="mt-2 text-[12px] text-[var(--chat-danger)]" role="alert">{runsError}</p>
                      ) : selectedRuns.length === 0 ? (
                        <p className="mt-2 text-[12px] text-[var(--chat-muted)]">No runs yet.</p>
                      ) : (
                        <div className="mt-2 overflow-x-auto rounded-[6px] border" style={{ borderColor: 'var(--chat-border)' }}>
                          <table className="w-full min-w-[46rem] border-collapse text-left text-[11.5px]">
                            <thead className="text-[10px] uppercase tracking-wide text-[var(--chat-muted)]">
                              <tr>
                                {['Scheduled', 'State', 'Attempts', 'Model', 'Started', 'Completed', 'Result / error'].map((label) => (
                                  <th key={label} className="border-b px-2 py-2 font-medium" style={{ borderColor: 'var(--chat-border)' }}>{label}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {selectedRuns.map((run) => (
                                <tr key={run.id} className="align-top text-[var(--chat-text)]">
                                  <td className="px-2 py-2 whitespace-nowrap">{formatRunTimestamp(run.scheduledFor)}</td>
                                  <td className="px-2 py-2 font-medium">{run.status}</td>
                                  <td className="px-2 py-2">{run.attemptCount}</td>
                                  <td className="px-2 py-2 font-mono">{run.modelId || '—'}</td>
                                  <td className="px-2 py-2 whitespace-nowrap">{formatRunTimestamp(run.startedAt)}</td>
                                  <td className="px-2 py-2 whitespace-nowrap">{formatRunTimestamp(run.completedAt)}</td>
                                  <td className="max-w-[18rem] px-2 py-2">
                                    {run.conversationId ? (
                                      <span className="font-mono">conversation:{run.conversationId}</span>
                                    ) : run.errorCode || run.errorMessage ? (
                                      <span title={run.errorMessage || undefined} className="text-[var(--chat-danger)]">
                                        {[run.errorCode, run.errorMessage].filter(Boolean).join(' — ')}
                                      </span>
                                    ) : run.providerRequestId ? (
                                      <span className="font-mono">provider:{run.providerRequestId}</span>
                                    ) : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
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
