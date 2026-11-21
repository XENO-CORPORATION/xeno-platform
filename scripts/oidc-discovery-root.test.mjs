// OIDC Discovery 1.0 §4 / RFC 8414 §3: the discovery document lives at <issuer>/.well-known/openid-configuration.
// Our issuer is the site origin (config/hosts.js), and until 2026-11-21 that path served the website shell, so a
// standard verifier that finds its keys from `iss` (XENO Depot's Lore server, decision 0001 §3 amended) could not.
// This pins both halves: nginx sends the exact path to the backend, ahead of the site gate and the SPA, and the
// backend answers it with the same document as /api/oauth2/.well-known/openid-configuration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nginx = readFileSync('nginx/default.conf', 'utf8');
const index = readFileSync('src/server/index.js', 'utf8');

function block(text, opener) {
  const i = text.indexOf(opener);
  if (i < 0) return null;
  let depth = 0;
  for (let j = text.indexOf('{', i); j < text.length; j++) {
    if (text[j] === '{') depth++;
    if (text[j] === '}' && --depth === 0) return text.slice(i, j + 1);
  }
  return null;
}

test('nginx sends <issuer>/.well-known/openid-configuration to the backend, outside the site gate', () => {
  const b = block(nginx, 'location = /.well-known/openid-configuration');
  assert.ok(b, 'no exact-match location for the discovery path: the SPA answers it with HTML');
  assert.match(b, /proxy_pass http:\/\/\$backend_upstream;/);
  assert.match(b, /proxy_set_header Host \$host;/, 'the backend picks the issuer from Host (issuerForHost)');
  assert.doesNotMatch(b, /auth_request/, 'discovery must not be behind the site gate');
});

test('the backend answers the root discovery path with the issuer document', () => {
  assert.match(index, /app\.get\('\/\.well-known\/openid-configuration', \(req, res\) => res\.json\(oidcDiscovery\(issuerForHost\(req\.headers\.host\)\)\)\);/);
});
