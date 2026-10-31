/**
 * XENO Forms (Corpo › Forms) — forms and surveys a WORKSPACE owns (XENO-WORKFORCE-01 §8.11). One service: the screen
 * (routes/formsRoutes.js, prototypes/xeno-workspace/platform-forms.js), the public fill page and agents
 * (formsMcp.js) all call these functions.
 *
 * WHO
 *   - any member (viewer) lists the workspace's forms;
 *   - an editor builds forms, opens/closes them, makes links, reads responses and acts on them;
 *   - a person alone deletes a form or a response (an agent is refused, here and on the screen);
 *   - an agent works as its owner and never above them.
 *
 * LINKS. A form is answered through a link. A SIGN-IN link opens only for someone signed in to XENO; a PUBLIC link
 * opens for anyone. Agents create sign-in links only (owner decision 2026-10-20, the Storage rule): a public link is a
 * person's act, refused by this service AND by a CHECK on form_links. Only the token's SHA-256 is stored and the
 * token is shown once. A link is revocable and may expire.
 *
 * ANSWERS are validated on the server against the form's fields, whatever the page sent. Abuse controls: a hidden
 * honeypot field (a filled one is stored as spam and answered as if accepted, so a bot learns nothing), per-source
 * and per-form hourly limits, size caps, and a closed form takes nothing.
 *
 * ACTIONS on a response (by an editor, or automatically on submit when the form says so):
 *   contact → a Customers contact (services/customers.js; a known email is matched, never duplicated) + a timeline note
 *   task    → a XENO Tasks task (xenoTasks.createTask) — there is no second tracker
 *   ticket  → a XENO support request (supportTickets.createTicket), raised by the person who runs it
 * What each action produced is recorded on the response, so it is never run twice.
 */
import crypto from 'node:crypto';
import { check } from '../utils/authzReBAC.js';
import { ensurePersonalWorkspace } from './personalWorkspace.js';
import * as xenoTasks from './xenoTasks.js';
import * as support from './supportTickets.js';
import * as customers from './customers.js';
import * as inbox from './inbox.js';
import { publicSiteOrigin } from '../config/hosts.js';

export class FormsError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'FormsError'; this.code = code; this.status = status; }
}

export const FIELD_TYPES = ['text', 'textarea', 'email', 'phone', 'url', 'number', 'date', 'select', 'multiselect', 'checkbox'];
export const STATUSES = ['draft', 'open', 'closed'];
export const ACTIONS = ['contact', 'task', 'ticket'];
/** Per-hour limits. A burst is refused, never queued. */
export const LIMITS = { perSource: 10, perForm: 500, formsPerHour: 60, linksPerHour: 60 };
export const HONEYPOT = '_hp';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD_ID = /^[a-z][a-z0-9_]{0,39}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/;
const PHONE = /^\+?[0-9 ().-]{4,30}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const isToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(t);

// ─────────────────────────────────────────── who, where

async function personOf(db, actor) {
  if (!actor || !actor.id) throw new FormsError('Sign in first', 'not_signed_in', 401);
  if (actor.kind === 'service') throw new FormsError('A service account has no forms', 'not_allowed', 403);
  if (actor.kind !== 'agent') return { userId: String(actor.id), agentId: null };
  const r = (await db.query('SELECT owner_user_id FROM agent_identities WHERE user_id = $1', [actor.id])).rows[0];
  if (!r || !r.owner_user_id) throw new FormsError('This agent has no owner', 'no_owner', 403);
  return { userId: String(r.owner_user_id), agentId: String(actor.id) };
}

/** Resolve the workspace (default: the person's Personal one) and require `need` (viewer | editor) in it. */
export async function scopeFor(db, actor, { workspace, need = 'viewer', person = false } = {}) {
  const who = await personOf(db, actor);
  if (person && who.agentId) throw new FormsError('Only a person can do that', 'person_required', 403);
  let ws = workspace ? String(workspace) : null;
  if (ws && !UUID.test(ws)) throw new FormsError('Invalid workspace id', 'invalid_workspace');
  if (!ws) ws = String((await ensurePersonalWorkspace(db, who.userId)).id);
  const ok = await check(db, { object: `workspace:${ws}`, relation: need, subject: `user:${who.userId}` });
  if (!ok.allowed) {
    const member = need === 'viewer' ? false : (await check(db, { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${who.userId}` })).allowed;
    if (!member) throw new FormsError('You are not a member of that workspace', 'not_a_member', 403);
    throw new FormsError('Only editors and admins can change forms', 'editor_required', 403);
  }
  return { ...who, workspaceId: ws };
}

// ─────────────────────────────────────────── fields

const str = (v, max, field, required = false) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw new FormsError(`${field} is required`, `${field}_required`);
  if (s.length > max) throw new FormsError(`${field} is longer than ${max} characters`, `${field}_too_long`);
  return s;
};

/** A form's fields, normalized. Anything unknown is refused, never kept. */
export function cleanFields(fields) {
  if (!Array.isArray(fields)) throw new FormsError('fields must be a list', 'invalid_fields');
  if (fields.length > 50) throw new FormsError('At most 50 fields on a form', 'invalid_fields');
  const seen = new Set();
  return fields.map((f, i) => {
    if (!f || typeof f !== 'object') throw new FormsError(`Field ${i + 1} is not a field`, 'invalid_fields');
    const type = String(f.type || '');
    if (!FIELD_TYPES.includes(type)) throw new FormsError(`Field ${i + 1} has an unknown type`, 'invalid_field_type');
    const id = String(f.id || `f${i + 1}`);
    if (!FIELD_ID.test(id) || id === HONEYPOT) throw new FormsError(`Field ${i + 1} has an invalid id`, 'invalid_field_id');
    if (seen.has(id)) throw new FormsError(`Two fields share the id "${id}"`, 'duplicate_field_id');
    seen.add(id);
    const out = { id, type, label: str(f.label, 200, 'label', true), required: f.required === true, help: str(f.help, 500, 'help') };
    if (type === 'select' || type === 'multiselect') {
      const opts = Array.isArray(f.options) ? f.options.map((o) => str(o, 200, 'option')).filter(Boolean) : [];
      if (!opts.length || opts.length > 100 || new Set(opts).size !== opts.length) throw new FormsError(`"${out.label}" needs 1–100 distinct options`, 'invalid_options');
      out.options = opts;
    }
    if (type === 'text' || type === 'textarea') out.maxLength = Math.min(Math.max(1, Math.trunc(Number(f.maxLength) || (type === 'text' ? 500 : 5000))), type === 'text' ? 2000 : 20000);
    if (type === 'number') {
      if (f.min != null && f.min !== '' && Number.isFinite(Number(f.min))) out.min = Number(f.min);
      if (f.max != null && f.max !== '' && Number.isFinite(Number(f.max))) out.max = Number(f.max);
      if (out.min != null && out.max != null && out.min > out.max) throw new FormsError(`"${out.label}": min is above max`, 'invalid_range');
    }
    return out;
  });
}

/** Validate answers against fields. Returns { answers, errors } — errors keyed by field id. */
export function validateAnswers(fields, raw = {}) {
  const answers = {}, errors = {};
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const f of fields) {
    let v = src[f.id];
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length) || (f.type === 'checkbox' && (v === false || v === 'false'));
    if (empty) { if (f.required) errors[f.id] = 'Required'; continue; }
    switch (f.type) {
      case 'text': case 'textarea': v = String(v).trim(); if (v.length > f.maxLength) errors[f.id] = `At most ${f.maxLength} characters`; break;
      case 'email': v = String(v).trim().toLowerCase(); if (!EMAIL.test(v)) errors[f.id] = 'Not an email address'; break;
      case 'phone': v = String(v).trim(); if (!PHONE.test(v)) errors[f.id] = 'Not a phone number'; break;
      case 'url': { v = String(v).trim(); let u = null; try { u = new URL(v); } catch {} if (!u || !['http:', 'https:'].includes(u.protocol) || v.length > 2000) errors[f.id] = 'Not a web address'; break; }
      case 'number': { const n = Number(v); if (!Number.isFinite(n)) errors[f.id] = 'Not a number'; else if (f.min != null && n < f.min) errors[f.id] = `At least ${f.min}`; else if (f.max != null && n > f.max) errors[f.id] = `At most ${f.max}`; v = n; break; }
      case 'date': v = String(v).trim(); if (!DATE.test(v) || Number.isNaN(new Date(v + 'T00:00:00Z').getTime())) errors[f.id] = 'Not a date'; break;
      case 'select': v = String(v); if (!f.options.includes(v)) errors[f.id] = 'Not one of the choices'; break;
      case 'multiselect': { const a = [...new Set([].concat(v).map(String))]; if (a.some((x) => !f.options.includes(x))) errors[f.id] = 'Not one of the choices'; v = a; break; }
      case 'checkbox': v = v === true || v === 'true' || v === 'on' || v === '1'; break;
      default: errors[f.id] = 'Unknown field';
    }
    if (!errors[f.id]) answers[f.id] = v;
  }
  return { answers, errors };
}

const cleanActions = (a) => {
  const list = [...new Set([].concat(a || []).map(String))];
  if (list.some((x) => !ACTIONS.includes(x))) throw new FormsError('Unknown action', 'invalid_action');
  return list;
};

// ─────────────────────────────────────────── forms

const viewForm = (r, counts = {}) => ({
  id: r.id, workspaceId: r.workspace_id, title: r.title, description: r.description, fields: r.fields, status: r.status,
  confirmation: r.confirmation, autoActions: r.auto_actions, closesAt: r.closes_at, maxResponses: r.max_responses, responses: Number(counts.responses || 0), createdAt: r.created_at, updatedAt: r.updated_at,
  url: `/workspace/corpo/spaces/forms/${r.id}`,
});

async function within(db, sql, params, limit, what) {
  const n = Number((await db.query(sql, params)).rows[0].n);
  if (n >= limit) throw new FormsError(`Too many ${what} in the last hour. Try again later.`, 'rate_limited', 429);
}

async function loadForm(db, s, id, { includeDeleted = false } = {}) {
  if (!UUID.test(String(id || ''))) throw new FormsError('Form not found', 'form_not_found', 404);
  const r = (await db.query(`SELECT * FROM forms WHERE id = $1 AND workspace_id = $2 ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`, [id, s.workspaceId])).rows[0];
  if (!r) throw new FormsError('Form not found', 'form_not_found', 404);
  return r;
}

export async function listForms(db, actor, { workspace } = {}) {
  const s = await scopeFor(db, actor, { workspace });
  const rows = (await db.query(`SELECT f.*, (SELECT count(*) FROM form_responses r WHERE r.form_id = f.id AND r.deleted_at IS NULL AND NOT r.spam) AS responses
     FROM forms f WHERE f.workspace_id = $1 AND f.deleted_at IS NULL ORDER BY f.updated_at DESC LIMIT 200`, [s.workspaceId])).rows;
  return { workspaceId: s.workspaceId, forms: rows.map((r) => viewForm(r, r)) };
}

export async function getForm(db, actor, { workspace, id } = {}) {
  const s = await scopeFor(db, actor, { workspace });
  const r = await loadForm(db, s, id);
  const n = (await db.query('SELECT count(*) AS responses FROM form_responses WHERE form_id = $1 AND deleted_at IS NULL AND NOT spam', [r.id])).rows[0];
  const links = (await db.query('SELECT * FROM form_links WHERE form_id = $1 ORDER BY created_at DESC', [r.id])).rows;
  return { form: { ...viewForm(r, n), links: links.map(viewLink) } };
}

export async function createForm(db, actor, { workspace, title, description, fields = [], confirmation, autoActions = [] } = {}) {
  const s = await scopeFor(db, actor, { workspace, need: 'editor' });
  await within(db, 'SELECT count(*) AS n FROM forms WHERE created_by_user_id = $1 AND created_at > now() - interval \'1 hour\'', [s.userId], LIMITS.formsPerHour, 'new forms');
  const r = (await db.query(`INSERT INTO forms (workspace_id, title, description, fields, confirmation, auto_actions, created_by_user_id)
     VALUES ($1,$2,$3,$4::jsonb,COALESCE(NULLIF($5,''),'Thank you — your response was received.'),$6::jsonb,$7) RETURNING *`,
  [s.workspaceId, str(title, 200, 'title', true), str(description, 4000, 'description'), JSON.stringify(cleanFields(fields)), str(confirmation, 1000, 'confirmation'), JSON.stringify(cleanActions(autoActions)), s.userId])).rows[0];
  return { form: viewForm(r) };
}

const closingDate = (v) => { if (v == null || v === '') return null; const d = new Date(v); if (Number.isNaN(d.getTime())) throw new FormsError('That closing date isn’t a date', 'invalid_closes_at'); return d; };
const responseLimit = (v) => { if (v == null || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new FormsError('The response limit must be a whole number above zero', 'invalid_max_responses'); return n; };

export async function updateForm(db, actor, { workspace, id, title, description, fields, confirmation, autoActions, status, closesAt, maxResponses } = {}) {
  const s = await scopeFor(db, actor, { workspace, need: 'editor' });
  const cur = await loadForm(db, s, id);
  if (status != null && !STATUSES.includes(status)) throw new FormsError('Unknown status', 'invalid_status');
  const next = {
    title: title == null ? cur.title : str(title, 200, 'title', true),
    description: description == null ? cur.description : str(description, 4000, 'description'),
    fields: fields == null ? cur.fields : cleanFields(fields),
    confirmation: confirmation == null ? cur.confirmation : (str(confirmation, 1000, 'confirmation') || cur.confirmation),
    autoActions: autoActions == null ? cur.auto_actions : cleanActions(autoActions),
    status: status == null ? cur.status : status,
    closesAt: closesAt === undefined ? cur.closes_at : closingDate(closesAt),
    maxResponses: maxResponses === undefined ? cur.max_responses : responseLimit(maxResponses),
  };
  if (next.status === 'open' && !next.fields.length) throw new FormsError('Add at least one field before opening the form', 'no_fields');
  const r = (await db.query(`UPDATE forms SET title=$3, description=$4, fields=$5::jsonb, confirmation=$6, auto_actions=$7::jsonb, status=$8, closes_at=$9, max_responses=$10, updated_at=now()
     WHERE id = $1 AND workspace_id = $2 RETURNING *`, [cur.id, s.workspaceId, next.title, next.description, JSON.stringify(next.fields), next.confirmation, JSON.stringify(next.autoActions), next.status, next.closesAt, next.maxResponses])).rows[0];
  return { form: viewForm(r) };
}

/** Delete a form (soft; restore undoes it). A person's act. */
export async function deleteForm(db, actor, { workspace, id } = {}) {
  const s = await scopeFor(db, actor, { workspace, need: 'editor', person: true });
  const cur = await loadForm(db, s, id);
  await db.query('UPDATE forms SET deleted_at = now(), status = \'closed\' WHERE id = $1', [cur.id]);
  return { deleted: true, id: cur.id, undo: 'restore' };
}

export async function restoreForm(db, actor, { workspace, id } = {}) {
  const s = await scopeFor(db, actor, { workspace, need: 'editor', person: true });
  const cur = await loadForm(db, s, id, { includeDeleted: true });
  const r = (await db.query('UPDATE forms SET deleted_at = NULL, updated_at = now() WHERE id = $1 RETURNING *', [cur.id])).rows[0];
  return { form: viewForm(r) };
}

// ─────────────────────────────────────────── links

function viewLink(l) {
  return { id: l.id, kind: l.kind, label: l.label, createdByKind: l.created_by_kind, expiresAt: l.expires_at, revokedAt: l.revoked_at, createdAt: l.created_at,
    live: !l.revoked_at && (!l.expires_at || new Date(l.expires_at) > new Date()) };
}
export const fillUrl = (kind, token) => (kind === 'public' ? `${publicSiteOrigin()}/api/forms/public/${token}` : `${publicSiteOrigin()}/workspace/corpo/spaces/forms/fill/${token}`);

/** Make a link to a form. `kind` signin (default) or public — public only by a person. The token is shown ONCE. */
export async function createLink(db, actor, { workspace, id, kind = 'signin', label, expiresInDays } = {}) {
  if (!['signin', 'public'].includes(kind)) throw new FormsError('A link is signin or public', 'invalid_link_kind');
  const s = await scopeFor(db, actor, { workspace, need: 'editor', person: kind === 'public' });
  const form = await loadForm(db, s, id);
  await within(db, 'SELECT count(*) AS n FROM form_links WHERE created_by_user_id = $1 AND created_at > now() - interval \'1 hour\'', [actor.id], LIMITS.linksPerHour, 'links');
  let expires = null;
  if (expiresInDays != null && expiresInDays !== '') {
    const d = Math.trunc(Number(expiresInDays));
    if (!Number.isFinite(d) || d < 1 || d > 365) throw new FormsError('A link expires in 1–365 days', 'invalid_expiry');
    expires = new Date(Date.now() + d * 86400000);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const l = (await db.query(`INSERT INTO form_links (form_id, kind, token_sha256, label, created_by_user_id, created_by_kind, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [form.id, kind, sha(token), str(label, 120, 'label') || null, actor.id, s.agentId ? 'agent' : 'human', expires])).rows[0];
  return { link: viewLink(l), url: fillUrl(kind, token), token };
}

export async function revokeLink(db, actor, { workspace, id, linkId } = {}) {
  const s = await scopeFor(db, actor, { workspace, need: 'editor' });
  const form = await loadForm(db, s, id);
  if (!UUID.test(String(linkId || ''))) throw new FormsError('Link not found', 'link_not_found', 404);
  const l = (await db.query('UPDATE form_links SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND form_id = $2 RETURNING *', [linkId, form.id])).rows[0];
  if (!l) throw new FormsError('Link not found', 'link_not_found', 404);
  return { link: viewLink(l) };
}

/** The live link + form a token opens, or a FormsError. `user` is the signed-in person (or null). */
const responseCount = async (db, formId) => Number((await db.query('SELECT count(*) AS n FROM form_responses WHERE form_id = $1 AND deleted_at IS NULL AND spam = false', [formId])).rows[0].n);

async function openToken(db, token, user) {
  const none = () => new FormsError('This form link does not work. It may have been revoked or expired.', 'link_not_found', 404);
  if (!isToken(token)) throw none();
  const row = (await db.query(`SELECT l.*, f.id AS fid, f.workspace_id, f.title, f.description, f.fields, f.status, f.confirmation, f.auto_actions, f.closes_at, f.max_responses, f.created_by_user_id AS form_creator, f.deleted_at AS f_deleted
     FROM form_links l JOIN forms f ON f.id = l.form_id WHERE l.token_sha256 = $1`, [sha(token)])).rows[0];
  if (!row || row.revoked_at || row.f_deleted || (row.expires_at && new Date(row.expires_at) <= new Date())) throw none();
  if (row.kind === 'signin' && !(user && user.id)) throw new FormsError('Sign in to XENO to answer this form', 'sign_in_required', 401);
  if (row.status !== 'open') throw new FormsError(row.status === 'closed' ? 'This form is closed.' : 'This form is not open yet.', 'form_not_open', 409);
  if (row.closes_at && new Date(row.closes_at) <= new Date()) throw new FormsError('This form is closed.', 'form_not_open', 409);
  if (row.max_responses && await responseCount(db, row.fid) >= row.max_responses) throw new FormsError('This form has all the responses it needs.', 'form_full', 409);
  return row;
}

/** What a respondent sees: the form's title, description and fields. Nothing about the workspace. */
export async function publicForm(db, token, user = null) {
  const r = await openToken(db, token, user);
  return { form: { title: r.title, description: r.description, fields: r.fields, kind: r.kind, honeypot: HONEYPOT } };
}

/** Answer a form. `source` is the client address (hashed per form, never stored). */
export async function submit(db, token, { answers, user = null, source = '' } = {}) {
  const r = await openToken(db, token, user);
  const raw = answers && typeof answers === 'object' ? answers : {};
  if (JSON.stringify(raw).length > 100_000) throw new FormsError('That response is too large', 'too_large', 413);
  const src = sha(`${r.fid}:${user && user.id ? 'u:' + user.id : 'ip:' + (source || 'unknown')}`);
  await within(db, 'SELECT count(*) AS n FROM form_responses WHERE source_hash = $1 AND created_at > now() - interval \'1 hour\'', [src], LIMITS.perSource, 'responses from you');
  await within(db, 'SELECT count(*) AS n FROM form_responses WHERE form_id = $1 AND created_at > now() - interval \'1 hour\'', [r.fid], LIMITS.perForm, 'responses to this form');
  const spam = raw[HONEYPOT] != null && String(raw[HONEYPOT]) !== '';
  const { answers: clean, errors } = validateAnswers(r.fields, raw);
  if (!spam && Object.keys(errors).length) { const e = new FormsError('Some answers need fixing', 'invalid_answers', 422); e.errors = errors; throw e; }
  const emailField = r.fields.find((x) => x.type === 'email' && clean[x.id]);
  const insert = (c) => c.query(`INSERT INTO form_responses (form_id, workspace_id, link_id, answers, fields, email, submitter_user_id, source_hash, spam) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9) RETURNING *`,
    [r.fid, r.workspace_id, r.id, JSON.stringify(spam ? {} : clean), JSON.stringify(spam ? [] : r.fields), !spam && emailField ? clean[emailField.id] : null, user && user.id ? user.id : null, src, spam]);
  let row;
  if (r.max_responses && !spam && typeof db.connect === 'function') {   // one at a time, or a limit could be overrun
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT 1 FROM forms WHERE id = $1 FOR UPDATE', [r.fid]);
      if (await responseCount(c, r.fid) >= r.max_responses) throw new FormsError('This form has all the responses it needs.', 'form_full', 409);
      row = (await insert(c)).rows[0];
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  } else row = (await insert(db)).rows[0];
  if (!spam) await inbox.tell(db, { userId: r.form_creator, source: 'forms', kind: 'form_response', ref: `/workspace/corpo/spaces/forms/${r.fid}/responses`, title: `New response · ${r.title}`, area: 'corpo' });
  // automatic actions run as the form's creator, the person who set them up; a failure never loses the response
  if (!spam && (r.auto_actions || []).length) {
    const creator = (await db.query('SELECT created_by_user_id FROM forms WHERE id = $1', [r.fid])).rows[0];
    for (const a of r.auto_actions) {
      try { await runAction(db, { id: creator.created_by_user_id, kind: 'human' }, { workspace: r.workspace_id, id: r.fid, responseId: row.id, action: a }); }
      catch (e) { console.warn('[forms] auto action', a, 'failed:', e && e.message); }
    }
  }
  return { received: true, confirmation: r.confirmation };
}

// ─────────────────────────────────────────── responses

const viewResponse = (r) => ({ id: r.id, formId: r.form_id, answers: r.answers, fields: r.fields, email: r.email, spam: r.spam, signedIn: !!r.submitter_user_id, actions: r.actions, createdAt: r.created_at,
  url: `/workspace/corpo/spaces/forms/${r.form_id}/responses/${r.id}` });

export async function listResponses(db, actor, { workspace, id, spam = false, limit = 100 } = {}) {
  const s = await scopeFor(db, actor, { workspace, need: 'editor' });
  const form = await loadForm(db, s, id);
  const n = Math.min(Math.max(1, Math.trunc(Number(limit) || 100)), 500);
  const rows = (await db.query('SELECT * FROM form_responses WHERE form_id = $1 AND deleted_at IS NULL AND spam = $2 ORDER BY created_at DESC LIMIT $3', [form.id, !!spam, n])).rows;
  return { form: { id: form.id, title: form.title, fields: form.fields }, responses: rows.map(viewResponse) };
}

async function loadResponse(db, s, formId, responseId) {
  if (!UUID.test(String(responseId || ''))) throw new FormsError('Response not found', 'response_not_found', 404);
  const r = (await db.query('SELECT * FROM form_responses WHERE id = $1 AND form_id = $2 AND workspace_id = $3 AND deleted_at IS NULL', [responseId, formId, s.workspaceId])).rows[0];
  if (!r) throw new FormsError('Response not found', 'response_not_found', 404);
  return r;
}

export async function getResponse(db, actor, { workspace, id, responseId } = {}) {
  const s = await scopeFor(db, actor, { workspace, need: 'editor' });
  const form = await loadForm(db, s, id);
  return { form: { id: form.id, title: form.title, fields: form.fields }, response: viewResponse(await loadResponse(db, s, form.id, responseId)) };
}

/** Delete a response (personal data, e.g. on a GDPR request). A person's act. */
export async function deleteResponse(db, actor, { workspace, id, responseId } = {}) {
  const s = await scopeFor(db, actor, { workspace, need: 'editor', person: true });
  const form = await loadForm(db, s, id);
  const r = await loadResponse(db, s, form.id, responseId);
  // erased, not hidden: the answers are personal data
  await db.query('UPDATE form_responses SET deleted_at = now(), answers = \'{}\'::jsonb, fields = \'[]\'::jsonb, email = NULL, source_hash = NULL WHERE id = $1', [r.id]);
  return { deleted: true, id: r.id };
}

/** Erase every answer to a form. A person's act, and it can't be undone. */
export async function deleteAllResponses(db, actor, { workspace, id } = {}) {
  const s = await scopeFor(db, actor, { workspace, need: 'editor', person: true });
  const form = await loadForm(db, s, id);
  const r = await db.query(`UPDATE form_responses SET deleted_at = now(), answers = '{}'::jsonb, fields = '[]'::jsonb, email = NULL, source_hash = NULL WHERE form_id = $1 AND deleted_at IS NULL`, [form.id]);
  return { deleted: r.rowCount };
}

/** Plain text of a response, for a task or ticket body. */
function summary(form, answers) {
  return form.fields.filter((f) => answers[f.id] != null).map((f) => `${f.label}: ${Array.isArray(answers[f.id]) ? answers[f.id].join(', ') : answers[f.id]}`).join('\n');
}
const firstOf = (form, answers, type) => { const f = form.fields.find((x) => x.type === type && answers[x.id]); return f ? answers[f.id] : null; };
const byLabel = (form, answers, re) => { const f = form.fields.find((x) => re.test(x.label) && answers[x.id]); return f ? String(answers[f.id]) : null; };

/** Act on a response: make a contact, a task or a support request from it. Recorded; never run twice. */
export async function runAction(db, actor, { workspace, id, responseId, action, projectId } = {}) {
  if (!ACTIONS.includes(action)) throw new FormsError('Unknown action', 'invalid_action');
  const s = await scopeFor(db, actor, { workspace, need: 'editor' });
  const form = await loadForm(db, s, id);
  const r = await loadResponse(db, s, form.id, responseId);
  if (r.spam) throw new FormsError('That response was marked as spam', 'response_is_spam', 409);
  if (r.actions && r.actions[action]) return { response: viewResponse(r), already: true };
  const a = r.answers || {};
  const title = `${form.title}: ${byLabel(form, a, /name/i) || firstOf(form, a, 'email') || 'new response'}`.slice(0, 200);
  const body = `Form response (${new Date(r.created_at).toISOString().slice(0, 10)})\n\n${summary(form, a)}\n\n${publicSiteOrigin()}${viewResponse(r).url}`;
  let result;
  if (action === 'task') {
    const t = await xenoTasks.createTask(db, actor, { title, body, projectId: projectId || null, source: undefined, sourceRef: `form-response:${r.id}` });
    result = { key: t.key || `T-${t.number}`, at: new Date().toISOString() };
  } else if (action === 'ticket') {
    const t = await support.createTicket(db, actor, { kind: 'other', title, body, workspaceId: s.workspaceId });
    result = { key: t.key, at: new Date().toISOString() };
  } else {
    // the same person answering twice is one contact: a known email is matched, never duplicated
    const mail = firstOf(form, a, 'email');
    let contactId = null, matched = false;
    try {
      const c = await customers.createContact(db, actor, { workspace: s.workspaceId, name: byLabel(form, a, /name/i) || mail || 'Form respondent', email: mail, phone: firstOf(form, a, 'phone'), source: 'form' });
      contactId = c.id;
    } catch (e) { if (e && e.code === 'duplicate_contact' && e.existingId) { contactId = e.existingId; matched = true; } else throw e; }
    await customers.addActivity(db, actor, contactId, { workspace: s.workspaceId, kind: 'note', body: body.slice(0, 20000) });
    result = { id: contactId, matched, at: new Date().toISOString() };
  }
  const u = (await db.query('UPDATE form_responses SET actions = actions || jsonb_build_object($2::text, $3::jsonb) WHERE id = $1 RETURNING *', [r.id, action, JSON.stringify(result)])).rows[0];
  return { response: viewResponse(u) };
}

/** Responses as CSV (an editor's export). Formula-leading cells are quoted against spreadsheet injection. */
export async function exportCsv(db, actor, { workspace, id } = {}) {
  const { form, responses } = await listResponses(db, actor, { workspace, id, limit: 500 });
  const cell = (v) => { let s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cols = form.fields.map((f) => [f.id, f.label]);
  for (const r of responses) for (const f of r.fields || []) if (!cols.some(([k]) => k === f.id)) cols.push([f.id, f.label]);
  const head = ['submitted', ...cols.map(([, l]) => l)];
  const lines = [head.map(cell).join(','), ...responses.map((r) => [new Date(r.createdAt).toISOString(), ...cols.map(([k]) => r.answers[k])].map(cell).join(','))];
  return { filename: `${form.title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'form'}-responses.csv`, csv: lines.join('\r\n') + '\r\n' };
}
