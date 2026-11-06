/** The chat's own first choice (src/components/playground/Chat/ChatWithLLM.tsx DEFAULT_MODEL). Keep the two the same. */
export const PLATFORM_DEFAULT_MODEL = 'gpt-5.6-terra';
/**
 * The model new work in `area` uses when none is named: the area's own (settings areas.<id>.model), else the
 * person's default (settings models.defaultModel), else the platform's. Decided here, on the server, so a client
 * that forgets to say cannot leave a scheduled chat on a model that no longer exists.
 */
export async function defaultModelFor(db, userId, area) {
  let s = {};
  try { s = (await db.query('SELECT settings FROM user_settings WHERE user_id = $1', [userId])).rows[0]?.settings || {}; } catch { s = {}; }
  const own = area && s.areas && typeof s.areas === 'object' ? s.areas[area]?.model : null;
  if (typeof own === 'string' && own.trim()) return own.trim();
  const mine = s.models?.defaultModel;
  return typeof mine === 'string' && mine.trim() ? mine.trim() : PLATFORM_DEFAULT_MODEL;
}

/** A named model stays as named; 'auto' means "no preference", and the person's default answers it. */
export async function chatModelFor(db, userId, named) {
  return named === 'auto' ? defaultModelFor(db, userId, null) : named;
}
