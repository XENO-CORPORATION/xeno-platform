/**
 * /api/sites — XENO Sites in the workspace (services/siteRecords.js).
 *
 *   POST /events          {eventId, kind, projectId, site, deploy?, live?, domain?, workspace?}
 *                         what the building app just did, sent AS THE PERSON by that app (an app sign-in with sites:write).
 *                         The app is the token's client; the person is the token's. A platform session cannot send one.
 *   GET  /                the workspace's sites (?workspace=)
 *   GET  /:id             one site, its versions and what was done to it
 */
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { projectAppOf } from '../services/projectFolders.js';
import * as S from '../services/siteRecords.js';

const router = express.Router();
const actorOf = async (req) => {
  const isAgent = (await req.db.query('SELECT 1 FROM agent_identities WHERE user_id = $1', [req.user.id])).rows.length > 0;
  return { id: req.user.id, kind: isAgent ? 'agent' : 'human' };
};
const scopes = (req) => String(req.auth?.scope || '').split(/\s+/);
const fail = (res, e) => {
  if (e instanceof S.SiteRecordError) return res.status(e.status).json({ success: false, code: e.code, error: e.message });
  console.error('[Sites]', e); return res.status(500).json({ success: false, error: 'Internal server error' });
};
router.use(authMiddleware);

/** Who may report an event: an app's own sign-in, carrying sites:write. Returns the refusal, or null. */
export function eventRefusal(req) {
  if (req.auth?.kind !== 'oidc') return { code: 'app_required', error: 'Sites are reported by the app that built them' };
  if (!scopes(req).includes('sites:write')) return { code: 'scope_missing', error: 'This sign-in lacks sites:write; sign in again to allow it' };
  return null;
}
/** Who may read: a platform session, or an app's sign-in carrying sites:read or sites:write. */
export function readRefusal(req) {
  if (req.auth?.kind === 'oidc' && !scopes(req).includes('sites:read') && !scopes(req).includes('sites:write')) return { code: 'scope_missing', error: 'This sign-in lacks sites:read; sign in again to allow it' };
  return null;
}
router.post('/events', express.json({ limit: '16kb' }), async (req, res) => {
  const no = eventRefusal(req); if (no) return res.status(403).json({ success: false, ...no });
  try { res.json({ success: true, ...(await S.recordEvent(req.db, await actorOf(req), projectAppOf(req.auth.clientId), req.body)) }); }
  catch (e) { fail(res, e); }
});

const read = (fn) => async (req, res) => {
  const no = readRefusal(req); if (no) return res.status(403).json({ success: false, ...no });
  try { res.json({ success: true, ...(await fn(req, await actorOf(req))) }); } catch (e) { fail(res, e); }
};
router.get('/', read((req, a) => S.listSites(req.db, a, { workspace: req.query.workspace || null })));
router.get('/:id', read((req, a) => S.getSite(req.db, a, { workspace: req.query.workspace || null, id: req.params.id })));

export default router;
