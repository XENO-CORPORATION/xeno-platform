/**
 * XENO Scheduling (Corpo › Scheduling): availability, booking pages, bookings, the person's calendar and its ICS feed.
 * Every surface calls these functions: the workspace screen and the public booking page (routes/schedulingRoutes.js)
 * and agents (schedulingMcp.js). There is no second path.
 *
 * Scope (XENO-WORKFORCE-01 §8.11): the WORKSPACE owns its pages and bookings. A member sets their own availability
 * and time off and makes booking pages that book THEM; an admin may manage any page in the workspace. An agent reads
 * as its owner and never writes: a booking page is a PUBLIC link, and a public link is a person's act (the database
 * holds that too). Agents may read free slots and bookings.
 *
 * Availability: a weekly pattern in the person's own time zone, minus time off, minus their confirmed bookings (with
 * the page's buffer either side). The pattern defaults to the People profile (workforce_employee_profiles: timezone +
 * working_hours); scheduling_availability is the person's booking-hours override. Time off is People's
 * (workforce_time_off) — read here, written through workforcePeople.addTimeOff/cancelTimeOff, never a second table.
 * Bookings flow back the other way: workforcePeople.availability* reports a person in a booked meeting as
 * unavailable ('in_meeting'), which is what Places and assignment pickers read.
 *
 * Guests: booking needs no account. The guest gets a manage link (a random token, only its hash stored) to
 * reschedule or cancel. Every booking makes a calendar_events row for the host; cancelling cancels it.
 * Reminders: sendDueReminders() — the host's notification always; mail to host and guest only when
 * SCHEDULING_EMAILS is exactly "true" (fails closed).
 */
import crypto from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { ensurePersonalWorkspace } from './personalWorkspace.js';
import { sendEmail } from './emailService.js';
import { siteOrigin } from '../config/hosts.js';
import * as people from './workforcePeople.js';

export class SchedulingError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'SchedulingError'; this.code = code; this.status = status; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{2,62}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]{1,200}@[^\s@]{1,200}\.[^\s@]{1,50}$/;
/** Public booking limits: per page per hour, and per guest e-mail per hour. A burst is refused, never queued. */
export const LIMITS = { perPageHour: 30, perEmailHour: 5 };
const MIN = 60_000;
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const token = () => crypto.randomBytes(24).toString('base64url');
export const emailsEnabled = (env = process.env) => String(env.SCHEDULING_EMAILS ?? '').trim().toLowerCase() === 'true';
const manageUrl = (t) => `${siteOrigin()}/api/scheduling/manage/${t}`;
export const bookUrl = (slug) => `${siteOrigin()}/api/scheduling/book/${slug}`;
const text = (v, field, max, required = true) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw new SchedulingError(`${field} is required`, `${field}_required`);
  if (s.length > max) throw new SchedulingError(`${field} is longer than ${max} characters`, `${field}_too_long`);
  return s;
};
const int = (v, field, lo, hi, dflt) => {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new SchedulingError(`${field} must be a whole number from ${lo} to ${hi}`, `invalid_${field}`);
  return n;
};
const when = (v, field) => { const d = new Date(v); if (!v || Number.isNaN(d.getTime())) throw new SchedulingError(`${field} is not a date`, `invalid_${field}`); return d; };

// ─────────────────────────────────────────── time zones

export function validZone(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } }
/** Offset of `tz` at instant `ms`, in ms (local − UTC). */
function offsetAt(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
/** The UTC instant of local date (y, m, d) at hh:mm in `tz`. */
export function zoned(y, m, d, hhmm, tz) {
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetAt(guess, tz);
  t = guess - offsetAt(t, tz);
  return t;
}
function localDate(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), wd };
}

// ─────────────────────────────────────────── who, where

async function personOf(db, actor) {
  if (!actor || !actor.id) throw new SchedulingError('Sign in first', 'not_signed_in', 401);
  if (actor.kind !== 'agent') return { userId: String(actor.id), agentId: null };
  const r = (await db.query('SELECT owner_user_id FROM agent_identities WHERE user_id = $1', [actor.id])).rows[0];
  if (!r || !r.owner_user_id) throw new SchedulingError('This agent has no owner', 'no_owner', 403);
  return { userId: String(r.owner_user_id), agentId: String(actor.id) };
}

/** Resolve the workspace (default: the person's Personal one); require membership, and a person for writes. */
export async function scopeFor(db, actor, { workspace, write = false } = {}) {
  const who = await personOf(db, actor);
  if (write && who.agentId) throw new SchedulingError('Agents read Scheduling; a person changes it', 'person_required', 403);
  let ws = workspace ? String(workspace) : null;
  if (ws && !UUID.test(ws)) throw new SchedulingError('Invalid workspace id', 'invalid_workspace');
  if (!ws) ws = String((await ensurePersonalWorkspace(db, who.userId)).id);
  const member = (await check(db, { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${who.userId}` })).allowed;
  if (!member) throw new SchedulingError('You are not a member of that workspace', 'not_a_member', 403);
  const admin = (await check(db, { object: `workspace:${ws}`, relation: 'admin', subject: `user:${who.userId}` })).allowed;
  return { ws, userId: who.userId, agentId: who.agentId, admin };
}
async function isMember(db, ws, userId) { return (await check(db, { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${userId}` })).allowed; }

// ─────────────────────────────────────────── availability

const DEFAULT_WEEKLY = { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']], 4: [['09:00', '17:00']], 5: [['09:00', '17:00']] };
function cleanWeekly(weekly) {
  if (!weekly || typeof weekly !== 'object' || Array.isArray(weekly)) throw new SchedulingError('weekly must be an object of weekday → intervals', 'invalid_weekly');
  const out = {};
  for (const [k, list] of Object.entries(weekly)) {
    if (!/^[1-7]$/.test(k)) throw new SchedulingError('Weekdays are 1 (Monday) to 7 (Sunday)', 'invalid_weekly');
    if (!Array.isArray(list) || list.length > 6) throw new SchedulingError('Each day takes up to six intervals', 'invalid_weekly');
    out[k] = list.map((iv) => {
      if (!Array.isArray(iv) || !HHMM.test(iv[0]) || !(HHMM.test(iv[1]) || iv[1] === '24:00') || iv[0] >= iv[1]) throw new SchedulingError('An interval is ["HH:MM","HH:MM"], start before end', 'invalid_weekly');
      return [iv[0], iv[1]];
    }).sort((a, b) => a[0].localeCompare(b[0]));
    for (let i = 1; i < out[k].length; i++) if (out[k][i][0] < out[k][i - 1][1]) throw new SchedulingError('Intervals on one day overlap', 'invalid_weekly');
  }
  return out;
}
async function availabilityRow(db, ws, userId) {
  const r = (await db.query('SELECT timezone, weekly, updated_at FROM scheduling_availability WHERE workspace_id = $1 AND user_id = $2', [ws, userId])).rows[0];
  if (r) return { timezone: r.timezone, weekly: r.weekly, saved: true, source: 'scheduling' };
  // the People profile's stated hours ({days, start, end} in its timezone) are the default
  const p = (await db.query('SELECT timezone, working_hours FROM workforce_employee_profiles WHERE workspace_id = $1 AND principal_id = $2', [ws, userId]).catch(() => ({ rows: [] }))).rows[0];
  const h = p && p.working_hours;
  if (h && Array.isArray(h.days) && HHMM.test(h.start || '') && HHMM.test(h.end || '') && h.start < h.end) {
    return { timezone: validZone(p.timezone) ? p.timezone : 'UTC', weekly: Object.fromEntries(h.days.filter((d) => d >= 1 && d <= 7).map((d) => [String(d), [[h.start, h.end]]])), saved: false, source: 'profile' };
  }
  return { timezone: (p && validZone(p.timezone)) ? p.timezone : 'UTC', weekly: DEFAULT_WEEKLY, saved: false, source: 'default' };
}
const translate = (e) => { if (e instanceof people.PeopleError) throw new SchedulingError(e.message, e.code, e.status); throw e; };
export async function getAvailability(db, actor, { workspace, user } = {}) {
  const s = await scopeFor(db, actor, { workspace });
  const who = user ? String(user) : s.userId;
  if (!UUID.test(who) || !(await isMember(db, s.ws, who))) throw new SchedulingError('That person is not in this workspace', 'not_a_member', 404);
  const a = await availabilityRow(db, s.ws, who);
  const timeOff = (await db.query(`SELECT id, starts_at, ends_at, kind, note FROM workforce_time_off WHERE workspace_id = $1 AND principal_id = $2 AND cancelled_at IS NULL AND ends_at > NOW() ORDER BY starts_at`, [s.ws, who])).rows
    .map((r) => ({ id: r.id, startsAt: r.starts_at.toISOString(), endsAt: r.ends_at.toISOString(), kind: r.kind, note: who === s.userId ? r.note : '' }));
  return { workspaceId: s.ws, userId: who, ...a, timeOff };
}
export async function setAvailability(db, actor, { workspace, timezone, weekly } = {}) {
  const s = await scopeFor(db, actor, { workspace, write: true });
  const tz = text(timezone || 'UTC', 'timezone', 64);
  if (!validZone(tz)) throw new SchedulingError('Unknown time zone', 'invalid_timezone');
  const w = cleanWeekly(weekly ?? DEFAULT_WEEKLY);
  await db.query(`INSERT INTO scheduling_availability (workspace_id, user_id, timezone, weekly) VALUES ($1,$2,$3,$4)
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET timezone = EXCLUDED.timezone, weekly = EXCLUDED.weekly, updated_at = NOW()`, [s.ws, s.userId, tz, JSON.stringify(w)]);
  return getAvailability(db, actor, { workspace: s.ws });
}
/** Time off is People's: these call workforcePeople (the one writer of workforce_time_off). */
export async function addTimeOff(db, actor, { workspace, startsAt, endsAt, kind = 'vacation', note } = {}) {
  const s = await scopeFor(db, actor, { workspace, write: true });
  return people.addTimeOff(db, { id: s.userId }, { workspaceId: s.ws, startsAt, endsAt, kind, note: note || '' }).catch(translate);
}
export async function removeTimeOff(db, actor, { workspace, id } = {}) {
  const s = await scopeFor(db, actor, { workspace, write: true });
  return people.cancelTimeOff(db, { id: s.userId }, { workspaceId: s.ws, timeOffId: id }).catch(translate);
}

/** Confirmed booked intervals of a person between two instants (any workspace: a person cannot be in two places). */
export async function bookedBetween(db, userId, from, to) {
  return (await db.query(`SELECT b.id, b.starts_at, b.ends_at, p.buffer_minutes FROM scheduling_bookings b JOIN scheduling_pages p ON p.id = b.page_id
    WHERE b.host_user_id = $1 AND b.status = 'confirmed' AND b.starts_at < $3 AND b.ends_at > $2 ORDER BY b.starts_at`, [userId, from, to])).rows;
}
/** Is this person booked right now (or at `at`)? Places and assignment read this. */
export async function busyAt(db, userId, at = new Date()) {
  const r = (await db.query(`SELECT ends_at FROM scheduling_bookings WHERE host_user_id = $1 AND status = 'confirmed' AND starts_at <= $2 AND ends_at > $2 LIMIT 1`, [userId, at])).rows[0];
  return r ? { busy: true, until: r.ends_at.toISOString() } : { busy: false, until: null };
}

/** Free start times for a page between `from` and `to` (capped to the page's horizon). */
async function slotsForPage(db, page, { from, to, ignoreBooking = null } = {}) {
  const now = Date.now();
  const lo = Math.max(from ? when(from, 'from').getTime() : now, now + page.min_notice_minutes * MIN);
  const hi = Math.min(to ? when(to, 'to').getTime() : now + 14 * 86400_000, now + page.horizon_days * 86400_000);
  if (hi <= lo) return [];
  const a = await availabilityRow(db, page.workspace_id, page.host_user_id);
  const tz = validZone(a.timezone) ? a.timezone : 'UTC';
  const off = (await db.query('SELECT starts_at, ends_at FROM workforce_time_off WHERE principal_id = $1 AND cancelled_at IS NULL AND starts_at < $3 AND ends_at > $2', [page.host_user_id, new Date(lo), new Date(hi)])).rows
    .map((r) => [r.starts_at.getTime(), r.ends_at.getTime()]);
  const buf = page.buffer_minutes * MIN;
  const booked = (await bookedBetween(db, page.host_user_id, new Date(lo - 8 * 3600_000), new Date(hi + 8 * 3600_000)))
    .filter((b) => b.id !== ignoreBooking).map((b) => [b.starts_at.getTime() - Math.max(buf, b.buffer_minutes * MIN), b.ends_at.getTime() + Math.max(buf, b.buffer_minutes * MIN)]);
  const dur = page.duration_minutes * MIN, step = Math.min(dur, 30 * MIN) >= 15 * MIN ? Math.min(dur, 30 * MIN) : 15 * MIN;
  const out = [];
  for (let day = lo - 86400_000; day <= hi + 86400_000 && out.length < 500; day += 86400_000) {
    const ld = localDate(day, tz);
    for (const [s, e] of (a.weekly[String(ld.wd)] || [])) {
      const start = zoned(ld.y, ld.m, ld.d, s, tz), end = e === '24:00' ? zoned(ld.y, ld.m, ld.d, '00:00', tz) + 86400_000 : zoned(ld.y, ld.m, ld.d, e, tz);
      for (let t = start; t + dur <= end; t += step) {
        if (t < lo || t + dur > hi) continue;
        const clash = (iv) => iv[0] < t + dur && iv[1] > t;
        if (off.some(clash) || booked.some(clash)) continue;
        out.push(new Date(t).toISOString());
      }
    }
  }
  return [...new Set(out)].sort();
}

// ─────────────────────────────────────────── booking pages

const pageOut = (p) => ({ id: p.id, slug: p.slug, title: p.title, description: p.description, durationMinutes: p.duration_minutes, bufferMinutes: p.buffer_minutes,
  minNoticeMinutes: p.min_notice_minutes, horizonDays: p.horizon_days, reminderMinutes: p.reminder_minutes, active: p.active, hostUserId: p.host_user_id,
  workspaceId: p.workspace_id, url: bookUrl(p.slug), deleted: !!p.deleted_at });
async function pageFor(db, s, id, { manage = false } = {}) {
  if (!UUID.test(String(id))) throw new SchedulingError('Booking page not found', 'not_found', 404);
  const p = (await db.query('SELECT * FROM scheduling_pages WHERE id = $1 AND workspace_id = $2', [id, s.ws])).rows[0];
  if (!p) throw new SchedulingError('Booking page not found', 'not_found', 404);
  if (manage && String(p.host_user_id) !== s.userId && !s.admin) throw new SchedulingError('Only its host or a workspace admin can change this page', 'not_allowed', 403);
  return p;
}
export async function listPages(db, actor, { workspace } = {}) {
  const s = await scopeFor(db, actor, { workspace });
  const rows = (await db.query('SELECT * FROM scheduling_pages WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC', [s.ws])).rows;
  return { workspaceId: s.ws, pages: rows.map(pageOut) };
}
function pageFields(b, base = {}) {
  return {
    title: b.title !== undefined ? text(b.title, 'title', 200) : base.title,
    description: b.description !== undefined ? text(b.description, 'description', 2000, false) : base.description ?? '',
    duration: int(b.durationMinutes, 'durationMinutes', 5, 480, base.duration_minutes ?? 30),
    buffer: int(b.bufferMinutes, 'bufferMinutes', 0, 240, base.buffer_minutes ?? 0),
    notice: int(b.minNoticeMinutes, 'minNoticeMinutes', 0, 43200, base.min_notice_minutes ?? 60),
    horizon: int(b.horizonDays, 'horizonDays', 1, 365, base.horizon_days ?? 30),
    reminder: int(b.reminderMinutes, 'reminderMinutes', 0, 10080, base.reminder_minutes ?? 60),
  };
}
export async function createPage(db, actor, body = {}) {
  const s = await scopeFor(db, actor, { workspace: body.workspace, write: true });
  const slug = text(body.slug, 'slug', 63).toLowerCase();
  if (!SLUG.test(slug)) throw new SchedulingError('A link name is 3–63 lowercase letters, digits and dashes', 'invalid_slug');
  const f = pageFields(body);
  try {
    const p = (await db.query(`INSERT INTO scheduling_pages (workspace_id, host_user_id, slug, title, description, duration_minutes, buffer_minutes, min_notice_minutes, horizon_days, reminder_minutes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$2) RETURNING *`, [s.ws, s.userId, slug, f.title, f.description, f.duration, f.buffer, f.notice, f.horizon, f.reminder])).rows[0];
    return { page: pageOut(p) };
  } catch (e) {
    if (e.code === '23505') throw new SchedulingError('That link name is taken', 'slug_taken', 409);
    throw e;
  }
}
export async function updatePage(db, actor, { workspace, id, ...body } = {}) {
  const s = await scopeFor(db, actor, { workspace, write: true });
  const p = await pageFor(db, s, id, { manage: true });
  const f = pageFields(body, p);
  const active = body.active === undefined ? p.active : body.active === true;
  const r = (await db.query(`UPDATE scheduling_pages SET title=$2, description=$3, duration_minutes=$4, buffer_minutes=$5, min_notice_minutes=$6, horizon_days=$7, reminder_minutes=$8, active=$9, updated_at=NOW()
    WHERE id = $1 RETURNING *`, [p.id, f.title, f.description, f.duration, f.buffer, f.notice, f.horizon, f.reminder, active])).rows[0];
  return { page: pageOut(r) };
}
export async function deletePage(db, actor, { workspace, id } = {}) {
  const s = await scopeFor(db, actor, { workspace, write: true });
  const p = await pageFor(db, s, id, { manage: true });
  await db.query('UPDATE scheduling_pages SET deleted_at = NOW(), active = FALSE, updated_at = NOW() WHERE id = $1', [p.id]);
  return { deleted: true, id: p.id, undo: 'restore' };
}
export async function restorePage(db, actor, { workspace, id } = {}) {
  const s = await scopeFor(db, actor, { workspace, write: true });
  const p = await pageFor(db, s, id, { manage: true });
  const r = (await db.query('UPDATE scheduling_pages SET deleted_at = NULL, active = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *', [p.id])).rows[0];
  return { page: pageOut(r) };
}
export async function listSlots(db, actor, { workspace, id, from, to } = {}) {
  const s = await scopeFor(db, actor, { workspace });
  const p = await pageFor(db, s, id);
  return { pageId: p.id, slots: await slotsForPage(db, p, { from, to }) };
}

// ─────────────────────────────────────────── bookings

const bookingOut = (b, { guest = true } = {}) => ({ id: b.id, pageId: b.page_id, hostUserId: b.host_user_id, startsAt: b.starts_at.toISOString(), endsAt: b.ends_at.toISOString(),
  status: b.status, guestName: guest ? b.guest_name : undefined, guestEmail: guest ? b.guest_email : undefined, note: guest ? b.note : undefined,
  cancelledBy: b.cancelled_by, rescheduledFrom: b.rescheduled_from });

export async function listBookings(db, actor, { workspace, scope = 'mine', includePast = false } = {}) {
  const s = await scopeFor(db, actor, { workspace });
  const all = scope === 'workspace' && s.admin;
  const rows = (await db.query(`SELECT b.*, p.title AS page_title FROM scheduling_bookings b JOIN scheduling_pages p ON p.id = b.page_id
    WHERE b.workspace_id = $1 AND ($2::boolean OR b.host_user_id = $3) AND ($4::boolean OR b.ends_at > NOW()) ORDER BY b.starts_at LIMIT 500`,
  [s.ws, all, s.userId, includePast === true])).rows;
  return { workspaceId: s.ws, bookings: rows.map((b) => ({ ...bookingOut(b), pageTitle: b.page_title })) };
}

async function makeEvent(db, b, page) {
  await db.query(`INSERT INTO calendar_events (workspace_id, user_id, title, description, starts_at, ends_at, source, booking_id)
    VALUES ($1,$2,$3,$4,$5,$6,'booking',$7)
    ON CONFLICT (booking_id) DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, cancelled = FALSE, sequence = calendar_events.sequence + 1, updated_at = NOW()`,
  [b.workspace_id, b.host_user_id, `${page.title} with ${b.guest_name}`.slice(0, 400), `${b.guest_email}${b.note ? '\n' + b.note : ''}`, b.starts_at, b.ends_at, b.id]);
}
async function notifyHost(db, b, page, kind, detail) {
  await db.query(`INSERT INTO user_notifications (user_id, source, kind, ref, title, detail) VALUES ($1,'scheduling',$2,$3,$4,$5)`,
    [b.host_user_id, kind, `scheduling/${b.id}`, `${page.title} · ${b.guest_name}`.slice(0, 400), String(detail).slice(0, 1000)]);
}
async function mailBoth(db, b, page, update, manage) {
  if (!emailsEnabled()) return { mailed: false };
  const host = (await db.query('SELECT email, COALESCE(display_name, username) AS name FROM users WHERE id = $1', [b.host_user_id])).rows[0];
  const at = `${b.starts_at.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  const send = (to, name, url) => sendEmail(db, 'scheduling_update', to, { displayName: name, update, title: page.title, at, url }).catch((e) => console.error('[Scheduling] mail', e.message));
  await send(b.guest_email, b.guest_name, manage ? manageUrl(manage) : bookUrl(page.slug));
  if (host && host.email) await send(host.email, host.name, `${siteOrigin()}/workspace/#/corpo/z/scheduling`);
  return { mailed: true };
}

async function insertBooking(db, page, { startsAt, name, email, note, from = null }) {
  const start = when(startsAt, 'startsAt');
  const free = await slotsForPage(db, page, { from: new Date(start.getTime() - MIN), to: new Date(start.getTime() + page.duration_minutes * MIN + MIN), ignoreBooking: from });
  if (!free.includes(start.toISOString())) throw new SchedulingError('That time is no longer free', 'slot_unavailable', 409);
  const t = token();
  try {
    const b = (await db.query(`INSERT INTO scheduling_bookings (page_id, workspace_id, host_user_id, starts_at, ends_at, guest_name, guest_email, note, manage_token_hash, rescheduled_from)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [page.id, page.workspace_id, page.host_user_id, start, new Date(start.getTime() + page.duration_minutes * MIN), name, email, note, hash(t), from])).rows[0];
    return { b, t };
  } catch (e) {
    if (e.code === '23P01') throw new SchedulingError('That time is no longer free', 'slot_unavailable', 409);
    throw e;
  }
}
async function publicPage(db, slug) {
  if (!SLUG.test(String(slug || ''))) throw new SchedulingError('Booking page not found', 'not_found', 404);
  const p = (await db.query('SELECT * FROM scheduling_pages WHERE slug = $1 AND active AND deleted_at IS NULL', [slug])).rows[0];
  if (!p) throw new SchedulingError('Booking page not found', 'not_found', 404);
  return p;
}
export async function publicView(db, slug, { from, to } = {}) {
  const p = await publicPage(db, slug);
  const host = (await db.query('SELECT COALESCE(display_name, username) AS name FROM users WHERE id = $1', [p.host_user_id])).rows[0];
  return { page: { slug: p.slug, title: p.title, description: p.description, durationMinutes: p.duration_minutes, hostName: host ? host.name : '' }, slots: await slotsForPage(db, p, { from, to }) };
}
/** A guest books (no account). Returns the booking and the manage link, shown once. */
export async function book(db, slug, { startsAt, name, email, note } = {}) {
  const p = await publicPage(db, slug);
  const n = text(name, 'name', 200), e = text(email, 'email', 320).toLowerCase(), nt = text(note, 'note', 2000, false);
  if (!EMAIL.test(e)) throw new SchedulingError('That e-mail address does not look right', 'invalid_email');
  const c = (await db.query(`SELECT COUNT(*) FILTER (WHERE page_id = $1)::int AS page, COUNT(*) FILTER (WHERE guest_email = $2)::int AS mail
    FROM scheduling_bookings WHERE created_at > NOW() - INTERVAL '1 hour' AND (page_id = $1 OR guest_email = $2)`, [p.id, e])).rows[0];
  if (c.page >= LIMITS.perPageHour || c.mail >= LIMITS.perEmailHour) throw new SchedulingError('Too many bookings just now — try again later', 'rate_limited', 429);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`scheduling:${p.host_user_id}`]);
    const { b, t } = await insertBooking(client, p, { startsAt, name: n, email: e, note: nt });
    await makeEvent(client, b, p);
    await notifyHost(client, b, p, 'scheduling_booked', `New booking ${b.starts_at.toISOString()}`);
    await client.query('COMMIT');
    await mailBoth(db, b, p, 'Booking confirmed', t);
    return { booking: bookingOut(b), manageUrl: manageUrl(t), manageToken: t };
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; }
  finally { client.release(); }
}
async function byToken(db, t) {
  const b = (await db.query('SELECT * FROM scheduling_bookings WHERE manage_token_hash = $1', [hash(t)])).rows[0];
  if (!b) throw new SchedulingError('Booking not found', 'not_found', 404);
  const p = (await db.query('SELECT * FROM scheduling_pages WHERE id = $1', [b.page_id])).rows[0];
  return { b, p };
}
export async function manageView(db, t) {
  const { b, p } = await byToken(db, t);
  return { booking: bookingOut(b), page: { slug: p.slug, title: p.title, durationMinutes: p.duration_minutes },
    slots: b.status === 'confirmed' && !p.deleted_at ? await slotsForPage(db, p, { ignoreBooking: b.id }) : [] };
}
async function cancelRow(db, b, p, by) {
  await db.query(`UPDATE scheduling_bookings SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2 WHERE id = $1`, [b.id, by]);
  await db.query('UPDATE calendar_events SET cancelled = TRUE, sequence = sequence + 1, updated_at = NOW() WHERE booking_id = $1', [b.id]);
}
export async function guestCancel(db, t) {
  const { b, p } = await byToken(db, t);
  if (b.status !== 'confirmed') throw new SchedulingError('This booking is already cancelled', 'already_cancelled', 409);
  await cancelRow(db, b, p, 'guest');
  await notifyHost(db, b, p, 'scheduling_cancelled', `${b.guest_name} cancelled ${b.starts_at.toISOString()}`);
  await mailBoth(db, b, p, 'Booking cancelled', null);
  return { cancelled: true };
}
/** Reschedule = a new confirmed booking (new link) and the old one cancelled, in one transaction. */
export async function guestReschedule(db, t, { startsAt } = {}) {
  const { b, p } = await byToken(db, t);
  if (b.status !== 'confirmed') throw new SchedulingError('This booking is cancelled', 'already_cancelled', 409);
  if (p.deleted_at || !p.active) throw new SchedulingError('This booking page is closed', 'page_closed', 409);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`scheduling:${p.host_user_id}`]);
    await client.query(`UPDATE scheduling_bookings SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = 'guest' WHERE id = $1`, [b.id]);
    const n = await insertBooking(client, p, { startsAt, name: b.guest_name, email: b.guest_email, note: b.note, from: b.id });
    await client.query('DELETE FROM calendar_events WHERE booking_id = $1', [b.id]);
    await makeEvent(client, n.b, p);
    await notifyHost(client, n.b, p, 'scheduling_rescheduled', `${b.guest_name} moved to ${n.b.starts_at.toISOString()}`);
    await client.query('COMMIT');
    await mailBoth(db, n.b, p, 'Booking moved', n.t);
    return { booking: bookingOut(n.b), manageUrl: manageUrl(n.t), manageToken: n.t };
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; }
  finally { client.release(); }
}
/** The host (or a workspace admin) cancels. A person's act; agents may not. */
export async function hostCancel(db, actor, { workspace, id } = {}) {
  const s = await scopeFor(db, actor, { workspace, write: true });
  if (!UUID.test(String(id))) throw new SchedulingError('Booking not found', 'not_found', 404);
  const b = (await db.query('SELECT * FROM scheduling_bookings WHERE id = $1 AND workspace_id = $2', [id, s.ws])).rows[0];
  if (!b) throw new SchedulingError('Booking not found', 'not_found', 404);
  if (String(b.host_user_id) !== s.userId && !s.admin) throw new SchedulingError('Only the host or an admin can cancel this', 'not_allowed', 403);
  if (b.status !== 'confirmed') throw new SchedulingError('This booking is already cancelled', 'already_cancelled', 409);
  const p = (await db.query('SELECT * FROM scheduling_pages WHERE id = $1', [b.page_id])).rows[0];
  await cancelRow(db, b, p, 'host');
  await mailBoth(db, b, p, 'Booking cancelled by the host', null);
  return { cancelled: true, id: b.id };
}

// ─────────────────────────────────────────── reminders

/** Remind the host (notification) and, behind SCHEDULING_EMAILS, both people, once per booking. */
export async function sendDueReminders(db, now = new Date()) {
  const due = (await db.query(`UPDATE scheduling_bookings b SET reminder_sent_at = $1 FROM scheduling_pages p
    WHERE p.id = b.page_id AND b.status = 'confirmed' AND b.reminder_sent_at IS NULL AND p.reminder_minutes > 0
      AND b.starts_at > $1 AND b.starts_at <= $1::timestamptz + make_interval(mins => p.reminder_minutes)
    RETURNING b.*`, [now])).rows;
  for (const b of due) {
    const p = (await db.query('SELECT * FROM scheduling_pages WHERE id = $1', [b.page_id])).rows[0];
    await notifyHost(db, b, p, 'scheduling_reminder', `Starts ${b.starts_at.toISOString()}`);
    await mailBoth(db, b, p, 'Reminder: your booking is coming up', null);
  }
  return { reminded: due.length };
}

// ─────────────────────────────────────────── calendar + ICS

export async function listEvents(db, actor, { workspace, from, to } = {}) {
  const s = await scopeFor(db, actor, { workspace });
  const a = from ? when(from, 'from') : new Date(Date.now() - 7 * 86400_000), b = to ? when(to, 'to') : new Date(Date.now() + 60 * 86400_000);
  const rows = (await db.query(`SELECT * FROM calendar_events WHERE workspace_id = $1 AND user_id = $2 AND starts_at < $4 AND ends_at > $3 ORDER BY starts_at LIMIT 1000`, [s.ws, s.userId, a, b])).rows;
  return { events: rows.map((e) => ({ id: e.id, title: e.title, startsAt: e.starts_at.toISOString(), endsAt: e.ends_at.toISOString(), source: e.source, bookingId: e.booking_id, cancelled: e.cancelled })) };
}
const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const fold = (line) => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };
export function toIcs(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//XENO//Scheduling//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:XENO'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@xenosystem.ai`, `DTSTAMP:${icsDate(e.updated_at)}`, `DTSTART:${icsDate(e.starts_at)}`, `DTEND:${icsDate(e.ends_at)}`,
      `SUMMARY:${icsEsc(e.title)}`, `DESCRIPTION:${icsEsc(e.description)}`, `SEQUENCE:${e.sequence}`, `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
async function eventsForIcs(db, ws, userId) {
  return (await db.query(`SELECT * FROM calendar_events WHERE workspace_id = $1 AND user_id = $2 AND ends_at > NOW() - INTERVAL '90 days' ORDER BY starts_at LIMIT 2000`, [ws, userId])).rows;
}
export async function exportIcs(db, actor, { workspace } = {}) {
  const s = await scopeFor(db, actor, { workspace });
  return toIcs(await eventsForIcs(db, s.ws, s.userId));
}
/** Create (or rotate) the private feed URL. Shown once; the old URL stops working. */
export async function rotateFeed(db, actor, { workspace } = {}) {
  const s = await scopeFor(db, actor, { workspace, write: true });
  const t = token();
  await db.query(`INSERT INTO calendar_feed_tokens (workspace_id, user_id, token_hash) VALUES ($1,$2,$3)
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = NOW()`, [s.ws, s.userId, hash(t)]);
  return { url: `${siteOrigin()}/api/scheduling/feed/${t}.ics` };
}
/** The feed by token. Membership is rechecked on every read: a removed member's feed goes dark. */
export async function feedIcs(db, t) {
  const r = (await db.query('SELECT workspace_id, user_id FROM calendar_feed_tokens WHERE token_hash = $1', [hash(t)])).rows[0];
  if (!r || !(await isMember(db, String(r.workspace_id), String(r.user_id)))) throw new SchedulingError('Feed not found', 'not_found', 404);
  return toIcs(await eventsForIcs(db, r.workspace_id, r.user_id));
}
