/**
 * /a/<id> — the hosted viewer for XENO Artifacts.
 *
 * Two kinds of response, deliberately different:
 *
 *   /a/<id>                       the SHELL: our chrome (title, revision, comments
 *                                 panel) around an iframe. Authenticated by the
 *                                 browser session cookie (owner / workspace member)
 *                                 or `?s=<share>`.
 *   /a/<id>/v/<viewToken>/r/<n>/* the RAW files of one revision. Authorized by
 *                                 the path-scoped view token alone — no cookie,
 *                                 no account — and served under the artifact CSP
 *                                 with a `sandbox` directive, so an author's
 *                                 script runs as an OPAQUE ORIGIN: it cannot read
 *                                 cookies, storage or DOM of the host, cannot
 *                                 reach any network (connect-src 'none'), and
 *                                 cannot navigate the top frame. Same posture as
 *                                 the CLI's loopback viewer (ARTIFACT_PAGE_CSP) —
 *                                 one policy, two homes.
 *
 * Two origins when ARTIFACTS_CONTENT_ORIGIN is set (production): the shell lives
 * on the app origin, the raw files are served ONLY on the user-content host
 * (`usercontent.<domain>`), which never receives the app's `__Host-` cookies —
 * the second wall Claude's `*.claudeusercontent.com` and ChatGPT's
 * `*.oaiusercontent.com` provide. Unset (CI, dev), both live on one origin and the
 * CSP sandbox alone carries the isolation.
 *
 * A private artifact answers 404 to a stranger, never 403: existence is the
 * owner's to reveal.
 */
import express from 'express';
import { optionalAuthMiddleware } from '../middleware/auth.js';
import { listComments, readFile, resolveReadable } from '../services/artifactService.js';
import { mintViewToken, verifyViewToken } from '../services/artifactViewToken.js';

/** Identical to the CLI viewer's ARTIFACT_PAGE_CSP, plus `sandbox` (an opaque origin, since here the page shares a real origin). */
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

/** Where raw files are served from. Unset → same origin as the shell. */
export function contentOrigin(env = process.env) {
  const raw = env.ARTIFACTS_CONTENT_ORIGIN?.trim().replace(/\/+$/, '');
  return raw && /^https?:\/\/[^/]+$/.test(raw) ? raw : undefined;
}

/** The origin allowed to frame a raw page: PUBLIC_ORIGIN (the shell's home), else this request's own origin. */
export function frameAncestor(req, env = process.env) {
  const configured = env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, '');
  if (configured && /^https?:\/\/[^/]+$/.test(configured)) return configured;
  return "'self'";
}

function contentHostOf(env = process.env) {
  const origin = contentOrigin(env);
  return origin ? new URL(origin).host : undefined;
}

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

const when = (value) => escapeHtml(new Date(value).toISOString().slice(0, 16).replace('T', ' '));

function threadsHtml(comments) {
  const roots = comments.filter((c) => !c.parentId);
  const byParent = new Map();
  for (const c of comments) if (c.parentId) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
  const one = (c, reply) => `<li class="${reply ? 'reply' : 'root'}${c.authorKind === 'agent' ? ' agent' : ''}" data-id="${escapeHtml(c.id)}"><span class="who">${escapeHtml(c.authorKind === 'agent' ? 'XENO Agent' : (c.author ?? 'someone'))}</span> <time>${when(c.createdAt)}</time> <span class="rev">r${c.revision}</span>${c.toAgent === false && !reply ? ' <span class="rev">note</span>' : ''}<div>${escapeHtml(c.body)}</div>${reply ? '' : `<button type="button" class="reply-btn" data-parent="${escapeHtml(c.id)}">Reply</button>`}</li>`;
  return roots.map((root) => `${one(root, false)}${(byParent.get(root.id) ?? []).map((r) => one(r, true)).join('')}`).join('');
}

/** The chrome: tokens from landing-v3 `T` (#060606 page, #101010 plates, #ece7df → #948d83 ramp). */
function shellHtml({ artifact, frameSrc, access, comments, shareToken, signedIn, viewRevision }) {
  const audience = access === 'owner'
    ? (artifact.visibility === 'link' ? 'anyone with the link' : artifact.visibility === 'workspace' ? 'your workspace' : 'private to you')
    : access === 'workspace' ? 'shared with your workspace' : 'shared with you';
  const pinned = access === 'owner' && artifact.sharedRevision ? ` · viewers see r${artifact.sharedRevision}` : '';
  const composer = signedIn
    ? `<form id="form"><textarea id="body" placeholder="Tell the agent what to change…"></textarea>
<label class="hint"><input type="checkbox" id="toAgent" checked> Send to the agent that published this page</label>
<div class="hint">Ctrl+Enter to send. Untick to leave a note for other reviewers only.</div><p><button type="submit" id="send">Send</button> <button type="button" id="cancelReply" hidden>Cancel reply</button></p></form>`
    : `<p class="hint">Sign in to send a comment to the agent that published this page.</p><p><a class="btn" href="/login?next=${encodeURIComponent(`/a/${artifact.id}${shareToken ? `?s=${shareToken}` : ''}`)}">Sign in</a></p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(artifact.title)}</title><link rel="icon" type="image/svg+xml" href="/favicon-v2.svg">
<style>
:root{color-scheme:dark;--bg:#060606;--plate:#101010;--plate2:#151515;--line:rgba(255,255,255,.06);--line2:rgba(255,255,255,.14);--ink:#ece7df;--ink2:#948d83;--ink3:#69635b}
html,body{height:100%;margin:0}body{display:grid;grid-template-rows:auto 1fr;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,system-ui,sans-serif}
header{display:flex;gap:14px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--line);background:var(--plate)}
header .brand{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3)}
header h1{font-size:14px;margin:0;font-weight:600}header .meta{color:var(--ink2);font-size:12px}header .spacer{flex:1}
header button,header a,.btn,aside button{font:inherit;color:var(--ink);background:none;border:1px solid var(--line2);padding:4px 10px;text-decoration:none;cursor:pointer}
header button:hover,header a:hover,.btn:hover,aside button:hover{background:var(--plate2)}
main{display:grid;grid-template-columns:1fr minmax(0,var(--panel,0px));min-height:0}
iframe{width:100%;height:100%;border:0;background:#fff}
aside{display:none;border-left:1px solid var(--line);background:var(--plate);padding:12px;overflow:auto}
body.comments{--panel:340px}body.comments aside{display:block}
aside h2{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);margin:0 0 10px}
aside ul{list-style:none;padding:0;margin:0 0 12px;display:grid;gap:10px}aside li{border-bottom:1px solid var(--line);padding-bottom:8px}
aside li.reply{margin-left:16px;border-left:2px solid var(--line2);padding-left:10px;border-bottom:0}aside li.agent .who{color:var(--ink2)}
aside .who{font-weight:600}aside time,aside .rev{color:var(--ink2);font-size:11px;margin-left:6px}
aside .reply-btn{font-size:11px;padding:2px 8px;margin-top:6px}
textarea{width:100%;box-sizing:border-box;min-height:72px;font:inherit;background:var(--bg);color:var(--ink);border:1px solid var(--line2);padding:8px;outline:none}textarea:focus{border-color:rgba(255,255,255,.3)}
.hint{color:var(--ink2);font-size:12px;margin-top:6px;display:block}
@media(max-width:720px){body.comments{--panel:0px}body.comments main{grid-template-rows:1fr auto;grid-template-columns:1fr}aside{border-left:0;border-top:1px solid var(--line);max-height:45vh}}
</style></head><body>
<header><span class="brand">XENO</span><h1>${escapeHtml(artifact.title)}</h1><span class="meta">revision ${viewRevision} · ${audience}${pinned}</span><span class="spacer"></span>
<a href="${escapeHtml(frameSrc)}" target="_blank" rel="noopener">Open raw</a><button id="toggle" type="button">Comments (${comments.length})</button></header>
<main><iframe id="page" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" src="${escapeHtml(frameSrc)}" title="${escapeHtml(artifact.title)}"></iframe>
<aside><h2>Comments</h2><ul id="list">${threadsHtml(comments)}</ul>${composer}</aside></main>
<script>
(function(){
  var id=${JSON.stringify(artifact.id)};var share=${JSON.stringify(shareToken ?? null)};var parent=null;
  var toggle=document.getElementById('toggle');toggle.addEventListener('click',function(){document.body.classList.toggle('comments');});
  var list=document.getElementById('list');
  list.addEventListener('click',function(e){var b=e.target.closest('.reply-btn');if(!b)return;parent=b.getAttribute('data-parent');var c=document.getElementById('cancelReply');if(c){c.hidden=false;}var body=document.getElementById('body');if(body){body.placeholder='Reply in this thread…';body.focus();}});
  var form=document.getElementById('form');if(!form)return;var body=document.getElementById('body');var toAgent=document.getElementById('toAgent');var cancel=document.getElementById('cancelReply');
  cancel.addEventListener('click',function(){parent=null;cancel.hidden=true;body.placeholder='Tell the agent what to change…';});
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
  function csrf(){var m=document.cookie.match(/(?:^|; )(?:__Host-)?xeno_csrf=([^;]+)/);return m?decodeURIComponent(m[1]):'';}
  function send(){var v=body.value.trim();if(!v)return;
    fetch('/api/artifacts/'+encodeURIComponent(id)+'/comments',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-xeno-csrf':csrf()},body:JSON.stringify({body:v,shareToken:share||undefined,parentId:parent||undefined,toAgent:toAgent.checked})})
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(d){var c=d.comment;var li=document.createElement('li');li.className=c.parentId?'reply':'root';li.setAttribute('data-id',c.id);li.innerHTML='<span class="who">you</span> <time>'+esc(new Date(c.createdAt).toISOString().slice(0,16).replace('T',' '))+'</time> <span class="rev">r'+c.revision+'</span>'+(c.toAgent===false&&!c.parentId?' <span class="rev">note</span>':'')+'<div>'+esc(c.body)+'</div>'+(c.parentId?'':'<button type="button" class="reply-btn" data-parent="'+esc(c.id)+'">Reply</button>');
      if(c.parentId){var root=list.querySelector('[data-id="'+c.parentId+'"]');var after=root;while(after&&after.nextElementSibling&&after.nextElementSibling.classList.contains('reply'))after=after.nextElementSibling;if(after)after.insertAdjacentElement('afterend',li);else list.appendChild(li);}else list.appendChild(li);
      body.value='';parent=null;cancel.hidden=true;body.placeholder='Tell the agent what to change…';toggle.textContent='Comments ('+list.children.length+')';})
    .catch(function(e){alert('Could not send: '+e.message);});}
  form.addEventListener('submit',function(e){e.preventDefault();send();});
  body.addEventListener('keydown',function(e){if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}});
})();
</script></body></html>`;
}

const RAW_HEADERS_TEXT = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };

export function createArtifactViewerRouter() {
  const router = express.Router();

  // The shell. Cookie session (via browserSessionMiddleware mounted before this router) or share token.
  router.get('/:id', optionalAuthMiddleware, async (req, res) => {
    const { id } = req.params;
    if (!ID_PATTERN.test(id)) return page(res, 404, 'Not found', '<h1>No such artifact</h1><p>That link does not point at a page.</p><a href="/">Home</a>');
    // The shell never renders on the user-content host: a page there could not be told apart from ours.
    const host = contentHostOf();
    if (host && req.get('host') === host) return page(res, 404, 'Not found', '<h1>Not found</h1><p>Artifacts open from the main site.</p>');
    const shareToken = typeof req.query.s === 'string' && /^s_[A-Za-z0-9]{32}$/.test(req.query.s) ? req.query.s : undefined;
    try {
      const artifact = await resolveReadable(req.db, { artifactId: id, userId: req.user?.id, shareToken });
      if (!artifact) {
        if (req.user) return page(res, 404, 'Not found', '<h1>No such artifact</h1><p>Either it does not exist, it was deleted, or it is private to another account.</p><a href="/">Home</a>');
        return page(res, 401, 'Sign in', `<h1>Sign in to view this page</h1><p>Artifacts are private to the account that published them unless shared.</p><a href="/login?next=${encodeURIComponent(`/a/${id}`)}">Sign in</a>`);
      }
      const viewRevision = artifact.viewRevision;
      const viewToken = mintViewToken({ artifactId: artifact.id, revision: viewRevision });
      const frameSrc = `${contentOrigin() ?? ''}/a/${artifact.id}/v/${viewToken}/r/${viewRevision}/index.html`;
      const comments = await listComments(req.db, { artifactId: artifact.id });
      res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow, noarchive', 'referrer-policy': 'no-referrer' })
        .send(shellHtml({ artifact, frameSrc, access: artifact.access, comments, shareToken, signedIn: Boolean(req.user), viewRevision }));
    } catch (error) {
      console.error('[artifacts viewer]', error);
      page(res, 500, 'Viewer error', '<h1>The viewer hit an error</h1><p>Try again in a moment.</p>');
    }
  });

  // Raw files of one revision, authorized by the path-scoped view token. On the user-content host only, when one is configured.
  router.get('/:id/v/:token/r/:revision/*filePath', async (req, res) => {
    const { id, token } = req.params;
    const host = contentHostOf();
    if (host && req.get('host') !== host) return res.status(404).set(RAW_HEADERS_TEXT).send('Not found.');
    const revision = Number.parseInt(req.params.revision, 10);
    const grant = verifyViewToken(token);
    if (!ID_PATTERN.test(id) || !grant || grant.artifactId !== id || grant.revision !== revision) {
      return res.status(401).set(RAW_HEADERS_TEXT).send('This view link has expired or does not match the page. Reload the artifact.');
    }
    try {
      const filePath = (Array.isArray(req.params.filePath) ? req.params.filePath : [req.params.filePath ?? '']).map((s) => decodeURIComponent(s)).join('/');
      const file = await readFile(req.db, { artifactId: id, revision, path: filePath });
      if (!file) return res.status(404).set(RAW_HEADERS_TEXT).send('Not found.');
      // helmet sets X-Frame-Options: DENY on every response; a raw page is framed by the shell on
      // the APP origin, so that header must go — Chrome blocked the frame with it ("usercontent
      // … is blocked", measured 2026-09-18 in a real browser). frame-ancestors names the one origin
      // that may embed the page: the shell's. Everything else in the policy is the CLI viewer's.
      res.removeHeader('x-frame-options');
      res.status(200).set({
        'content-type': file.contentType,
        'content-length': String(file.bytes.length),
        'content-security-policy': `${ARTIFACT_PAGE_CSP}; frame-ancestors ${frameAncestor(req)}`,
        // The frame is an OPAQUE origin (CSP sandbox), so its own subresource loads are cross-origin
        // to this host; a `same-origin` CORP would block the page's own stylesheet. The token is the
        // authority here, not the resource policy.
        'cross-origin-resource-policy': 'cross-origin',
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
