/**
 * The Chat turn, read as the canonical transcript reads a turn.
 *
 * ## Why an adapter and not a port (D7d, `XENO AGENT PANEL - SPEC.md`)
 *
 * The transcript — a clock line over a rail of steps, folding to a receipt — is ONE component,
 * `TranscriptTurn` from `@xenosystem/agent-conversation`, and this chat consumes it rather than
 * drawing a fifth copy. That component derives everything it shows from the conversation
 * package's own `ChatMessage` (tool calls + segments), so this module says what a Chat turn is
 * in those terms: every web search the tool loop ran is a `web_search` tool call; the model's
 * reasoning is the turn's thought; the reply stays the chat's own (the transcript is handed an
 * empty reply on purpose — the answer, images and action row are rendered by the chat as they
 * always were, under the transcript's head).
 *
 * ## The record
 *
 * `ChatTurnRecord` is what the chat keeps of a turn: when it started, when it ended, how long
 * the thought took, and each search with its query, its result count and the sources it read.
 * It is presentational and client-written; it lives in `chat_messages.turn` and is validated
 * server-side (`utils/chatTurnRecord.js`). Evidence of what was read stays in the server-owned
 * `search_context` receipt — the two are different records of the same turn, deliberately.
 */
import type {
  AssistantTurnSegment,
  ChatMessage as TranscriptMessage,
  ToolCallInfo,
} from '@xenosystem/agent-conversation/stores/agentChatStore';
import { numberSources } from '@xenosystem/agent-conversation/components/agent/transcript/turnModel';
import type { CitedSource } from '@xenosystem/agent-conversation/components/agent/transcript/citations';

export type StepsMode = 'expanded' | 'collapsed';
export const STEPS_MODES: ReadonlyArray<StepsMode> = ['expanded', 'collapsed'];
export const DEFAULT_STEPS_MODE: StepsMode = 'collapsed';
export const isStepsMode = (value: unknown): value is StepsMode =>
  value === 'expanded' || value === 'collapsed';

export const TURN_SCHEMA = 'xeno.chat.turn.v1' as const;

export interface ChatTurnSource {
  url: string;
  title?: string;
}

export interface ChatTurnSearchStep {
  id: string;
  kind: 'search';
  query: string;
  startedAt: number;
  endedAt?: number;
  count?: number;
  sources?: ChatTurnSource[];
  error?: string;
}

/**
 * An image the turn's generate_image tool drew (2026-09-26). The prompt is the MODEL's, the shape is
 * what the placeholder was sized to, and `assetId` is the library file — the only way the image is
 * found again after a reload. Validated server-side by `utils/chatTurnRecord.js`.
 */
export interface ChatTurnImageStep {
  id: string;
  kind: 'image';
  prompt: string;
  aspectRatio: string;
  startedAt: number;
  endedAt?: number;
  assetId?: string;
  width?: number;
  height?: number;
  /** The image model that drew it (`gpt-image-2.5-sunburst`) — the message's info row lists it. */
  model?: string;
  /** That image call's own tokens, as the gateway reported them. Absent when it did not. */
  usage?: ChatTurnImageUsage;
  error?: string;
  /** Where in the answer it happened: see `turnBodyParts`. */
  textAt?: number;
}

export interface ChatTurnImageUsage { input: number; output: number; total: number }

export interface ChatTurnCodeFile { path: string; assetId?: string }

/**
 * A `code` step: the turn's run_code tool executed code in the conversation's sandbox (2026-09-27).
 * The sandbox persists between turns, so this is the visible record of one run — its language and
 * source, what it printed, its exit, and any files it produced (each a library asset, so it opens
 * again after a reload). Validated server-side by `utils/chatTurnRecord.js`.
 */
export interface ChatTurnCodeStep {
  id: string;
  kind: 'code';
  language: string;
  code: string;
  startedAt: number;
  endedAt?: number;
  status?: 'running' | 'success' | 'error' | 'timeout' | 'killed';
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  files?: ChatTurnCodeFile[];
  error?: string;
  /** Where in the answer it happened: see `turnBodyParts`. */
  textAt?: number;
}

/** Caps mirror `utils/chatTurnRecord.js` CODE_LIMITS: what the server accepts is what the client records. */
const CODE_LIMITS = { code: 8000, stdout: 4000, stderr: 2000, files: 32 } as const;
const CODE_LANGUAGES: ReadonlyArray<string> = ['python', 'javascript', 'typescript', 'go', 'rust', 'c', 'cpp', 'java', 'ruby', 'php', 'bash'];
const CODE_STATUSES: ReadonlyArray<ChatTurnCodeStep['status']> = ['running', 'success', 'error', 'timeout', 'killed'];

/**
 * A `question` step: the model asked the person with ask_user (2026-10-02). The turn ENDED here; the
 * answer is the person's next message, so it is never written into this record (a saved turn is not
 * edited after the fact). Validated server-side by `utils/chatTurnRecord.js`.
 */
export interface ChatTurnQuestionStep {
  id: string;
  kind: 'question';
  question: string;
  options: string[];
  multiple: boolean;
  startedAt: number;
  endedAt?: number;
  toolCallId?: string;
}

/** Caps mirror `utils/chatTurnRecord.js` QUESTION_LIMITS. */
export const QUESTION_LIMITS = { question: 300, option: 300, minOptions: 2, maxOptions: 6, toolCallId: 128 } as const;

export interface ChatTurnGenerationStep { id: string; kind: 'generation'; generationId: string; type: 'image' | 'video' | 'audio' | '3d'; startedAt: number; endedAt?: number; textAt?: number; }
/** Work handed to an agent from this chat: a task delegated to it (services/chatHandoff.js). The card reads the task live. */
export interface ChatTurnHandoffStep { id: string; kind: 'handoff'; taskKey: string; agentId: string; agentName: string; startedAt: number; endedAt?: number; }
/**
 * A step in the person's own browser through XENO Extension (2026-10-17). `tool` is the chat's `browser_<name>`
 * form, which the shared transcript already draws as a browser row. The page content went to the model only; the
 * record keeps the arguments and a one-line outcome. Validated server-side by `utils/chatTurnRecord.js`.
 */
export interface ChatTurnBrowserStep {
  id: string;
  kind: 'browser';
  tool: string;
  startedAt: number;
  endedAt?: number;
  state?: 'running' | 'waiting_approval' | 'done' | 'failed';
  browser?: string;
  args?: Record<string, unknown>;
  summary?: string;
  error?: string;
}
const BROWSER_TOOL = /^browser_[a-z0-9_]{1,56}$/;
const BROWSER_STATES: ReadonlyArray<ChatTurnBrowserStep['state']> = ['running', 'waiting_approval', 'done', 'failed'];
export const isBrowserStep = (step: ChatTurnStep): step is ChatTurnBrowserStep => step.kind === 'browser';
const asBrowserArgs = (raw: unknown): Record<string, unknown> | undefined =>
  raw && typeof raw === 'object' && !Array.isArray(raw) && JSON.stringify(raw).length <= 2000 ? raw as Record<string, unknown> : undefined;

export type ChatTurnStep = ChatTurnHandoffStep | ChatTurnGenerationStep | ChatTurnSearchStep | ChatTurnImageStep | ChatTurnCodeStep | ChatTurnQuestionStep | ChatTurnBrowserStep;

export interface ChatTurnRecord {
  schema: typeof TURN_SCHEMA;
  startedAt: number;
  endedAt?: number;
  thinkingMs?: number;
  steps: ChatTurnStep[];
}

export const newTurnRecord = (startedAt = Date.now()): ChatTurnRecord => ({
  schema: TURN_SCHEMA,
  startedAt,
  steps: [],
});

/** The events the stream reader hands back that the turn record cares about. */
export type TurnStreamEvent =
  | { type: 'generation_proposal'; generation: {id:string;type:'image'|'video'|'audio'|'3d'} }
  | { type: 'search_start'; query?: string; iteration?: number }
  | { type: 'search_result'; query?: string; count?: number; sources?: Array<{ url?: string; title?: string }> }
  | { type: 'search_error'; query?: string; code?: string; message?: string }
  | { type: 'image_start'; index?: number; prompt?: string; aspectRatio?: string }
  | { type: 'image_result'; index?: number; image?: { id?: string; aspectRatio?: string; width?: number; height?: number; model?: string; usage?: Partial<ChatTurnImageUsage> } }
  | { type: 'image_error'; index?: number; code?: string; message?: string }
  | { type: 'code_start'; index?: number; language?: string; code?: string }
  | { type: 'code_result'; index?: number; status?: string; exitCode?: number | null; stdout?: string; stderr?: string; files?: Array<{ path?: string }>; libraryAssets?: Array<{ path?: string; assetId?: string }> }
  | { type: 'code_error'; index?: number; message?: string }
  | { type: 'ask_user'; toolCallId?: string | null; question?: string; options?: unknown[]; multiple?: boolean }
  | { type: 'browser_start'; index?: number; tool?: string; browser?: string | null; args?: unknown }
  | { type: 'browser_state'; index?: number; state?: string }
  | { type: 'browser_result'; index?: number; summary?: string }
  | { type: 'browser_error'; index?: number; code?: string; message?: string };

export const TURN_IMAGE_ASPECTS: ReadonlyArray<string> = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'];
/** Mirrors `utils/chatTurnRecord.js`: what the server accepts is what the client records. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const isTokenCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10_000_000;
const asImageUsage = (raw: unknown): ChatTurnImageUsage | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const { input, output, total } = raw as Partial<ChatTurnImageUsage>;
  return isTokenCount(input) && isTokenCount(output) && isTokenCount(total) ? { input, output, total } : undefined;
};
const asModelId = (raw: unknown): string | undefined => (typeof raw === 'string' && MODEL_ID.test(raw) ? raw : undefined);
const isSearchStep = (step: ChatTurnStep): step is ChatTurnSearchStep => step.kind === 'search';
export const isImageStep = (step: ChatTurnStep): step is ChatTurnImageStep => step.kind === 'image';
export const isCodeStep = (step: ChatTurnStep): step is ChatTurnCodeStep => step.kind === 'code';
export const isQuestionStep = (step: ChatTurnStep): step is ChatTurnQuestionStep => step.kind === 'question';

const asSources = (raw: unknown): ChatTurnSource[] => {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurnSource[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const url = item && typeof item === 'object' ? (item as { url?: unknown }).url : undefined;
    if (typeof url !== 'string' || !url.startsWith('https://') || seen.has(url)) continue;
    seen.add(url);
    const title = item && typeof item === 'object' ? (item as { title?: unknown }).title : undefined;
    out.push({ url, ...(typeof title === 'string' && title.trim() ? { title: title.trim().slice(0, 512) } : {}) });
    if (out.length >= 24) break;
  }
  return out;
};

/**
 * Fold one stream event into the record. Pure: returns a new record when something changed,
 * the same one otherwise. A `search_result` or `search_error` closes the LAST OPEN step whose
 * query matches (the loop reports them in order); an unmatched result opens and closes a step
 * of its own so nothing the server reported is dropped.
 */
export function applyTurnEvent(record: ChatTurnRecord, event: TurnStreamEvent, now = Date.now()): ChatTurnRecord {
  if (event.type === 'generation_proposal') {
    const step = asGenerationStep({id:'generation:' + event.generation.id,kind:'generation',generationId:event.generation.id,type:event.generation.type,startedAt:now});
    return step && !record.steps.some(s => s.kind === 'generation' && s.generationId === step.generationId) ? {...record,steps:[...record.steps,step]} : record;
  }
  if (event.type === 'image_start' || event.type === 'image_result' || event.type === 'image_error') {
    return applyImageEvent(record, event, now);
  }
  if (event.type === 'code_start' || event.type === 'code_result' || event.type === 'code_error') {
    return applyCodeEvent(record, event, now);
  }
  if (event.type === 'browser_start' || event.type === 'browser_state' || event.type === 'browser_result' || event.type === 'browser_error') {
    return applyBrowserEvent(record, event, now);
  }
  if (event.type === 'ask_user') {
    const step = asQuestionStep({ ...event, id: 'question-1', startedAt: now });
    if (!step || record.steps.some(isQuestionStep)) return record;
    return { ...record, steps: [...record.steps, step] };
  }
  const query = typeof event.query === 'string' ? event.query.trim().slice(0, 512) : '';
  if (event.type === 'search_start') {
    const id = `search-${record.steps.length + 1}`;
    return { ...record, steps: [...record.steps, { id, kind: 'search', query, startedAt: now }] };
  }
  const openIndex = [...record.steps.keys()].reverse().find((index) => {
    const step = record.steps[index];
    return isSearchStep(step) && step.endedAt === undefined && (!query || step.query === query);
  });
  const closed: Partial<ChatTurnSearchStep> = event.type === 'search_result'
    ? {
        endedAt: now,
        count: Number.isInteger(event.count) && (event.count as number) >= 0 ? (event.count as number) : asSources(event.sources).length,
        sources: asSources(event.sources),
      }
    : { endedAt: now, error: (typeof event.message === 'string' && event.message.trim()) || 'That search could not be completed.' };
  if (openIndex === undefined) {
    const id = `search-${record.steps.length + 1}`;
    return { ...record, steps: [...record.steps, { id, kind: 'search', query, startedAt: now, ...closed } as ChatTurnSearchStep] };
  }
  const steps = record.steps.map((step, index) => (index === openIndex ? { ...step, ...closed } as ChatTurnStep : step));
  return { ...record, steps };
}

/**
 * Fold an image event into the record. The step is keyed by the server's per-turn image index, so a
 * result always closes the image it belongs to, however the events interleave with searches.
 */
function applyImageEvent(
  record: ChatTurnRecord,
  event: Extract<TurnStreamEvent, { type: 'image_start' | 'image_result' | 'image_error' }>,
  now: number,
): ChatTurnRecord {
  const index = Number.isInteger(event.index) ? (event.index as number) : 0;
  const id = `image-${index + 1}`;
  if (event.type === 'image_start') {
    if (record.steps.some((step) => step.id === id)) return record;
    const aspectRatio = TURN_IMAGE_ASPECTS.includes(event.aspectRatio ?? '') ? (event.aspectRatio as string) : '1:1';
    const prompt = typeof event.prompt === 'string' ? event.prompt.slice(0, 4000) : '';
    return { ...record, steps: [...record.steps, { id, kind: 'image', prompt, aspectRatio, startedAt: now }] };
  }
  const existing = record.steps.find((step) => step.id === id);
  const base: ChatTurnImageStep = existing && isImageStep(existing)
    ? existing
    : { id, kind: 'image', prompt: '', aspectRatio: '1:1', startedAt: now };
  let closed: ChatTurnImageStep;
  if (event.type === 'image_result') {
    const image = event.image ?? {};
    const model = asModelId(image.model);
    const usage = asImageUsage(image.usage);
    closed = {
      ...base,
      endedAt: now,
      ...(typeof image.id === 'string' ? { assetId: image.id } : {}),
      ...(Number.isInteger(image.width) && Number.isInteger(image.height) ? { width: image.width as number, height: image.height as number } : {}),
      ...(model ? { model } : {}),
      ...(usage ? { usage } : {}),
    };
  } else {
    closed = { ...base, endedAt: now, error: (typeof event.message === 'string' && event.message.trim()) || 'That image could not be generated.' };
  }
  const steps = existing ? record.steps.map((step) => (step.id === id ? closed : step)) : [...record.steps, closed];
  return { ...record, steps };
}

/**
 * Fold a code event into the record, keyed by the run's per-turn index (like images), so a result
 * always closes the run it belongs to however events interleave. Clips to CODE_LIMITS so what the
 * client records is what the server will accept.
 */
function applyCodeEvent(
  record: ChatTurnRecord,
  event: Extract<TurnStreamEvent, { type: 'code_start' | 'code_result' | 'code_error' }>,
  now: number,
): ChatTurnRecord {
  const index = Number.isInteger(event.index) ? (event.index as number) : 0;
  const id = `code-${index + 1}`;
  const clip = (s: unknown, n: number): string | undefined => (typeof s === 'string' ? s.slice(0, n) : undefined);
  if (event.type === 'code_start') {
    if (record.steps.some((step) => step.id === id)) return record;
    const language = CODE_LANGUAGES.includes(event.language ?? '') ? (event.language as string) : 'python';
    const code = clip(event.code, CODE_LIMITS.code) ?? '';
    return { ...record, steps: [...record.steps, { id, kind: 'code', language, code, startedAt: now, status: 'running' }] };
  }
  const existing = record.steps.find((step) => step.id === id);
  const base: ChatTurnCodeStep = existing && isCodeStep(existing)
    ? existing
    : { id, kind: 'code', language: 'python', code: '', startedAt: now, status: 'running' };
  let closed: ChatTurnCodeStep;
  if (event.type === 'code_result') {
    const status = CODE_STATUSES.includes(event.status as ChatTurnCodeStep['status']) ? (event.status as ChatTurnCodeStep['status']) : 'success';
    const assetByPath = new Map<string, string>();
    for (const a of event.libraryAssets ?? []) if (a?.path && a?.assetId) assetByPath.set(a.path, a.assetId);
    const files: ChatTurnCodeFile[] = (event.files ?? [])
      .filter((f): f is { path: string } => typeof f?.path === 'string')
      .slice(0, CODE_LIMITS.files)
      .map((f) => ({ path: f.path, ...(assetByPath.has(f.path) ? { assetId: assetByPath.get(f.path) } : {}) }));
    closed = {
      ...base,
      endedAt: now,
      status,
      ...(event.exitCode === null || Number.isInteger(event.exitCode) ? { exitCode: event.exitCode as number | null } : {}),
      ...(clip(event.stdout, CODE_LIMITS.stdout) !== undefined ? { stdout: clip(event.stdout, CODE_LIMITS.stdout) } : {}),
      ...(clip(event.stderr, CODE_LIMITS.stderr) !== undefined ? { stderr: clip(event.stderr, CODE_LIMITS.stderr) } : {}),
      ...(files.length ? { files } : {}),
    };
  } else {
    closed = { ...base, endedAt: now, status: 'error', error: (typeof event.message === 'string' && event.message.trim()) || 'That code could not be executed.' };
  }
  const steps = existing ? record.steps.map((step) => (step.id === id ? closed : step)) : [...record.steps, closed];
  return { ...record, steps };
}

/** Fold a browser event into the record, keyed by the step's per-turn index (like code runs). */
function applyBrowserEvent(
  record: ChatTurnRecord,
  event: Extract<TurnStreamEvent, { type: 'browser_start' | 'browser_state' | 'browser_result' | 'browser_error' }>,
  now: number,
): ChatTurnRecord {
  const index = Number.isInteger(event.index) ? (event.index as number) : 0;
  const id = `browser-${index + 1}`;
  const existing = record.steps.find((step) => step.id === id);
  if (event.type === 'browser_start') {
    if (existing) return record;
    const tool = typeof event.tool === 'string' && BROWSER_TOOL.test(event.tool) ? event.tool : 'browser_step';
    const args = asBrowserArgs(event.args);
    const browser = typeof event.browser === 'string' && event.browser.trim() ? event.browser.trim().slice(0, 80) : undefined;
    return { ...record, steps: [...record.steps, { id, kind: 'browser', tool, startedAt: now, state: 'running', ...(browser ? { browser } : {}), ...(args ? { args } : {}) }] };
  }
  const base: ChatTurnBrowserStep = existing && isBrowserStep(existing) ? existing : { id, kind: 'browser', tool: 'browser_step', startedAt: now, state: 'running' };
  let next: ChatTurnBrowserStep;
  if (event.type === 'browser_state') {
    if (base.endedAt !== undefined) return record;
    next = { ...base, state: event.state === 'waiting_approval' ? 'waiting_approval' : 'running' };
  } else if (event.type === 'browser_result') {
    const summary = typeof event.summary === 'string' ? event.summary.slice(0, 512) : '';
    next = { ...base, endedAt: now, state: 'done', ...(summary ? { summary } : {}) };
  } else {
    next = { ...base, endedAt: now, state: 'failed', error: (typeof event.message === 'string' && event.message.trim().slice(0, 512)) || 'That browser step could not be completed.' };
  }
  const steps = existing ? record.steps.map((step) => (step.id === id ? next : step)) : [...record.steps, next];
  return { ...record, steps };
}

/**
 * The image models a turn used, for the message's info row: each model once, with how many images it
 * drew and their tokens summed. Failed images drew nothing and are not counted.
 */
export function turnImageModels(record: ChatTurnRecord | undefined): Array<{ model: string; images: number; tokens?: number }> {
  const byModel = new Map<string, { model: string; images: number; tokens?: number }>();
  for (const step of turnImages(record)) {
    if (!step.assetId || !step.model) continue;
    const entry = byModel.get(step.model) ?? { model: step.model, images: 0 };
    entry.images += 1;
    if (step.usage) entry.tokens = (entry.tokens ?? 0) + step.usage.total;
    byModel.set(step.model, entry);
  }
  return [...byModel.values()];
}

/**
 * A question step from untrusted input (a stream event or a stored record), or null when it is not a
 * usable question. One validator for both paths, so what renders live is exactly what restores.
 */
function asQuestionStep(raw: any): ChatTurnQuestionStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const question = typeof raw.question === 'string' ? raw.question.trim().slice(0, QUESTION_LIMITS.question) : '';
  const options = Array.isArray(raw.options)
    ? raw.options.filter((o: unknown): o is string => typeof o === 'string' && o.trim() !== '').map((o: string) => o.trim().slice(0, QUESTION_LIMITS.option))
    : [];
  if (!question || options.length < QUESTION_LIMITS.minOptions || options.length > QUESTION_LIMITS.maxOptions) return null;
  if (typeof raw.id !== 'string' || typeof raw.startedAt !== 'number') return null;
  return {
    id: raw.id,
    kind: 'question',
    question,
    options,
    multiple: raw.multiple === true,
    startedAt: raw.startedAt,
    ...(typeof raw.endedAt === 'number' ? { endedAt: raw.endedAt } : {}),
    ...(typeof raw.toolCallId === 'string' && raw.toolCallId.length <= QUESTION_LIMITS.toolCallId ? { toolCallId: raw.toolCallId } : {}),
  };
}

/** The question a turn ended on, if it asked one. */
export const turnQuestion = (turn: ChatTurnRecord | undefined): ChatTurnQuestionStep | undefined =>
  (turn?.steps ?? []).find(isQuestionStep);

/** Close the record: every still-open step is marked ended, and the turn is stamped. */
export function closeTurnRecord(record: ChatTurnRecord, endedAt = Date.now()): ChatTurnRecord {
  return {
    ...record,
    endedAt,
    steps: record.steps.map((step) => (step.endedAt === undefined ? { ...step, endedAt } : step)),
  };
}

const keptTextAt = (value: unknown): { textAt?: number } => (Number.isSafeInteger(value) && (value as number) >= 0 ? { textAt: value as number } : {});
/** Read a stored `turn` column back; anything that is not a v1 record is treated as absent. */
function asGenerationStep(raw: unknown): ChatTurnGenerationStep | null {
  const s = raw as Partial<ChatTurnGenerationStep> | null;
  return s && s.kind === 'generation' && typeof s.id === 'string' && typeof s.generationId === 'string' && /^[0-9a-f-]{36}$/i.test(s.generationId) && ['image','video','audio','3d'].includes(s.type || '') && typeof s.startedAt === 'number' && s.startedAt > 0 ? {id:s.id,kind:'generation',generationId:s.generationId,type:s.type!,startedAt:s.startedAt,...keptTextAt(s.textAt)} : null;
}
export function normalizeStoredTurn(value: unknown): ChatTurnRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Partial<ChatTurnRecord>;
  if (record.schema !== TURN_SCHEMA || typeof record.startedAt !== 'number' || !Array.isArray(record.steps)) return undefined;
  const steps = record.steps.flatMap((raw): ChatTurnStep[] => {
    if ((raw as ChatTurnGenerationStep)?.kind === 'generation') { const step=asGenerationStep(raw); return step ? [step] : []; }
    if ((raw as ChatTurnHandoffStep)?.kind === 'handoff') { const h = raw as ChatTurnHandoffStep; return typeof h.id === 'string' && /^T-\d{1,15}$/.test(String(h.taskKey)) && /^agt_[0-9a-f]{32}$/.test(String(h.agentId)) && typeof h.startedAt === 'number' ? [{ id: h.id, kind: 'handoff', taskKey: h.taskKey, agentId: h.agentId, agentName: String(h.agentName || ''), startedAt: h.startedAt }] : []; }
    if (raw && typeof raw === 'object' && (raw as ChatTurnImageStep).kind === 'image') {
      const image = raw as ChatTurnImageStep;
      if (typeof image.id !== 'string' || typeof image.prompt !== 'string' || typeof image.startedAt !== 'number') return [];
      return [{
        id: image.id,
        kind: 'image',
        prompt: image.prompt,
        aspectRatio: TURN_IMAGE_ASPECTS.includes(image.aspectRatio) ? image.aspectRatio : '1:1',
        startedAt: image.startedAt,
        ...(typeof image.endedAt === 'number' ? { endedAt: image.endedAt } : {}),
        ...(typeof image.assetId === 'string' ? { assetId: image.assetId } : {}),
        ...(typeof image.width === 'number' && typeof image.height === 'number' ? { width: image.width, height: image.height } : {}),
        ...(asModelId(image.model) ? { model: image.model } : {}),
        ...(asImageUsage(image.usage) ? { usage: asImageUsage(image.usage) } : {}),
        ...(typeof image.error === 'string' ? { error: image.error } : {}),
        ...keptTextAt(image.textAt),
      }];
    }
    if (raw && typeof raw === 'object' && (raw as ChatTurnCodeStep).kind === 'code') {
      const c = raw as ChatTurnCodeStep;
      if (typeof c.id !== 'string' || !CODE_LANGUAGES.includes(c.language) || typeof c.code !== 'string' || typeof c.startedAt !== 'number') return [];
      const files = Array.isArray(c.files)
        ? c.files
            .filter((f): f is ChatTurnCodeFile => Boolean(f) && typeof f.path === 'string')
            .slice(0, CODE_LIMITS.files)
            .map((f) => ({ path: f.path, ...(typeof f.assetId === 'string' ? { assetId: f.assetId } : {}) }))
        : [];
      return [{
        id: c.id,
        kind: 'code',
        language: c.language,
        code: c.code.slice(0, CODE_LIMITS.code),
        startedAt: c.startedAt,
        ...(typeof c.endedAt === 'number' ? { endedAt: c.endedAt } : {}),
        ...(CODE_STATUSES.includes(c.status) ? { status: c.status } : {}),
        ...(c.exitCode === null || typeof c.exitCode === 'number' ? { exitCode: c.exitCode } : {}),
        ...(typeof c.stdout === 'string' ? { stdout: c.stdout.slice(0, CODE_LIMITS.stdout) } : {}),
        ...(typeof c.stderr === 'string' ? { stderr: c.stderr.slice(0, CODE_LIMITS.stderr) } : {}),
        ...(files.length ? { files } : {}),
        ...(typeof c.error === 'string' ? { error: c.error } : {}),
        ...keptTextAt(c.textAt),
      }];
    }
    if (raw && typeof raw === 'object' && (raw as ChatTurnBrowserStep).kind === 'browser') {
      const b = raw as ChatTurnBrowserStep;
      if (typeof b.id !== 'string' || typeof b.tool !== 'string' || !BROWSER_TOOL.test(b.tool) || typeof b.startedAt !== 'number') return [];
      const args = asBrowserArgs(b.args);
      return [{
        id: b.id, kind: 'browser', tool: b.tool, startedAt: b.startedAt,
        ...(typeof b.endedAt === 'number' ? { endedAt: b.endedAt } : {}),
        ...(BROWSER_STATES.includes(b.state) ? { state: b.state } : {}),
        ...(typeof b.browser === 'string' ? { browser: b.browser.slice(0, 80) } : {}),
        ...(args ? { args } : {}),
        ...(typeof b.summary === 'string' ? { summary: b.summary.slice(0, 512) } : {}),
        ...(typeof b.error === 'string' ? { error: b.error.slice(0, 512) } : {}),
      }];
    }
    if (raw && typeof raw === 'object' && (raw as ChatTurnQuestionStep).kind === 'question') {
      const question = asQuestionStep(raw);
      return question ? [question] : [];
    }
    if (!raw || typeof raw !== 'object' || (raw as ChatTurnSearchStep).kind !== 'search') return [];
    const step = raw as ChatTurnSearchStep;
    if (typeof step.id !== 'string' || typeof step.query !== 'string' || typeof step.startedAt !== 'number') return [];
    return [{
      id: step.id,
      kind: 'search',
      query: step.query,
      startedAt: step.startedAt,
      ...(typeof step.endedAt === 'number' ? { endedAt: step.endedAt } : {}),
      ...(typeof step.count === 'number' ? { count: step.count } : {}),
      ...(typeof step.error === 'string' ? { error: step.error } : {}),
      ...(Array.isArray(step.sources) ? { sources: asSources(step.sources) } : {}),
    }];
  });
  return {
    schema: TURN_SCHEMA,
    startedAt: record.startedAt,
    ...(typeof record.endedAt === 'number' ? { endedAt: record.endedAt } : {}),
    ...(typeof record.thinkingMs === 'number' ? { thinkingMs: record.thinkingMs } : {}),
    steps,
  };
}

/** The images a turn made, in order, as library assets — what the reply draws under the head. */
export const turnImages = (turn: ChatTurnRecord | undefined): ChatTurnImageStep[] =>
  (turn?.steps ?? []).filter(isImageStep);

/** The code runs a turn made, in order — what the reply draws as code-execution blocks under the head. */
export const turnCodeSteps = (turn: ChatTurnRecord | undefined): ChatTurnCodeStep[] =>
  (turn?.steps ?? []).filter(isCodeStep);

/*
 * Where a step sits in the reply's text (2026-11-06).
 *
 * A turn stores its words as one string and its steps as a list, so nothing said which words came
 * before an image or a run: the reply drew every step above all of its text, and "the brief below"
 * sat under the card it described. `textAt` is the place: how much of the answer had been written
 * when the step started. It is taken from the stream as the step arrives, moved onto the finished
 * answer when the turn lands (`anchorTurnSteps`), and read back unchanged after a reload.
 */
export type ChatTurnBodyStep = ChatTurnImageStep | ChatTurnCodeStep | ChatTurnGenerationStep;
const isPlacedStep = (step: ChatTurnStep): step is ChatTurnBodyStep => step.kind === 'image' || step.kind === 'code' || step.kind === 'generation';

/** Note how much text was written when `after` gained its new steps. Steps it already had keep their place. */
export function stampTextAt(before: ChatTurnRecord, after: ChatTurnRecord, textAt: number): ChatTurnRecord {
  if (after === before) return after;
  const known = new Set(before.steps.map((step) => step.id));
  return { ...after, steps: after.steps.map((step) => (!known.has(step.id) && isPlacedStep(step) ? { ...step, textAt } : step)) };
}

/** How many characters of the text before a place are looked for in the finished answer: long first, then shorter. */
const ANCHOR_LENGTHS = [48, 24, 12];

/**
 * Move each step from the streamed text onto the finished answer. They differ: the answer is parsed
 * (thinking tags and markers go, the ends are trimmed) and can carry citation markers, so an offset
 * is carried across by the words just before it.
 */
export function anchorTurnSteps(record: ChatTurnRecord, streamed: string, answer: string): ChatTurnRecord {
  if (streamed === answer) return record;
  const anchored = (at: number): number => {
    if (!streamed.slice(at).trim()) return answer.length;    // nothing was written after it
    const before = streamed.slice(0, at).trimEnd();
    if (!before.trim()) return 0;
    for (const length of ANCHOR_LENGTHS) {
      const tail = before.slice(-length).trimStart();
      let nearest = -1;
      for (let found = answer.indexOf(tail); found !== -1; found = answer.indexOf(tail, found + 1)) {
        const end = found + tail.length;
        if (nearest === -1 || Math.abs(end - at) < Math.abs(nearest - at)) nearest = end;
      }
      if (nearest !== -1) return nearest;
    }
    return Math.min(at, answer.length);
  };
  return { ...record, steps: record.steps.map((step) => (isPlacedStep(step) && step.textAt !== undefined ? { ...step, textAt: anchored(step.textAt) } : step)) };
}

/** The end of the code fence `at` falls inside, or `at` itself when it is outside every fence. */
function pastCodeFence(text: string, at: number): number {
  let opened: { index: number; mark: string } | null = null;
  for (const match of text.matchAll(/^ {0,3}(`{3,}|~{3,})/gm)) {
    const mark = match[1];
    if (!opened) { opened = { index: match.index, mark }; continue; }
    if (mark[0] !== opened.mark[0] || mark.length < opened.mark.length) continue;
    const lineEnd = text.indexOf('\n', match.index);
    const end = lineEnd === -1 ? text.length : lineEnd;
    if (at > opened.index && at < end) return end;
    opened = null;
  }
  return opened && at > opened.index ? text.length : at;
}

/**
 * Where a step really goes: at `at`, or at the next paragraph break if the text was edited since and
 * `at` now falls inside a paragraph or a code block. Text is only ever cut between its blocks.
 */
function blockBoundary(text: string, at: number): number {
  const place = pastCodeFence(text, Math.min(Math.max(at, 0), text.length));
  if (place === 0 || place === text.length || /^[ \t]*\r?\n/.test(text.slice(place)) || /\n[ \t]*\n[ \t]*$/.test(text.slice(Math.max(0, place - 16), place))) return place;
  const blank = /\n[ \t]*\n/g;
  blank.lastIndex = place;
  const next = blank.exec(text);
  return next ? pastCodeFence(text, next.index) : text.length;
}

/** A step recorded before `textAt` existed. A proposal has always ended its turn, so all its text came first. */
const stepPlace = (step: ChatTurnBodyStep | ChatTurnHandoffStep, length: number): number => {
  if (step.kind === 'handoff') return 0;
  return step.textAt ?? (step.kind === 'generation' ? length : 0);
};

export type TurnBodyPart =
  | { kind: 'text'; text: string; start: number; firstLine: number }
  | { kind: 'images'; steps: ChatTurnImageStep[] }
  | { kind: 'generation'; step: ChatTurnGenerationStep }
  | { kind: 'handoff'; step: ChatTurnHandoffStep };

/**
 * The reply's body in the order it happened: runs of text with the turn's steps between them.
 *
 * `firstLine` is how many lines of the answer come before a run of text, so a code block keeps the
 * line number it has in the whole answer: that number is how its edit finds it again.
 */
export function turnBodyParts(turn: ChatTurnRecord | undefined, answer: string): TurnBodyPart[] {
  const placed = (turn?.steps ?? [])
    // A code run is drawn in the turn's rail as a command step (XENO Agent's own), never in the body.
    .filter((step): step is ChatTurnBodyStep | ChatTurnHandoffStep => (isPlacedStep(step) && step.kind !== 'code') || step.kind === 'handoff')
    .map((step) => ({ step, at: blockBoundary(answer, stepPlace(step, answer.length)) }));
  const parts: TurnBodyPart[] = [];
  const addText = (start: number, end: number) => {
    const text = answer.slice(start, end);
    if (text.trim()) parts.push({ kind: 'text', text, start, firstLine: answer.slice(0, start).split('\n').length - 1 });
  };
  let written = 0;
  for (const at of [...new Set(placed.map((entry) => entry.at))].sort((a, b) => a - b)) {
    addText(written, at);
    written = at;
    for (const { step, at: place } of placed) {
      if (place !== at) continue;
      const last = parts[parts.length - 1];
      if (step.kind === 'image') { if (last?.kind === 'images') last.steps.push(step); else parts.push({ kind: 'images', steps: [step] }); }
      else parts.push({ kind: step.kind, step } as TurnBodyPart);
    }
  }
  addText(written, answer.length);
  return parts;
}

/** Whether a message has anything for the transcript head to show. */
export const turnHasRail = (turn: ChatTurnRecord | undefined, thinking: string | undefined): boolean =>
  Boolean((turn && turn.steps.length > 0) || (thinking && thinking.trim()));

export interface ChatTurnInput {
  id: string;
  /** The reasoning the model produced, when it did. */
  thinking?: string;
  /** The reply is still arriving (or has not started). */
  streaming?: boolean;
  /** The reply has started to arrive — the thought, if any, is over. */
  replyStarted?: boolean;
  /**
   * The turn is waiting on a reasoning model and no thought text has arrived yet.
   * The clock still says Thinking (not a bare "Working for 2s") — the client is not
   * inventing a thought, it is naming the wait the placeholder already is.
   */
  expectingThought?: boolean;
  /**
   * A reasoning wait happened on this turn (placeholder, stored hasThinking, measured
   * duration). Kept for callers; it no longer makes a settled turn say Thought on its own.
   *
   * 🔴 It used to, and that label was a claim the turn could not back. The "duration" behind it
   * is the chat's own timer — send until the first answer token — which measures WAITING, not
   * thinking. A Claude "hello" at medium effort does not think at all (measured 2026-09-25: 134
   * output tokens for a 400-character reply, i.e. the answer alone) and still read
   * `Thought for 6s`; every Gemini turn, which reports a duration and never any text, read the
   * same. A settled turn says Thought only when thought TEXT arrived; otherwise the receipt is
   * the honest `Worked for 6s`. The live wait still says Thinking — see `expectingThought`.
   */
  hadThought?: boolean;
  /** When this message was created, used when the record carries no start. */
  timestamp?: number;
  model?: string;
  turn?: ChatTurnRecord;
}

/**
 * A step's sources as the result text the canonical step model parses: a title line and its
 * URL per block. The row then reads "Searched the web · <query> · 3 results" and opens to the
 * three sources. The count alone (no sources kept) reads as prose.
 */
const searchResultText = (step: ChatTurnSearchStep): string => {
  if (step.error) return step.error;
  const sources = step.sources ?? [];
  if (sources.length) return sources.map((source) => `${source.title || source.url}\n${source.url}`).join('\n\n');
  if (typeof step.count === 'number') return step.count === 0 ? 'No results' : `${step.count} result${step.count === 1 ? '' : 's'}`;
  return '';
};

/**
 * An image step as the transcript's own `image_generate` tool call — a name the canonical step model
 * already renders ("Generating image", then "Generated image"), so the chat adds no row of its own.
 * The image itself is drawn by the chat under the transcript head, in the reply; the row carries the
 * fact and, on failure, why.
 */
const imageToolCall = (step: ChatTurnImageStep, turnLive: boolean): ToolCallInfo => {
  const done = step.endedAt !== undefined || !turnLive;
  const endedAt = step.endedAt ?? (done ? step.startedAt : undefined);
  return {
    id: step.id,
    toolName: 'image_generate',
    params: { prompt: step.prompt, aspect_ratio: step.aspectRatio },
    status: done ? 'done' : 'running',
    success: done ? !step.error : undefined,
    ...(done ? { outcome: step.error ? ('failed' as const) : ('succeeded' as const) } : {}),
    result: done ? (step.error || '') : undefined,
    startedAt: step.startedAt,
    ...(endedAt !== undefined ? { endedAt, durationMs: Math.max(0, endedAt - step.startedAt) } : {}),
    category: 'other',
  };
};

/** A code step's one-line rail result: its exit and how many files it produced, or the error. */
/**
 * A run's output in the form the shared command step reads (`parseStructuredCommandContent`): stdout,
 * then `[stderr]` and its lines, an `[error]` line for why it failed, and `exit: N`.
 */
const codeResultText = (step: ChatTurnCodeStep): string => {
  const lines: string[] = [];
  if (step.stdout) lines.push(step.stdout.replace(/\n+$/, ''));
  if (step.stderr) lines.push('[stderr]', step.stderr.replace(/\n+$/, ''));
  if (step.error) lines.push(`[error] ${step.error}`);
  else if (step.status === 'timeout') lines.push('[error] Timed out');
  else if (step.status === 'killed') lines.push('[error] Stopped');
  if (typeof step.exitCode === 'number') lines.push(`exit: ${step.exitCode}`);
  return lines.join('\n');
};

/** Each file a finished run produced, as the rail's own file step ("Created <name>"), opened by path. */
const codeFileToolCalls = (step: ChatTurnCodeStep, turnLive: boolean): ToolCallInfo[] => {
  const done = step.endedAt !== undefined || !turnLive;
  if (!done || !step.files?.length) return [];
  const at = step.endedAt ?? step.startedAt;
  return step.files.map((file, index) => ({
    id: `${step.id}:file:${index}`,
    toolName: 'write',
    params: { file_path: file.path },
    status: 'done' as const,
    success: true,
    outcome: 'succeeded' as const,
    startedAt: at,
    endedAt: at,
    category: 'other' as const,
  }));
};

/**
 * A code step as a COMMAND in the transcript's rail: the shared step model draws it as XENO Agent draws
 * a terminal command (the code as its preview, the output, the exit and the duration when expanded).
 * Before 2026-11-13 the chat drew its own card for it under the head, in a style of its own.
 */
const codeToolCall = (step: ChatTurnCodeStep, turnLive: boolean): ToolCallInfo => {
  const done = step.endedAt !== undefined || !turnLive;
  const endedAt = step.endedAt ?? (done ? step.startedAt : undefined);
  const failed = Boolean(step.error) || (step.status !== undefined && step.status !== 'success' && step.status !== 'running');
  return {
    id: step.id,
    toolName: 'run_code',
    params: { command: step.code, language: step.language },
    status: done ? 'done' : 'running',
    success: done ? !failed : undefined,
    ...(done ? { outcome: failed ? ('failed' as const) : ('succeeded' as const) } : {}),
    result: done ? codeResultText(step) : undefined,
    startedAt: step.startedAt,
    ...(endedAt !== undefined ? { endedAt, durationMs: Math.max(0, endedAt - step.startedAt) } : {}),
    category: 'other',
  };
};

/**
 * A question step as the transcript's own `ask_user` call — the canonical step model already draws it
 * ("Asked <question>"). Done the moment it is recorded: the turn ENDED on it, nothing is running.
 */
const questionToolCall = (step: ChatTurnQuestionStep): ToolCallInfo => ({
  id: step.id,
  toolName: 'ask_user',
  params: { question: step.question },
  status: 'done',
  success: true,
  outcome: 'succeeded',
  result: '',
  startedAt: step.startedAt,
  endedAt: step.endedAt ?? step.startedAt,
  durationMs: Math.max(0, (step.endedAt ?? step.startedAt) - step.startedAt),
  category: 'other',
});

/**
 * A browser step as the transcript's own `browser_<tool>` call — the canonical step model draws the browser family
 * (verb from the action, object from url/selector/text). A step waiting on the person's approval in that browser is
 * still running, and says so in its result line.
 */
const browserToolCall = (step: ChatTurnBrowserStep, turnLive: boolean): ToolCallInfo => {
  const done = step.endedAt !== undefined || !turnLive;
  const endedAt = step.endedAt ?? (done ? step.startedAt : undefined);
  const failed = Boolean(step.error) || step.state === 'failed';
  const waiting = !done && step.state === 'waiting_approval';
  return {
    id: step.id,
    toolName: step.tool,
    params: step.args ?? {},
    status: done ? 'done' : 'running',
    success: done ? !failed : undefined,
    ...(done ? { outcome: failed ? ('failed' as const) : ('succeeded' as const) } : {}),
    result: done ? (step.error || step.summary || '') : waiting ? `Waiting for your approval in ${step.browser || 'your browser'}` : undefined,
    startedAt: step.startedAt,
    ...(endedAt !== undefined ? { endedAt, durationMs: Math.max(0, endedAt - step.startedAt) } : {}),
    category: 'other',
  };
};

const toToolCall = (step: ChatTurnStep, turnLive: boolean): ToolCallInfo => {
  if (isBrowserStep(step)) return browserToolCall(step, turnLive);
  if (step.kind === 'handoff') return {id:step.id,toolName:'agent_handoff',params:{taskKey:step.taskKey,agentId:step.agentId},status:'done',startedAt:step.startedAt,category:'other'};
  if (step.kind === 'generation') return {id:step.id,toolName:'generation_proposal',params:{generationId:step.generationId},status:'done',startedAt:step.startedAt,category:'other'};
  if (isImageStep(step)) return imageToolCall(step, turnLive);
  if (isCodeStep(step)) return codeToolCall(step, turnLive);
  // 🔴 Before this, anything that was not an image or code step fell through to web_search below.
  if (isQuestionStep(step)) return questionToolCall(step);
  const done = step.endedAt !== undefined || !turnLive;
  const endedAt = step.endedAt ?? (done ? step.startedAt : undefined);
  return {
    id: step.id,
    toolName: 'web_search',
    params: { query: step.query },
    status: done ? 'done' : 'running',
    success: done ? !step.error : undefined,
    ...(done ? { outcome: step.error ? ('failed' as const) : ('succeeded' as const) } : {}),
    result: done ? searchResultText(step) : undefined,
    startedAt: step.startedAt,
    ...(endedAt !== undefined ? { endedAt, durationMs: Math.max(0, endedAt - step.startedAt) } : {}),
    category: 'search',
  };
};

/**
 * The Chat turn in the transcript's own terms. `content` is empty ON PURPOSE: the chat renders
 * the reply, so the transcript renders the head — clock line, thought, rail — and nothing else.
 */
export function toTranscriptMessage(input: ChatTurnInput): TranscriptMessage {
  const turn = input.turn;
  const live = Boolean(input.streaming);
  const steps = turn?.steps ?? [];
  const toolCalls = steps
    .filter(step => step.kind !== 'generation')
    .flatMap((step) => (isCodeStep(step) ? [toToolCall(step, live), ...codeFileToolCalls(step, live)] : [toToolCall(step, live)]));
  const segments: AssistantTurnSegment[] = toolCalls.map((toolCall, index) => ({
    id: `${input.id}:segment:${index}`,
    kind: 'tool_call',
    createdAt: toolCall.startedAt ?? turn?.startedAt ?? input.timestamp ?? Date.now(),
    toolCallId: toolCall.id,
  }));
  const thinking = input.thinking?.trim() ? input.thinking : undefined;
  const isThinking = live && !input.replyStarted && Boolean(thinking || input.expectingThought);
  // a thought is kept when there are words to show, or while one may still be arriving — never
  // for a settled turn whose only evidence of "thinking" is how long the answer took to start
  const keepThought = Boolean(thinking || isThinking);
  return {
    id: input.id,
    role: 'assistant',
    content: '',
    timestamp: turn?.startedAt ?? input.timestamp ?? Date.now(),
    ...(input.model ? { model: input.model } : {}),
    ...(keepThought ? { thinking: thinking ?? '' } : {}),
    isStreaming: live,
    isThinking,
    ...(turn?.endedAt !== undefined ? { endedAt: turn.endedAt } : {}),
    ...(turn?.thinkingMs !== undefined ? { thinkingMs: turn.thinkingMs } : {}),
    toolCalls,
    segments,
    runtimeKind: 'llm',
  };
}

/**
 * Favicons come through OUR proxy (`/api/favicon`, routes/faviconRoutes.js) — never the cited site
 * from the user's browser: that is an IP leak per render and hotlink-blocking hosts refuse it.
 */
export const chatFaviconUrl = (domain: string): string => `/api/favicon?domain=${encodeURIComponent(domain)}`;

/**
 * The sources a reply's `[n]` markers refer to — the turn's record, numbered by the ONE rule both
 * sides implement (`numberSources`: one id per URL, first appearance across every search step,
 * from 1; the server's tool loop numbers what it hands the model the same way).
 */
export function turnCitedSources(record: ChatTurnRecord | undefined): CitedSource[] {
  if (!record) return [];
  const flat = record.steps.flatMap((step) => (isSearchStep(step) ? step.sources ?? [] : []).map((source) => ({
    title: source.title || domainOf(source.url),
    url: source.url,
    domain: domainOf(source.url),
  })));
  return numberSources(flat);
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
