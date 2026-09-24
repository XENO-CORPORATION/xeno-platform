/**
 * PROOF against a REAL Postgres: the product_access_policy migration applies through the
 * production migration runner, seeds Canvas, refuses a bad value, and the route's verdict
 * reads it correctly — including after an operator changes the row.
 *
 *   DATABASE_URL=postgresql://… node scripts/product-access-db.proof.mjs
 *
 * Exit code is the verdict. Point it only at a disposable database: it runs every migration.
 */
import assert from 'node:assert/strict';
import pg from 'pg';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'product-access-db-proof';
const url = process.env.DATABASE_URL;
if (!url || !/127\.0\.0\.1|localhost/.test(url)) {
  console.error('refusing: DATABASE_URL must point at a local disposable database');
  process.exit(2);
}

const { runAllMigrations } = await import('../src/server/services/migrationRunner.js');
const { productAccessFor, loadProductPolicy } = await import('../src/server/services/productAccess.js');
const { entitlementsFor } = await import('../src/server/services/billingService.js');

const pool = new pg.Pool({ connectionString: url });
const results = [];
const check = async (label, fn) => {
  try { await fn(); results.push([label, true]); console.log(`ok   ${label}`); }
  catch (e) { results.push([label, false]); console.log(`FAIL ${label} — ${e.message}`); }
};

try {
  await runAllMigrations(pool);

  await check('the migration applied through the production runner', async () => {
    const r = await pool.query("SELECT 1 FROM schema_migrations WHERE version = '20260925090000'");
    assert.equal(r.rowCount, 1);
  });
  await check('Canvas is seeded paid-plan', async () => {
    const p = await loadProductPolicy(pool, 'canvas');
    assert.equal(p?.access, 'paid-plan');
  });
  await check('no other product is seeded — every other door is unchanged', async () => {
    const r = await pool.query('SELECT product FROM product_access_policy');
    assert.deepEqual(r.rows.map((x) => x.product), ['canvas']);
  });
  await check('the CHECK constraint refuses a value the code does not know', async () => {
    await assert.rejects(pool.query("INSERT INTO product_access_policy (product, access) VALUES ('pixel', 'everyone')"), /check constraint/i);
  });
  const req = (h) => ({ headers: h, db: pool });
  await check('a free account is refused Canvas; a paid one is admitted', async () => {
    assert.equal((await productAccessFor(req({ 'x-xeno-client': 'canvas/0.40.0' }), entitlementsFor('free'))).allowed, false);
    assert.equal((await productAccessFor(req({ 'x-xeno-client': 'canvas/0.40.0' }), entitlementsFor('pro'))).allowed, true);
  });
  await check('an operator flipping the row to `account` takes effect on the next check — no cache', async () => {
    await pool.query("UPDATE product_access_policy SET access = 'account' WHERE product = 'canvas'");
    assert.equal((await productAccessFor(req({ 'x-xeno-client': 'canvas/0.40.0' }), entitlementsFor('free'))).allowed, true);
  });
  await check('re-running the migrations never overwrites that operator decision', async () => {
    await pool.query("DELETE FROM schema_migrations WHERE version = '20260925090000'");
    await runAllMigrations(pool);
    assert.equal((await loadProductPolicy(pool, 'canvas'))?.access, 'account');
  });
} finally {
  await pool.end();
}

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
