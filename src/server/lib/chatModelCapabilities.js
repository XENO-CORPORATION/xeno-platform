/**
 * The reasoning control contract exposed by api.xenostudio.ai.
 *
 * Do not infer this from provider families. A model can reason internally while
 * rejecting the public `reasoning_effort` control, and fixed-effort aliases must
 * be selected by ID without sending a conflicting effort parameter.
 */
const TOGGLEABLE_REASONING_MODELS = new Set([
  'grok-4.6',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.5',
  'gpt-5.4-mini',
  'gpt-5.4',
]);

const FIXED_REASONING_MODELS = new Set([
  'grok-4.6-high-fast',
  'grok-4.5-high-fast',
  'grok-4.6-minimal',
  'grok-4.20-0309-reasoning',
  'gpt-5.4-thinking',
  'gpt-5.5-thinking',
  'claude-sonnet-4-6-thinking',
]);

function bareModelId(id = '') {
  const normalized = String(id).trim().toLowerCase();
  return normalized.includes('/') ? normalized.slice(normalized.lastIndexOf('/') + 1) : normalized;
}

export function reasoningCapabilityForModel(id = '') {
  const bare = bareModelId(id);
  if (TOGGLEABLE_REASONING_MODELS.has(bare)) return 'toggleable';
  if (FIXED_REASONING_MODELS.has(bare) || bare.endsWith(':thinking')) return 'alwaysOn';

  // Legacy OpenRouter-style reasoning-only IDs remain readable in old chats,
  // but are not presented as toggles in the current XENO catalog.
  if (/^(o1|o3|o4)(?:-|$)/.test(bare) || /(?:^|-)r1(?:-|$)/.test(bare)) return 'alwaysOn';
  return 'disabled';
}

/** Preferred XENO API request value, or null for disabled/fixed aliases. */
export function reasoningEffortForModel(id = '', enabled = false) {
  return enabled && reasoningCapabilityForModel(id) === 'toggleable' ? 'high' : null;
}

export const reasoningModelContract = Object.freeze({
  toggleable: Object.freeze([...TOGGLEABLE_REASONING_MODELS]),
  fixed: Object.freeze([...FIXED_REASONING_MODELS]),
});
