/** Free, bounded model discovery. Provider secrets remain inside the vault callback. */
import { safeGet } from '../utils/safeEndpoint.js';

const SPECS = {
  openai: ['https://api.openai.com/v1', '/models'],
  anthropic: ['https://api.anthropic.com/v1', '/models'],
  google: ['https://generativelanguage.googleapis.com/v1beta', '/models'],
  openrouter: ['https://openrouter.ai/api/v1', '/models'],
  'azure-openai': [null, '/openai/models?api-version=2024-02-01'],
  compatible: [null, '/models'],
};
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
function failure(code, message, http = 502) {
  return Object.assign(new Error(message), { code, http });
}
function positive(value) { return Number.isSafeInteger(value) && value > 0 ? value : null; }

export async function fetchProviderModels({ provider, baseUrl, secret }, get = safeGet) {
  const spec = SPECS[provider];
  if (!spec) throw failure('provider_unsupported', 'Model discovery is not supported for this provider', 400);
  const base = String(baseUrl || spec[0] || '').replace(/\/+$/, '');
  if (!base) throw failure('base_url_required', 'This provider requires an endpoint', 400);
  const headers = provider === 'anthropic'
    ? { 'x-api-key': secret, 'anthropic-version': '2023-06-01' }
    : provider === 'google' ? { 'x-goog-api-key': secret }
    : provider === 'azure-openai' ? { 'api-key': secret }
    : { Authorization: `Bearer ${secret}` };
  const models = new Map();
  const cursors = new Set();
  let cursor = null;
  const deadline = Date.now() + 20000;
  for (let page = 0; page < 10; page += 1) {
    if (Date.now() >= deadline) return { models: [...models.values()].sort((a,b) => a.id.localeCompare(b.id)), complete: false };
    const url = new URL(base + spec[1]);
    if (provider === 'anthropic') url.searchParams.set('limit', '100');
    if (provider === 'google') url.searchParams.set('pageSize', '100');
    if (cursor) url.searchParams.set(provider === 'google' ? 'pageToken' : 'after_id', cursor);
    let response;
    try { response = await get(url.toString(), { headers, timeoutMs: Math.max(1, Math.min(8000, deadline - Date.now())), maxBytes: 1024 * 1024 }); }
    catch { throw failure('model_discovery_unavailable', 'The provider model catalog could not be reached'); }
    if (response.status === 401 || response.status === 403) throw failure('model_discovery_denied', 'The provider refused model discovery for this key', 403);
    if (response.status === 429) throw failure('model_discovery_rate_limited', 'The provider model catalog is rate limited', 429);
    if (response.status < 200 || response.status >= 300) throw failure('model_discovery_unavailable', `The provider model catalog returned HTTP ${response.status}`);
    let body;
    try { body = JSON.parse(response.body); } catch { throw failure('model_catalog_invalid', 'The provider returned an invalid model catalog'); }
    const rows = provider === 'google' ? body.models : body.data;
    if (!Array.isArray(rows)) throw failure('model_catalog_invalid', 'The provider returned an unsupported model catalog');
    for (const row of rows) {
      const id = provider === 'google' ? row?.name?.replace(/^models\//, '') : row?.id;
      if (typeof id !== 'string' || !MODEL_ID.test(id) || (secret && id.includes(secret))) continue;
      const context = positive(row.context_window ?? row.context_length ?? row.inputTokenLimit);
      const output = positive(row.max_completion_tokens ?? row.max_output_tokens ?? row.outputTokenLimit);
      models.set(id, { id, ...(context ? { context_window: context } : {}), ...(output ? { max_output_tokens: output } : {}) });
      if (models.size > 2000) throw failure('model_catalog_too_large', 'The provider model catalog exceeds the discovery limit');
    }
    cursor = provider === 'google' ? body.nextPageToken : provider === 'anthropic' && body.has_more ? body.last_id : null;
    if (!cursor) return { models: [...models.values()].sort((a,b) => a.id.localeCompare(b.id)), complete: true };
    if (typeof cursor !== 'string' || cursor.length > 2048 || cursor.includes(secret) || cursors.has(cursor)) {
      throw failure('model_catalog_invalid', 'The provider model catalog has invalid pagination');
    }
    cursors.add(cursor);
  }
  return { models: [...models.values()].sort((a,b) => a.id.localeCompare(b.id)), complete: false };
}
