/**
 * route-mounting.test.mjs — the structural gate for "the route surface is what we
 * think it is".
 *
 * Every check here exists because the corresponding claim was FALSE in production:
 *
 *   1. MOUNT COVERAGE  — API_REFERENCE.md certified three route files as "not
 *      mounted", inviting the next agent to delete them. One (accountRoutes.js) was
 *      live; the other two did not exist. Prose cannot be trusted for this; assert it.
 *
 *   2. NO SHADOWED ROUTES — `router.delete('/:id')` was registered BEFORE
 *      `router.delete('/cookies')` in downloadRoutes.js. Express matches layers in
 *      REGISTRATION order, so the param route swallowed the literal one: the request
 *      ran deleteDownload('cookies'), 404'd, and the user's stored YouTube auth
 *      cookies were never deleted while the UI said they were. A unit test that calls
 *      the handler directly cannot see this — only the routing table can.
 *
 *   3. COOKIE DELETION IS REACHABLE — the specific regression above, driven THROUGH
 *      a real Express router over real HTTP, asserting deleteCookies() actually fires.
 *
 *   4. NO UNMOUNTED RATE LIMITERS — middleware/rateLimiter.js exported four limiters
 *      that nothing imported (including a 3/hour password-reset control, while the
 *      live endpoints ran on a ~13x weaker inline one). An exported-but-unmounted
 *      security control reads as protection and enforces nothing.
 *
 *   5. OIDC ADVERTISES ONLY WHAT IT IMPLEMENTS — discovery advertised
 *      `client_secret_post` while the token endpoint never reads client_secret, so a
 *      relying party onboarded from the discovery document would believe its secret
 *      authenticated it.
 *
 * Hermetic: no database, no network, no live host. Runs anywhere.
 *
 * Run: node tests/route-mounting.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(__dirname, '..');
const ROUTES_DIR = path.join(SERVER_DIR, 'routes');

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.log(`  ✗ ${msg}`); }
};

const read = (p) => fs.readFileSync(p, 'utf8');

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the full argument text of every `<obj>.<method>(...)` call in `src`,
 * using real paren balancing so multi-line calls are captured whole. Line-based
 * grepping is not enough: index.js mounts fileSystemRoutes three lines below its
 * own `app.use(` token.
 */
function callArgs(src, methods) {
  const out = [];
  const re = new RegExp(`\\.(?:${methods.join('|')})\\(`, 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

/** All JS sources under src/server that could mount a router (tests excluded). */
function serverSources() {
  const files = [];
  const skip = new Set(['node_modules', 'tests', 'data', 'downloads', 'uploads', 'storage', 'dist']);
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!skip.has(e.name)) walk(path.join(dir, e.name));
      } else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) {
        files.push(path.join(dir, e.name));
      }
    }
  })(SERVER_DIR);
  return files;
}

/** Parse `import a, { b as c, d } from '<spec>'` → { spec, bindings: [...] }. */
function parseImports(src) {
  const out = [];
  const re = /import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const clause = m[1];
    const bindings = [];
    const defaultPart = clause.split('{')[0].replace(/\*\s+as\s+/, '').trim().replace(/,$/, '');
    if (defaultPart) bindings.push(defaultPart.trim());
    const named = clause.match(/\{([^}]*)\}/);
    if (named) {
      for (const raw of named[1].split(',')) {
        const t = raw.trim();
        if (!t) continue;
        bindings.push((t.includes(' as ') ? t.split(' as ')[1] : t).trim());
      }
    }
    out.push({ spec: m[2], bindings: bindings.filter(Boolean) });
  }
  return out;
}

/** Express path pattern → RegExp (`:param` → one segment, `*` → anything). */
function patternToRegex(p) {
  const body = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/:[A-Za-z0-9_]+/g, '[^/]+')
    .replace(/\*/g, '.*');
  return new RegExp(`^${body}\\/?$`);
}

/** A concrete sample path a pattern would produce (`/status/:id` → `/status/_x_`). */
const sampleOf = (p) => p.replace(/:[A-Za-z0-9_]+/g, '_x_').replace(/\*/g, '_x_');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n1. Every route file in routes/ is actually mounted');
// ══════════════════════════════════════════════════════════════════════════════

const routeFiles = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js'));
ok(routeFiles.length > 0, `found ${routeFiles.length} route files to check`);

const sources = serverSources().map((f) => ({ file: f, src: read(f) }));

for (const rf of routeFiles) {
  const importers = [];
  for (const { file, src } of sources) {
    if (path.dirname(file) === ROUTES_DIR) continue; // a router importing a sibling isn't a mount
    for (const imp of parseImports(src)) {
      if (path.basename(imp.spec) === rf && imp.spec.includes('routes/')) {
        importers.push({ file, src, bindings: imp.bindings });
      }
    }
  }

  if (importers.length === 0) {
    ok(false, `${rf} is imported by a mounting module (NOT IMPORTED ANYWHERE — dead route file)`);
    continue;
  }

  // Every binding taken out of the file must reach a `.use(` / `.get(` / … call.
  const unmounted = [];
  for (const imp of importers) {
    const mountText = callArgs(imp.src, ['use', ...HTTP_METHODS]).join('\n');
    for (const b of imp.bindings) {
      if (!new RegExp(`\\b${b}\\b`).test(mountText)) {
        unmounted.push(`${b} (imported by ${path.basename(imp.file)})`);
      }
    }
  }
  ok(
    unmounted.length === 0,
    `${rf} — every export is passed to a mount call${unmounted.length ? ` [UNMOUNTED: ${unmounted.join(', ')}]` : ''}`,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n2. No route is shadowed by an earlier registration on the same router');
// ══════════════════════════════════════════════════════════════════════════════

for (const rf of routeFiles) {
  const src = read(path.join(ROUTES_DIR, rf));

  // Parse registrations in source order. Fail LOUDLY on any form the parser does not
  // understand rather than silently under-reporting (that is how S1 stayed invisible).
  const registered = [];
  const re = /\brouter\.(get|post|put|patch|delete|options|head)\(\s*(['"`])([^'"`]*)\2/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    registered.push({ method: m[1], p: m[3] });
  }
  const total = (src.match(/\brouter\.(?:get|post|put|patch|delete|options|head)\(/g) || []).length;
  if (total !== registered.length) {
    ok(false, `${rf} — parser understood ${registered.length}/${total} registrations (unrecognised path form; fix the parser, do not ignore)`);
    continue;
  }

  const shadows = [];
  for (let j = 0; j < registered.length; j++) {
    const later = registered[j];
    const sample = sampleOf(later.p);
    for (let i = 0; i < j; i++) {
      const earlier = registered[i];
      if (earlier.method !== later.method) continue;
      if (patternToRegex(earlier.p).test(sample)) {
        shadows.push(`${later.method.toUpperCase()} '${later.p}' is unreachable — '${earlier.p}' is registered earlier and matches it`);
        break;
      }
    }
  }
  ok(shadows.length === 0, `${rf} — no shadowed routes${shadows.length ? `\n      ${shadows.join('\n      ')}` : ''}`);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n3. DELETE /api/download/cookies really invokes deleteCookies (S1 regression)');
// ══════════════════════════════════════════════════════════════════════════════

const downloadService = (await import('../services/downloadService.js')).default;
const downloadRoutes = (await import('../routes/downloadRoutes.js')).default;

const calls = [];
downloadService.deleteCookies = (userId) => { calls.push(['deleteCookies', userId]); };
downloadService.deleteDownload = (id, userId) => { calls.push(['deleteDownload', id, userId]); return true; };

const app = express();
app.use(express.json());
app.use('/api/download', (req, _res, next) => { req.user = { id: 'user-under-test' }; next(); }, downloadRoutes);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// The cookies route.
calls.length = 0;
const delCookies = await fetch(`${base}/api/download/cookies`, { method: 'DELETE' });
const delCookiesBody = await delCookies.json().catch(() => ({}));

ok(delCookies.status === 200, `DELETE /api/download/cookies → 200 (got ${delCookies.status})`);
ok(
  calls.some((c) => c[0] === 'deleteCookies'),
  `deleteCookies() was invoked${calls.length ? ` [saw: ${calls.map((c) => c[0]).join(', ')}]` : ' [NOTHING was invoked]'}`,
);
ok(
  !calls.some((c) => c[0] === 'deleteDownload'),
  'deleteDownload() was NOT invoked with the literal string "cookies" as an id',
);
ok(delCookiesBody.success === true, 'response reports success only when the deletion actually happened');

// The param route it used to shadow must still work.
calls.length = 0;
const delById = await fetch(`${base}/api/download/abc123`, { method: 'DELETE' });
ok(delById.status === 200, `DELETE /api/download/:id still routes (got ${delById.status})`);
ok(
  calls.some((c) => c[0] === 'deleteDownload' && c[1] === 'abc123'),
  'deleteDownload("abc123") was invoked — the reorder did not break the param route',
);

// Unauthenticated callers are still rejected on the cookies route.
const appNoAuth = express();
appNoAuth.use(express.json());
appNoAuth.use('/api/download', downloadRoutes);
const server2 = http.createServer(appNoAuth);
await new Promise((resolve) => server2.listen(0, '127.0.0.1', resolve));
const base2 = `http://127.0.0.1:${server2.address().port}`;
calls.length = 0;
const anon = await fetch(`${base2}/api/download/cookies`, { method: 'DELETE' });
ok(anon.status === 401, `unauthenticated DELETE /api/download/cookies → 401 (got ${anon.status})`);
ok(calls.length === 0, 'no service call made for an unauthenticated request');

server.close();
server2.close();

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n4. Every rate limiter exported from middleware/rateLimiter.js is imported');
// ══════════════════════════════════════════════════════════════════════════════

const limiterSrc = read(path.join(SERVER_DIR, 'middleware', 'rateLimiter.js'));
const exported = [...limiterSrc.matchAll(/^export\s+(?:const|function)\s+([A-Za-z0-9_]+)/gm)].map((x) => x[1]);
ok(exported.length > 0, `found ${exported.length} exports: ${exported.join(', ')}`);

ok(
  !/^export\s+default/m.test(limiterSrc),
  'rateLimiter.js has no aggregate default export (a bag nobody opens hides unmounted limiters from grep)',
);

const importedLimiters = new Set();
for (const { file, src } of sources) {
  if (path.basename(file) === 'rateLimiter.js') continue;
  for (const imp of parseImports(src)) {
    if (path.basename(imp.spec) === 'rateLimiter.js') imp.bindings.forEach((b) => importedLimiters.add(b));
  }
}
// Aliased imports land under their local name; match by usage instead for those.
const allSrc = sources.map((s) => s.src).join('\n');
for (const name of exported) {
  const used = importedLimiters.has(name) || new RegExp(`\\b${name}\\s+as\\s+`).test(allSrc);
  ok(used, `${name} is imported by at least one module (an unmounted limiter is a decoy, not a control)`);
}

// The specific control this finding was about.
const indexSrc = read(path.join(SERVER_DIR, 'index.js'));
const mountText = callArgs(indexSrc, ['use']).join('\n');
ok(
  /passwordResetLimiter/.test(mountText),
  'passwordResetLimiter is mounted in index.js (3/hour on the token-minting endpoints)',
);
for (const p of ['/api/auth/forgot-password', '/api/auth/resend-verification']) {
  ok(
    callArgs(indexSrc, ['use']).some((a) => a.includes(`'${p}'`) && a.includes('passwordResetLimiter')),
    `${p} is behind passwordResetLimiter`,
  );
}

// Every limiter must key on the real client IP. The default req.ip key collapses to a
// single constant hop behind CF → cloudflared → nginx, turning any such limiter into
// one global bucket shared by every visitor (a platform-wide outage primitive).
const limiterBlocks = limiterSrc.split(/^export\s+const\s+/m).slice(1);
for (const block of limiterBlocks) {
  const name = block.split(/[^A-Za-z0-9_]/)[0];
  if (!/rateLimit\(/.test(block)) continue;
  ok(/keyGenerator\s*:/.test(block), `${name} sets an explicit keyGenerator (never the collapsed default req.ip key)`);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n5. OIDC discovery advertises only auth methods the token endpoint implements');
// ══════════════════════════════════════════════════════════════════════════════

const { discovery } = await import('../utils/oidcProvider.js');
const disco = discovery();
const methods = disco.token_endpoint_auth_methods_supported;

ok(Array.isArray(methods), 'discovery exposes token_endpoint_auth_methods_supported');
ok(
  JSON.stringify(methods) === JSON.stringify(['none']),
  `advertises public-client auth only — got ${JSON.stringify(methods)} (XENO AUTH - SPEC.md locks every product as a PUBLIC client)`,
);

const oauthSrc = read(path.join(ROUTES_DIR, 'oauth2Routes.js'));
const readsSecret = /req\.body(?:\s*\|\|\s*\{\})?\s*(?:\.|\[['"])client_secret|\bb\.client_secret\b/.test(oauthSrc);
ok(!readsSecret, 'the token endpoint does not read client_secret (nothing to advertise)');
ok(
  !methods.includes('client_secret_post') || readsSecret,
  'client_secret_post is advertised ONLY if the token endpoint verifies a secret',
);

// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(60)}`);
console.log(`route-mounting: ${pass} passed, ${fail} failed`);
console.log(`${'='.repeat(60)}\n`);

// downloadService installs a 15-minute cleanup interval on import; exit explicitly.
process.exit(fail > 0 ? 1 : 0);
