#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const catalog = read('src/lib/productCatalog.ts');
const product = read('src/content/products/acp.ts');
const docs = read('src/content/docs/acp.ts');
const releaseNotes = read('docs/XENO_ACP_RELEASE_0.1.0.md');
const prerenderedProduct = read('dist/product/acp/index.html');
const prerenderedInstall = read('dist/docs/acp/installation/index.html');

const failures = [];
const requireText = (label, haystack, needle) => {
  if (!haystack.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (label, haystack, needle) => {
  if (haystack.toLowerCase().includes(needle.toLowerCase())) {
    failures.push(`${label}: forbidden stale text ${JSON.stringify(needle)}`);
  }
};

requireText('catalog', catalog, "slug: 'acp'");
requireText('catalog', catalog, "status: 'beta'");
requireText('catalog', catalog, "delivery: 'cli'");
// ACP migrated to the @xenosystem scope (npm `latest` is @xenosystem/acp@0.1.1;
// @xeno-corporation/xeno-acp is frozen at 0.1.0). This gate asserted the OLD
// name long after the catalog moved, so it failed on the corrected content —
// and its product-page check passed only because a comment explaining the
// rename happened to contain the legacy string. Assert the shipping identity.
requireText('catalog', catalog, "install: 'npm install -g @xenosystem/acp'");
requireText('catalog', catalog, "operatingSystem: 'Windows, Linux'");

for (const [label, source] of [['product', product], ['docs', docs], ['release notes', releaseNotes]]) {
  requireText(label, source, '@xenosystem/acp');
  requireText(label, source, 'Windows');
  requireText(label, source, 'Linux');
  requireText(label, source, 'macOS');
  requireText(label, source, 'XENO Hub');
  forbidText(label, source, '0.1.0-alpha');
  forbidText(label, source, 'private alpha');
  forbidText(label, source, '@xeno-acp/');
}

requireText('prerendered product', prerenderedProduct, 'XENO ACP 0.1.0');
requireText('prerendered product', prerenderedProduct, '"operatingSystem":"Windows, Linux"');
forbidText('prerendered product', prerenderedProduct, 'Windows, macOS, Linux');
requireText('prerendered installation docs', prerenderedInstall, 'Install the public npm packages');

if (failures.length > 0) {
  console.error('XENO ACP launch-content verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('XENO ACP launch-content verification passed.');
console.log('- catalog: beta / cli / npm / Windows+Linux');
console.log('- landing, docs, and release notes: public 0.1.0 package scope');
console.log('- prerender: route metadata and platform schema');
