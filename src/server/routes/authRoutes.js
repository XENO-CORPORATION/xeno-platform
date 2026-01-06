/**
 * XenoOS Authentication API Routes
 * JWT-based authentication with PostgreSQL backend
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// JWT secret key (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'xenolabs-super-secret-jwt-key-change-in-production';
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
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        ip_address INET,
        user_agent TEXT
      )
    `);

    // Check if default admin user exists
    const adminCheck = await req.db.query('SELECT id FROM users WHERE email = $1', ['admin@xenolabs.local']);
    
    if (adminCheck.rows.length === 0) {
      // Create default admin user
      const adminPassword = await hashPassword('xenolabs123');
      const adminUserId = '9bcd1624-e26b-46ec-81f5-17d9b575c992'; // Keep same ID for existing containers
      
      // Use ON CONFLICT DO NOTHING to handle duplicate key gracefully
      await req.db.query(`
        INSERT INTO users (id, username, email, password_hash, display_name, email_verified, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `, [adminUserId, 'admin', 'admin@xenolabs.local', adminPassword, 'XenoLabs Admin', true, true]);

      console.log('✅ Default admin user ensured: admin@xenolabs.local / xenolabs123');
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
      message: error.message
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
        INSERT INTO user_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
        VALUES ($1, $2, NOW() + INTERVAL '7 days', $3, $4)
      `, [user.id, tokenHash, req.ip, req.get('User-Agent')]);
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
      message: error.message
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

    // Find user by email
    const result = await req.db.query(`
      SELECT id, username, email, password_hash, display_name, avatar_url, 
             created_at, email_verified, is_active, last_login, credits, bonus_credits_claimed
      FROM users 
      WHERE email = $1
    `, [email.toLowerCase()]);

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
        INSERT INTO user_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
        VALUES ($1, $2, NOW() + INTERVAL '7 days', $3, $4)
      `, [user.id, tokenHash, req.ip, req.get('User-Agent')]);
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
      message: error.message
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
      message: error.message
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

    // Step 1: Drop and recreate user_sessions table to ensure correct schema
    try {
      await req.db.query(`DROP TABLE IF EXISTS user_sessions`);
      await req.db.query(`
        CREATE TABLE user_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL,
          token_hash VARCHAR(255) NOT NULL,
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
    console.log('✅ User table columns added/verified');
    
    // Step 3: Check if admin user exists and update/create it
    const adminCheck = await req.db.query('SELECT id FROM users WHERE email = $1', ['admin@xenolabs.local']);
    
    if (adminCheck.rows.length === 0) {
      // Create new admin user
      const adminPasswordHash = await hashPassword('xenolabs123');
      const adminUserId = '9bcd1624-e26b-46ec-81f5-17d9b575c992';
      
      await req.db.query(`
        INSERT INTO users (id, username, email, password_hash, display_name, email_verified, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET 
          password_hash = EXCLUDED.password_hash,
          email_verified = EXCLUDED.email_verified,
          is_active = EXCLUDED.is_active
      `, [adminUserId, 'admin', 'admin@xenolabs.local', adminPasswordHash, 'XenoLabs Admin', true, true]);
      console.log('✅ Admin user created');
    } else {
      // Update existing admin user with hashed password
      const adminPasswordHash = await hashPassword('xenolabs123');
      await req.db.query(`
        UPDATE users 
        SET password_hash = $1, email_verified = true, is_active = true, username = 'admin', display_name = 'XenoLabs Admin'
        WHERE email = 'admin@xenolabs.local'
      `, [adminPasswordHash]);
      console.log('✅ Admin user updated');
    }

    res.json({
      success: true,
      message: 'Database migration completed successfully',
      details: {
        adminCredentials: {
          email: 'admin@xenolabs.local',
          password: 'xenolabs123'
        }
      }
    });

  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      message: error.message
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
      message: error.message
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
      message: error.message
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
      message: error.message
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
      message: error.message
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
      message: error.message
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
      message: error.message
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

export default router;