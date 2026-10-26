/**
 * /api/v2/spawn/skills — the person's skills library, as XENO Spawn sees it (services/skills.js, unchanged).
 *
 * Mounted behind oidcAuth like /api/v2/spawn/profiles: the account is ALWAYS req.user.id from the token, and only a
 * PERSON may use it (Spawn runs the person's own agents; an agent token is refused). There is no second store and no
 * second format: every call is the library's own function, so access, scans and versioning are decided there.
 * Spawn pins {id, version, hash}; nothing here ever moves a pin.
 *
 *   GET  /                      the person's own and their workspaces' skills (skills.list)
 *   GET  /:id[?version=x.y.z]   one version with every file's exact bytes, so Spawn can verify before writing:
 *                               files: [{ path, encoding: 'utf8'|'base64', content, sha256, size }]
 *   POST /import                skills.importFromCorpus — same body, same scans; workspace only if they can edit it
 */
import express from 'express';
import { createHash } from 'node:crypto';
import * as skills from '../services/skills.js';
import { resolvePrincipal, assertPrincipalUsable, AgentIdentityError } from '../services/agentIdentity.js';

const router = express.Router();
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

const handled = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) {
    if (e instanceof skills.SkillError) return res.status(e.status).json({ success: false, error: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) });
    if (e instanceof AgentIdentityError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    console.error('[spawn-skills]', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

router.use(handled(async (req, res, next) => {
  const p = await resolvePrincipal(req.db, req.user.id);
  assertPrincipalUsable(p);
  if (p.kind !== 'human') return res.status(403).json({ success: false, error: 'Only a person’s own sign-in can use their skills library from Spawn', code: 'person_only' });
  req.me = { id: p.id, kind: 'human' };
  next();
}));

/** A version as Spawn writes it: every file with its bytes and their sha256. */
export async function withBytes(db, skill) {
  const files = [];
  for (const f of skill.files) {
    const { binary, bytes } = await skills.bytesOf(db, f);
    files.push({ path: f.path, encoding: binary ? 'base64' : 'utf8', content: binary ? Buffer.from(bytes).toString('base64') : Buffer.from(bytes).toString('utf8'), sha256: sha256(bytes), size: bytes.length });
  }
  return { ...skill, files };
}

router.get('/', handled(async (req, res) => {
  res.json({ success: true, skills: await skills.list(req.db, req.me, { workspaceId: req.query.workspace ? String(req.query.workspace) : null }) });
}));
router.post('/import', handled(async (req, res) => {
  const skill = await skills.importFromCorpus(req.db, req.me, req.body || {});
  res.status(skill.imported === 'new' ? 201 : 200).json({ success: true, skill });
}));
router.get('/:id', handled(async (req, res) => {
  const s = await skills.get(req.db, req.me, req.params.id, { version: req.query.version ? String(req.query.version) : undefined });
  res.json({ success: true, skill: await withBytes(req.db, s) });
}));

export default router;
