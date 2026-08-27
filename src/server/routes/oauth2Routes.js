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
  getClient,
  validateAuthorizationRequest,
  createAuthorizationCode,
  exchangeAuthorizationCode,
  refreshTokenGrant,
  startDeviceAuthorization,
  inspectDeviceAuthorization,
  approveDevice,
  deviceTokenGrant,
  revokeToken,
  endSession,
  logoutEverywhere,
  introspectToken,
} from '../utils/oidcProvider.js';

const router = express.Router();

function sendOauthError(res, err) {
  const status = err.statusCode || 400;
  res.status(status).json({ error: err.oauthError || 'invalid_request', error_description: err.message });
}

function requireRecentOidcAuth(req, res, next) {
  const authTime = Number(req.auth?.authTime);
  const now = Math.floor(Date.now() / 1000);
  const scopes = new Set(String(req.auth?.scope || '').split(/\s+/).filter(Boolean));
  const trustedSurface = req.auth?.clientId === 'xeno-hub' || req.auth?.clientId === 'xeno-web';
  if (req.auth?.kind !== 'oidc' || !trustedSurface || !scopes.has('account:logout')
      || !Number.isFinite(authTime) || authTime > now + 60 || now - authTime > 5 * 60) {
    res.set('WWW-Authenticate', 'Bearer error="insufficient_user_authentication", max_age="300"');
    return res.status(401).json({ error: 'insufficient_user_authentication', max_age: 300 });
  }
  return next();
}

// GET /oauth2/jwks — public keys
router.get('/jwks', async (req, res) => {
  try { res.json(await jwks(req.db)); } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

// Discovery — served at both /api/oauth2/openid-configuration and the standard
// /api/oauth2/.well-known/openid-configuration.
router.get('/openid-configuration', (req, res) => res.json(discovery()));
router.get('/.well-known/openid-configuration', (req, res) => res.json(discovery()));

// Public presentation metadata for the login consent sentence. Only registered
// database values are returned; raw query text is never rendered as an app name.
router.get('/client_info', async (req, res) => {
  try {
    const clientId = String(req.query.client_id || '');
    const client = clientId ? await getClient(req.db, clientId) : null;
    if (!client) return res.status(404).json({ error: 'invalid_client' });
    res.set('cache-control', 'no-store');
    return res.json({ client_id: client.client_id, name: client.name });
  } catch {
    return res.status(500).json({ error: 'server_error' });
  }
});

// GET /oauth2/authorize — browser entry point for "Sign in with XENO". This IS
// the XENO auth screen (served on the xenostudio.ai origin, like Google's consent
// page): if the user already has a session (localStorage 'xenoos_auth_token') it
// auto-continues; otherwise it shows a sign-in / create-account form, signs them
// in against /api/auth/*, then continues — so the user never hits a dead end.
// First-party clients auto-approve the grant (Identity Plan §2.3).
router.get('/authorize', async (req, res) => {
  const rawId = String(req.query.client_id || '');
  let client;
  try {
    client = await validateAuthorizationRequest(req.db, {
      clientId: rawId,
      redirectUri: String(req.query.redirect_uri || ''),
      codeChallenge: String(req.query.code_challenge || ''),
      codeChallengeMethod: String(req.query.code_challenge_method || ''),
    });
  } catch (e) {
    // Never redirect an invalid request: redirect_uri has not been trusted.
    return sendOauthError(res, e);
  }
  res.set('content-type', 'text/html; charset=utf-8');
  const appName = client.name || 'an application';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const app = esc(appName);
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Sign in with XENO</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}
:root{--bg:#121212;--panel:#17171b;--border:#26262d;--muted:#9aa0aa;--text:#f4f4f6;--accent:#ece7df;--accent2:#ffffff}
html,body{margin:0}
body{font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:grid;place-items:center}
/* Loading interface — mirrors the dashboard's auth-gate loader (ProtectedRoute) */
.loader{display:flex;flex-direction:column;align-items:center;gap:18px;text-align:center;padding:44px 24px}
.spin{width:48px;height:48px;border-radius:9999px;border:3px solid rgba(255,255,255,.13);border-bottom-color:#fff;animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.loader .msg{color:rgba(255,255,255,.7);font-size:14px}
.loader .who{color:var(--muted);font-size:13px}.loader .who b{color:var(--text);font-weight:600}
/* Sign-in card (fallback only — most users bounce to the branded /auth screen) */
.card{width:384px;max-width:92vw;padding:34px 30px;background:var(--panel);border:1px solid var(--border);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.55)}
.logo{display:flex;align-items:center;gap:10px;margin-bottom:20px}
.logo .dot{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--accent2))}
.logo .name{font-weight:700;letter-spacing:.4px;font-size:15px}
h1{font-size:21px;margin:0 0 5px;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:13.5px;margin:0 0 22px}.sub b{color:var(--text)}
label{display:block;font-size:12px;color:var(--muted);margin:14px 0 5px}
input{width:100%;padding:11px 13px;background:#0f0f12;border:1px solid #2b2b33;border-radius:11px;color:#fff;font-size:14px;transition:border-color .15s}
input:focus{outline:none;border-color:var(--accent)}
button{width:100%;margin-top:20px;padding:12px;background:linear-gradient(135deg,var(--accent),var(--accent2));border:0;border-radius:11px;color:#fff;font-weight:600;font-size:14.5px;cursor:pointer;transition:opacity .15s}
button:hover{opacity:.92}button:disabled{opacity:.55;cursor:default}
.muted{color:var(--muted);font-size:13px;text-align:center;margin-top:16px}.muted a{color:var(--accent);cursor:pointer;text-decoration:none;font-weight:500}
.err{color:#ff7a7a;font-size:13px;margin-top:10px;min-height:18px}
.foot{margin-top:22px;text-align:center;color:#565660;font-size:11.5px}
.hide{display:none}
</style></head>
<body>
  <div id="loader" class="loader">
    <div class="spin"></div>
    <div class="msg" id="status">Checking your XENO session…</div>
    <div class="who">Continue to <b id="app">${app}</b></div>
  </div>
  <div id="cardWrap" class="hide"><div class="card">
    <div class="logo"><div class="dot"></div><div class="name">XENO</div></div>
    <h1 id="title">Sign in to continue</h1>
    <p class="sub">Continue to <b id="app2">${app}</b> with your XENO account.</p>
    <form id="form" autocomplete="on">
      <div id="nameRow" class="hide"><label>Name</label><input id="name" type="text" placeholder="Jane Doe"></div>
      <label>Email</label><input id="email" type="email" placeholder="you@company.com" required>
      <label>Password</label><input id="password" type="password" placeholder="••••••••" required>
      <div class="err" id="err"></div>
      <button id="submit" type="submit">Sign in &amp; continue</button>
      <p class="muted"><span id="toggleText">New to XENO?</span> <a id="toggle">Create an account</a></p>
    </form>
    <div class="foot">Secured by XENO · xenostudio.ai</div>
  </div></div>
<script>
(function(){
  var p=new URLSearchParams(location.search);
  var $=function(id){return document.getElementById(id)};
  // Hand unauthenticated users to the canonical human login route. The login
  // UI derives its consent label from this validated authorize transaction.
  function toAuth(){ location.href='/login?returnUrl='+encodeURIComponent(location.pathname+location.search); }
  var mode='signin';
  function show(el,on){el.classList[on?'remove':'add']('hide')}
  function setStatus(t){show($('loader'),true);show($('cardWrap'),false);$('status').textContent=t}
  function showForm(msg){show($('loader'),false);show($('cardWrap'),true);$('err').textContent=msg||''}
  function fail(msg){$('err').textContent=msg;$('submit').disabled=false;$('submit').textContent=mode==='signup'?'Create account & continue':'Sign in & continue'}

  function continueWith(tok){
    setStatus('Signing you in…');
    fetch('/api/oauth2/authorize',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+tok},
      body:JSON.stringify({client_id:p.get('client_id'),redirect_uri:p.get('redirect_uri'),scope:p.get('scope'),code_challenge:p.get('code_challenge'),code_challenge_method:p.get('code_challenge_method'),state:p.get('state'),nonce:p.get('nonce')})})
    .then(function(r){ if(r.status===401){ localStorage.removeItem('xenoos_auth_token'); toAuth(); throw 0;} return r.json(); })
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
  // Accept a token handed back in the URL (?token=…) by the social-login
  // callback (buildOAuthRedirectUrl appends it to returnUrl), so "Sign in with
  // GitHub/Google/X" completes the grant instead of bouncing to the form. Mirror
  // AuthContext: persist it, strip it from the visible URL, then continue.
  var urlTok=p.get('token');
  if(urlTok){
    try{ localStorage.setItem('xenoos_auth_token',urlTok); }catch(e){}
    try{ history.replaceState(null,'',location.pathname+location.search.replace(/[?&]token=[^&]*/,'').replace(/[?&]isNew=[^&]*/,'').replace(/^&/,'?')); }catch(e){}
    continueWith(urlTok);
  } else {
    var tok=localStorage.getItem('xenoos_auth_token');
    if(tok){ continueWith(tok); } else { toAuth(); }
  }
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
      codeChallengeMethod: b.code_challenge_method,
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

// POST /oauth2/end_session — revoke the authenticated token's OWN session. The
// SID comes from the verified token, never the body (foreign-SID revocation bug).
router.post('/end_session', authMiddleware, async (req, res) => {
  try {
    res.status(200).json(await endSession(req.db, { sid: req.auth?.sid, userId: req.user.id }));
  } catch (e) { sendOauthError(res, e); }
});

// POST /oauth2/logout_everywhere — subject-keyed global revocation. Until the
// interactive step-up transaction lands, a freshly authenticated OIDC session
// (auth_time <= 5m) is the fail-closed step-up proof accepted here.
router.post('/logout_everywhere', authMiddleware, requireRecentOidcAuth, async (req, res) => {
  try {
    res.status(200).json(await logoutEverywhere(req.db, { userId: req.user.id }));
  } catch (e) { sendOauthError(res, e); }
});

// POST /oauth2/device/approve — authenticated; the activate UI calls this.
router.post('/device/inspect', authMiddleware, async (req, res) => {
  try {
    res.json(await inspectDeviceAuthorization(req.db, { userCode: (req.body || {}).user_code }));
  } catch (e) { sendOauthError(res, e); }
});

router.post('/device/approve', authMiddleware, async (req, res) => {
  try {
    res.json(await approveDevice(req.db, { userCode: (req.body || {}).user_code, userId: req.user.id }));
  } catch (e) { sendOauthError(res, e); }
});

export default router;
