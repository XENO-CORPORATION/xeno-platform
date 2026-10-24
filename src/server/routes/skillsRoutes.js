/**
 * The skills library (services/skills.js; docs/AGENT-IDENTITY-SKILLS-CORPUS.md). The person's own signed-in session only.
 *
 *   GET    /api/skills[?workspace=<id>]          the skills this person can use: their own and their workspaces'
 *   POST   /api/skills                           { files:[{path,content}] | skillMd, workspaceId?, version? } → version 1.0.0
 *   GET    /api/skills/:id[?version=x.y.z]       one skill with its files and its versions
 *   POST   /api/skills/:id/versions              { files | skillMd, version? } → the next immutable version
 *   GET    /api/skills/:id/file?path=&version=   one file's exact bytes (a download; never rendered)
 *   POST   /api/skills/import/corpus             one skill from a XENO Corpus store, verified by Corpus's own checks
 *   POST   /api/skills/check                     { files } → every check saving them would run (secrets, steering, malicious code), nothing saved
 *   POST   /api/skills/detect                    { entries:[{rel,bytes,text?}] } → which skills a picked folder holds (Corpus's rules)
 *   POST   /api/skills/match                     { bundles:[{key,name,files:[{rel,sha256}]}] } → new | same | changed | taken
 *   DELETE /api/skills/:id                       archive it (agents that pinned a version keep it)
 */
import express from 'express';
import * as skills from '../services/skills.js';

const router = express.Router();
const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof skills.SkillError) return res.status(e.status).json({ success: false, error: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) });
    console.error('[skills]', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
// runs after personOnly (xenoMcpRoutes), which sets req.owner; the owner acts as a person
router.use((req, _res, next) => { req.me = { id: req.owner || (req.user && req.user.id), kind: 'human' }; next(); });

router.get('/', handled(async (req, res) => { res.json({ success: true, skills: await skills.list(req.db, req.me, { workspaceId: req.query.workspace ? String(req.query.workspace) : null }) }); }));
router.post('/', handled(async (req, res) => { res.status(201).json({ success: true, skill: await skills.create(req.db, req.me, req.body || {}) }); }));
router.post('/import/github', handled(async (req, res) => { res.status(201).json({ success: true, skill: await skills.importFromGitHub(req.db, req.me, req.body || {}) }); }));
router.post('/check', handled(async (req, res) => { res.json({ success: true, ...(await skills.preflight(req.db, req.me, req.body || {})) }); }));
router.post('/detect', handled(async (req, res) => { res.json({ success: true, ...skills.detect(req.me, req.body || {}) }); }));
router.post('/match', handled(async (req, res) => { res.json({ success: true, results: await skills.match(req.db, req.me, req.body || {}) }); }));
router.post('/import/corpus', handled(async (req, res) => { const skill = await skills.importFromCorpus(req.db, req.me, req.body || {}); res.status(skill.imported === 'new' ? 201 : 200).json({ success: true, skill }); }));
router.get('/:id/file', handled(async (req, res) => {
  const f = await skills.readFile(req.db, req.me, req.params.id, { path: req.query.path ? String(req.query.path) : 'SKILL.md', version: req.query.version ? String(req.query.version) : undefined });
  // a download, never a page: a skill's file is someone's data, so the browser must not render or sniff it
  res.set({ 'Content-Type': f.binary ? 'application/octet-stream' : 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${encodeURIComponent(f.path.split('/').pop())}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  res.send(f.bytes);
}));
router.get('/:id', handled(async (req, res) => { res.json({ success: true, skill: await skills.get(req.db, req.me, req.params.id, { version: req.query.version ? String(req.query.version) : undefined }) }); }));
router.post('/:id/versions', handled(async (req, res) => { res.status(201).json({ success: true, skill: await skills.addVersion(req.db, req.me, req.params.id, req.body || {}) }); }));
router.delete('/:id', handled(async (req, res) => { res.json({ success: true, ...(await skills.archive(req.db, req.me, req.params.id)) }); }));

export default router;
