/**
 * XENO Corpus (services/xenoCorpus.js) -- the same service as XENO MCP corpus.* and the Corpus tab.
 *
 *   GET  /api/corpus/:scope/:id                      the corpus of a workspace|division|project: tenets with latest verdict,
 *                                                     inherited doctrine, descendants' tenets by reference, proposals
 *   GET  /api/corpus/:scope/:id/query?q=             search what the reader can see in that scope          (corpus.query)
 *   GET  /api/corpus/:scope/:id/assess               held / lapsed / due / never, per tenet                (corpus.assess)
 *   POST /api/corpus/:scope/:id/tenets               a person who administers the scope writes a tenet
 *   POST /api/corpus/:scope/:id/proposals            { action, tenet?, targetTenetId?, rationale }          (corpus.propose)
 *   POST /api/corpus/proposals/:id/decision          { decision: ratify|reject, note? } -- a person only
 *   GET  /api/corpus/tenets/:id/verdicts             the signed history
 *   POST /api/corpus/tenets/:id/verdicts             { admissionId, state, observed?, instrument? } -- an admitted assay run
 *   POST /api/corpus/projects/:id/import             { bindingId, tenets[] } -- the bound installation syncs `.xeno/corpus/`
 */
import express from 'express';
import * as corpus from '../services/xenoCorpus.js';

const handled = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof corpus.CorpusError || e?.name === 'DirectoryBindingError') return res.status(e.status).json({ success: false, error: e.message, code: e.code });
    console.error('[corpus]', e);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
const actor = (req) => ({ id: String(req.user.id) });
const scope = (req) => ({ kind: String(req.params.scope), id: String(req.params.id) });
const defaultSigningKey = async (db) => (await import('../utils/oidcProvider.js')).getSigningKey(db);

export function createCorpusRouter({ signingKey = defaultSigningKey } = {}) {
  const router = express.Router();
  router.get('/tenets/:id/verdicts', handled(async (req, res) => res.json({ success: true, ...(await corpus.verdictHistory(req.db, actor(req), req.params.id, { limit: req.query.limit })) })));
  router.post('/tenets/:id/verdicts', handled(async (req, res) => {
    const key = await signingKey(req.db);
    res.status(201).json({ success: true, ...(await corpus.recordVerdict(req.db, actor(req), req.params.id, req.body || {}, { signingKey: { kid: key.kid, privatePem: key.privatePem } })) });
  }));
  router.post('/proposals/:id/decision', handled(async (req, res) => res.json({ success: true, ...(await corpus.decideProposal(req.db, actor(req), req.params.id, req.body || {})) })));
  router.post('/projects/:id/import', handled(async (req, res) => res.json({ success: true, ...(await corpus.importFromDirectory(req.db, req.auth, req.params.id, req.body || {})) })));
  router.get('/:scope/:id', handled(async (req, res) => res.json({ success: true, ...(await corpus.readCorpus(req.db, actor(req), scope(req))) })));
  router.get('/:scope/:id/query', handled(async (req, res) => res.json({ success: true, ...(await corpus.queryCorpus(req.db, actor(req), { ...scope(req), q: req.query.q })) })));
  router.get('/:scope/:id/assess', handled(async (req, res) => res.json({ success: true, ...(await corpus.assessCorpus(req.db, actor(req), scope(req))) })));
  router.post('/:scope/:id/tenets', handled(async (req, res) => res.status(201).json({ success: true, tenet: await corpus.authorTenet(req.db, actor(req), scope(req), req.body || {}) })));
  router.post('/:scope/:id/proposals', handled(async (req, res) => res.status(201).json({ success: true, ...(await corpus.propose(req.db, actor(req), scope(req), req.body || {})) })));
  return router;
}
export default createCorpusRouter();
