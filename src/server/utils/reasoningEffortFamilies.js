/**
 * reasoningEffortFamilies — the effort a model reasons at, as the gateway actually models it.
 *
 * The gateway exposes effort as SUFFIXED MODEL IDS — `claude-sonnet-5-low … -max`,
 * `grok-4.6-low` — and the picker used to collapse them and throw the fact away, leaving a
 * bare on/off button that meant "send effort=medium" (2026-09-19). The agent panel already has
 * the right model (`@xenosystem/agent-interface-core` `agentReasoningEffort`): a FAMILY per base
 * id, one option per level, `auto` = the bare id. This is that rule for the platform's catalogue,
 * plus the one thing the web chat needs on top — a model that takes the effort as a request
 * PARAMETER rather than a suffix (`reasoning: { effort }`, the toggleable set) gets those
 * levels as options too, marked `via: 'param'`.
 *
 * ⚠️ `max` is in this set and not (yet) in core's — the gateway serves `-max` ids for the
 * Claude 5 and GPT-5.6 lines. Recorded as a delta for core, not silently dropped here.
 */

export const EFFORT_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
const SUFFIX_RE = /^(.*)-(none|low|medium|high|xhigh|max)$/;
/** Levels a parameter-driven model accepts (OpenRouter-shaped `reasoning.effort`). */
const PARAM_LEVELS = ['low', 'medium', 'high'];

export function splitEffort(id) {
  const m = String(id || '').replace(/:thinking$/, '').match(SUFFIX_RE);
  return m ? { baseId: m[1], effort: m[2] } : null;
}

export function effortRank(effort) {
  if (effort === 'auto') return -1;
  return EFFORT_LEVELS.indexOf(effort);
}

export function effortLabel(effort) {
  if (effort === 'auto') return 'Auto';
  if (effort === 'xhigh') return 'X-High';
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

/**
 * Families from a list of ids: baseId → options, one per suffixed variant, `auto` first when
 * the bare id exists. A base with a single variant and no bare id is not a family (the same
 * rule core applies — one odd suffix is a model name, not a level).
 */
export function buildEffortFamilies(ids) {
  const set = new Set(ids.map(String));
  const variants = new Map();
  for (const id of set) {
    const parsed = splitEffort(id);
    if (!parsed) continue;
    const list = variants.get(parsed.baseId) || [];
    list.push({ effort: parsed.effort, modelId: id, via: 'id' });
    variants.set(parsed.baseId, list);
  }
  const families = new Map();
  for (const [baseId, options] of variants) {
    if (options.length < 2 && !set.has(baseId)) continue;
    const sorted = [...options].sort((a, b) => effortRank(a.effort) - effortRank(b.effort));
    if (set.has(baseId)) sorted.unshift({ effort: 'auto', modelId: baseId, via: 'id' });
    families.set(baseId, sorted);
  }
  return families;
}

/**
 * The options the picker offers for ONE base model. `capability` is the reasoning contract
 * (`toggleable` | `alwaysOn` | `disabled`): a toggleable model takes the parameter, so its
 * levels are offered even with no suffixed variants; a fixed model always reasons and offers
 * nothing (its id already selects the effort); a non-reasoning model with no variants offers
 * nothing. A suffixed id wins over the parameter for the same level — the catalogue's own
 * representation is the one we know exists.
 */
export function effortOptionsFor(baseId, families, capability) {
  if (capability === 'alwaysOn') return [];
  const fromIds = families.get(baseId) || [];
  const byEffort = new Map(fromIds.map((o) => [o.effort, o]));
  if (capability === 'toggleable') {
    if (!byEffort.has('auto')) byEffort.set('auto', { effort: 'auto', modelId: baseId, via: 'id' });
    for (const level of PARAM_LEVELS) if (!byEffort.has(level)) byEffort.set(level, { effort: level, modelId: baseId, via: 'param' });
  }
  const options = [...byEffort.values()].sort((a, b) => effortRank(a.effort) - effortRank(b.effort));
  return options.length >= 2 ? options : [];
}

export default { EFFORT_LEVELS, splitEffort, effortRank, effortLabel, buildEffortFamilies, effortOptionsFor };
