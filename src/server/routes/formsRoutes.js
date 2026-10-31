/**
 * /api/forms — Corpo › Forms (services/forms.js). Every route takes `workspace` (query or body; absent = the person's
 * Personal workspace). A request made with an agent's credential is the agent: it works as its owner.
 *
 *   GET    /                                   the workspace's forms
 *   POST   /                                   {title, description?, fields[], confirmation?, autoActions[]}
 *   GET    /:id                                · PATCH /:id {title?, fields?, status?, …}
 *   DELETE /:id                                (a person; soft, undo with POST /:id/restore)
 *   POST   /:id/links {kind: signin|public, label?, expiresInDays?}   public: a person only
 *   POST   /:id/links/:linkId/revoke
 *   GET    /:id/responses?spam=1               · GET /:id/responses.csv · DELETE /:id/responses (a person; erases them all)
 *   GET    /:id/responses/:rid                 · DELETE /:id/responses/:rid (a person; erases the answers)
 *   POST   /:id/responses/:rid/actions {action: contact|task|ticket, projectId?}
 *
 * The respondent's side, NO account needed for a public link (a sign-in link needs a bearer token):
 *   GET    /public/:token                      the fill page (server-rendered, works without JavaScript)
 *   POST   /public/:token                      the page's own submit (urlencoded) → thanks, or the page with errors
 *   GET    /public/:token/form                 the form as JSON
 *   POST   /public/:token/responses {answers}  submit as JSON
 */
import express from 'express';
import authMiddleware, { optionalAuthMiddleware } from '../middleware/auth.js';
import { requireActivated } from '../services/accountActivation.js';
import { clientIp } from '../utils/clientIp.js';
import * as F from '../services/forms.js';

const router = express.Router();
const ws = (req) => (req.body && req.body.workspace) || req.query.workspace || null;
const actorOf = async (req) => {
  const isAgent = (await req.db.query('SELECT 1 FROM agent_identities WHERE user_id = $1', [req.user.id])).rows.length > 0;
  return { id: req.user.id, kind: isAgent ? 'agent' : 'human' };
};
const fail = (res, e) => {
  if (e instanceof F.FormsError) return res.status(e.status).json({ success: false, code: e.code, error: e.message, ...(e.errors ? { errors: e.errors } : {}) });
  if (e && (e.name === 'TaskError' || e.name === 'SupportError')) return res.status(e.status || e.statusCode || 400).json({ success: false, code: e.code, error: e.message });
  console.error('Forms failed:', e); return res.status(500).json({ success: false, error: 'Internal server error' });
};
const run = (fn) => async (req, res) => { try { res.json({ success: true, ...(await fn(req, await actorOf(req))) }); } catch (e) { fail(res, e); } };
const A = [authMiddleware, requireActivated];
const b = (req) => req.body || {};

// ── the respondent's side (before /:id so "public" is never read as a form id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
function page(res, status, title, inner) {
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP, 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>:root{--bg:#060606;--card:#101010;--line:rgba(255,255,255,.06);--t:#ece7df;--b:#948d83;--d:#69635b}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--b);font:15px/1.55 Inter,system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:48px 16px}h1{color:var(--t);font-size:clamp(24px,4vw,32px);margin:0 0 8px;font-weight:600}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-top:20px}
label{display:block;color:var(--t);margin:16px 0 6px}small{color:var(--d)}input[type=text],input[type=email],input[type=tel],input[type=url],input[type=number],input[type=date],select,textarea{width:100%;background:#151515;color:var(--t);border:1px solid var(--line);border-radius:8px;padding:10px;font:inherit;outline:none}
input:focus,select:focus,textarea:focus{border-color:rgba(255,255,255,.22)}textarea{min-height:110px}.err{color:#e08b7a;font-size:13px}.opt{display:flex;gap:8px;align-items:center;color:var(--b);margin:4px 0}
button{margin-top:24px;background:var(--t);color:#060606;border:0;border-radius:8px;padding:11px 18px;font:inherit;font-weight:600;cursor:pointer}.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}</style></head><body><main>${inner}</main></body></html>`);
}
function fieldHtml(f, v, err) {
  const name = `a_${f.id}`, req = f.required ? ' required' : '', lbl = `<label for="${esc(name)}">${esc(f.label)}${f.required ? ' *' : ''}</label>${f.help ? `<small>${esc(f.help)}</small>` : ''}`;
  const e = err ? `<div class="err" data-err="${esc(f.id)}">${esc(err)}</div>` : '';
  const val = v == null ? '' : v;
  switch (f.type) {
    case 'textarea': return `${lbl}<textarea id="${esc(name)}" name="${esc(name)}" maxlength="${f.maxLength}"${req}>${esc(val)}</textarea>${e}`;
    case 'select': return `${lbl}<select id="${esc(name)}" name="${esc(name)}"${req}><option value=""></option>${f.options.map((o) => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>${e}`;
    case 'multiselect': return `${lbl}${f.options.map((o) => `<div class="opt"><input type="checkbox" name="${esc(name)}" value="${esc(o)}"${[].concat(val).includes(o) ? ' checked' : ''}> ${esc(o)}</div>`).join('')}${e}`;
    case 'checkbox': return `<div class="opt"><input type="checkbox" id="${esc(name)}" name="${esc(name)}" value="1"${val ? ' checked' : ''}${req}> <label for="${esc(name)}" style="margin:0">${esc(f.label)}</label></div>${e}`;
    default: {
      const t = { text: 'text', email: 'email', phone: 'tel', url: 'url', number: 'number', date: 'date' }[f.type] || 'text';
      return `${lbl}<input type="${t}" id="${esc(name)}" name="${esc(name)}" value="${esc(val)}"${f.maxLength ? ` maxlength="${f.maxLength}"` : ''}${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}${req}>${e}`;
    }
  }
}
const formPage = (res, token, form, values = {}, errors = {}, status = 200) => page(res, status, form.title, `<h1>${esc(form.title)}</h1>${form.description ? `<p>${esc(form.description)}</p>` : ''}
<form class="card" method="post" action="/api/forms/public/${esc(token)}" data-form-page>${Object.keys(errors).length ? '<div class="err" data-errs>Some answers need fixing.</div>' : ''}
<div class="hp" aria-hidden="true"><label>Leave empty<input type="text" name="${F.HONEYPOT}" tabindex="-1" autocomplete="off"></label></div>
${form.fields.map((f) => fieldHtml(f, values[f.id], errors[f.id])).join('')}<button type="submit">Send</button></form>`);
const message = (res, status, text) => page(res, status, 'XENO Forms', `<div class="card" data-form-msg><p>${esc(text)}</p></div>`);
const answersFromBody = (body = {}) => { const a = {}; for (const [k, v] of Object.entries(body)) { if (k === F.HONEYPOT) a[k] = v; else if (k.startsWith('a_')) a[k.slice(2)] = v; } return a; };

router.get('/public/:token', optionalAuthMiddleware, async (req, res) => {
  try { formPage(res, req.params.token, (await F.publicForm(req.db, req.params.token, null)).form); }
  catch (e) { if (e instanceof F.FormsError) return message(res, e.status, e.code === 'sign_in_required' ? 'This form is for XENO accounts. Open the link you were given while signed in to XENO.' : e.message); message(res, 500, 'This form is unavailable right now.'); }
});
router.post('/public/:token', express.urlencoded({ extended: false, limit: '100kb' }), async (req, res) => {
  const answers = answersFromBody(req.body);
  try { const r = await F.submit(req.db, req.params.token, { answers, user: null, source: clientIp(req) || '' }); message(res, 200, r.confirmation); }
  catch (e) {
    if (e instanceof F.FormsError && e.code === 'invalid_answers') { const f = (await F.publicForm(req.db, req.params.token, null)).form; return formPage(res, req.params.token, f, answers, e.errors, 422); }
    if (e instanceof F.FormsError) return message(res, e.status, e.message);
    console.error('Forms submit failed:', e); message(res, 500, 'This form is unavailable right now.');
  }
});
router.get('/public/:token/form', optionalAuthMiddleware, async (req, res) => { try { res.json({ success: true, ...(await F.publicForm(req.db, req.params.token, req.user || null)) }); } catch (e) { fail(res, e); } });
router.post('/public/:token/responses', optionalAuthMiddleware, async (req, res) => {
  try { res.json({ success: true, ...(await F.submit(req.db, req.params.token, { answers: b(req).answers, user: req.user || null, source: clientIp(req) || '' })) }); } catch (e) { fail(res, e); }
});

// ── the workspace's side
router.get('/', ...A, run((req, a) => F.listForms(req.db, a, { workspace: ws(req) })));
router.post('/', ...A, run((req, a) => F.createForm(req.db, a, { workspace: ws(req), title: b(req).title, description: b(req).description, fields: b(req).fields || [], confirmation: b(req).confirmation, autoActions: b(req).autoActions || [] })));
router.get('/:id', ...A, run((req, a) => F.getForm(req.db, a, { workspace: ws(req), id: req.params.id })));
router.patch('/:id', ...A, run((req, a) => F.updateForm(req.db, a, { workspace: ws(req), id: req.params.id, title: b(req).title, description: b(req).description, fields: b(req).fields, closesAt: b(req).closesAt, maxResponses: b(req).maxResponses, confirmation: b(req).confirmation, autoActions: b(req).autoActions, status: b(req).status })));
router.delete('/:id', ...A, run((req, a) => F.deleteForm(req.db, a, { workspace: ws(req), id: req.params.id })));
router.post('/:id/restore', ...A, run((req, a) => F.restoreForm(req.db, a, { workspace: ws(req), id: req.params.id })));
router.post('/:id/links', ...A, run((req, a) => F.createLink(req.db, a, { workspace: ws(req), id: req.params.id, kind: b(req).kind || 'signin', label: b(req).label, expiresInDays: b(req).expiresInDays })));
router.post('/:id/links/:linkId/revoke', ...A, run((req, a) => F.revokeLink(req.db, a, { workspace: ws(req), id: req.params.id, linkId: req.params.linkId })));
router.get('/:id/responses.csv', ...A, async (req, res) => {
  try { const r = await F.exportCsv(req.db, await actorOf(req), { workspace: ws(req), id: req.params.id }); res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${r.filename}"` }).send(r.csv); }
  catch (e) { fail(res, e); }
});
router.get('/:id/responses', ...A, run((req, a) => F.listResponses(req.db, a, { workspace: ws(req), id: req.params.id, spam: req.query.spam === '1' })));
router.delete('/:id/responses', ...A, run((req, a) => F.deleteAllResponses(req.db, a, { workspace: ws(req), id: req.params.id })));
router.get('/:id/responses/:rid', ...A, run((req, a) => F.getResponse(req.db, a, { workspace: ws(req), id: req.params.id, responseId: req.params.rid })));
router.delete('/:id/responses/:rid', ...A, run((req, a) => F.deleteResponse(req.db, a, { workspace: ws(req), id: req.params.id, responseId: req.params.rid })));
router.post('/:id/responses/:rid/actions', ...A, run((req, a) => F.runAction(req.db, a, { workspace: ws(req), id: req.params.id, responseId: req.params.rid, action: b(req).action, projectId: b(req).projectId })));

export default router;
