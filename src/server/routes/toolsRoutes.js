/**
 * /api/tools — XENO tools on the platform (services/toolPackages.js).
 *
 *   GET /                         every tool in the registry, with where it runs (web or needs Hub for …)
 *   GET /suggest?q=…              the tools that fit what a person typed (best first)
 *   GET /:id/:version/:file       one file of a VERIFIED package — the only place the tool page loads tool code from
 *
 * Public reads, like the registry on R2 they mirror: nothing here is private. What a tool DOES (AI, image
 * generation, credits) goes through the platform's own signed-in, metered routes from the tool page.
 */
import express from 'express';
import * as tools from '../services/toolPackages.js';

const router = express.Router();
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' };
const fail = (res, e) => res.status(e.status || 500).json({ success: false, error: e.status ? e.message : 'XENO tools are unavailable right now', ...(e.code ? { code: e.code } : {}) });

router.get('/', async (_req, res) => {
  try { res.set('Cache-Control', 'public, max-age=60'); res.json({ success: true, tools: await tools.listTools() }); }
  catch (e) { console.error('[tools]', e.message); fail(res, e); }
});

router.get('/suggest', async (req, res) => {
  try { res.json({ success: true, tools: await tools.suggestTools(String(req.query.q || '').slice(0, 500)) }); }
  catch (e) { console.error('[tools]', e.message); fail(res, e); }
});

router.get('/:id/:version/:file', async (req, res) => {
  try {
    const pkg = await tools.loadPackage(req.params.id, req.params.version);
    const bytes = pkg.files[req.params.file];
    if (!bytes) return res.status(404).json({ success: false, error: 'No such file in this package' });
    const ext = (req.params.file.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    res.set('Content-Type', TYPES[ext] || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=31536000, immutable'); // a version's bytes never change
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  } catch (e) { console.error('[tools]', e.message); fail(res, e); }
});

export default router;
