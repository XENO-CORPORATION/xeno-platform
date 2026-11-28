/**
 * A Chat project's Corpus (its sources, their state, which ones answers use) was first served at
 * `/projects/:id/notebook` (live 2026-11-28 for minutes before the owner named it: "it's Corpus, right? ... we already
 * have Corpus"). Those addresses answer 308 to the same path under `/corpus`, keeping the query string. 308, not 301 or
 * 302: the method and the body are kept, so a PATCH sent to the old address still lands as a PATCH.
 *
 * The id is copied from the path as it arrived (still URL-encoded, never decoded), so the redirect can only point at
 * this router's own `/projects/<segment>/corpus…` address: it cannot leave the origin or the router.
 */
const LEGACY = /^\/projects\/([^/]+)\/notebook(\/.*)?$/;

export function legacyNotebookRedirect(req, res, next) {
  const m = LEGACY.exec(req.path);
  if (!m) return next();
  const q = req.originalUrl.indexOf('?');
  return res.redirect(308, `${req.baseUrl}/projects/${m[1]}/corpus${m[2] || ''}${q >= 0 ? req.originalUrl.slice(q) : ''}`);
}
