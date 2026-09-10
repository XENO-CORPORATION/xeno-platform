#!/usr/bin/env node
/**
 * What is actually IN the entry chunk — per module, grouped by package.
 *
 * The diagnostic for `scripts/check-entry-budget.mjs`. The budget says the
 * first-paint payload grew; this says what grew it, measured from rollup's own
 * module accounting rather than inferred from which import looks expensive.
 *
 * It reads the REAL vite.config.ts and adds one reporting plugin, so it measures
 * the build that actually ships rather than a second configuration that could
 * drift from it. `write: false` — nothing is emitted and `dist/` is untouched,
 * so running this never disturbs a build someone else is inspecting.
 *
 * Reading it: `src (first-party)` is our own code, and a large number there is
 * usually honest. A node_modules package near the top is the finding — it means
 * something on a first-paint path imports it, and almost always for one small
 * value. That is how ~500 KB of documentation prose came to be downloaded by
 * every visitor so that a product page could evaluate one boolean.
 *
 *   node scripts/entry-chunk-inventory.mjs
 */
import { build } from 'vite';
import path from 'node:path';

const slash = (s) => s.split(String.fromCharCode(92)).join('/');

const rows = [];
await build({
  configFile: path.resolve('vite.config.ts'),
  logLevel: 'error',
  build: {
    write: false,
    rollupOptions: {
      plugins: [{
        name: 'entry-inventory',
        generateBundle(_options, bundle) {
          for (const [file, chunk] of Object.entries(bundle)) {
            if (chunk.type !== 'chunk') continue;
            const total = Object.values(chunk.modules).reduce((n, m) => n + m.renderedLength, 0);
            rows.push({ file, isEntry: chunk.isEntry, total, modules: chunk.modules });
          }
        },
      }],
    },
  },
});

rows.sort((a, b) => b.total - a.total);
const entry = rows.find((r) => r.isEntry) || rows[0];
const cwd = slash(process.cwd());
console.log(`ENTRY ${entry.file}  ${entry.total} bytes (rendered, pre-minify)`);
console.log(`chunks: ${rows.length}`);

const mods = Object.entries(entry.modules)
  .map(([id, m]) => [slash(id).replace(cwd, '.'), m.renderedLength])
  .sort((a, b) => b[1] - a[1]);

console.log('\n--- top 35 modules in the entry chunk ---');
for (const [id, len] of mods.slice(0, 35)) console.log(String(len).padStart(9), id);

const groups = new Map();
for (const [id, len] of mods) {
  const m = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  const key = m ? `node_modules/${m[1]}` : 'src (first-party)';
  groups.set(key, (groups.get(key) || 0) + len);
}
console.log('\n--- grouped by package ---');
for (const [k, v] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(String(v).padStart(9), k);
}
