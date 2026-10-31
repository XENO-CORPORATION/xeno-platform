/**
 * Spawn's account routes hold a key-bound (DPoP) token to its proof — the same mount index.js uses
 * (databaseMiddleware → oidcAuth → requireDpopIfBound → the route), against a real Postgres.
 *
 *   - a bound token without its proof is refused; with a proof whose htu is the issuer form, or the xenosystem.ai alias
 *     form Spawn sends (the host it actually calls), it passes; a proof for another path is refused
 *   - an unbound (legacy) token is unaffected
 *
 *   node src/server/tests/spawn-routes-dpop.test.mjs   (DATABASE_URL = a disposable database)
 */
import crypto from 'node:crypto';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import express from 'express';

process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
process.env.XENO_ALIAS_SITE_ORIGINS = 'https://xenosystem.ai';
const { runAllMigrations } = await import('../services/migrationRunner.js');
const { migrateAccountV2 } = await import('../database/migrate-account-v2.js');
const { oidcAuth } = await import('../middleware/oidcAuth.js');
const { requireDpopIfBound } = await import('../middleware/dpopResource.js');
const spawnDeviceRoutes = (await import('../routes/spawnDeviceRoutes.js')).default;
const { startDeviceAuthorization, approveDevice, deviceTokenGrant } = await import('../utils/oidcProvider.js');
const { jwkThumbprint, accessTokenHash } = await import('../utils/dpop.js');
const { issuer } = await import('../config/hosts.js');

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  const tag = `sdp${Date.now().toString(36)}`;
  const u = (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$1,true,true,'x') RETURNING id`, [tag, `${tag}@xeno.test`])).rows[0].id;
  await pool.query(`INSERT INTO oauth_clients (client_id, name, redirect_uris, allowed_scopes, surface, is_first_party) VALUES ($1,'Spawn test',ARRAY['http://127.0.0.1/cb'],ARRAY['openid','profile','email','offline_access'],$1,true) ON CONFLICT DO NOTHING`, [`${tag}-spawn`]);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pub = publicKey.export({ format: 'jwk' });
  const d = await startDeviceAuthorization(pool, { clientId: `${tag}-spawn`, scope: 'openid profile email offline_access' });
  await approveDevice(pool, { userCode: d.user_code, userId: u });
  const bound = (await deviceTokenGrant(pool, { deviceCode: d.device_code, clientId: `${tag}-spawn`, dpopJkt: jwkThumbprint(pub) })).access_token;
  const proof = (htu) => jwt.sign({ jti: crypto.randomUUID(), htm: 'GET', htu, iat: Math.floor(Date.now() / 1000), ath: accessTokenHash(bound) }, privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', alg: 'ES256', jwk: pub } });
  const app = express();
  app.use('/api/v2/spawn/devices', (req, _r, next) => { req.db = pool; next(); }, oidcAuth, requireDpopIfBound, spawnDeviceRoutes);
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const get = (headers) => fetch(`http://127.0.0.1:${srv.address().port}/api/v2/spawn/devices`, { headers }).then((r) => r.status);

  check(await get({ authorization: `Bearer ${bound}` }) === 401, 'a bound token sent as plain Bearer is refused');
  check(await get({ authorization: `DPoP ${bound}` }) === 401, 'a bound token without a proof is refused');
  check(await get({ authorization: `DPoP ${bound}`, dpop: proof(`${issuer()}/api/v2/spawn/devices`) }) === 200, 'with a proof on the issuer form it passes');
  check(await get({ authorization: `DPoP ${bound}`, dpop: proof('https://xenosystem.ai/api/v2/spawn/devices') }) === 200, 'with a proof on the host Spawn calls (xenosystem.ai) it passes');
  check(await get({ authorization: `DPoP ${bound}`, dpop: proof('https://xenosystem.ai/api/v2/spawn/profiles') }) === 401, 'a proof for another path is refused');
  const legacy = jwt.sign({ userId: u }, process.env.JWT_SECRET, { expiresIn: '5m' });
  check(await get({ authorization: `Bearer ${legacy}` }) === 200, 'an unbound token is unaffected');
  srv.close();
  console.log(`\nspawn-routes-dpop: ${passed} checks passed`);
}
main().then(() => pool.end(), (e) => { console.error(e); process.exit(1); });
