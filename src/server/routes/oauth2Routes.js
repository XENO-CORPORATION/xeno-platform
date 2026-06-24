/**
 * /oauth2/* — OIDC provider endpoints (flag-gated OIDC_ENABLED; see index.js).
 *
 * Public: /jwks, /token, /device_authorization.
 * Authenticated (platform token → authMiddleware → req.user): /authorize,
 * /device/approve — these are the points where the platform proves WHO the user
 * is before issuing a code / approving a device.
 *
 * First-party clients (xeno-post, …) skip the consent screen; the grant is still
 * recorded as an authorization_code row.
 */
import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  jwks,
  discovery,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  refreshTokenGrant,
  startDeviceAuthorization,
  approveDevice,
  deviceTokenGrant,
} from '../utils/oidcProvider.js';

const router = express.Router();

function sendOauthError(res, err) {
  const status = err.statusCode || 400;
  res.status(status).json({ error: err.oauthError || 'invalid_request', error_description: err.message });
}

// GET /oauth2/jwks — public keys
router.get('/jwks', async (req, res) => {
  try { res.json(await jwks(req.db)); } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

// Discovery — served at both /api/oauth2/openid-configuration and the standard
// /api/oauth2/.well-known/openid-configuration.
router.get('/openid-configuration', (req, res) => res.json(discovery()));
router.get('/.well-known/openid-configuration', (req, res) => res.json(discovery()));

// POST /oauth2/authorize — authenticated; issues an auth code, returns the redirect.
// (API-driven: the platform frontend calls this with the logged-in user's token,
//  then performs the browser redirect to redirect_uri?code=…&state=…)
router.post('/authorize', authMiddleware, async (req, res) => {
  try {
    const b = req.body || {};
    const code = await createAuthorizationCode(req.db, {
      clientId: b.client_id,
      userId: req.user.id,
      redirectUri: b.redirect_uri,
      scope: b.scope,
      codeChallenge: b.code_challenge,
      nonce: b.nonce,
    });
    const sep = String(b.redirect_uri).includes('?') ? '&' : '?';
    const redirect = `${b.redirect_uri}${sep}code=${encodeURIComponent(code)}${b.state ? `&state=${encodeURIComponent(b.state)}` : ''}`;
    res.json({ code, redirect });
  } catch (e) { sendOauthError(res, e); }
});

// POST /oauth2/token — public; grant_type dispatch.
router.post('/token', async (req, res) => {
  const b = req.body || {};
  try {
    if (b.grant_type === 'authorization_code') {
      return res.json(await exchangeAuthorizationCode(req.db, {
        code: b.code, clientId: b.client_id, redirectUri: b.redirect_uri, codeVerifier: b.code_verifier,
      }));
    }
    if (b.grant_type === 'refresh_token') {
      return res.json(await refreshTokenGrant(req.db, { refreshToken: b.refresh_token, clientId: b.client_id }));
    }
    if (b.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
      return res.json(await deviceTokenGrant(req.db, { deviceCode: b.device_code, clientId: b.client_id }));
    }
    return res.status(400).json({ error: 'unsupported_grant_type' });
  } catch (e) { sendOauthError(res, e); }
});

// POST /oauth2/device_authorization — public; start the device grant.
router.post('/device_authorization', async (req, res) => {
  try {
    res.json(await startDeviceAuthorization(req.db, { clientId: (req.body || {}).client_id, scope: (req.body || {}).scope }));
  } catch (e) { sendOauthError(res, e); }
});

// POST /oauth2/device/approve — authenticated; the activate UI calls this.
router.post('/device/approve', authMiddleware, async (req, res) => {
  try {
    res.json(await approveDevice(req.db, { userCode: (req.body || {}).user_code, userId: req.user.id }));
  } catch (e) { sendOauthError(res, e); }
});

export default router;
