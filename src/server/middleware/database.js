/**
 * Database middleware for container routes
 * Provides database connection to request handlers
 */

import pg from 'pg';

const { Pool } = pg;

// Create database connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  database: process.env.DB_NAME || 'xenostudio',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'xenostudio_password',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Test connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Database middleware - adds db connection to request object
 */
export const databaseMiddleware = (req, res, next) => {
  req.db = pool;
  next();
};

export { pool };
export default databaseMiddleware;