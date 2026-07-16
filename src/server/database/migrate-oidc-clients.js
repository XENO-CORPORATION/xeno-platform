/**
 * OIDC first-party clients — ADDITIVE migration (XENO AUTH - SPEC.md §3.5, §13).
 *
 * Adds the `loopback` flag column to oauth_clients and SEEDS every first-party
 * public client_id so desktop/CLI/web products can authenticate against the one
 * origin without a manual DB write (the §13 "register-client" onboarding blocker).
 * All first-party clients are PUBLIC (PKCE-S256; client_secret decorative, L3).
 *
 * Desktop/native clients are `loopback = true`: they receive the OAuth callback on
 * an ephemeral 127.0.0.1 / [::1] port (RFC 8252), matched by PATH via the provider's
 * loopback-flex redirect check. Web is exact-match.
 *
 * Idempotent: IF NOT EXISTS + INSERT … ON CONFLICT DO UPDATE. Safe to re-run.
 *
 *   node database/migrate-oidc-clients.js
 */
import pg from 'pg';

const { Pool } = pg;

// slug → { name, loopback, redirects, scopes, surface }. Redirects for loopback
// clients register the canonical 127.0.0.1 / [::1] callback PATH (any port matches).
const LOOPBACK_CB = ['http://127.0.0.1/callback', 'http://[::1]/callback'];
const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'ledger'];

const CLIENTS = [
  // Desktop / Electron (loopback PKCE)
  { id: 'xeno-hub', name: 'XENO Hub', loopback: true },
  { id: 'xeno-pixel', name: 'XENO Pixel', loopback: true },
  { id: 'xeno-motion', name: 'XENO Motion', loopback: true },
  { id: 'xeno-sound', name: 'XENO Sound', loopback: true },
  { id: 'xeno-canvas', name: 'XENO Canvas', loopback: true },
  { id: 'xeno-browser', name: 'XENO Browser', loopback: true },
  { id: 'xeno-rt', name: 'XENO RT', loopback: true },
  // CLI (device grant + loopback PKCE)
  { id: 'xeno-agent-cli', name: 'XENO Agent CLI', loopback: true },
  // Web (exact-match redirect; the SPA handles OIDC in-browser)
  { id: 'xeno-web', name: 'XENO Web', loopback: false, redirects: ['https://xenostudio.ai/auth/callback'] },
  // Mobile (registered ahead of build; app-scheme redirect)
  { id: 'xeno-mobile-ios', name: 'XENO (iOS)', loopback: false, redirects: ['ai.xenostudio.app://auth/callback'] },
  { id: 'xeno-mobile-android', name: 'XENO (Android)', loopback: false, redirects: ['ai.xenostudio.app://auth/callback'] },
];

const SQL = `
ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS loopback boolean NOT NULL DEFAULT false;
`;

export async function migrateOidcClients(pool) {
  await pool.query(SQL);
  for (const c of CLIENTS) {
    const redirects = c.loopback ? LOOPBACK_CB : c.redirects || [];
    await pool.query(
      `INSERT INTO oauth_clients (client_id, client_secret, name, redirect_uris, allowed_scopes, surface, is_first_party, loopback)
       VALUES ($1, NULL, $2, $3, $4, $5, true, $6)
       ON CONFLICT (client_id) DO UPDATE SET
         name = EXCLUDED.name,
         redirect_uris = EXCLUDED.redirect_uris,
         allowed_scopes = EXCLUDED.allowed_scopes,
         surface = EXCLUDED.surface,
         is_first_party = true,
         loopback = EXCLUDED.loopback`,
      [c.id, c.name, redirects, DEFAULT_SCOPES, c.id, c.loopback],
    );
  }
}

// Allow running standalone.
if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    database: process.env.DB_NAME || process.env.POSTGRES_DB,
    user: process.env.DB_USER || process.env.POSTGRES_USER,
    password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD,
  });
  migrateOidcClients(pool)
    .then(() => {
      console.log(`✅ OIDC first-party clients seeded (${CLIENTS.length}), loopback column added`);
      return pool.end();
    })
    .catch((err) => {
      console.error('❌ oidc-clients migration failed:', err.message);
      process.exit(1);
    });
}
