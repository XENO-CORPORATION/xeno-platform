#!/usr/bin/env node
// Local preview only. No account resets, production secrets or automatic deletion.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, open, access } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assertLocalDocker, schemaAndRows, assertRestored } from './lib/platform-qualification.mjs';
import { runRequiredStartupMigrations } from '../src/server/services/startupSchema.js';
import { matchesPreviewReadiness, hasOnlyLoopbackListeners } from '../src/server/services/runtimePolicy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(process.env.LOCALAPPDATA || process.env.HOME, 'XENO', 'local-preview');
const statePath = path.join(directory, 'state.json');
const image = 'pgvector/pgvector:0.8.6-pg17-bookworm@sha256:dca0d688bbb31d3f851502ffcb9c7791387b4fcc544ae434dab41761e5ece317';
const sourceName = 'xwc-gate-pg', database = 'xeno_ui_local_qual';
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|SYSTEMDRIVE|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|DOCKER_CONFIG)$/i.test(key)));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const startedChildren = [], startedContainers = [];
function docker(args, env = baseEnv) {
  try { return execFileSync('docker', args, { env, windowsHide: true, encoding: 'utf8', timeout: 120_000, maxBuffer: 8e6 }); }
  catch { throw new Error(`Docker ${args[0]} failed; no credentials or raw container configuration are logged`); }
}
function config(info) {
  return Object.fromEntries(info.Config.Env.map(value => { const split = value.indexOf('='); return [value.slice(0, split), value.slice(split + 1)]; }));
}
function inspect(id) { return JSON.parse(docker(['inspect', id]))[0]; }
function binding(info, port) {
  const ports = info.NetworkSettings.Ports[`${port}/tcp`];
  if (ports?.length !== 1 || ports[0].HostIp !== '127.0.0.1') throw new Error('Preview service must have exactly one loopback binding');
  return Number(ports[0].HostPort);
}
function owned(id, run, type) {
  const info = inspect(id);
  if (info.Id !== id || info.Config.Labels?.['xeno.local-preview'] !== run || info.Config.Labels?.['xeno.preview-service'] !== type) {
    throw new Error('Preview container ownership mismatch');
  }
  return info;
}
async function connect(connection) {
  const pool = new pg.Pool({ ...connection, max: 1, application_name: 'xeno-preview-recovery', connectionTimeoutMillis: 2000, statement_timeout: 120_000 });
  // Never let pg's idle-client error event dump a connection object/credentials.
  let connectionFailed = false;
  pool.on('error', () => { connectionFailed = true; console.error('[Preview] Database connection closed'); });
  const query = pool.query.bind(pool);
  pool.query = (...args) => {
    if (connectionFailed) return Promise.reject(new Error('Recovery connection lost; refusing to continue without its snapshot locks'));
    return query(...args);
  };
  for (let i = 0; i < 40; i++) {
    try { await pool.query('SELECT 1'); return pool; } catch { await pause(500); }
  }
  await pool.end(); throw new Error('Preview database did not become available');
}
async function security(pool) {
  // pg_dump omits explicit grants equal to the built-in owner defaults. Compare
  // effective ACL items (including grantor/grant option), not null vs default.
  const relations = (await pool.query(`SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,
    ARRAY(SELECT a::text COLLATE "C" FROM unnest(COALESCE(c.relacl,acldefault((CASE WHEN c.relkind='S' THEN 's' ELSE 'r' END)::"char",c.relowner))) a ORDER BY 1)::text AS acl
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname`)).rows;
  const defaults = (await pool.query(`SELECT pg_get_userbyid(defaclrole) AS owner,defaclnamespace::regnamespace::text AS namespace,
    defaclobjtype,defaclacl::text FROM pg_default_acl ORDER BY 1,2,3`)).rows;
  const functions = (await pool.query(`SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS args,
    pg_get_userbyid(p.proowner) AS owner,
    ARRAY(SELECT a::text COLLATE "C" FROM unnest(COALESCE(p.proacl,acldefault('f',p.proowner))) a ORDER BY 1)::text AS acl,p.prosecdef,p.proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1,2`)).rows;
  const namespace = (await pool.query(`SELECT nspname,pg_get_userbyid(nspowner) AS owner,
    ARRAY(SELECT a::text COLLATE "C" FROM unnest(COALESCE(nspacl,acldefault('n',nspowner))) a ORDER BY 1)::text AS acl
    FROM pg_namespace WHERE nspname='public'`)).rows;
  const sequences = [];
  for (const row of (await pool.query(`SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`)).rows) {
    sequences.push({ name: row.sequencename, ...(await pool.query(`SELECT last_value::text,is_called FROM public."${row.sequencename.replaceAll('"', '""')}"`)).rows[0] });
  }
  return { relations, defaults, functions, namespace, sequences };
}
async function quiescent(pool) {
  const { rows } = await pool.query(`SELECT count(*)::int AS connections FROM pg_stat_activity
    WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'`);
  if (rows[0].connections) throw new Error('Source database has other clients; refusing a non-quiescent copy');
}
function compareCopy(expected, actual, label) {
  try { assertRestored(expected, actual); } catch {
    const section = Object.keys(expected).find(key => JSON.stringify(expected[key]) !== JSON.stringify(actual[key]));
    const index = Array.isArray(expected[section]) ? expected[section].findIndex((row, i) => JSON.stringify(row) !== JSON.stringify(actual[section]?.[i])) : -1;
    const row = expected[section]?.[index];
    throw new Error(`${label} differs in ${section}, item ${index} (${row?.name || row?.table || row?.relname || 'definition'}); copy retained, not selected`);
  }
}
async function copyDump(source, target, dump) {
  await new Promise((resolve, reject) => {
    const reader = spawn('docker', ['exec', source, 'cat', dump], { env: baseEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const writer = spawn('docker', ['exec', '-i', target, 'sh', '-c', 'umask 077; cat > "$1"', 'copy', dump],
      { env: baseEnv, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { reader.kill(); writer.kill(); reject(new Error('Database copy timed out')); }, 120_000);
    const codes = [];
    const finish = code => { codes.push(code); if (codes.length === 2) { clearTimeout(timer); codes.every(c => c === 0) ? resolve() : reject(new Error('Database dump transfer failed')); } };
    reader.on('error', () => finish(1)); writer.on('error', () => finish(1));
    reader.on('close', finish); writer.on('close', finish);
    writer.stdin.on('error', () => {}); reader.stdout.pipe(writer.stdin);
  });
}
async function recover() {
  try { await access(statePath); throw new Error('A preview state already exists; use start, not recover'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const source = inspect(sourceName), credentials = config(source);
  if (source.Name !== `/${sourceName}` || !source.State.Running) throw new Error('Original local database identity is invalid');
  const run = randomBytes(16).toString('hex'), password = randomBytes(32).toString('hex');
  const state = { run, sourceId: source.Id, database, image, createdAt: new Date().toISOString() };
  let original, target;
  try {
    const sourcePort = source.NetworkSettings.Ports['5432/tcp']?.find(p => p.HostIp === '0.0.0.0' || p.HostIp === '127.0.0.1')?.HostPort;
    original = await connect({ host: '127.0.0.1', port: Number(sourcePort), database, user: credentials.POSTGRES_USER, password: credentials.POSTGRES_PASSWORD });
    const major = Number((await original.query('SHOW server_version_num')).rows[0].server_version_num) / 10000 | 0;
    if (major !== 17) throw new Error('Recovery pin requires source PostgreSQL 17; do not downgrade');
    await quiescent(original);
    await original.query('BEGIN');
    await original.query("SET LOCAL lock_timeout='2s'");
    const tables = (await original.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows;
    // Hold writes while pg_dump and both source fingerprints are collected.
    // Concurrent clients cause refusal; no account/table data is modified.
    if (tables.length) await original.query(`LOCK TABLE ${tables.map(row => `public."${row.tablename.replaceAll('"', '""')}"`).join(',')} IN SHARE MODE`);
    console.log('[Preview] Comparing original schema, data, privileges and sequence state');
    const before = await schemaAndRows(original), privileges = await security(original);
    state.pg = docker(['create', '--name', `xeno-preview-pg-${run}`, '--label', `xeno.local-preview=${run}`, '--label', 'xeno.preview-service=postgres',
      '--restart', 'unless-stopped', '-p', '127.0.0.1::5432', '-e', 'POSTGRES_USER', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB', image],
      { ...baseEnv, POSTGRES_USER: credentials.POSTGRES_USER, POSTGRES_PASSWORD: password, POSTGRES_DB: database }).trim();
    docker(['start', state.pg]);
    startedContainers.push({ id: state.pg, run, type: 'postgres' });
    const port = binding(owned(state.pg, run, 'postgres'), 5432);
    target = await connect({ host: '127.0.0.1', port, database, user: credentials.POSTGRES_USER, password });
    if ((Number((await target.query('SHOW server_version_num')).rows[0].server_version_num) / 10000 | 0) !== major) throw new Error('PostgreSQL major mismatch');
    const dump = `/tmp/xeno-preview-${run}.dump`;
    await quiescent(original);
    docker(['exec', source.Id, 'sh', '-c', 'umask 077; exec pg_dump -U "$1" -d "$2" -Fc -f "$3"', 'dump', credentials.POSTGRES_USER, database, dump]);
    state.dump = dump;
    await copyDump(source.Id, state.pg, dump);
    docker(['exec', state.pg, 'pg_restore', '-U', credentials.POSTGRES_USER, '-d', database, '--exit-on-error', dump]);
    await quiescent(original);
    compareCopy(before, await schemaAndRows(original), 'Source fingerprint');
    compareCopy(before, await schemaAndRows(target), 'Restored fingerprint');
    compareCopy(privileges, await security(original), 'Source security');
    compareCopy(privileges, await security(target), 'Restored security');
    await original.query('ROLLBACK');
    state.preservedTables = before.data.length;
    state.preservedRows = before.data.reduce((n, table) => n + Number(table.count), 0);
    console.log(`[Preview] Verified exact copy: ${state.preservedTables} tables, ${state.preservedRows} rows`);
    console.log('[Preview] Applying required schema and verifying replay');
    await runRequiredStartupMigrations(target);
    const replay = await runRequiredStartupMigrations(target);
    state.replay = replay;
    // Dedicated empty queue, using the already installed local Redis image ID.
    const redisImage = inspect('xwc-gate-redis').Image;
    state.redis = docker(['create', '--name', `xeno-preview-redis-${run}`, '--label', `xeno.local-preview=${run}`, '--label', 'xeno.preview-service=redis',
      '--restart', 'unless-stopped', '-p', '127.0.0.1::6379', redisImage]).trim();
    docker(['start', state.redis]);
    startedContainers.push({ id: state.redis, run, type: 'redis' });
    binding(owned(state.redis, run, 'redis'), 6379);
    await writeFile(statePath, JSON.stringify(state, null, 2), { flag: 'wx' });
    console.log('[Preview] Verified copy selected. Original database and both protected dumps retained.');
  } catch (error) {
    await original?.end(); original = null;
    await target?.end(); target = null;
    for (const type of ['pg', 'redis']) if (state[type]) {
      owned(state[type], run, type === 'pg' ? 'postgres' : 'redis'); docker(['stop', state[type]]);
    }
    await writeFile(path.join(directory, `failed-${run}.json`), JSON.stringify({ ...state, failed: true }, null, 2));
    // Assertion errors contain schema/data fingerprints; keep terminal output coarse.
    throw new Error(error.code === 'ERR_ASSERTION' ? 'Copy verification mismatch; retained stopped copy for inspection' : error.message);
  } finally { await original?.end(); await target?.end(); }
}
async function portAvailable(port, host) {
  return new Promise(resolve => { const server = net.createServer(); server.once('error', () => resolve(false)); server.listen(port, host, () => server.close(() => resolve(true))); });
}
function listeners(port) {
  if (process.platform !== 'win32' || ![8090, 5183].includes(port)) throw new Error('Preview process identity currently requires Windows');
  const code = `@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Group-Object OwningProcess | ForEach-Object { $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Name)"; [pscustomobject]@{ProcessId=[int]$_.Name; CommandLine=$taskProcess.CommandLine; ExecutablePath=$taskProcess.ExecutablePath; Addresses=@($_.Group.LocalAddress)} }) | ConvertTo-Json -Compress`;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', code], { env: baseEnv, windowsHide: true, encoding: 'utf8' }).trim();
  const result = output ? JSON.parse(output) : [];
  const processes = Array.isArray(result) ? result : [result];
  if (processes.some(process => !hasOnlyLoopbackListeners(process.Addresses))) throw new Error(`Port ${port} is exposed beyond loopback; refusing adoption`);
  return processes;
}
function verifyFrontend() {
  const processes = listeners(5183);
  if (processes.length !== 1) throw new Error('Frontend port has ambiguous ownership');
  const command = processes[0].CommandLine?.replaceAll('\\', '/').toLowerCase() || '';
  if (path.basename(processes[0].ExecutablePath || '').toLowerCase() !== 'node.exe' ||
      !command.includes(`${root.replaceAll('\\', '/').toLowerCase()}/node_modules/`) || !command.includes('vite/bin/vite.js')) {
    throw new Error('Port 5183 is not the frontend from this worktree');
  }
}
async function ready(url, instance) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(2000) }); const body = await response.json();
    return response.ok && matchesPreviewReadiness(body, instance);
  } catch { return false; }
}
async function launch(label, file, args, env, cwd) {
  const out = await open(path.join(directory, `${label}.stdout.log`), 'a');
  const err = await open(path.join(directory, `${label}.stderr.log`), 'a');
  const child = spawn(file, args, { env, cwd, detached: true, windowsHide: true, stdio: ['ignore', out.fd, err.fd] });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  startedChildren.push(child);
  child.unref(); await out.close(); await err.close();
  return child.pid;
}
async function start() {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  for (const [key, type] of [['pg', 'postgres'], ['redis', 'redis']]) {
    const info = owned(state[key], state.run, type);
    if (!info.State.Running) {
      docker(['start', state[key]]);
      startedContainers.push({ id: state[key], run: state.run, type });
    }
  }
  const postgres = owned(state.pg, state.run, 'postgres'), credentials = config(postgres);
  if (postgres.Config.Image !== image || state.database !== database) throw new Error('Preview target does not match the qualified configuration');
  const env = { ...baseEnv, NODE_ENV: 'development', XENO_LOCAL_PREVIEW: 'true', BACKEND_HOST: '127.0.0.1', BACKEND_PORT: '8090',
    DB_HOST: '127.0.0.1', DB_PORT: String(binding(postgres, 5432)), DB_NAME: database,
    DB_USER: credentials.POSTGRES_USER, DB_PASSWORD: credentials.POSTGRES_PASSWORD,
    REDIS_URL: `redis://127.0.0.1:${binding(owned(state.redis, state.run, 'redis'), 6379)}`,
    JWT_SECRET: randomBytes(48).toString('hex'), LEDGER_V2_ENABLED: 'true', OIDC_ENABLED: 'true',
    XENO_DEV_API_TARGET: 'http://127.0.0.1:8090' };
  env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@127.0.0.1:${env.DB_PORT}/${database}`;
  if (await portAvailable(8090, '127.0.0.1')) {
    state.instance = randomBytes(16).toString('hex');
    env.XENO_PREVIEW_INSTANCE = state.instance;
    state.apiPid = await launch('api', process.execPath, ['index.js'], env, path.join(root, 'src/server'));
    await writeFile(statePath, JSON.stringify(state, null, 2));
  } else if (!state.apiPid || !(await ready('http://127.0.0.1:8090/api/ready', state.instance))) {
    throw new Error('Port 8090 is occupied by an unverified service; refusing to replace it');
  }
  // A just-started API binds only after migrations; verify PID after readiness below.
  for (let i = 0; !(await ready('http://127.0.0.1:8090/api/ready', state.instance)); i++) {
    if (i >= 45) throw new Error(`API failed readiness; inspect ${directory}/api.stderr.log`);
    await pause(1000);
  }
  const liveApi = listeners(8090);
  if (liveApi.length !== 1 || liveApi[0].ProcessId !== state.apiPid ||
      path.basename(liveApi[0].ExecutablePath || '').toLowerCase() !== 'node.exe') throw new Error('API listener identity differs from the launched preview');
  if (await portAvailable(5183, 'localhost')) {
    state.frontendPid = await launch('frontend', process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', 'localhost', '--port', '5183', '--strictPort'],
      { ...baseEnv, XENO_DEV_API_TARGET: env.XENO_DEV_API_TARGET }, root);
    await writeFile(statePath, JSON.stringify(state, null, 2));
  }
  for (let i = 0; !(await ready('http://localhost:5183/api/ready', state.instance)); i++) {
    if (i >= 30) throw new Error('Frontend proxy did not become ready');
    await pause(1000);
  }
  verifyFrontend();
  console.log('Local preview ready: http://localhost:5183/login');
  console.log('Real local account data; background jobs and outbound notifications disabled. Paid services are not configured.');
}

try {
  const mode = process.argv[2] || 'start';
  if (!['start', 'recover'].includes(mode) || process.argv.length > 3) throw new Error('Usage: node scripts/local-preview.mjs [start|recover]');
  const context = docker(['context', 'show']).trim();
  assertLocalDocker(JSON.parse(docker(['context', 'inspect', context]))[0].Endpoints.docker.Host);
  await mkdir(directory, { recursive: true });
  if (mode === 'recover') await recover();
  await start();
} catch (error) {
  for (const child of startedChildren) if (child.exitCode === null && child.signalCode === null) child.kill();
  for (const resource of startedContainers) {
    try { if (owned(resource.id, resource.run, resource.type).State.Running) docker(['stop', resource.id]); }
    catch { console.error('[Preview] Could not stop an owned resource; retained for inspection'); }
  }
  console.error(`[Preview] ${error.message}`); process.exitCode = 1;
}
