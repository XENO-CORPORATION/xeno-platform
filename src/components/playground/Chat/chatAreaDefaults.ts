/**
 * What an AREA of the XENO workspace remembers for its chats.
 *
 * Owner's rule (2026-10-03, confirmed 2026-10-09): each area (Studio, Office, Social, Corpo, Dev, Tools, or one
 * the person made) has its own chats, and with them its own defaults:
 *
 *   - the MODEL a new chat in that area opens with: the one last picked there. Dev can stay on a strong model
 *     and Office on a fast one without the two fighting over one account-wide default.
 *   - a standing INSTRUCTION for chats in that area ("in Dev, answer as an engineer").
 *
 * Both live in the account's settings under `areas.<id>` (so they follow the person across devices), with the
 * model also kept in this browser as the fast path before the settings request returns. Effort is not stored
 * here: it is already remembered per model, so it comes with the model.
 *
 * Outside the workspace, and on Overview, there is no area and none of this applies: the chat uses the
 * account-wide default and no area instruction, exactly as before.
 */
export interface AreaChatSettings { model?: unknown; instructions?: unknown }
export type AreaSettingsMap = Record<string, AreaChatSettings | undefined>;

const AREA_SHAPE = /^[a-z][a-z0-9_-]{0,39}$/;
export const MAX_AREA_INSTRUCTIONS = 4000;
const localKey = (area: string): string => `xeno_chat_area_model:${area}`;

/** The settings map as stored, or an empty one when the account has none or it is malformed. */
export function readAreaSettings(settings: unknown): AreaSettingsMap {
  const areas = (settings as { areas?: unknown } | null | undefined)?.areas;
  return areas && typeof areas === 'object' && !Array.isArray(areas) ? (areas as AreaSettingsMap) : {};
}

/** The model a new chat in `area` opens with: the account's record, else this browser's, else none. */
export function readAreaModel(area: string | null, map: AreaSettingsMap): string | null {
  if (!area || !AREA_SHAPE.test(area)) return null;
  const stored = map[area]?.model;
  if (typeof stored === 'string' && stored) return stored;
  try { return localStorage.getItem(localKey(area)) || null; } catch { return null; }
}

export function writeAreaModelLocal(area: string, modelId: string): void {
  if (!AREA_SHAPE.test(area)) return;
  try { localStorage.setItem(localKey(area), modelId); } catch { /* storage optional */ }
}

/** The standing instruction for chats in `area`, trimmed and capped, or ''. */
export function areaInstructions(area: string | null, map: AreaSettingsMap): string {
  if (!area || !AREA_SHAPE.test(area)) return '';
  const text = map[area]?.instructions;
  return typeof text === 'string' ? text.trim().slice(0, MAX_AREA_INSTRUCTIONS) : '';
}

/**
 * The person's saved system prompt with the area's instruction ahead of it. Both are the person's own words;
 * the area's comes first because it is the narrower context, and the saved one keeps the last word.
 */
export function withAreaInstructions(saved: string | null | undefined, area: string | null, map: AreaSettingsMap, areaLabel?: string): string {
  const mine = (saved || '').trim();
  const forArea = areaInstructions(area, map);
  if (!forArea) return mine;
  const head = `Standing instructions for this part of the workspace${areaLabel ? ` (${areaLabel})` : ''}, written by the user:\n${forArea}`;
  return [head, mine].filter(Boolean).join('\n\n');
}
