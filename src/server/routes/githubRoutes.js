/**
 * /api/github — GitHub for XENO, through the XENO GitHub App (services/githubApp.js).
 *
 *   GET    /status                  {configured, connected, installations[]}  — the person's connected GitHub accounts
 *   POST   /connect                 {url}  — where to install the App (or change which repositories it may see)
 *   GET    /setup                   GitHub's return after an install (a browser redirect, no XENO token): sends the
 *                                   person through GitHub's sign-in once, so the installations are checked as them
 *   GET    /callback                GitHub's sign-in came back: record the installations, then a page that closes itself
 *   GET    /repositories            the repositories the person allowed (names only; never a token)
 *   DELETE /installations/:id       stop using a connected account
 */
import express from 'express';
import authMiddleware from '../middleware/auth.js';
import { requireDpopIfBound } from '../middleware/dpopResource.js';
import { resolvePrincipal, assertPrincipalUsable, AgentIdentityError } from '../services/agentIdentity.js';
import * as github from '../services/githubApp.js';

const router = express.Router();
const CALLBACK = () => process.env.XENO_GITHUB_APP_CALLBACK_URL || 'https://xenosystem.ai/api/github/callback';

async function loadActor(req, res, next) {
  try {
    const p = await resolvePrincipal(req.db, req.user.id);
    assertPrincipalUsable(p);
    req.actor = { id: p.id, kind: p.kind, role: p.role };
    next();
  } catch (e) {
    if (e instanceof AgentIdentityError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    console.error('[github] loadActor', e);
    return res.status(500).json({ success: false, error: 'Could not resolve who you are' });
  }
}
const A = [authMiddleware, requireDpopIfBound, loadActor];
const run = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req)) }); }
  catch (e) {
    if (e instanceof github.GitHubAppError) return res.status(e.statusCode).json({ success: false, error: e.message, code: e.code });
    console.error('[github]', e.message);
    return res.status(502).json({ success: false, error: 'GitHub could not be reached right now' });
  }
};

const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>${title}</title>
<body style="margin:0;background:#060606;color:#ece7df;font:15px Inter,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh">
<div style="max-width:420px;padding:32px;background:#101010;border:1px solid rgba(255,255,255,.06);border-radius:10px">
<div style="font-weight:600;font-size:17px;margin-bottom:8px">${title}</div><div style="color:#948d83;line-height:1.5">${body}</div></div>
<script>try{if(window.opener){window.opener.postMessage({type:'xeno-github',done:${title === 'GitHub connected'}},'*')}}catch(e){};setTimeout(function(){try{window.close()}catch(e){}},1500)</script>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

router.get('/status', ...A, run(async (req) => ({ github: await github.githubStatus(req.db, req.actor) })));
router.post('/connect', ...A, run(async (req) => ({ url: github.connectUrl(req.actor) })));
router.get('/repositories', ...A, run(async (req) => ({ repositories: await github.listRepositories(req.db, req.actor) })));
router.delete('/installations/:id', ...A, run(async (req) => github.disconnect(req.db, req.actor, req.params.id)));

router.get('/setup', (req, res) => {
  res.set('cache-control', 'no-store');
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  let who = null;
  try { who = github.readState(state); } catch { who = null; }
  if (!who) return res.status(400).type('html').send(page('Start again from XENO', 'This GitHub link was not opened from XENO, or it ran out. Press Connect GitHub in XENO again.'));
  try { return res.redirect(302, github.authorizeUrl(state, CALLBACK())); }
  catch (e) { return res.status(503).type('html').send(page('GitHub is not set up here', esc(e.message))); }
});

router.get('/callback', async (req, res) => {
  res.set('cache-control', 'no-store');
  try {
    const out = await github.completeConnect(req.db, { code: req.query.code, state: req.query.state });
    const names = out.installations.map((i) => esc(i.account)).join(', ');
    return res.type('html').send(out.installations.length
      ? page('GitHub connected', `XENO can now see the repositories you chose on ${names}. You can close this window.`)
      : page('Nothing connected yet', 'GitHub did not list an installation of the XENO app for you. Install it, then try again.'));
  } catch (e) {
    const msg = e instanceof github.GitHubAppError ? e.message : 'GitHub could not be reached right now.';
    if (!(e instanceof github.GitHubAppError)) console.error('[github] callback', e.message);
    return res.status(e.statusCode || 502).type('html').send(page('GitHub was not connected', esc(msg)));
  }
});

export default router;
