import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const deploy = readFileSync(new URL('./deploy-platform.mjs', import.meta.url), 'utf8');
const remote = readFileSync(new URL('./remote-deploy.sh', import.meta.url), 'utf8');
const dockerignore = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8');
const backendDockerfile = readFileSync(new URL('../Dockerfile.backend', import.meta.url), 'utf8');
const frontendDockerfile = readFileSync(new URL('../Dockerfile.frontend', import.meta.url), 'utf8');

test('backend deploy ships the Docker context policy with every source archive', () => {
  assert.match(
    deploy,
    /backend:\s*\[[^\]]*['"]\.dockerignore['"]/,
    'backend PATHS must include .dockerignore so the host cannot retain a stale context policy',
  );
});

test('frontend deploy ships every first-party source tree copied by its Dockerfile', () => {
  assert.match(frontendDockerfile, /COPY packages\/ \.\/packages\//, 'expected the frontend image to consume packages/');
  assert.match(
    deploy,
    /frontend:\s*\[[^\]]*['"]packages['"]/,
    'frontend PATHS must include packages/ so shared controls cannot build from stale host bytes',
  );
});

test('Docker context excludes nested dependency trees after server exceptions', () => {
  const exception = dockerignore.lastIndexOf('!src/server/lib/chatModelCapabilities.js');
  const exclusion = dockerignore.lastIndexOf('**/node_modules/**');
  assert.ok(exception >= 0, 'expected the server shared-module exception');
  assert.ok(exclusion > exception, 'nested node_modules exclusion must follow server re-includes');
});

test('backend image dependency graph is proven before build-only or swap can pass', () => {
  const gate = remote.indexOf('npm "$IMAGE:latest" ls --omit=dev');
  const buildOnly = remote.indexOf('if [ "$MODE" = "build-only" ]');
  const swap = remote.indexOf('dc up -d --no-deps --force-recreate "$SERVICE"');
  assert.ok(gate >= 0, 'expected the in-image npm dependency gate');
  assert.ok(gate < buildOnly, 'dependency gate must run before build-only reports success');
  assert.ok(gate < swap, 'dependency gate must run before the image is swapped');
  assert.match(remote, /restored \$IMAGE:latest to :rollback after pre-swap gate failure/);
});

test('backend install runs after source COPY and removes any host dependency tree first', () => {
  const sourceCopy = backendDockerfile.indexOf('COPY --chown=appuser:appgroup src/server/ ./');
  const removeDependencies = backendDockerfile.indexOf('RUN rm -rf node_modules');
  const lockedInstall = backendDockerfile.indexOf('npm ci --omit=dev', removeDependencies);
  assert.ok(sourceCopy >= 0, 'expected backend source COPY');
  assert.ok(removeDependencies > sourceCopy, 'host node_modules must be removed after source COPY');
  assert.ok(lockedInstall > removeDependencies, 'locked install must rebuild the graph after removal');
});

test('build-only preserves the candidate by SHA and restores latest to last-good', () => {
  const branch = remote.slice(
    remote.indexOf('if [ "$MODE" = "build-only" ]'),
    remote.indexOf('# --- 5. Swap'),
  );
  assert.match(branch, /docker tag "\$IMAGE:rollback" "\$IMAGE:latest"/);
  assert.match(branch, /Candidate remains tagged :\$SHA/);
});
