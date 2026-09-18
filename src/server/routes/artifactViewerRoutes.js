/**
 * /a/<id> — the hosted viewer for XENO Artifacts.
 *
 * Two kinds of response, deliberately different:
 *
 *   /a/<id>                       the SHELL: our chrome (title, revision, comments
 *                                 panel) around an iframe. Authenticated by the
 *                                 browser session cookie (owner) or `?s=<share>`.
 *   /a/<id>/v/<viewToken>/r/<n>/* the RAW files of one revision. Authorized by
 *                                 the path-scoped view token alone — no cookie,
 *                                 no account — and served under the artifact CSP
 *                                 with a `sandbox` directive, so an author's
 *                                 script runs as an OPAQUE ORIGIN: it cannot read
 *                                 xenosystem.ai cookies, storage or DOM, cannot
 *                                 reach any network (connect-src 'none'), and
 *                                 cannot navigate the top frame. Same posture as
 *                                 the CLI's loopback viewer (ARTIFACT_PAGE_CSP) —
 *                                 one policy, two homes.
 *
 * A private artifact answers 404 to a stranger, never 403: existence is the
 * owner's to reveal.
 */
import express from 'express';
import { optionalAuthMiddleware } from '../middleware/auth.js';
import { listComments, readFile, resolveReadable } from '../services/artifactService.js';
import { mintViewToken, verifyViewToken } from '../services/artifactViewToken.js';

/** Identical to the CLI viewer's ARTIFACT_PAGE_CSP, plus `sandbox` (an opaque origin, since here the page shares our real origin). */
export const ARTIFACT_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://cdn.tailwindcss.com https://code.jquery.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads',
].join('; ');

const ID_PATTERN = /^a_[A-Za-z0-9]{22}$/;

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(res, status, title, body) {
  res.status(status).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow, noarchive' }).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#060606;color:#ece7df;font:15px/1.6 Inter,system-ui,sans-serif}
main{max-width:440px;padding:32px;border:1px solid rgba(255,255,255,.06);background:#101010}h1{font-size:18px;margin:0 0 8px;font-weight:600}p{color:#948d83;margin:0 0 16px}
a{display:inline-block;color:#ece7df;border:1px solid rgba(255,255,255,.14);padding:8px 14px;text-decoration:none}a:hover{background:#151515}</style></head>
<body><main>${body}</main></body></html>`);
}

/** The chrome: tokens from landing-v3 `T` (#060606 page, #101010 plates, #ece7df → #948d83 ramp). */
function shellHtml({ artifact, frameSrc, access, comments, shareToken, signedIn }) {
  const items = comments.map((c) => `<li><span class="who">${escapeHtml(c.author ?? 'someone')}</span> <time>${escapeHtml(new Date(c.createdAt).toISOString().slice(0, 16).replace('T', ' '))}</time> <span class="rev">r${c.revision}</span><div>${escapeHtml(c.body)}</div></li>`).join('');
  const rawHref = `${frameSrc}`;
  const composer = signedIn
    ? `<form id="form"><textarea id="body" placeholder="Tell the agent what to change…"></textarea><div class="hint">Delivered to the XENO Agent session that published this page. Ctrl+Enter to send.</div><p><button type="submit">Send to agent</button></p></form>`
    : `<p class="hint">Sign in to send a comment to the agent that published this page.</p><p><a class="btn" href="/login?next=${encodeURIComponent(`/a/${artifact.id}${shareToken ? `?s=${shareToken}` : ''}`)}">Sign in</a></p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(artifact.title)}</title>
<style>
:root{color-scheme:dark;--bg:#060606;--plate:#101010;--plate2:#151515;--line:rgba(255,255,255,.06);--line2:rgba(255,255,255,.14);--ink:#ece7df;--ink2:#948d83;--ink3:#69635b}
html,body{height:100%;margin:0}body{display:grid;grid-template-rows:auto 1fr;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,system-ui,sans-serif}
header{display:flex;gap:14px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--line);background:var(--plate)}
header .brand{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3)}
header h1{font-size:14px;margin:0;font-weight:600}header .meta{color:var(--ink2);font-size:12px}header .spacer{flex:1}
header button,header a,.btn{font:inherit;color:var(--ink);background:none;border:1px solid var(--line2);padding:4px 10px;text-decoration:none;cursor:pointer}
header button:hover,header a:hover,.btn:hover{background:var(--plate2)}
main{display:grid;grid-template-columns:1fr minmax(0,var(--panel,0px));min-height:0}
iframe{width:100%;height:100%;border:0;background:#fff}
aside{display:none;border-left:1px solid var(--line);background:var(--plate);padding:12px;overflow:auto}
body.comments{--panel:340px}body.comments aside{display:block}
aside h2{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);margin:0 0 10px}
aside ul{list-style:none;padding:0;margin:0 0 12px;display:grid;gap:10px}aside li{border-bottom:1px solid var(--line);padding-bottom:8px}
aside .who{font-weight:600}aside time,aside .rev{color:var(--ink2);font-size:11px;margin-left:6px}
textarea{width:100%;box-sizing:border-box;min-height:72px;font:inherit;background:var(--bg);color:var(--ink);border:1px solid var(--line2);padding:8px;outline:none}textarea:focus{border-color:rgba(255,255,255,.3)}
.hint{color:var(--ink2);font-size:12px;margin-top:6px}
@media(max-width:720px){body.comments{--panel:0px}body.comments main{grid-template-rows:1fr auto;grid-template-columns:1fr}aside{border-left:0;border-top:1px solid var(--line);max-height:45vh}}
</style></head><body>
<header><span class="brand">XENO</span><h1>${escapeHtml(artifact.title)}</h1><span class="meta">revision ${artifact.currentRevision} · ${access === 'owner' ? (artifact.visibility === 'link' ? 'anyone with the link' : 'private to you') : 'shared with you'}</span><span class="spacer"></span>
<a href="${escapeHtml(rawHref)}" target="_blank" rel="noopener">Open raw</a><button id="toggle" type="button">Comments (${comments.length})</button></header>
<main><iframe id="page" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" src="${escapeHtml(frameSrc)}" title="${escapeHtml(artifact.title)}"></iframe>
<aside><h2>Comments</h2><ul id="list">${items}</ul>${composer}</aside></main>
<script>
(function(){
  var id=${JSON.stringify(artifact.id)};var share=${JSON.stringify(shareToken ?? null)};
  var toggle=document.getElementById('toggle');toggle.addEventListener('click',function(){document.body.classList.toggle('comments');});
  var form=document.getElementById('form');if(!form)return;var body=document.getElementById('body');var list=document.getElementById('list');
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
  function csrf(){var m=document.cookie.match(/(?:^|; )(?:__Host-)?xeno_csrf=([^;]+)/);return m?decodeURIComponent(m[1]):'';}
  function send(){var v=body.value.trim();if(!v)return;
    fetch('/api/artifacts/'+encodeURIComponent(id)+'/comments',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-xeno-csrf':csrf()},body:JSON.stringify({body:v,shareToken:share||undefined})})
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(d){var c=d.comment;var li=document.createElement('li');li.innerHTML='<span class="who">you</span> <time>'+esc(new Date(c.createdAt).toISOString().slice(0,16).replace('T',' '))+'</time> <span class="rev">r'+c.revision+'</span><div>'+esc(c.body)+'</div>';list.appendChild(li);body.value='';toggle.textContent='Comments ('+list.children.length+')';})
    .catch(function(e){alert('Could not send: '+e.message);});}
  form.addEventListener('submit',function(e){e.preventDefault();send();});
  body.addEventListener('keydown',function(e){if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}});
})();
</script></body></html>`;
}

export function createArtifactViewerRouter() {
  const router = express.Router();

  // The shell. Cookie session (via browserSessionMiddleware mounted before this router) or share token.
  router.get('/:id', optionalAuthMiddleware, async (req, res) => {
    const { id } = req.params;
    if (!ID_PATTERN.test(id)) return page(res, 404, 'Not found', '<h1>No such artifact</h1><p>That link does not point at a page.</p><a href="/">xenosystem.ai</a>');
    const shareToken = typeof req.query.s === 'string' && /^s_[A-Za-z0-9]{32}$/.test(req.query.s) ? req.query.s : undefined;
    try {
      const artifact = await resolveReadable(req.db, { artifactId: id, userId: req.user?.id, shareToken });
      if (!artifact) {
        if (req.user) return page(res, 404, 'Not found', '<h1>No such artifact</h1><p>Either it does not exist, it was deleted, or it is private to another account.</p><a href="/">xenosystem.ai</a>');
        return page(res, 401, 'Sign in', `<h1>Sign in to view this page</h1><p>Artifacts are private to the account that published them unless shared by link.</p><a href="/login?next=${encodeURIComponent(`/a/${id}`)}">Sign in</a>`);
      }
      const viewToken = mintViewToken({ artifactId: artifact.id, revision: artifact.currentRevision });
      const frameSrc = `/a/${artifact.id}/v/${viewToken}/r/${artifact.currentRevision}/index.html`;
      const comments = await listComments(req.db, { artifactId: artifact.id });
      res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow, noarchive', 'referrer-policy': 'no-referrer' })
        .send(shellHtml({ artifact, frameSrc, access: artifact.access, comments, shareToken, signedIn: Boolean(req.user) }));
    } catch (error) {
      console.error('[artifacts viewer]', error);
      page(res, 500, 'Viewer error', '<h1>The viewer hit an error</h1><p>Try again in a moment.</p>');
    }
  });

  // Raw files of one revision, authorized by the path-scoped view token.
  router.get('/:id/v/:token/r/:revision/*filePath', async (req, res) => {
    const { id, token } = req.params;
    const revision = Number.parseInt(req.params.revision, 10);
    const grant = verifyViewToken(token);
    if (!ID_PATTERN.test(id) || !grant || grant.artifactId !== id || grant.revision !== revision) {
      return res.status(401).set({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).send('This view link has expired or does not match the page. Reload the artifact.');
    }
    try {
      const filePath = (Array.isArray(req.params.filePath) ? req.params.filePath : [req.params.filePath ?? '']).map((s) => decodeURIComponent(s)).join('/');
      const file = await readFile(req.db, { artifactId: id, revision, path: filePath });
      if (!file) return res.status(404).set({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).send('Not found.');
      res.status(200).set({
        'content-type': file.contentType,
        'content-length': String(file.bytes.length),
        'content-security-policy': ARTIFACT_PAGE_CSP,
        'cross-origin-resource-policy': 'same-origin',
        'x-content-type-options': 'nosniff',
        'x-robots-tag': 'noindex, nofollow, noarchive',
        'referrer-policy': 'no-referrer',
        // Content-addressed: a revision never changes once written, so the token's lifetime is the cache bound.
        'cache-control': 'private, max-age=3600',
      }).send(file.bytes);
    } catch (error) {
      console.error('[artifacts raw]', error);
      res.status(500).set({ 'content-type': 'text/plain; charset=utf-8' }).send('Viewer error.');
    }
  });

  // Anything else under /a/<id>/… is not a route.
  router.get('/:id/*rest', (_req, res) => page(res, 404, 'Not found', '<h1>Not found</h1><p>Artifact files are served under a view link.</p>'));

  return router;
}
