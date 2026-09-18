/**
 * The effort a turn is sent at — derived from the option the person chose for the model.
 *
 * One rule, read by the composer (what the chip says), the send path (which id and which
 * parameter go on the request) and the placeholder (whether a "Thinking" turn is expected):
 *
 *   auto        the bare id, no parameter — the model's own default
 *   via 'id'    the suffixed id IS the effort (`claude-sonnet-5-high`); no parameter
 *   via 'param' the bare id plus `reasoningEffort` (the toggleable set)
 *
 * A chosen effort other than `auto`/`none` means the turn reasons; a fixed-reasoning model
 * reasons regardless and has no options.
 */
import type { Model, ModelEffortOption } from '@/services/modelService';

export const AUTO_EFFORT: ModelEffortOption = { effort: 'auto', modelId: '', via: 'id' };

const STORAGE_KEY = 'xeno_chat_effort_by_model';

export function effortLabel(effort: string): string {
  if (effort === 'auto') return 'Auto';
  if (effort === 'xhigh') return 'X-High';
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

/** The remembered level per base model — a preference, never a cross-model global. */
export function readEffortPreferences(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

export function writeEffortPreference(baseId: string, effort: string): void {
  try {
    const next = { ...readEffortPreferences(), [baseId]: effort };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* storage optional */ }
}

/** The option in force for a model: the remembered level if the model still offers it, else auto. */
export function effortOptionFor(model: Pick<Model, 'id' | 'efforts'>, prefs: Record<string, string>): ModelEffortOption {
  const options = model.efforts || [];
  if (options.length < 2) return { ...AUTO_EFFORT, modelId: model.id };
  const wanted = prefs[model.id];
  return options.find((o) => o.effort === wanted) || options.find((o) => o.effort === 'auto') || options[0];
}

/** What goes on the request for this option. */
export function requestShapeFor(baseId: string, option: ModelEffortOption): { modelId: string; reasoningEffort?: 'low' | 'medium' | 'high'; reasons: boolean } {
  const reasons = option.effort !== 'auto' && option.effort !== 'none';
  if (option.via === 'param' && reasons && (option.effort === 'low' || option.effort === 'medium' || option.effort === 'high')) {
    return { modelId: baseId, reasoningEffort: option.effort, reasons };
  }
  return { modelId: option.modelId || baseId, reasons };
}
