/**
 * gateway_model_aliases.provider follows the gateway's catalogue — real
 * Postgres (the real migrations, so the seeded prefix-guess rows are present),
 * a fake gateway on loopback, the real sync.
 *
 * Mutation: make applyCatalogue skip the ON CONFLICT update -> "a seeded
 * 'unknown' row is corrected" fails. Touch `enabled` from `routable` ->
 * "routable=false never disables a model" fails. Drop the shape check ->
 * "a malformed catalogue writes nothing" fails.
 */
import http from 'node:http';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { syncGatewayCatalogue, parseCatalogue } from '../services/gatewayCatalogueSync.js';
import { credentialServesModel } from '../services/providerCredentials.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const TOKEN = 'test-grant-token';

let body = null; let seenAuth = null; let hits = 0;
const gw = http.createServer((req, res) => {
  hits += 1; seenAuth = req.headers.authorization;
  if (seenAuth !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end(); }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
});

async function main() {
  await runAllMigrations(pool);
  await new Promise((r) => gw.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${gw.address().port}/internal/catalogue/models`;
  const row = async (id) => (await pool.query('SELECT provider, internal_id, enabled, is_alias FROM gateway_model_aliases WHERE public_id=$1', [id])).rows[0];

  try {
    // Seeded state: a hand-curated alias and a prefix-guess 'unknown' row.
    await pool.query(`INSERT INTO gateway_model_aliases (public_id, internal_id, provider, is_alias) VALUES
      ('claude-opus-4.6', 'claude-opus-4-6', 'anthropic', true), ('muse-spark-1', 'muse-spark-1', 'unknown', false),
      ('seedance-2', 'seedance-2.0', 'unknown', true), ('orphan-alias', 'nobody-serves-this', 'unknown', true)
      ON CONFLICT (public_id) DO UPDATE SET provider = EXCLUDED.provider`);
    await pool.query(`UPDATE gateway_model_aliases SET enabled = false WHERE public_id = 'claude-opus-4.6'`);

    // ── unconfigured: says so, touches nothing ──
    const before = (await pool.query('SELECT count(*)::int n FROM gateway_model_aliases')).rows[0].n;
    const off = await syncGatewayCatalogue(pool, { INFERENCE_GRANT_TOKEN: TOKEN });
    ok(off.skipped && hits === 0, `no URL → skipped (${off.skipped}), gateway never called`);

    // ── a real sync ──
    body = { generated_at: new Date().toISOString(), models: [
      { id: 'gpt-5.5', provider: 'openai', type: 'chat', routable: true },
      { id: 'claude-opus-4-6', provider: 'anthropic', type: 'chat', routable: false },
      { id: 'muse-spark-1', provider: 'xeno', type: 'chat', routable: true },
      { id: 'claude-opus-4.6', provider: 'anthropic', type: 'chat', routable: true },
      { id: 'seedance-2.0', provider: 'byteplus', type: 'video', routable: true },
      { id: 'bad id with spaces', provider: 'openai' }, { id: 'x', provider: 'Not A Provider!' }, null,
    ] };
    const r = await syncGatewayCatalogue(pool, { INFERENCE_CATALOGUE_URL: url, INFERENCE_GRANT_TOKEN: TOKEN });
    ok(seenAuth === `Bearer ${TOKEN}`, 'the sync authenticates with the shared grant token');
    // claude-opus-4-6 is seeded by the registry migration, so only gpt-5.5 is new.
    // claude-opus-4-6 and seedance-2.0 are seeded by the registry migration; only gpt-5.5 is new.
    ok(r.total === 5 && r.inserted === 1, `5 usable rows of 8 (${r.total}); 1 inserted (${r.inserted})`);
    const gpt = await row('gpt-5.5');
    ok(gpt && gpt.provider === 'openai' && gpt.internal_id === 'gpt-5.5' && gpt.is_alias === false && gpt.enabled === true, 'a new id lands as an enabled identity alias with its provider');
    const opus = await row('claude-opus-4-6');
    ok(opus && opus.enabled === true, 'routable=false never disables a model (liveness is not membership)');
    const muse = await row('muse-spark-1');
    ok(muse && muse.provider === 'xeno' && r.updated >= 1, "a seeded 'unknown' row is corrected from the catalogue");
    const alias = await row('claude-opus-4.6');
    ok(alias && alias.internal_id === 'claude-opus-4-6' && alias.is_alias === true && alias.enabled === false,
      'a hand-curated alias keeps its internal_id and its enabled=false — the sync never touches either');
    const after = (await pool.query('SELECT count(*)::int n FROM gateway_model_aliases')).rows[0].n;
    ok(after === before + 1, 'rows the catalogue does not mention are left alone');
    const sd = await row('seedance-2');
    // The migration seeds further seedance aliases, so inherited is >= 1, not exactly 1.
    ok(sd && sd.provider === 'byteplus' && r.inherited >= 1, `an alias the catalogue never names inherits its TARGET's provider (${r.inherited} inherited)`);
    const orphan = await row('orphan-alias');
    ok(orphan && orphan.provider === 'unknown', "an alias whose target the catalogue does not know stays 'unknown' — never guessed");

    // ── the matcher on what just landed ──
    const anth = { provider: 'anthropic', models: null };
    const openai = { provider: 'openai', models: null };
    ok(credentialServesModel(openai, 'muse-spark-1', muse).basis === 'catalogue-mismatch', "provider 'xeno' is a catalogue-mismatch for any BYOK key");
    ok(credentialServesModel(anth, 'claude-opus-4-6', opus).basis === 'catalogue-match', 'the synced provider yields catalogue-match for the right key');
    ok(credentialServesModel(openai, 'claude-opus-4-6', opus).serves === false, '…and refuses the wrong key without attempting it');

    // ── idempotent ──
    const r2 = await syncGatewayCatalogue(pool, { INFERENCE_CATALOGUE_URL: url, INFERENCE_GRANT_TOKEN: TOKEN });
    ok(r2.inserted === 0 && r2.updated === 0 && r2.inherited === 0 && r2.unchanged === 5, 'a second identical sync changes nothing');

    // ── malformed / unauthorised: nothing written ──
    body = { models: 'nope' };
    let threw = null;
    try { await syncGatewayCatalogue(pool, { INFERENCE_CATALOGUE_URL: url, INFERENCE_GRANT_TOKEN: TOKEN }); } catch (e) { threw = e.message; }
    ok(/models is not an array/.test(threw || ''), 'a malformed catalogue is refused before any row is written');
    threw = null;
    try { await syncGatewayCatalogue(pool, { INFERENCE_CATALOGUE_URL: url, INFERENCE_GRANT_TOKEN: 'wrong' }); } catch (e) { threw = e.message; }
    ok(/HTTP 401/.test(threw || ''), 'a rejected token is an error, not an empty catalogue');
    ok((await pool.query('SELECT count(*)::int n FROM gateway_model_aliases')).rows[0].n === after, 'the failed syncs wrote nothing');
    let parseThrew = false; try { parseCatalogue({ models: [{ id: '', provider: 'openai' }] }); } catch { parseThrew = true; }
    ok(parseThrew, 'a catalogue with zero usable rows is refused (an empty catalogue is not a catalogue)');
  } finally {
    await new Promise((r) => gw.close(r));
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} gateway-catalogue-sync: ${pass} passed, ${fail} failed`);
  await pool.end();
  // No process.exit(): undici keep-alive sockets from fetch() are still closing on
  // Windows and a hard exit trips libuv's UV_HANDLE_CLOSING assertion (abort).
  process.exitCode = fail === 0 ? 0 : 1;
}
main().catch(async (e) => { console.error('FATAL', e); await pool.end().catch(() => {}); process.exit(1); });
