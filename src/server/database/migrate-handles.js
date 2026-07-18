/**
 * migrate-handles.js — the central XENO handle registry hardening.
 *
 * The Google-model unification (handle = login = workspace identity = @xenostudio.ai
 * mailbox) requires the existing users.username to behave as an EMAIL-SAFE, globally
 * unique handle:
 *   1. Case-insensitive uniqueness: UNIQUE INDEX on lower(username)
 *      (pre-verified live 2026-07-18: 0 case-collisions among 165 users).
 *   2. reserved_handles: names that may never be minted as public addresses
 *      (postmaster/abuse/admin/… — RFC 2142 + brand terms). Existing accounts that
 *      hold a reserved username keep their LOGIN, but products must not mint an
 *      address for them (the check endpoint reports reserved).
 *
 * NOTE: usernames that don't match the email-safe policy (^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$,
 * 3..32) keep working for login; they simply DON'T qualify as an address until the
 * user claims a conforming handle via /api/v2/handles/claim. No forced renames.
 *
 * Idempotent. Safe to re-run.
 */
import pg from 'pg';

const { Pool } = pg;

export const RESERVED_HANDLES = [
  // RFC 2142 + operational
  'postmaster', 'abuse', 'admin', 'administrator', 'hostmaster', 'webmaster', 'root',
  'security', 'noc', 'mailer-daemon', 'daemon', 'no-reply', 'noreply', 'nobody',
  // functional/company
  'billing', 'support', 'help', 'info', 'sales', 'contact', 'legal', 'privacy',
  'press', 'jobs', 'hr', 'team', 'staff', 'official', 'mail', 'email', 'system',
  'api', 'dev', 'developer', 'ops', 'status',
  // brand
  'xeno', 'xenostudio', 'xenomail', 'xenoos',
  // dangerous/generic
  'null', 'undefined', 'test', 'user', 'account', 'accounts', 'auth', 'login',
];

export async function migrateHandles(pool) {
  // 1. Case-insensitive uniqueness (verified collision-free before shipping).
  await pool.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON users (lower(username))',
  );

  // 1b. Recovery channel for email-first (Door-2) accounts: their auth email is
  // one WE host, so password recovery needs an external address (else circular).
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_email VARCHAR(255)');

  // 2. Reserved handles registry.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reserved_handles (
      handle      varchar(64) PRIMARY KEY,
      reason      varchar(64) NOT NULL DEFAULT 'reserved',
      created_at  timestamp NOT NULL DEFAULT now()
    )
  `);
  for (const h of RESERVED_HANDLES) {
    await pool.query(
      'INSERT INTO reserved_handles (handle) VALUES ($1) ON CONFLICT (handle) DO NOTHING',
      [h],
    );
  }
}

// Allow running standalone (same convention as migrate-oidc-clients.js).
if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    database: process.env.DB_NAME || process.env.POSTGRES_DB,
    user: process.env.DB_USER || process.env.POSTGRES_USER,
    password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD,
  });
  migrateHandles(pool)
    .then(() => {
      console.log(`✅ handle registry hardened (lower-unique index + ${RESERVED_HANDLES.length} reserved handles)`);
      return pool.end();
    })
    .catch((err) => {
      console.error('❌ handles migration failed:', err.message);
      process.exit(1);
    });
}
