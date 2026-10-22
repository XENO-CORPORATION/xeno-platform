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
import { marketingAssets, marketingHeader } from './lib/marketing-header.mjs';

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
// Change the declarations themselves: React normalizes style-attribute spacing,
// so selectors matching the prototype's exact style text are not reliable.
html = html.replaceAll('--r-sm:7px', '--r-sm:6px').replaceAll('--r-lg:10px', '--r-lg:8px')
  .replaceAll("'--r-sm': '7px'", "'--r-sm': '6px'")
  .replaceAll("'--r-lg': '10px'", "'--r-lg': '8px'")
  .replaceAll('10px 3px 10px 10px', '8px 3px 8px 8px')
  .replaceAll('3px 10px 10px 10px', '3px 8px 8px 8px')
  .replace(/border-radius:\s*50%/g, 'border-radius:3px')
  .replace(/border-radius:\s*999px/g, 'border-radius:6px')
  .replace(/border-radius:\s*(?:10|12|16|20)px/g, 'border-radius:8px')
  .replaceAll('max-width:1360px;margin:0 auto;padding-left:clamp(16px,3vw,40px);padding-right:clamp(16px,3vw,40px)',
    'max-width:none;margin:0 auto;padding-left:clamp(16px,2vw,28px);padding-right:clamp(16px,2vw,28px)');

// The system alternates with inset neighbouring sections.
html = html.replace('padding-left:clamp(16px,2vw,28px);padding-right:clamp(16px,2vw,28px);box-sizing:border-box;flex:1;display:grid','padding-left:0;padding-right:0;box-sizing:border-box;flex:1;display:grid');

function replaceRequired(from, to) {
  if (!html.includes(from)) throw new Error(`homepage integration anchor missing: ${from.slice(0, 90)}`);
  html = html.replace(from, to);
}
replaceRequired('</head>', '<link rel="stylesheet" href="/home-v21/homepage.css">\n<script src="/home-v21/homepage.js" defer></script>\n</head>');
const originalHeader = html.match(/<header\b[\s\S]*?<\/header>/)?.[0];
if (!originalHeader) throw new Error('Homepage header missing');
const brand = originalHeader.match(/<a\b[\s\S]*?<\/a>/)?.[0];
const theme = originalHeader.match(/<div role="radiogroup" aria-label="Theme"[\s\S]*?<\/div>/)?.[0];
replaceRequired(originalHeader, marketingHeader({ source: html, home: true, brand, theme }));
replaceRequired('</head>', marketingAssets() + '\n</head>');
replaceRequired('({ label, subtitle, onClick: () => { this.setState({ menu: false, cat: g, pq: \'\', openP: label, showAll: true }); this.scrollTo(\'products\'); } })',
  "({ label, word: label.replace(/^XENO\\s+/i, ''), subtitle, href: '/product/' + (label === 'XENO 3D Gen' ? '3d' : label === 'XENO 3D' ? 'form' : label.replace(/^XENO\\s+/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')) })");
replaceRequired("goProducts: () => this.scrollTo('products')", "goProducts: () => { window.location.href = '/products'; }");

replaceRequired('  noHost() { if (this.host()) return false; this.toast(\'No model is reachable from this preview. The rest of the page still works.\'); return true; }',
  "  noHost(feature = 'chat') { if (this.host()) return false; window.xenoHomePreview(feature); return true; }");
for (const [state, feature] of [['vd', 'video'], ['sdk', 'sdk'], ['im', 'image']]) {
  replaceRequired(`!${state === 'vd' ? 'v' : state === 'sdk' ? 'd' : 'm'}.prompt.trim() || this.noHost()`,
    `!${state === 'vd' ? 'v' : state === 'sdk' ? 'd' : 'm'}.prompt.trim() || this.noHost('${feature}')`);
}
replaceRequired('if (a.busy || this.noHost())', "if (a.busy || this.noHost('code'))");
replaceRequired('if (f.busy || this.noHost())', "if (f.busy || this.noHost('workflow'))");
replaceRequired('if (!c.agent || !this.host()) return;', "if (!c.agent || this.noHost('comms')) return;");
replaceRequired("if (!this.host()) { say('no model reachable from this preview', 'var(--gbd)'); return; }",
  "if (this.noHost('shell')) return;");
html = html.replaceAll('No model is reachable. Studio, Audio and Shell still run in your browser.',
  'Interactive preview. Model actions show prepared examples; create an account to use your own prompts.')
  .replaceAll("'model offline'", "'preview'")
  .replaceAll("tag: 'live'", "tag: 'preview'")
  .replaceAll('No model is reachable from this preview.', 'Prepared examples — create an account to work with your own prompts.')
  .replaceAll("src = 'matched by keywords · no model reachable'", "src = 'interactive preview · matched by keywords'");
replaceRequired('            <div data-panels="1"',
  '            <div class="home-preview-banner"><span>Interactive preview · explore the tools and prepared examples</span><a href="/auth">Create your free account ↗</a></div>\n            <div data-panels="1"');
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
