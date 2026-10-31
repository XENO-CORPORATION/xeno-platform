#!/usr/bin/env node
/**
 * XENO Fonts' catalogue: open-licence fonts we host ourselves (owner decision 2026-10-31: open catalogue + private uploads).
 *
 *   node scripts/fonts-catalogue.mjs build                 download, verify licences, write src/server/data/fontCatalogue.json
 *   node scripts/fonts-catalogue.mjs publish               DRY RUN: what would go to R2
 *   node scripts/fonts-catalogue.mjs publish --confirm     upload through the one gated publisher
 *
 * The fonts come from the Fontsource packages on npm, at a pinned version. 🔴 A font's licence is read from its own files, twice:
 * the package's metadata must name an allowed licence AND its LICENSE text must say so. A family that fails either is refused and
 * the build stops, because a hosted font with the wrong licence is a legal problem, not a bug. No font bytes go in this repo: the
 * JSON holds names, files, sizes and hashes; the bytes live on R2 under immutable, versioned keys, each family with its LICENSE
 * beside it, which the OFL requires.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { R2Publisher } from './lib/r2-upload.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(repo, 'src/server/data/fontCatalogue.json');
const STAGE = path.join(repo, 'scratchpad/fonts-stage');
const BASE = 'https://updates.xenostudio.ai/fonts';
const SUBSETS = ['latin', 'latin-ext'];
const ALLOWED = new Set(['OFL-1.1', 'Apache-2.0']);
const LICENCE_TEXT = { 'OFL-1.1': /Open Font License/i, 'Apache-2.0': /Apache License/i };

const FAMILIES = ['inter', 'roboto', 'open-sans', 'lato', 'montserrat', 'poppins', 'source-sans-3', 'nunito', 'work-sans', 'dm-sans', 'manrope', 'ibm-plex-sans', 'figtree', 'space-grotesk', 'outfit', 'raleway', 'rubik', 'noto-sans',
  'merriweather', 'lora', 'playfair-display', 'source-serif-4', 'eb-garamond', 'libre-baskerville', 'crimson-pro', 'ibm-plex-serif', 'noto-serif', 'fraunces',
  'jetbrains-mono', 'fira-code', 'ibm-plex-mono', 'source-code-pro', 'space-mono', 'dm-mono',
  'bebas-neue', 'oswald', 'anton', 'abril-fatface', 'caveat', 'pacifico'];

// Heading → body pairs type designers and style guides recommend. Written by hand; this is not AI pairing, and doesn't claim to be.
const PAIRINGS = [['playfair-display', 'source-sans-3'], ['playfair-display', 'lato'], ['montserrat', 'merriweather'], ['montserrat', 'source-serif-4'], ['oswald', 'open-sans'], ['bebas-neue', 'montserrat'], ['bebas-neue', 'lora'],
  ['abril-fatface', 'lato'], ['raleway', 'lora'], ['raleway', 'merriweather'], ['poppins', 'lora'], ['poppins', 'noto-serif'], ['space-grotesk', 'inter'], ['space-grotesk', 'ibm-plex-serif'], ['fraunces', 'inter'], ['fraunces', 'dm-sans'],
  ['dm-sans', 'dm-mono'], ['inter', 'jetbrains-mono'], ['ibm-plex-sans', 'ibm-plex-serif'], ['ibm-plex-sans', 'ibm-plex-mono'], ['outfit', 'source-serif-4'], ['anton', 'roboto'], ['eb-garamond', 'work-sans'], ['libre-baskerville', 'source-sans-3'],
  ['crimson-pro', 'work-sans'], ['figtree', 'crimson-pro'], ['manrope', 'lora'], ['nunito', 'noto-serif'], ['rubik', 'merriweather'], ['caveat', 'lato'], ['pacifico', 'open-sans']];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function build() {
  rmSync(STAGE, { recursive: true, force: true }); mkdirSync(STAGE, { recursive: true });
  const tmp = mkdtempSync(path.join(STAGE, '.dl-'));
  const unicode = {}, families = [];
  for (const id of FAMILIES) {
    const pkg = `@fontsource/${id}`;
    const version = execFileSync('npm', ['view', pkg, 'version'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
    const tgz = execFileSync('npm', ['pack', `${pkg}@${version}`, '--silent'], { cwd: tmp, encoding: 'utf8', shell: process.platform === 'win32' }).trim().split('\n').pop();
    const dir = path.join(tmp, id); mkdirSync(dir);
    execFileSync('tar', ['xzf', tgz, '-C', id], { cwd: tmp });
    const root = path.join(dir, 'package'), meta = JSON.parse(readFileSync(path.join(root, 'metadata.json'), 'utf8'));
    const licence = meta.license?.type, text = readFileSync(path.join(root, 'LICENSE'), 'utf8');
    if (!ALLOWED.has(licence)) throw new Error(`${id}: licence ${licence} isn't allowed`);
    if (!LICENCE_TEXT[licence].test(text)) throw new Error(`${id}: metadata says ${licence}, but its LICENSE text doesn't`);
    const uni = JSON.parse(readFileSync(path.join(root, 'unicode.json'), 'utf8'));
    for (const s of SUBSETS) if (uni[s]) unicode[s] = uni[s];
    const stage = path.join(STAGE, id, `v${version}`); mkdirSync(stage, { recursive: true });
    const files = [];
    for (const weight of meta.weights) for (const style of meta.styles) for (const subset of SUBSETS) {
      const name = `${id}-${subset}-${weight}-${style}.woff2`, src = path.join(root, 'files', name);
      if (!existsSync(src)) continue;
      const bytes = readFileSync(src);
      copyFileSync(src, path.join(stage, name));
      files.push({ file: name, weight, style, subset, bytes: bytes.length, sha256: sha(bytes) });
    }
    if (!files.length) throw new Error(`${id}: no files found`);
    copyFileSync(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE.txt'));
    families.push({ id, family: meta.family, category: meta.category, version, weights: meta.weights, styles: meta.styles, source: meta.source || null,
      license: { type: licence, url: meta.license.url || null, attribution: String(meta.license.attribution || '').slice(0, 400) }, files });
    console.log(`  ${id} ${version} ${licence} ${files.length} files`);
  }
  rmSync(tmp, { recursive: true, force: true });
  const ids = new Set(families.map((f) => f.id));
  for (const [a, b] of PAIRINGS) if (!ids.has(a) || !ids.has(b)) throw new Error(`a pairing names ${a} or ${b}, which isn't in the catalogue`);
  writeFileSync(OUT, `${JSON.stringify({ base: BASE, subsets: SUBSETS, unicodeRanges: unicode, pairings: PAIRINGS, families }, null, 1)}\n`);
  const total = families.reduce((n, f) => n + f.files.reduce((m, x) => m + x.bytes, 0), 0);
  console.log(`\n${families.length} families, ${families.reduce((n, f) => n + f.files.length, 0)} files, ${(total / 1048576).toFixed(1)} MB → ${path.relative(repo, OUT)}`);
}

async function publish(confirm) {
  const cat = JSON.parse(readFileSync(OUT, 'utf8'));
  const pub = new R2Publisher({ remote: process.env.R2_REMOTE || 'r2:xeno-hub-releases', dryRun: !confirm });
  for (const f of cat.families) {
    const dir = path.join(STAGE, f.id, `v${f.version}`);
    if (!existsSync(dir)) throw new Error(`${f.id}: nothing staged. Run build first.`);
    const on = readdirSync(dir);
    for (const x of f.files) { if (!on.includes(x.file) || sha(readFileSync(path.join(dir, x.file))) !== x.sha256) throw new Error(`${f.id}: ${x.file} doesn't match the catalogue`); }
    await pub.putDirectory(dir, `fonts/${f.id}/v${f.version}/`, { requireStructural: false });
  }
  console.log(confirm ? 'Published.' : 'Dry run. Nothing was uploaded. Add --confirm to publish.');
  console.log(pub.coverageSummary?.() || '');
}

const [cmd] = process.argv.slice(2);
if (cmd === 'build') build();
else if (cmd === 'publish') await publish(process.argv.includes('--confirm'));
else { console.error('Usage: node scripts/fonts-catalogue.mjs build | publish [--confirm]'); process.exit(2); }
