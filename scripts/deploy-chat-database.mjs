#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opts = {
  execute: false,
  qualifyOnly: false,
  host: 'xeno-platform-001',
  root: '/mnt/projects/xeno-platform',
  expectedDbImage: '',
};
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === '--execute') opts.execute = true;
  else if (arg === '--qualify-only') opts.qualifyOnly = true;
  else if (arg === '--host') opts.host = argv[++index];
  else if (arg === '--root') opts.root = argv[++index];
  else if (arg === '--expected-db-image') opts.expectedDbImage = argv[++index];
  else throw new Error(`unknown argument: ${arg}`);
}

const repo = new URL('..', import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1');
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: repo, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
};

const sha = git(['rev-parse', 'HEAD']);
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const dirty = git(['status', '--porcelain', '--', 'docker-compose.yml', 'src/server', 'scripts/deploy-chat-database.mjs', 'scripts/remote-chat-database-cutover.sh']);
if (dirty) throw new Error(`database cutover inputs are dirty:\n${dirty}`);
if (opts.expectedDbImage && !/^sha256:[0-9a-f]{64}$/.test(opts.expectedDbImage)) {
  throw new Error('--expected-db-image must be an exact sha256 image ID');
}
if (opts.execute && !opts.expectedDbImage) {
  throw new Error('--expected-db-image is required with --execute');
}

console.log(`chat database cutover branch=${branch} sha=${sha}`);
console.log(`host=${opts.host} root=${opts.root}`);
console.log(`mode=${opts.qualifyOnly ? 'qualify-only' : 'qualify-and-cutover'} ${opts.execute ? 'EXECUTE' : 'DRY-RUN'}`);
console.log(`expected-db-image=${opts.expectedDbImage || '<required for execute>'}`);
console.log('precondition: the exact backend candidate image must already exist from deploy-platform --build-only');
console.log('1. take and validate a production-format backup');
console.log('2. restore it into an isolated pinned pgvector 0.8.6/PostgreSQL 15 volume');
console.log('3. run the exact candidate migration runner and verify vector plus every migration');
if (!opts.qualifyOnly) {
  console.log('4. stop the API writer, take a second quiesced backup, recreate PostgreSQL on the pinned pgvector image, and migrate');
  console.log('5. restart the API only after schema verification; restore the quiesced backup to a separate old-image volume if cutover fails');
}
console.log('qualification and backup volumes are retained until separately authorized cleanup');
if (!opts.execute) process.exit(0);

const remote = join(repo, 'scripts', 'remote-chat-database-cutover.sh');
run('ssh', [opts.host, 'mkdir -p /tmp/xeno-chat-db-cutover']);
run('scp', ['-q', remote, `${opts.host}:/tmp/xeno-chat-db-cutover/remote-chat-database-cutover.sh`]);
run('ssh', [opts.host,
  `sudo bash /tmp/xeno-chat-db-cutover/remote-chat-database-cutover.sh --sha ${sha} --expected-db-image ${opts.expectedDbImage} --mode ${opts.qualifyOnly ? 'qualify-only' : 'cutover'} --root ${opts.root}`]);

