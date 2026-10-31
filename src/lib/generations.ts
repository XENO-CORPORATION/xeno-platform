/** Shared Studio/composer REST boundary. Never dispatches a text model. */
import { getAccessToken } from '@/lib/authSession';
import { embedArea } from '@/lib/workspaceEmbed';
/** The platform API authenticates by bearer token; a bare same-origin fetch is refused. */
export const generationAuthHeaders = (): Record<string, string> => { const token = typeof window === 'undefined' ? null : getAccessToken(); return token ? { Authorization: `Bearer ${token}` } : {}; };
/** One request key per exact request, kept across a reload: a submit whose reply was lost is REPLAYED under the
 *  same key (the server returns the same generation) instead of being sent again as new work. */
export function stableRequestKey(request: GenerationRequest): string {
  const id = 'xeno.generation.key:' + JSON.stringify([request.type, request.model, request.prompt, request.settings, request.referenceAssetIds, request.projectId || '', request.conversationId || '']);
  try { const kept = window.sessionStorage.getItem(id); if (kept) return kept; } catch { /* storage unavailable: the key lives for this call only */ }
  const key = crypto.randomUUID();
  try { window.sessionStorage.setItem(id, key); } catch { /* same */ }
  return key;
}
/** Forget the key once the server has answered, so the same prompt can be generated again deliberately. */
export function releaseRequestKey(request: GenerationRequest): void {
  try { window.sessionStorage.removeItem('xeno.generation.key:' + JSON.stringify([request.type, request.model, request.prompt, request.settings, request.referenceAssetIds, request.projectId || '', request.conversationId || ''])); } catch { /* nothing kept */ }
}
export type GenerationType = 'image' | 'video' | 'audio' | '3d';
export type GenerationModel = { id: string; name?: string; type: GenerationType; endpoint: string; settings: Record<string, { values: string[]; default?: string }>; references: { max: number; modes?: string[] }; tariff?: { revision: string; maxRetailCredits: number }; evidence?: unknown };
export type GenerationCatalog = { types: Array<{ type: GenerationType; available: boolean; reason?: string; models: GenerationModel[]; tariff: { revision: string; maxRetailCredits: number } | null }> };
export type GenerationRequest = { type: GenerationType; model: string; prompt: string; settings: Record<string, string>; referenceAssetIds: string[]; projectId?: string; conversationId?: string; area?: string };
export type GenerationQuote = { quoteToken: string; requestHash: string; tariffRevision: string; maxRetailCredits: number; expiresAt: string };
export type Generation = { id: string; type: GenerationType; state: string; request: GenerationRequest; requestHash: string; version: number; quote: GenerationQuote; resultAssetIds: string[]; error?: { code?: string; message?: string } | null; replacedBy?: string | null; url?: string; createdAt?: string; updatedAt?: string; favorite?: boolean };
export class GenerationError extends Error { constructor(public code: string, message: string, public uncertain = false) { super(message); } }
export const generationPath = (type: GenerationType, id?: string) => `/workspace/studio/generate/${type}${id ? '/g/' + encodeURIComponent(id) : ''}`;
export const isGenerationTerminal = (state: string) => ['succeeded', 'failed', 'cancelled', 'denied', 'expired'].includes(state);
async function api<T>(path: string, body?: unknown, signal?: AbortSignal, method?: 'DELETE'): Promise<T> {
  let response: Response;
  try { response = await fetch('/api/generations' + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), credentials: 'same-origin', headers: { ...generationAuthHeaders(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal }); }
  catch (error) { if (signal?.aborted) throw error; throw new GenerationError('network_lost', 'Connection lost. Accepted work may still be running; reopen its status before submitting again.', body !== undefined); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new GenerationError(typeof data?.error === 'string' ? data.error : data?.error?.code || 'generation_unavailable', data?.error?.message || data?.message || 'Generation service unavailable. Reload its status.', response.ok || response.status >= 500);
  return data as T;
}
export const generations = {
  catalog: (signal?: AbortSignal) => api<GenerationCatalog>('/catalog', undefined, signal),
  quote: (request: GenerationRequest) => api<GenerationQuote>('/quote', request),
  submit: async (request: GenerationRequest, quoteToken: string, requestKey: string) => (await api<{ generation: Generation }>('', { ...request, quoteToken, requestKey })).generation,
  get: async (id: string, signal?: AbortSignal) => (await api<{ generation: Generation }>('/' + encodeURIComponent(id), undefined, signal)).generation,
  favorite: async (id: string, favorite: boolean) => (await api<{ generation: Generation }>('/' + encodeURIComponent(id) + '/favorite', { favorite })).generation,
  remove: async (id: string) => api<{ id: string; removed: boolean }>('/' + encodeURIComponent(id), undefined, undefined, 'DELETE'),
  list: async (query: { conversationId?: string; type?: GenerationType; projectId?: string; area?: string; favorite?: 'true' }, signal?: AbortSignal) => (await api<{ generations: Generation[] }>('?' + new URLSearchParams(Object.entries(query.area === undefined && !query.conversationId && embedArea() ? { ...query, area: embedArea()! } : query).filter(([, v]) => v !== undefined) as [string, string][]), undefined, signal)).generations ?? [],
  // `settings`: the person changed the proposal's settings; the quote must be for the edited request. The proposal stays
  // as the agent made it; the result is the person's new generation, and the proposal points at it (replacedBy).
  approve: async (record: Generation, quote: GenerationQuote, settings?: Record<string, string>) => (await api<{ generation: Generation }>('/' + encodeURIComponent(record.id) + '/approve', { quoteToken: quote.quoteToken, requestHash: quote.requestHash, version: record.version, ...(settings ? { settings } : {}) })).generation,
  retry: async (id: string, quoteToken: string, requestKey: string) => (await api<{ generation: Generation }>('/' + encodeURIComponent(id) + '/retry', { quoteToken, requestKey })).generation,
  cancel: async (id: string) => (await api<{ generation: Generation }>('/' + encodeURIComponent(id) + '/cancel', {})).generation,
};
export function validateGeneration(request: GenerationRequest, catalog: GenerationCatalog): string | null {
  const type = catalog.types.find(t => t.type === request.type);
  if (!type?.available) return type?.reason || 'This generation type is unavailable.';
  const model = type.models.find(m => m.id === request.model);
  if (!model) return 'Choose an available model. Your selection will not be replaced.';
  if (!request.prompt.trim()) return 'Describe what you want to generate.';
  if (request.referenceAssetIds.length > model.references.max) return `This model accepts at most ${model.references.max} references.`;
  if (new Set(request.referenceAssetIds).size !== request.referenceAssetIds.length) return 'Duplicate references are not supported.';
  for (const [key, value] of Object.entries(request.settings)) if (!model.settings[key]?.values.includes(value)) return `The selected model does not support ${key}: ${value}.`;
  for (const key of Object.keys(model.settings)) if (!request.settings[key]) return `Choose ${key}.`;
  return null;
}
