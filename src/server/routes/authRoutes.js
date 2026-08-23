/**
 * XenoStudio Authentication API Routes
 * Production-grade JWT-based authentication with OAuth support
 * Providers: Google, GitHub, Twitter/X
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import fetch from 'node-fetch';
import Redis from 'ioredis';
import { siteOrigin, siteUrl, mailDomain } from '../config/hosts.js';
import { addGrant, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import { deductCredits } from '../utils/creditTransactions.js';
import { sendEmail, sendWelcomeEmail } from '../services/emailService.js';
import { recordSecurityEvent, EVENTS } from '../services/securityEvents.js';
import { clientIp } from '../utils/clientIp.js';
import {
  verifyActivationToken,
  activate as activateAccount,
  isActivated as isAccountActivated,
  mintCode as mintActivationCode,
  verifyCode as verifyActivationCode,
} from '../services/accountActivation.js';
import { describeClient } from '../utils/userAgent.js';
import { optOut } from '../services/emailPreferences.js';
import { resolveOAuthLandingPath } from '../../lib/onboardingHandoff.js';
import {
  requireRegistrationOpen,
  assertRegistrationAllowed,
  assertAccountUsable,
  isRegistrationOpen,
  AccountCreationBlockedError,
  AccountSuspendedError,
} from '../middleware/registrationGate.js';

// Free-tier starter credits granted on signup so new users can try premium generation.
const FREE_SIGNUP_CREDITS = Number(process.env.FREE_SIGNUP_CREDITS || 50);

const router = express.Router();

// ============================================
// REDIS CONNECTION (Production)
// ============================================
// Use REDIS_URL from env, or fallback to Docker service name, or localhost for dev
const REDIS_URL = process.env.REDIS_URL || 'redis://xenostudio-redis:6379';
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  enableReadyCheck: true,
  lazyConnect: true
});

redis.on('error', (err) => console.error('Redis OAuth Error:', err.message));
redis.on('connect', () => console.log('✅ Redis connected for OAuth state management'));

// OAuth state TTL (10 minutes)
const OAUTH_STATE_TTL = 600;

// ============================================
// OAUTH CONFIGURATION
// ============================================
const OAUTH_CONFIG = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: ['openid', 'email', 'profile'],
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || siteUrl('/api/auth/google/callback')
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    userEmailsUrl: 'https://api.github.com/user/emails',
    scopes: ['user:email', 'read:user'],
    callbackUrl: process.env.GITHUB_CALLBACK_URL || siteUrl('/api/auth/github/callback')
  },
  twitter: {
    clientId: process.env.TWITTER_CLIENT_ID,
    clientSecret: process.env.TWITTER_CLIENT_SECRET,
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    userInfoUrl: 'https://api.twitter.com/2/users/me',
    scopes: ['users.read', 'tweet.read', 'offline.access'],
    callbackUrl: process.env.TWITTER_CALLBACK_URL || siteUrl('/api/auth/twitter/callback')
  }
};

// Frontend URL for redirects after OAuth
const FRONTEND_URL = process.env.AUTH_FRONTEND_URL || siteOrigin();

// Helper: build OAuth redirect URL
function buildOAuthRedirectUrl(returnUrl, token, isNew) {
  const dest = resolveOAuthLandingPath(returnUrl, isNew);
  if (dest.startsWith("xeno://")) {
    const sep = dest.includes("?") ? "&" : "?";
    return `${dest}${sep}token=${token}&isNew=${isNew}`;
  }
  // Respect any existing query string on dest (e.g. /cli-auth?session=XXX).
  const sep = dest.includes("?") ? "&" : "?";
  return `${FRONTEND_URL}${dest}${sep}token=${token}&isNew=${isNew}`;
}

// For desktop app: serve an HTML page that triggers the deep link
// Browsers block 302 redirects to custom protocols (xeno://)
function handleOAuthRedirect(res, returnUrl, token, isNew) {
  const targetUrl = buildOAuthRedirectUrl(returnUrl, token, isNew);
  if (returnUrl && returnUrl.startsWith("xeno://")) {
    res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Redirecting to XENO...</title>
<meta http-equiv="refresh" content="0;url=${targetUrl}">
<style>body{background:#08080a;color:#fff;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.c{text-align:center}.s{width:20px;height:20px;border:2px solid rgba(255,255,255,0.1);border-top-color:rgba(255,255,255,0.5);border-radius:50%;animation:s .6s linear infinite;margin:16px auto}
@keyframes s{to{transform:rotate(360deg)}}p{color:rgba(255,255,255,0.4);font-size:13px;margin-top:12px}a{color:rgba(255,255,255,0.6)}</style>
</head><body><div class="c"><div class="s"></div><p>Opening XENO Desktop...</p>
<p style="margin-top:24px"><a href="${targetUrl}">Click here if the app didn&apos;t open</a></p></div>
</body></html>`);
  } else {
    res.redirect(targetUrl);
  }
}

// ============================================
// OAUTH HELPER FUNCTIONS
// ============================================

// Generate cryptographically secure state token
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

// Generate PKCE code verifier for Twitter OAuth 2.0
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

// Generate PKCE code challenge from verifier
function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// Store OAuth state in Redis
async function storeOAuthState(state, data) {
  await redis.setex(`oauth:state:${state}`, OAUTH_STATE_TTL, JSON.stringify(data));
}

// Get and delete OAuth state from Redis (one-time use)
async function consumeOAuthState(state) {
  const key = `oauth:state:${state}`;
  const data = await redis.get(key);
  if (data) {
    await redis.del(key);
    return JSON.parse(data);
  }
  return null;
}

// Find or create user from OAuth profile
async function findOrCreateOAuthUser(db, provider, profile, req = null) {
  const { id: providerId, email, name, avatar, username } = profile;

  // First, check if this OAuth account is already linked
  const existingOAuth = await db.query(
    'SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2',
    [provider, providerId]
  );

  if (existingOAuth.rows.length > 0) {
    // Get the linked user
    const userResult = await db.query(
      `SELECT id, username, email, display_name, avatar_url, created_at,
              email_verified, is_active, credits, bonus_credits_claimed, status, role, plan
       FROM users WHERE id = $1`,
      [existingOAuth.rows[0].user_id]
    );

    if (userResult.rows.length > 0) {
      // Suspended accounts must be refused HERE. Password login has always
      // checked is_active, but this path did not — it went straight to
      // issueSessionToken, so an is_active=false suspension was unenforced for
      // every OAuth account. Assert before touching last_login: a refused
      // attempt is not a login and must not be recorded as one.
      assertAccountUsable(userResult.rows[0]);
      // Update last login
      await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [userResult.rows[0].id]);
      return { user: userResult.rows[0], isNew: false };
    }
  }

  // Check if user exists with this email
  let user = null;
  if (email) {
    const emailResult = await db.query(
      `SELECT id, username, email, display_name, avatar_url, created_at,
              email_verified, is_active, credits, bonus_credits_claimed, status, role, plan
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (emailResult.rows.length > 0) {
      // Same guard on the email-match branch: an OAuth sign-in that resolves to
      // an existing suspended account by email must be refused too, or the
      // suspension is bypassable by linking a provider.
      assertAccountUsable(emailResult.rows[0]);
      user = emailResult.rows[0];
    }
  }

  // Create new user if doesn't exist
  let isNew = false;
  if (!user) {
    // The third account-creation path. A one-click "Sign in with Google" creates
    // a fully verified account here with no form and no friction — it is how 160
    // of 218 accounts arrived. Gating only the two /register endpoints would
    // leave this wide open.
    assertRegistrationAllowed(email);

    const userId = uuidv4();
    const generatedUsername = username || email?.split('@')[0] || `user_${providerId.substring(0, 8)}`;

    // Check if username exists, if so, append random suffix
    let finalUsername = generatedUsername.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const usernameCheck = await db.query('SELECT id FROM users WHERE username = $1', [finalUsername]);
    if (usernameCheck.rows.length > 0) {
      finalUsername = `${finalUsername}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // OAuth users don't use password login initially, but schema requires password_hash
    const oauthPlaceholderPassword = crypto.randomBytes(32).toString('hex');
    const oauthPasswordHash = await hashPassword(oauthPlaceholderPassword);

    const insertResult = await db.query(
      `INSERT INTO users (id, username, email, password_hash, display_name, avatar_url, email_verified, is_active, status, role, plan, credits, bonus_credits_claimed, workspace_activated_at, created_at, updated_at, last_login)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW(), NOW(), NOW())
       RETURNING id, username, email, display_name, avatar_url, created_at, email_verified, is_active, credits, bonus_credits_claimed, status, role, plan`,
      [userId, finalUsername, email?.toLowerCase(), oauthPasswordHash, name || finalUsername, avatar, true, true, 'active', 'user', 'free', 0, false]
    );

    user = insertResult.rows[0];
    isNew = true;
    // The OAuth path is the majority path — 160 of 221 accounts were created here —
    // so an onboarding email wired only into /register would miss most new users.
    sendWelcomeEmail(db, user);
  } else {
    // Update last login for existing user
    await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
  }

  // Link OAuth account to user (upsert)
  await db.query(
    `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email, provider_username, provider_avatar_url, provider_name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     ON CONFLICT (provider, provider_user_id) DO UPDATE SET
       provider_email = EXCLUDED.provider_email,
       provider_username = EXCLUDED.provider_username,
       provider_avatar_url = EXCLUDED.provider_avatar_url,
       provider_name = EXCLUDED.provider_name,
       updated_at = NOW()`,
    [user.id, provider, providerId, email, username, avatar, name]
  );

  // Log security event
  try {
    await db.query(
      `INSERT INTO security_events (user_id, event_type, metadata, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        user.id,
        isNew ? 'oauth_signup' : 'oauth_login',
        JSON.stringify({ provider, providerId }),
        // These columns existed and were never written, so 160 oauth_signup rows
        // carry no address and no client. A signup record that cannot say where it
        // came from is not an audit trail.
        req ? clientIp(req) : null,
        req ? req.get('User-Agent') : null,
      ]
    );
  } catch (e) {
    console.log('Could not log security event:', e.message);
  }

  return { user, isNew };
}

// Thin wrapper: guarantees `req` reaches findOrCreateOAuthUser so the signup's
// IP and user-agent are recorded. Every OAuth callback must go through this.
async function findOrCreateOAuthUserWithReq(req, provider, profile) {
  return findOrCreateOAuthUser(req.db, provider, profile, req);
}

// JWT secret key (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Hash password utility
async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

// Verify password utility
async function verifyPassword(password, hashedPassword) {
  return await bcrypt.compare(password, hashedPassword);
}

// Generate JWT token. When `sid` is provided the token is SESSION-BACKED: it is
// only valid while its user_sessions row (id = sid) exists, so logout/password
// reset/account deletion can revoke it instantly (see resolveAuthedUser).
function generateToken(user, sid) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      username: user.username,
      ...(sid ? { sid } : {})
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// Frontend base URL for account-recovery / verification links in emails.
const APP_URL = (process.env.APP_BASE_URL || process.env.FRONTEND_URL || siteOrigin()).replace(/\/+$/, '');

// Hash a high-entropy account token (password-reset / email-verification) for at-rest
// storage. sha256 is correct here — the token is 256-bit random, not a low-entropy
// password — and keeps lookup a single indexed equality instead of a per-row bcrypt scan.
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}
// A URL-safe 256-bit single-use token; only its hash is ever persisted.
function newAccountToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Issue a session-backed JWT: mint sid, sign the token with it, and record the
// session row (id = sid, token_hash = sha256(jwt) — NEVER the plaintext JWT).
// If the session write fails we fall back LOUDLY to a stateless (no-sid) token so
// login still succeeds — a sid token without its row would be dead on arrival.
async function issueSessionToken(db, user, req) {
  const sid = uuidv4();
  const token = generateToken(user, sid);
  try {
    // device_type / browser / os are columns that have existed since the baseline
    // and were NEVER written, so every session row in production is blank in all
    // three and the "your devices" list cannot name a device. Derived here from the
    // User-Agent we are already storing — no new data is collected.
    const ua = req.get('User-Agent');
    const client = describeClient(ua);
    await db.query(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent, device_type, browser, os)
       VALUES ($1, $2, $3, NOW() + INTERVAL '7 days', $4, $5, $6, $7, $8)`,
      // clientIp(req), not req.ip: `trust proxy` is set and req.ip STILL resolved to
      // the Docker bridge gateway for every real session ever recorded here.
      [sid, user.id, hashToken(token), clientIp(req), ua, client.deviceType, client.browser, client.os]
    );
    return token;
  } catch (sessionError) {
    console.error('[auth] SESSION WRITE FAILED — issuing stateless fallback token (revocation unavailable for it):', sessionError.message);
    return generateToken(user); // legacy stateless token; ages out in <= JWT_EXPIRES_IN
  }
}

// Is a decoded sid-token's session gone/expired? Legacy tokens (no sid) are never
// "revoked" here — they keep the old stateless behavior until they age out.
async function sessionRevoked(db, decoded) {
  if (!decoded?.sid) return false;
  const r = await db.query(
    'SELECT 1 FROM user_sessions WHERE id = $1 AND user_id = $2 AND expires_at > NOW()',
    [decoded.sid, decoded.userId]
  );
  return r.rows.length === 0;
}

// SECURITY: /init and /migrate mutate the schema and (re)seed the default admin account.
// In production they must be gated behind a shared setup secret so they are not
// world-callable; in dev they stay open for convenience. Returns false (and sends 403)
// when the caller is not authorized.
function requireSetupToken(req, res) {
  if (process.env.NODE_ENV !== 'production') return true;
  const expected = process.env.SETUP_TOKEN;
  const provided = req.headers['x-setup-token'] || req.body?.setupToken;
  if (!expected || provided !== expected) {
    res.status(403).json({ success: false, error: 'Forbidden' });
    return false;
  }
  return true;
}

// SECURITY: never seed the admin account with a hardcoded default password in production.
// Requires ADMIN_PASSWORD to be set; returns null (and sends 400) if it is missing in prod.
function resolveAdminPassword(req, res) {
  const pw = process.env.ADMIN_PASSWORD;
  if (pw) return pw;
  if (process.env.NODE_ENV === 'production') {
    res.status(400).json({
      success: false,
      error: 'ADMIN_PASSWORD must be set before initializing the admin account.',
    });
    return null;
  }
  return 'xenostudio123'; // dev-only convenience default
}

// POST /api/auth/init - Initialize database tables
router.post('/init', async (req, res) => {
  try {
    if (!requireSetupToken(req, res)) return;
    const adminUserId = '9bcd1624-e26b-46ec-81f5-17d9b575c992';
    const adminEmail = 'admin@xenostudio.local';
    const legacyAdminEmail = 'admin@xenostudio.ai';

    // Create users table
    await req.db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        avatar_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP,
        email_verified BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        reset_token VARCHAR(255),
        reset_token_expires TIMESTAMP
      )
    `);

    // Add missing columns to existing users table if they don't exist
    try {
      await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP`);
      await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`);
      await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`);
      await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`);
      await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255)`);
      await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP`);
    } catch (error) {
      console.log('Note: Some columns may already exist in users table');
    }

    // user_sessions schema is owned by database/migrations/ (baseline +
    // 20260719010000-unify-user-sessions.sql) — runAllMigrations applies it at boot,
    // fail-closed, before this route is reachable. No inline DDL here (the previous
    // inline CREATE drifted from the migration schema and made one writer always fail).

    // Check if default admin user exists
    const adminCheck = await req.db.query(
      'SELECT id FROM users WHERE id = $1 OR email IN ($2, $3)',
      [adminUserId, adminEmail, legacyAdminEmail]
    );
    
    // Create/update default admin user with stable ID and credentials
    const adminPasswordPlain = resolveAdminPassword(req, res);
    if (adminPasswordPlain === null) return;
    const adminPassword = await hashPassword(adminPasswordPlain);
    await req.db.query(`
      INSERT INTO users (id, username, email, password_hash, display_name, email_verified, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        password_hash = EXCLUDED.password_hash,
        display_name = EXCLUDED.display_name,
        email_verified = EXCLUDED.email_verified,
        is_active = EXCLUDED.is_active
    `, [adminUserId, 'admin', adminEmail, adminPassword, 'XenoStudio Admin', true, true]);

    // In non-production, ADMIN_PASSWORD may be unset (dev default used above).
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('⚠️  Using the dev default admin password. Set ADMIN_PASSWORD before any production init.');
    }

    res.json({
      success: true,
      message: 'Database initialized successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Database initialization error:', error);
    res.status(500).json({
      success: false,
      error: 'Database initialization failed',
      // SECURITY: error.message not exposed to clients
    });
  }
});

// POST /api/auth/register - Register new user
router.post('/register', requireRegistrationOpen, async (req, res) => {
  try {
    const { username, email, password, display_name } = req.body;

    // Validation
    if (!username || !email || !password || !display_name) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long'
      });
    }

    // Check if user already exists
    const existingUser = await req.db.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email.toLowerCase(), username.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'User with this email or username already exists'
      });
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const userId = uuidv4();

    const result = await req.db.query(`
      INSERT INTO users (id, username, email, password_hash, display_name, credits, bonus_credits_claimed, workspace_activated_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
      RETURNING id, username, email, display_name, avatar_url, created_at, email_verified, is_active, credits, bonus_credits_claimed
    `, [userId, username.toLowerCase(), email.toLowerCase(), passwordHash, display_name, 0, false]);

    const user = result.rows[0];
    sendWelcomeEmail(req.db, user);

    // Grant Free-tier starter credits (kind:'free' → drawn down before paid credits)
    // so a new user can actually try premium generation. Non-fatal on failure.
    if (FREE_SIGNUP_CREDITS > 0) {
      try {
        // Per-user idempotency key. A constant 'signup' ref collided on uq_credit_txn_ref
        // for EVERY user after the first (the grant threw and was silently swallowed here),
        // so only the very first account ever registered actually received signup credits.
        await addGrant(req.db, user.id, { amountMicro: FREE_SIGNUP_CREDITS * MICRO_PER_CREDIT, kind: 'free', sourceRef: `signup:${user.id}` });
        user.credits = FREE_SIGNUP_CREDITS;
      } catch (grantErr) {
        console.warn('[register] signup credit grant failed:', grantErr.message);
      }
    }

    // Session-backed token (sid claim + user_sessions row; plaintext JWT never stored).
    const token = await issueSessionToken(req.db, user, req);

    // Issue an email-verification token + send the verification email. Non-fatal: a
    // mail-transport hiccup must never fail an otherwise-successful registration, and
    // verification is soft (never blocks login) so a missed email can't lock a user out.
    try {
      const verifyToken = newAccountToken();
      await req.db.query(
        `INSERT INTO email_verifications (user_id, email, token_hash, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')`,
        [user.id, user.email, hashToken(verifyToken)]
      );
      await sendEmail(req.db, 'email_verification', user.email, {
        displayName: user.display_name || user.email,
        verifyUrl: `${APP_URL}/verify-email?token=${verifyToken}`,
        expiresIn: '24 hours',
      }, user.id);
    } catch (verifyErr) {
      console.warn('[register] verification email failed:', verifyErr.message);
    }

    res.status(201).json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        created_at: user.created_at,
        email_verified: user.email_verified,
        is_active: user.is_active,
        credits: user.credits,
        bonus_credits_claimed: user.bonus_credits_claimed
      },
      token,
      message: 'User registered successfully'
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed',
      // SECURITY: error.message not exposed to clients
    });
  }
});

// POST /api/auth/login - User login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const normalizedEmail = email.toLowerCase();
    const emailCandidates = normalizedEmail === 'admin@xenostudio.local'
      ? ['admin@xenostudio.local', 'admin@xenostudio.ai']
      : [normalizedEmail];

    // XENO handle unification: the identifier may also be the user's handle or
    // their @<MAIL_PRIMARY_DOMAIN> address (handle = login = identity = mailbox).
    const loginDomain = mailDomain();
    let handleCandidate = null;
    if (!normalizedEmail.includes('@')) {
      handleCandidate = normalizedEmail; // bare handle
    } else if (normalizedEmail.endsWith(`@${loginDomain}`)) {
      handleCandidate = normalizedEmail.slice(0, -(`@${loginDomain}`.length)); // you@<mail domain>
    }

    // Find user by email OR handle
    const result = await req.db.query(`
      SELECT id, username, email, password_hash, display_name, avatar_url,
             created_at, email_verified, is_active, last_login, credits, bonus_credits_claimed
      FROM users
      WHERE email = ANY($1::text[])
         OR ($2::text IS NOT NULL AND lower(username) = $2::text)
      LIMIT 1
    `, [emailCandidates, handleCandidate]);

    if (result.rows.length === 0) {
      // userId stays null — we do not know who this was, and inventing an id to make
      // the row look complete would be worse than an honest null. The address goes in
      // metadata so a credential-stuffing run against many addresses is still visible.
      await recordSecurityEvent(req.db, EVENTS.LOGIN_FAILED, {
        req, metadata: { reason: 'unknown_account', attemptedEmail: normalizedEmail },
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const user = result.rows[0];

    // Check if user is active
    if (!user.is_active) {
      // Distinct from a wrong password: this is a suspended account being used, which
      // is exactly the signal you want when reviewing a suspension.
      await recordSecurityEvent(req.db, EVENTS.ACCOUNT_SUSPENDED_BLOCKED, {
        userId: user.id, req, metadata: { method: 'password' },
      });
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated'
      });
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      await recordSecurityEvent(req.db, EVENTS.LOGIN_FAILED, {
        userId: user.id, req, metadata: { reason: 'bad_password' },
      });
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Update last login
    await req.db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    await recordSecurityEvent(req.db, EVENTS.LOGIN, { userId: user.id, req, metadata: { method: 'password' } });

    // Session-backed token (sid claim + user_sessions row; plaintext JWT never stored).
    const token = await issueSessionToken(req.db, user, req);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        created_at: user.created_at,
        email_verified: user.email_verified,
        is_active: user.is_active,
        credits: user.credits,
        bonus_credits_claimed: user.bonus_credits_claimed
      },
      token,
      message: 'Login successful'
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
      // SECURITY: error.message not exposed to clients
    });
  }
});

// ============================================
// PASSWORD RESET
// ============================================

// POST /api/auth/forgot-password — issue a reset link.
// Always responds 200 with the same generic message, whether or not the account
// exists, so the endpoint can't be used to enumerate registered emails.
router.post('/forgot-password', async (req, res) => {
  const generic = {
    success: true,
    message: 'If an account exists for that email, a password reset link is on its way.',
  };
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const { rows } = await req.db.query(
      'SELECT id, email, display_name, password_hash, is_active FROM users WHERE email = $1 LIMIT 1',
      [normalizedEmail]
    );
    const user = rows[0];
    // Only issue a reset for an active, password-capable account (OAuth-only users have
    // no password_hash). Every other case returns the identical generic response.
    if (user && user.is_active && user.password_hash) {
      const resetToken = newAccountToken();
      await req.db.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [user.id, hashToken(resetToken)]
      );
      await sendEmail(req.db, 'password_reset', user.email, {
        displayName: user.display_name || user.email,
        resetUrl: `${APP_URL}/reset-password?token=${resetToken}`,
        expiresIn: '1 hour',
      }, user.id);
    }
    return res.json(generic);
  } catch (error) {
    // Log server-side but still return the generic 200 — surfacing a 500 here would
    // leak that the address matched a real, erroring account.
    console.error('Forgot-password error:', error.message);
    return res.json(generic);
  }
});

// POST /api/auth/reset-password — consume a reset token and set a new password.
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ success: false, error: 'Token and new password are required' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long' });
    }
    // Atomic single-use claim: only an unused, unexpired token flips to used_at and
    // returns its user, so two concurrent submits can't both reset.
    const claim = await req.db.query(
      `UPDATE password_resets SET used_at = NOW()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [hashToken(token)]
    );
    if (claim.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'This reset link is invalid or has expired. Please request a new one.',
      });
    }
    const userId = claim.rows[0].user_id;
    const passwordHash = await hashPassword(password);
    await req.db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, userId]);
    // Security: a reset revokes every existing session (a compromised session must not
    // survive the recovery) and burns any other outstanding reset tokens for this user.
    await req.db.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]).catch((e) => {
      console.error('[auth] reset-password session revocation failed:', e.message);
    });
    await req.db.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [userId]).catch(() => {});
    return res.json({ success: true, message: 'Your password has been reset. You can now sign in with your new password.' });
  } catch (error) {
    console.error('Reset-password error:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
});

// ============================================
// EMAIL VERIFICATION (soft — never blocks login)
// ============================================

// POST /api/auth/verify-email — consume an email-verification token.
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ success: false, error: 'Verification token is required' });
    const claim = await req.db.query(
      `UPDATE email_verifications SET verified_at = NOW()
       WHERE token_hash = $1 AND verified_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [hashToken(token)]
    );
    if (claim.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'This verification link is invalid or has expired.' });
    }
    await req.db.query('UPDATE users SET email_verified = true WHERE id = $1', [claim.rows[0].user_id]);
    return res.json({ success: true, message: 'Your email has been verified.' });
  } catch (error) {
    console.error('Verify-email error:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to verify email' });
  }
});

// POST /api/auth/resend-verification — re-issue a verification email for the logged-in user.
router.post('/resend-verification', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'No token provided' });
    let decoded;
    try { decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); }
    catch { return res.status(401).json({ success: false, error: 'Invalid token' }); }
    if (await sessionRevoked(req.db, decoded)) {
      return res.status(401).json({ success: false, error: 'Session expired or revoked' });
    }

    const { rows } = await req.db.query(
      'SELECT id, email, display_name, email_verified FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ success: false, error: 'Invalid token' });
    if (user.email_verified) return res.json({ success: true, message: 'Your email is already verified.' });

    const verifyToken = newAccountToken();
    await req.db.query(
      `INSERT INTO email_verifications (user_id, email, token_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')`,
      [user.id, user.email, hashToken(verifyToken)]
    );
    await sendEmail(req.db, 'email_verification', user.email, {
      displayName: user.display_name || user.email,
      verifyUrl: `${APP_URL}/verify-email?token=${verifyToken}`,
      expiresIn: '24 hours',
    }, user.id);
    return res.json({ success: true, message: 'Verification email sent.' });
  } catch (error) {
    console.error('Resend-verification error:', error.message);
    return res.status(500).json({ success: false, error: 'Failed to resend verification email' });
  }
});

// GET /api/auth/validate - Validate current session
router.get('/validate', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (await sessionRevoked(req.db, decoded)) {
      return res.status(401).json({ success: false, error: 'Session expired or revoked' });
    }
    
    // Get user from database
    const result = await req.db.query(`
      SELECT id, username, email, display_name, avatar_url, 
             created_at, email_verified, is_active, credits, bonus_credits_claimed
      FROM users 
      WHERE id = $1 AND is_active = true
    `, [decoded.userId]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        created_at: user.created_at,
        email_verified: user.email_verified,
        is_active: user.is_active,
        credits: user.credits,
        bonus_credits_claimed: user.bonus_credits_claimed
      },
      message: 'Token is valid'
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired'
      });
    }
    
    console.error('Token validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Token validation failed',
      // SECURITY: error.message not exposed to clients
    });
  }
});

// POST /api/auth/logout - Logout (invalidate session)
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (token) {
      // The old code did `bcrypt.hash(token)` and looked that up — bcrypt hashes are
      // salted, so the lookup NEVER matched and logout was a guaranteed no-op.
      // Now: a sid-token deletes its own session row (instant revocation, enforced by
      // resolveAuthedUser); anything else falls back to the sha256(token) lookup.
      let decoded = null;
      try { decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); } catch { /* fall through */ }
      if (decoded?.sid) {
        await req.db.query(
          'DELETE FROM user_sessions WHERE id = $1 AND user_id = $2',
          [decoded.sid, decoded.userId]
        );
      } else {
        await req.db.query('DELETE FROM user_sessions WHERE token_hash = $1', [hashToken(token)]);
      }
      // A logout is half of every session's story. Without it you can see sign-ins
      // and never tell a session that ended from one still open — which is exactly
      // the question asked when reviewing a compromise.
      await recordSecurityEvent(req.db, EVENTS.LOGOUT, {
        userId: decoded?.userId || null, req, metadata: { bySid: Boolean(decoded?.sid) },
      });
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  }
});

// POST /api/auth/migrate - Migrate existing user table and create necessary tables
router.post('/migrate', async (req, res) => {
  try {
    if (!requireSetupToken(req, res)) return;
    const adminPasswordPlain = resolveAdminPassword(req, res);
    if (adminPasswordPlain === null) return;
    console.log('🔧 Starting database migration for authentication system...');
    const adminUserId = '9bcd1624-e26b-46ec-81f5-17d9b575c992';
    const adminEmail = 'admin@xenostudio.local';
    const legacyAdminEmail = 'admin@xenostudio.ai';

    // Step 1: user_sessions schema is owned by database/migrations/ — this route
    // previously did `DROP TABLE IF EXISTS user_sessions` and recreated it, which
    // destroyed every live session on a world-reachable(-behind-setup-token) endpoint.
    // The route is now strictly ADDITIVE: no DROPs, ever.

    // Step 2: Add missing columns to existing users table (additive-only)
    await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP`);
    await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`);
    await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`);
    await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`);
    await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255)`);
    await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP`);
    console.log('✅ User table columns added/verified');

    // Step 3: Check if admin user exists and update/create it
    const adminCheck = await req.db.query(
      'SELECT id FROM users WHERE id = $1 OR email IN ($2, $3)',
      [adminUserId, adminEmail, legacyAdminEmail]
    );
    
    if (adminCheck.rows.length === 0) {
      // Create new admin user
      const adminPasswordHash = await hashPassword(adminPasswordPlain);
      
      await req.db.query(`
        INSERT INTO users (id, username, email, password_hash, display_name, email_verified, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET 
          username = EXCLUDED.username,
          password_hash = EXCLUDED.password_hash,
          display_name = EXCLUDED.display_name,
          email_verified = EXCLUDED.email_verified,
          is_active = EXCLUDED.is_active
      `, [adminUserId, 'admin', adminEmail, adminPasswordHash, 'XenoStudio Admin', true, true]);
      console.log('✅ Admin user created');
    } else {
      // Update existing admin user with hashed password
      const adminPasswordHash = await hashPassword(adminPasswordPlain);
      await req.db.query(`
        UPDATE users 
        SET password_hash = $1, email_verified = true, is_active = true, username = 'admin', display_name = 'XenoStudio Admin'
        WHERE id = $2 OR email IN ($3, $4)
      `, [adminPasswordHash, adminUserId, adminEmail, legacyAdminEmail]);
      console.log('✅ Admin user updated');
    }

    res.json({
      success: true,
      message: 'Database migration completed successfully'
    });

  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      // SECURITY: error.message not exposed to clients
    });
  }
});

// GET /api/auth/me - Get current user profile
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (await sessionRevoked(req.db, decoded)) {
      return res.status(401).json({ success: false, error: 'Session expired or revoked' });
    }
    
    const result = await req.db.query(`
      SELECT id, username, email, display_name, avatar_url, 
             created_at, last_login, email_verified, is_active, credits, bonus_credits_claimed
      FROM users 
      WHERE id = $1
    `, [decoded.userId]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        created_at: user.created_at,
        last_login: user.last_login,
        email_verified: user.email_verified,
        is_active: user.is_active,
        credits: user.credits,
        bonus_credits_claimed: user.bonus_credits_claimed
      }
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }
    
    console.error('Profile fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user profile',
      // SECURITY: error.message not exposed to clients
    });
  }
});

// PUT /api/auth/profile - Update user profile
router.put('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (await sessionRevoked(req.db, decoded)) {
      return res.status(401).json({ success: false, error: 'Session expired or revoked' });
    }
    const { display_name, username, avatar_url } = req.body;

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (display_name !== undefined) {
      updates.push(`display_name = $${paramCount}`);
      values.push(display_name);
      paramCount++;
    }

    if (username !== undefined) {
      // Check if username is already taken
      const existingUser = await req.db.query(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [username.toLowerCase(), decoded.userId]
      );
      if (existingUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Username is already taken'
        });
      }
      updates.push(`username = $${paramCount}`);
      values.push(username.toLowerCase());
      paramCount++;
    }

    if (avatar_url !== undefined) {
      updates.push(`avatar_url = $${paramCount}`);
      values.push(avatar_url);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No fields to update'
      });
    }

    updates.push(`updated_at = NOW()`);
    values.push(decoded.userId);

    const result = await req.db.query(`
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, username, email, display_name, avatar_url, created_at, email_verified, is_active, credits, bonus_credits_claimed
    `, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        created_at: user.created_at,
        email_verified: user.email_verified,
        is_active: user.is_active,
        credits: user.credits,
        bonus_credits_claimed: user.bonus_credits_claimed
      },
      message: 'Profile updated successfully'
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    console.error('Profile update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile',
      // SECURITY: error.message not exposed to clients
    });
  }
});

// PUT /api/auth/password - Change password
router.put('/password', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (await sessionRevoked(req.db, decoded)) {
      return res.status(401).json({ success: false, error: 'Session expired or revoked' });
    }
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters long'
      });
    }

    // Get current user with password hash
    const userResult = await req.db.query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = userResult.rows[0];

    // Verify current password
    const passwordValid = await verifyPassword(current_password, user.password_hash);
    if (!passwordValid) {
      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Hash new password and update
    const newPasswordHash = await hashPassword(new_password);
    await req.db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newPasswordHash, decoded.userId]
    );

    // Security: a password change revokes EVERY session (incl. this one) — any
    // stolen sid-token dies here. The client must sign in again with the new password.
    await req.db.query('DELETE FROM user_sessions WHERE user_id = $1', [decoded.userId]).catch((e) => {
      console.error('[auth] password-change session revocation failed:', e.message);
    });

    res.json({
      success: true,
      message: 'Password changed successfully. Please sign in again.'
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    console.error('Password change error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password',
      // SECURITY: error.message not exposed to clients
    });
  }
});

// GET /api/auth/usage - Get usage statistics
router.get('/usage', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (await sessionRevoked(req.db, decoded)) {
      return res.status(401).json({ success: false, error: 'Session expired or revoked' });
    }

    // Get user credits info
    const userResult = await req.db.query(
      'SELECT id, credits, bonus_credits_claimed, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = userResult.rows[0];

    // Get usage history from credit_usage table if it exists
    let usageHistory = [];
    try {
      const usageResult = await req.db.query(`
        SELECT feature, credits_used, created_at
        FROM credit_usage
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `, [decoded.userId]);
      usageHistory = usageResult.rows;
    } catch (e) {
      // Table might not exist yet, that's okay
      console.log('credit_usage table not found, returning empty history');
    }

    // Calculate usage statistics
    const totalCreditsEarned = user.bonus_credits_claimed ? 1000 : 0;
    const creditsUsed = totalCreditsEarned - (user.credits || 0);

    res.json({
      success: true,
      usage: {
        current_credits: user.credits || 0,
        total_credits_earned: totalCreditsEarned,
        credits_used: creditsUsed > 0 ? creditsUsed : 0,
        bonus_claimed: user.bonus_credits_claimed,
        member_since: user.created_at,
        history: usageHistory
      }
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    console.error('Usage fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch usage data',
      // SECURITY: error.message not exposed to clients
    });
  }
});

// POST /api/auth/use-credits - Deduct credits for a feature
router.post('/use-credits', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (await sessionRevoked(req.db, decoded)) {
      return res.status(401).json({ success: false, error: 'Session expired or revoked' });
    }
    const { feature, amount } = req.body;

    if (!feature || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Feature and positive amount are required'
      });
    }

    // Deduct via the canonical v2 ledger (mirrors users.credits). Was: a direct
    // `UPDATE users SET credits = credits - n`, which drifted the mirror below the ledger.
    const debit = await deductCredits(req.db, decoded.userId, amount, { surface: 'feature', operation: String(feature) });
    if (!debit.success) {
      return res.status(400).json({
        success: false,
        error: debit.error || 'Insufficient credits',
        current_credits: debit.currentCredits ?? 0,
        required: amount,
      });
    }
    const updateResult = { rows: [{ credits: debit.newBalance }] };

    // Log usage (create table if needed)
    try {
      await req.db.query(`
        CREATE TABLE IF NOT EXISTS credit_usage (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL,
          feature VARCHAR(100) NOT NULL,
          credits_used INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await req.db.query(
        'INSERT INTO credit_usage (user_id, feature, credits_used) VALUES ($1, $2, $3)',
        [decoded.userId, feature, amount]
      );
    } catch (e) {
      console.log('Could not log credit usage:', e.message);
    }

    res.json({
      success: true,
      message: 'Credits deducted successfully',
      credits_used: amount,
      remaining_credits: updateResult.rows[0].credits
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    console.error('Credit usage error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to use credits',
      // SECURITY: error.message not exposed to clients
    });
  }
});

// DELETE /api/auth/account - Delete user account
router.delete('/account', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (await sessionRevoked(req.db, decoded)) {
      return res.status(401).json({ success: false, error: 'Session expired or revoked' });
    }
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required to delete account'
      });
    }

    // Get user and verify password
    const userResult = await req.db.query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = userResult.rows[0];
    const passwordValid = await verifyPassword(password, user.password_hash);

    if (!passwordValid) {
      return res.status(400).json({
        success: false,
        error: 'Incorrect password'
      });
    }

    // Delete user sessions first
    await req.db.query('DELETE FROM user_sessions WHERE user_id = $1', [decoded.userId]);

    // Delete user (this will cascade to related tables if set up)
    await req.db.query('DELETE FROM users WHERE id = $1', [decoded.userId]);

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    console.error('Account deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete account',
      // SECURITY: error.message not exposed to clients
    });
  }
});

// POST /api/auth/claim-bonus - Claim one-time bonus credits
router.post('/claim-bonus', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (await sessionRevoked(req.db, decoded)) {
      return res.status(401).json({ success: false, error: 'Session expired or revoked' });
    }
    
    // Get user from database with credits and bonus status
    const userResult = await req.db.query(
      'SELECT id, username, email, display_name, credits, bonus_credits_claimed, is_active FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );
    const user = userResult.rows[0];

    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid token' 
      });
    }

    // Check if user has already claimed welcome credits
    if (user.bonus_credits_claimed) {
      return res.status(400).json({
        success: false,
        error: 'Welcome credits have already been claimed'
      });
    }

    // Award welcome credits into the CANONICAL v2 ledger (credit_accounts) via
    // addGrant, which also mirrors users.credits (mirrorLegacy). Previously this
    // only SET users.credits, leaving the v2 ledger the chat meter / api-proxy /
    // Hub actually read at zero → false 402 "Insufficient credits" despite a shown
    // balance. Claim atomically first (WHERE bonus_credits_claimed = false) so
    // concurrent calls can't double-grant; roll the claim back if the grant throws.
    const WELCOME_BONUS_CREDITS = 1000;
    const claim = await req.db.query(
      'UPDATE users SET bonus_credits_claimed = true WHERE id = $1 AND bonus_credits_claimed = false RETURNING id',
      [user.id]
    );
    if (claim.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Welcome credits have already been claimed' });
    }
    try {
      await addGrant(req.db, user.id, {
        amountMicro: WELCOME_BONUS_CREDITS * MICRO_PER_CREDIT,
        kind: 'free',
        sourceRef: `welcome-bonus:${user.id}`,
      });
    } catch (grantErr) {
      await req.db.query('UPDATE users SET bonus_credits_claimed = false WHERE id = $1', [user.id]).catch(() => {});
      throw grantErr;
    }
    const after = await req.db.query('SELECT credits FROM users WHERE id = $1', [user.id]);
    const newCredits = after.rows[0]?.credits ?? WELCOME_BONUS_CREDITS;

    res.json({
      success: true,
      message: 'Welcome credits claimed successfully!',
      credits: newCredits,
      welcome_amount: 1000
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired'
      });
    }
    
    console.error('Bonus claim error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to claim bonus credits'
    });
  }
});

// ============================================
// OAUTH ROUTES - GOOGLE
// ============================================

// GET /api/auth/google - Initiate Google OAuth
router.get('/google', async (req, res) => {
  try {
    const config = OAUTH_CONFIG.google;
    if (!config.clientId) {
      return res.status(500).json({ success: false, error: 'Google OAuth not configured' });
    }

    const state = generateState();
    const returnUrl = req.query.returnUrl || '/overview';

    // Store state in Redis
    await storeOAuthState(state, { provider: 'google', returnUrl, createdAt: Date.now() });

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      response_type: 'code',
      scope: config.scopes.join(' '),
      state: state,
      access_type: 'offline',
      prompt: 'consent'
    });

    res.redirect(`${config.authUrl}?${params.toString()}`);
  } catch (error) {
    console.error('Google OAuth init error:', error);
    res.redirect(`${FRONTEND_URL}/auth?error=oauth_failed`);
  }
});

// GET /api/auth/google/callback - Google OAuth callback
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      console.error('Google OAuth error:', oauthError);
      return res.redirect(`${FRONTEND_URL}/auth?error=access_denied`);
    }

    if (!code || !state) {
      return res.redirect(`${FRONTEND_URL}/auth?error=invalid_request`);
    }

    // Verify state from Redis
    const stateData = await consumeOAuthState(state);
    if (!stateData || stateData.provider !== 'google') {
      return res.redirect(`${FRONTEND_URL}/auth?error=invalid_state`);
    }

    const config = OAUTH_CONFIG.google;

    // Exchange code for tokens
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: config.callbackUrl
      })
    });

    const tokens = await tokenResponse.json();
    if (!tokens.access_token) {
      console.error('Google token error:', tokens);
      return res.redirect(`${FRONTEND_URL}/auth?error=token_failed`);
    }

    // Get user info
    const userResponse = await fetch(config.userInfoUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });

    const googleUser = await userResponse.json();
    if (!googleUser.id) {
      return res.redirect(`${FRONTEND_URL}/auth?error=user_fetch_failed`);
    }

    // Find or create user
    const { user, isNew } = await findOrCreateOAuthUserWithReq(req, 'google', {
      id: googleUser.id,
      email: googleUser.email,
      name: googleUser.name,
      avatar: googleUser.picture,
      username: googleUser.email?.split('@')[0]
    });

    // Session-backed JWT (sid claim + unified user_sessions row; same issuer as
    // password login so revocation works identically for OAuth sign-ins).
    const jwtToken = await issueSessionToken(req.db, user, req);

    // Redirect with token
    const returnUrl = stateData.returnUrl || '/overview';
    handleOAuthRedirect(res, returnUrl, jwtToken, isNew);

  } catch (error) {
    // A closed registration or a suspended account is a DECISION, not a failure.
    // Reporting either as callback_failed would send a refused user into a retry
    // loop against a door that is never going to open.
    if (error instanceof AccountCreationBlockedError || error instanceof AccountSuspendedError) {
      console.warn('Google OAuth refused:', error.code);
      return res.redirect(`${FRONTEND_URL}/auth?error=${error.code}`);
    }
    console.error('Google OAuth callback error:', error);
    res.redirect(`${FRONTEND_URL}/auth?error=callback_failed`);
  }
});

// ============================================
// OAUTH ROUTES - GITHUB
// ============================================

// GET /api/auth/github - Initiate GitHub OAuth
router.get('/github', async (req, res) => {
  try {
    const config = OAUTH_CONFIG.github;
    if (!config.clientId) {
      return res.status(500).json({ success: false, error: 'GitHub OAuth not configured' });
    }

    const state = generateState();
    const returnUrl = req.query.returnUrl || '/overview';

    await storeOAuthState(state, { provider: 'github', returnUrl, createdAt: Date.now() });

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      scope: config.scopes.join(' '),
      state: state
    });

    res.redirect(`${config.authUrl}?${params.toString()}`);
  } catch (error) {
    console.error('GitHub OAuth init error:', error);
    res.redirect(`${FRONTEND_URL}/auth?error=oauth_failed`);
  }
});

// GET /api/auth/github/callback - GitHub OAuth callback
router.get('/github/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      console.error('GitHub OAuth error:', oauthError);
      return res.redirect(`${FRONTEND_URL}/auth?error=access_denied`);
    }

    if (!code || !state) {
      return res.redirect(`${FRONTEND_URL}/auth?error=invalid_request`);
    }

    const stateData = await consumeOAuthState(state);
    if (!stateData || stateData.provider !== 'github') {
      return res.redirect(`${FRONTEND_URL}/auth?error=invalid_state`);
    }

    const config = OAUTH_CONFIG.github;

    // Exchange code for token
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: code,
        redirect_uri: config.callbackUrl
      })
    });

    const tokens = await tokenResponse.json();
    if (!tokens.access_token) {
      console.error('GitHub token error:', tokens);
      return res.redirect(`${FRONTEND_URL}/auth?error=token_failed`);
    }

    // Get user info
    const userResponse = await fetch(config.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'XenoStudio'
      }
    });

    const githubUser = await userResponse.json();
    if (!githubUser.id) {
      return res.redirect(`${FRONTEND_URL}/auth?error=user_fetch_failed`);
    }

    // Get primary email if not public
    let email = githubUser.email;
    if (!email) {
      try {
        const emailsResponse = await fetch(config.userEmailsUrl, {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'XenoStudio'
          }
        });
        const emails = await emailsResponse.json();
        const primaryEmail = emails.find(e => e.primary && e.verified);
        email = primaryEmail?.email || emails[0]?.email;
      } catch (e) {
        console.log('Could not fetch GitHub emails:', e.message);
      }
    }

    // Find or create user
    const { user, isNew } = await findOrCreateOAuthUserWithReq(req, 'github', {
      id: String(githubUser.id),
      email: email,
      name: githubUser.name || githubUser.login,
      avatar: githubUser.avatar_url,
      username: githubUser.login
    });

    // Session-backed JWT (sid claim + unified user_sessions row; same issuer as
    // password login so revocation works identically for OAuth sign-ins).
    const jwtToken = await issueSessionToken(req.db, user, req);

    const returnUrl = stateData.returnUrl || '/overview';
    handleOAuthRedirect(res, returnUrl, jwtToken, isNew);

  } catch (error) {
    if (error instanceof AccountCreationBlockedError || error instanceof AccountSuspendedError) {
      console.warn('GitHub OAuth refused:', error.code);
      return res.redirect(`${FRONTEND_URL}/auth?error=${error.code}`);
    }
    console.error('GitHub OAuth callback error:', error);
    res.redirect(`${FRONTEND_URL}/auth?error=callback_failed`);
  }
});

// ============================================
// OAUTH ROUTES - TWITTER/X (OAuth 2.0 with PKCE)
// ============================================

// GET /api/auth/twitter - Initiate Twitter OAuth
router.get('/twitter', async (req, res) => {
  try {
    const config = OAUTH_CONFIG.twitter;
    if (!config.clientId) {
      return res.status(500).json({ success: false, error: 'Twitter OAuth not configured' });
    }

    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const returnUrl = req.query.returnUrl || '/overview';

    // Store state and PKCE verifier in Redis
    await storeOAuthState(state, {
      provider: 'twitter',
      returnUrl,
      codeVerifier,
      createdAt: Date.now()
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      scope: config.scopes.join(' '),
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    res.redirect(`${config.authUrl}?${params.toString()}`);
  } catch (error) {
    console.error('Twitter OAuth init error:', error);
    res.redirect(`${FRONTEND_URL}/auth?error=oauth_failed`);
  }
});

// GET /api/auth/twitter/callback - Twitter OAuth callback
router.get('/twitter/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      console.error('Twitter OAuth error:', oauthError);
      return res.redirect(`${FRONTEND_URL}/auth?error=access_denied`);
    }

    if (!code || !state) {
      return res.redirect(`${FRONTEND_URL}/auth?error=invalid_request`);
    }

    const stateData = await consumeOAuthState(state);
    if (!stateData || stateData.provider !== 'twitter') {
      return res.redirect(`${FRONTEND_URL}/auth?error=invalid_state`);
    }

    const config = OAUTH_CONFIG.twitter;
    const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

    // Exchange code for token with PKCE verifier
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`
      },
      body: new URLSearchParams({
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: config.callbackUrl,
        code_verifier: stateData.codeVerifier
      })
    });

    const tokens = await tokenResponse.json();
    if (!tokens.access_token) {
      console.error('Twitter token error:', tokens);
      return res.redirect(`${FRONTEND_URL}/auth?error=token_failed`);
    }

    // Get user info
    const userResponse = await fetch(`${config.userInfoUrl}?user.fields=profile_image_url,name,username`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });

    const twitterData = await userResponse.json();
    const twitterUser = twitterData.data;

    if (!twitterUser?.id) {
      console.error('Twitter user fetch error:', twitterData);
      return res.redirect(`${FRONTEND_URL}/auth?error=user_fetch_failed`);
    }

    // Find or create user (Twitter doesn't provide email in v2 API by default)
    const { user, isNew } = await findOrCreateOAuthUserWithReq(req, 'twitter', {
      id: twitterUser.id,
      email: null, // Twitter v2 API doesn't provide email without elevated access
      name: twitterUser.name,
      avatar: twitterUser.profile_image_url?.replace('_normal', '_400x400'),
      username: twitterUser.username
    });

    // Session-backed JWT (sid claim + unified user_sessions row; same issuer as
    // password login so revocation works identically for OAuth sign-ins).
    const jwtToken = await issueSessionToken(req.db, user, req);

    const returnUrl = stateData.returnUrl || '/overview';
    handleOAuthRedirect(res, returnUrl, jwtToken, isNew);

  } catch (error) {
    if (error instanceof AccountCreationBlockedError || error instanceof AccountSuspendedError) {
      console.warn('Twitter OAuth refused:', error.code);
      return res.redirect(`${FRONTEND_URL}/auth?error=${error.code}`);
    }
    console.error('Twitter OAuth callback error:', error);
    res.redirect(`${FRONTEND_URL}/auth?error=callback_failed`);
  }
});

// ============================================
// OAUTH ACCOUNT MANAGEMENT
// ============================================

// GET /api/auth/linked-accounts - Get user's linked OAuth accounts
router.get('/linked-accounts', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (await sessionRevoked(req.db, decoded)) {
      return res.status(401).json({ success: false, error: 'Session expired or revoked' });
    }

    const result = await req.db.query(
      `SELECT provider, provider_email, provider_username, provider_avatar_url, created_at
       FROM oauth_accounts WHERE user_id = $1`,
      [decoded.userId]
    );

    res.json({
      success: true,
      accounts: result.rows.map(acc => ({
        provider: acc.provider,
        email: acc.provider_email,
        username: acc.provider_username,
        avatar: acc.provider_avatar_url,
        linkedAt: acc.created_at
      }))
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
    console.error('Linked accounts error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch linked accounts' });
  }
});

// DELETE /api/auth/linked-accounts/:provider - Unlink OAuth account
router.delete('/linked-accounts/:provider', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (await sessionRevoked(req.db, decoded)) {
      return res.status(401).json({ success: false, error: 'Session expired or revoked' });
    }
    const { provider } = req.params;

    if (!['google', 'github', 'twitter'].includes(provider)) {
      return res.status(400).json({ success: false, error: 'Invalid provider' });
    }

    // Check if user has password set (can't unlink last auth method)
    const userResult = await req.db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [decoded.userId]
    );

    const accountsResult = await req.db.query(
      'SELECT COUNT(*) as count FROM oauth_accounts WHERE user_id = $1',
      [decoded.userId]
    );

    const hasPassword = userResult.rows[0]?.password_hash;
    const oauthCount = parseInt(accountsResult.rows[0]?.count || 0);

    if (!hasPassword && oauthCount <= 1) {
      return res.status(400).json({
        success: false,
        error: 'Cannot unlink last authentication method. Please set a password first.'
      });
    }

    await req.db.query(
      'DELETE FROM oauth_accounts WHERE user_id = $1 AND provider = $2',
      [decoded.userId, provider]
    );

    res.json({ success: true, message: `${provider} account unlinked successfully` });

  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
    console.error('Unlink account error:', error);
    res.status(500).json({ success: false, error: 'Failed to unlink account' });
  }
});

// ── XENO Mail Door-2: email-first account creation ──────────────────────────
// Creating a XENO Mail address IS creating the (one) central account: username =
// handle, email = handle@<MAIL_PRIMARY_DOMAIN> (auto-verified — we host it).
// The Gmail model: the mail address is the acquisition surface; the workspace
// account is what the user silently gets. See xeno-mail/docs/IDENTITY-AND-MAILBOX.md.

const XM_HANDLE_RE = /^[a-z0-9](?:[a-z0-9]|[._-](?![._-])){1,30}[a-z0-9]$/;

async function xmCheckHandleFree(db, handle) {
  if (handle.length < 3 || handle.length > 32 || !XM_HANDLE_RE.test(handle)) return 'invalid';
  const reserved = await db.query('SELECT 1 FROM reserved_handles WHERE handle = $1', [handle]);
  if (reserved.rows.length > 0) return 'reserved';
  const taken = await db.query('SELECT 1 FROM users WHERE lower(username) = $1 LIMIT 1', [handle]);
  if (taken.rows.length > 0) return 'taken';
  return null;
}

// Public availability check for the signup form (no auth — pre-account).
/**
 * GET /handle-available?handle=… — is this handle free, and can it be claimed?
 *
 * 🔴 AVAILABILITY AND ELIGIBILITY ARE DIFFERENT QUESTIONS, and conflating them
 * is the bug this answers.
 *
 * `/register-with-handle` carries `requireRegistrationOpen`. This endpoint did
 * not, and reported only whether the handle was free — so with signups closed,
 * XENO Mail's signup page shows a green "Available" and a
 * "Create you@xenostudio.ai" button, and the click fails. Recorded as
 * `xeno-mail/STATUS.md` §5.8; what makes it urgent is that it is DATED — the
 * box sets `REGISTRATION_OPEN_UNTIL=2026-08-28` for the YC window, so this
 * turns from working to broken on the 29th with nobody touching the code.
 *
 * `signupOpen` is ADDITIVE and `ok` keeps its meaning ("the handle is free"),
 * deliberately: collapsing the two into one boolean would make a closed signup
 * indistinguishable from a taken handle, and telling someone their name is
 * taken when it is not is a worse lie than the one being fixed. A caller can
 * now say "available — invite-only right now", which is the truth.
 */
/**
 * GET /activate?u=<userId>&t=<token> — the one click that turns a signup into
 * an account that can use the platform.
 *
 * PUBLIC by necessity: it is clicked from an email client, often before any
 * session cookie exists on that device, and requiring a login first would make
 * the link fail exactly when it is most needed. Its authority is the HMAC, not
 * a session.
 *
 * Redirects rather than returning JSON, because a human is on the other end of
 * this URL. A JSON blob in a browser tab reads as a broken link.
 */
/**
 * The interstitial the activation LINK lands on.
 *
 * Server-rendered rather than a redirect into the SPA, deliberately: this page
 * is opened from a mail client, often in a webview with no session, and it must
 * work with the app bundle unloaded and JavaScript disabled. It is a form and a
 * button — nothing else — because the POST it submits is the entire security
 * property (a scanner GETs, it does not submit forms).
 *
 * Inline styles: no external stylesheet exists at this URL and a flash of
 * unstyled text on the one page that has to look trustworthy is the wrong
 * trade.
 */
function activationPage({ site, ok, userId, token, title, body }) {
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title></head>
<body style="margin:0;background:#060608;color:#d8d8de;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:460px;margin:0 auto;padding:56px 20px;">
  <div style="text-align:center;font-size:11px;font-weight:700;letter-spacing:.34em;color:#d8d8de;margin-bottom:28px;">XENO</div>
  <div style="background:#111111;border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:24px;">
    <h1 style="margin:0 0 8px;font-size:19px;font-weight:600;color:#fff;">${esc(title)}</h1>
    <p style="margin:0 0 20px;color:#7f7f86;font-size:13px;">${esc(body)}</p>
    ${ok ? `<form method="POST" action="${esc(site)}/api/auth/activate">
      <input type="hidden" name="u" value="${esc(userId)}">
      <input type="hidden" name="t" value="${esc(token)}">
      <button type="submit" style="width:100%;padding:11px 14px;background:#e8e8ee;color:#111;border:0;border-radius:4px;font-size:13.5px;font-weight:600;cursor:pointer;">Activate my account</button>
    </form>` : `<a href="${esc(site)}/auth" style="display:block;text-align:center;padding:11px 14px;border:1px solid rgba(255,255,255,.2);border-radius:4px;color:#d8d8de;text-decoration:none;font-size:13.5px;">Go to sign in</a>`}
  </div>
  <p style="margin:14px 0 0;text-align:center;color:#5d5d63;font-size:11px;">You can also enter the 6-digit code from the email instead.</p>
</div></body></html>`;
}

/**
 * 🔴 GET RENDERS. IT DOES NOT COMMIT. This is the whole point of v2.
 *
 * v1 activated on GET, and corporate mail security (Defender Safe Links,
 * Proofpoint, Mimecast) PRE-FETCHES every URL in an inbound message — so a
 * scanner activated accounts with no human involved, silently, defeating the
 * only thing this gate exists to establish. Consumer clients prefetch too, for
 * previews.
 *
 * So GET returns a page with a button. The POST behind that button is the
 * click, and a scanner does not POST. One extra interaction, and it is the
 * interaction that carries the intent.
 */
router.get('/activate', async (req, res) => {
  const site = process.env.PUBLIC_SITE_URL || 'https://xenostudio.ai';
  const userId = String(req.query.u || '').trim();
  const token = String(req.query.t || '').trim();
  const valid = userId && token && verifyActivationToken(userId, token);

  res.set('Cache-Control', 'no-store');
  // Referrer-Policy so the token cannot ride out in a Referer header if the
  // page ever links anywhere.
  res.set('Referrer-Policy', 'no-referrer');

  if (!valid) {
    return res.status(400).type('html').send(activationPage({
      site, ok: false, title: 'This link is not valid',
      body: 'It may have been altered in transit, or it belongs to an account that no longer exists. Sign in and request a new one.',
    }));
  }
  return res.type('html').send(activationPage({
    site, ok: true, userId, token,
    title: 'Activate your XENO account',
    body: 'One click finishes setting up your account and unlocks the workspace.',
  }));
});

/** POST /activate — the commit. A link scanner issues GET, never this. */
router.post('/activate', async (req, res) => {
  const site = process.env.PUBLIC_SITE_URL || 'https://xenostudio.ai';
  try {
    const userId = String(req.body?.u || req.query.u || '').trim();
    const token = String(req.body?.t || req.query.t || '').trim();
    if (!userId || !token || !verifyActivationToken(userId, token)) {
      return res.redirect(302, `${site}/auth?activation=invalid`);
    }
    const { rows } = await req.db.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!rows.length) return res.redirect(302, `${site}/auth?activation=invalid`);

    await activateAccount(req.db, userId, { method: 'email_link', ip: clientIp(req) });
    return res.redirect(302, `${site}/auth/activate?activated=1`);
  } catch (e) {
    console.error('[activate] error:', e?.message || e);
    return res.redirect(302, `${site}/auth?activation=error`);
  }
});

/**
 * POST /activate/code — the PRIMARY path.
 *
 * Authenticated: the code proves the person read the mail, the session proves
 * which account is asking. Requiring both means a code leaked to a third party
 * is useless without the account's session, and it removes any need to name an
 * account in the request — so this endpoint cannot be used to probe which
 * addresses exist.
 */
router.post('/activate/code', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'Authentication required' });
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (await sessionRevoked(req.db, decoded)) {
      return res.status(401).json({ success: false, error: 'Session expired or revoked' });
    }

    const result = await verifyActivationCode(
      req.db, decoded.userId, req.body?.code, bcrypt, { ip: clientIp(req) },
    );
    if (result.ok) return res.json({ success: true, activated: true });

    // Three different problems, three different messages. "Invalid" for all of
    // them is what sends people to support instead of to the fix.
    const messages = {
      malformed: 'That code should be six digits.',
      no_code: 'That code has expired. Ask for a new one.',
      expired: 'That code has expired. Ask for a new one.',
      too_many_attempts: 'Too many attempts. Ask for a new code.',
      wrong: 'That code is not right.',
    };
    return res.status(400).json({
      success: false,
      error: messages[result.reason] || 'That code is not right.',
      code: result.reason,
      ...(result.attemptsLeft !== undefined ? { attemptsLeft: result.attemptsLeft } : {}),
    });
  } catch (e) {
    if (e?.name === 'JsonWebTokenError' || e?.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    console.error('[activate/code] error:', e?.message || e);
    return res.status(500).json({ success: false, error: 'Could not verify that code' });
  }
});

/**
 * GET /activation-status — what the waiting page polls.
 *
 * Exists so someone who clicks the link on their phone sees the desktop tab
 * move on by itself. Cheap: one indexed lookup, and the page stops polling the
 * moment it flips.
 */
router.get('/activation-status', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, error: 'Authentication required' });
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const activated = await isAccountActivated(req.db, decoded.userId);
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, activated });
  } catch (e) {
    if (e?.name === 'JsonWebTokenError' || e?.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    console.error('[activation-status] error:', e?.message || e);
    return res.status(500).json({ success: false, error: 'Could not read status' });
  }
});

/**
 * POST /resend-activation — authenticated, so it cannot be used to spray mail
 * at arbitrary addresses. Rate-limited by the global limiter.
 *
 * Resolves the bearer token INLINE rather than via authMiddleware, because that
 * is this file's convention (`/me`, `/logout` and the rest do the same) — this
 * router is mounted WITHOUT auth in index.js, so `authMiddleware` is not a
 * symbol in scope here. Reaching for it compiled fine and threw
 * `ReferenceError` at import time, taking every DB-backed suite down with it.
 */
router.post('/resend-activation', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (await sessionRevoked(req.db, decoded)) {
      return res.status(401).json({ success: false, error: 'Session expired or revoked' });
    }
    const { rows } = await req.db.query(
      'SELECT id, email, display_name, username FROM users WHERE id = $1', [decoded.userId],
    );
    if (!rows.length) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    if (await isAccountActivated(req.db, rows[0].id)) {
      return res.json({ success: true, alreadyActivated: true });
    }
    sendWelcomeEmail(req.db, rows[0]);
    res.json({ success: true, sent: true });
  } catch (e) {
    if (e?.name === 'JsonWebTokenError' || e?.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    console.error('[resend-activation] error:', e?.message || e);
    res.status(500).json({ success: false, error: 'Could not resend' });
  }
});

router.get('/handle-available', async (req, res) => {
  try {
    const handle = String(req.query.handle || '').trim().toLowerCase();
    const domain = mailDomain();
    const signupOpen = isRegistrationOpen();
    const reason = await xmCheckHandleFree(req.db, handle);
    if (reason) return res.json({ ok: false, reason, handle, signupOpen });
    res.json({
      ok: true,
      handle,
      address: `${handle}@${domain}`,
      signupOpen,
      // Present ONLY when it changes what the caller should render, so a client
      // that ignores it degrades to the old behaviour rather than to a lie.
      ...(signupOpen ? {} : { claimable: false, claimReason: 'invite_only' }),
    });
  } catch (e) {
    console.error('[handle-available] error:', e.message);
    res.status(500).json({ ok: false, reason: 'error' });
  }
});

// Create the account FROM a handle (email-first signup).
router.post('/register-with-handle', requireRegistrationOpen, async (req, res) => {
  try {
    const { handle: rawHandle, password, recoveryEmail } = req.body || {};
    const handle = String(rawHandle || '').trim().toLowerCase();
    const domain = mailDomain();

    if (!handle || !password) {
      return res.status(400).json({ success: false, error: 'Handle and password are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long' });
    }
    // Recovery channel: an EXTERNAL email (not one we host — that would be circular).
    const recovery = recoveryEmail ? String(recoveryEmail).trim().toLowerCase() : null;
    if (recovery && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recovery) || recovery.endsWith(`@${domain}`))) {
      return res.status(400).json({ success: false, error: 'Recovery email must be a valid external address' });
    }

    const reason = await xmCheckHandleFree(req.db, handle);
    if (reason) {
      const msg = { invalid: 'Invalid handle', reserved: 'That handle is reserved', taken: 'That address is already taken' }[reason];
      return res.status(409).json({ success: false, error: msg, reason });
    }

    const address = `${handle}@${domain}`;
    const passwordHash = await hashPassword(password);
    const userId = uuidv4();

    const result = await req.db.query(`
      INSERT INTO users (id, username, email, password_hash, display_name, email_verified, recovery_email, credits, bonus_credits_claimed, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, NOW(), NOW())
      RETURNING id, username, email, display_name, avatar_url, created_at, email_verified, is_active, credits, bonus_credits_claimed
    `, [userId, handle, address, passwordHash, handle, recovery, 0, false]);
    const user = result.rows[0];
    // This flow's `email` column holds the XENO ADDRESS, which is not necessarily a
    // deliverable mailbox — the reachable address is `recovery_email`. Sending to
    // user.email here would post the welcome into a void and log it as delivered.
    // No recovery address means no welcome, which is correct: there is nowhere to send it.
    if (recovery) sendWelcomeEmail(req.db, { ...user, email: recovery });

    // Free-tier starter credits (same as /register; non-fatal).
    if (FREE_SIGNUP_CREDITS > 0) {
      try {
        await addGrant(req.db, user.id, { amountMicro: FREE_SIGNUP_CREDITS * MICRO_PER_CREDIT, kind: 'free', sourceRef: `signup:${user.id}` });
        user.credits = FREE_SIGNUP_CREDITS;
      } catch (grantErr) {
        console.warn('[register-with-handle] signup credit grant failed:', grantErr.message);
      }
    }

    // Session-backed token (sid claim + user_sessions row; plaintext JWT never stored).
    const token = await issueSessionToken(req.db, user, req);

    console.log(`[register-with-handle] created account ${address} (${user.id})`);
    res.json({ success: true, token, user: { ...user, xenoAddress: address } });
  } catch (e) {
    if (e && e.code === '23505') {
      return res.status(409).json({ success: false, error: 'That address is already taken', reason: 'taken' });
    }
    console.error('[register-with-handle] error:', e.message);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ONBOARDING
 *
 * Two endpoints. Both resolve the bearer token inline, for the same reason
 * documented on /resend-activation above: this router is mounted without auth,
 * so `authMiddleware` is not a symbol in scope and reaching for it throws
 * ReferenceError at import time — which `node --check` does not catch.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Resolve the caller, or null. Shared by both onboarding routes. */
async function resolveUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (await sessionRevoked(req.db, decoded)) return null;
    const { rows } = await req.db.query(
      'SELECT id, email FROM users WHERE id = $1', [decoded.userId],
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

/**
 * GET /onboarding — has this account finished onboarding?
 *
 * The client asks before routing, so a returning user is never shown the flow
 * twice. Deliberately NOT part of /me: /me is on the hot path of every page
 * load in every product, and onboarding state is read once per session.
 */
router.get('/onboarding', async (req, res) => {
  const user = await resolveUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

  try {
    const { rows } = await req.db.query(
      `SELECT display_name, heard_from, role, interests, starting_point, workspace,
              completed_at, skipped_at
         FROM user_onboarding WHERE user_id = $1`,
      [user.id],
    );
    const row = rows[0] || null;
    res.json({
      success: true,
      // One boolean for the client to branch on. Skipping counts as done —
      // re-presenting a flow somebody explicitly dismissed is nagging.
      done: Boolean(row && (row.completed_at || row.skipped_at)),
      onboarding: row,
    });
  } catch (err) {
    console.error('[onboarding] read failed:', err.message);
    // Fail OPEN, unlike the activation gate. The worst case here is that a
    // user sees a skippable survey twice; failing closed would wall them out
    // of the product over a survey table, which is far worse.
    res.json({ success: true, done: true, onboarding: null, degraded: true });
  }
});

/**
 * POST /onboarding — save answers.
 *
 * Accepts a partial body and upserts, so each step can save as it is completed
 * rather than the whole flow depending on the user reaching the end. Somebody
 * who answers two steps and closes the tab has still told us two things.
 */
router.post('/onboarding', async (req, res) => {
  const user = await resolveUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

  try {
    const b = req.body || {};

    // Bound every free-text field. These are user-controlled strings that end
    // up in analytics queries and, eventually, on a dashboard — length limits
    // here are cheaper than discovering a 40 KB "how did you hear about us".
    const str = (v, max) =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

    const displayName = str(b.displayName, 120);
    const heardFrom = str(b.heardFrom, 200);
    /* 60 was the cap when `role` held ONE answer. It is now a comma-joined
     * set, and all eight roles serialise to 81 characters — so the old cap
     * silently truncated the answer mid-word and stored a value that parses
     * back to fewer roles than the user chose. Sized with headroom against the
     * real maximum rather than to it, so adding a role does not reintroduce
     * the same silent loss. */
    const role = str(b.role, 200);
    const startingPoint = str(b.startingPoint, 60);
    const workspace = str(b.workspace, 40);

    /* The workspace choice is the one field that can be UNSET.
     *
     * Every other answer only ever moves forward, so COALESCE(new, existing)
     * is right for them — a later step posting its own field must not blank an
     * earlier one. But the "full XENO workspace" bar is a TOGGLE: clicking it
     * again clears the choice, and COALESCE would silently keep the old value,
     * so an explicit un-choice would never reach the database.
     *
     * So absence and null are distinguished. A body with no `workspace` key
     * leaves the stored value alone; a body that carries `workspace: null`
     * clears it. `hasOwnProperty` rather than `!== undefined`, because JSON
     * cannot express undefined and the key's PRESENCE is the signal. */
    const workspaceProvided = Object.prototype.hasOwnProperty.call(b, 'workspace');

    // Interests: array of short strings, deduped, capped. Anything else is
    // discarded rather than rejected — a malformed optional survey field
    // should not fail a request that also carries good answers.
    const interests = Array.isArray(b.interests)
      ? [...new Set(b.interests.filter((s) => typeof s === 'string' && s.length <= 40))].slice(0, 20)
      : [];

    const completed = b.completed === true;
    const skipped = b.skipped === true;

    await req.db.query(
      `INSERT INTO user_onboarding
         (user_id, display_name, heard_from, role, interests, starting_point,
          completed_at, skipped_at, workspace)
       VALUES ($1, $2, $3, $4, $5, $6,
               CASE WHEN $7::boolean THEN NOW() END,
               CASE WHEN $8::boolean THEN NOW() END,
               $9)
       ON CONFLICT (user_id) DO UPDATE SET
         -- COALESCE(new, existing): a later step posting only its own field
         -- must not blank the answers given in an earlier one.
         display_name   = COALESCE(EXCLUDED.display_name,   user_onboarding.display_name),
         heard_from     = COALESCE(EXCLUDED.heard_from,     user_onboarding.heard_from),
         role           = COALESCE(EXCLUDED.role,           user_onboarding.role),
         starting_point = COALESCE(EXCLUDED.starting_point, user_onboarding.starting_point),
         -- $10 true = the client sent the key, so its value wins even when null.
         workspace      = CASE WHEN $10::boolean THEN EXCLUDED.workspace
                               ELSE COALESCE(EXCLUDED.workspace, user_onboarding.workspace) END,
         -- Interests are REPLACED, not merged: it is a multi-select, so
         -- unticking something has to be able to remove it.
         interests      = CASE WHEN array_length(EXCLUDED.interests, 1) IS NULL
                               THEN user_onboarding.interests ELSE EXCLUDED.interests END,
         completed_at   = COALESCE(user_onboarding.completed_at, EXCLUDED.completed_at),
         skipped_at     = COALESCE(user_onboarding.skipped_at,   EXCLUDED.skipped_at),
         updated_at     = NOW()`,
      [user.id, displayName, heardFrom, role, interests, startingPoint, completed, skipped, workspace, workspaceProvided],
    );

    /* Marketing preference.
     *
     * ONLY ever writes an opt-OUT. Declining is an action; accepting is the
     * default state and needs no row.
     *
     * The asymmetry is deliberate and load-bearing: `optIn()` DELETEs the
     * opt-out row outright, with no category filter. So calling it when the
     * box is ticked would silently resurrect somebody who had previously
     * unsubscribed from EVERYTHING — turning "yes, product updates are fine"
     * into "re-subscribe me to all mail I ever rejected". Never call it here.
     */
    if (b.marketingOptIn === false) {
      await optOut(req.db, user.email, { reason: 'onboarding', category: 'marketing' })
        .catch((e) => console.error('[onboarding] opt-out failed:', e.message));
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[onboarding] write failed:', err.message);
    res.status(500).json({ success: false, error: 'Could not save' });
  }
});

export default router;
