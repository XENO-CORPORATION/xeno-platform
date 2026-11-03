// The real stack, nothing stubbed: Postgres from production's own image (pgvector/pgvector:0.8.6-pg15) in a throwaway
// container on xeno-platform-001, reached through an SSH tunnel; the real backend (src/server/index.js) and the real
// site (vite) on this PC, the site's /api proxied to that backend. stop.mjs removes the container and its data.
// Usage: node scratchpad/real-stack/start.mjs   (prints READY and stays up)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../scratchpad/real-stack'); fs.mkdirSync(OUT, { recursive: true });
const repo = path.resolve(here, '../..');
const PG_PORT = 55432, API_PORT = 8091, SITE_PORT = 5183;
const DB = 'xeno_real', PG_PW = 'real-stack-local-only', CONTAINER = 'real-stack-pg', REDIS = 'real-stack-redis', REDIS_PORT = 56379;
const IMAGE = 'pgvector/pgvector:0.8.6-pg15-bookworm';
const logs = path.join(OUT, 'logs'); fs.mkdirSync(logs, { recursive: true });

// A fresh database every start: no data from an earlier run, and nothing on the box survives stop.mjs.
const box = (cmd) => spawnSync('ssh', ['xeno-platform-001', cmd], { encoding: 'utf8' });
box(`sudo docker rm -f -v ${CONTAINER} ${REDIS} >/dev/null 2>&1`);
box(`sudo docker run -d --name ${REDIS} -p 127.0.0.1:${REDIS_PORT}:6379 redis:7-alpine`);
const made = box(`sudo docker run -d --name ${CONTAINER} -p 127.0.0.1:${PG_PORT}:5432 -e POSTGRES_PASSWORD=${PG_PW} -e POSTGRES_DB=${DB} --tmpfs /var/lib/postgresql/data ${IMAGE}`);
if (made.status !== 0) { console.log('NOT READY: could not start Postgres on the box:', made.stderr.trim()); process.exit(1); }
for (let i = 0; i < 60; i++) { if (box(`sudo docker exec ${CONTAINER} pg_isready -h 127.0.0.1 -U postgres`).status === 0) break; await new Promise((r) => setTimeout(r, 1000)); }
await new Promise((r) => setTimeout(r, 3000));

// Mail goes to a catcher on loopback (the service's own RESEND_API_BASE_URL seam), one JSON file per message in ./mail.
import http from 'node:http';
const MAIL_PORT = 8092, mailDir = path.join(OUT, 'mail');
fs.rmSync(mailDir, { recursive: true, force: true }); fs.mkdirSync(mailDir, { recursive: true });
let mailN = 0;
http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => { mailN += 1; fs.writeFileSync(path.join(mailDir, `${String(mailN).padStart(4, '0')}.json`), body);
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: `local-${mailN}` })); });
}).listen(MAIL_PORT, '127.0.0.1');

const env = {
  ...process.env,
  RESEND_API_KEY: 'local-mail-catcher', RESEND_API_BASE_URL: `http://127.0.0.1:${MAIL_PORT}`,
  NODE_ENV: 'development', BACKEND_PORT: String(API_PORT), BACKEND_HOST: '127.0.0.1',
  DB_HOST: '127.0.0.1', DB_PORT: String(PG_PORT), DB_NAME: DB, DB_USER: 'postgres', DB_PASSWORD: PG_PW,
  DATABASE_URL: `postgresql://postgres:${PG_PW}@127.0.0.1:${PG_PORT}/${DB}`,
  JWT_SECRET: 'real-stack-jwt-secret-local-only-0123456789',
  SECRET_BOX_KEY: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
  SUBJECT_HASH_SECRET: 'real-stack-subject-hash-local-only',
  REDIS_URL: `redis://127.0.0.1:${REDIS_PORT}`,
  REGISTRATION_OPEN: 'true', BYOK_ENABLED: 'true',
  // the same feature switches production runs with (2026-11-03), so routes behind them exist here too
  OIDC_ENABLED: 'true', LEDGER_V2_ENABLED: 'true', ARTIFACTS_ENABLED: 'true', XENO_CHAT_WEB_CONTEXT_ENABLED: 'true',
  SITE_URL: `http://localhost:${SITE_PORT}`, XENO_SITE_ORIGIN: `http://localhost:${SITE_PORT}`,
  PASSKEY_RP_ID: 'localhost', PASSKEY_ORIGINS: `http://localhost:${SITE_PORT}`,
};
const run = (name, cmd, args, extra = {}) => {
  const out = fs.openSync(path.join(logs, `${name}.log`), 'w');
  const p = spawn(cmd, args, { cwd: repo, env: { ...env, ...extra }, stdio: ['ignore', out, out] });
  p.on('exit', (code) => console.log(`${name} exited ${code}`));
  return p;
};
const tunnel = run('tunnel', 'ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `${PG_PORT}:127.0.0.1:${PG_PORT}`, '-L', `${REDIS_PORT}:127.0.0.1:${REDIS_PORT}`, 'xeno-platform-001']);
await new Promise((r) => setTimeout(r, 3000));
const api = run('api', process.execPath, ['src/server/index.js']);
const site = run('site', process.execPath, [path.join(repo, 'node_modules/vite/bin/vite.js'), '--port', String(SITE_PORT), '--strictPort', '--host', 'localhost'],
  { XENO_DEV_API_TARGET: `http://127.0.0.1:${API_PORT}` });
fs.writeFileSync(path.join(OUT, 'pids.json'), JSON.stringify({ launcher: process.pid, tunnel: tunnel.pid, api: api.pid, site: site.pid, container: `${CONTAINER} ${REDIS}` }));

const up = async (url, ms) => { const end = Date.now() + ms; while (Date.now() < end) { try { const r = await fetch(url); if (r.status < 500) return r.status; } catch {} await new Promise((r) => setTimeout(r, 1000)); } return 0; };
const apiStatus = await up(`http://127.0.0.1:${API_PORT}/api/ready`, 300000);
const siteStatus = await up(`http://localhost:${SITE_PORT}/`, 120000);
console.log(apiStatus === 200 && siteStatus ? `READY api=${apiStatus} site=${siteStatus} http://localhost:${SITE_PORT}` : `NOT READY api=${apiStatus} site=${siteStatus} (see ${logs})`);
