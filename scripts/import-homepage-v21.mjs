#!/usr/bin/env node
// Import the XENOsystem Home v21 design handoff (a .dc.html prototype plus its
// dc-runtime) as the static homepage served at `/`.
//
// Why static, not a React transcription: the handoff is a runnable reference
// with ~1,100 lines of DOM/canvas logic. Forking it verbatim keeps the design
// 1:1; the only changes are local vendoring (no CDN), absolute asset paths,
// and the document title/meta the prototype head omits.
//
// Usage: node scripts/import-homepage-v21.mjs <extracted-zip-dir>
// Expects in that dir: "XENOsystem Home v21.dc.html", support.js, site/*.png,
// and this repo's node_modules with react, react-dom, @babel/standalone.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = process.argv[2];
if (!srcDir) { console.error('usage: import-homepage-v21.mjs <extracted-zip-dir>'); process.exit(1); }

const dcPath = join(srcDir, 'XENOsystem Home v21.dc.html');
const supportPath = join(srcDir, 'support.js');
for (const p of [dcPath, supportPath, join(srcDir, 'site')]) {
  if (!existsSync(p)) { console.error(`missing ${p}`); process.exit(1); }
}

const outDir = join(root, 'public', 'home-v21');
mkdirSync(join(outDir, 'vendor'), { recursive: true });

// --- the page ---
let html = readFileSync(dcPath, 'utf8');
html = html
  .replace('<script src="./support.js"></script>', '<script src="/home-v21/support.js"></script>')
  .replaceAll('site/', '/home-v21/site/')
  .replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>XENOsystem — Where humans imagine, AI builds</title>\n'
    + '<meta name="description" content="One workspace where people and AI agents imagine, design, code and produce as one.">\n'
    + '<link rel="icon" type="image/svg+xml" href="/favicon-v2.svg">',
  );
// Entry fixes (owner, 2026-10-22). Two defects in the raw prototype:
//  1. The hero panels grid paints its own scrollbar. It keeps scrolling,
//     the bar is hidden - [data-panels] is stamped on that one grid below.
//  2. The page painted the whole interface, then the intro hid it and
//     played. The real <head> therefore carries the pre-intro state: hero
//     elements and below-fold reveals start hidden by CSS (not by a timer
//     after first paint), and heroIn() removes the class the moment the
//     entrance takes over. If the runtime never runs, the failsafe
//     animation still uncovers the page instead of leaving it blank.
const ENTRY_CSS = '<style id="xeno-home-entry">'
  + 'html{background:#060606}'
  + '.intro-pending [data-intro],.intro-pending header,.intro-pending [data-reveal]{opacity:0;animation:xenoEntryFailsafe .4s ease 3.4s forwards}'
  + '@keyframes xenoEntryFailsafe{to{opacity:1}}'
  + '[data-panels]{scrollbar-width:none}'
  + '[data-panels]::-webkit-scrollbar{display:none}'
  + '@media (prefers-reduced-motion: reduce){.intro-pending [data-intro],.intro-pending header,.intro-pending [data-reveal]{opacity:1;animation:none}}'
  + '</style>';
html = html
  .replace('<html>', '<html class="intro-pending">')
  .replace('</head>', ENTRY_CSS + '\n</head>')
  .replace('<div style="flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));grid-auto-rows:minmax(276px,1fr);',
    '<div data-panels="1" style="flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));grid-auto-rows:minmax(276px,1fr);');
const heroIn0 = '  heroIn(delay, reduced) {\n    const els =';
if (!html.includes(heroIn0)) { console.error('heroIn anchor not found in the design'); process.exit(1); }
html = html.replace(heroIn0,
  '  heroIn(delay, reduced) {\n    document.documentElement.classList.remove(\'intro-pending\');\n    const els =');
if (!html.includes('/home-v21/support.js') || html.includes('url(site/') || html.includes('(site/') || !html.includes('data-panels="1"') || !html.includes('xeno-home-entry')) {
  console.error('asset rewrite incomplete'); process.exit(1);
}
writeFileSync(join(outDir, 'index.html'), html);

// --- the dc runtime: same file, CDN URLs swapped for vendored copies ---
let runtime = readFileSync(supportPath, 'utf8');
const swaps = [
  ['https://unpkg.com/react@18.3.1/umd/react.production.min.js', '/home-v21/vendor/react.production.min.js'],
  ['https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js', '/home-v21/vendor/react-dom.production.min.js'],
  ['https://unpkg.com/@babel/standalone@7.29.0/babel.min.js', '/home-v21/vendor/babel.min.js'],
];
for (const [from, to] of swaps) {
  if (!runtime.includes(from)) { console.error(`runtime URL not found: ${from}`); process.exit(1); }
  runtime = runtime.replace(from, to);
}
// Vendored files differ from the CDN builds, so their SRI hashes must not apply.
runtime = runtime.replace(/var (REACT_SRI|REACT_DOM_SRI|BABEL_SRI) = "[^"]*";/g, 'var $1 = "";');
writeFileSync(join(outDir, 'support.js'), runtime);

cpSync(join(srcDir, 'site'), join(outDir, 'site'), { recursive: true });
cpSync(join(root, 'node_modules/react/umd/react.production.min.js'), join(outDir, 'vendor/react.production.min.js'));
cpSync(join(root, 'node_modules/react-dom/umd/react-dom.production.min.js'), join(outDir, 'vendor/react-dom.production.min.js'));
cpSync(join(root, 'node_modules/@babel/standalone/babel.min.js'), join(outDir, 'vendor/babel.min.js'));
console.log(`homepage v21 imported -> ${outDir}`);
