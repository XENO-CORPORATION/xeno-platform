/**
 * GDPR erasure vs immutable ledger (Arch §6.2): PII tombstoned, links + tokens
 * gone, but the hash-chained financial facts survive and still verify.
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55476/t node tests/erasure.test.mjs
 */
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { recordUsageV2, verifyChainV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import { eraseSubject } from '../utils/gdprErasure.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, username text, display_name text, avatar_url text, email_verified boolean DEFAULT true, is_active boolean DEFAULT true, credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS api_usage_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, surface varchar(64), operation varchar(128), model varchar(128), provider varchar(64), actual_cost_micro bigint, estimated_cost_micro bigint, input_tokens int DEFAULT 0, output_tokens int DEFAULT 0, status varchar(16), request_id varchar(128), endpoint text, method varchar(8), created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS external_identity_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system varchar(64) NOT NULL, external_user_id text, external_email text, platform_user_id uuid NOT NULL, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS user_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, token_hash varchar(255), session_token varchar(512), expires_at timestamp NOT NULL, ip_address text, user_agent text, created_at timestamp DEFAULT now());
`;

async function main() {
  await pool.query(BASE);
  await migrateAccountV2(pool);
  const u = await pool.query("INSERT INTO users (email, username, display_name, credits) VALUES ('jane@real.example','jane','Jane Doe',10) RETURNING id");
  const userId = u.rows[0].id;
  await pool.query("INSERT INTO external_identity_links (source_system, external_email, platform_user_id) VALUES ('xeno_post','jane@real.example',$1)", [userId]);
  // Session rows carry PII (ip, user-agent) and — legacy rows — a PLAINTEXT JWT.
  await pool.query(
    "INSERT INTO user_sessions (user_id, token_hash, session_token, expires_at, ip_address, user_agent) VALUES ($1,'deadbeef','LEGACY.PLAINTEXT.JWT', now()+interval '7 days', '203.0.113.7', 'JaneBrowser/1.0')",
    [userId],
  );
  await recordUsageV2(pool, userId, { transactionId: 'e1', surface: 'xeno_post', operation: 'ai.x', costMicro: 3 * MICRO_PER_CREDIT });

  const before = await verifyChainV2(pool, userId);
  ok(before.ok && before.entries === 1, 'ledger chain intact before erasure');

  const r = await eraseSubject(pool, userId);
  ok(r.erased && r.linksRemoved === 1, 'erase: PII links removed');

  const usr = (await pool.query('SELECT email, display_name, username, is_active FROM users WHERE id=$1', [userId])).rows[0];
  ok(usr.email.includes('@erased.invalid') && usr.display_name === 'Erased User' && usr.username.startsWith('erased_') && usr.is_active === false, 'user PII tombstoned to non-identifying sentinels, deactivated');
  ok((await pool.query('SELECT count(*)::int n FROM external_identity_links WHERE platform_user_id=$1', [userId])).rows[0].n === 0, 'identity links gone');
  ok((await pool.query('SELECT count(*)::int n FROM user_sessions WHERE user_id=$1', [userId])).rows[0].n === 0, 'session rows gone (ip/user-agent/plaintext-token PII erased, tokens revoked)');

  // The financial facts survive AND the chain still verifies.
  const txns = (await pool.query('SELECT count(*)::int n FROM credit_transactions WHERE user_id=$1', [userId])).rows[0].n;
  ok(txns === 1, 'ledger facts PRESERVED (financial record survives erasure)');
  const after = await verifyChainV2(pool, userId);
  ok(after.ok && after.entries === 1, 'hash chain STILL verifies after erasure (no PII in the chain)');

  console.log(`\n${fail === 0 ? '✅' : '❌'} erasure: ${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
