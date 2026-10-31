// Gate: authMiddleware's public bypass matches FULL paths only. A bare '/status' once skipped auth on every
// router's /status, so /api/publish/status answered 401 and looped the signed-in workspace to /login (2026-10-20).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/server/middleware/auth.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('export const authMiddleware'), src.indexOf('export const authMiddleware') + 900);
assert.match(block, /publicPaths\.has\(String\(req\.originalUrl/, 'bypass must test the full original URL, not req.path');
assert.doesNotMatch(block, /publicPaths\.has\(req\.path\)/, 'req.path is mount-relative');
for (const p of [...block.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]).filter((p) => p !== '/')) {
  if (/^\/api\//.test(p) || p.startsWith('/+')) continue;
  assert.fail(`public path ${p} is not a full /api/ path`);
}
console.log('auth-public-paths: ok');
