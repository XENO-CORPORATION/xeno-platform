import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import express from 'express';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import oauth2Router from '../routes/oauth2Routes.js';
import { jwkThumbprint, verifyDpopProof, accessTokenHash } from '../utils/dpop.js';
import {
  brokerExchangeRequestHash,
  createAuthorizationCode,
  enrollBrokerInstallation,
  exchangeAuthorizationCode,
  getSigningKey,
  tokenExchangeGrant,
  verifyAccessToken,
} from '../utils/oidcProvider.js';

const TOKEN_URL = 'https://xenostudio.ai/api/oauth2/token';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function keyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, publicJwk: publicKey.export({ format: 'jwk' }) };
}

function proof(key, { htm = 'POST', htu = TOKEN_URL, accessToken = null, jti = crypto.randomUUID(), iat = Math.floor(Date.now() / 1000) } = {}) {
  return jwt.sign(
    { jti, htm, htu, iat, ...(accessToken ? { ath: accessTokenHash(accessToken) } : {}) },
    key.privateKey,
    { algorithm: 'ES256', header: { typ: 'dpop+jwt', alg: 'ES256', jwk: key.publicJwk } },
  );
}

async function setup() {
  await pool.query('CREATE TABLE credit_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, reference_type varchar(64), reference_id varchar(128))');
  await pool.query('CREATE TABLE external_identity_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_system varchar(64) NOT NULL, external_user_id text, external_email text, platform_user_id uuid NOT NULL, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())');
  await migrateAccountV2(pool);
  await pool.query('CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, username text, display_name text, avatar_url text, email_verified boolean DEFAULT true, is_active boolean DEFAULT true)');
  const user = await pool.query("INSERT INTO users (email, username, display_name) VALUES ('hub@xeno.test','hubuser','Hub User') RETURNING id");
  await pool.query(
    `INSERT INTO oauth_clients (client_id, name, redirect_uris, allowed_scopes, surface, is_first_party)
     VALUES
       ('xeno-hub','XENO Hub',ARRAY['http://127.0.0.1/callback'],ARRAY['openid','profile','broker:enroll','broker:exchange','inference:run','ledger:read','ledger:spend'],'xeno-hub',true),
       ('xeno-pixel','XENO Pixel',ARRAY['http://127.0.0.1/callback'],ARRAY['openid','profile','inference:run','ledger:read','ledger:spend'],'xeno-pixel',true)`,
  );
  return user.rows[0].id;
}

async function main() {
  const userId = await setup();
  const hubKey = keyPair();
  const hubJkt = jwkThumbprint(hubKey.publicJwk);
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const code = await createAuthorizationCode(pool, {
    clientId: 'xeno-hub', userId, redirectUri: 'http://127.0.0.1/callback',
    scope: 'openid profile broker:enroll broker:exchange inference:run ledger:read ledger:spend',
    codeChallenge: challenge,
  });
  const hubTokens = await exchangeAuthorizationCode(pool, {
    code, clientId: 'xeno-hub', redirectUri: 'http://127.0.0.1/callback', codeVerifier: verifier, dpopJkt: hubJkt,
  });
  assert.equal(hubTokens.token_type, 'DPoP');
  const hubPayload = await verifyAccessToken(pool, hubTokens.access_token);
  assert.equal(hubPayload.cnf.jkt, hubJkt);

  const installKey = keyPair();
  const installation = await enrollBrokerInstallation(pool, { userId, publicKeyJwk: installKey.publicJwk });
  const childKey = keyPair();
  const childJkt = jwkThumbprint(childKey.publicJwk);
  const scope = 'inference:run ledger:read ledger:spend';
  const requestHash = brokerExchangeRequestHash({
    subjectToken: hubTokens.access_token, childClientId: 'xeno-pixel', childJkt,
    resource: 'https://api.xenostudio.ai', audience: 'xeno-api', scope,
  });
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: 'xeno-hub-broker', sub: userId, aud: TOKEN_URL, installation_id: installation.installation_id,
      subject_sid: hubPayload.sid, request_hash: requestHash, child_client_id: 'xeno-pixel',
      package_identity: 'xeno-pixel', child_jkt: childJkt, resource: 'https://api.xenostudio.ai',
      scope, jti: crypto.randomUUID(), iat: now, exp: now + 30,
    },
    installKey.privateKey,
    { algorithm: 'ES256', keyid: installation.installation_id, header: { typ: 'xeno-broker+jwt' } },
  );

  const hubProof = proof(hubKey, { accessToken: hubTokens.access_token });
  const verifiedHubProof = await verifyDpopProof(pool, {
    proof: hubProof, method: 'POST', url: TOKEN_URL, accessToken: hubTokens.access_token, requiredJkt: hubJkt,
  });
  const exchanged = await tokenExchangeGrant(pool, {
    subjectToken: hubTokens.access_token, subjectPayload: hubPayload, hubDpopJkt: verifiedHubProof.jkt,
    subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token',
    requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
    resource: 'https://api.xenostudio.ai', audience: 'xeno-api', scope,
    childClientId: 'xeno-pixel', childPublicJwk: childKey.publicJwk, brokerAssertion: assertion,
  });
  assert.equal(exchanged.token_type, 'DPoP');
  assert.equal(exchanged.refresh_token, undefined);
  assert.ok(exchanged.expires_in <= 120);
  const signing = await getSigningKey(pool);
  const claims = jwt.verify(exchanged.access_token, crypto.createPublicKey(signing.privatePem), { algorithms: ['ES256'] });
  assert.equal(claims.aud, 'xeno-api');
  assert.equal(claims.client_id, 'xeno-pixel');
  assert.equal(claims.azp, 'xeno-pixel');
  assert.equal(claims.act.client_id, 'xeno-hub');
  assert.equal(claims.cnf.jkt, childJkt);
  assert.deepEqual(new Set(claims.scope.split(' ')), new Set(scope.split(' ')));

  const gatewayUrl = 'https://api.xenostudio.ai/v1/chat/completions';
  const childProof = proof(childKey, { htu: gatewayUrl, accessToken: exchanged.access_token });
  const verifiedChild = await verifyDpopProof(pool, {
    proof: childProof, method: 'POST', url: gatewayUrl, accessToken: exchanged.access_token, requiredJkt: claims.cnf.jkt,
  });
  assert.equal(verifiedChild.jkt, childJkt);

  // Exercise the real HTTP grant dispatch as well as the provider function.
  const assertion2 = jwt.sign(
    {
      iss: 'xeno-hub-broker', sub: userId, aud: TOKEN_URL, installation_id: installation.installation_id,
      subject_sid: hubPayload.sid, request_hash: requestHash, child_client_id: 'xeno-pixel',
      package_identity: 'xeno-pixel', child_jkt: childJkt, resource: 'https://api.xenostudio.ai',
      scope, jti: crypto.randomUUID(), iat: now, exp: now + 30,
    },
    installKey.privateKey,
    { algorithm: 'ES256', keyid: installation.installation_id, header: { typ: 'xeno-broker+jwt' } },
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/oauth2', oauth2Router);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const localPort = server.address().port;
  const routeResponse = await fetch(`http://127.0.0.1:${localPort}/api/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `DPoP ${hubTokens.access_token}`,
      dpop: proof(hubKey, { accessToken: hubTokens.access_token }),
    },
    body: JSON.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: hubTokens.access_token,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      resource: 'https://api.xenostudio.ai', audience: 'xeno-api', scope,
      child_client_id: 'xeno-pixel', child_jwk: childKey.publicJwk, broker_assertion: assertion2,
    }),
  });
  const routeTokens = await routeResponse.json();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(routeResponse.status, 200, JSON.stringify(routeTokens));
  assert.equal(routeTokens.token_type, 'DPoP');
  assert.equal(routeTokens.refresh_token, undefined);

  await assert.rejects(
    verifyDpopProof(pool, { proof: childProof, method: 'POST', url: gatewayUrl, accessToken: exchanged.access_token, requiredJkt: childJkt }),
    /replayed/,
  );
  await assert.rejects(
    verifyDpopProof(pool, {
      proof: proof(keyPair(), { accessToken: hubTokens.access_token }), method: 'POST', url: TOKEN_URL,
      accessToken: hubTokens.access_token, requiredJkt: hubJkt,
    }),
    /sender constraint/,
  );
  await assert.rejects(
    tokenExchangeGrant(pool, {
      subjectToken: hubTokens.access_token, subjectPayload: hubPayload, hubDpopJkt: hubJkt,
      subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token', requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      resource: 'https://api.xenostudio.ai', audience: 'xeno-api', scope: 'billing:manage',
      childClientId: 'xeno-pixel', childPublicJwk: childKey.publicJwk, brokerAssertion: assertion,
    }),
    /scope exceeds policy/,
  );
  await assert.rejects(
    tokenExchangeGrant(pool, {
      subjectToken: hubTokens.access_token, subjectPayload: hubPayload, hubDpopJkt: hubJkt,
      subjectTokenType: 'urn:ietf:params:oauth:token-type:access_token', requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      resource: 'https://api.xenostudio.ai', audience: 'xeno-api', scope,
      childClientId: 'xeno-pixel', childPublicJwk: childKey.publicJwk, brokerAssertion: assertion,
    }),
    /replayed/,
  );

  console.log('✅ DPoP + broker token exchange: sender, actor, scope, lifetime, and replay gates passed');
  await pool.end();
}

main().catch(async (error) => {
  console.error('FATAL', error);
  await pool.end().catch(() => {});
  process.exit(1);
});
