/**
 * fresh-db-boot.test.mjs — virgin-DB reproduction test.
 *
 * Drives a THROWAWAY database through the EXACT production startup sequence
 * (src/server/index.js runStartupMigrations) and asserts the resulting public
 * table set equals the 82-table prod set. Also re-runs the whole sequence a
 * second time to prove re-boot idempotency.
 *
 *   DATABASE_URL=postgresql://... node tests/fresh-db-boot.test.mjs
 *
 * Meant to run inside the built backend image with the updated database/ and
 * services/ dirs mounted (node_modules kept from the image).
 */
import pg from 'pg';
import { runMigrations } from '../services/migrationService.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import * as accountV2 from '../database/migrate-account-v2.js';

const migrateAccountV2 = accountV2.migrateAccountV2 || accountV2.default;

// Authoritative prod table set (pg_dump --schema-only of xenostudio, PG 15.17).
const EXPECTED = ["analytics_daily_stats","analytics_events","api_jobs","api_keys","api_usage_logs","background_jobs","billing_customers","billing_events","billing_payment_transactions","billing_project_policies","billing_projects","billing_subscriptions","billing_workspace_budgets","billing_workspace_members","billing_workspaces","blog_posts","chat_conversations","chat_messages","chat_personas","chat_share_acceptances","chat_shared_conversations","containers","credit_accounts","credit_grants","credit_holds","credit_transactions","email_logs","email_verifications","external_api_keys","external_identity_links","image_assets","image_generations","image_project_sessions","image_projects","marketplace_app_reviews","marketplace_creator_earnings","marketplace_developer_api_keys","marketplace_developers","marketplace_entitlements","marketplace_listing_pricing","marketplace_listing_versions","marketplace_listings","marketplace_payouts","marketplace_submissions","marketplace_transactions","oauth_accounts","oauth_authorization_codes","oauth_clients","oauth_device_codes","oauth_refresh_tokens","office_canvas_collaborators","office_canvases","oidc_signing_keys","password_resets","pricing_tiers","rate_limits","relationship_tuples","schema_migrations","security_events","spend_caps","tutorials","user_files","user_sessions","user_settings","user_usage","users","webhook_deliveries","webhooks","workspace_audit","workspace_invites","workspaces","xeno_account_plans","xeno_remote_run_events","xeno_remote_runs","youtube_analytics_cache","youtube_channel_group_members","youtube_channel_groups","youtube_channel_languages","youtube_channels","youtube_daily_snapshots","youtube_oauth_states","youtube_videos_cache"];

async function tableSet(pool) {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  return rows.map(r => r.table_name);
}

async function runSequence(pool, label) {
  console.log(`\n=== ${label}: runMigrations (youtube/office) ===`);
  await runMigrations(pool);
  console.log(`=== ${label}: runAllMigrations (versioned *.sql) ===`);
  await runAllMigrations(pool);
  console.log(`=== ${label}: migrateAccountV2 (account/ledger v2) ===`);
  await migrateAccountV2(pool);
}

function diff(actual) {
  const a = new Set(actual);
  const e = new Set(EXPECTED);
  const missing = EXPECTED.filter(t => !a.has(t));
  const extra = actual.filter(t => !e.has(t));
  return { missing, extra };
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let ok = true;
  try {
    // ---- FIRST BOOT (virgin DB) ----
    await runSequence(pool, 'FIRST BOOT');
    const after1 = await tableSet(pool);
    const d1 = diff(after1);
    console.log(`\n[FIRST BOOT] public tables: ${after1.length} (expected ${EXPECTED.length})`);
    console.log(`[FIRST BOOT] missing: ${JSON.stringify(d1.missing)}`);
    console.log(`[FIRST BOOT] extra:   ${JSON.stringify(d1.extra)}`);
    const pass1 = after1.length === EXPECTED.length && d1.missing.length === 0 && d1.extra.length === 0;
    console.log(`[FIRST BOOT] ${pass1 ? 'PASS ✅' : 'FAIL ❌'}`);
    ok = ok && pass1;

    // ---- SECOND BOOT (idempotency / re-boot safety) ----
    await runSequence(pool, 'SECOND BOOT');
    const after2 = await tableSet(pool);
    const d2 = diff(after2);
    console.log(`\n[SECOND BOOT] public tables: ${after2.length} (expected ${EXPECTED.length})`);
    console.log(`[SECOND BOOT] missing: ${JSON.stringify(d2.missing)}`);
    console.log(`[SECOND BOOT] extra:   ${JSON.stringify(d2.extra)}`);
    const pass2 = after2.length === EXPECTED.length && d2.missing.length === 0 && d2.extra.length === 0;
    console.log(`[SECOND BOOT] ${pass2 ? 'PASS ✅ (no already-exists errors)' : 'FAIL ❌'}`);
    ok = ok && pass2;
  } catch (err) {
    console.error('\n❌ SEQUENCE THREW:', err.message);
    console.error(err.stack);
    ok = false;
  } finally {
    await pool.end();
  }

  console.log(`\n==================== RESULT: ${ok ? 'PASS ✅' : 'FAIL ❌'} ====================`);
  process.exit(ok ? 0 : 1);
}

main();
