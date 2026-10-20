/**
 * Corpo › Scheduling (services/scheduling.js + schedulingMcp.js + routes/schedulingRoutes.js) on real Postgres.
 *
 *   - availability: weekly hours in the person's time zone, minus time off, minus bookings (+ buffer) = slots
 *   - §8.11: members read; a member makes pages that book THEM; only host/admin changes a page; a stranger is
 *     refused; an agent reads as its owner and cannot write — the database refuses an agent-created page too
 *   - a guest books with no account; the slot disappears; a double booking is refused by the service AND the trigger
 *   - booking → calendar event; manage link reschedules (new event time, old link dead) and cancels (event cancelled)
 *   - reminders: once, the host's notification; mail only behind SCHEDULING_EMAILS
 *   - ICS export + private feed; rotating kills the old feed; a removed member's feed goes dark
 *   - rate limit per guest e-mail; Places shows a booked person as in-meeting
 *   - the public HTML pages work through HTTP without an account
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/scheduling.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as S from '../services/scheduling.js';
import * as Mcp from '../services/schedulingMcp.js';
import * as people from '../services/workforcePeople.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `sch${process.pid}`; let seq = 0, passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log(`  ok  ${m}`); };
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$3,true,true,'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
const code = async (p) => { try { await p; return null; } catch (e) { return e.code || e.message; } };
const H = (id) => ({ id, kind: 'human' });

async function main() {
  await runAllMigrations(pool);
  const owner = await user('owner'), host = await user('host'), viewer = await user('viewer'), stranger = await user('stranger'), bot = await user('bot');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [bot, host]);
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team','Sched',$2) RETURNING id`, [owner, `${tag}-${seq += 1}`])).rows[0].id;
  await writeTuples(pool, { writes: [['owner', owner], ['editor', host], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation })) });
  const W = { workspace: ws };

  // the People profile's stated hours are the default
  await pool.query(`INSERT INTO workforce_employee_profiles (workspace_id, principal_id, timezone, working_hours) VALUES ($1,$2,'Europe/Berlin','{"days":[1,2,3],"start":"10:00","end":"16:00"}')`, [ws, host]);
  const pd = await S.getAvailability(pool, H(host), W);
  ok(pd.source === 'profile' && pd.timezone === 'Europe/Berlin' && pd.weekly['2'][0][0] === '10:00' && !pd.weekly['5'], 'with no booking hours saved, the People profile’s hours are used');

  // availability: every day 00:00–24:00 UTC so slots exist whatever day the test runs
  const allDay = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), [['00:00', '24:00']]]));
  const av = await S.setAvailability(pool, H(host), { ...W, timezone: 'UTC', weekly: allDay });
  ok(av.saved && av.timezone === 'UTC', 'a member saves their weekly hours');
  ok(await code(S.setAvailability(pool, H(host), { ...W, timezone: 'Mars/Olympus' })) === 'invalid_timezone', 'an unknown time zone is refused');
  ok(await code(S.setAvailability(pool, H(host), { ...W, weekly: { 1: [['10:00', '09:00']] } })) === 'invalid_weekly', 'an interval ending before it starts is refused');
  ok(await code(S.getAvailability(pool, H(stranger), W)) === 'not_a_member', 'a stranger cannot read the workspace');
  ok((await S.getAvailability(pool, { id: bot, kind: 'agent' }, W)).userId === String(host), 'an agent reads availability as its owner');
  ok(await code(S.setAvailability(pool, { id: bot, kind: 'agent' }, { ...W, timezone: 'UTC' })) === 'person_required', 'an agent cannot change availability');

  // time zones
  const t = S.zoned(2026, 7, 1, '09:00', 'Europe/Berlin');
  ok(new Date(t).toISOString() === '2026-07-01T07:00:00.000Z', 'local 09:00 Berlin in summer is 07:00 UTC');
  ok(new Date(S.zoned(2026, 1, 15, '09:00', 'Europe/Berlin')).toISOString() === '2026-01-15T08:00:00.000Z', 'and 08:00 UTC in winter');

  // pages
  const slug = `${tag}-intro`;
  const { page } = await S.createPage(pool, H(host), { ...W, slug, title: 'Intro call', durationMinutes: 30, bufferMinutes: 15, minNoticeMinutes: 60, reminderMinutes: 60 });
  ok(page.url.endsWith(`/api/scheduling/book/${slug}`) && page.hostUserId === String(host), 'a member creates a booking page that books them');
  ok(await code(S.createPage(pool, H(viewer), { ...W, slug, title: 'x' })) === 'slug_taken', 'a link name is unique');
  ok(await code(S.createPage(pool, H(host), { ...W, slug: 'A B', title: 'x' })) === 'invalid_slug', 'a bad link name is refused');
  ok(await code(S.createPage(pool, { id: bot, kind: 'agent' }, { ...W, slug: `${tag}-bot`, title: 'x' })) === 'person_required', 'an agent cannot create a public booking link');
  ok(await code(pool.query(`INSERT INTO scheduling_pages (workspace_id, host_user_id, slug, title, duration_minutes, created_by) VALUES ($1,$2,$3,'x',30,$2)`, [ws, bot, `${tag}-sql`])) === '23514', 'the database refuses an agent-created page whatever path wrote it');
  ok(await code(S.updatePage(pool, H(viewer), { ...W, id: page.id, title: 'Hijack' })) === 'not_allowed', 'a member cannot change someone else’s page');
  ok((await S.updatePage(pool, H(owner), { ...W, id: page.id, description: 'Say hi' })).page.description === 'Say hi', 'a workspace admin can');

  // slots, minus time off
  const slots0 = (await S.listSlots(pool, H(viewer), { ...W, id: page.id })).slots;
  ok(slots0.length > 100 && new Date(slots0[0]).getTime() >= Date.now() + 60 * 60_000, 'free slots respect the minimum notice');
  const off = await S.addTimeOff(pool, H(host), { ...W, startsAt: slots0[0], endsAt: new Date(new Date(slots0[0]).getTime() + 3 * 3600_000).toISOString(), note: 'Dentist' });
  const slotsOff = (await S.listSlots(pool, H(host), { ...W, id: page.id })).slots;
  ok(!slotsOff.includes(slots0[0]) && !slotsOff.includes(slots0[2]), 'time off removes slots');
  ok((await S.getAvailability(pool, H(viewer), { ...W, user: host })).timeOff[0].note === '' && (await S.getAvailability(pool, H(host), W)).timeOff[0].note === 'Dentist', 'time off is People’s; another member sees it but not its note');
  ok((await pool.query('SELECT count(*)::int AS n FROM workforce_time_off WHERE id = $1', [off.id])).rows[0].n === 1, 'it is stored in workforce_time_off, not a second table');
  await S.removeTimeOff(pool, H(host), { ...W, id: off.id });

  // book (guest, no account)
  const at = slots0[4];
  const r = await S.book(pool, slug, { startsAt: at, name: 'Grace Guest', email: 'grace@example.test', note: 'hello' });
  ok(r.booking.status === 'confirmed' && r.manageToken && r.manageUrl.includes('/api/scheduling/manage/'), 'a guest books without an account and gets a manage link');
  const slots1 = (await S.listSlots(pool, H(host), { ...W, id: page.id })).slots;
  const atMs = new Date(at).getTime();
  ok(!slots1.includes(at) && !slots1.includes(new Date(atMs + 30 * 60_000).toISOString()), 'the booked time and its buffer are no longer free');
  ok(await code(S.book(pool, slug, { startsAt: at, name: 'Eve', email: 'eve@example.test' })) === 'slot_unavailable', 'a double booking is refused by the service');
  ok(await code(pool.query(`INSERT INTO scheduling_bookings (page_id, workspace_id, host_user_id, starts_at, ends_at, guest_name, guest_email, manage_token_hash) VALUES ($1,$2,$3,$4,$5,'x','x@y.z',$6)`,
    [page.id, ws, host, at, new Date(atMs + 30 * 60_000), `h${Date.now()}`])) === '23P01', 'and by the database trigger');
  ok(await code(S.book(pool, slug, { startsAt: slots0[20], name: 'Bad', email: 'not-an-email' })) === 'invalid_email', 'a bad e-mail is refused');
  const ev = (await S.listEvents(pool, H(host), W)).events.find((e) => e.bookingId === r.booking.id);
  ok(ev && ev.startsAt === at && !ev.cancelled && ev.title.includes('Grace Guest'), 'the booking is an event on the host’s calendar');
  ok((await S.listEvents(pool, H(viewer), W)).events.length === 0, 'and only on theirs');
  const notes = (await pool.query(`SELECT kind FROM user_notifications WHERE user_id = $1 AND source = 'scheduling'`, [host])).rows.map((x) => x.kind);
  ok(notes.includes('scheduling_booked'), 'the host is notified');
  ok((await Mcp.callTool(pool, { id: bot, kind: 'agent' }, 'list_bookings', W)).structuredContent.bookings.some((b) => b.id === r.booking.id), 'an agent lists its owner’s bookings');
  ok(!Mcp.TOOLS.some((x) => !x.annotations.readOnlyHint), 'every scheduling tool is read-only');

  // reschedule and cancel through the manage link
  const to = slots1.find((s) => new Date(s).getTime() > atMs + 4 * 3600_000);
  const moved = await S.guestReschedule(pool, r.manageToken, { startsAt: to });
  ok(moved.booking.startsAt === to && moved.booking.rescheduledFrom === r.booking.id, 'the guest moves the booking');
  ok((await S.manageView(pool, r.manageToken)).booking.status === 'cancelled', 'the old link shows the old booking cancelled');
  ok(await code(S.guestCancel(pool, r.manageToken)) === 'already_cancelled', 'and cannot cancel again');
  const ev2 = (await S.listEvents(pool, H(host), W)).events.find((e) => e.bookingId === moved.booking.id);
  ok(ev2 && ev2.startsAt === to, 'the calendar event follows the new time');
  ok((await S.listSlots(pool, H(host), { ...W, id: page.id })).slots.includes(at), 'the old time is free again');

  // reminders
  await pool.query(`UPDATE scheduling_bookings SET starts_at = NOW() + INTERVAL '30 minutes', ends_at = NOW() + INTERVAL '60 minutes' WHERE id = $1`, [moved.booking.id]);
  const prev = process.env.SCHEDULING_EMAILS; process.env.SCHEDULING_EMAILS = '';
  ok((await S.sendDueReminders(pool)).reminded === 1, 'a booking inside its reminder window is reminded');
  ok((await S.sendDueReminders(pool)).reminded === 0, 'once');
  ok(!S.emailsEnabled({}) && !S.emailsEnabled({ SCHEDULING_EMAILS: 'yes' }) && S.emailsEnabled({ SCHEDULING_EMAILS: 'true' }), 'mail is off unless SCHEDULING_EMAILS is exactly true');
  process.env.SCHEDULING_EMAILS = prev ?? '';

  // ICS
  const ics = await S.exportIcs(pool, H(host), W);
  ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.includes(`UID:${ev2.id}@xenosystem.ai`) && ics.includes('STATUS:CONFIRMED') && !ics.includes(`UID:${ev.id}@`), 'ICS export carries the event (the rescheduled booking’s old event is gone)');
  ok(S.toIcs([{ id: 'x', title: 'a,b;c\nd', description: '', starts_at: new Date(0), ends_at: new Date(1000), updated_at: new Date(0), sequence: 0, cancelled: false }]).includes('SUMMARY:a\\,b\\;c\\nd'), 'ICS text is escaped');
  const feed1 = await S.rotateFeed(pool, H(host), W), tok1 = feed1.url.match(/feed\/(.+)\.ics$/)[1];
  ok((await S.feedIcs(pool, tok1)).includes('BEGIN:VEVENT'), 'the private feed serves the calendar');
  const tok2 = (await S.rotateFeed(pool, H(host), W)).url.match(/feed\/(.+)\.ics$/)[1];
  ok(await code(S.feedIcs(pool, tok1)) === 'not_found' && (await S.feedIcs(pool, tok2)), 'rotating kills the old feed');
  const tokV = (await S.rotateFeed(pool, H(viewer), W)).url.match(/feed\/(.+)\.ics$/)[1];
  await writeTuples(pool, { deletes: [{ object: `workspace:${ws}`, subject: `user:${viewer}`, relation: 'viewer' }] });
  ok(await code(S.feedIcs(pool, tokV)) === 'not_found', 'a removed member’s feed goes dark');

  // host cancel
  ok(await code(S.hostCancel(pool, { id: bot, kind: 'agent' }, { ...W, id: moved.booking.id })) === 'person_required', 'an agent cannot cancel a booking');
  ok((await S.hostCancel(pool, H(host), { ...W, id: moved.booking.id })).cancelled, 'the host cancels');
  ok((await S.listEvents(pool, H(host), W)).events.find((e) => e.bookingId === moved.booking.id).cancelled, 'and the calendar event is cancelled');
  ok((await S.exportIcs(pool, H(host), W)).includes('STATUS:CANCELLED'), 'and the feed carries it as CANCELLED so calendars remove it');

  // rate limit per guest e-mail
  const free = (await S.listSlots(pool, H(host), { ...W, id: page.id })).slots;
  for (let i = 0; i < S.LIMITS.perEmailHour - 2; i++) await S.book(pool, slug, { startsAt: free[i * 6], name: 'Spam', email: 'grace@example.test' });
  ok(await code(S.book(pool, slug, { startsAt: free[100], name: 'Spam', email: 'grace@example.test' })) === 'rate_limited', 'a burst from one e-mail is refused');

  // delete / restore
  await S.deletePage(pool, H(host), { ...W, id: page.id });
  ok(await code(S.publicView(pool, slug)) === 'not_found', 'a deleted page is not bookable');
  await S.restorePage(pool, H(host), { ...W, id: page.id });
  ok((await S.publicView(pool, slug)).page.title === 'Intro call', 'restore reopens it');

  // Places / assignment: People's availability reports a person in a booked meeting as in_meeting
  await pool.query(`INSERT INTO scheduling_bookings (page_id, workspace_id, host_user_id, starts_at, ends_at, guest_name, guest_email, manage_token_hash) VALUES ($1,$2,$3,NOW() - INTERVAL '5 minutes', NOW() + INTERVAL '25 minutes','Now','now@x.yz',$4)`, [page.id, ws, host, `now${Date.now()}`]);
  ok((await S.busyAt(pool, host)).busy, 'busyAt sees the meeting');
  const am = await people.availabilityMap(pool, ws, [host, owner]);
  ok(am[host].available === false && am[host].reason === 'in_meeting' && am[host].until && am[owner].reason !== 'in_meeting', 'Places and assignment pickers see the booked person as in a meeting');
  ok((await people.availability(pool, ws, host)).reason === 'in_meeting', 'and so does the single-person check');

  // HTTP: public pages without an account
  const { default: routes } = await import('../routes/schedulingRoutes.js');
  const app = express(); app.use(express.urlencoded({ extended: false })); app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); }); app.use('/api/scheduling', routes);
  const srv = http.createServer(app); await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${srv.address().port}/api/scheduling`;
  try {
    const html = await (await fetch(`${base}/book/${slug}`)).text();
    ok(html.includes('Intro call') && html.includes('name="startsAt"') && html.includes('noindex'), 'the public booking page renders without an account');
    const pick = (await (await fetch(`${base}/book/${slug}?format=json`)).json()).slots[30];
    const res = await fetch(`${base}/book/${slug}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ startsAt: pick, name: 'Form Guest', email: 'form@example.test' }) });
    const done = await res.text();
    ok(res.status === 200 && done.includes('You are booked') && done.includes('/api/scheduling/manage/'), 'a plain form post books');
    ok((await fetch(`${base}/book/no-such-page`)).status === 404, 'an unknown page is a 404');
    ok((await fetch(`${base}/pages`)).status === 401, 'the workspace API needs sign-in');
    ok((await fetch(`${base}/feed/${tok2}.ics`)).headers.get('content-type').startsWith('text/calendar'), 'the feed is text/calendar');
  } finally { srv.close(); }

  console.log(`\nscheduling: ${passed} checks passed`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
