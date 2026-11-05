#!/usr/bin/env node
/**
 * Bring a build of XENO Agent remote control (xeno-agent-interface apps/remote-web) into this repo, so the frontend image
 * serves it at remote.xenosystem.ai. Replaces public/remote-web/ and nothing else.
 *
 *   node scripts/import-remote-web.mjs <path to that app's dist>
 */
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = process.argv[2] && resolve(process.argv[2]);
if (!from || !existsSync(join(from, 'index.html'))) {
  console.error('usage: node scripts/import-remote-web.mjs <path to apps/remote-web/dist>');
  process.exit(1);
}

// a test build points at a local issuer and would strand every phone, so it is refused here
const scripts = readFileSync(join(from, 'index.html'), 'utf8').match(/assets\/index-[^"]+\.js/g) ?? [];
const bundle = scripts.map((file) => readFileSync(join(from, file), 'utf8')).join('');
if (!bundle.includes('https://xenostudio.ai') || /127\.0\.0\.1:\d+\/api/.test(bundle)) {
  console.error('That build does not sign in at the production issuer. Build it without VITE_XENO_ISSUER.');
  process.exit(1);
}

const to = join(root, 'public', 'remote-web');
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`imported ${from} -> public/remote-web`);
