/**
 * /api/v2/shell/sessions — XENO Shell shared-session discovery + signalling.
 * Mounted behind oidcAuth: every caller is a signed-in XENO account. See services/shellSessions.js.
 */
import express from 'express';
import Redis from 'ioredis';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import { RedisSessionStore, ShellSessionDirectory, ShellSessionError, iceServers, mintSessionPass } from '../services/shellSessions.js';

/**
 * The backend runs as several replicas, so the directory MUST be shared: a host and a guest are
 * routinely served by different processes. Same connection pattern as cliAuthRoutes/authRoutes.
 */
function sharedDirectory() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://xenostudio-redis:6379', {
    maxRetriesPerRequest: 3, enableReadyCheck: true, lazyConnect: true,
  });
  redis.on('error', (err) => console.error('[ShellSessions] Redis error:', err.message));
  return new ShellSessionDirectory({ store: new RedisSessionStore(redis) });
}

export function createShellSessionRouter({ directory = sharedDirectory() } = {}) {
  const router = express.Router();
  // A sender-constrained (DPoP) token must prove possession on every call here: a session pass
  // is admission to someone's machine, so a stolen bearer token must not be enough to mint one.
  router.use(requireDpopIfBound);
  const nameOf = (u) => u?.display_name || u?.username || u?.email || 'XENO user';

  const handle = (op) => async (req, res) => {
    try { res.json(await op(req)); }
    catch (e) {
      if (e instanceof ShellSessionError) return res.status(e.status).json({ error: e.code, message: e.message });
      console.error('shell session error:', e);
      res.status(500).json({ error: 'shell_session_failed', message: 'Session service error.' });
    }
  };

  // Rate limit code redemption per user, counted in the shared store so N replicas cannot
  // multiply the allowance: a code is 40 bits, and brute force must stay absurd.
  const limited = async (userId) => (await directory.attempt(userId)) > 10;

  router.post('/', handle(async (req) => {
    const created = await directory.create({ userId: req.user.id, displayName: nameOf(req.user), fingerprint: req.body?.fingerprint });
    const session = await directory.get(created.session_id);
    const pass = await mintSessionPass(req.db, { session, peerId: 'host', userId: req.user.id, displayName: nameOf(req.user), role: 'host' });
    return { ...created, peer_id: 'host', pass, ...(await iceServers()) };
  }));

  router.post('/:id/code', handle(async (req) => directory.rotateCode(req.params.id, req.user.id)));

  router.post('/join', handle(async (req) => {
    if (await limited(req.user.id)) throw new ShellSessionError(429, 'slow_down', 'Too many attempts. Wait a minute.');
    const { session, peerId } = await directory.redeem({ code: req.body?.code, userId: req.user.id, displayName: nameOf(req.user) });
    const pass = await mintSessionPass(req.db, { session, peerId, userId: req.user.id, displayName: nameOf(req.user), role: 'guest' });
    return {
      session_id: session.id, peer_id: peerId, pass,
      host: { name: session.hostName, fingerprint: session.fingerprint },
      ...(await iceServers()),
    };
  }));

  router.post('/:id/signal', handle(async (req) => directory.signal({
    sessionId: req.params.id, fromPeerId: String(req.body?.from || ''), fromUserId: req.user.id,
    toPeerId: String(req.body?.to || ''), message: req.body?.message,
  })));

  router.get('/:id/signal', handle(async (req) => directory.receive({
    sessionId: req.params.id, peerId: String(req.query.peer || ''), userId: req.user.id,
  })));

  router.post('/:id/leave', handle(async (req) => {
    await directory.leave({ sessionId: req.params.id, peerId: String(req.body?.peer || ''), userId: req.user.id });
    return { ok: true };
  }));

  router.get('/ice', handle(async () => iceServers()));

  return router;
}

export default createShellSessionRouter();
