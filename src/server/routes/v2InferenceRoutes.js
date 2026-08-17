/**
 * /api/v2/inference/* — the vault surface and the routing resolver.
 *
 * Spec: `XENO INFERENCE ROUTING - SPEC.md`.
 * Handling rules: `XENO CREDENTIAL HYGIENE - PLAYBOOK.md`.
 *
 * 🔴 REQUEST BODIES HERE CARRY A USER'S PROVIDER KEY.
 *
 * Consequences, all deliberate:
 *   - `POST /credentials` must NEVER be added to any request/response body
 *     logger. Hygiene §L2: redaction is an ALLOW-list of endpoints that may be
 *     logged, never a regex hoping to spot `sk-…` — the first provider to change
 *     its prefix defeats a blocklist.
 *   - No handler echoes `req.body` back, in a success or an error. An error
 *     message is built from a code, never from what was sent.
 *   - Nothing on this router returns plaintext. There is no "reveal" endpoint,
 *     and there will not be one: a lost key is re-entered, not recovered.
 *
 * Mounted behind `databaseMiddleware, oidcAuth`, so `req.user` is the resolved
 * account and every query below is scoped by `req.user.id`.
 */

import express from 'express';
import {
  SUPPORTED_PROVIDERS, DEFAULT_SURFACE, byokEnabled,
  createCredential, listCredentials, revokeCredential, deleteCredential,
  setRoute, clearRoute, listRoutes, listProducts, resolveInferenceRoute,
} from '../services/providerCredentials.js';

const router = express.Router();

/**
 * One error shape for the whole router, matching the v2 convention
 * (`{ error: { code, message } }`). A thrown error carries `.code` and `.http`
 * from the service; anything else becomes a generic 500 with NOTHING from the
 * request in it.
 */
function sendError(res, err, fallback = 'PLATFORM_ERROR') {
  const http = err && err.http ? err.http : 500;
  const code = (err && err.code) || fallback;
  const message = http === 500 ? 'inference routing failed' : (err && err.message) || 'request failed';
  if (http === 500) {
    // Log the code, never the error object — a stack trace can carry the request.
    console.error(`[inference] unhandled (${code})`);
  }
  return res.status(http).json({ error: { code, message } });
}

// ── Capability discovery ─────────────────────────────────────────────────────
// The UI asks what this server supports rather than hardcoding a list that
// drifts. `enabled:false` is a truthful answer, not an error — the flag failing
// closed is the designed state on a server that has not turned BYOK on.
router.get('/providers', (req, res) => {
  res.json({ enabled: byokEnabled(), providers: SUPPORTED_PROVIDERS, defaultSurface: DEFAULT_SURFACE });
});

// ── Credentials ──────────────────────────────────────────────────────────────

router.get('/credentials', async (req, res) => {
  try {
    res.json({ credentials: await listCredentials(req.db, req.user.id) });
  } catch (e) { sendError(res, e); }
});

/**
 * POST /credentials  { provider, label, secret, baseUrl? }
 *
 * Verifies with the provider BEFORE storing (spec D9). A key the provider
 * rejects is REFUSED with 422 rather than stored as `invalid` — storing a key we
 * already know is dead just moves the confusion later.
 */
router.post('/credentials', async (req, res) => {
  if (!byokEnabled()) {
    return res.status(503).json({ error: { code: 'byok_disabled', message: 'bring-your-own-key is not enabled on this server' } });
  }
  try {
    const { provider, label, secret, baseUrl } = req.body || {};
    const created = await createCredential(req.db, req.user.id, { provider, label, secret, baseUrl });
    res.status(201).json({ credential: created });
  } catch (e) { sendError(res, e); }
});

router.post('/credentials/:id/revoke', async (req, res) => {
  try {
    res.json({ credential: await revokeCredential(req.db, req.user.id, req.params.id) });
  } catch (e) { sendError(res, e); }
});

/**
 * DELETE /credentials/:id
 *
 * 409 while any product still routes to it, listing which ones (spec D10). The
 * alternative — cascading — would silently re-point those products at premium
 * and start spending credits.
 */
router.delete('/credentials/:id', async (req, res) => {
  try {
    res.json(await deleteCredential(req.db, req.user.id, req.params.id));
  } catch (e) {
    if (e && e.code === 'credential_in_use') {
      return res.status(409).json({ error: { code: e.code, message: e.message }, surfaces: e.surfaces });
    }
    sendError(res, e);
  }
});

// ── Products (the tracking surface, spec §8) ─────────────────────────────────
// Sourced from oauth_clients — that table IS the product registry. A hardcoded
// list would drift the first time a product is registered.
router.get('/products', async (req, res) => {
  try {
    res.json({ products: await listProducts(req.db, req.user.id) });
  } catch (e) { sendError(res, e); }
});

// ── Routes (which product uses what) ─────────────────────────────────────────

router.get('/routes', async (req, res) => {
  try {
    res.json({ defaultSurface: DEFAULT_SURFACE, routes: await listRoutes(req.db, req.user.id) });
  } catch (e) { sendError(res, e); }
});

/**
 * PUT /routes/:surface  { path, mode?, credentialId? }
 *
 * `:surface` is an OIDC client_id (`xeno-pixel`), or `*` for the account
 * default. Spec D6 — one product vocabulary across oauth_clients,
 * api_usage_logs and here.
 */
router.put('/routes/:surface', async (req, res) => {
  try {
    const { path, mode, credentialId } = req.body || {};
    const saved = await setRoute(req.db, req.user.id, req.params.surface, { path, mode, credentialId });
    res.json({ route: saved });
  } catch (e) { sendError(res, e); }
});

/** DELETE an override so the product INHERITS the account default again (D2). */
router.delete('/routes/:surface', async (req, res) => {
  try {
    res.json(await clearRoute(req.db, req.user.id, req.params.surface));
  } catch (e) { sendError(res, e); }
});

/**
 * POST /resolve  { surface, model?, requestedPath? }
 *
 * The authority both inference entry points ask. Read-only: it decides, it does
 * not spend. Forking this decision is exactly how the platform and the gateway
 * each ended up believing the other owned BYOK.
 *
 * 🔴 A byok decision that cannot be satisfied returns a typed 409. It never
 * degrades to premium — that would spend the user's credits on a request they
 * routed to be free.
 */
router.post('/resolve', async (req, res) => {
  try {
    const { surface, requestedPath } = req.body || {};
    res.json(await resolveInferenceRoute(req.db, req.user.id, { surface, requestedPath }));
  } catch (e) { sendError(res, e); }
});

export default router;
