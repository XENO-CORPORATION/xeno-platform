/**
 * /api/storage/connect/workspaces/:workspaceId/* — the website Storage's proxy to XENO Connect (services/webConnect.js).
 * Mounted behind databaseMiddleware + authMiddleware; only a website COOKIE session may use it (webSessionOf).
 * The browser gets status + JSON (or verified range bytes); never a token, a Connect cookie or a redirect.
 */
import express from 'express';
import { callConnect, connectOrigin, webSessionOf, WebConnectError } from '../services/webConnect.js';

const PASS_HEADERS = ['content-range', 'content-length', 'etag'];

export function createWebConnectRouter(options = {}) {
  const router = express.Router();
  const json = express.json({ limit: '64kb' });
  const raw = express.raw({ type: 'application/octet-stream', limit: '8mb' });
  router.use((req, res, next) => { res.set('cache-control', 'no-store'); next(); });
  router.all('/workspaces/:workspaceId/*rest', (req, res, next) => (req.is('application/octet-stream') ? raw : json)(req, res, next), async (req, res) => {
    try {
      const session = webSessionOf(req);
      const rest = [].concat(req.params.rest || []).join('/');
      const query = {};
      for (const [k, v] of Object.entries(req.query || {})) if (typeof v === 'string') query[k] = v;
      const body = Buffer.isBuffer(req.body) ? req.body : (req.method === 'GET' ? undefined : (req.body ?? {}));
      const { response, route } = await callConnect(req.db, session, {
        workspaceId: req.params.workspaceId, method: req.method, rest, query, body,
        idempotencyKey: req.get('idempotency-key') || undefined,
      }, options);
      if (route.stream && response.status === 206) {
        for (const h of PASS_HEADERS) { const v = response.headers.get(h); if (v) res.set(h, v); }
        res.status(206).type('application/octet-stream');
        return res.end(Buffer.from(await response.arrayBuffer()));
      }
      if (response.status >= 300 && response.status < 400) return res.status(502).json({ error: { code: 'UNAVAILABLE' } });
      const text = await response.text();
      let data = {}; try { data = text ? JSON.parse(text) : {}; } catch { return res.status(502).json({ error: { code: 'UNAVAILABLE' } }); }
      if (route.link && response.ok) {
        // Only a one-use start URL ON Connect's own origin is handed to the browser to navigate to.
        const start = (() => { try { return new URL(data.startUrl); } catch { return null; } })();
        const origin = new URL(connectOrigin(options.env || process.env)).origin;
        if (!start || start.origin !== origin || !/^\/v1\/connect\/link\/start\/[A-Za-z0-9_-]{16,512}$/.test(start.pathname) || start.search || start.hash) {
          return res.status(502).json({ error: { code: 'UNAVAILABLE' } });
        }
        data = { id: data.id, startUrl: start.href, expiresAt: data.expiresAt };
      }
      return res.status(response.status).json(data);
    } catch (e) {
      if (e instanceof WebConnectError) return res.status(e.status).json({ error: { code: e.code } });
      console.error('[web-connect]', e.name);
      return res.status(503).json({ error: { code: 'UNAVAILABLE' } });
    }
  });
  return router;
}

export default createWebConnectRouter();
