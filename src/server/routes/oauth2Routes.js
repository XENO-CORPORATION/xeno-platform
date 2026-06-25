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

// GET /oauth2/authorize — browser entry point for "Sign in with XENO". This IS
// the XENO auth screen (served on the xenostudio.ai origin, like Google's consent
// page): if the user already has a session (localStorage 'xenoos_auth_token') it
// auto-continues; otherwise it shows a sign-in / create-account form, signs them
// in against /api/auth/*, then continues — so the user never hits a dead end.
// First-party clients auto-approve the grant (Identity Plan §2.3).
router.get('/authorize', (req, res) => {
  res.set('content-type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Sign in with XENO</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}body{font:15px/1.5 system-ui,-apple-system,sans-serif;background:radial-gradient(1200px 600px at 50% -10%,#16161c,#0a0a0c);color:#e7e7ea;display:grid;place-items:center;min-height:100vh;margin:0}
.card{width:360px;max-width:92vw;padding:32px 28px;background:#101015;border:1px solid #23232b;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.brand{font-weight:700;letter-spacing:.5px;font-size:13px;color:#9aa0aa;text-transform:uppercase;margin-bottom:6px}
h1{font-size:20px;margin:0 0 4px}.sub{color:#9aa0aa;font-size:13px;margin:0 0 20px}
label{display:block;font-size:12px;color:#9aa0aa;margin:12px 0 4px}
input{width:100%;padding:10px 12px;background:#16161d;border:1px solid #2a2a34;border-radius:9px;color:#fff;font-size:14px}
input:focus{outline:none;border-color:#7aa2ff}
button{width:100%;margin-top:18px;padding:11px;background:#5b7cff;border:0;border-radius:9px;color:#fff;font-weight:600;font-size:14px;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
.muted{color:#9aa0aa;font-size:13px;text-align:center;margin-top:14px}.muted a{color:#7aa2ff;cursor:pointer;text-decoration:none}
.err{color:#ff7a7a;font-size:13px;margin-top:10px;min-height:18px}
.status{text-align:center;color:#cfd2d8}.hide{display:none}
</style></head>
<body><div class="card">
  <div class="brand">XENO</div>
  <h1 id="title">Sign in to continue</h1>
  <p class="sub" id="appsub">Authorize <b id="app">this app</b> to use your XENO account.</p>
  <div id="status" class="status">Checking your XENO session…</div>
  <form id="form" class="hide" autocomplete="on">
    <div id="nameRow" class="hide"><label>Name</label><input id="name" type="text" placeholder="Jane Doe"></div>
    <label>Email</label><input id="email" type="email" placeholder="you@company.com" required>
    <label>Password</label><input id="password" type="password" placeholder="••••••••" required>
    <div class="err" id="err"></div>
    <button id="submit" type="submit">Sign in &amp; continue</button>
    <p class="muted"><span id="toggleText">New to XENO?</span> <a id="toggle">Create an account</a></p>
  </form>
</div>
<script>
(function(){
  var p=new URLSearchParams(location.search);
  var $=function(id){return document.getElementById(id)};
  $('app').textContent=p.get('client_id')||'this app';
  var mode='signin';
  function show(el,on){el.classList[on?'remove':'add']('hide')}
  function setStatus(t){show($('status'),true);show($('form'),false);$('status').textContent=t}
  function showForm(msg){show($('status'),false);show($('form'),true);$('err').textContent=msg||''}
  function fail(msg){$('err').textContent=msg;$('submit').disabled=false;$('submit').textContent=mode==='signup'?'Create account & continue':'Sign in & continue'}

  function continueWith(tok){
    setStatus('Signing you in…');
    fetch('/api/oauth2/authorize',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+tok},
      body:JSON.stringify({client_id:p.get('client_id'),redirect_uri:p.get('redirect_uri'),scope:p.get('scope'),code_challenge:p.get('code_challenge'),state:p.get('state')})})
    .then(function(r){ if(r.status===401){ localStorage.removeItem('xenoos_auth_token'); showForm('Your XENO session expired — please sign in again.'); throw 0;} return r.json(); })
    .then(function(d){ if(d&&d.redirect){ location.href=d.redirect; } else { showForm((d&&(d.error_description||d.error))||'Authorization failed'); } })
    .catch(function(e){ if(e!==0) showForm('Error: '+(e&&e.message||e)); });
  }

  $('toggle').onclick=function(){
    mode=mode==='signin'?'signup':'signin';
    show($('nameRow'),mode==='signup');
    $('title').textContent=mode==='signup'?'Create your XENO account':'Sign in to continue';
    $('submit').textContent=mode==='signup'?'Create account & continue':'Sign in & continue';
    $('toggleText').textContent=mode==='signup'?'Already have an account?':'New to XENO?';
    $('toggle').textContent=mode==='signup'?'Sign in':'Create an account';
    $('err').textContent='';
  };

  $('form').onsubmit=function(e){
    e.preventDefault();
    var email=$('email').value.trim(), password=$('password').value, name=$('name').value.trim();
    if(!email||!password){ return fail('Email and password are required.'); }
    $('submit').disabled=true; $('submit').textContent='Please wait…'; $('err').textContent='';
    var url=mode==='signup'?'/api/auth/register':'/api/auth/login';
    var body=mode==='signup'
      ? {email:email,password:password,username:email.split('@')[0].slice(0,20),display_name:name||email.split('@')[0]}
      : {email:email,password:password};
    fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){return r.json()}).then(function(d){
        if(d&&d.token){ localStorage.setItem('xenoos_auth_token',d.token); continueWith(d.token); }
        else { fail((d&&d.error)||'Sign-in failed. Check your details and try again.'); }
      }).catch(function(e){ fail('Network error: '+(e&&e.message||e)); });
  };

  // Entry: already signed in → continue; else show the sign-in form.
  var tok=localStorage.getItem('xenoos_auth_token');
  if(tok){ continueWith(tok); } else { showForm(''); }
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
