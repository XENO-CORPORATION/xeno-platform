/**
 * GDPR erasure vs immutable ledger (Arch §6.2): PII tombstoned, links + tokens
 * gone, but the hash-chained financial facts survive and still verify.
 * Run: DATABASE_URL=postgresql://t:t@127.0.0.1:55476/t node tests/erasure.test.mjs
 */
import pg from 'pg';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { recordUsageV2, verifyChainV2, MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import { eraseSubject } from '../utils/gdprErasure.js';
import { tablesDDL } from './fixtures/schema.mjs';
import { installUsageCreditFixture, optInUsageCredits } from './usage-credit-fixture.mjs';
import { encrypt } from '../utils/secretBox.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

const BASE = `
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, username text, display_name text, avatar_url text, email_verified boolean DEFAULT true, is_active boolean DEFAULT true, credits bigint DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, balance bigint DEFAULT 0, lifetime_earned bigint DEFAULT 0, lifetime_spent bigint DEFAULT 0, is_frozen boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, account_id uuid, type varchar(32), amount bigint, balance_after bigint, reference_type varchar(64), reference_id varchar(128), description text, metadata jsonb, prev_hash text, entry_hash text, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS external_identity_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system varchar(64) NOT NULL, external_user_id text, external_email text, platform_user_id uuid NOT NULL, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
`;

async function main() {
  await pool.query(BASE);
  // api_usage_logs from the MIGRATIONS (fixtures/schema.mjs): its shape is production's, incl. `dimensions`.
  await pool.query(tablesDDL('api_usage_logs'));
  // From the MIGRATIONS. user_sessions and the forum tables are declared once,
  // in the files production is built from, so a new column cannot drift out of
  // this fixture the way last_active_at and the forum tables both did.
  //
  // Order matters: forum_threads has an FK to forum_spaces, and forum_posts to
  // forum_threads. Naming them in dependency order is the price of not running
  // all 42 tables — and it is visible, which is the point.
  await pool.query(tablesDDL('user_sessions', 'forum_spaces', 'forum_threads', 'forum_posts', 'api_keys', 'email_logs', 'email_verifications', 'security_events', 'agent_identities'));
  await migrateAccountV2(pool);
  // This suite builds its own schema rather than running the full migration set,
  // so the usage-credit consent tables are not here. Spending now consults them,
  // and a missing table is a hard error rather than a default. Opt in explicitly:
  // the subject under test is GDPR erasure against the hash chain, not consent.
  await installUsageCreditFixture(pool);
  const u = await pool.query("INSERT INTO users (email, username, display_name, credits) VALUES ('jane@real.example','jane','Jane Doe',10) RETURNING id");
  const userId = u.rows[0].id;
  await optInUsageCredits(pool, userId);
  await pool.query("INSERT INTO external_identity_links (source_system, external_email, platform_user_id) VALUES ('xeno_post','jane@real.example',$1)", [userId]);
  // Session rows carry PII (ip, user-agent) and — legacy rows — a PLAINTEXT JWT.
  await pool.query(
    "INSERT INTO user_sessions (user_id, token_hash, session_token, expires_at, ip_address, user_agent) VALUES ($1,'deadbeef','LEGACY.PLAINTEXT.JWT', now()+interval '7 days', '203.0.113.7', 'JaneBrowser/1.0')",
    [userId],
  );
  await recordUsageV2(pool, userId, { transactionId: 'e1', surface: 'xeno_post', operation: 'ai.x', costMicro: 3 * MICRO_PER_CREDIT });

  // ── THE VAULT. Erasure tombstones `users`, so FK cascades never fire — measured
  //    2026-09-17: a provider key would have survived. Seed the whole graph a real
  //    BYOK user has: a sealed credential, a route pointing at it (ON DELETE
  //    RESTRICT — a live product must never lose its key by cascade), a spent
  //    grant, and a usage row carrying PII next to the facts.
  await pool.query(`CREATE TABLE IF NOT EXISTS user_provider_credentials (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider varchar(32) NOT NULL, label varchar(64) NOT NULL, secret_encrypted text NOT NULL,
      key_fingerprint char(16) NOT NULL, status varchar(16) NOT NULL DEFAULT 'active', created_at timestamptz DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS inference_routes (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, surface varchar(64) NOT NULL, path varchar(16) NOT NULL,
      credential_id uuid REFERENCES user_provider_credentials(id) ON DELETE RESTRICT, PRIMARY KEY (user_id, surface))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS inference_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id uuid NOT NULL REFERENCES user_provider_credentials(id) ON DELETE CASCADE, spent_at timestamptz)`);
  const cred = (await pool.query(
    `INSERT INTO user_provider_credentials (user_id, provider, label, secret_encrypted, key_fingerprint)
     VALUES ($1,'openai','k',$2,'0123456789abcdef') RETURNING id`, [userId, encrypt('sk-erase-me-' + 'x'.repeat(24))],
  )).rows[0].id;
  await pool.query(`INSERT INTO inference_routes (user_id, surface, path, credential_id) VALUES ($1,'*','byok',$2)`, [userId, cred]);
  await pool.query(`INSERT INTO inference_grants (user_id, credential_id, spent_at) VALUES ($1,$2,now())`, [userId, cred]);
  await pool.query(`UPDATE api_usage_logs SET ip_address='203.0.113.9', user_agent='JaneBrowser/1.0', request_params='{"prompt":"my address is 1 Main St"}' WHERE user_id=$1`, [userId]);

  // ── What a real account leaves behind (F23, 2026-09-17): a developer key, mail
  //    rows with the address, a verification token, security rows with ip/UA, and
  //    an AGENT — a subject of its own, with a key, whose handle embeds the owner.
  await pool.query(`INSERT INTO api_keys (user_id, name, key_prefix, key_hash, is_active) VALUES ($1, 'dev', 'xeno-prefix-0001', 'hash1', true)`, [userId]);
  await pool.query(`INSERT INTO email_logs (user_id, to_email, template, status) VALUES ($1, 'jane@real.example', 'email_verification', 'sent')`, [userId]);
  await pool.query(`INSERT INTO email_verifications (user_id, email, token_hash, expires_at) VALUES ($1, 'jane@real.example', 'tok', now() + interval '1 day')`, [userId]);
  await pool.query(`INSERT INTO security_events (user_id, event_type, ip_address, user_agent) VALUES ($1, 'login_success', '203.0.113.7', 'JaneBrowser/1.0')`, [userId]);
  const agentId = (await pool.query("INSERT INTO users (email, username, display_name, credits) VALUES ('bot.jane@agents.invalid','bot.jane','bot.jane',0) RETURNING id")).rows[0].id;
  await pool.query(`INSERT INTO agent_identities (user_id, owner_user_id, agent_role, agent_origin, status) VALUES ($1, $2, 'other', 'manual', 'active')`, [agentId, userId]);
  await pool.query(`INSERT INTO api_keys (user_id, name, key_prefix, key_hash, is_active) VALUES ($1, 'agent', 'xk_prefix-000002', 'hash2', true)`, [agentId]);

  const before = await verifyChainV2(pool, userId);
  ok(before.ok && before.entries === 1, 'ledger chain intact before erasure');

  const r = await eraseSubject(pool, userId);
  const vault = await pool.query('SELECT count(*)::int AS n FROM user_provider_credentials WHERE user_id=$1', [userId]);
  ok(vault.rows[0].n === 0 && r.providerCredentialsRemoved === 1, 'erase: the provider key is GONE from the vault (Art. 17 reaches the secret)');
  const routes = await pool.query('SELECT count(*)::int AS n FROM inference_routes WHERE user_id=$1', [userId]);
  ok(routes.rows[0].n === 0 && r.routesRemoved === 1, 'erase: routes removed first (RESTRICT FK), then the credential');
  const grants = await pool.query('SELECT count(*)::int AS n FROM inference_grants WHERE user_id=$1', [userId]);
  ok(grants.rows[0].n === 0, 'erase: grants cascaded with the credential');
  const scrub = await pool.query('SELECT ip_address, user_agent, request_params, actual_cost_micro FROM api_usage_logs WHERE user_id=$1 LIMIT 1', [userId]);
  ok(scrub.rows[0] && scrub.rows[0].ip_address === null && scrub.rows[0].user_agent === null && scrub.rows[0].request_params === null,
    'erase: usage-row PII (ip, user-agent, prompt params) scrubbed');
  ok(scrub.rows[0] && Number(scrub.rows[0].actual_cost_micro) > 0 && r.usageRowsScrubbed >= 1,
    'erase: the usage FACTS (cost, tokens) are kept — segregation, like the ledger');

  ok(r.erased && r.linksRemoved === 1, 'erase: PII links removed');
  ok(r.keysRevoked === 1 && (await pool.query('SELECT bool_and(NOT is_active) AS dead FROM api_keys WHERE user_id=$1', [userId])).rows[0].dead === true, 'erase: the developer key is revoked');
  ok((await pool.query("SELECT to_email FROM email_logs WHERE user_id=$1", [userId])).rows.every((x) => /@erased\.invalid$/.test(x.to_email)), 'erase: e-mail log rows keep the delivery fact and lose the address');
  ok((await pool.query('SELECT count(*)::int n FROM email_verifications WHERE user_id=$1', [userId])).rows[0].n === 0, 'erase: verification tokens gone');
  const sec = (await pool.query('SELECT ip_address, user_agent, event_type FROM security_events WHERE user_id=$1', [userId])).rows[0];
  ok(sec && sec.ip_address === null && sec.user_agent === null && sec.event_type === 'login_success', 'erase: security events keep the type and lose ip / user-agent');
  ok(r.agentsErased === 1, 'erase: the owned agent was erased as a subject of its own');
  const agentRow = (await pool.query('SELECT username, is_active FROM users WHERE id=$1', [agentId])).rows[0];
  ok(agentRow && agentRow.username.startsWith('erased_') && agentRow.is_active === false, "erase: the agent's handle (which embedded the owner's name) is tombstoned and it is inactive");
  ok((await pool.query('SELECT count(*)::int n FROM agent_identities WHERE owner_user_id=$1', [userId])).rows[0].n === 0, 'erase: the ownership relation is gone');
  ok((await pool.query('SELECT bool_and(NOT is_active) AS dead FROM api_keys WHERE user_id=$1', [agentId])).rows[0].dead === true, "erase: the agent's key is revoked — nothing unowned stays alive");

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
