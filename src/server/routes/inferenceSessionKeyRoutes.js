/**
 * /api/v2/inference/session-keys — a short-lived model key for the signed-in person's own agent process.
 * Service and rules: services/inferenceSessionKeys.js. First consumer: XENO Spawn's XENO mode (Claude Code pointed at
 * the XENO API, billed to the person's credits).
 *
 *   POST   /            { ttlMinutes?: 5..720 = 60, label?: ≤64 chars, agentId?: 'agt_<32 hex>', maxSpendMicro?: 1..1e13 }
 *            200 { key: { id, token (shown once), expiresAt, baseUrl, models: { opus, sonnet, haiku }, agentId? } }
 *            400 INVALID_TTL | INVALID_LABEL | INVALID_AGENT | INVALID_MAX_SPEND · 404 AGENT_NOT_FOUND · 403 AGENT_NOT_RUNNABLE | AGENT_PAUSED
 *
 *   `agentId` (2026-10-18): the key runs AS that agent, so its metered usage is attributed to it. The person must hold
 *   the run right on it (its owner, the accountable admin of a company agent, or a granted runner — agentAccess.js).
 *   The person still pays. Without agentId nothing changes. Attribution comes from this server-checked row, never from
 *   a header the client sets on a model call.
 *
 *   `maxSpendMicro` (2026-10-18): the most the key may ever spend, settled plus outstanding holds, in micro-credits.
 *   The ledger refuses a hold that would pass it (402 session_key_budget_exhausted at the gateway). · 401 not signed in · 402 NO_CREDITS · 403 NOT_A_PERSON | INSUFFICIENT_SCOPE
 *            429 SESSION_KEY_LIMIT (5 live) or the rate limit
 *   DELETE /:id         200 { revoked: true, id } · 404 NOT_FOUND (gone, never existed, or not yours)
 *
 * Who may: a PERSON (kind 'human'), signed in. An agent or service principal never mints a key that bills a person;
 * an OIDC token must carry `inference:run` (its client is allowed to run inference for the person). A DPoP-bound
 * token must present its proof.
 *
 * 🔴 The response body carries a live key. Never add this route to a request/response body logger.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { createSessionKey, revokeSessionKey, SessionKeyError } from '../services/inferenceSessionKeys.js';
import { resolvePrincipal } from '../services/agentIdentity.js';
import { getBalanceV2 } from '../utils/creditLedgerV2.js';
import { recordSecurityEventTransactional, EVENTS } from '../services/securityEvents.js';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import { getWith as getAgentWith, AgentError } from '../services/platformAgents.js';

const router = express.Router();

const mintLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, validate: { ip: false },
  message: { error: { code: 'rate_limited', message: 'Too many session keys asked for. Try again in a few minutes.' } },
  keyGenerator: (req) => `session-key:user:${req.user?.id || 'anon'}`,
});

function sendError(res, e) {
  if (e instanceof SessionKeyError) return res.status(e.http).json({ error: { code: e.code, message: e.message } });
  console.error(`[session-keys] unhandled (${e?.code || 'error'})`);   // the code only: a stack can carry the request
  return res.status(500).json({ error: { code: 'PLATFORM_ERROR', message: 'session key request failed' } });
}

/** A person, and (for an OIDC token) one granted inference. Throws the refusal. */
async function requirePerson(req) {
  const principal = await resolvePrincipal(req.db, req.user.id);
  req.sessionKeyPrincipal = principal;
  if (!principal || principal.kind !== 'human' || principal.usable === false) {
    throw new SessionKeyError('Only a person can have a model key for their own session.', 'NOT_A_PERSON', 403);
  }
  if (req.auth?.kind === 'oidc' && !String(req.auth.scope || '').split(/\s+/).includes('inference:run')) {
    throw new SessionKeyError('This sign-in was not granted inference:run.', 'INSUFFICIENT_SCOPE', 403);
  }
}

/** The agent the key will run as, if asked for: one the person may RUN, and not paused. Null when not asked. */
export async function runnableAgent(db, principal, agentId) {
  if (agentId === undefined || agentId === null || agentId === '') return null;
  if (typeof agentId !== 'string' || !/^agt_[0-9a-f]{32}$/.test(agentId)) {
    throw new SessionKeyError('agentId is an agent id of the form agt_<32 hex>.', 'INVALID_AGENT', 400);
  }
  let agent;
  try {
    agent = await getAgentWith(db, principal, agentId, 'runner');
  } catch (e) {
    if (e instanceof AgentError && e.status === 404) throw new SessionKeyError('No such agent.', 'AGENT_NOT_FOUND', 404);
    if (e instanceof AgentError && e.status === 403) throw new SessionKeyError('You may not run this agent.', 'AGENT_NOT_RUNNABLE', 403);
    throw e;
  }
  if (agent.paused || agent.status !== 'active') throw new SessionKeyError('This agent is paused.', 'AGENT_PAUSED', 403);
  return { id: agent.id, userId: agent.userId };
}

async function inTransaction(db, fn) {
  const client = await db.connect();
  try { await client.query('BEGIN'); const out = await fn(client); await client.query('COMMIT'); return out; }
  catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

router.post('/', requireDpopIfBound, mintLimiter, async (req, res) => {
  try {
    await requirePerson(req);
    const balance = await getBalanceV2(req.db, req.user.id);
    if (balance?.is_frozen || Number(balance?.availableMicro ?? balance?.postedMicro ?? 0) <= 0) {
      throw new SessionKeyError('Your XENO credits are used up.', 'NO_CREDITS', 402);
    }
    const agent = await runnableAgent(req.db, req.sessionKeyPrincipal, req.body?.agentId);
    const made = await inTransaction(req.db, async (client) => {
      const out = await createSessionKey(client, req.user, {
        ttlMinutes: req.body?.ttlMinutes, label: req.body?.label, clientId: req.auth?.clientId || null, agent,
        maxSpendMicro: req.body?.maxSpendMicro,
      });
      await recordSecurityEventTransactional(client, EVENTS.SESSION_KEY_ISSUED, { userId: req.user.id, req, metadata: out.audit });
      return out;
    });
    res.set('Cache-Control', 'no-store');
    res.json({ key: made.key });
  } catch (e) { sendError(res, e); }
});

router.delete('/:id', requireDpopIfBound, async (req, res) => {
  try {
    await requirePerson(req);
    const done = await inTransaction(req.db, async (client) => {
      const out = await revokeSessionKey(client, req.user, req.params.id);
      await recordSecurityEventTransactional(client, EVENTS.SESSION_KEY_REVOKED, { userId: req.user.id, req, metadata: { keyId: out.id } });
      return out;
    });
    res.json({ revoked: true, id: done.id });
  } catch (e) { sendError(res, e); }
});

export default router;
