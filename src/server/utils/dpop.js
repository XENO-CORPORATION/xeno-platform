import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const PROOF_TTL_SEC = 120;
const CLOCK_SKEW_SEC = 60;
const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];

function invalid(description) {
  const error = new Error(description);
  error.oauthError = 'invalid_dpop_proof';
  error.statusCode = 400;
  return error;
}

export function publicJwk(jwk) {
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) throw invalid('public JWK required');
  for (const field of PRIVATE_JWK_FIELDS) {
    if (jwk[field] !== undefined) throw invalid('private JWK material forbidden');
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw invalid('only public P-256 EC keys are accepted');
  }
  return { kty: 'EC', crv: 'P-256', x: String(jwk.x), y: String(jwk.y) };
}

export function jwkThumbprint(jwk) {
  const canonical = publicJwk(jwk);
  const json = JSON.stringify({ crv: canonical.crv, kty: canonical.kty, x: canonical.x, y: canonical.y });
  return crypto.createHash('sha256').update(json).digest('base64url');
}

export function normalizeHtu(value) {
  let url;
  try { url = new URL(value); } catch { throw invalid('invalid htu'); }
  if (url.protocol !== 'https:') throw invalid('DPoP htu must use https');
  url.hash = '';
  url.search = '';
  url.username = '';
  url.password = '';
  url.hostname = url.hostname.toLowerCase();
  if (url.port === '443') url.port = '';
  return url.toString();
}

export function accessTokenHash(accessToken) {
  return crypto.createHash('sha256').update(String(accessToken)).digest('base64url');
}

/** Validate and atomically consume one RFC 9449 proof. */
export async function verifyDpopProof(db, {
  proof,
  method,
  url,
  accessToken = null,
  requiredJkt = null,
  nonce = null,
}) {
  if (!proof || typeof proof !== 'string') throw invalid('DPoP proof required');
  const decoded = jwt.decode(proof, { complete: true });
  const header = decoded?.header;
  if (!header || header.typ !== 'dpop+jwt' || header.alg !== 'ES256' || !header.jwk) {
    throw invalid('invalid DPoP JOSE header');
  }
  const jwk = publicJwk(header.jwk);
  const jkt = jwkThumbprint(jwk);
  if (requiredJkt && jkt !== requiredJkt) throw invalid('DPoP key does not match sender constraint');

  let claims;
  try {
    claims = jwt.verify(proof, crypto.createPublicKey({ key: jwk, format: 'jwk' }), { algorithms: ['ES256'] });
  } catch {
    throw invalid('invalid DPoP signature');
  }
  const now = Math.floor(Date.now() / 1000);
  if (!claims.jti || typeof claims.jti !== 'string') throw invalid('DPoP jti required');
  if (!Number.isInteger(claims.iat) || claims.iat < now - PROOF_TTL_SEC - CLOCK_SKEW_SEC || claims.iat > now + CLOCK_SKEW_SEC) {
    throw invalid('DPoP iat outside acceptance window');
  }
  const htm = String(method || '').toUpperCase();
  if (claims.htm !== htm) throw invalid('DPoP htm mismatch');
  const htu = normalizeHtu(url);
  if (normalizeHtu(claims.htu) !== htu) throw invalid('DPoP htu mismatch');
  if (accessToken && claims.ath !== accessTokenHash(accessToken)) throw invalid('DPoP ath mismatch');
  if (!accessToken && claims.ath !== undefined) throw invalid('unexpected DPoP ath');
  if (nonce !== null && claims.nonce !== nonce) throw invalid('DPoP nonce mismatch');

  try {
    await db.query('DELETE FROM oauth_dpop_replays WHERE expires_at <= now()');
    await db.query(
      `INSERT INTO oauth_dpop_replays (jkt, jti, htm, htu, expires_at)
       VALUES ($1,$2,$3,$4, now() + interval '${PROOF_TTL_SEC + CLOCK_SKEW_SEC} seconds')`,
      [jkt, claims.jti, htm, htu],
    );
  } catch (error) {
    if (error?.code === '23505') throw invalid('DPoP proof replayed');
    throw error;
  }
  return { claims, jkt, jwk };
}
