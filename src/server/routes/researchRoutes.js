/**
 * XENO Research (services/xenoResearch.js) -- the same service as XENO MCP research.* and the Research mode.
 *
 *   GET  /api/research/home                          recent notebooks, runs needing attention, claims not holding
 *   GET  /api/research/projects/:id/notebooks        a project's notebooks
 *   POST /api/research/projects/:id/notebooks        { title, notebook (.ipynb JSON) }
 *   GET  /api/research/projects/:id/runs             a project's research runs
 *   GET  /api/research/projects/:id/claims           a project's claims (Corpus tenets) with held/lapsed/unobserved
 *   GET  /api/research/notebooks/:id                 a notebook, its cells and latest outputs, its runs
 *   POST /api/research/notebooks/:id/lock            resolve the environment lock in Box      (async run, kind lock)
 *   POST /api/research/notebooks/:id/runs            run it in Box                             (async run, kind run)
 *   GET  /api/research/runs/:id                      a run, with its signature checked now
 *   POST /api/research/runs/:id/verify               re-run and compare                        (async run, kind verify)
 *   GET  /api/research/runs/:id/export               the export package (JSON with every file)
 *   POST /api/research/runs/:id/claims               { cell, claim? } -- a person makes a claimed cell a Corpus tenet
 *   GET  /api/research/claims/:id                    a claim and its signed verdicts
 *   POST /api/research/claims/:id/recheck            { admissionId } -- re-run in Box; the verdict goes to Corpus
 *
 * A refused run is still answered 201 with status "refused" and the reason: the refusal is the record.
 */
import express from 'express';
import * as research from '../services/xenoResearch.js';
import { CorpusError } from '../services/xenoCorpus.js';

const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof research.ResearchError || e instanceof CorpusError) return res.status(e.status).json({ success: false, error: e.message, code: e.code });
    console.error('[research]', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
const actor = (req) => ({ id: String(req.user.id) });

export function createResearchRouter({ pool = null } = {}) {
  const router = express.Router();
  const db = (req) => pool || req.db;     // runs execute in the background: they need the real pool, never a preview wrapper
  router.get('/home', handled(async (req, res) => res.json({ success: true, ...(await research.home(req.db, actor(req))) })));
  router.get('/projects/:id/notebooks', handled(async (req, res) => res.json({ success: true, ...(await research.listNotebooks(req.db, actor(req), req.params.id)) })));
  router.post('/projects/:id/notebooks', handled(async (req, res) => res.status(201).json({ success: true, ...(await research.createNotebook(req.db, actor(req), req.params.id, req.body || {})) })));
  router.get('/projects/:id/runs', handled(async (req, res) => res.json({ success: true, ...(await research.listRuns(req.db, actor(req), req.params.id)) })));
  router.get('/projects/:id/claims', handled(async (req, res) => res.json({ success: true, ...(await research.listClaims(req.db, actor(req), req.params.id)) })));
  router.get('/notebooks/:id', handled(async (req, res) => res.json({ success: true, ...(await research.getNotebook(req.db, actor(req), req.params.id)) })));
  router.post('/notebooks/:id/lock', handled(async (req, res) => res.status(201).json({ success: true, ...(await research.requestLock(db(req), actor(req), req.params.id)) })));
  router.post('/notebooks/:id/runs', handled(async (req, res) => res.status(201).json({ success: true, ...(await research.requestRun(db(req), actor(req), req.params.id)) })));
  router.get('/runs/:id', handled(async (req, res) => res.json({ success: true, ...(await research.getRun(req.db, actor(req), req.params.id)) })));
  router.post('/runs/:id/verify', handled(async (req, res) => res.status(201).json({ success: true, ...(await research.requestVerify(db(req), actor(req), req.params.id)) })));
  router.get('/runs/:id/export', handled(async (req, res) => {
    const pkg = await research.exportRun(req.db, actor(req), req.params.id);
    res.setHeader('Content-Disposition', `attachment; filename="${pkg.name}"`);
    res.json(pkg);
  }));
  router.post('/runs/:id/claims', handled(async (req, res) => res.status(201).json({ success: true, ...(await research.claimCell(req.db, actor(req), req.params.id, req.body || {})) })));
  router.get('/claims/:id', handled(async (req, res) => res.json({ success: true, ...(await research.getClaim(req.db, actor(req), req.params.id)) })));
  router.post('/claims/:id/recheck', handled(async (req, res) => res.status(201).json({ success: true, ...(await research.recheckClaim(db(req), actor(req), req.params.id, req.body || {})) })));
  return router;
}
