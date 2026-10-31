/**
 * The inbox (user_notifications): the one place a row is written and the one place its state changes. REST, the agent
 * tools and every product call this; none of them writes the table. `source` names the product, `ref` what the row is
 * about: a key (T-12, support/T-3) or, for newer writers, the address it opens (/workspace/...).
 *
 * Read, archived and snoozed are three separate facts. Snoozing makes a row unread so it comes back as new; waking is
 * derived from the time, so no sweep can forget one. Archiving reads it. An agent has an inbox of its own, under its own
 * user id; nothing here reads someone else's.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class InboxError extends Error { constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; } }

/** What each kind asks of the person: a label for its row, and whether it waits on them until read. Unknown kinds are activity. */
const KINDS = {
  form_response: ['Form response', false],
  font_taken_down: ['Font taken down', false],
  stock_withdrawn: ['Stock item withdrawn', false],
  assigned: ['Assigned', true], review_requested: ['Review', true], review_assigned: ['Reviewer', true], changes_requested: ['Changes', true], mentioned: ['Mention', true], due_soon: ['Due soon', true], overdue: ['Overdue', true],
  run_failed: ['Run failed', true], workflow_failed: ['Run failed', true], workflow_off: ['Turned off', true], invited: ['Invitation', true],
  run_finished: ['Finished', false], run_stopped: ['Stopped', false], shared: ['Shared', false], commented: ['Comment', false], status: ['Update', false],
  reply: ['Reply', false], answer_accepted: ['Accepted', false],
};
const clip = (s, n) => String(s ?? '').slice(0, n);

/**
 * Write one row. Returns its id, or null when it was deliberately not written: nobody to tell, you did it yourself, the
 * recipient is suspended or a service account, or this dedupeKey already wrote one. Null is normal, never a failure.
 */
export async function notify(db, { userId, source, kind, ref, title, detail = '', area = null, actorId = null, actorKind = null, dedupeKey = null }) {
  if (!userId || (actorId && String(actorId) === String(userId))) return null;
  const { rows } = await db.query(
    `INSERT INTO user_notifications (user_id, source, kind, ref, title, detail, area, actor_id, actor_kind, dedupe_key)
     SELECT u.id, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::uuid, $9::text, $10::text FROM users u
      WHERE u.id = $1::uuid AND u.is_active = TRUE AND u.role <> 'service'
     ON CONFLICT (user_id, source, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
    [userId, source, kind, clip(ref, 200), clip(title, 400), clip(detail, 1000), area, actorId, actorId ? (actorKind || 'human') : null, dedupeKey]);
  return rows[0]?.id ?? null;
}

/** For a writer whose own work must not fail because a notification could not be written. Not inside a transaction: a failed statement would abort it. */
export const tell = (db, row) => notify(db, row).catch((e) => { console.error('[Inbox] not written:', e.message); return null; });

const VIEWS = {
  inbox: `n.archived_at IS NULL AND (n.snoozed_until IS NULL OR n.snoozed_until <= now())`,
  snoozed: `n.archived_at IS NULL AND n.snoozed_until > now()`,
  archive: `n.archived_at IS NOT NULL`,
  all: `TRUE`,
};
const shape = (r) => ({ id: r.id, source: r.source, kind: r.kind, ref: r.ref, title: r.title, detail: r.detail, area: r.area, read: !!r.read_at, at: r.created_at,
  archived: !!r.archived_at, snoozedUntil: r.snoozed_until && new Date(r.snoozed_until) > new Date() ? new Date(r.snoozed_until).toISOString() : null,
  label: (KINDS[r.kind] || ['Activity'])[0], asks: !!(KINDS[r.kind] || [])[1],
  actor: r.actor_name ? { name: r.actor_name, kind: r.actor_kind || 'human' } : null });

/** Newest first, with the unread count: what is in the inbox now, not what is archived or asleep. */
export async function listNotifications(db, userId, { view = 'inbox', unread = false, limit = 50 } = {}) {
  const where = VIEWS[view]; if (!where) throw new InboxError('Unknown view', 'invalid_view');
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const rows = (await db.query(`SELECT n.id, n.source, n.kind, n.ref, n.title, n.detail, n.area, n.read_at, n.archived_at, n.snoozed_until, n.created_at, n.actor_kind,
      COALESCE(u.display_name, u.username) AS actor_name FROM user_notifications n LEFT JOIN users u ON u.id = n.actor_id
     WHERE n.user_id = $1 AND ${where} ${unread ? 'AND n.read_at IS NULL' : ''} ORDER BY n.created_at DESC LIMIT ${n}`, [userId])).rows;
  const unreadCount = (await db.query(`SELECT count(*)::int AS n FROM user_notifications n WHERE n.user_id = $1 AND n.read_at IS NULL AND ${VIEWS.inbox}`, [userId])).rows[0].n;
  return { unread: unreadCount, items: rows.map(shape) };
}

const idsOf = (ids) => (Array.isArray(ids) ? ids : []).filter((x) => UUID.test(String(x))).slice(0, 500);

/** Mark read (or, with read: false, unread again). 'all' is what is in the inbox: asleep rows stay new for when they wake. */
export async function markNotificationsRead(db, userId, ids, { read = true } = {}) {
  if (ids === 'all') { await db.query(`UPDATE user_notifications n SET read_at = now() WHERE n.user_id = $1 AND n.read_at IS NULL AND ${VIEWS.inbox}`, [userId]); return; }
  const list = idsOf(ids); if (!list.length) return;
  await db.query(read ? 'UPDATE user_notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL'
    : 'UPDATE user_notifications SET read_at = NULL WHERE user_id = $1 AND id = ANY($2::uuid[])', [userId, list]);
}
export async function archiveNotifications(db, userId, ids, { archived = true } = {}) {
  const list = idsOf(ids); if (!list.length) return;
  await db.query(archived ? 'UPDATE user_notifications SET archived_at = now(), snoozed_until = NULL, read_at = COALESCE(read_at, now()) WHERE user_id = $1 AND id = ANY($2::uuid[])'
    : 'UPDATE user_notifications SET archived_at = NULL WHERE user_id = $1 AND id = ANY($2::uuid[])', [userId, list]);
}
/** Put rows to sleep until a time, or wake them now with until: null. A row asleep is unread, so it comes back as new. */
export async function snoozeNotifications(db, userId, ids, until) {
  const list = idsOf(ids); if (!list.length) return;
  if (until === null) { await db.query('UPDATE user_notifications SET snoozed_until = NULL WHERE user_id = $1 AND id = ANY($2::uuid[])', [userId, list]); return; }
  const t = new Date(until).getTime();
  if (!Number.isFinite(t) || t <= Date.now() || t > Date.now() + 366 * 86400000) throw new InboxError('Snooze until a time within the next year', 'invalid_until');
  await db.query('UPDATE user_notifications SET snoozed_until = $3, read_at = NULL, archived_at = NULL WHERE user_id = $1 AND id = ANY($2::uuid[])', [userId, list, new Date(t).toISOString()]);
}

// ───────── what reaches the person: per-area levels and the digest follow them. Desktop and sound belong to a device, so they stay in its browser.
const LEVELS = new Set(['all', 'needs', 'off']), DIGESTS = new Set(['off', 'daily', 'weekly']);
export async function getPrefs(db, userId) {
  const s = (await db.query(`SELECT settings->'inbox' AS p FROM user_settings WHERE user_id = $1`, [userId])).rows[0]?.p || {};
  return { digest: DIGESTS.has(s.digest) ? s.digest : 'off', levels: s.levels && typeof s.levels === 'object' ? s.levels : {} };
}
export async function setPrefs(db, userId, { digest, levels } = {}) {
  const cur = await getPrefs(db, userId), next = { ...cur };
  if (digest !== undefined) { if (!DIGESTS.has(digest)) throw new InboxError('Digest is off, daily or weekly', 'invalid_digest'); next.digest = digest; }
  if (levels !== undefined) {
    if (!levels || typeof levels !== 'object' || Array.isArray(levels) || Object.keys(levels).length > 40) throw new InboxError('Invalid levels', 'invalid_levels');
    for (const [k, v] of Object.entries(levels)) if (!/^[a-z][a-z0-9_-]{0,39}$/.test(k) || !LEVELS.has(v)) throw new InboxError('Invalid levels', 'invalid_levels');
    next.levels = levels;
  }
  await db.query(`INSERT INTO user_settings (user_id, settings, updated_at) VALUES ($1, jsonb_build_object('inbox', $2::jsonb), now())
    ON CONFLICT (user_id) DO UPDATE SET settings = jsonb_set(COALESCE(user_settings.settings, '{}'::jsonb), '{inbox}', COALESCE(user_settings.settings->'inbox', '{}'::jsonb) || $2::jsonb), updated_at = now()`,
  [userId, JSON.stringify(next)]);
  return next;
}

// ───────── the digest
export const digestsEnabled = (env = process.env) => String(env.INBOX_DIGEST_EMAILS ?? '').trim() === 'true';
const PERIOD_MS = { daily: 86400000, weekly: 7 * 86400000 };

/**
 * One email for each person who chose a digest and whose period has passed: what is unread in their inbox from that
 * period, without the areas they turned off. OFF unless INBOX_DIGEST_EMAILS is exactly "true". The period is claimed before
 * sending, so two workers cannot both send and a failure is not retried: the inbox still has everything.
 */
export async function sendDigests(db, { env = process.env, send, now = Date.now(), batch = 100, site = process.env.SITE_URL || 'https://xenosystem.ai' } = {}) {
  if (!digestsEnabled(env)) return { enabled: false, sent: 0, empty: 0, failed: 0 };
  if (!send) send = (await import('./emailService.js')).sendEmail;
  const due = (await db.query(`SELECT s.user_id, s.settings->'inbox' AS p, u.email, COALESCE(u.display_name, u.username) AS name FROM user_settings s JOIN users u ON u.id = s.user_id
     WHERE s.settings->'inbox'->>'digest' IN ('daily', 'weekly') AND u.is_active = TRUE AND u.email IS NOT NULL
       AND COALESCE((s.settings->'inbox'->>'digestSentAt')::timestamptz, 'epoch') < to_timestamp($1::double precision / 1000) - (CASE s.settings->'inbox'->>'digest' WHEN 'daily' THEN interval '1 day' ELSE interval '7 days' END) LIMIT $2`, [now, batch])).rows;
  let sent = 0, empty = 0, failed = 0;
  for (const u of due) {
    const nowIso = new Date(now).toISOString();
    const claim = await db.query(`UPDATE user_settings SET settings = jsonb_set(settings, '{inbox,digestSentAt}', to_jsonb($2::text)) WHERE user_id = $1 AND COALESCE(settings->'inbox'->>'digestSentAt', '') = $3`, [u.user_id, nowIso, u.p.digestSentAt || '']);
    if (!claim.rowCount) continue;
    const since = u.p.digestSentAt || new Date(now - PERIOD_MS[u.p.digest]).toISOString();
    const off = Object.entries(u.p.levels || {}).filter(([, v]) => v === 'off').map(([k]) => k);
    const rows = (await db.query(`SELECT n.title, n.kind, n.area FROM user_notifications n WHERE n.user_id = $1 AND n.read_at IS NULL AND ${VIEWS.inbox} AND n.created_at > $2 AND NOT (COALESCE(n.area, 'overview') = ANY($3::text[])) ORDER BY n.created_at DESC LIMIT 21`, [u.user_id, since, off])).rows;
    if (!rows.length) { empty++; continue; }
    try {
      await send(db, 'inbox_digest', u.email, { displayName: u.name, period: u.p.digest, items: rows.slice(0, 20).map((r) => r.title), more: rows.length > 20, inboxUrl: `${site}/workspace/inbox` }, u.user_id);
      sent++;
    } catch (e) { console.error('[Inbox] digest not sent:', e.message); failed++; }
  }
  return { enabled: true, sent, empty, failed };
}
