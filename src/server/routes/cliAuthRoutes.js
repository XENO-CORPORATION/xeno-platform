/**
 * XENO CLI Authentication Routes
 * Implements browser flow + device-code flow for the xeno-agent-cli.
 * Spec: CLI_AUTH_CONTRACT.md (sections 1, 5).
 *
 * Mounted at /api/auth/cli/* in /app/index.js with databaseMiddleware.
 * authMiddleware is applied inline only on /complete and /device-code/verify.
 */

import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { siteOrigin } from '../config/hosts.js';

const router = express.Router();

// --------------------------------------------------------------------------
// Redis (separate connection, mirrors authRoutes.js pattern — ioredis is
// connection-multiplexed-safe; the existing /api/auth route already opens its
// own client too, so this is consistent with current platform conventions).
// --------------------------------------------------------------------------
const REDIS_URL = process.env.REDIS_URL || 'redis://xenostudio-redis:6379';
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
});
redis.on('error', (err) => console.error('[CLI-Auth] Redis error:', err.message));
redis.on('connect', () => console.log('[CLI-Auth] Redis connected'));

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';
const WEB_BASE_URL = process.env.WEB_BASE_URL || siteOrigin();

const BROWSER_TTL = 600;        // 10 min
const DEVICE_TTL = 900;         // 15 min
const COMPLETED_TTL = 300;      //  5 min after completion (poll grace window)

const REDIRECT_URI_RE = /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}\/callback$/;
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1

const POLL_INTERVAL_MS = 5_000;
const SLOW_DOWN_THRESHOLD_MS = 2_500; // <half-interval = too aggressive

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------
function randomId() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateUserCode() {
  const len = 8;
  let s = '';
  const buf = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) {
    s += USER_CODE_ALPHABET[buf[i] % USER_CODE_ALPHABET.length];
  }
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

async function generateUniqueUserCode(maxTries = 8) {
  for (let i = 0; i < maxTries; i++) {
    const code = generateUserCode();
    const exists = await redis.exists(`cli:user-code:${code}`);
    if (!exists) return code;
  }
  // Extremely unlikely. Fall through with a final code; collision means earlier
  // session loses, which is fine for this short-lived state.
  return generateUserCode();
}

function generateJwt(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    username: user.username,
  };
}

async function loadUser(db, userId) {
  const r = await db.query(
    `SELECT id, username, email, display_name, avatar_url, is_active
     FROM users WHERE id = $1 AND is_active = true`,
    [userId],
  );
  return r.rows[0] || null;
}

// Inline Bearer-auth — used only on the two endpoints that require it.
async function requireBearer(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'authentication_required' });
    return null;
  }
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    res.status(401).json({ error: 'invalid_token' });
    return null;
  }
  const user = await loadUser(req.db, decoded.userId);
  if (!user) {
    res.status(401).json({ error: 'invalid_token' });
    return null;
  }
  return user;
}

// --------------------------------------------------------------------------
// BROWSER FLOW
// --------------------------------------------------------------------------

// POST /api/auth/cli/start — public
router.post('/start', async (req, res) => {
  try {
    const { redirect_uri, cli_version } = req.body || {};
    if (typeof redirect_uri !== 'string' || !REDIRECT_URI_RE.test(redirect_uri)) {
      return res.status(400).json({ error: 'invalid_redirect_uri' });
    }
    const sessionId = randomId();
    const payload = {
      status: 'pending',
      redirect_uri,
      cli_version: cli_version || null,
      created_at: Date.now(),
    };
    await redis.set(`cli:browser:${sessionId}`, JSON.stringify(payload), 'EX', BROWSER_TTL);
    return res.json({
      session_id: sessionId,
      auth_url: `${WEB_BASE_URL}/cli-auth?session=${sessionId}`,
      expires_in: BROWSER_TTL,
    });
  } catch (err) {
    console.error('[CLI-Auth] /start error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/auth/cli/complete — auth required
router.post('/complete', async (req, res) => {
  const user = await requireBearer(req, res);
  if (!user) return;

  try {
    const { session_id } = req.body || {};
    if (typeof session_id !== 'string' || !session_id) {
      return res.status(400).json({ error: 'invalid_session' });
    }
    const key = `cli:browser:${session_id}`;
    const raw = await redis.get(key);
    if (!raw) {
      // 404 vs 410 — TTL expiry both look like missing keys in Redis.
      // Treat as 404 (matches contract: 404 not_found, 410 expired only when we
      // can prove expiry; without status field, conservative is 404).
      return res.status(404).json({ error: 'not_found' });
    }
    let session;
    try {
      session = JSON.parse(raw);
    } catch {
      return res.status(404).json({ error: 'not_found' });
    }
    if (session.status === 'complete') {
      return res.status(409).json({ error: 'already_completed' });
    }
    if (!REDIRECT_URI_RE.test(session.redirect_uri || '')) {
      return res.status(400).json({ error: 'invalid_redirect_uri' });
    }

    const token = generateJwt(user);
    const updated = {
      status: 'complete',
      redirect_uri: session.redirect_uri,
      token,
      user: publicUser(user),
      completed_at: Date.now(),
    };
    await redis.set(key, JSON.stringify(updated), 'EX', COMPLETED_TTL);

    const sep = session.redirect_uri.includes('?') ? '&' : '?';
    return res.json({
      status: 'ok',
      redirect_uri: `${session.redirect_uri}${sep}session=${encodeURIComponent(session_id)}`,
    });
  } catch (err) {
    console.error('[CLI-Auth] /complete error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/auth/cli/poll?session_id=X — public
router.get('/poll', async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (typeof sessionId !== 'string' || !sessionId) {
      return res.status(400).json({ status: 'not_found' });
    }
    const key = `cli:browser:${sessionId}`;
    const raw = await redis.get(key);
    if (!raw) {
      return res.status(404).json({ status: 'not_found' });
    }
    let session;
    try {
      session = JSON.parse(raw);
    } catch {
      return res.status(404).json({ status: 'not_found' });
    }
    if (session.status === 'complete') {
      // One-shot delivery.
      await redis.del(key);
      return res.json({
        status: 'complete',
        token: session.token,
        user: session.user,
      });
    }
    return res.json({ status: 'pending' });
  } catch (err) {
    console.error('[CLI-Auth] /poll error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/auth/cli/cancel — public, best-effort
router.post('/cancel', async (req, res) => {
  try {
    const { session_id } = req.body || {};
    if (typeof session_id === 'string' && session_id) {
      await redis.del(`cli:browser:${session_id}`);
    }
    return res.json({ status: 'ok' });
  } catch (err) {
    console.error('[CLI-Auth] /cancel error:', err);
    return res.json({ status: 'ok' }); // best-effort
  }
});

// --------------------------------------------------------------------------
// DEVICE-CODE FLOW
// --------------------------------------------------------------------------

// POST /api/auth/cli/device-code — public
router.post('/device-code', async (req, res) => {
  try {
    const { cli_version } = req.body || {};
    const deviceCode = randomId();
    const userCode = await generateUniqueUserCode();
    const payload = {
      status: 'pending',
      user_code: userCode,
      cli_version: cli_version || null,
      created_at: Date.now(),
      last_polled_at: 0,
    };
    await redis.set(`cli:device:${deviceCode}`, JSON.stringify(payload), 'EX', DEVICE_TTL);
    await redis.set(
      `cli:user-code:${userCode}`,
      JSON.stringify({ device_code: deviceCode }),
      'EX',
      DEVICE_TTL,
    );
    return res.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_url: `${WEB_BASE_URL}/cli-auth/device`,
      expires_in: DEVICE_TTL,
      interval: 5,
    });
  } catch (err) {
    console.error('[CLI-Auth] /device-code error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/auth/cli/device-code/verify — auth required
router.post('/device-code/verify', async (req, res) => {
  const user = await requireBearer(req, res);
  if (!user) return;

  try {
    let { user_code } = req.body || {};
    if (typeof user_code !== 'string') {
      return res.status(404).json({ error: 'invalid_code' });
    }
    // Normalize: uppercase, strip whitespace, ensure XXXX-XXXX form
    user_code = user_code.trim().toUpperCase();
    if (/^[A-Z0-9]{8}$/.test(user_code)) {
      user_code = `${user_code.slice(0, 4)}-${user_code.slice(4)}`;
    }
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(user_code)) {
      return res.status(404).json({ error: 'invalid_code' });
    }

    const lookupRaw = await redis.get(`cli:user-code:${user_code}`);
    if (!lookupRaw) {
      return res.status(404).json({ error: 'invalid_code' });
    }
    const { device_code } = JSON.parse(lookupRaw);
    const sessionRaw = await redis.get(`cli:device:${device_code}`);
    if (!sessionRaw) {
      return res.status(410).json({ error: 'expired' });
    }
    const session = JSON.parse(sessionRaw);
    if (session.status === 'complete') {
      return res.status(409).json({ error: 'already_used' });
    }

    const token = generateJwt(user);
    const updated = {
      ...session,
      status: 'complete',
      token,
      user: publicUser(user),
      completed_at: Date.now(),
    };
    await redis.set(`cli:device:${device_code}`, JSON.stringify(updated), 'EX', COMPLETED_TTL);
    // Drop the user-code lookup key — it served its purpose.
    await redis.del(`cli:user-code:${user_code}`);
    return res.json({ status: 'ok' });
  } catch (err) {
    console.error('[CLI-Auth] /device-code/verify error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/auth/cli/device-code/poll — public
router.post('/device-code/poll', async (req, res) => {
  try {
    const { device_code } = req.body || {};
    if (typeof device_code !== 'string' || !device_code) {
      return res.status(410).json({ status: 'expired' });
    }
    const key = `cli:device:${device_code}`;
    const raw = await redis.get(key);
    if (!raw) {
      return res.status(410).json({ status: 'expired' });
    }
    const session = JSON.parse(raw);

    if (session.status === 'complete') {
      // One-shot.
      await redis.del(key);
      // Best-effort cleanup of user-code lookup if it survives.
      if (session.user_code) {
        await redis.del(`cli:user-code:${session.user_code}`);
      }
      return res.json({
        status: 'complete',
        token: session.token,
        user: session.user,
      });
    }

    // slow_down detection — if poll is faster than half the configured interval,
    // signal slow_down and bump last_polled_at.
    const now = Date.now();
    const lastPolled = session.last_polled_at || 0;
    if (lastPolled && now - lastPolled < SLOW_DOWN_THRESHOLD_MS) {
      session.last_polled_at = now;
      // Preserve TTL: PEXPIRE-equivalent via SET EX with remaining ttl.
      const ttl = await redis.ttl(key);
      if (ttl > 0) {
        await redis.set(key, JSON.stringify(session), 'EX', ttl);
      }
      return res.json({ status: 'slow_down' });
    }
    session.last_polled_at = now;
    const ttl = await redis.ttl(key);
    if (ttl > 0) {
      await redis.set(key, JSON.stringify(session), 'EX', ttl);
    }
    return res.json({ status: 'pending' });
  } catch (err) {
    console.error('[CLI-Auth] /device-code/poll error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
