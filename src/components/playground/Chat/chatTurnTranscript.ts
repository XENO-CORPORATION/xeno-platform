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
}

export interface ChatTurnImageUsage { input: number; output: number; total: number }

export type ChatTurnStep = ChatTurnSearchStep | ChatTurnImageStep;

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
  | { type: 'search_start'; query?: string; iteration?: number }
  | { type: 'search_result'; query?: string; count?: number; sources?: Array<{ url?: string; title?: string }> }
  | { type: 'search_error'; query?: string; code?: string; message?: string }
  | { type: 'image_start'; index?: number; prompt?: string; aspectRatio?: string }
  | { type: 'image_result'; index?: number; image?: { id?: string; aspectRatio?: string; width?: number; height?: number; model?: string; usage?: Partial<ChatTurnImageUsage> } }
  | { type: 'image_error'; index?: number; code?: string; message?: string };

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
  if (event.type === 'image_start' || event.type === 'image_result' || event.type === 'image_error') {
    return applyImageEvent(record, event, now);
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

/** Close the record: every still-open step is marked ended, and the turn is stamped. */
export function closeTurnRecord(record: ChatTurnRecord, endedAt = Date.now()): ChatTurnRecord {
  return {
    ...record,
    endedAt,
    steps: record.steps.map((step) => (step.endedAt === undefined ? { ...step, endedAt } : step)),
  };
}

/** Read a stored `turn` column back; anything that is not a v1 record is treated as absent. */
export function normalizeStoredTurn(value: unknown): ChatTurnRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Partial<ChatTurnRecord>;
  if (record.schema !== TURN_SCHEMA || typeof record.startedAt !== 'number' || !Array.isArray(record.steps)) return undefined;
  const steps = record.steps.flatMap((raw): ChatTurnStep[] => {
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
      }];
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

const toToolCall = (step: ChatTurnStep, turnLive: boolean): ToolCallInfo => {
  if (isImageStep(step)) return imageToolCall(step, turnLive);
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
  const toolCalls = steps.map((step) => toToolCall(step, live));
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
