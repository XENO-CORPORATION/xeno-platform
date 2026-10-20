/**
 * /api/scheduling — Corpo › Scheduling (services/scheduling.js). Two halves:
 *
 * Signed in (the workspace screen; `workspace` in query or body, absent = Personal):
 *   GET    /availability?user=        · PUT /availability {timezone, weekly}
 *   POST   /time-off {startsAt, endsAt, kind, note} · DELETE /time-off/:id   (People's workforce_time_off)
 *   GET    /pages · POST /pages {slug, title, …} · PATCH /pages/:id · DELETE /pages/:id · POST /pages/:id/restore
 *   GET    /pages/:id/slots?from=&to=
 *   GET    /bookings?scope=mine|workspace · POST /bookings/:id/cancel
 *   GET    /events?from=&to= · GET /events.ics · POST /feed (rotate the private ICS URL)
 *
 * Public, no account (a guest; works without JavaScript, so it is plain forms):
 *   GET    /book/:slug                  the booking page (HTML) · ?format=json for slots
 *   POST   /book/:slug                  book {startsAt, name, email, note}
 *   GET    /manage/:token               reschedule or cancel (HTML)
 *   POST   /manage/:token/cancel · POST /manage/:token/reschedule {startsAt}
 *   GET    /feed/:token.ics             the person's private calendar feed
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import * as S from '../services/scheduling.js';

const router = express.Router();
const ws = (req) => (req.body && req.body.workspace) || req.query.workspace || null;
const actorOf = async (req) => {
  const isAgent = (await req.db.query('SELECT 1 FROM agent_identities WHERE user_id = $1', [req.user.id])).rows.length > 0;
  return { id: req.user.id, kind: isAgent ? 'agent' : 'human' };
};
const run = (fn) => [authMiddleware, async (req, res) => {
  try { res.json({ success: true, ...(await fn(req, await actorOf(req))) }); }
  catch (e) {
    if (e instanceof S.SchedulingError) return res.status(e.status).json({ success: false, code: e.code, error: e.message });
    console.error('Scheduling failed:', e); res.status(500).json({ success: false, error: 'Internal server error' });
  }
}];
const b = (req) => req.body || {};

router.get('/availability', ...run((req, a) => S.getAvailability(req.db, a, { workspace: ws(req), user: req.query.user || null })));
router.put('/availability', ...run((req, a) => S.setAvailability(req.db, a, { workspace: ws(req), timezone: b(req).timezone, weekly: b(req).weekly })));
router.post('/time-off', ...run(async (req, a) => ({ timeOff: await S.addTimeOff(req.db, a, { workspace: ws(req), startsAt: b(req).startsAt, endsAt: b(req).endsAt, kind: b(req).kind, note: b(req).note }) })));
router.delete('/time-off/:id', ...run((req, a) => S.removeTimeOff(req.db, a, { workspace: ws(req), id: req.params.id })));
router.get('/pages', ...run((req, a) => S.listPages(req.db, a, { workspace: ws(req) })));
router.post('/pages', ...run((req, a) => S.createPage(req.db, a, { ...b(req), workspace: ws(req) })));
router.patch('/pages/:id', ...run((req, a) => S.updatePage(req.db, a, { ...b(req), workspace: ws(req), id: req.params.id })));
router.delete('/pages/:id', ...run((req, a) => S.deletePage(req.db, a, { workspace: ws(req), id: req.params.id })));
router.post('/pages/:id/restore', ...run((req, a) => S.restorePage(req.db, a, { workspace: ws(req), id: req.params.id })));
router.get('/pages/:id/slots', ...run((req, a) => S.listSlots(req.db, a, { workspace: ws(req), id: req.params.id, from: req.query.from, to: req.query.to })));
router.get('/bookings', ...run((req, a) => S.listBookings(req.db, a, { workspace: ws(req), scope: req.query.scope, includePast: req.query.past === '1' })));
router.post('/bookings/:id/cancel', ...run((req, a) => S.hostCancel(req.db, a, { workspace: ws(req), id: req.params.id })));
router.get('/events', ...run((req, a) => S.listEvents(req.db, a, { workspace: ws(req), from: req.query.from, to: req.query.to })));
router.post('/feed', ...run((req, a) => S.rotateFeed(req.db, a, { workspace: ws(req) })));
router.get('/events.ics', authMiddleware, async (req, res) => {
  try { res.type('text/calendar; charset=utf-8').set('Content-Disposition', 'attachment; filename="xeno-calendar.ics"').send(await S.exportIcs(req.db, await actorOf(req), { workspace: ws(req) })); }
  catch (e) { res.status(e.status || 500).json({ success: false, code: e.code, error: e instanceof S.SchedulingError ? e.message : 'Internal server error' }); }
});

// ───────────────────────────── public: guests, no account

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Site tokens (landing-v3/primitives T): page #060606, card #101010, border white/6%, text #ece7df → #948d83 → #69635b.
const shell = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>
body{margin:0;background:#060606;color:#ece7df;font:15px/1.5 Inter,system-ui,sans-serif}main{max-width:640px;margin:0 auto;padding:40px 16px}
h1{font-size:clamp(22px,4vw,30px);margin:0 0 6px}p{color:#948d83}.card{background:#101010;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:18px;margin:16px 0}
.slots{display:flex;flex-wrap:wrap;gap:8px}.slots label{background:#151515;border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:6px 10px;cursor:pointer}
input[type=text],input[type=email],textarea{width:100%;box-sizing:border-box;background:#151515;color:#ece7df;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:8px;outline:none;margin:4px 0 10px}
input:focus,textarea:focus{border-color:rgba(255,255,255,.3)}button{background:#ece7df;color:#060606;border:0;border-radius:8px;padding:9px 16px;font-weight:600;cursor:pointer}
small,.dim{color:#69635b}</style></head><body><main>${body}</main></body></html>`;
const fmt = (iso) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const days = (slots) => { const m = new Map(); for (const s of slots) { const d = s.slice(0, 10); if (!m.has(d)) m.set(d, []); m.get(d).push(s); } return m; };
const slotPicker = (slots) => slots.length
  ? [...days(slots)].map(([d, list]) => `<div class="card"><b>${esc(d)}</b><div class="slots">${list.map((s) => `<label><input type="radio" name="startsAt" value="${esc(s)}" required> ${esc(s.slice(11, 16))}</label>`).join('')}</div></div>`).join('')
  : '<div class="card dim">No free times in the next two weeks.</div>';
const fail = (res, e, title = 'Scheduling') => {
  if (!(e instanceof S.SchedulingError)) console.error('Scheduling (public) failed:', e);
  const status = e instanceof S.SchedulingError ? e.status : 500;
  res.status(status).type('html').send(shell(title, `<h1>${status === 404 ? 'Not found' : 'That did not work'}</h1><p>${esc(e instanceof S.SchedulingError ? e.message : 'Something went wrong.')}</p>`));
};
const wantsJson = (req) => req.query.format === 'json' || String(req.headers.accept || '').startsWith('application/json');

router.get('/book/:slug', async (req, res) => {
  try {
    const v = await S.publicView(req.db, req.params.slug, { from: req.query.from, to: req.query.to });
    if (wantsJson(req)) return res.json({ success: true, ...v });
    res.type('html').send(shell(v.page.title, `<h1>${esc(v.page.title)}</h1><p>${esc(v.page.durationMinutes)} minutes with ${esc(v.page.hostName)}. ${esc(v.page.description)}</p>
      <form method="post" action="">${slotPicker(v.slots)}<div class="card"><label>Your name<input type="text" name="name" required maxlength="200"></label>
      <label>Your e-mail<input type="email" name="email" required maxlength="320"></label><label>Note <small>(optional)</small><textarea name="note" maxlength="2000" rows="3"></textarea></label>
      <button type="submit">Book</button></div></form><small>Times are shown in UTC.</small>`));
  } catch (e) { if (wantsJson(req)) return res.status(e.status || 500).json({ success: false, code: e.code, error: e.message }); fail(res, e); }
});
router.post('/book/:slug', async (req, res) => {
  try {
    const r = await S.book(req.db, req.params.slug, b(req));
    if (wantsJson(req)) return res.json({ success: true, booking: r.booking, manageUrl: r.manageUrl });
    res.type('html').send(shell('Booked', `<h1>You are booked</h1><div class="card">${esc(fmt(r.booking.startsAt))}</div>
      <p>Keep this link to reschedule or cancel: <a style="color:#ece7df" href="${esc(r.manageUrl)}">${esc(r.manageUrl)}</a></p>`));
  } catch (e) { if (wantsJson(req)) return res.status(e.status || 500).json({ success: false, code: e.code, error: e.message }); fail(res, e); }
});
router.get('/manage/:token', async (req, res) => {
  try {
    const v = await S.manageView(req.db, req.params.token);
    if (wantsJson(req)) return res.json({ success: true, ...v });
    const live = v.booking.status === 'confirmed';
    res.type('html').send(shell(v.page.title, `<h1>${esc(v.page.title)}</h1><div class="card">${esc(fmt(v.booking.startsAt))} · ${live ? 'confirmed' : 'cancelled'}</div>
      ${live ? `<form method="post" action="${esc(req.params.token)}/cancel"><button type="submit">Cancel this booking</button></form>
      <h2 style="font-size:18px;margin-top:28px">Move it</h2><form method="post" action="${esc(req.params.token)}/reschedule">${slotPicker(v.slots)}<button type="submit">Move to this time</button></form>` : ''}`));
  } catch (e) { if (wantsJson(req)) return res.status(e.status || 500).json({ success: false, code: e.code, error: e.message }); fail(res, e); }
});
router.post('/manage/:token/cancel', async (req, res) => {
  try { await S.guestCancel(req.db, req.params.token); if (wantsJson(req)) return res.json({ success: true, cancelled: true }); res.type('html').send(shell('Cancelled', '<h1>Your booking is cancelled</h1>')); }
  catch (e) { if (wantsJson(req)) return res.status(e.status || 500).json({ success: false, code: e.code, error: e.message }); fail(res, e); }
});
router.post('/manage/:token/reschedule', async (req, res) => {
  try {
    const r = await S.guestReschedule(req.db, req.params.token, { startsAt: b(req).startsAt });
    if (wantsJson(req)) return res.json({ success: true, booking: r.booking, manageUrl: r.manageUrl });
    res.type('html').send(shell('Moved', `<h1>Your booking is moved</h1><div class="card">${esc(fmt(r.booking.startsAt))}</div><p>Your new link: <a style="color:#ece7df" href="${esc(r.manageUrl)}">${esc(r.manageUrl)}</a></p>`));
  } catch (e) { if (wantsJson(req)) return res.status(e.status || 500).json({ success: false, code: e.code, error: e.message }); fail(res, e); }
});
router.get('/feed/:file', async (req, res) => {
  try {
    const m = String(req.params.file).match(/^([A-Za-z0-9_-]{16,64})\.ics$/);
    if (!m) throw new S.SchedulingError('Feed not found', 'not_found', 404);
    res.type('text/calendar; charset=utf-8').send(await S.feedIcs(req.db, m[1]));
  } catch (e) { res.status(e.status || 500).type('text/plain').send(e instanceof S.SchedulingError ? e.message : 'error'); }
});

export default router;
