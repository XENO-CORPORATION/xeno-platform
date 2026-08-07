/**
 * Chat Scheduled tasks contract.
 *
 * UI calls these functions only. Today they are in-memory mocks; a real backend
 * (cron/worker + notifications) replaces the bodies without changing ChatScheduledPage.
 */

export type ScheduledStatus = 'active' | 'paused';

export type ScheduledCadence = 'once' | 'daily' | 'weekly' | 'monthly';

export type ChatScheduledTask = {
  id: string;
  title: string;
  /** Instruction the model will run when the task fires. */
  prompt: string;
  cadence: ScheduledCadence;
  /** Human-readable schedule line for list cards. */
  cadenceLabel: string;
  status: ScheduledStatus;
  nextRunAt: number;
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ListScheduledInput = {
  query?: string;
  status?: ScheduledStatus | 'all';
  sort?: 'next' | 'updated' | 'name';
};

export type CreateScheduledInput = {
  title: string;
  prompt: string;
  cadence?: ScheduledCadence;
  cadenceLabel?: string;
};

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const now = Date.now();

/** Seed store — session-level until backend persists. */
let scheduledStore: ChatScheduledTask[] = [];

const matchesQuery = (task: ChatScheduledTask, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    task.title.toLowerCase().includes(q) ||
    task.prompt.toLowerCase().includes(q) ||
    task.cadenceLabel.toLowerCase().includes(q)
  );
};

const randomId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `sched-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  }
  return `sched-${Date.now().toString(36)}`;
};

/**
 * Lists scheduled tasks for the library page.
 * Mock: filter + sort in memory. Backend: GET /api/chat/scheduled?...
 */
export const listScheduledTasks = async (
  input: ListScheduledInput = {},
): Promise<ChatScheduledTask[]> => {
  const status = input.status ?? 'all';
  const sort = input.sort ?? 'next';
  const query = input.query ?? '';

  let rows = scheduledStore.filter((task) => {
    if (status !== 'all' && task.status !== status) return false;
    return matchesQuery(task, query);
  });

  rows = [...rows].sort((a, b) => {
    if (sort === 'name') return a.title.localeCompare(b.title);
    if (sort === 'updated') return b.updatedAt - a.updatedAt;
    return a.nextRunAt - b.nextRunAt;
  });

  return rows;
};

export const getScheduledTask = async (
  id: string,
): Promise<ChatScheduledTask | null> =>
  scheduledStore.find((task) => task.id === id) ?? null;

/** Mock create — UI can call this; wire to POST later. */
export const createScheduledTask = async (
  input: CreateScheduledInput,
): Promise<ChatScheduledTask> => {
  const stamp = Date.now();
  const task: ChatScheduledTask = {
    id: randomId(),
    title: input.title.trim() || 'Untitled task',
    prompt: input.prompt.trim(),
    cadence: input.cadence ?? 'daily',
    cadenceLabel: input.cadenceLabel ?? 'Daily · 09:00',
    status: 'active',
    nextRunAt: stamp + day,
    lastRunAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  scheduledStore = [task, ...scheduledStore];
  return task;
};

export const setScheduledTaskStatus = async (
  id: string,
  status: ScheduledStatus,
): Promise<ChatScheduledTask | null> => {
  const stamp = Date.now();
  let updated: ChatScheduledTask | null = null;
  scheduledStore = scheduledStore.map((task) => {
    if (task.id !== id) return task;
    updated = { ...task, status, updatedAt: stamp };
    return updated;
  });
  return updated;
};

export const deleteScheduledTask = async (id: string): Promise<void> => {
  scheduledStore = scheduledStore.filter((task) => task.id !== id);
};

export const SCHEDULED_STATUS_LABEL: Record<ScheduledStatus, string> = {
  active: 'Active',
  paused: 'Paused',
};
