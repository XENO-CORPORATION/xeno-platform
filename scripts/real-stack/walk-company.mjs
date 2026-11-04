// Walk 7: XENO Company's dashboard contract, against this real stack.
// A new person signs up in the browser, then xeno-company's OWN contract suite, the one its fake client answers to, runs with
// the real backend as its third arm through the real HttpCompanyClient. The suite is the judge, not a test written here.
// Needs a xeno-company checkout beside this repo with its dependencies installed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
import { browser, page, ok, failures, newPerson, sql, SITE, here } from './lib.mjs';
const company = process.env.XENO_COMPANY_DIR ? path.resolve(process.env.XENO_COMPANY_DIR) : path.resolve(here, '../../../xeno-company');
const b = await browser(); const p = await page(b);
try {
  const suite = path.join(company, 'packages/client/src/__tests__/contract.test.ts');
  ok(fs.existsSync(suite) && fs.readFileSync(suite, 'utf8').includes('XENO_COMPANY_REAL_URL'), 'a current xeno-company checkout is beside this repo', company);
  const who = await newPerson(p, 'Cora');
  // Inviting needs a spare seat, and a free plan has one. On this throwaway database only, the person has a Studio plan.
  sql(`INSERT INTO xeno_account_plans(user_id, plan, status) VALUES('${who.id}', 'studio', 'active') ON CONFLICT (user_id) DO UPDATE SET plan = 'studio', status = 'active'`);
  const login = await fetch(`${SITE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: who.email, password: who.password }) });
  const token = (await login.json()).token;
  ok(!!token, 'the person can sign in for an API token', login.status);
  const r = spawnSync(process.execPath, [path.join(company, 'node_modules/vitest/vitest.mjs'), 'run', 'packages/client/src/__tests__/contract.test.ts', '-t', 'the real platform', '--reporter=dot'],
    { cwd: company, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, XENO_COMPANY_REAL_URL: SITE, XENO_COMPANY_REAL_TOKEN: token, XENO_COMPANY_REAL_USER: who.id } });
  const out = String(r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  fs.writeFileSync(path.resolve(here, '../../scratchpad/real-stack/logs/company-contract.log'), out);
  const summary = (out.match(/Tests\s+.*/) || ['no summary'])[0];
  console.log(summary);
  ok(r.status === 0 && /passed/.test(summary), 'xeno-company’s contract suite passes against the real backend', out.slice(-1500));
} catch (e) { ok(false, 'walk crashed', e.stack); }
finally { await b.close(); process.exitCode = failures() ? 1 : 0; }
