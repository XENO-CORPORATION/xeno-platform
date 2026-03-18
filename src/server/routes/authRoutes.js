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
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'https://xenostudio.ai/api/auth/google/callback'
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    userEmailsUrl: 'https://api.github.com/user/emails',
    scopes: ['user:email', 'read:user'],
    callbackUrl: process.env.GITHUB_CALLBACK_URL || 'https://xenostudio.ai/api/auth/github/callback'
  },
  twitter: {
    clientId: process.env.TWITTER_CLIENT_ID,
    clientSecret: process.env.TWITTER_CLIENT_SECRET,
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    userInfoUrl: 'https://api.twitter.com/2/users/me',
    scopes: ['users.read', 'tweet.read', 'offline.access'],
    callbackUrl: process.env.TWITTER_CALLBACK_URL || 'https://xenostudio.ai/api/auth/twitter/callback'
  }
};

// Frontend URL for redirects after OAuth
const FRONTEND_URL = process.env.AUTH_FRONTEND_URL || 'https://xenostudio.ai';

// Helper: build OAuth redirect URL
function buildOAuthRedirectUrl(returnUrl, token, isNew) {
  if (returnUrl && returnUrl.startsWith("xeno://")) {
    const sep = returnUrl.includes("?") ? "&" : "?";
    return `${returnUrl}${sep}token=${token}&isNew=${isNew}`;
  }
  return `${FRONTEND_URL}${returnUrl}?token=${token}&isNew=${isNew}`;
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
async function findOrCreateOAuthUser(db, provider, profile) {
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
      user = emailResult.rows[0];
    }
  }

  // Create new user if doesn't exist
  let isNew = false;
  if (!user) {
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
      `INSERT INTO users (id, username, email, password_hash, display_name, avatar_url, email_verified, is_active, status, role, plan, credits, bonus_credits_claimed, created_at, updated_at, last_login)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW(), NOW())
       RETURNING id, username, email, display_name, avatar_url, created_at, email_verified, is_active, credits, bonus_credits_claimed, status, role, plan`,
      [userId, finalUsername, email?.toLowerCase(), oauthPasswordHash, name || finalUsername, avatar, true, true, 'active', 'user', 'free', 0, false]
    );

    user = insertResult.rows[0];
    isNew = true;
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
      `INSERT INTO security_events (user_id, event_type, metadata, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [user.id, isNew ? 'oauth_signup' : 'oauth_login', JSON.stringify({ provider, providerId })]
    );
  } catch (e) {
    console.log('Could not log security event:', e.message);
  }

  return { user, isNew };
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

// Generate JWT token
function generateToken(user) {
  return jwt.sign(
    { 
      userId: user.id,
      email: user.email,
      username: user.username 
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// POST /api/auth/init - Initialize database tables
router.post('/init', async (req, res) => {
  try {
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

    // Create sessions table for additional security
    await req.db.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL,
        session_token VARCHAR(512),
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        ip_address INET,
        user_agent TEXT
      )
    `);

    // Ensure existing deployments have session_token column used by login/register routes
    await req.db.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS session_token VARCHAR(512)`);

    // Check if default admin user exists
    const adminCheck = await req.db.query(
      'SELECT id FROM users WHERE id = $1 OR email IN ($2, $3)',
      [adminUserId, adminEmail, legacyAdminEmail]
    );
    
    // Create/update default admin user with stable ID and credentials
    const adminPassword = await hashPassword(process.env.ADMIN_PASSWORD || 'xenostudio123');
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

    // SECURITY WARNING: Change the default admin password via ADMIN_PASSWORD env var
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('⚠️  SECURITY WARNING: Using default admin password. Set ADMIN_PASSWORD env var in production!');
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
router.post('/register', async (req, res) => {
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
      INSERT INTO users (id, username, email, password_hash, display_name, credits, bonus_credits_claimed, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING id, username, email, display_name, avatar_url, created_at, email_verified, is_active, credits, bonus_credits_claimed
    `, [userId, username.toLowerCase(), email.toLowerCase(), passwordHash, display_name, 0, false]);

    const user = result.rows[0];
    const token = generateToken(user);

    // Store session (simplified for now - we can add session tracking later)
    try {
      const tokenHash = await bcrypt.hash(token, 10);
      await req.db.query(`
        INSERT INTO user_sessions (user_id, token_hash, session_token, expires_at, ip_address, user_agent)
        VALUES ($1, $2, $3, NOW() + INTERVAL '7 days', $4, $5)
      `, [user.id, tokenHash, token, req.ip, req.get('User-Agent')]);
    } catch (sessionError) {
      console.log('Session storage failed, but user created successfully:', sessionError.message);
      // Continue without session storage for now
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

    // Find user by email
    const result = await req.db.query(`
      SELECT id, username, email, password_hash, display_name, avatar_url, 
             created_at, email_verified, is_active, last_login, credits, bonus_credits_claimed
      FROM users 
      WHERE email = ANY($1::text[])
      LIMIT 1
    `, [emailCandidates]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const user = result.rows[0];

    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Account is deactivated'
      });
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Update last login
    await req.db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    // Generate token
    const token = generateToken(user);

    // Store session (simplified for now)
    try {
      const tokenHash = await bcrypt.hash(token, 10);
      await req.db.query(`
        INSERT INTO user_sessions (user_id, token_hash, session_token, expires_at, ip_address, user_agent)
        VALUES ($1, $2, $3, NOW() + INTERVAL '7 days', $4, $5)
      `, [user.id, tokenHash, token, req.ip, req.get('User-Agent')]);
    } catch (sessionError) {
      console.log('Session storage failed, but login successful:', sessionError.message);
      // Continue without session storage for now
    }

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
    const decoded = jwt.verify(token, JWT_SECRET);
    
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
      // Remove session from database
      const tokenHash = await bcrypt.hash(token, 10);
      await req.db.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
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
    console.log('🔧 Starting database migration for authentication system...');
    const adminUserId = '9bcd1624-e26b-46ec-81f5-17d9b575c992';
    const adminEmail = 'admin@xenostudio.local';
    const legacyAdminEmail = 'admin@xenostudio.ai';

    // Step 1: Drop and recreate user_sessions table to ensure correct schema
    try {
      await req.db.query(`DROP TABLE IF EXISTS user_sessions`);
      await req.db.query(`
        CREATE TABLE user_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL,
          token_hash VARCHAR(255) NOT NULL,
          session_token VARCHAR(512),
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          ip_address INET,
          user_agent TEXT
        )
      `);
      console.log('✅ user_sessions table recreated with correct schema');
    } catch (error) {
      console.error('Error recreating user_sessions table:', error);
      throw error;
    }

    // Step 2: Add missing columns to existing users table
    await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP`);
    await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`);
    await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`);
    await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`);
    await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255)`);
    await req.db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP`);
    await req.db.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS session_token VARCHAR(512)`);
    console.log('✅ User table columns added/verified');
    
    // Step 3: Check if admin user exists and update/create it
    const adminCheck = await req.db.query(
      'SELECT id FROM users WHERE id = $1 OR email IN ($2, $3)',
      [adminUserId, adminEmail, legacyAdminEmail]
    );
    
    if (adminCheck.rows.length === 0) {
      // Create new admin user
      const adminPasswordHash = await hashPassword(process.env.ADMIN_PASSWORD || 'xenostudio123');
      
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
      const adminPasswordHash = await hashPassword(process.env.ADMIN_PASSWORD || 'xenostudio123');
      await req.db.query(`
        UPDATE users 
        SET password_hash = $1, email_verified = true, is_active = true, username = 'admin', display_name = 'XenoStudio Admin'
        WHERE id = $2 OR email IN ($3, $4)
      `, [adminPasswordHash, adminUserId, adminEmail, legacyAdminEmail]);
      console.log('✅ Admin user updated');
    }

    res.json({
      success: true,
      message: 'Database migration completed successfully',
      details: {
        adminCredentials: {
          email: 'admin@xenostudio.local',
          password: 'xenostudio123'
        }
      }
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

    const decoded = jwt.verify(token, JWT_SECRET);
    
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

    const decoded = jwt.verify(token, JWT_SECRET);
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

    const decoded = jwt.verify(token, JWT_SECRET);
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

    res.json({
      success: true,
      message: 'Password changed successfully'
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

    const decoded = jwt.verify(token, JWT_SECRET);

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

    const decoded = jwt.verify(token, JWT_SECRET);
    const { feature, amount } = req.body;

    if (!feature || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Feature and positive amount are required'
      });
    }

    // Get current credits
    const userResult = await req.db.query(
      'SELECT id, credits FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = userResult.rows[0];
    const currentCredits = user.credits || 0;

    if (currentCredits < amount) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient credits',
        current_credits: currentCredits,
        required: amount
      });
    }

    // Deduct credits
    const updateResult = await req.db.query(
      'UPDATE users SET credits = credits - $1, updated_at = NOW() WHERE id = $2 RETURNING credits',
      [amount, decoded.userId]
    );

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

    const decoded = jwt.verify(token, JWT_SECRET);
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
    const decoded = jwt.verify(token, JWT_SECRET);
    
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

    // Award welcome credits (1000) and mark as claimed
    const updateResult = await req.db.query(
      'UPDATE users SET credits = 1000, bonus_credits_claimed = true WHERE id = $1 RETURNING credits',
      [user.id]
    );

    const newCredits = updateResult.rows[0].credits;

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
    const { user, isNew } = await findOrCreateOAuthUser(req.db, 'google', {
      id: googleUser.id,
      email: googleUser.email,
      name: googleUser.name,
      avatar: googleUser.picture,
      username: googleUser.email?.split('@')[0]
    });

    // Generate JWT
    const jwtToken = jwt.sign(
      { userId: user.id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Store session
    try {
      const tokenHash = crypto.createHash('sha256').update(jwtToken).digest('hex');
      await req.db.query(
        `INSERT INTO user_sessions (user_id, access_token_hash, expires_at, ip_address, device_type, browser, created_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days', $3, $4, $5, NOW())`,
        [user.id, tokenHash, req.ip, 'web', req.get('User-Agent')?.substring(0, 100)]
      );
    } catch (e) {
      console.log('Session storage note:', e.message);
    }

    // Redirect with token
    const returnUrl = stateData.returnUrl || '/overview';
    handleOAuthRedirect(res, returnUrl, jwtToken, isNew);

  } catch (error) {
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
    const { user, isNew } = await findOrCreateOAuthUser(req.db, 'github', {
      id: String(githubUser.id),
      email: email,
      name: githubUser.name || githubUser.login,
      avatar: githubUser.avatar_url,
      username: githubUser.login
    });

    // Generate JWT
    const jwtToken = jwt.sign(
      { userId: user.id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Store session
    try {
      const tokenHash = crypto.createHash('sha256').update(jwtToken).digest('hex');
      await req.db.query(
        `INSERT INTO user_sessions (user_id, access_token_hash, expires_at, ip_address, device_type, browser, created_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days', $3, $4, $5, NOW())`,
        [user.id, tokenHash, req.ip, 'web', req.get('User-Agent')?.substring(0, 100)]
      );
    } catch (e) {
      console.log('Session storage note:', e.message);
    }

    const returnUrl = stateData.returnUrl || '/overview';
    handleOAuthRedirect(res, returnUrl, jwtToken, isNew);

  } catch (error) {
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
    const { user, isNew } = await findOrCreateOAuthUser(req.db, 'twitter', {
      id: twitterUser.id,
      email: null, // Twitter v2 API doesn't provide email without elevated access
      name: twitterUser.name,
      avatar: twitterUser.profile_image_url?.replace('_normal', '_400x400'),
      username: twitterUser.username
    });

    // Generate JWT
    const jwtToken = jwt.sign(
      { userId: user.id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Store session
    try {
      const tokenHash = crypto.createHash('sha256').update(jwtToken).digest('hex');
      await req.db.query(
        `INSERT INTO user_sessions (user_id, access_token_hash, expires_at, ip_address, device_type, browser, created_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days', $3, $4, $5, NOW())`,
        [user.id, tokenHash, req.ip, 'web', req.get('User-Agent')?.substring(0, 100)]
      );
    } catch (e) {
      console.log('Session storage note:', e.message);
    }

    const returnUrl = stateData.returnUrl || '/overview';
    handleOAuthRedirect(res, returnUrl, jwtToken, isNew);

  } catch (error) {
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

    const decoded = jwt.verify(token, JWT_SECRET);

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

    const decoded = jwt.verify(token, JWT_SECRET);
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

export default router;
