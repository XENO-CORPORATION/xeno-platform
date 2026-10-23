#!/usr/bin/env node
/**
 * Build the workspace's Write / Notes editor and the server's `.xdoc` validator FROM XENO Docs' own
 * editor — `@xenosystem/blocks/docs` (xeno-blocks) — so the platform mounts the product's editor and
 * format instead of carrying a third one.
 *
 *   prototypes/xeno-workspace/docs-editor.js   IIFE, global `XenoDocs`: the controller, the surface
 *                                              (TipTap over the shared schema), the format.
 *   src/server/vendor/xdoc-format.mjs          ESM, the FORMAT layer only (parse / validate / plain
 *                                              text / page links / Markdown), no editor, no DOM.
 *
 * Both are GENERATED and committed, the same way `report-client.js` is, and each names the package
 * version and the xeno-blocks commit it was cut from. `scripts/workspace-docs-bundle.test.mjs` fails
 * if they disagree with each other, were edited by hand, or pulled in what they must not.
 *
 * Source, in order:
 *   --from <xeno-blocks/packages/blocks>   build from a checkout (the family's source, committed)
 *   node_modules/@xenosystem/blocks         the published package, once its /docs family is on npm
 *
 *   node scripts/build-workspace-docs.mjs --from ../xeno-blocks/packages/blocks
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const fromAt = args.indexOf('--from');
const fromSource = fromAt >= 0;
const pkgDir = path.resolve(fromSource ? (args[fromAt + 1] || '') : 'node_modules/@xenosystem/blocks');
const entryDir = path.join(pkgDir, fromSource ? 'src/docs' : 'dist/docs');
if (!existsSync(path.join(entryDir, fromSource ? 'index.ts' : 'index.js'))) {
  throw new Error(fromSource ? `${entryDir}/index.ts not found — pass xeno-blocks/packages/blocks` : '@xenosystem/blocks with the /docs family is not installed — pass --from <xeno-blocks/packages/blocks>');
}
const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
if (pkg.name !== '@xenosystem/blocks') throw new Error(`${pkgDir} is ${pkg.name}, not @xenosystem/blocks`);
let commit = 'npm';
if (fromSource) {
  commit = execFileSync('git', ['-C', pkgDir, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', pkgDir, 'status', '--porcelain', '--', 'src/docs'], { encoding: 'utf8' }).trim();
  if (dirty) throw new Error('the docs family has uncommitted changes — commit them so the bundle names a real source');
}
const stamp = `@xenosystem/blocks@${pkg.version}/docs (xeno-blocks ${commit})`;
const banner = (what) => `// GENERATED from ${stamp} by scripts/build-workspace-docs.mjs — ${what}. Do not edit; rebuild.`;

const FORMAT = ['XDOC_FORMAT', 'XDOC_VERSION', 'XDOC_EXTENSION', 'DOCUMENT_NODE_TYPES', 'DOCUMENT_MARK_TYPES', 'SAFE_LINK', 'SAFE_IMAGE', 'LIMITS',
  'validateContent', 'parseXdoc', 'serializeXdoc', 'plainText', 'wordCount', 'pageLinksIn', 'nodeTypesIn', 'emptyContent', 'XdocError'];
const MARKDOWN = ['markdownToDocument', 'documentToMarkdown'];
const EDITOR = [...FORMAT, ...MARKDOWN, 'DocumentController', 'DOCUMENT_FORMAT_COMMANDS', 'DOCUMENT_TOOLBAR', 'mountDocumentSurface'];
const STAMP = `export const BUILT_FROM = ${JSON.stringify(stamp)};\n`;

const ix = fromSource ? './index.ts' : './index.js';
await build({
  stdin: { contents: `export { ${EDITOR.join(', ')} } from '${ix}';\n${STAMP}`, resolveDir: entryDir, loader: 'ts', sourcefile: 'workspace-docs-entry.ts' },
  outfile: 'prototypes/xeno-workspace/docs-editor.js', bundle: true, format: 'iife', globalName: 'XenoDocs', platform: 'browser', target: 'es2022', minify: true, legalComments: 'eof',
  banner: { js: banner('the workspace Write / Notes editor (window.XenoDocs)') },
});

mkdirSync('src/server/vendor', { recursive: true });
const serverEntry = fromSource
  ? `export { ${FORMAT.join(', ')} } from './document/format.ts';\nexport { ${MARKDOWN.join(', ')} } from './document/markdown.ts';\n${STAMP}`
  : `export { ${[...FORMAT, ...MARKDOWN].join(', ')} } from './index.js';\n${STAMP}`;
await build({
  stdin: { contents: serverEntry, resolveDir: entryDir, loader: 'ts', sourcefile: 'xdoc-format-entry.ts' },
  outfile: 'src/server/vendor/xdoc-format.mjs', bundle: true, format: 'esm', platform: 'node', target: 'node20',
  // the published index re-exports the editor too; tree-shaking must leave none of it (checked below)
  external: ['react', 'react-dom', '@tiptap/*', '@xenosystem/*'],
  banner: { js: banner('the .xdoc format for the server (no editor, no DOM)') },
});

const editor = readFileSync('prototypes/xeno-workspace/docs-editor.js', 'utf8');
const server = readFileSync('src/server/vendor/xdoc-format.mjs', 'utf8');
if (/react-dom|__SECRET_INTERNALS|useSyncExternalStore/.test(editor)) throw new Error('the workspace bundle pulled in React — it mounts the framework-free surface only');
if (/^\s*import\b/m.test(server) || /prosemirror|@tiptap/.test(server)) throw new Error('the server format bundle pulled in the editor');
console.log(`built from ${stamp}: docs-editor.js ${(editor.length / 1024).toFixed(0)} KB, xdoc-format.mjs ${(server.length / 1024).toFixed(0)} KB`);
