/**
 * Chat Scheduled tasks contract.
 *
 * UI calls these functions only. The backend is authoritative: failed requests
 * are surfaced to the caller and never converted into browser-only ghost tasks.
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
  projectId?: string | null;
};

export type ChatScheduledRun = {
  id: string;
  scheduledFor: number;
  status: string;
  attemptCount: number;
  modelId: string | null;
  conversationId: string | null;
  providerRequestId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: number | null;
  completedAt: number | null;
};

export type ListScheduledInput = {
  query?: string;
  status?: ScheduledStatus | 'all';
  sort?: 'next' | 'updated' | 'name';
  projectId?: string;
};

export type CreateScheduledInput = {
  title: string;
  prompt: string;
  cadence?: ScheduledCadence;
  cadenceLabel?: string;
  projectId?: string;
  nextRunAt?: number;
  scheduleKind?: 'once' | 'recurring';
  timezone?: string;
  dtstartLocal?: string;
  rrule?: string;
  modelId?: string;
};

import { chatService } from '@/services/chatService';

const mapScheduledTask = (row: any): ChatScheduledTask => ({
  id: row.id,
  title: row.title,
  prompt: row.prompt,
  cadence: row.cadence as ScheduledCadence,
  cadenceLabel: row.cadence_label || row.cadence,
  status: row.status as ScheduledStatus,
  nextRunAt: row.next_run_at ? new Date(row.next_run_at).getTime() : Date.now(),
  lastRunAt: row.last_run_at ? new Date(row.last_run_at).getTime() : null,
  createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  projectId: row.project_id ?? null,
});

const requireScheduledAuth = (): void => {
  if (!chatService.isAuthenticated()) throw new Error('Sign in to use scheduled tasks.');
};

/**
 * Lists scheduled tasks for the library page.
 * Fetches from backend GET /api/chat/scheduled.
 */
export const listScheduledTasks = async (
  input: ListScheduledInput = {},
): Promise<ChatScheduledTask[]> => {
  requireScheduledAuth();
  const serverTasks = await chatService.getScheduledTasks({
    status: input.status,
    sort: input.sort,
    query: input.query,
    project_id: input.projectId,
  });
  return serverTasks.map(mapScheduledTask);
};

export const getScheduledTask = async (
  id: string,
): Promise<ChatScheduledTask | null> => {
  const tasks = await listScheduledTasks();
  return tasks.find((task) => task.id === id) ?? null;
};

/** Create a scheduled task in the database. */
export const createScheduledTask = async (
  input: CreateScheduledInput,
): Promise<ChatScheduledTask> => {
  requireScheduledAuth();
  const serverTask = await chatService.createScheduledTask({
    title: input.title.trim() || 'Untitled task',
    prompt: input.prompt.trim(),
    cadence: input.cadence ?? 'daily',
    cadence_label: input.cadenceLabel ?? 'Daily · 09:00',
    project_id: input.projectId,
    next_run_at: input.nextRunAt ? new Date(input.nextRunAt).toISOString() : undefined,
    schedule_kind: input.scheduleKind,
    timezone: input.timezone,
    dtstart_local: input.dtstartLocal,
    rrule: input.rrule,
    model_id: input.modelId,
  });
  if (!serverTask) throw new Error('The scheduled task was not created.');
  return mapScheduledTask(serverTask);
};

export const setScheduledTaskStatus = async (
  id: string,
  status: ScheduledStatus,
): Promise<ChatScheduledTask | null> => {
  requireScheduledAuth();
  const updated = await chatService.updateScheduledTask(id, { status });
  return updated ? mapScheduledTask(updated) : null;
};

export const deleteScheduledTask = async (id: string): Promise<void> => {
  requireScheduledAuth();
  const deleted = await chatService.deleteScheduledTask(id);
  if (!deleted) throw new Error('The scheduled task was not deleted.');
};

export const previewScheduledOccurrences = async (input: {
  scheduleKind: 'once' | 'recurring';
  timezone: string;
  dtstartLocal: string;
  rrule?: string;
}): Promise<string[]> => {
  requireScheduledAuth();
  return chatService.previewScheduledTask({
    schedule_kind: input.scheduleKind,
    timezone: input.timezone,
    dtstart_local: input.dtstartLocal,
    rrule: input.rrule,
    limit: 5,
  });
};

export const listScheduledRuns = async (taskId: string): Promise<ChatScheduledRun[]> => {
  requireScheduledAuth();
  const rows = await chatService.getScheduledRuns(taskId);
  return rows.map((row) => ({
    id: row.id,
    scheduledFor: new Date(row.scheduled_for).getTime(),
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    modelId: row.model_id ?? null,
    conversationId: row.conversation_id ?? null,
    providerRequestId: row.provider_request_id ?? null,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    startedAt: row.started_at ? new Date(row.started_at).getTime() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
  }));
};

export const SCHEDULED_STATUS_LABEL: Record<ScheduledStatus, string> = {
  active: 'Active',
  paused: 'Paused',
};
