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
  revokeToken,
  introspectToken,
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

// GET /oauth2/authorize — browser entry point for "Sign in with XENO". If the
// user already has a XENO session (localStorage 'xenoos_auth_token') it
// auto-approves the grant and continues; otherwise it sends them to the REAL
// branded platform login (/auth) — full email/password + social (GitHub) + MFA —
// with returnUrl set back to this authorize URL, so once they sign in by ANY
// method they land right back here and the flow completes. No dead end, no
// duplicated login UI. First-party clients auto-approve (Identity Plan §2.3).
router.get('/authorize', (req, res) => {
  res.set('content-type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Sign in with XENO</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px/1.5 system-ui,-apple-system,sans-serif;background:radial-gradient(1200px 600px at 50% -10%,#16161c,#0a0a0c);color:#cfd2d8;display:grid;place-items:center;min-height:100vh;margin:0}
.c{text-align:center}.s{opacity:.8;font-size:14px}a{color:#7aa2ff}</style></head>
<body><div class="c"><div id="s" class="s">Connecting you to XENO…</div></div>
<script>
(function(){
  var p=new URLSearchParams(location.search);
  var s=document.getElementById('s');
  function toAuth(){ location.replace('/auth?returnUrl='+encodeURIComponent(location.pathname+location.search)); }
  function continueWith(tok){
    fetch('/api/oauth2/authorize',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+tok},
      body:JSON.stringify({client_id:p.get('client_id'),redirect_uri:p.get('redirect_uri'),scope:p.get('scope'),code_challenge:p.get('code_challenge'),state:p.get('state')})})
    .then(function(r){ if(r.status===401){ localStorage.removeItem('xenoos_auth_token'); toAuth(); throw 0; } return r.json(); })
    .then(function(d){ if(d&&d.redirect){ location.href=d.redirect; } else { s.textContent='Authorization error: '+((d&&(d.error_description||d.error))||'failed'); } })
    .catch(function(e){ if(e!==0) s.textContent='Error: '+(e&&e.message||e); });
  }
  var tok=localStorage.getItem('xenoos_auth_token');
  if(tok){ continueWith(tok); } else { toAuth(); }
})();
</script></body></html>`);
});

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

// POST /oauth2/revoke — RFC 7009; revoke a refresh token + its family. Public, so
// it accepts ONLY a token (proof of possession) — NEVER a sid (that would let
// anyone log out any session). sid-based logout is on /end_session (authed).
router.post('/revoke', async (req, res) => {
  try {
    await revokeToken(req.db, { token: (req.body || {}).token });
    res.status(200).json({});
  } catch (e) { res.status(200).json({}); }
});

// POST /oauth2/introspect — RFC 7662; phantom-token edge validation.
router.post('/introspect', async (req, res) => {
  try {
    res.json(await introspectToken(req.db, { token: (req.body || {}).token }));
  } catch (e) { res.json({ active: false }); }
});

// POST /oauth2/end_session — RP-initiated / global logout (Arch §2.5): kill every
// refresh token for the session (sid), so no branch can mint new tokens.
router.post('/end_session', authMiddleware, async (req, res) => {
  try {
    await revokeToken(req.db, { sid: (req.body || {}).sid });
    res.status(200).json({ ended: true });
  } catch (e) { sendOauthError(res, e); }
});

// POST /oauth2/device/approve — authenticated; the activate UI calls this.
router.post('/device/approve', authMiddleware, async (req, res) => {
  try {
    res.json(await approveDevice(req.db, { userCode: (req.body || {}).user_code, userId: req.user.id }));
  } catch (e) { sendOauthError(res, e); }
});

export default router;
