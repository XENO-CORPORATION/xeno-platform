/**
 * XENO Artifacts — source gates (no database).
 *
 * The DB-backed proof is src/server/tests/artifacts.test.mjs (core suite).
 * These pin what that proof cannot: that the routers are MOUNTED in the real
 * app (built, tested, unreachable is this ecosystem's recurring shape), that
 * nginx hands /a/<id> to the backend rather than the SPA, that the raw-file
 * policy is the SAME policy the CLI's loopback viewer enforces plus `sandbox`,
 * and that a page cannot be served without the sandbox directive.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
// Full-line // comments only: a commented-out mount must not satisfy a gate. Block comments are
// left alone — index.js carries `/*` inside string literals, and a naive strip eats real code.
const uncommented = (src) => src.replace(/^\s*\/\/[^\n]*$/gm, '');

test('both artifact routers are mounted in the real app, behind the right middleware', () => {
  const index = uncommented(read('src', 'server', 'index.js'));
  assert.match(index, /import artifactRoutes from '\.\/routes\/artifactRoutes\.js'/);
  assert.match(index, /import \{ createArtifactViewerRouter \} from '\.\/routes\/artifactViewerRoutes\.js'/);
  assert.match(index, /app\.use\('\/api\/artifacts', databaseMiddleware, authMiddleware, artifactRoutes\)/, 'the API is owner-only: authMiddleware in front');
  assert.match(index, /app\.use\('\/a', databaseMiddleware, browserSessionMiddleware\(pool\), createArtifactViewerRouter\(\)\)/, 'the viewer resolves the browser cookie itself — /a is outside /api');
  // express.json is what parses the publish body; it must be registered BEFORE the mount.
  assert.ok(index.indexOf('app.use(express.json(') < index.indexOf("app.use('/api/artifacts'"), 'express.json must precede the artifacts mount');
});

test('nginx proxies /a/<id> (and only the artifact id shape) to the backend, and the regex is QUOTED', () => {
  const conf = read('nginx', 'default.conf').replace(/#[^\n]*/g, '');
  const block = /location ~ "\^\/a\/a_\[A-Za-z0-9\]\{22\}\(\/\.\*\)\?\$" \{([\s\S]*?)\n\s*\}/.exec(conf);
  assert.ok(block, 'a location for /a/a_<22> exists, with the {22} regex in quotes');
  assert.match(block[1], /proxy_pass http:\/\/\$backend_upstream;/);
  assert.match(block[1], /proxy_set_header Host \$host;/);
  assert.match(block[1], /proxy_set_header X-Forwarded-Proto \$scheme;/);
  // An UNQUOTED `{n}` inside `location ~` is parsed by nginx as a block opener and the whole config
  // fails to load — `nginx -t` said exactly that on the first version of this block. Refuse the shape.
  for (const line of conf.split('\n')) {
    if (/^\s*location\s+~\*?\s+[^"'\s]*\{\d/.test(line)) assert.fail(`unquoted brace quantifier in a location regex: ${line.trim()}`);
  }
});

test('the user-content host serves ONLY raw revision files, and the backend refuses raw on any other host', () => {
  const conf = read('nginx', 'default.conf').replace(/#[^\n]*/g, '');
  const server = /server \{\s*listen 80;\s*server_name usercontent\.xenostudio\.ai;([\s\S]*?)\n\}/.exec(conf);
  assert.ok(server, 'a server block for usercontent.xenostudio.ai exists');
  assert.match(server[1], /set \$backend_upstream backend:8080;/, 'the variable is per-server and must be set here too');
  assert.match(server[1], /location ~ "\^\/a\/a_\[A-Za-z0-9\]\{22\}\/v\/\[\^\/\]\+\/r\/\[0-9\]\+\/\.\+\$" \{/, 'only the raw path shape is proxied');
  assert.match(server[1], /location \/ \{\s*return 404;/, 'everything else on that host is 404');
  const viewer = uncommented(read('src', 'server', 'routes', 'artifactViewerRoutes.js'));
  assert.match(viewer, /if \(host && req\.get\('host'\) !== host\) return res\.status\(404\)/, 'raw files refuse the app host when a content host is configured');
  assert.match(viewer, /if \(host && req\.get\('host'\) === host\) return page\(res, 404/, 'the shell refuses the content host');
  assert.match(viewer, /'cross-origin-resource-policy': 'cross-origin'/, 'an opaque-origin frame must be able to load its own files');
  const compose = read('docker-compose.yml');
  for (const name of ['ARTIFACTS_R2_BUCKET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'ARTIFACTS_DIR', 'ARTIFACTS_CONTENT_ORIGIN', 'ARTIFACTS_ENABLED', 'ARTIFACTS_RETENTION_DAYS_PRIVATE', 'ARTIFACTS_RETENTION_DAYS_SHARED', 'PUBLIC_ORIGIN']) {
    assert.ok(compose.includes(`- ${name}=\${${name}:-`), `compose names ${name} (a value in .env alone reaches no container)`);
  }
  assert.match(compose, /- \.\/data\/artifacts:\/app\/data\/artifacts/, 'the filesystem backend is a bind mount, so pages survive a redeploy');
  const index = uncommented(read('src', 'server', 'index.js'));
  assert.match(index, /sweepExpiredArtifacts\(pool\)/, 'retention is wired into the sweep, not just exported');
  const events = uncommented(read('src', 'server', 'services', 'securityEvents.js'));
  for (const t of ['artifact_published', 'artifact_shared', 'artifact_deleted']) assert.ok(events.includes(`'${t}'`), `${t} is a KNOWN security event (unknown types are recorded as unknown_event)`);
});

test('the raw-file CSP is the CLI viewer policy plus sandbox — one policy, two homes', () => {
  const source = read('src', 'server', 'routes', 'artifactViewerRoutes.js');
  const ours = /export const ARTIFACT_PAGE_CSP = \[([\s\S]*?)\]\.join\('; '\);/.exec(source);
  assert.ok(ours, 'ARTIFACT_PAGE_CSP is a literal array in the viewer routes');
  const directives = [...ours[1].matchAll(/^\s*(?:"([^"]*)"|'([^']*)'),?$/gm)].map((m) => m[1] ?? m[2]);
  assert.equal(directives.at(-1), 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads', 'the sandbox directive is last and present');
  assert.ok(!directives.at(-1).includes('allow-same-origin'), 'never allow-same-origin: the page shares xenosystem.ai and must run as an opaque origin');
  assert.ok(directives.includes("connect-src 'none'"), 'an artifact cannot reach any network');
  assert.ok(directives.includes("frame-src 'none'") && directives.includes("object-src 'none'") && directives.includes("base-uri 'none'") && directives.includes("form-action 'none'"));
  // Parity with the CLI, when the sibling checkout is present (it is on the workstation; CI has only this repo).
  const cliViewer = [join(ROOT, '..', 'xeno-agent-cli', 'apps', 'xeno-agent-cli', 'src', 'control-plane', 'artifact-viewer.ts'), join(ROOT, '..', '..', 'xeno-agent-cli', 'apps', 'xeno-agent-cli', 'src', 'control-plane', 'artifact-viewer.ts')].find((p) => existsSync(p));
  if (cliViewer) {
    const cli = /export const ARTIFACT_PAGE_CSP = \[([\s\S]*?)\]\.join\("; "\);/.exec(readFileSync(cliViewer, 'utf8'));
    assert.ok(cli, 'CLI viewer exports ARTIFACT_PAGE_CSP');
    const theirs = [...cli[1].matchAll(/^\s*(?:"([^"]*)"|'([^']*)'),?$/gm)].map((m) => m[1] ?? m[2]);
    assert.deepEqual(directives.slice(0, -1), theirs, 'every directive before `sandbox` matches the CLI viewer byte for byte');
  }
  // The raw route sends that header — not a different literal.
  const rawRoute = source.slice(source.indexOf("router.get('/:id/v/:token/r/:revision/"));
  assert.match(rawRoute, /'content-security-policy': ARTIFACT_PAGE_CSP/);
  assert.match(rawRoute, /'x-content-type-options': 'nosniff'/);
});

test('view tokens are scoped to one artifact + revision and signed with the platform secret', () => {
  const source = uncommented(read('src', 'server', 'services', 'artifactViewToken.js'));
  assert.match(source, /const payload = `\$\{artifactId\}\.\$\{revision\}\.\$\{expiresAt\}`/);
  assert.match(source, /crypto\.timingSafeEqual/);
  assert.match(source, /process\.env\.JWT_SECRET/);
  const viewer = uncommented(read('src', 'server', 'routes', 'artifactViewerRoutes.js'));
  assert.match(viewer, /grant\.artifactId !== id \|\| grant\.revision !== revision/, 'the raw route checks BOTH scopes, not just the signature');
});

test('the artifacts suite is in the core DB list on both sides of the drift gate', () => {
  assert.match(read('scripts', 'ci-local.mjs'), /'artifacts',\n\];/);
  assert.match(read('.github', 'workflows', 'core-tests.yml'), /suspension-gate artifacts"/);
});

test('storage refuses keys outside the artifacts namespace and never overwrites a revision key by design', () => {
  const storage = uncommented(read('src', 'server', 'services', 'artifactStorage.js'));
  assert.match(storage, /const KEY_PATTERN = \/\^artifacts\\\/\[A-Za-z0-9_-\]\+\\\/r\\d\+\\\/\[A-Za-z0-9\._\\-\/\]\+\$\//);
  assert.match(storage, /key\.includes\('\.\.'\)/);
  const service = uncommented(read('src', 'server', 'services', 'artifactService.js'));
  assert.match(service, /if \(latest && latest\.content_hash === prepared\.contentHash\) return \{ \.\.\.current, unchanged: true \};/, 'unchanged bytes never mint a revision');
  assert.match(service, /SELECT current_revision FROM artifacts WHERE id=\$1 FOR UPDATE/, 'concurrent revisions are serialized on the row');
});
