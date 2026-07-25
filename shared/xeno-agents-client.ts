/**
 * @xeno/agents-client — the SHARED, portable client for the hosted agent-runs API
 * (`xeno-agents-api`, live at https://api.xenostudio.ai/v1/agents).
 *
 * CANONICAL. Every XENO product (Hub, the desktop apps, the web console, agents,
 * SDKs) vendors THIS single file to dispatch and stream cloud agent runs — nobody
 * re-implements the wire contract. It is the generalized, framework-agnostic
 * distillation of the contract the XENO Agent CLI already speaks in its
 * `remote.ts` (capability negotiation + start/list/get/stop/events/attach with
 * SSE + NDJSON parsing). See `XENO AGENTS API - SPEC.md` §4–6.
 *
 * Zero dependencies. Works in Node ≥18, Electron (main or renderer) and browsers:
 * uses only global `fetch`, `ReadableStream`, `TextDecoder`, `AbortController`.
 * NO node-only imports, NO npm deps.
 *
 * Auth reality (2026-07): the server today accepts a platform **OIDC JWT**;
 * **API-key support is being added separately** (§13 caveat). This client is
 * auth-agnostic — it just sends `Authorization: Bearer <token>` — so it works with
 * either the moment the server accepts it.
 *
 * Usage:
 *   import { createAgentsClient } from './xeno-agents-client';
 *   const agents = createAgentsClient({ token: myPlatformJwt });
 *   const run = await agents.createRun({ prompt: 'Fix the failing tests', model: 'gpt-5.5' });
 *   for await (const ev of agents.attach(run.runId)) console.log(ev.type, ev.payload);
 *   await agents.stopRun(run.runId);
 */

/* ------------------------------------------------------------------ *
 * Wire types — LOCKED cross-repo contract (SPEC §5, server src/types.ts).
 * Re-derived from the server projection; do NOT invent shapes here.
 * ------------------------------------------------------------------ */

export const SCHEMA_VERSION = 1 as const;

/** The 15-state AgentRunStatus union (SPEC §5.2 / D8), verbatim. */
export type RunStatus =
  | "queued"
  | "starting"
  | "running"
  | "blocked"
  | "waiting_for_user"
  | "waiting_for_tool"
  | "waiting_for_hook"
  | "waiting_for_permission"
  | "paused"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled"
  | "interrupted"
  | "detached";

/** Terminal states — a run in one of these will never transition again. */
export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "skipped",
  "cancelled",
  "interrupted",
]);

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Terminal lifecycle event types — the attach stream ends after one of these. */
export const TERMINAL_LIFECYCLE_EVENTS: ReadonlySet<string> = new Set<string>([
  "run.completed",
  "run.failed",
  "run.cancelled",
]);

export type PermissionMode =
  | "default"
  | "plan"
  | "acceptEdits"
  | "auto"
  | "dontAsk"
  | "bypassPermissions";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface RunUsage {
  input: number;
  output: number;
  total: number;
  estimatedCostUsd?: number;
}

export interface RunGit {
  branch?: string;
  baseRef?: string;
  commit?: string;
}

export interface AgentRef {
  name?: string;
  scope?: string;
  path?: string;
  description?: string;
  model?: string;
}

export interface HostedReferences {
  playbooks?: string[];
  knowledge?: string[];
  secrets?: string[];
}

export interface RunBudget {
  /** Hard cap; sizes the ledger hold (SPEC §8). */
  maxCredits?: number;
}

/**
 * Public projection of a run (SPEC §5.2, server `RunRecordPublic`). Host-local
 * fields (absolute cwd, worker pid, stdout/stderr paths) are stripped server-side.
 */
export interface AgentRunRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  sessionId: string;
  rootRunId: string;
  parentRunId?: string;
  workspaceId: string;
  prompt: string;
  title?: string;
  status: RunStatus;
  statusReason?: string;
  blockedReason?: string;
  model: string;
  effort?: Effort;
  agent?: AgentRef;
  permissionMode: PermissionMode;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  lastActivityAt?: string;
  exitCode?: number;
  git?: RunGit;
  usage: RunUsage;
  children: string[];
  tags: string[];
  creditsHeld?: number;
  creditsSettled?: number;
  url: string;
}

/** Compact list item (SPEC §4.3, server `RunListItem`). */
export interface RunListItem {
  runId: string;
  status: RunStatus;
  url: string;
  createdAt: string;
  model: string;
  promptPreview: string;
}

/**
 * Persisted, append-only run event (SPEC §5.3). `sequence` is a per-run monotonic
 * integer assigned at append time — the SSE/NDJSON resume cursor.
 */
export interface RunEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  sequence: number;
  type: string;
  timestamp: string;
  /** The SDK runtime-event body. The wire nests all event data here. */
  payload: Record<string, unknown>;
  // ---- Convenience: common `payload` fields hoisted to the top level by the client
  // (see hoistRunEvent) so consumers can read `ev.text` / `ev.toolName` / `ev.usage`
  // directly without unwrapping `payload`. `payload` is always preserved. ----
  /** `model.text.delta` → the streamed text chunk. */
  text?: string;
  /** `tool.started` / `tool.completed` → the tool's name. */
  toolName?: string;
  /** `tool.started` → a truncated preview of the tool input. */
  inputPreview?: Record<string, unknown>;
  /** `tool.completed` → a truncated preview of the tool result. */
  resultPreview?: unknown;
  /** `turn.completed` → per-turn token totals. */
  tokenUsage?: { input: number; output: number; total: number };
  /** `run.usage` → run token totals. */
  usage?: { input: number; output: number; total: number };
  /** `run.usage` → credits actually settled for the run. */
  creditsSettled?: number;
  /** `turn.completed` → a short preview of the assistant output. */
  outputPreview?: string;
  /** `*.failed` → error/reason text. */
  error?: string;
  reason?: string;
  /** `run.status` → the run's status/statusReason. */
  status?: string;
  statusReason?: string;
  [key: string]: unknown;
}

/**
 * The `XenoRuntimeEvent` kinds relayed verbatim in `RunEvent.payload` (SPEC §6.1,
 * schema of record: xeno-agent-sdk `src/runtime/events.ts`). The canonical 12 kinds
 * plus the SDK's additive extensions — additive-only per D3 (a wire type now).
 */
export type XenoRuntimeEventType =
  // canonical 12 (SPEC §6.1)
  | "thread.started"
  | "turn.started"
  | "turn.completed"
  | "turn.failed"
  | "turn.interrupted"
  | "query.state"
  | "query.watchdog"
  | "model.text.delta"
  | "tool.started"
  | "tool.permission"
  | "tool.completed"
  | "diff.completed"
  // additive SDK extensions (relayed unchanged)
  | "provider.event"
  | "tool.history.repaired"
  | "tool.failure_guard.tripped"
  | "turn.suspended"
  | "turn.continuation_enqueued"
  | "turn.continuation_resumed"
  | "turn.continuation_exhausted"
  | (string & {});

/**
 * The SDK runtime-event envelope carried inside `RunEvent.payload` (its own
 * `id/sequence/timestamp/threadId/turnId` is preserved for fidelity; the OUTER
 * `RunEvent.sequence` is the durable cursor). Kept open (index signature) because
 * per-kind payloads live in the SDK, not on the wire boundary.
 */
export interface XenoRuntimeEvent {
  id?: string;
  sequence?: number;
  type: XenoRuntimeEventType;
  timestamp?: string;
  threadId?: string;
  turnId?: string;
  [key: string]: unknown;
}

/** Control-plane capability negotiation payload (SPEC §4.1). */
export interface AgentsApiStatus {
  schemaVersion: typeof SCHEMA_VERSION;
  ok: boolean;
  service?: string;
  version?: string;
  capabilities: string[];
}

/** The v0.1 required capability set the CLI negotiates against (SPEC §4.1). */
export const REQUIRED_CAPABILITIES = [
  "runs.start",
  "runs.list",
  "runs.get",
  "runs.events",
  "runs.attach",
  "runs.stop",
] as const;

/* ------------------------------------------------------------------ *
 * Errors — server taxonomy `{ "error": "<code>" }` (SPEC §4, app.ts).
 * NOTE: the live server serializes a BARE string code, not `{code,message}`.
 * ------------------------------------------------------------------ */

export type AgentsApiErrorCode =
  | "unauthorized" // 401
  | "forbidden" // 403
  | "run_not_found" // 404
  | "not_found" // 404
  | "insufficient_credits" // 402
  | "budget_exceeded" // 402
  | "invalid_request" // 400
  | "rate_limited" // 429 (reserved — not in the current server enum, mapped defensively)
  | "http_error" // any other non-2xx with no recognized code
  | "network_error"; // fetch threw / aborted / timed out

const STATUS_TO_CODE: Record<number, AgentsApiErrorCode> = {
  400: "invalid_request",
  401: "unauthorized",
  402: "insufficient_credits",
  403: "forbidden",
  404: "run_not_found",
  429: "rate_limited",
};

/** Typed API error carrying the server's error code + HTTP status. */
export class AgentsApiError extends Error {
  readonly code: AgentsApiErrorCode;
  readonly status: number;
  /** True when caused by a fetch/abort/timeout rather than an HTTP response. */
  readonly isNetwork: boolean;
  readonly cause?: unknown;

  constructor(
    code: AgentsApiErrorCode,
    message: string,
    status = 0,
    opts?: { isNetwork?: boolean; cause?: unknown },
  ) {
    super(message);
    this.name = "AgentsApiError";
    this.code = code;
    this.status = status;
    this.isNetwork = opts?.isNetwork ?? false;
    this.cause = opts?.cause;
  }

  get isBudgetExceeded(): boolean {
    return this.code === "budget_exceeded";
  }
  get isInsufficientCredits(): boolean {
    return this.code === "insufficient_credits";
  }
  get isUnauthorized(): boolean {
    return this.code === "unauthorized";
  }
  get isNotFound(): boolean {
    return this.code === "run_not_found" || this.code === "not_found";
  }
}

export function isAgentsApiError(err: unknown): err is AgentsApiError {
  return err instanceof AgentsApiError;
}

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

export type TokenProvider =
  | string
  | (() => string | null | undefined | Promise<string | null | undefined>);

export interface AgentsClientConfig {
  /** Base of the agents API. Default `https://api.xenostudio.ai/v1/agents`. */
  baseUrl?: string;
  /** Platform bearer — an OIDC JWT or (once supported) a platform API key. */
  token: TokenProvider;
  /** Optional workspace selector → `x-xeno-workspace` header (SPEC §7). */
  workspace?: string;
  /** Optional fetch impl (custom / testing). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Default timeout (ms) for non-streaming requests. Default 30_000. */
  timeoutMs?: number;
}

/** Normalized input to run creation (SPEC §4.2, server `CreateRunInput`). */
export interface CreateRunInput {
  /** Required, non-empty. */
  prompt: string;
  command?: string;
  cwd?: string;
  model?: string;
  effort?: Effort;
  permissionMode?: PermissionMode;
  title?: string;
  environmentId?: string;
  attempts?: number;
  hostedReferences?: HostedReferences;
  agent?: AgentRef;
  workspace?: string;
  /** Continuity (D2): seed context from a prior run. */
  previousRunId?: string;
  /** Hard credit cap; sizes the ledger hold (SPEC §8). */
  budget?: RunBudget;
  /** v0.2 git workspace provisioning. */
  repo?: { url?: string; ref?: string };
  /** Idempotency key → `Idempotency-Key` header. */
  idempotencyKey?: string;
}

export interface ListRunsOptions {
  limit?: number;
  signal?: AbortSignal;
}

export interface EventsOptions {
  /** Trailing N events. */
  tail?: number;
  /** Return events with `sequence > since`. Wins over `tail` if both set. */
  since?: number;
  signal?: AbortSignal;
}

export type AttachTransport = "ndjson" | "sse";

export interface AttachOptions {
  /** Cursor: start from the trailing N events. */
  tail?: number;
  /** Cursor: resume from `sequence > since` (SSE `Last-Event-ID` / `?since`). */
  since?: number;
  /** Abort the stream. */
  signal?: AbortSignal;
  /** Wire transport. Default `ndjson`; `sse` sends `Accept: text/event-stream`. */
  transport?: AttachTransport;
  /**
   * Auto-reconnect on a dropped stream, resuming from the last seen `sequence`.
   * Default false. Stops after a terminal lifecycle event or when aborted.
   */
  reconnect?: boolean;
  /** Base backoff (ms) between reconnect attempts. Default 1000. */
  reconnectDelayMs?: number;
  /** Max reconnect attempts after a drop (per gap). Default 5. */
  maxReconnects?: number;
}

const DEFAULT_BASE_URL = "https://api.xenostudio.ai/v1/agents";

export function createAgentsClient(config: AgentsClientConfig) {
  const rawBase = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  // `new URL(path, base)` needs a trailing slash on base to treat it as a dir.
  const baseWithSlash = `${rawBase}/`;
  const f: typeof fetch = config.fetchImpl || (globalThis.fetch as typeof fetch);
  const defaultTimeout = config.timeoutMs ?? 30_000;

  if (typeof f !== "function") {
    throw new AgentsApiError(
      "network_error",
      "No fetch implementation available; pass { fetchImpl } (Node < 18).",
    );
  }

  function url(path: string, query?: Record<string, string | number | undefined>): string {
    const u = new URL(path.replace(/^\/+/, ""), baseWithSlash);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }

  async function authHeaders(json: boolean, extra?: Record<string, string>): Promise<Record<string, string>> {
    const t = typeof config.token === "function" ? await config.token() : config.token;
    const h: Record<string, string> = { accept: "application/json" };
    if (t) h.authorization = `Bearer ${t}`;
    if (json) h["content-type"] = "application/json";
    if (config.workspace) h["x-xeno-workspace"] = config.workspace;
    return { ...h, ...(extra || {}) };
  }

  /** Compose the caller's AbortSignal with a timeout (Node ≥18 safe). */
  function withTimeout(
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): { signal: AbortSignal; cancel: () => void } {
    const ctl = new AbortController();
    const onAbort = () => ctl.abort((signal as { reason?: unknown } | undefined)?.reason);
    if (signal) {
      if (signal.aborted) ctl.abort((signal as { reason?: unknown }).reason);
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(() => ctl.abort(new AgentsApiError("network_error", `Request timed out after ${timeoutMs}ms`)), timeoutMs);
      if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();
    }
    return {
      signal: ctl.signal,
      cancel: () => {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      },
    };
  }

  function normalizeNetworkError(err: unknown): AgentsApiError {
    if (isAgentsApiError(err)) return err;
    const anyErr = err as { name?: string; message?: string } | undefined;
    if (anyErr?.name === "AbortError") {
      return new AgentsApiError("network_error", anyErr.message || "Request aborted", 0, { isNetwork: true, cause: err });
    }
    return new AgentsApiError("network_error", anyErr?.message || String(err), 0, { isNetwork: true, cause: err });
  }

  /** Map a non-2xx response body `{ error: "<code>" }` to a typed AgentsApiError. */
  async function toError(res: Response): Promise<AgentsApiError> {
    let code: AgentsApiErrorCode | undefined;
    let bodyText = "";
    try {
      bodyText = await res.text();
      const parsed = bodyText ? JSON.parse(bodyText) : undefined;
      // Server shape: { "error": "<code>" }. Also tolerate { error: { code } }.
      const raw = typeof parsed?.error === "string"
        ? parsed.error
        : typeof parsed?.error?.code === "string"
          ? parsed.error.code
          : undefined;
      if (raw) code = raw as AgentsApiErrorCode;
    } catch {
      /* non-JSON body */
    }
    const resolved: AgentsApiErrorCode = code ?? STATUS_TO_CODE[res.status] ?? "http_error";
    const message = code
      ? `Agents API error: ${code} (HTTP ${res.status})`
      : `Agents API request failed (HTTP ${res.status})${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`;
    return new AgentsApiError(resolved, message, res.status);
  }

  async function requestJson<T>(
    method: string,
    path: string,
    opts?: { query?: Record<string, string | number | undefined>; body?: unknown; signal?: AbortSignal; timeoutMs?: number; headers?: Record<string, string> },
  ): Promise<T> {
    const { signal, cancel } = withTimeout(opts?.signal, opts?.timeoutMs ?? defaultTimeout);
    try {
      const res = await f(url(path, opts?.query), {
        method,
        headers: await authHeaders(opts?.body !== undefined, opts?.headers),
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal,
      });
      if (!res.ok) throw await toError(res);
      return (await res.json()) as T;
    } catch (err) {
      throw normalizeNetworkError(err);
    } finally {
      cancel();
    }
  }

  /* ----------------------------- streaming ----------------------------- */

  /** One connection's worth of the attach stream. Yields parsed RunEvents. */
  async function* streamOnce(
    runId: string,
    opts: { tail?: number; since?: number; transport: AttachTransport; signal?: AbortSignal },
  ): AsyncGenerator<RunEvent, void, void> {
    const sse = opts.transport === "sse";
    const headers = await authHeaders(false, {
      accept: sse ? "text/event-stream" : "application/x-ndjson",
      // SSE resume: header wins over ?since server-side.
      ...(sse && opts.since !== undefined ? { "last-event-id": String(opts.since) } : {}),
    });
    const res = await f(
      url(`runs/${encodeURIComponent(runId)}/attach`, {
        follow: "true",
        tail: opts.tail,
        since: !sse ? opts.since : undefined,
      }),
      { method: "GET", headers, signal: opts.signal },
    );
    if (!res.ok) throw await toError(res);
    if (!res.body) return;

    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const emit = function* (chunk: string): Generator<RunEvent> {
      const evt = parseEventLine(chunk);
      if (evt) yield evt;
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (sse) {
          // SSE frames are separated by a blank line.
          let idx: number;
          while ((idx = indexOfFrameBreak(buffer)) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx).replace(/^(\r?\n){1,2}/, "");
            const parsed = parseSseFrame(frame);
            if (parsed === "DONE") return;
            if (parsed) yield parsed;
          }
        } else {
          let nl: number;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            yield* emit(line);
          }
        }
      }
      // flush tail
      buffer += decoder.decode();
      if (sse) {
        const parsed = parseSseFrame(buffer);
        if (parsed && parsed !== "DONE") yield parsed;
      } else {
        yield* emit(buffer);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Attach to a run and stream its events as an async iterator (SPEC §4.6, §6.3).
   * Default NDJSON; pass `{ transport: 'sse' }` for Server-Sent Events. With
   * `{ reconnect: true }` a dropped stream auto-resumes from the last `sequence`.
   */
  async function* attach(runId: string, options: AttachOptions = {}): AsyncGenerator<RunEvent, void, void> {
    const transport: AttachTransport = options.transport ?? "ndjson";
    const reconnectDelay = options.reconnectDelayMs ?? 1000;
    const maxReconnects = options.maxReconnects ?? 5;

    let since = options.since;
    let tail = options.tail;
    let attempts = 0;
    let sawTerminal = false;

    for (;;) {
      try {
        for await (const ev of streamOnce(runId, { tail, since, transport, signal: options.signal })) {
          // advance the resume cursor
          if (typeof ev.sequence === "number") since = ev.sequence;
          tail = undefined; // after first connect, resume by sequence, not tail
          attempts = 0; // a clean event resets the backoff budget
          yield ev;
          if (TERMINAL_LIFECYCLE_EVENTS.has(ev.type)) {
            sawTerminal = true;
          }
        }
      } catch (err) {
        const e = normalizeNetworkError(err);
        // Aborted by the caller, or a real HTTP error → do not reconnect.
        if (options.signal?.aborted || !e.isNetwork || !options.reconnect) throw e;
        if (++attempts > maxReconnects) throw e;
        await delay(reconnectDelay * attempts, options.signal);
        continue;
      }
      // Stream ended cleanly.
      if (sawTerminal || !options.reconnect || options.signal?.aborted) return;
      if (++attempts > maxReconnects) return;
      // Non-terminal end (e.g. idle server close) — resume from cursor.
      await delay(reconnectDelay * attempts, options.signal);
    }
  }

  /**
   * Convenience callback wrapper over `attach`. Returns a controller with a
   * `close()` and a `done` promise that resolves when the stream ends.
   */
  function onEvent(
    runId: string,
    handler: (event: RunEvent) => void | Promise<void>,
    options: AttachOptions = {},
  ): { close: () => void; done: Promise<void> } {
    const ctl = new AbortController();
    const signal = options.signal
      ? anySignal([options.signal, ctl.signal])
      : ctl.signal;
    const done = (async () => {
      for await (const ev of attach(runId, { ...options, signal })) {
        await handler(ev);
      }
    })();
    return { close: () => ctl.abort(), done };
  }

  /* ------------------------------- API -------------------------------- */

  return {
    /** Resolved base URL (with trailing path stripped). */
    baseUrl: rawBase,

    /** GET /status — capability negotiation (SPEC §4.1). */
    status: (opts?: { signal?: AbortSignal }) =>
      requestJson<AgentsApiStatus>("GET", "status", { signal: opts?.signal }),

    /** True iff the server advertises every required v0.1 capability. */
    async supportsRequiredCapabilities(opts?: { signal?: AbortSignal }): Promise<boolean> {
      const s = await this.status(opts);
      return REQUIRED_CAPABILITIES.every((c) => s.capabilities.includes(c));
    },

    /** POST /runs — create a durable, asynchronous run (SPEC §4.2). */
    async createRun(input: CreateRunInput, opts?: { signal?: AbortSignal }): Promise<AgentRunRecord> {
      if (!input.prompt || !input.prompt.trim()) {
        throw new AgentsApiError("invalid_request", "createRun requires a non-empty prompt");
      }
      const { idempotencyKey, ...rest } = input;
      const res = await requestJson<{ schemaVersion: 1; run: AgentRunRecord }>("POST", "runs", {
        body: { schemaVersion: SCHEMA_VERSION, ...rest },
        signal: opts?.signal,
        ...(idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {}),
      });
      return res.run;
    },

    /** GET /runs?limit=<n> — list the caller's runs (SPEC §4.3). */
    async listRuns(options: ListRunsOptions = {}): Promise<RunListItem[]> {
      const res = await requestJson<{ schemaVersion: 1; runs: RunListItem[] }>("GET", "runs", {
        query: { limit: options.limit },
        signal: options.signal,
      });
      return res.runs;
    },

    /** GET /runs/:id — fetch one run (SPEC §4.4). 404 → run_not_found. */
    async getRun(runId: string, opts?: { signal?: AbortSignal }): Promise<AgentRunRecord> {
      const res = await requestJson<{ schemaVersion: 1; run: AgentRunRecord }>(
        "GET",
        `runs/${encodeURIComponent(runId)}`,
        { signal: opts?.signal },
      );
      return res.run;
    },

    /** GET /runs/:id/events — event history, no follow (SPEC §4.5). */
    async getEvents(runId: string, options: EventsOptions = {}): Promise<RunEvent[]> {
      const res = await requestJson<{ schemaVersion: 1; events: RunEvent[] }>(
        "GET",
        `runs/${encodeURIComponent(runId)}/events`,
        { query: { tail: options.tail, since: options.since }, signal: options.signal },
      );
      return (res.events || []).map((e) => (isRunEventLike(e) ? hoistRunEvent(e) : e));
    },

    /** POST /runs/:id/stop — graceful stop (SPEC §4.7). */
    async stopRun(runId: string, opts?: { signal?: AbortSignal }): Promise<AgentRunRecord> {
      const res = await requestJson<{ schemaVersion: 1; run: AgentRunRecord }>(
        "POST",
        `runs/${encodeURIComponent(runId)}/stop`,
        { signal: opts?.signal },
      );
      return res.run;
    },

    attach,
    onEvent,
  };
}

export type AgentsClient = ReturnType<typeof createAgentsClient>;

/* ------------------------------------------------------------------ *
 * Internal parsing / stream helpers (module-scoped, pure).
 * ------------------------------------------------------------------ */

/** Parse a single NDJSON line into a RunEvent (skips blanks / [DONE]). */
function parseEventLine(line: string): RunEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "[DONE]" || trimmed === "data: [DONE]") return null;
  const data = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (!data || data === "[DONE]") return null;
  try {
    const parsed = JSON.parse(data);
    return isRunEventLike(parsed) ? hoistRunEvent(parsed as RunEvent) : null;
  } catch {
    return null;
  }
}

/**
 * Parse one SSE frame (lines up to a blank line). Returns the RunEvent, the
 * sentinel "DONE", or null (comment/heartbeat/unparseable). Honors `data:` and
 * ignores `: ping` comments and bare `id:` lines.
 */
function parseSseFrame(frame: string): RunEvent | "DONE" | null {
  const lines = frame.split(/\r?\n/);
  const dataParts: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue; // comment / heartbeat
    if (line.startsWith("data:")) {
      dataParts.push(line.slice(5).replace(/^ /, ""));
    }
    // `id:` / `event:` lines carry no payload for us — the cursor comes from the
    // event's own `sequence`.
  }
  if (dataParts.length === 0) return null;
  const data = dataParts.join("\n").trim();
  if (!data) return null;
  if (data === "[DONE]") return "DONE";
  try {
    const parsed = JSON.parse(data);
    return isRunEventLike(parsed) ? hoistRunEvent(parsed as RunEvent) : null;
  } catch {
    return null;
  }
}

/** Index of the SSE frame separator (`\n\n` or `\r\n\r\n`) in the buffer, or -1. */
function indexOfFrameBreak(buffer: string): number {
  const a = buffer.indexOf("\n\n");
  const b = buffer.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function isRunEventLike(v: unknown): v is RunEvent {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).type === "string" &&
    typeof (v as Record<string, unknown>).sequence === "number"
  );
}

// Common SDK event fields live under `payload` on the wire. Hoist them to the top
// of the RunEvent so consumers can read `ev.text` / `ev.toolName` / `ev.usage`
// directly. Additive + non-destructive: `payload` is preserved and an existing
// top-level field is never overwritten.
const HOISTED_PAYLOAD_FIELDS = [
  "text", "toolName", "inputPreview", "resultPreview",
  "tokenUsage", "usage", "creditsSettled", "outputPreview",
  "error", "reason", "status", "statusReason",
] as const;
function hoistRunEvent(ev: RunEvent): RunEvent {
  const p = ev.payload as Record<string, unknown> | undefined;
  if (p && typeof p === "object") {
    const top = ev as Record<string, unknown>;
    for (const k of HOISTED_PAYLOAD_FIELDS) {
      if (p[k] !== undefined && top[k] === undefined) top[k] = p[k];
    }
    // `model.text.delta` sometimes carries the chunk as `delta`; normalize to `text`.
    if (top.text === undefined && typeof p.delta === "string") top.text = p.delta;
  }
  return ev;
}

/** Abortable delay. Rejects nothing — resolves early if the signal aborts. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Combine multiple AbortSignals into one (Node ≥18 safe; no AbortSignal.any dep). */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const ctl = new AbortController();
  const onAbort = (s: AbortSignal) => () => ctl.abort((s as { reason?: unknown }).reason);
  for (const s of signals) {
    if (s.aborted) {
      ctl.abort((s as { reason?: unknown }).reason);
      break;
    }
    s.addEventListener("abort", onAbort(s), { once: true });
  }
  return ctl.signal;
}
