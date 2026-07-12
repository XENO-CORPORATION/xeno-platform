/**
 * aiService — the SINGLE frontend entrypoint for chat inference.
 *
 * The browser holds NO provider keys. Every chat call goes through the authed,
 * metered backend (POST /api/ai/chat), which proxies to the private API
 * (api.xenostudio.ai) — the only place provider keys live. This replaces every
 * direct browser→provider call (openrouter.ai / Gemini SDK / OpenAI SDK) and the
 * VITE_*_KEY / hardcoded keys those used. Mirrors the auth pattern of
 * billingService.ts and xenoProxyRequest.ts (Bearer 'xenoos_auth_token', /api).
 */

const API_BASE = '/api';

export type InferencePath = 'premium' | 'byok' | 'inhouse';

/** Multimodal content parts (OpenAI-style), for vision-capable models. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** Plain text, or an array of content parts for multimodal (image) messages. */
  content: string | ContentPart[];
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  /** premium (metered) · byok (your key) · inhouse (xeno-rt). Default premium. */
  path?: InferencePath;
  temperature?: number;
  maxTokens?: number;
  /** Stable id so a retried request is an idempotent no-op (no double-charge). */
  requestId?: string;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  model: string;
  provider: string;
  path: InferencePath;
  metered: boolean;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  /** Credits charged for a premium call (0 for byok/inhouse). */
  creditsCharged?: number;
}

/** Thrown on 402 — the user is out of credits for premium inference. */
export class InsufficientCreditsError extends Error {
  balance?: number;
  constructor(message: string, balance?: number) {
    super(message);
    this.name = 'InsufficientCreditsError';
    this.balance = balance;
  }
}

/** Thrown on 400 no_byok_key — the byok path needs a key the user hasn't added. */
export class BYOKKeyMissingError extends Error {
  provider: string;
  constructor(provider: string, message?: string) {
    super(message || `Add your ${provider} API key in Settings to use your own key.`);
    this.name = 'BYOKKeyMissingError';
    this.provider = provider;
  }
}

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem('xenoos_auth_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Run a chat completion through the metered backend. Never calls a provider directly. */
export async function chatComplete(opts: ChatOptions): Promise<ChatResult> {
  const res = await fetch(`${API_BASE}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      path: opts.path || 'premium',
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      requestId: opts.requestId,
    }),
    signal: opts.signal,
  });

  const data = await res.json().catch(() => ({} as any));

  if (res.status === 402) throw new InsufficientCreditsError(data.message || 'Insufficient credits', data.balance);
  if (res.status === 400 && data.error === 'no_byok_key') throw new BYOKKeyMissingError(data.provider, data.message);
  if (!res.ok) throw new Error(data.error || data.message || `Chat request failed (${res.status})`);

  return {
    content: data.content || '',
    model: data.model,
    provider: data.provider,
    path: (data.path as InferencePath) || 'premium',
    metered: !!data.metered,
    usage: data.usage,
    creditsCharged: data.credits_charged,
  };
}

/** Convenience: a single user prompt (+ optional system) → the assistant text. */
export async function chatPrompt(
  model: string,
  prompt: string,
  opts: { system?: string; path?: InferencePath; temperature?: number; maxTokens?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const messages: ChatMessage[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: prompt });
  const r = await chatComplete({ model, messages, path: opts.path, temperature: opts.temperature, maxTokens: opts.maxTokens, signal: opts.signal });
  return r.content;
}

/** Pre-generation cost preview (the "shown before it runs" trust rule). */
export async function estimateChat(opts: {
  model: string; messages?: ChatMessage[]; maxTokens?: number; path?: InferencePath;
}): Promise<{ credits: number; metered: boolean; path: InferencePath }> {
  try {
    const res = await fetch(`${API_BASE}/ai/chat/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ model: opts.model, messages: opts.messages || [], max_tokens: opts.maxTokens, path: opts.path || 'premium' }),
    });
    const d = await res.json().catch(() => ({} as any));
    return { credits: d.credits_estimate || 0, metered: !!d.metered, path: (d.path as InferencePath) || 'premium' };
  } catch {
    return { credits: 0, metered: false, path: opts.path || 'premium' };
  }
}
