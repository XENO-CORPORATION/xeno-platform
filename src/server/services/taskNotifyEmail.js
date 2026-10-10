/**
 * Task notification email — the mail half of the inbox (user_notifications, source 'tasks').
 *
 * Only the notifications that ask something of the person are mailed: assigned to you, made the reviewer, asked to
 * review, changes asked, mentioned, due soon, overdue. Comments and status changes stay in the inbox — mailing every
 * one is how people learn to filter a sender away (Linear and GitHub make the same split).
 *
 * A row is mailed only if it is still unread a few minutes after it was written: someone who is on the site saw it.
 * Claim and select happen in one statement, so two workers can never both send. A claimed row is not retried on
 * failure (at most once): a duplicate email is worse than a missing one, and the inbox still has it.
 * On by default, as in Linear; TASK_NOTIFICATION_EMAILS=false turns it off. The unsubscribe link is honoured by
 * sendEmail itself.
 */
import { sendEmail } from './emailService.js';

export const MAILED_KINDS = {
  assigned: ['Assigned to you', 'you were assigned'],
  review_assigned: ['You are the reviewer', 'you are now the reviewer of'],
  review_requested: ['Review requested', 'you were asked to review'],
  changes_requested: ['Changes requested', 'changes were asked for on'],
  mentioned: ['You were mentioned', 'you were mentioned on'],
  due_soon: ['Due tomorrow', 'this is due within a day:'],
  overdue: ['Overdue', 'this is past its due date:'],
};
export const taskEmailsEnabled = (env = process.env) => String(env.TASK_NOTIFICATION_EMAILS ?? '').trim().toLowerCase() !== 'false';

export async function sendPendingTaskEmails(db, opts = {}) {
  const { delayMinutes = 5, batch = 50, perUser = 5, send = sendEmail, env = process.env, site = process.env.SITE_URL || 'https://xenosystem.ai' } = opts;
  if (!taskEmailsEnabled(env)) return { enabled: false, claimed: 0, sent: 0, skipped: 0, failed: 0 };
  const { rows: claimed } = await db.query(
    `WITH due AS (
       SELECT id FROM user_notifications
        WHERE source = 'tasks' AND emailed_at IS NULL AND read_at IS NULL AND kind = ANY($3::text[])
          AND created_at < now() - ($1 || ' minutes')::interval
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $2)
     UPDATE user_notifications n SET emailed_at = now() FROM due WHERE n.id = due.id RETURNING n.id`,
    [String(delayMinutes), batch, Object.keys(MAILED_KINDS)]);
  if (!claimed.length) return { enabled: true, claimed: 0, sent: 0, skipped: 0, failed: 0 };
  const { rows } = await db.query(
    `SELECT n.id, n.kind, n.ref, n.title, n.detail, n.area, n.user_id, u.email, COALESCE(u.display_name, u.username) AS display_name
       FROM user_notifications n JOIN users u ON u.id = n.user_id WHERE n.id = ANY($1::uuid[])`, [claimed.map((r) => r.id)]);
  const per = new Map(); let sent = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    const k = MAILED_KINDS[r.kind];
    if (!k || !r.email) { skipped++; continue; }
    const already = per.get(r.email) || 0; if (already >= perUser) { skipped++; continue; }
    try {
      await send(db, 'task_notification', r.email, { displayName: r.display_name, heading: k[0], sentence: k[1], taskTitle: r.title, taskUrl: `${site}/workspace${r.area ? '/' + encodeURIComponent(r.area) : ''}/tasks/${encodeURIComponent(r.ref)}`, excerpt: r.kind === 'mentioned' || r.kind === 'changes_requested' ? r.detail : '' }, r.user_id);
      per.set(r.email, already + 1); sent++;
    } catch (err) { console.error(`[TaskNotifyEmail] send failed for ${r.id}:`, err.message); failed++; }
  }
  return { enabled: true, claimed: claimed.length, sent, skipped, failed };
}

/** The sweeps: mail every 2 minutes, due reminders every 10. Returns a stop function. */
export function startTaskSweeps(db, { sweepDueReminders, deliverAgentEvents, mailMs = 120000, dueMs = 600000, pushMs = 15000 } = {}) {
  const run = (name, fn) => () => fn().catch((e) => console.error(`[Tasks] ${name} sweep failed:`, e.message));
  const a = setInterval(run('email', () => sendPendingTaskEmails(db)), mailMs);
  const b = setInterval(run('due', () => sweepDueReminders(db)), dueMs);
  // agents: deliver queued events to their webhooks (signed, retried with backoff)
  const c = deliverAgentEvents ? setInterval(run('agent push', () => deliverAgentEvents(db)), pushMs) : null;
  a.unref?.(); b.unref?.(); c?.unref?.();
  console.log(`[Tasks] email sweep every ${mailMs / 1000}s (${taskEmailsEnabled() ? 'on' : 'off'}), due reminders every ${dueMs / 1000}s`);
  return () => { clearInterval(a); clearInterval(b); if (c) clearInterval(c); };
}
