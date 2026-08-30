import { isPersistedConversationId } from './chatService';

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

export const webContextService = {
  async searchAndFetch(input: {
    conversationId: string;
    query: string;
    count?: number;
    signal?: AbortSignal;
  }): Promise<WebContextSearchResult> {
    if (!isPersistedConversationId(input.conversationId)) {
      throw new WebContextRequestError(
        'invalid_conversation_id',
        'Save this conversation before starting web research.',
        false,
      );
    }
    const response = await fetch('/api/chat/web-context/search', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        conversationId: input.conversationId,
        query: input.query,
        count: input.count,
        mode: 'research',
      }),
      signal: input.signal,
    });
    const raw = await response.text();
    let payload: any = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { /* stable error below */ }
    if (!response.ok || !payload?.ok) {
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
    return payload.data as WebContextSearchResult;
  },
};
