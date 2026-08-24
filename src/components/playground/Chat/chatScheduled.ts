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

import { chatService } from '@/services/chatService';

/** Seed store — session-level fallback until backend persists. */
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
 * Fetches from backend GET /api/chat/scheduled when authenticated, with local cache fallback.
 */
export const listScheduledTasks = async (
  input: ListScheduledInput = {},
): Promise<ChatScheduledTask[]> => {
  try {
    if (chatService.isAuthenticated()) {
      const serverTasks = await chatService.getScheduledTasks({
        status: input.status,
        sort: input.sort,
        query: input.query,
      });

      if (Array.isArray(serverTasks)) {
        const mapped: ChatScheduledTask[] = serverTasks.map((row) => ({
          id: row.id,
          title: row.title,
          prompt: row.prompt,
          cadence: row.cadence as ScheduledCadence,
          cadenceLabel: row.cadence_label || row.cadence,
          status: row.status as ScheduledStatus,
          nextRunAt: row.next_run_at ? new Date(row.next_run_at).getTime() : Date.now() + day,
          lastRunAt: row.last_run_at ? new Date(row.last_run_at).getTime() : null,
          createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
          updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
        }));
        const existingIds = new Set(mapped.map((t) => t.id));
        scheduledStore = [...mapped, ...scheduledStore.filter((t) => !existingIds.has(t.id))];
        return mapped;
      }
    }
  } catch (err) {
    console.warn('[chatScheduled] Failed to list scheduled tasks from backend:', err);
  }

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
): Promise<ChatScheduledTask | null> => {
  return scheduledStore.find((task) => task.id === id) ?? null;
};

/** Create scheduled task in database and local cache. */
export const createScheduledTask = async (
  input: CreateScheduledInput,
): Promise<ChatScheduledTask> => {
  const stamp = Date.now();

  try {
    if (chatService.isAuthenticated()) {
      const serverTask = await chatService.createScheduledTask({
        title: input.title.trim() || 'Untitled task',
        prompt: input.prompt.trim(),
        cadence: input.cadence ?? 'daily',
        cadence_label: input.cadenceLabel ?? 'Daily · 09:00',
      });

      if (serverTask) {
        const task: ChatScheduledTask = {
          id: serverTask.id,
          title: serverTask.title,
          prompt: serverTask.prompt,
          cadence: serverTask.cadence as ScheduledCadence,
          cadenceLabel: serverTask.cadence_label,
          status: serverTask.status as ScheduledStatus,
          nextRunAt: serverTask.next_run_at ? new Date(serverTask.next_run_at).getTime() : stamp + day,
          lastRunAt: serverTask.last_run_at ? new Date(serverTask.last_run_at).getTime() : null,
          createdAt: serverTask.created_at ? new Date(serverTask.created_at).getTime() : stamp,
          updatedAt: serverTask.updated_at ? new Date(serverTask.updated_at).getTime() : stamp,
        };
        scheduledStore = [task, ...scheduledStore];
        return task;
      }
    }
  } catch (err) {
    console.warn('[chatScheduled] Failed to create scheduled task on backend:', err);
  }

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
  try {
    if (chatService.isAuthenticated()) {
      await chatService.updateScheduledTask(id, { status });
    }
  } catch (err) {
    console.warn('[chatScheduled] Failed to update task status on backend:', err);
  }

  let updated: ChatScheduledTask | null = null;
  scheduledStore = scheduledStore.map((task) => {
    if (task.id !== id) return task;
    updated = { ...task, status, updatedAt: stamp };
    return updated;
  });
  return updated;
};

export const deleteScheduledTask = async (id: string): Promise<void> => {
  try {
    if (chatService.isAuthenticated()) {
      await chatService.deleteScheduledTask(id);
    }
  } catch (err) {
    console.warn('[chatScheduled] Failed to delete scheduled task on backend:', err);
  }
  scheduledStore = scheduledStore.filter((task) => task.id !== id);
};

export const SCHEDULED_STATUS_LABEL: Record<ScheduledStatus, string> = {
  active: 'Active',
  paused: 'Paused',
};
