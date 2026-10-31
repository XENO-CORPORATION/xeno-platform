/**
 * Deleting your own account: asked for, held for 30 days, then erased through the one erasure path (utils/gdprErasure.js).
 * The old route (DELETE /api/auth/account) needed a password, so anyone who signs in with Google or GitHub could not use it, and
 * it erased at once. Here "it's you" is the account's confirmation (a password or a mailed code), and you can change your mind.
 *
 * Two things refuse: a company workspace you own that has other people in it (they would lose it, so hand it over first), and
 * a subscription still running (it would keep charging a person who no longer exists, so cancel it first). The sweep asks again
 * before erasing, because both can have changed in 30 days; if one has, it holds and says why rather than erasing.
 */
import { eraseSubject } from '../utils/gdprErasure.js';

export const GRACE_DAYS = 30;

/** What stands in the way, as sentences a person can act on. */
export async function blockers(db, userId) {
  const out = [];
  const owned = (await db.query(`SELECT w.name FROM workspaces w WHERE w.owner_user_id = $1 AND w.workspace_type <> 'personal' AND w.status = 'active'
      AND EXISTS (SELECT 1 FROM relationship_tuples t WHERE t.object_type = 'workspace' AND t.object_id = w.id::text AND t.subject_type = 'user' AND t.subject_id <> $1::text)`, [userId])).rows;
  if (owned.length) out.push({ code: 'owns_workspace', message: `You own ${owned.map((w) => w.name).join(', ')}, with other people in ${owned.length > 1 ? 'them' : 'it'}. Make someone else the owner first.` });
  const sub = (await db.query(`SELECT plan_name FROM billing_subscriptions WHERE user_id = $1 AND status IN ('active', 'trialing', 'past_due') LIMIT 1`, [userId])).rows[0];
  if (sub) out.push({ code: 'active_subscription', message: 'Your subscription is still running. Cancel it in the billing portal first.' });
  return out;
}

export async function status(db, userId) {
  const r = (await db.query('SELECT requested_at, erase_at FROM account_deletions WHERE user_id = $1 AND erased_at IS NULL', [userId])).rows[0];
  return r ? { requestedAt: new Date(r.requested_at).toISOString(), eraseAt: new Date(r.erase_at).toISOString() } : null;
}

/** Ask for it. Asking again changes nothing: the first date stands. */
export async function request(db, userId, { now = new Date() } = {}) {
  const stop = await blockers(db, userId);
  if (stop.length) return { ok: false, blockers: stop };
  await db.query(`INSERT INTO account_deletions (user_id, requested_at, erase_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET requested_at = EXCLUDED.requested_at, erase_at = EXCLUDED.erase_at, held_reason = NULL WHERE account_deletions.erased_at IS NOT NULL`,
  [userId, now, new Date(now.getTime() + GRACE_DAYS * 86400000)]);
  return { ok: true, deletion: await status(db, userId) };
}

export async function cancel(db, userId) {
  const r = await db.query('DELETE FROM account_deletions WHERE user_id = $1 AND erased_at IS NULL', [userId]);
  return { ok: true, cancelled: r.rowCount > 0 };
}

/**
 * Erase who is due. One at a time, and each claimed by a lock that is held until it is done, so two leaders cannot erase twice.
 * eraseSubject runs on its own connection, so the lock is taken on this row and released by the commit after it.
 */
export async function sweep(pool, { now = new Date(), batch = 20, erase = eraseSubject } = {}) {
  let erased = 0, held = 0;
  const due = (await pool.query('SELECT user_id FROM account_deletions WHERE erased_at IS NULL AND erase_at <= $1 ORDER BY erase_at LIMIT $2', [now, batch])).rows;
  for (const { user_id: userId } of due) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT 1 FROM account_deletions WHERE user_id = $1 AND erased_at IS NULL AND erase_at <= $2 FOR UPDATE SKIP LOCKED', [userId, now])).rows[0];
      if (!row) { await client.query('ROLLBACK'); continue; }   // someone changed their mind, or another worker has it
      const stop = await blockers(client, userId);
      if (stop.length) { await client.query('UPDATE account_deletions SET held_reason = $2 WHERE user_id = $1', [userId, stop[0].code]); await client.query('COMMIT'); held++; continue; }
      await erase(pool, userId);
      await client.query('UPDATE account_deletions SET erased_at = now(), held_reason = NULL WHERE user_id = $1', [userId]);
      await client.query('COMMIT'); erased++;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[AccountDeletion] not erased:', e.message);
    } finally { client.release(); }
  }
  return { erased, held };
}
