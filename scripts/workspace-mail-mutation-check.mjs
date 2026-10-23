#!/usr/bin/env node
/**
 * Mutation check for Office › Mail (services/xenoMail.js): remove each protection and prove
 * src/server/tests/workspace-mail.test.mjs FAILS, then restore the file byte for byte.
 *
 *   node scripts/workspace-mail-mutation-check.mjs <database URL> [more URLs…]
 *
 * The suite tags its rows per run, so one disposable database can serve every mutation (pass more to spread them).
 * Exits 1 if any mutation survives.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVC = join(ROOT, 'src/server/services/xenoMail.js');
const MCP = join(ROOT, 'src/server/services/mailMcp.js');
const TEST = join(ROOT, 'src/server/tests/workspace-mail.test.mjs');
const MUTATIONS = [
  ['an agent’s send goes to mail-core (draft interception removed)', SVC, `    if (ctx.agentId) return { sent: false, draft: await save(), proposal: true,`, `    if (false) return { sent: false, draft: await save(), proposal: true,`],
  ['a person sends without confirm', SVC, `if (confirm !== true) throw new MailError('Sending cannot be undone. Confirm to send.', 'confirm_required', 428);`, ``],
  ['the assertion forgets the mapped address', SVC, `    ...(address ? { mail_address: String(address) } : {}),\n`, ``],
  ['a mailbox mapping is stored without asking mail-core', SVC, `  try { await callMail(db, { ...ctx, address: a }, 'mail.app.status', {}, { fetchImpl }); }\n  catch (e) {`, `  try { }\n  catch (e) {`],
  ['an agent may re-point the mailbox', SVC, `  personOnly(ctx, 'choose which mailbox a workspace uses');\n  const a = String(address`, `  const a = String(address`],
  ['an agent may discard a draft', SVC, `  personOnly(ctx, 'discard a draft');\n`, ``],
  ['agent drafts are not recorded', SVC, `  if (!ctx.agentId || !draftId) return;`, `  return;`],
  ['a non-member reads a workspace’s mail', SVC, `    if (!member) throw new MailError('You are not a member of that workspace', 'not_a_member', 403);`, `    if (!member && false) throw new MailError('You are not a member of that workspace', 'not_a_member', 403);`],
  ['MCP gains a send tool', MCP, `  { name: 'thread_to_task',`, `  { name: 'send_mail', title: 'Send', annotations: RW, description: 'x', inputSchema: { type: 'object', properties: {} } },\n  { name: 'thread_to_task',`],
];
const urls = process.argv.slice(2);
if (!urls.length) { console.error('need at least one database URL'); process.exit(2); }
let survived = 0;
MUTATIONS.forEach(([name, file, from, to], i) => {
  const orig = readFileSync(file, 'utf8');
  const text = orig.replace(/\r\n/g, '\n');
  if (!text.includes(from)) { console.error(`mutation "${name}": anchor not found`); survived += 1; return; }
  try {
    writeFileSync(file, text.replace(from, to));
    const r = spawnSync(process.execPath, [TEST], { env: { ...process.env, DATABASE_URL: urls[i % urls.length] }, encoding: 'utf8' });
    const failed = r.status !== 0;
    console.log(`${failed ? 'killed  ' : 'SURVIVED'}  ${name}`);
    if (!failed) survived += 1;
  } finally { writeFileSync(file, orig); }
});
console.log(survived ? `${survived} mutation(s) survived` : 'every mutation was caught');
process.exit(survived ? 1 : 0);
