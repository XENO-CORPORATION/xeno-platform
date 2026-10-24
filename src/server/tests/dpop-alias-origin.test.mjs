// A DPoP proof made for the platform's alias site origin (xenosystem.ai, the same backend) is the URI of the
// request and is accepted; every other origin and path is still refused (owner, 2026-10-24: move to xenosystem.ai).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { verifyDpopProof, htuMatches, accessTokenHash } from '../utils/dpop.js';

const ISSUER_URL = 'https://xenostudio.ai/api/oauth2/token';
const db = { replays: new Set(), async query(sql, params) { if (/INSERT/.test(sql)) { const k = `${params[0]}:${params[1]}`; if (this.replays.has(k)) throw Object.assign(new Error('dup'), { code: '23505' }); this.replays.add(k); } return { rowCount: 1 }; } };
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const proof = (htu) => jwt.sign({ jti: crypto.randomUUID(), htm: 'POST', htu, iat: Math.floor(Date.now() / 1000) }, privateKey,
  { algorithm: 'ES256', header: { typ: 'dpop+jwt', alg: 'ES256', jwk: publicKey.export({ format: 'jwk' }) } });
const verify = (htu) => verifyDpopProof(db, { proof: proof(htu), method: 'POST', url: ISSUER_URL });
const refused = async (htu, why) => assert.rejects(verify(htu), /htu mismatch/, why);

const run = async () => {
  delete process.env.XENO_ALIAS_SITE_ORIGINS;
  await verify(ISSUER_URL);
  await refused('https://xenosystem.ai/api/oauth2/token', 'no alias configured: the new host is refused, exactly as before');

  process.env.XENO_ALIAS_SITE_ORIGINS = 'https://xenosystem.ai';
  await verify(ISSUER_URL);
  await verify('https://xenosystem.ai/api/oauth2/token');
  await verify('https://XENOSYSTEM.ai:443/api/oauth2/token');
  await refused('https://xenosystem.ai/api/oauth2/revoke', 'same alias origin, different path');
  await refused('https://evil.example/api/oauth2/token', 'an origin that is not ours');
  await refused('https://api.xenosystem.ai/api/oauth2/token', 'a sibling host is not the alias origin');
  assert.equal(htuMatches('https://xenosystem.ai/a', 'https://xenostudio.ai/b'), false);
  void accessTokenHash;
  console.log('dpop-alias-origin: 8 checks passed');
};
run().catch((e) => { console.error(e); process.exit(1); });
