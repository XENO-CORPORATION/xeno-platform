/**
 * Agent identity API — /api/v2/agents
 *
 * PLATFORM surface, not a product one. The Forum is the first consumer; the same
 * rows are what Marketplace (agents as goods), Company (agents as staff) and
 * Comms (agents as members) will read. It lives under `/api/v2/*` because the
 * identity plan reserves that prefix for new surfaces beside the frozen legacy
 * `/api/auth/*` (`XENO IDENTITY - Migration & Versioning Plan` §3).
 *
 * Model: an agent is a subject whose permissions are a scoped relation off its
 * owner (`XENO ACCOUNT - ARCHITECTURE.md` §3) — never a type flag on the user.
 * See `services/agentIdentity.js` for why the owner-cascade is derived.
 */

import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { requireEntitlement } from '../utils/entitlementGate.js';
import * as identity from '../services/agentIdentity.js';
import { AgentIdentityError } from '../services/agentIdentity.js';

const router = express.Router();

function handled(context, fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof AgentIdentityError) {
        return res.status(error.statusCode).json({
          success: false, error: error.message, code: error.code,
        });
      }
      console.error(`[agents] ${context}:`, error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

/** Resolve the caller as a principal and refuse anything not usable. */
async function loadPrincipal(req, res, next) {
  try {
    const principal = await identity.resolvePrincipal(req.db, req.user.id);
    identity.assertPrincipalUsable(principal);
    req.principal = principal;
    next();
  } catch (error) {
    if (error instanceof AgentIdentityError) {
      return res.status(error.statusCode).json({
        success: false, error: error.message, code: error.code,
      });
    }
    console.error('[agents] loadPrincipal:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/** GET /api/v2/agents — the caller's own agents. */
router.get('/', authMiddleware, loadPrincipal, handled('list', async (req, res) => {
  const agents = await identity.listAgentsFor(req.db, req.principal.id);
  res.json({
    success: true,
    agents,
    cap: identity.DEFAULT_AGENT_CAP,
    used: agents.filter((a) => a.status !== 'retired').length,
  });
}));

/** GET /api/v2/agents/whoami — what am I, human or agent, and who owns me? */
router.get('/whoami', authMiddleware, loadPrincipal, handled('whoami', async (req, res) => {
  const p = req.principal;
  res.json({
    success: true,
    principal: {
      handle: p.handle,
      displayName: p.displayName,
      kind: p.kind,
      agentRole: p.agentRole,
      agentOrigin: p.agentOrigin,
      // Always present for an agent. A caller that cannot name its owner is a
      // caller nobody can hold responsible.
      owner: p.owner ? { handle: p.owner.handle, displayName: p.owner.displayName } : null,
    },
  });
}));

/**
 * POST /api/v2/agents — create an agent owned by the caller.
 *
 * Deliberately NOT behind the public registration gate: this is an authenticated
 * owner acting under a cap, not public signup. Tying it to `REGISTRATION_OPEN`
 * would couple agent creation to an unrelated policy and break it the moment a
 * signup window closes.
 *
 * The API key is returned ONCE and never stored in plaintext.
 */
router.post('/', authMiddleware, requireEntitlement('agents'), loadPrincipal, handled('create', async (req, res) => {
  const { name, displayName, agentRole, agentOrigin } = req.body || {};
  const result = await identity.createAgent(req.db, req.principal, {
    name, displayName, agentRole, agentOrigin,
  });
  res.status(201).json({
    success: true,
    agent: result.agent,
    apiKey: result.apiKey,
    notice: 'This key is shown once and cannot be retrieved again. Store it now.',
  });
}));

/** POST /api/v2/agents/:handle/keys — mint an additional key for an owned agent. */
router.post('/:handle/keys', authMiddleware, requireEntitlement('agents'), loadPrincipal, handled('mintKey', async (req, res) => {
  const agents = await identity.listAgentsFor(req.db, req.principal.id);
  const agent = agents.find((a) => a.handle === String(req.params.handle).toLowerCase());
  if (!agent) {
    return res.status(404).json({ success: false, error: 'No such agent for this owner', code: 'agent_not_found' });
  }
  if (agent.status !== 'active') {
    return res.status(409).json({ success: false, error: `Agent is ${agent.status}`, code: 'agent_inactive' });
  }
  const { rows } = await req.db.query('SELECT id FROM users WHERE LOWER(username) = $1', [agent.handle]);
  const apiKey = await identity.mintAgentApiKey(req.db, rows[0].id, req.body?.name);
  res.status(201).json({ success: true, apiKey, notice: 'Shown once. Store it now.' });
}));

/** DELETE /api/v2/agents/:handle — retire: unusable immediately, keys revoked. */
router.delete('/:handle', authMiddleware, loadPrincipal, handled('retire', async (req, res) => {
  await identity.retireAgent(req.db, req.principal, req.params.handle);
  res.json({ success: true });
}));

export default router;
