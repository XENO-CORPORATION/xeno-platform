import { isPersistedConversationId } from './chatService';
import { parseWebJobProgress, type WebJobProgress } from '@xenosystem/web-context-client/progress';

export type WebContextProgress = WebJobProgress;

export interface WebContextEvidence {
  evidenceId?: string;
  sourceUrl?: string;
  finalUrl?: string;
  retrievedAt?: string;
  executor?: { kind?: string; id?: string; version?: string };
  policy?: { decision?: string; reasons?: string[] };
  content?: { sha256?: string; bytes?: number; truncated?: boolean };
  citations?: Array<{ url: string; title?: string }>;
}

export interface WebContextSource {
  url: string;
  title: string;
  description: string;
  rank: number;
  provider: string;
  content: string;
  fetchStatus: string;
  evidence?: WebContextEvidence | null;
}

export interface PersistedWebContext {
  schema: 'xeno.chat.web-context.v1';
  operation: 'search-and-fetch';
  query: string;
  requestId: string;
  terminalReason: string;
  evidenceId?: string | null;
  retrievedAt: string;
  sources: Array<{
    uri: string;
    title: string;
    description?: string;
    provider?: string;
    rank?: number;
    fetchStatus?: string;
    evidenceId?: string;
    finalUrl?: string;
    retrievedAt?: string;
  }>;
}

export interface WebContextSearchResult {
  operation: 'search-and-fetch';
  query: string;
  sources: WebContextSource[];
  job: {
    state: string;
    completedPages: number;
    failedPages: number;
    excludedPages: number;
  } | null;
  webContextReceiptId: string | null;
  searchContext: PersistedWebContext;
}

export class WebContextRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'WebContextRequestError';
  }
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('xenoos_auth_token');
  const workspace = localStorage.getItem('xeno_active_workspace_id');
  return {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(isPersistedConversationId(workspace) ? { 'x-xeno-workspace': workspace } : {}),
  };
}

function parseSearchResult(value: unknown): WebContextSearchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WebContextRequestError('web_context_stream_invalid', 'Web research returned an invalid result.', true);
  }
  const candidate = value as Partial<WebContextSearchResult>;
  if (candidate.operation !== 'search-and-fetch' || typeof candidate.query !== 'string'
    || !Array.isArray(candidate.sources) || !candidate.searchContext
    || candidate.searchContext.schema !== 'xeno.chat.web-context.v1'
    || candidate.searchContext.operation !== 'search-and-fetch'
    || typeof candidate.searchContext.requestId !== 'string'
    || typeof candidate.searchContext.retrievedAt !== 'string'
    || !Array.isArray(candidate.searchContext.sources)
    || !(candidate.webContextReceiptId === null || typeof candidate.webContextReceiptId === 'string')) {
    throw new WebContextRequestError('web_context_stream_invalid', 'Web research returned an invalid result.', true);
  }
  for (const source of candidate.sources) {
    if (!source || typeof source !== 'object' || typeof source.url !== 'string'
      || !source.url.startsWith('https://') || typeof source.title !== 'string'
      || typeof source.content !== 'string' || typeof source.fetchStatus !== 'string') {
      throw new WebContextRequestError('web_context_stream_invalid', 'Web research returned an invalid source.', true);
    }
  }
  return candidate as WebContextSearchResult;
}

export const webContextService = {
  async searchAndFetch(input: {
    conversationId: string;
    query: string;
    count?: number;
    depth?: 'quick' | 'deep';
    signal?: AbortSignal;
    onProgress?: (progress: WebContextProgress) => void | Promise<void>;
  }): Promise<WebContextSearchResult> {
    if (!isPersistedConversationId(input.conversationId)) {
      throw new WebContextRequestError(
        'invalid_conversation_id',
        'Save this conversation before starting web research.',
        false,
      );
    }
    const response = await fetch('/api/chat/web-context/stream', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        conversationId: input.conversationId,
        query: input.query,
        count: input.count,
        mode: 'research',
        depth: input.depth ?? 'quick',
      }),
      signal: input.signal,
    });
    if (!response.ok) {
      const raw = await response.text();
      let payload: any = {};
      try { payload = raw ? JSON.parse(raw) : {}; } catch { /* stable error below */ }
      const rawError = payload?.error;
      const error = rawError && typeof rawError === 'object' ? rawError : {};
      throw new WebContextRequestError(
        String(error.code || (response.status === 429 ? 'web_context_rate_limited' : 'web_context_unavailable')),
        typeof rawError === 'string'
          ? rawError
          : String(error.message || 'Web research is temporarily unavailable.'),
        response.status === 429 || Boolean(error.retryable),
        typeof error.requestId === 'string' ? error.requestId : undefined,
      );
    }
    if (!response.body) {
      throw new WebContextRequestError('web_context_stream_missing', 'Web research returned no progress stream.', true);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: WebContextSearchResult | null = null;
    let terminalError: WebContextRequestError | null = null;

    const consumeFrame = async (frame: string) => {
      let event = 'message';
      const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length === 0) return;
      let payload: unknown;
      try { payload = JSON.parse(data.join('\n')); }
      catch { throw new WebContextRequestError('web_context_stream_invalid', 'Web research returned an invalid stream event.', true); }
      if (event === 'progress') {
        let progress: WebContextProgress;
        try { progress = parseWebJobProgress(payload); }
        catch { throw new WebContextRequestError('web_context_stream_invalid', 'Web research returned invalid progress.', true); }
        await input.onProgress?.(progress);
      } else if (event === 'result') {
        result = parseSearchResult(payload);
      } else if (event === 'error') {
        const error = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
        terminalError = new WebContextRequestError(
          typeof error.code === 'string' ? error.code : 'web_context_unavailable',
          typeof error.message === 'string' ? error.message : 'Web research is temporarily unavailable.',
          error.retryable === true,
          typeof error.requestId === 'string' ? error.requestId : undefined,
        );
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        await consumeFrame(frame);
        boundary = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
    if (buffer.trim()) await consumeFrame(buffer);
    if (terminalError) throw terminalError;
    if (!result) throw new WebContextRequestError('web_context_stream_incomplete', 'Web research ended before returning evidence.', true);
    return result;
  },
};
