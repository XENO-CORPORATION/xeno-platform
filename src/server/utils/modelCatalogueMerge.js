/**
 * modelCatalogueMerge — fold an account's own-key routes into the gateway's picker list.
 *
 * Pure: takes the cached gateway result and the annotation from
 * `annotateCatalogueRoutes`, returns a NEW result (the cached object is shared across
 * users and must never be mutated). Every model gains `route` — what a request for it
 * would actually do — and the models a key reaches that the gateway does not carry are
 * appended under the key's vendor.
 */

/** Well-known provider hosts → the name a person knows the vendor by. */
const VENDOR_BY_HOST = [
  [/(^|\.)deepseek\.com$/i, 'DeepSeek'],
  [/(^|\.)mistral\.ai$/i, 'Mistral'],
  [/(^|\.)groq\.com$/i, 'Groq'],
  [/(^|\.)together\.(xyz|ai)$/i, 'Together'],
  [/(^|\.)fireworks\.ai$/i, 'Fireworks'],
  [/(^|\.)perplexity\.ai$/i, 'Perplexity'],
  [/(^|\.)x\.ai$/i, 'xAI'],
  [/(^|\.)openrouter\.ai$/i, 'OpenRouter'],
  [/(^|\.)cerebras\.ai$/i, 'Cerebras'],
  [/(^|\.)moonshot\.(ai|cn)$/i, 'Moonshot'],
  [/(^|\.)openai\.com$/i, 'OpenAI'],
  [/(^|\.)anthropic\.com$/i, 'Anthropic'],
  [/(^|\.)googleapis\.com$/i, 'Google'],
  [/(^|\.)azure\.com$/i, 'Azure OpenAI'],
];

/** The group a key's own models are listed under. Host first, then the key's label. */
export function vendorLabelForCredential(credential = {}) {
  try {
    const host = credential.baseUrl ? new URL(String(credential.baseUrl)).hostname : '';
    for (const [re, name] of VENDOR_BY_HOST) if (re.test(host)) return name;
    if (/^(localhost|127\.|10\.|192\.168\.)/.test(host)) return 'Local';
  } catch { /* not a URL — fall through to the label */ }
  const label = String(credential.label || credential.provider || 'Your key').trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * `route` on a picker model:
 *   { path: 'premium' }
 *   { path: 'byok', mode: 'managed', key: { label, provider, status } }   — routed to the account's key
 *   { path: 'byok', mode: 'local' }                                       — the product calls the provider itself
 */
function routeForClient(entry) {
  if (!entry || entry.path !== 'byok') return { path: 'premium' };
  if (entry.mode === 'local') return { path: 'byok', mode: 'local' };
  const key = entry.credential || {};
  return { path: 'byok', mode: 'managed', key: { label: key.label, provider: key.provider, status: key.status } };
}

export function mergeCatalogueWithRoutes(gatewayResult, annotated, { reasoningCapabilityForModel, prettyModelName }) {
  const routes = annotated?.routes instanceof Map ? annotated.routes : new Map();
  const extra = Array.isArray(annotated?.extra) ? annotated.extra : [];
  const companies = {};
  for (const [company, models] of Object.entries(gatewayResult.companies || {})) {
    companies[company] = models.map((m) => ({ ...m, route: routeForClient(routes.get(m.id)) }));
  }
  for (const { id, credential } of extra) {
    const company = vendorLabelForCredential(credential);
    const list = (companies[company] = companies[company] || []);
    if (list.some((m) => m.id === id)) continue;
    list.push({
      id,
      name: prettyModelName(id),
      maxTokens: 128000,
      created: 0,
      description: '',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsReasoning: reasoningCapabilityForModel(id),
      supportsVision: false,
      supportsFileUpload: false,
      paths: ['byok'],
      defaultPath: 'byok',
      route: routeForClient(routes.get(id)),
    });
  }
  return { ...gatewayResult, totalCompanies: Object.keys(companies).length, companies };
}

export default { mergeCatalogueWithRoutes, vendorLabelForCredential };
