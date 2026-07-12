/**
 * modelPaths — the ONE authoritative map from a model id to its inference route
 * and its available "paths" (byok / inhouse / premium). See
 * XENO-MONETIZATION-AND-ACCOUNT.md §3. This exists because the platform had a
 * silent routing bug: /api/models emits OpenRouter-style ids ('openai/gpt-5.4')
 * while aiRoutes routed on short ids ('gpt-4o'), so every live chat fell through
 * to XENO's OpenRouter key. Route resolution now keys off the id shape the
 * frontend actually sends.
 *
 * `path` encodes WHO PAYS / WHERE IT RUNS, not the model licence:
 *   - premium : XENO's server keys  → costs XENO money → METERED on credits
 *   - byok    : the user's own key  → €0 to XENO       → never metered
 *   - inhouse : xeno-rt open/local  → near-zero        → never metered (plan daily-cap)
 * The same open-weight model can be premium (served via XENO's OpenRouter key) AND
 * byok AND inhouse — the path is chosen per request, not fixed by the model.
 */

// Transports = how we actually reach a provider. 'openrouter' fronts everything
// in the live catalog; the native transports are for legacy short ids / byok.
export const TRANSPORTS = ['openrouter', 'openai', 'anthropic', 'google'];

const NATIVE_PREFIX = { openai: 'openai', anthropic: 'anthropic', google: 'google' };

// Legacy short-id → transport (kept for back-compat with old callers).
const SHORT_MODEL_PROVIDERS = {
  'gpt-4o': 'openai', 'gpt-4o-mini': 'openai', 'gpt-4-turbo': 'openai', 'gpt-3.5-turbo': 'openai',
  'claude-3-5-sonnet': 'anthropic', 'claude-3-5-haiku': 'anthropic', 'claude-3-opus': 'anthropic',
  'claude-3-sonnet': 'anthropic', 'claude-3-haiku': 'anthropic',
  'gemini-pro': 'google', 'gemini-2.0-flash': 'google', 'gemini-1.5-pro': 'google', 'gemini-1.5-flash': 'google',
};

/** The provider family a model id belongs to (from the OpenRouter-style prefix). */
export function providerOf(modelId = '') {
  const id = String(modelId);
  if (id.includes('/')) {
    const prefix = id.split('/')[0];
    if (prefix === 'meta-llama') return 'meta';
    if (prefix === 'mistralai') return 'mistral';
    if (prefix === 'x-ai') return 'xai';
    return prefix; // openai / anthropic / google / deepseek / qwen / ...
  }
  return SHORT_MODEL_PROVIDERS[id] || 'openrouter';
}

/**
 * Resolve how to reach a model on each path.
 * Returns { provider, premium:{transport,providerModel}, byok:{transport,providerModel,keyProvider} }.
 * - premium always goes through the transport that XENO holds a key for (OpenRouter
 *   fronts the whole catalog; legacy short ids use their native transport).
 * - byok prefers the NATIVE provider when the id names one (so a user's OpenAI key
 *   serves 'openai/gpt-5.4' as bare 'gpt-5.4'); otherwise it needs an OpenRouter key.
 */
export function resolveRoute(modelId = '') {
  const id = String(modelId);

  if (id.includes('/')) {
    const [prefix, ...rest] = id.split('/');
    const bare = rest.join('/');
    const native = NATIVE_PREFIX[prefix] || null;
    return {
      provider: providerOf(id),
      // Serve the whole live catalog through XENO's OpenRouter key (matches how
      // /api/models is sourced) — this is the fix for the id-mismatch cost leak.
      premium: { transport: 'openrouter', providerModel: id },
      byok: native
        ? { transport: native, providerModel: bare, keyProvider: native }
        : { transport: 'openrouter', providerModel: id, keyProvider: 'openrouter' },
    };
  }

  // Legacy short id → native transport for both paths.
  const transport = SHORT_MODEL_PROVIDERS[id] || 'openrouter';
  return {
    provider: transport,
    premium: { transport, providerModel: id },
    byok: { transport, providerModel: id, keyProvider: transport },
  };
}

/**
 * The paths a catalog (server-listed) model can be used on. Server-side xeno-rt
 * inference does not exist yet, so catalog models are premium (+ byok if the user
 * has a key). Hub-local GGUF models (localModelCatalog) are inhouse-only.
 */
export function catalogPaths(modelId = '', { local = false } = {}) {
  if (local) return { paths: ['inhouse'], defaultPath: 'inhouse' };
  return { paths: ['premium', 'byok'], defaultPath: 'premium' };
}

const VALID_PATHS = new Set(['premium', 'byok', 'inhouse']);

/** Normalise a requested path to a supported value (defaults to premium). */
export function normalizePath(requested) {
  return VALID_PATHS.has(requested) ? requested : 'premium';
}
