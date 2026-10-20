/**
 * XENO Storage: the page a sign-in folder link opens (services/storageFolderLinks.js).
 *
 *   /storage/shared/<token>                     the shared folder
 *   /storage/shared/<token>/f/<folder id>       a folder inside it
 *   /storage/shared/<token>/files/<file id>     a file in either (download)
 *
 * Served by the backend, not the SPA (same reason as the artifacts viewer, /a/…): the session cookie is resolved
 * server-side, the link is checked on every request, and nothing renders before both hold. nginx routes the prefix
 * here WITHOUT the site gate, because the person a link is for (an investor) holds neither the access code nor an
 * allowlisted account. That is safe because this router shows nothing to a request without a live link AND a
 * signed-in, active account: a signed-out visitor sees only "a folder was shared with you, sign in".
 *
 * Every response: noindex, no-store, no-referrer (the token is in the path).
 */
import express from 'express';
import { optionalAuthMiddleware } from '../middleware/auth.js';
import { admitThroughLink, canReadFolder, isLinkToken, listLinkFolder, readableFileInLink, recordLinkEvent, resolveFolderLink } from '../services/storageFolderLinks.js';
import { streamAsset } from './libraryRoutes.js';
import { mintShareInvite, shareInviteCookieName, SHARE_INVITE_HOURS } from '../utils/shareInvite.js';

const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow, noarchive', 'referrer-policy': 'no-referrer' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'];
const size = (n) => { let v = Number(n) || 0, i = 0; while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i += 1; } return `${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} ${UNITS[i]}`; };

function page(res, status, title, body) {
  res.status(status).set({ ...HEADERS, 'content-type': 'text/html; charset=utf-8' }).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>${esc(title)} · XENO</title>
<style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#08080a;color:rgba(255,255,255,.9);font:15px/1.6 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
header{height:56px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid rgba(255,255,255,.06)}header b{font-weight:600;letter-spacing:.14em;font-size:13px}
main{max-width:760px;margin:0 auto;padding:40px 16px}.card{border:1px solid rgba(255,255,255,.06);background:#0b0b0d;border-radius:6px;padding:24px}
h1{font-size:20px;font-weight:600;margin:0 0 6px}p{color:rgba(255,255,255,.5);margin:0 0 18px}small{color:rgba(255,255,255,.3)}
.btn{display:inline-block;padding:9px 16px;border-radius:6px;text-decoration:none;font-weight:500;font-size:14px;border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.9);margin:0 8px 8px 0}.btn.go{background:#fff;color:#08080a;border-color:#fff}.btn:hover{background:rgba(255,255,255,.06)}.btn.go:hover{background:rgba(255,255,255,.9)}
nav.path{font-size:13px;color:rgba(255,255,255,.45);margin:0 0 14px}nav.path a{color:rgba(255,255,255,.7);text-decoration:none}nav.path a:hover{color:#fff}
.row{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid rgba(255,255,255,.06)}.row .tag{width:44px;font-size:11px;letter-spacing:.06em;color:rgba(255,255,255,.45)}.row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row a.nm{color:rgba(255,255,255,.9);text-decoration:none}.row a.nm:hover{text-decoration:underline}
.note{margin-top:18px;font-size:12.5px;color:rgba(255,255,255,.3)}</style></head>
<body><header><b>XENO</b></header><main>${body}</main></body></html>`);
}

const notFound = (res) => page(res, 404, 'Link not available', '<div class="card"><h1>This link does not open anything</h1><p>It may have expired, or the person who shared it turned it off.</p><a class="btn" href="/">XENO</a></div>');
const base = (token) => `/storage/shared/${token}`;
const tagOf = (f) => { const m = String(f.mime_type || ''); const ext = (String(f.original_name || f.filename).match(/\.([a-z0-9]{1,5})$/i) || [])[1]; return m === 'application/pdf' ? 'PDF' : m.startsWith('image/') ? 'IMG' : m.startsWith('video/') ? 'VID' : m.startsWith('audio/') ? 'AUD' : ext ? ext.toUpperCase().slice(0, 4) : 'FILE'; };

/** The signed-in, ACTIVE account on this request, or null. */
async function viewer(req) {
  if (!req.user?.id) return null;
  const row = (await req.db.query('SELECT id, is_active, status, deleted_at FROM users WHERE id = $1', [req.user.id])).rows[0];
  if (!row || row.is_active === false || row.deleted_at || String(row.status || '').toLowerCase() === 'suspended') return null;
  return row;
}

function signInPage(req, res, link, token) {
  // the invitation that lets this person create an account while signup is closed (utils/shareInvite.js)
  const invite = mintShareInvite(link.id);
  if (invite) res.cookie(shareInviteCookieName(), invite, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: SHARE_INVITE_HOURS * 3600 * 1000 });
  const back = encodeURIComponent(req.originalUrl.split('?')[0]);
  // signed out: nothing about the folder, its owner or its files is shown
  return page(res, 401, 'Sign in to open', `<div class="card"><h1>A folder was shared with you</h1><p>Sign in to your XENO account to open it. If you do not have one, create one: it is free.</p>
<a class="btn go" href="/signup?returnUrl=${back}">Create account</a><a class="btn" href="/login?returnUrl=${back}">Sign in</a>
<p class="note">After you sign in, come back to this link if you are not brought here automatically. The person who shared it will see that you opened it.</p></div>`);
}

export function createStorageSharedRouter() {
  const router = express.Router();
  router.use(optionalAuthMiddleware);

  const showFolder = async (req, res) => {
    const { token } = req.params;
    try {
      const link = isLinkToken(token) ? await resolveFolderLink(req.db, token) : null;
      if (!link) return notFound(res);
      const who = await viewer(req);
      if (!who) return signInPage(req, res, link, token);
      const admitted = await admitThroughLink(req.db, link, who.id);
      if (!admitted.ok) return notFound(res);
      const listing = await listLinkFolder(req.db, link, req.params.folderId || null);
      if (!listing || !(await canReadFolder(req.db, link, who.id, listing.folderId))) return notFound(res);
      await recordLinkEvent(req.db, link, who.id, 'open');
      const crumbs = listing.path.map((p, i) => (i === listing.path.length - 1 ? `<span>${esc(p.name)}</span>` : `<a href="${p.id === link.folder_id ? base(token) : `${base(token)}/f/${p.id}`}">${esc(p.name)}</a>`)).join(' / ');
      const rows = [
        ...listing.folders.map((f) => `<div class="row"><span class="tag">DIR</span><a class="nm" href="${base(token)}/f/${f.id}">${esc(f.name)}</a><small></small></div>`),
        ...listing.files.map((f) => `<div class="row"><span class="tag">${tagOf(f)}</span><a class="nm" href="${base(token)}/files/${f.id}">${esc(f.original_name || f.filename)}</a><small>${esc(size(f.file_size))}</small><a class="btn" style="margin:0" href="${base(token)}/files/${f.id}?download=1">Download</a></div>`),
      ].join('') || '<p>This folder is empty.</p>';
      const owner = link.display_name || link.username;
      return page(res, 200, listing.path.at(-1)?.name || 'Shared folder', `<nav class="path">${crumbs}</nav><div class="card"><h1>${esc(listing.path.at(-1)?.name || link.folder_name)}</h1><p>Shared with you by ${esc(owner)}. You can view and download; you cannot change anything.</p>${rows}<p class="note">${esc(owner)} can see that you opened this folder and which files you downloaded.</p></div>`);
    } catch (error) {
      console.error('[storage shared link]', error);
      return page(res, 500, 'Error', '<div class="card"><h1>Something went wrong</h1><p>Try again in a moment.</p></div>');
    }
  };
  router.get('/:token', showFolder);
  router.get('/:token/f/:folderId', showFolder);

  router.get('/:token/files/:fileId', async (req, res) => {
    const { token } = req.params;
    try {
      const link = isLinkToken(token) ? await resolveFolderLink(req.db, token) : null;
      if (!link) return notFound(res);
      const who = await viewer(req);
      if (!who) return res.redirect(302, base(token));   // signed out never reaches a byte
      if (!(await admitThroughLink(req.db, link, who.id)).ok) return notFound(res);
      const file = await readableFileInLink(req.db, link, who.id, req.params.fileId);
      if (!file) return notFound(res);
      await recordLinkEvent(req.db, link, who.id, 'download', file.id);
      for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
      req.params.id = file.id;
      return streamAsset(req, res, file, false);
    } catch (error) {
      console.error('[storage shared file]', error);
      return page(res, 500, 'Error', '<div class="card"><h1>Something went wrong</h1><p>Try again in a moment.</p></div>');
    }
  });

  router.use((_req, res) => notFound(res));
  return router;
}

export default createStorageSharedRouter();
