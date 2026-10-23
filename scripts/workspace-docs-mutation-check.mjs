#!/usr/bin/env node
/**
 * Mutation check for Office › Write / Notes on the server: remove each protection and prove the real-Postgres suite
 * (src/server/tests/workspace-docs.test.mjs) fails. A gate that stays green with its protection removed is not
 * evidence. Every file is restored, whatever happens.
 *
 *   DATABASE_URL=postgresql://… node scripts/workspace-docs-mutation-check.mjs
 *
 * The editor-side protections (the schema, the paste guard, the link rule) are mutation-checked where they live:
 * xeno-blocks `packages/blocks/scripts/docs-mutation-check.mjs`.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
const SVC = 'src/server/services/workspaceDocs.js';
const MUTATIONS = [
  ['every write is validated against the format', SVC, 'if (problems.length) throw Object.assign(new DocsError(', 'if (false) throw Object.assign(new DocsError('],
  ['every read is validated on the way out', SVC, 'const f = X.parseXdoc(text); return', 'const f = JSON.parse(text); return'],
  ['a save on top of a newer version is refused', SVC, "if (expectedVersion && String(expectedVersion) !== String(f.id)) throw", 'if (false) throw'],
  ['a pre-format (Markdown) document still reads', SVC, 'if (docMeta && docMeta.format === X.XDOC_FORMAT) {', 'if (true) {'],
  ['backlinks follow the page-link mark', SVC, 'const targets = linksIn(content)', 'const targets = [].concat()'],
];

let missed = 0;
for (const [name, file, from, to] of MUTATIONS) {
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes(from)) { console.log(`STALE    ${name} (the code it mutates moved)`); missed += 1; continue; }
  fs.writeFileSync(file, original.replace(from, to));
  let caught = false;
  try { execSync('node tests/workspace-docs.test.mjs', { cwd: 'src/server', stdio: 'pipe', env: process.env }); } catch { caught = true; } finally { fs.writeFileSync(file, original); }
  console.log(`${caught ? 'CAUGHT ' : 'MISSED '}  ${name}`);
  if (!caught) missed += 1;
}
process.exit(missed ? 1 : 0);
