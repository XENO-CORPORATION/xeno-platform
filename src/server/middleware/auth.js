/**
 * Authentication Middleware
 * JWT-based route protection and user context
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'xenolabs-super-secret-jwt-key-change-in-production';

/**
 * Middleware to verify JWT token and add user to request
 */
export const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    console.log('[Auth] Token present:', !!token, 'Path:', req.path);

    if (!token) {
      console.log('[Auth] No token provided for path:', req.path);
      return res.status(401).json({
        success: false,
        error: 'Authentication token required'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Get user from database to ensure they still exist and are active
    const result = await req.db.query(`
      SELECT id, username, email, display_name, avatar_url, 
             created_at, email_verified, is_active
      FROM users 
      WHERE id = $1 AND is_active = true
    `, [decoded.userId]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    // Add user to request object
    req.user = result.rows[0];
    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid authentication token'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Authentication token expired'
      });
    }
    
    console.error('Authentication middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed',
      message: error.message
    });
  }
};

/**
 * Optional authentication middleware - adds user if token is present but doesn't require it
 */
export const optionalAuthMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      const result = await req.db.query(`
        SELECT id, username, email, display_name, avatar_url, 
               created_at, email_verified, is_active
        FROM users 
        WHERE id = $1 AND is_active = true
      `, [decoded.userId]);

      if (result.rows.length > 0) {
        req.user = result.rows[0];
      }
    }
    
    next();

  } catch (error) {
    // For optional auth, we don't return errors, just continue without user
    next();
  }
};

export default authMiddleware;