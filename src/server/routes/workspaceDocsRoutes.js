/**
 * /api/workspace-docs — Office › Write (kind doc) and Office › Notes (kind note), services/workspaceDocs.js.
 * A document is a Storage file in XENO Docs' `.xdoc` format; sharing goes through
 * /api/library/assets/file/:id/shares, unchanged.
 *
 *   GET  /?kind=&q=&workspace=        list (q searches through the Library search)
 *   POST /                            {kind, title, xdoc | content | markdown, workspace} → a new document
 *   GET  /:id                         the document (xdoc, content, text, markdown) + its backlinks
 *   PUT  /:id                         {title?, xdoc? | content? | markdown?, expectedVersion?} → a new version
 *   GET  /:id/versions                · POST /:id/versions/:versionId/restore
 *   POST /:id/trash                   · POST /:id/untrash
 *
 * A body the format refuses answers 400 `invalid_document` with the format's own `problems` list.
 */
import express from 'express';
import * as D from '../services/workspaceDocs.js';

const router = express.Router();
const actorOf = async (req) => {
  const isAgent = (await req.db.query('SELECT 1 FROM agent_identities WHERE user_id = $1', [req.user.id])).rows.length > 0;
  return { id: req.user.id, kind: isAgent ? 'agent' : 'human' };
};
const run = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req, await actorOf(req))) }); }
  catch (e) {
    if (e instanceof D.DocsError) return res.status(e.status).json({ success: false, code: e.code, error: e.message, ...(e.current ? { current: e.current } : {}), ...(e.problems ? { problems: e.problems } : {}) });
    console.error('Workspace docs failed:', e); res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
const body = (req) => ({ xdoc: req.body?.xdoc, content: req.body?.content, markdown: req.body?.markdown });

router.get('/', run((req, a) => D.listDocs(req.db, a, { workspace: req.query.workspace || null, kind: req.query.kind, query: req.query.q })));
router.post('/', run((req, a) => D.createDoc(req.db, a, { workspace: req.body?.workspace || null, kind: req.body?.kind, title: req.body?.title, ...body(req) })));
router.get('/:id', run((req, a) => D.getDoc(req.db, a, { id: req.params.id })));
router.put('/:id', run((req, a) => D.saveDoc(req.db, a, { id: req.params.id, title: req.body?.title, ...body(req), expectedVersion: req.body?.expectedVersion })));
router.get('/:id/versions', run((req, a) => D.docVersions(req.db, a, { id: req.params.id })));
router.post('/:id/versions/:versionId/restore', run((req, a) => D.restoreDocVersion(req.db, a, { id: req.params.id, versionId: req.params.versionId })));
router.post('/:id/trash', run((req, a) => D.trashDoc(req.db, a, { id: req.params.id })));
router.post('/:id/untrash', run((req, a) => D.untrashDoc(req.db, a, { id: req.params.id })));

export default router;
