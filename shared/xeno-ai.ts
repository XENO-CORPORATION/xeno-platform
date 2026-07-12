/**
 * @xeno/ai — the SHARED inference client. The "both paths" surface every XENO
 * product uses, sibling to xeno-account.ts. One call picks the path, previews the
 * cost, and (for premium) meters credits — identically across the ecosystem.
 *
 * The three paths (XENO-MONETIZATION-AND-ACCOUNT.md §3), all through the platform's
 * authed, metered /api/ai/chat (which proxies to the private API — products never
 * hold provider keys either):
 *   'premium' — frontier via XENO's keys → metered on credits
 *   'byok'    — the user's own stored key → €0, never metered
 *   'inhouse' — xeno-rt open/local models → near-zero, never metered
 *
 * Usage:
 *   import { createXenoAI } from './xeno-ai';
 *   const ai = createXenoAI({ getToken: () => localStorage.getItem('xenoos_auth_token') });
 *   const { content } = await ai.chat({ model: 'openai/gpt-5.4', messages, path: 'premium' });
 */

export type InferencePath = 'premium' | 'byok' | 'inhouse';

/** Multimodal content parts (OpenAI-style), for vision-capable models. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  path?: InferencePath;
  temperature?: number;
  maxTokens?: number;
  requestId?: string;
  signal?: AbortSignal;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider: string;
  path: InferencePath;
  metered: boolean;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  creditsCharged?: number;
}

export class InsufficientCreditsError extends Error {
  balance?: number;
  constructor(message: string, balance?: number) { super(message); this.name = 'InsufficientCreditsError'; this.balance = balance; }
}
export class BYOKKeyMissingError extends Error {
  provider: string;
  constructor(provider: string, message?: string) { super(message || `Add your ${provider} key.`); this.name = 'BYOKKeyMissingError'; this.provider = provider; }
}

export interface XenoAIConfig {
  /** Platform host that exposes /api/ai/*. Default https://xenostudio.ai */
  apiBase?: string;
  getToken: () => string | null | undefined | Promise<string | null | undefined>;
  fetchImpl?: typeof fetch;
}

export function createXenoAI(cfg: XenoAIConfig) {
  const base = (cfg.apiBase || 'https://xenostudio.ai').replace(/\/$/, '');
  const f = cfg.fetchImpl || (globalThis.fetch as typeof fetch);

  async function headers(): Promise<Record<string, string>> {
    const t = await cfg.getToken();
    return t ? { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` } : { 'Content-Type': 'application/json' };
  }

  return {
    /** Run a chat completion through the metered backend. Never touches a provider directly. */
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const res = await f(`${base}/api/ai/chat`, {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({
          model: req.model, messages: req.messages, path: req.path || 'premium',
          temperature: req.temperature, max_tokens: req.maxTokens, requestId: req.requestId,
        }),
        signal: req.signal,
      });
      const d = await res.json().catch(() => ({} as any));
      if (res.status === 402) throw new InsufficientCreditsError(d.message || 'Insufficient credits', d.balance);
      if (res.status === 400 && d.error === 'no_byok_key') throw new BYOKKeyMissingError(d.provider, d.message);
      if (!res.ok) throw new Error(d.error || d.message || `Chat failed (${res.status})`);
      return {
        content: d.content || '', model: d.model, provider: d.provider,
        path: (d.path as InferencePath) || 'premium', metered: !!d.metered, usage: d.usage, creditsCharged: d.credits_charged,
      };
    },

    /** Pre-generation cost preview (premium worst-case credits; 0 for byok/inhouse). */
    async estimate(req: { model: string; messages?: ChatMessage[]; maxTokens?: number; path?: InferencePath }): Promise<{ credits: number; metered: boolean }> {
      try {
        const res = await f(`${base}/api/ai/chat/estimate`, {
          method: 'POST',
          headers: await headers(),
          body: JSON.stringify({ model: req.model, messages: req.messages || [], max_tokens: req.maxTokens, path: req.path || 'premium' }),
        });
        const d = await res.json().catch(() => ({} as any));
        return { credits: d.credits_estimate || 0, metered: !!d.metered };
      } catch { return { credits: 0, metered: false }; }
    },

    /** The available model catalog with per-model inference paths. */
    async listModels(): Promise<any> {
      const res = await f(`${base}/api/models`, { headers: await headers() });
      if (!res.ok) return { companies: {} };
      return res.json();
    },
  };
}

export type XenoAI = ReturnType<typeof createXenoAI>;
