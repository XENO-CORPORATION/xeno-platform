// deploy-platform.mjs --build-here: the image is built on the release machine with the SAME build inputs the box uses.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildArgVars, buildEnvFile, requiredComposeVars } from './lib/local-image-build.mjs';

const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');

test('the real compose file: every required production variable gets a placeholder, and no build argument does', () => {
  const required = requiredComposeVars(compose);
  assert.ok(required.length > 0, 'the compose file requires production variables (so compose refuses to run without them)');
  const env = buildEnvFile(compose);
  for (const name of required) assert.match(env, new RegExp(`^${name}=build-here-placeholder$`, 'm'));
  for (const name of buildArgVars(compose)) assert.doesNotMatch(env, new RegExp(`^${name}=`, 'm'), `${name} feeds a build and must stay as on the box`);
  assert.ok(buildArgVars(compose).includes('VITE_ENABLE_SITE_GATE'), 'the frontend build arguments are read from the compose file itself');
});

test('a build that reads a required production variable is refused: it must be built on the box', () => {
  const risky = 'services:\n  web:\n    build:\n      args:\n        - API_KEY=${API_KEY}\n    environment:\n      API_KEY: ${API_KEY:?set it}\n';
  assert.throws(() => buildEnvFile(risky), /build it on the box/);
});
