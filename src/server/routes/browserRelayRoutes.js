/**
 * /api/v2/browser/* — the platform side of "a chat drives the person's own browser through XENO Extension".
 * Contract: docs/CHAT-TOOL-CALLING-PLAN.md → "Browser tools".
 *
 *   GET    /installations            the person's own connected browsers
 *   POST   /installations            register THIS browser (bound to the proof's DPoP key; starts disabled)
 *   GET    /installations/:id        one of them
 *   PATCH  /installations/:id        { enabled?, label? } — the one switch that lets chats use it
 *   DELETE /installations/:id        revoke (closes the socket, fails queued calls)
 *   GET    /calls/:callId            what one step is doing — the read side of §12.1 rule 2
 *
 * 🔴 EVERY ROUTE REQUIRES A DPoP-BOUND TOKEN. `requireDpopIfBound` is not enough here: an unbound token
 * must not reach these at all, or "the installation is bound to a key" would be true of the row and
 * false of the caller. `requireBoundProof` below refuses an unbound caller outright.
 *
 * The scope is `browser:connect`, held by the extension client alone (asserted by
 * scripts/oidc-extension-client.test.mjs) — driving a browser is a different authority from spending
 * credits, so it is a different scope.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import * as installations from '../services/browserInstallations.js';
import * as relay from '../services/browserRelay.js';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import { recordSecurityEventTransactional, EVENTS } from '../services/securityEvents.js';
import { RELAY_SURFACES } from '../utils/browserRelayProtocol.js';

const mutateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, validate: { ip: false },
  message: { error: { code: 'rate_limited', message: 'Too many browser settings changes. Try again shortly.' } },
  keyGenerator: (req) => `browser-relay:user:${req.user?.id || 'anon'}`,
});

function sendError(res, e) {
  if (e instanceof installations.InstallationError) {
    return res.status(e.status).json({ error: { code: e.code, message: e.message } });
  }
  console.error(`[browser-relay] unhandled (${e?.code || 'error'})`);   // the code only: a stack can carry the request
  return res.status(500).json({ error: { code: 'PLATFORM_ERROR', message: 'The browser request failed.' } });
}

/** A token bound to a key, carrying this surface's scope. Anything else is refused BEFORE any row is read. */
const boundProof = (spec) => (req, res, next) => {
  const jkt = req.auth?.dpopJkt;
  if (!jkt) {
    return res.status(403).json({ error: { code: 'dpop_bound_required', message: spec.signIn } });
  }
  const scope = String(req.auth?.scope || '').split(/\s+/);
  if (!scope.includes(spec.scope)) {
    return res.status(403).json({ error: { code: 'INSUFFICIENT_SCOPE', message: `This sign-in was not granted ${spec.scope}.` } });
  }
  req.browserJkt = jkt;
  return next();
};

/** The proof that accompanies a registration must be the SAME key the token is bound to — otherwise a
 *  token could register an installation for a key it does not hold, and the binding would be decoration. */
function requireMatchingProof(req, res, next) {
  requireDpopIfBound(req, res, () => {
    if (req.dpopJkt && req.dpopJkt !== req.browserJkt) {
      return res.status(403).json({ error: { code: 'invalid_dpop_proof', message: 'That proof is from a different key than this sign-in.' } });
    }
    return next();
  });
}

/** The routes every surface shares. A device on one surface reads as absent on another. */
export function installationRoutes(spec) {
  const router = express.Router();
  const requireBoundProof = boundProof(spec);

  router.get('/installations', requireBoundProof, async (req, res) => {
    try {
      const out = await installations.list(req.db, req.user.id, spec.surface);
      // which of the caller's own are connected here, never anyone else's
      res.json({ ...out, live: out.installations.map((i) => String(i.id)).filter((id) => relay.isLive(id)) });
    }
    catch (e) { sendError(res, e); }
  });

  router.post('/installations', requireBoundProof, requireMatchingProof, mutateLimiter, async (req, res) => {
    try {
      const out = await installations.register(req.db, req.user.id, req.body, req.browserJkt, spec.surface);
      if (out.created) {
        await recordSecurityEventTransactional(req.db, EVENTS.BROWSER_INSTALLATION_REGISTERED, {
          userId: req.user.id, req, metadata: { installationId: out.installation.id, browser: out.installation.browser || null, surface: spec.surface },
        }).catch(() => {});
      }
      res.status(out.created ? 201 : 200).json({ installation: out.installation, created: out.created });
    } catch (e) { sendError(res, e); }
  });

  router.get('/installations/:id', requireBoundProof, async (req, res) => {
    try { res.json({ installation: await installations.get(req.db, req.user.id, req.params.id, spec.surface) }); }
    catch (e) { sendError(res, e); }
  });

  router.patch('/installations/:id', requireBoundProof, requireMatchingProof, mutateLimiter, async (req, res) => {
    try {
      const { installation } = await installations.patch(req.db, req.user.id, req.params.id, req.body, spec.surface);
      // Turning the switch OFF must take effect now, not at the next reconnect: the socket is closed and
      // queued calls fail, so a browser the person just disabled cannot act on a step already in flight.
      if (installation.enabled === false) await (spec.surface === 'corpus' ? relay.disconnect(req.db, req.params.id, 'turned_off', spec.off, spec.off) : relay.disconnect(req.db, req.params.id, 'revoked')).catch(() => {});
      res.json({ installation });
    } catch (e) { sendError(res, e); }
  });

  router.delete('/installations/:id', requireBoundProof, requireMatchingProof, mutateLimiter, async (req, res) => {
    try {
      const out = await installations.remove(req.db, req.user.id, req.params.id, spec.surface);
      await relay.revoke(req.db, req.params.id).catch(() => {});
      await recordSecurityEventTransactional(req.db, EVENTS.BROWSER_INSTALLATION_REVOKED, {
        userId: req.user.id, req, metadata: { installationId: out.id, surface: spec.surface },
      }).catch(() => {});
      res.json(out);
    } catch (e) { sendError(res, e); }
  });

  return router;
}

const router = installationRoutes(RELAY_SURFACES.browser);

/** XENO Corpus on a person's PC (services/corpusLocalMcp.js): the same routes on its own scope and rows. */
export const corpusRelayRoutes = installationRoutes(RELAY_SURFACES.corpus);

/** §12.1 rule 2 — a mutating verb needs a reading verb. This is how a caller (or the account page)
 *  answers "what is that step doing?" without polling the socket. */
router.get('/calls/:callId', boundProof(RELAY_SURFACES.browser), async (req, res) => {
  try {
    const { rows } = await req.db.query(
      `SELECT call_id AS "callId", installation, tool, state, ok, error_code AS "errorCode",
              conversation_id AS "conversationId", created_at AS "createdAt", deadline
         FROM browser_calls WHERE call_id = $1 AND user_id = $2`, [req.params.callId, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: { code: 'not_found', message: 'No such step.' } });
    res.json({ call: rows[0] });
  } catch (e) { sendError(res, e); }
});

/**
 * The account page's view of the same rows: `/api/account/browsers`, authenticated by the person's WEB SESSION.
 * The page holds no DPoP key, and needs none — listing, turning chats on or off, and removing a browser are the
 * person acting on their own account. Registering stays DPoP-only above: only the browser itself can bind its key.
 */
export const accountBrowserRouter = express.Router();

accountBrowserRouter.get('/', async (req, res) => {
  try {
    const { installations: rows } = await installations.list(req.db, req.user.id);
    const cutoff = Date.now() - 60_000;
    res.json({ browsers: rows.map((b) => ({
      id: b.id, label: b.label, browser: b.browser, os: b.os, enabled: b.enabled,
      extensionVersion: b.extensionVersion, tools: Array.isArray(b.tools) ? b.tools.length : 0,
      lastSeenAt: b.lastSeenAt, connected: Boolean(b.lastSeenAt && Date.parse(b.lastSeenAt) > cutoff), createdAt: b.createdAt,
    })) });
  } catch (e) { sendError(res, e); }
});

accountBrowserRouter.patch('/:id', mutateLimiter, async (req, res) => {
  try {
    const { installation } = await installations.patch(req.db, req.user.id, req.params.id, req.body);
    if (installation.enabled === false) await relay.disconnect(req.db, req.params.id, 'revoked').catch(() => {});
    res.json({ browser: { id: installation.id, label: installation.label, enabled: installation.enabled } });
  } catch (e) { sendError(res, e); }
});

accountBrowserRouter.delete('/:id', mutateLimiter, async (req, res) => {
  try {
    const out = await installations.remove(req.db, req.user.id, req.params.id);
    await relay.revoke(req.db, req.params.id).catch(() => {});
    await recordSecurityEventTransactional(req.db, EVENTS.BROWSER_INSTALLATION_REVOKED, {
      userId: req.user.id, req, metadata: { installationId: out.id, via: 'account' },
    }).catch(() => {});
    res.json(out);
  } catch (e) { sendError(res, e); }
});

/**
 * The account page's view of a person's Corpus PCs: `/api/account/corpus-pcs`, on the web session like the browsers above. Turning one off takes
 * effect now and survives its restart. Removing it wipes the names of its projects and refuses the same installation from then on.
 */
export const accountCorpusRouter = express.Router();

accountCorpusRouter.get('/', async (req, res) => {
  try {
    const { installations: rows } = await installations.list(req.db, req.user.id, 'corpus');
    const cutoff = Date.now() - 60_000;
    res.json({ pcs: rows.map((p) => ({
      id: p.id, label: p.label, os: p.os, enabled: p.enabled, appVersion: p.extensionVersion, projects: p.projects,
      lastSeenAt: p.lastSeenAt, connected: Boolean(p.lastSeenAt && Date.parse(p.lastSeenAt) > cutoff), createdAt: p.createdAt,
    })) });
  } catch (e) { sendError(res, e); }
});

accountCorpusRouter.patch('/:id', mutateLimiter, async (req, res) => {
  try {
    const { installation } = await installations.patch(req.db, req.user.id, req.params.id, { enabled: req.body?.enabled }, 'corpus');
    if (installation.enabled === false) await relay.disconnect(req.db, req.params.id, 'turned_off', RELAY_SURFACES.corpus.off, RELAY_SURFACES.corpus.off).catch(() => {});
    res.json({ pc: { id: installation.id, label: installation.label, enabled: installation.enabled } });
  } catch (e) { sendError(res, e); }
});

accountCorpusRouter.delete('/:id', mutateLimiter, async (req, res) => {
  try {
    const out = await installations.remove(req.db, req.user.id, req.params.id, 'corpus');
    await relay.revoke(req.db, req.params.id).catch(() => {});
    await recordSecurityEventTransactional(req.db, EVENTS.BROWSER_INSTALLATION_REVOKED, {
      userId: req.user.id, req, metadata: { installationId: out.id, via: 'account', surface: 'corpus' },
    }).catch(() => {});
    res.json(out);
  } catch (e) { sendError(res, e); }
});

export default router;
