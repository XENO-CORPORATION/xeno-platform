import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const deploy = readFileSync(new URL('./deploy-platform.mjs', import.meta.url), 'utf8');
const remote = readFileSync(new URL('./remote-deploy.sh', import.meta.url), 'utf8');
const dockerignore = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8');
const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
const backendDockerfile = readFileSync(new URL('../Dockerfile.backend', import.meta.url), 'utf8');
const backendDockerignore = readFileSync(new URL('../Dockerfile.backend.dockerignore', import.meta.url), 'utf8');
const frontendDockerfile = readFileSync(new URL('../Dockerfile.frontend', import.meta.url), 'utf8');

test('backend deploy ships the Docker context policy with every source archive', () => {
  assert.match(
    deploy,
    /backend:\s*\[[^\]]*['"]Dockerfile\.backend\.dockerignore['"]/,
    'backend PATHS must include the Dockerfile-specific context policy',
  );
  assert.match(deploy, /['"]chat-workers['"]:\s*\[[^\]]*['"]Dockerfile\.backend\.dockerignore['"]/);
});

test('worker deploy ships backend inputs and gates the semantic component without coupling Docker health to it', () => {
  assert.match(deploy, /['"]chat-workers['"]:\s*\[[^\]]*['"]Dockerfile\.backend['"]/);
  assert.match(deploy, /['"]chat-workers['"]:\s*\[[^\]]*['"]Dockerfile\.backend\.dockerignore['"]/);
  assert.match(deploy, /backend:\s*\[[^\]]*['"]Dockerfile\.backend\.dockerignore['"]/);
  assert.match(backendDockerignore, /^src\/server\/uploads$/m);
  assert.match(backendDockerignore, /^src\/server\/node_modules$/m);
  assert.match(backendDockerignore, /^src\/server\/extractor-jobs$/m);
  assert.match(deploy, /internal \/ready\/semantic/);
  assert.match(remote, /chat-workers internal \/ready\/semantic/);
  assert.match(remote, /worker_path="\/ready\/semantic"/);
  assert.match(remote, /poll_health "\$TRIES" release/);
  assert.match(remote, /poll_health "\$TRIES" rollback/);
  assert.match(remote, /worker_path="\/ready"/);
  assert.match(remote, /docker tag "\$IMAGE:latest" xeno-platform-chat-extractor:latest/);
  assert.match(remote, /dc up -d --no-deps --no-build --force-recreate chat-extractor/);
  assert.match(remote, /poll_extractor_health 30/);
  assert.match(remote, /matched chat-extractor healthcheck PASSED/);
  assert.match(remote, /xeno-platform-chat-extractor:rollback/);
  assert.match(
    readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8'),
    /chat-workers:[\s\S]*healthcheck:[\s\S]*127\.0\.0\.1:8081\/ready/,
  );
});

test('worker deploy proves the matched extractor before swapping the worker', () => {
  const extractorGate = remote.indexOf('matched chat-extractor healthcheck PASSED');
  const workerSwap = remote.indexOf('dc up -d --no-deps --force-recreate "$SERVICE"');
  assert.ok(extractorGate >= 0, 'expected a matched extractor gate');
  assert.ok(extractorGate < workerSwap, 'extractor must be healthy before workers are swapped');
  assert.match(remote, /FAILED \(extractor gate\)/);
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

test('candidate images build only from the isolated git archive, never the mutable host checkout', () => {
  assert.match(remote, /CANDIDATE_ROOT="\$\(mktemp -d "\$ROOT\/\.deploy\/candidates\/\$SHA-\$SERVICE-/);
  assert.match(remote, /tar xf "\$TAR" -C "\$CANDIDATE_ROOT"/);
  assert.doesNotMatch(remote, /tar xf "\$TAR" --overwrite/);
  assert.match(remote, /build_dc\(\).*--project-name xeno-platform.*--project-directory "\$CANDIDATE_ROOT".*"\$CANDIDATE_ROOT\/docker-compose\.yml"/);
  assert.match(remote, /build_dc build \$NOCACHE "\$SERVICE"/);
  const installCompose = remote.indexOf('installed candidate Compose definition after image qualification');
  const dependencyGate = remote.indexOf('production dependency graph PASSED inside');
  const swap = remote.indexOf('dc up -d --no-deps --force-recreate "$SERVICE"');
  assert.ok(installCompose > dependencyGate, 'live Compose must not change before candidate qualification');
  assert.ok(installCompose < swap, 'the qualified runtime definition must be installed before swap');
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

test('extractor service and deploy PID limits remain consistent for production Compose', () => {
  const extractor = compose.slice(compose.indexOf('  chat-extractor:'), compose.indexOf('  chat-workers:'));
  assert.match(extractor, /pids_limit:\s*128/);
  assert.match(extractor, /deploy:[\s\S]*resources:[\s\S]*limits:[\s\S]*pids:\s*128/);
});

test('every service extraction preserves hardened backend bind-mount ownership before any swap', () => {
  const ownershipGate = remote.indexOf('WRITABLE_MOUNTS=(');
  const build = remote.indexOf('dc build $NOCACHE "$SERVICE"');
  const swap = remote.indexOf('dc up -d --no-deps --force-recreate "$SERVICE"');
  assert.ok(ownershipGate >= 0, 'expected an explicit writable-mount ownership gate');
  assert.ok(ownershipGate < build, 'bind mounts must be repaired before the candidate build completes');
  assert.ok(ownershipGate < swap, 'bind mounts must be repaired before the backend swap');
  const ownershipBlock = remote.slice(ownershipGate, remote.indexOf('# --- 3. Tag current image'));
  assert.doesNotMatch(ownershipBlock, /if \[ "\$SERVICE" = "backend" \]/);
  assert.match(remote, /install -d -m 2770 -o 1001 -g 1001 "\$mount_path"/);
  assert.match(remote, /chown -R 1001:1001 "\$mount_path"/);
  for (const mount of [
    'src/server/uploads',
    'src/server/sam2-uploads',
    'src/server/storage',
    'conversions',
    'storage/videos',
    'storage/thumbnails',
    'storage/assets',
  ]) {
    assert.match(remote, new RegExp(`\\n\\s+${mount.replaceAll('/', '\\/')}\\n`));
  }
});

test('the scoped Web Context token is readable only by root and the backend runtime group', () => {
  assert.match(remote, /install -d -m 0750 -o root -g 1001 "\$ROOT\/secrets"/);
  assert.match(remote, /refusing symlinked Web Context token file/);
  assert.match(remote, /chown root:1001 "\$WEB_CONTEXT_TOKEN"/);
  assert.match(remote, /chmod 0440 "\$WEB_CONTEXT_TOKEN"/);
  assert.doesNotMatch(remote, /chmod 0?44[4-7] "\$WEB_CONTEXT_TOKEN"/);
});
