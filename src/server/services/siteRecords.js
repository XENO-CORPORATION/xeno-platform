/**
 * XENO Sites in the workspace: the record of a published site (xeno-sites decision 0001 §3). The site is built in an app
 * (XENO Workshop) and served by XENO Sites hosting; the app reports what it did here, as the signed-in person, and this is
 * what the workspace and its agents see. The routes (/api/sites) and agents (sitesMcp.js) call these functions.
 *
 * Rules that are easy to break:
 *   - Nothing here talks to the hosting. A record changes only through recordEvent, from the app that built the site.
 *   - Who did it is the token's person, never a field in the event; when is the server's clock.
 *   - Going live, rolling back and unpublishing are a PERSON's act (here, and by a database trigger).
 *   - An event is recorded once per (site, eventId): the app retries without making a second record.
 */
import * as customers from './customers.js';

export class SiteRecordError extends Error {
  constructor(message, code, status = 400) { super(message); this.name = 'SiteRecordError'; this.code = code; this.status = status; }
}
const bad = (message, code = 'invalid_event') => { throw new SiteRecordError(message, code, 400); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const APP = /^[a-z][a-z0-9-]{1,63}$/;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const URL_OK = /^https:\/\/[a-z0-9.-]+(\/.*)?$/;
const WARNING = /^[a-z0-9_]{1,64}$/;
export const SITE_EVENT_KINDS = Object.freeze(['claimed', 'version', 'live', 'unpublished', 'renamed', 'disabled', 'enabled', 'domain_added', 'domain_removed', 'deleted']);
const PERSON_ONLY = new Set(['live', 'unpublished']);
const EVENT_FIELDS = new Set(['eventId', 'kind', 'workspace', 'projectId', 'site', 'deploy', 'live', 'domain']);

async function scope(db, actor, workspace, need) {
  try { return await customers.workspaceFor(db, actor, workspace, need); }
  catch (e) { if (e instanceof customers.CustomersError) throw new SiteRecordError(e.message, e.code, e.status); throw e; }
}
const url = (v, what) => { if (typeof v !== 'string' || v.length > 300 || !URL_OK.test(v)) bad(`${what} must be an https address`); return v; };
const int = (v, max, what) => { if (!Number.isSafeInteger(v) || v < 0 || v > max) bad(`${what} is out of range`); return v; };

/** The one shape an event may take; anything else is refused whole, never trimmed. */
function parseEvent(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) bad('An event is an object');
  for (const k of Object.keys(e)) if (!EVENT_FIELDS.has(k)) bad(`Unknown field ${k}`, 'unknown_field');
  if (typeof e.eventId !== 'string' || !UUID.test(e.eventId)) bad('eventId must be a uuid');
  if (!SITE_EVENT_KINDS.includes(e.kind)) bad('Unknown event kind');
  if (typeof e.projectId !== 'string' || e.projectId.length < 1 || e.projectId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(e.projectId)) bad('projectId is required');
  const s = e.site;
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !ID.test(s.id) || typeof s.name !== 'string' || !SLUG.test(s.name)) bad('site {id, name, url} is required');
  const out = { eventId: e.eventId.toLowerCase(), kind: e.kind, workspace: e.workspace ?? null, projectId: e.projectId, site: { id: s.id, name: s.name, url: url(s.url, 'site.url') } };
  if (e.kind === 'version') {
    const d = e.deploy;
    if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !ID.test(d.id)) bad('A version needs deploy {id, url, files, bytes}');
    const checks = d.checks ?? {};
    if (typeof checks !== 'object' || Array.isArray(checks) || (checks.ok !== undefined && typeof checks.ok !== 'boolean')
      || (checks.warnings !== undefined && (!Array.isArray(checks.warnings) || checks.warnings.length > 50 || checks.warnings.some((w) => typeof w !== 'string' || !WARNING.test(w))))) bad('checks is {ok?, warnings?: [codes]}');
    if (d.branch !== undefined && d.branch !== null && (typeof d.branch !== 'string' || d.branch.length > 200 || /[\u0000-\u001f]/.test(d.branch))) bad('branch is a name');
    out.deploy = { id: d.id, url: url(d.url, 'deploy.url'), files: int(d.files, 20000, 'files'), bytes: int(d.bytes, 524288000, 'bytes'), branch: d.branch ?? null,
      checks: { ...(checks.ok !== undefined ? { ok: checks.ok } : {}), ...(checks.warnings ? { warnings: checks.warnings } : {}) } };
  }
  if (e.kind === 'live') { if (typeof e.live !== 'string' || !ID.test(e.live)) bad('live names the version to make live'); out.live = e.live; }
  if (e.kind === 'domain_added' || e.kind === 'domain_removed') {
    if (typeof e.domain !== 'string' || !HOST.test(e.domain.toLowerCase())) bad('domain is a host name');
    out.domain = e.domain.toLowerCase();
  }
  return out;
}

const shapeSite = (r) => ({ id: r.id, workspaceId: r.workspace_id, app: r.app, projectId: r.project_id, name: r.name, url: r.url,
  live: r.live_deploy ? { deploy: r.live_deploy, since: r.live_since } : null, domains: r.domains, disabled: r.disabled,
  createdAt: r.created_at, updatedAt: r.updated_at });
const shapeVersion = (r, live) => ({ deploy: r.deploy, url: r.url, files: r.files, bytes: Number(r.bytes), branch: r.branch, checks: r.checks,
  live: r.deploy === live, createdBy: r.by_name ?? null, createdAt: r.created_at });
const shapeEvent = (r) => ({ kind: r.kind, deploy: r.deploy, detail: r.detail, by: r.by_name ?? null, at: r.at });

/**
 * Record what the building app just did. `app` is the app the caller's sign-in belongs to (never the body's), and the
 * person is the token's. Returns the site and whether this event was already recorded.
 */
export async function recordEvent(db, actor, app, value) {
  if (typeof app !== 'string' || !APP.test(app)) throw new SiteRecordError('Only an app that builds sites can report them', 'app_required', 403);
  const e = parseEvent(value);
  const ctx = await scope(db, actor, e.workspace, 'editor');
  // who did it: the agent itself when an agent acts (so the database's person-only rule sees it), else the person
  const doer = ctx.agentId || ctx.userId;
  if (PERSON_ONLY.has(e.kind) && ctx.agentId) throw new SiteRecordError('Only a person can make a site live or take it down', 'human_only', 403);
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  const release = client !== db;
  try {
    await client.query('BEGIN');
    let site = (await client.query('SELECT * FROM site_records WHERE app=$1 AND hosting_site_id=$2 FOR UPDATE', [app, e.site.id])).rows[0];
    if (site && site.workspace_id !== ctx.workspaceId) throw new SiteRecordError('That site belongs to another workspace', 'site_not_found', 404);
    if (site && site.project_id !== e.projectId) throw new SiteRecordError('That site belongs to another project', 'project_mismatch', 409);
    if (!site) {
      site = (await client.query(`INSERT INTO site_records(workspace_id,app,project_id,hosting_site_id,name,url,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [ctx.workspaceId, app, e.projectId, e.site.id, e.site.name, e.site.url, doer])).rows[0];
    }
    const seen = (await client.query('SELECT 1 FROM site_record_events WHERE site_id=$1 AND event_id=$2', [site.id, e.eventId])).rows[0];
    if (seen) { await client.query('COMMIT'); return { site: shapeSite(site), replayed: true }; }
    if (site.deleted_at && e.kind !== 'deleted') throw new SiteRecordError('That site was deleted', 'site_deleted', 409);

    let deploy = null, detail = {};
    switch (e.kind) {
      case 'version':
        deploy = e.deploy.id;
        await client.query(`INSERT INTO site_record_versions(site_id,deploy,url,files,bytes,branch,checks,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (site_id, deploy) DO NOTHING`, [site.id, deploy, e.deploy.url, e.deploy.files, e.deploy.bytes, e.deploy.branch, e.deploy.checks, doer]);
        detail = { files: e.deploy.files, bytes: e.deploy.bytes, ...(e.deploy.branch ? { branch: e.deploy.branch } : {}) };
        break;
      case 'live':
        deploy = e.live;
        if (!(await client.query('SELECT 1 FROM site_record_versions WHERE site_id=$1 AND deploy=$2', [site.id, deploy])).rows[0]) {
          throw new SiteRecordError('That version was never recorded', 'version_not_found', 409);
        }
        detail = { previous: site.live_deploy };
        site = (await client.query('UPDATE site_records SET live_deploy=$2, live_since=now(), updated_at=now() WHERE id=$1 RETURNING *', [site.id, deploy])).rows[0];
        break;
      case 'unpublished':
        detail = { previous: site.live_deploy };
        site = (await client.query('UPDATE site_records SET live_deploy=NULL, live_since=NULL, updated_at=now() WHERE id=$1 RETURNING *', [site.id])).rows[0];
        break;
      case 'renamed':
        detail = { from: site.name, to: e.site.name };
        site = (await client.query('UPDATE site_records SET name=$2, url=$3, updated_at=now() WHERE id=$1 RETURNING *', [site.id, e.site.name, e.site.url])).rows[0];
        break;
      case 'disabled': case 'enabled':
        site = (await client.query('UPDATE site_records SET disabled=$2, updated_at=now() WHERE id=$1 RETURNING *', [site.id, e.kind === 'disabled'])).rows[0];
        break;
      case 'domain_added': case 'domain_removed': {
        const hosts = new Set(site.domains || []);
        if (e.kind === 'domain_added') { if (hosts.size >= 50) bad('A site has at most 50 domains'); hosts.add(e.domain); } else hosts.delete(e.domain);
        detail = { domain: e.domain };
        site = (await client.query('UPDATE site_records SET domains=$2, updated_at=now() WHERE id=$1 RETURNING *', [site.id, JSON.stringify([...hosts].sort())])).rows[0];
        break;
      }
      case 'deleted':
        site = (await client.query('UPDATE site_records SET deleted_at=coalesce(deleted_at, now()), live_deploy=NULL, live_since=NULL, updated_at=now() WHERE id=$1 RETURNING *', [site.id])).rows[0];
        break;
      default: break;   // claimed: the row above is the record
    }
    await client.query('INSERT INTO site_record_events(site_id,event_id,kind,actor_user_id,deploy,detail) VALUES($1,$2,$3,$4,$5,$6)',
      [site.id, e.eventId, e.kind, doer, deploy, detail]);
    await client.query('COMMIT');
    return { site: shapeSite(site), replayed: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { if (release) client.release(); }
}

/** The workspace's sites (a viewer may read them; agents too). */
export async function listSites(db, actor, { workspace } = {}) {
  const ctx = await scope(db, actor, workspace, 'viewer');
  const rows = (await db.query('SELECT * FROM site_records WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 500', [ctx.workspaceId])).rows;
  return { sites: rows.map(shapeSite) };
}

/** One site: its versions (newest first) and what was done to it. */
export async function getSite(db, actor, { workspace, id } = {}) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new SiteRecordError('Invalid site id', 'invalid_site');
  const ctx = await scope(db, actor, workspace, 'viewer');
  const site = (await db.query('SELECT * FROM site_records WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL', [id, ctx.workspaceId])).rows[0];
  if (!site) throw new SiteRecordError('Site not found', 'site_not_found', 404);
  const versions = (await db.query(`SELECT v.*, u.display_name AS by_name FROM site_record_versions v LEFT JOIN users u ON u.id = v.created_by
    WHERE v.site_id=$1 ORDER BY v.created_at DESC LIMIT 200`, [id])).rows;
  const events = (await db.query(`SELECT e.*, u.display_name AS by_name FROM site_record_events e LEFT JOIN users u ON u.id = e.actor_user_id
    WHERE e.site_id=$1 ORDER BY e.at DESC LIMIT 200`, [id])).rows;
  return { site: shapeSite(site), versions: versions.map((v) => shapeVersion(v, site.live_deploy)), events: events.map(shapeEvent) };
}
