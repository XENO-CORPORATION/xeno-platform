/**
 * `GET /api/favicon?domain=<host>` — a cited site's icon, through US.
 *
 * The chat's citation chips and sources line show the favicon of every source the model read.
 * They must never load it from the site directly: that is one request per render from the
 * user's own browser to every cited host (an IP leak the user did not choose), and a fair share
 * of sites refuse hotlinked icons anyway. Claude, Perplexity and ChatGPT all proxy them for the
 * same two reasons (2026-09-18). So the browser asks us, and we ask the site — once.
 *
 * What it does, in order: `https://<domain>/favicon.ico`; failing that, the site's home page
 * (first 64 KB) for a `<link rel="icon" …>`; failing that, 404 — and the client paints a letter
 * tile, never a broken image. Every upstream URL — including each redirect hop, followed by hand
 * — passes `assertPublicHttpUrl`, because `domain` is user-controlled and this is exactly the
 * shape of an SSRF pivot (`XENO CREDENTIAL HYGIENE - PLAYBOOK.md` §SSRF). Bytes are accepted only
 * if they look like an image (magic bytes or an SVG root), capped at 256 KB.
 *
 * Cached in memory per domain — hits for a day, misses for an hour — and served with a public
 * `Cache-Control` so the browser and the CDN hold it too. A favicon carries no user data, so
 * the endpoint is unauthenticated and sits behind the global limiter only.
 */
import express from 'express';
import { assertPublicHttpUrl } from '../utils/urlGuard.js';

const router = express.Router();

const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const MAX_BYTES = 256 * 1024;
const MAX_HTML_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 4000;
const MAX_HOPS = 3;
const CACHE_MAX = 5000;

/** domain → { until, body: Buffer | null, type } */
const cache = new Map();

// labels of letters/digits/hyphens, at least two, and a TLD of letters — which is also what keeps an IP literal out
const DOMAIN = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})*\.[a-z]{2,63}$/;

/** A hostname, or null. Not an IP, not a single label, not a path. */
export function normalizeDomain(raw) {
  const value = String(raw || '').trim().toLowerCase().replace(/\.$/, '');
  return DOMAIN.test(value) ? value : null;
}

/** Does this look like an icon? Magic bytes, or an SVG document — never trust the header alone. */
export function sniffImageType(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x00 && buf[1] === 0x00 && (buf[2] === 0x01 || buf[2] === 0x02) && buf[3] === 0x00) return 'image/x-icon';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  const head = buf.toString('utf8', 0, Math.min(buf.length, 512)).trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

/** The icon `<link>` a page declares — the first `rel` containing "icon", resolved against the page. */
export function iconLinkFromHtml(html, pageUrl) {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  let fallback = null;
  for (const tag of links) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() || '';
    if (!/\bicon\b/.test(rel)) continue;
    const href = /\bhref\s*=\s*["']?([^"'>\s]+)/i.exec(tag)?.[1];
    if (!href) continue;
    let resolved;
    try { resolved = new URL(href, pageUrl).toString(); } catch { continue; }
    // a plain "icon" beats "apple-touch-icon" (usually a large PNG); take the first plain one, else the first any
    if (/^(?:shortcut )?icon$/.test(rel.trim())) return resolved;
    fallback ??= resolved;
  }
  return fallback;
}

/** Fetch with a deadline, hand-followed redirects (each hop guarded) and a byte cap. */
async function fetchBounded(url, limit, { fetchImpl, guard }) {
  let current = url;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    await guard(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetchImpl(current, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'XENO-favicon/1 (+https://xenosystem.ai)', accept: 'image/*,text/html;q=0.5,*/*;q=0.1' } });
    } finally { clearTimeout(timer); }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return null;
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) return null;
    const reader = res.body?.getReader?.();
    if (!reader) return { url: current, body: Buffer.from(await res.arrayBuffer()).subarray(0, limit), type: res.headers.get('content-type') || '' };
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      size += value.byteLength;
      if (size >= limit) { await reader.cancel().catch(() => {}); break; }
    }
    return { url: current, body: Buffer.concat(chunks).subarray(0, limit), type: res.headers.get('content-type') || '' };
  }
  return null;
}

/**
 * Resolve a domain's icon: bytes + type, or null. Exported so the test drives it with a fake fetch;
 * `guard` is the SSRF check every upstream URL passes (the real one by default — the test swaps
 * in one that resolves no DNS for made-up names and keeps the real check for IP literals).
 */
export async function resolveFavicon(domain, { fetchImpl = fetch, guard = assertPublicHttpUrl } = {}) {
  const io = { fetchImpl, guard };
  const direct = await fetchBounded(`https://${domain}/favicon.ico`, MAX_BYTES, io).catch(() => null);
  const directType = direct && sniffImageType(direct.body);
  if (directType) return { body: direct.body, type: directType };

  const page = await fetchBounded(`https://${domain}/`, MAX_HTML_BYTES, io).catch(() => null);
  if (!page || !/html/i.test(page.type)) return null;
  const iconUrl = iconLinkFromHtml(page.body.toString('utf8'), page.url);
  if (!iconUrl || /^data:/i.test(iconUrl)) return null;
  const icon = await fetchBounded(iconUrl, MAX_BYTES, io).catch(() => null);
  const iconType = icon && sniffImageType(icon.body);
  return iconType ? { body: icon.body, type: iconType } : null;
}

function remember(domain, entry) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(domain, entry);
}

router.get('/', async (req, res) => {
  const domain = normalizeDomain(req.query.domain);
  if (!domain) return res.status(400).json({ error: 'invalid_domain' });

  const now = Date.now();
  const cached = cache.get(domain);
  const entry = cached && cached.until > now ? cached : null;
  let resolved = entry;
  if (!resolved) {
    const icon = await resolveFavicon(domain).catch(() => null);
    resolved = icon
      ? { until: now + HIT_TTL_MS, body: icon.body, type: icon.type }
      : { until: now + MISS_TTL_MS, body: null, type: '' };
    remember(domain, resolved);
  }
  if (!resolved.body) {
    res.set('Cache-Control', `public, max-age=${Math.floor(MISS_TTL_MS / 1000)}`);
    return res.status(404).end();
  }
  res.set('Content-Type', resolved.type);
  res.set('Cache-Control', `public, max-age=${Math.floor(HIT_TTL_MS / 1000)}, immutable`);
  res.set('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(resolved.body);
});

export default router;
