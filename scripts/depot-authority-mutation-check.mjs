// Mutation check for the Depot authority suite: each protection is removed in turn and the suite must FAIL.
// Usage (from the repo root): PG_ADMIN=postgresql://postgres:<pw>@127.0.0.1:<port> npm run test:depot-authority-mutation
// PG_ADMIN must be a DISPOSABLE server: this script drops and creates its own databases (mut_control, mut_x) on it.
// Each source edit is put back in `finally`, so an interrupted run leaves the tree as it was.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const admin = process.env.PG_ADMIN;
if (!admin || !/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(admin)) {
  console.error('refusing: PG_ADMIN must point at a local disposable Postgres server');
  process.exit(2);
}
const MUTANTS = [
  ['scope ceiling ignored', 'src/server/services/depotAuthority.js',
    "return new Set([...scopes].flatMap((s) => SCOPE_CEILING[s] || []));", 'return new Set(PERMISSIONS);'],
  ['door admits non-staff', 'src/server/services/depotAuthority.js',
    'staff: isStaffPrincipal(p) });', 'staff: true });'],
  ['unreadable repo confirmed', 'src/server/services/depotAuthority.js',
    "if (!perms.has('read')) throw new DepotAuthorityError('repo_not_found', 404);", ''],
  ['last admin removable', 'src/server/services/depotAuthority.js',
    "if (holds && admins <= 1) throw", "if (false) throw"],
  ['mixed scopes register', 'src/server/utils/oidcProvider.js',
    "if (depot.length && depot.length !== scopes.length) throw", "if (false) throw"],
  ['seed drops the audience', 'src/server/database/migrate-oidc-clients.js',
    "c.audience || 'xeno-api'],", "'xeno-api'],"],
  ['stale principal at the door', 'src/server/services/depotAuthority.js',
    'const p = actor.principal ? await resolvePrincipal(db, actor.principal.id) : null;', 'const p = actor.principal;'],
  ['xdp_ secret not compared', 'src/server/services/depotAuthority.js',
    'if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;', ''],
  ['xdp_ revocation ignored', 'src/server/services/depotAuthority.js',
    'if (!row || row.revoked_at || new Date(row.expires_at) <= new Date()) return null;', 'if (!row) return null;'],
  ['an agent issues credentials', 'src/server/services/depotAuthority.js',
    "if (!me || me.kind !== 'human') throw new DepotAuthorityError('not_allowed', 403, 'only a person issues an agent credential');", ''],
  ['xdp_ scopes ignored', 'src/server/services/depotAuthority.js',
    'scopes: row.scopes.filter((s) => DEPOT_SCOPES.includes(s)), expiresAt: new Date(row.expires_at).getTime(), credentialId: String(row.id) };',
    'scopes: [...DEPOT_SCOPES], expiresAt: new Date(row.expires_at).getTime(), credentialId: String(row.id) };'],
  ['exchange: obliterate granted', 'src/server/services/depotAuthority.js',
    "admin: ['write', 'push-protected', 'owner', 'admin', 'migrate', 'presign'],", "admin: ['write', 'push-protected', 'owner', 'admin', 'migrate', 'presign', 'obliterate'],"],
  ['exchange: repo token re-exchanged', 'src/server/services/depotAuthority.js',
    "if (payload.depot_resources !== undefined) throw exchangeError('invalid_grant', 'a token for one repo cannot be exchanged again');", ''],
  ['exchange: door not checked', 'src/server/services/depotAuthority.js',
    "if (!door.allowed) throw exchangeError('access_denied',", "if (false) throw exchangeError('access_denied',"],
  ['exchange: revoked credential session accepted', 'src/server/services/depotAuthority.js',
    'WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`, [String(payload.xdp_cred)])', 'WHERE id = $1`, [String(payload.xdp_cred)])'],
  ['exchange: any resource host', 'src/server/services/depotAuthority.js',
    "const m = new RegExp(`^${origin.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}/repos/([^/?#]+)$`).exec(String(resource));",
    "const m = /\\/repos\\/([^/?#]+)$/.exec(String(resource));"],
  ['login token: first mint lacks Lore claims', 'src/server/utils/oidcProvider.js',
    '      ...depotLoginClaims(aud, user.id),', ''],
  ['login token: refresh drops Lore claims', 'src/server/utils/oidcProvider.js',
    'typ: ACCESS_TOKEN_TYP, ...depotLoginClaims(aud, user.id), ...(session.dpop_jkt', 'typ: ACCESS_TOKEN_TYP, ...(session.dpop_jkt'],
  ['run token: broader scope accepted', 'src/server/services/depotAuthority.js',
    "if (asked.some((s) => s !== 'depot:read')) throw exchangeError('invalid_scope',", "if (false) throw exchangeError('invalid_scope',"],
  ['run token: real permissions leak in', 'src/server/services/depotAuthority.js',
    'permission: run ? [] : loreActions(perms) }];', 'permission: loreActions(perms) }];'],
  ['run token: no 2-hour cap', 'src/server/services/depotAuthority.js',
    '? Math.min(RUN_TOKEN_MAX_SECONDS, runDeadline - now, subjectExp - now)', '? Math.min(runDeadline - now, subjectExp - now)'],
  ['run token: a person mints one', 'src/server/services/depotAuthority.js',
    "if (subjectTokenType !== LORE_API_KEY_TOKEN_TYPE) throw exchangeError('invalid_request', 'a run token", "if (false) throw exchangeError('invalid_request', 'a run token"],
  ['exchange: lifetime not capped', 'src/server/services/depotAuthority.js',
    ': Math.min(DEPOT_TOKEN_SECONDS, subjectExp - now);', ': 3600;'],
];

async function freshDb(name) {
  const c = new pg.Client({ connectionString: `${admin}/postgres` });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${name}`); await c.query(`CREATE DATABASE ${name}`);
  await c.end();
  return `${admin}/${name}`;
}
function runSuite(url) {
  const r = spawnSync(process.execPath, ['tests/depot-authority.test.mjs'], { cwd: 'src/server', env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 120000 });
  return r.status === 0 && /depot-authority: ok/.test(r.stdout);
}

let caught = 0;
const control = runSuite(await freshDb('mut_control'));
console.log(`control (no mutation): ${control ? 'PASS' : 'FAIL'}`);
if (!control) process.exit(2);
// MUT_ONLY=<part of a label> runs just the matching mutants (the full run is still the record).
const only = process.env.MUT_ONLY || '';
for (const [label, file, from, to] of MUTANTS.filter(([l]) => !only || l.includes(only))) {
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes(from)) { console.log(`MISSING  ${label}: anchor not found`); process.exitCode = 1; continue; }
  fs.writeFileSync(file, original.replace(from, to));
  try {
    const passed = runSuite(await freshDb('mut_x'));
    console.log(`${passed ? 'SURVIVED' : 'caught  '} ${label}`);
    if (!passed) caught += 1; else process.exitCode = 1;
  } finally { fs.writeFileSync(file, original); }
}
const ran = MUTANTS.filter(([l]) => !only || l.includes(only)).length;
console.log(`${caught}/${ran} mutations caught${only ? ` (only "${only}"; ${MUTANTS.length} in all)` : ''}`);
