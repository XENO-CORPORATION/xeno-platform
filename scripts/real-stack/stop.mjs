// Ends the real stack: the site, the backend, the tunnel, and the throwaway Postgres container on the box with its data.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../scratchpad/real-stack'); fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'pids.json');
const pids = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
for (const k of ['site', 'api', 'tunnel', 'launcher']) if (pids[k]) spawnSync('taskkill', ['/PID', String(pids[k]), '/T', '/F']);
const r = spawnSync('ssh', ['xeno-platform-001', `sudo docker rm -f -v ${pids.container || 'real-stack-pg real-stack-redis'}`], { encoding: 'utf8' });
console.log('container removed:', r.status === 0);
fs.rmSync(file, { force: true });
