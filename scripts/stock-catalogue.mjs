#!/usr/bin/env node
/**
 * The XENO Stock catalogue (owner decision 2026-10-31: open-licence media we host, plus what people generate). Nothing here is licensed to
 * us: every item has to be free of copyright by a statement ON THE ITEM, read from its source and recorded with the date it was read.
 *
 *   node scripts/stock-catalogue.mjs gather [--per 30]      fetch candidates that pass the rights test; download; make previews with xeno-edit
 *   node scripts/stock-catalogue.mjs sheets                 contact sheets for a person (or model) to look at every item
 *   node scripts/stock-catalogue.mjs build                  write src/server/data/stockCatalogue.json, minus scripts/data/stock-review.json's rejections
 *   node scripts/stock-catalogue.mjs publish [--confirm]    upload through the one gated publisher. A dry run unless --confirm
 *
 * WHICH SOURCES, and why these (measured 2026-10-31):
 *   - Cleveland Museum of Art: `share_license_status: "CC0"` on each work.
 *   - Wikimedia Commons, CC0 only, and only a file its uploader says is their own work. A file credited to anywhere else is refused:
 *     aggregators re-upload stock photos as "CC0" (measured: pikwizard, AvoPix), which proves nothing about who took them.
 *   Refused: Unsplash and Pexels, whose licences forbid building a similar stock service from their files. The Met's API answers 410. The
 *   Art Institute of Chicago's images are CC0, but its image server answers with a Cloudflare bot challenge, and we don't get round those.
 *   NASA has no licence field on an item, and its rules restrict people, logos and endorsement, so nothing could check them.
 *
 * WHAT A LICENCE DOESN'T CLEAR: a person in a photo, a brand, a building's architect. Hence the template check on Commons and the contact
 * sheets: every item is looked at before it ships, and scripts/data/stock-review.json records what was rejected and why.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.join(repo, 'scratchpad/stock-stage'), SHEETS = path.join(repo, 'scratchpad/stock-sheets');
const CANDIDATES = path.join(STAGE, 'candidates.json'), OUT = path.join(repo, 'src/server/data/stockCatalogue.json'), REVIEW = path.join(repo, 'scripts/data/stock-review.json');
const XENO_EDIT = process.env.XENO_EDIT || path.resolve(repo, '../xeno-lib/xeno-edit/target/debug/xeno-edit.exe');
const BASE = 'https://updates.xenostudio.ai/stock', VERSION = 1, UA = 'XENO-Stock-catalogue/1.0 (admin@xenosystem.ai)';
const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(40000) });
      if (r.ok) return await r.json();
      if (r.status !== 429 && r.status < 500) throw new Error(`HTTP ${r.status}`);
    } catch (e) { if (i === 3) throw e; }
    await sleep(3000 * (i + 1));
  }
  throw new Error(`no answer from ${url}`);
}

/** Each source answers: candidates that passed its rights test. A candidate names what it read, so the record shows why it's here. */
const ART = ['landscape', 'flowers', 'sea', 'botanical', 'birds', 'mountains', 'textile pattern', 'japanese woodblock', 'map', 'architecture'];
const PHOTO = ['mountain landscape', 'forest', 'ocean waves', 'desert', 'clouds sky', 'city skyline', 'modern architecture', 'stone texture', 'wood texture', 'flower macro', 'lake', 'waterfall', 'snow', 'beach sunset', 'autumn leaves', 'food', 'coffee', 'night sky', 'animal wildlife', 'road'];
const VIDEO = ['nature', 'landscape', 'ocean', 'clouds', 'forest', 'city', 'river', 'timelapse'];

async function cleveland(per) {
  const out = [];
  for (const q of ART) {
    const j = await getJson(`https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(q)}&cc0=1&has_image=1&limit=${per}`);
    for (const w of j.data || []) {
      if (w.share_license_status !== 'CC0' || w.copyright) continue;
      const img = w.images?.print?.url ? w.images.print : w.images?.web;
      if (!img?.url || !/\.jpe?g$/i.test(img.url) || Number(img.width) < 1400) continue;
      out.push({ id: `cma-${w.id}`, kind: 'image', collection: 'art', title: strip(w.title), creator: strip(w.creators?.[0]?.description) || strip(w.culture?.[0]) || 'Unknown artist', tag: q,
        width: Number(img.width), height: Number(img.height), ext: 'jpg', download: img.url, maxBytes: 40 * 1024 * 1024,
        source: { name: 'Cleveland Museum of Art', url: w.url, license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', statedBy: 'institution', read: 'share_license_status: CC0' } });
    }
    await sleep(1200);
  }
  return out;
}
const COMMONS_REFUSE = /personal|trademark|consent|insignia|logo|fop|freedom of panorama|de minimis|copyright|non-free|nsfw|nudity|ai-generated|PD-algorithm|delete/i;
async function commons(queries, type, per, keep) {
  const out = [];
  for (const q of queries) {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&prop=imageinfo%7Ctemplates&tllimit=200&iiprop=url%7Csize%7Cmime%7Cextmetadata&iiurlwidth=1280&iiextmetadatafilter=LicenseShortName%7CLicenseUrl%7CArtist%7CCredit%7CRestrictions'
      + `&gsrlimit=${Math.min(50, per * 4)}&gsrsearch=${encodeURIComponent(`incategory:"CC-Zero" filetype:${type} ${q}`)}`;
    const j = await getJson(url);
    let n = 0;
    for (const p of Object.values(j.query?.pages || {})) {
      const i = p.imageinfo?.[0], e = i?.extmetadata || {};
      if (!i || n >= per) continue;
      if (e.LicenseShortName?.value !== 'CC0') continue;
      if (strip(e.Credit?.value).toLowerCase() !== 'own work') continue;      // the uploader says they made it; anything else is a re-upload
      if (strip(e.Restrictions?.value)) continue;
      if ((p.templates || []).some((t) => COMMONS_REFUSE.test(t.title))) continue;
      const c = keep(i);
      if (!c) continue;
      n += 1;
      const name = p.title.replace(/^File:/, '').replace(/\.[^.]+$/, '');
      out.push({ id: `wc-${p.pageid}`, title: strip(name).replace(/[_]+/g, ' '), creator: strip(e.Artist?.value) || 'Unknown', tag: q, width: i.width, height: i.height, ...c,
        source: { name: 'Wikimedia Commons', url: i.descriptionurl, license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', statedBy: 'uploader', read: 'LicenseShortName: CC0; Credit: Own work' } });
    }
    await sleep(1200);
  }
  return out;
}
const photos = (per) => commons(PHOTO, 'bitmap', per, (i) => (i.mime === 'image/jpeg' && i.width >= 2400 && i.size <= 15 * 1024 * 1024 ? { kind: 'image', collection: 'photo', ext: 'jpg', download: i.url } : null));
const videos = (per) => commons(VIDEO, 'video', per, (i) => (i.mime === 'video/webm' && i.height >= 720 && i.size <= 60 * 1024 * 1024 && i.thumburl ? { kind: 'video', collection: 'video', ext: 'webm', download: i.url, poster: i.thumburl, duration: Math.round(i.duration || 0) } : null));

const MAGIC = { jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, webm: (b) => b.readUInt32BE(0) === 0x1a45dfa3 };
async function download(url, file, ext, maxBytes = 30 * 1024 * 1024) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file);
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(180000) }).catch(() => null);
    if (r?.ok) {
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length > maxBytes) throw new Error('too large');
      if (!MAGIC[ext](b)) throw new Error('not what it said it was');   // an error page saved as a JPEG reads as a file until someone opens it
      fs.writeFileSync(file, b);
      return b;
    }
    if (r && r.status !== 429 && r.status < 500) throw new Error(`HTTP ${r.status}`);
    await sleep(5000 * (i + 1));
  }
  throw new Error('no answer');
}
/** A JPEG's EXIF orientation (1 when it has none). xeno-edit doesn't apply it, so a phone photo's preview would come out sideways. */
export function orientationOf(b) {
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1], size = b.readUInt16BE(i + 2);
    if (marker === 0xda) return 1;
    if (marker === 0xe1 && b.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
      const t = i + 10, le = b.toString('latin1', t, t + 2) === 'II';
      const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o)), u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
      const ifd = t + u32(t + 4), n = u16(ifd);
      for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (u16(e) === 0x0112) return u16(e + 8); }
      return 1;
    }
    i += 2 + size;
  }
  return 1;
}
const ROTATE = { 3: 180, 6: 90, 8: 270 };
function preview(input, dir, name) {
  const tmp = fs.mkdtempSync(path.join(STAGE, '.tmp-'));
  const o = orientationOf(fs.readFileSync(input));
  if ([2, 4, 5, 7].includes(o)) throw new Error(`mirrored (EXIF ${o})`);   // xeno-edit can't flip by orientation, and these are rare
  try {
    execFileSync(XENO_EDIT, ['image-filter', input, '-o', tmp, '-w', '800', '-f', 'jpeg', '--quality', '78', ...(ROTATE[o] ? ['--rotate', String(ROTATE[o])] : [])], { stdio: 'pipe' });
    const made = fs.readdirSync(tmp).find((f) => /\.jpe?g$/i.test(f));
    if (!made) throw new Error('xeno-edit made no preview');
    fs.renameSync(path.join(tmp, made), path.join(dir, name));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function gather() {
  const per = Number(arg('--per', 30));
  fs.mkdirSync(STAGE, { recursive: true });
  const groups = [];
  for (const [name, run] of [['cleveland', () => cleveland(Math.ceil(per / 2))], ['photos', () => photos(per)], ['videos', () => videos(Math.ceil(per / 3))]]) {
    try { const got = await run(); console.log(`${name}: ${got.length} passed the rights test`); groups.push(...got); }
    catch (e) { console.log(`${name}: UNREACHABLE (${e.message}). Nothing from it this run.`); }
  }
  const seen = new Set(), kept = [];
  for (const c of groups) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const dir = path.join(STAGE, c.id, `v${VERSION}`);
    fs.mkdirSync(dir, { recursive: true });
    try {
      const b = await download(c.download, path.join(dir, `full.${c.ext}`), c.ext, c.kind === 'video' ? 62 * 1024 * 1024 : c.maxBytes);
      if (c.kind === 'image' && [5, 6, 7, 8].includes(orientationOf(b))) [c.width, c.height] = [c.height, c.width];   // what a browser shows, once it applies the tag
      const posterSource = c.kind === 'video' ? path.join(dir, 'poster-src.jpg') : path.join(dir, `full.${c.ext}`);
      if (c.kind === 'video') await download(c.poster, posterSource, 'jpg');
      if (!fs.existsSync(path.join(dir, 'preview.jpg'))) preview(posterSource, dir, 'preview.jpg');
      if (c.kind === 'video') fs.rmSync(posterSource, { force: true });
      const prev = fs.readFileSync(path.join(dir, 'preview.jpg'));
      kept.push({ ...c, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex'), previewBytes: prev.length, previewSha256: crypto.createHash('sha256').update(prev).digest('hex'), checkedAt: today() });
      process.stdout.write('.');
    } catch (e) { console.log(`\nskipped ${c.id}: ${e.message}`); fs.rmSync(path.join(STAGE, c.id), { recursive: true, force: true }); }
    fs.writeFileSync(CANDIDATES, JSON.stringify(kept, null, 1));
    await sleep(250);
  }
  const total = kept.reduce((n, c) => n + c.bytes + c.previewBytes, 0);
  console.log(`\n${kept.length} candidates, ${(total / 1e6).toFixed(0)} MB → ${path.relative(repo, CANDIDATES)}`);
}

/** Remake every preview for the candidates already gathered. It asks no source for anything, so nothing unreviewed can come in. */
function previews() {
  const list = JSON.parse(fs.readFileSync(CANDIDATES, 'utf8'));
  for (const c of list) {
    const dir = path.join(STAGE, c.id, `v${VERSION}`), full = path.join(dir, `full.${c.ext}`);
    if (c.kind !== 'image') continue;   // a video's poster was made from a Commons thumbnail; see `posters` below
    const b = fs.readFileSync(full);
    if (!c.oriented && [5, 6, 7, 8].includes(orientationOf(b))) { [c.width, c.height] = [c.height, c.width]; c.oriented = true; }
    fs.rmSync(path.join(dir, 'preview.jpg'), { force: true });
    preview(full, dir, 'preview.jpg');
    const prev = fs.readFileSync(path.join(dir, 'preview.jpg'));
    c.previewBytes = prev.length; c.previewSha256 = crypto.createHash('sha256').update(prev).digest('hex');
    process.stdout.write('.');
  }
  fs.writeFileSync(CANDIDATES, JSON.stringify(list, null, 1));
  console.log(`\n${list.length} candidates, previews remade`);
}
/** A video's poster comes from Commons' thumbnail, so remaking one fetches that thumbnail again. */
async function posters() {
  const list = JSON.parse(fs.readFileSync(CANDIDATES, 'utf8'));
  for (const c of list) {
    if (c.kind !== 'video') continue;
    const dir = path.join(STAGE, c.id, `v${VERSION}`), src = path.join(dir, 'poster-src.jpg');
    await download(c.poster, src, 'jpg');
    fs.rmSync(path.join(dir, 'preview.jpg'), { force: true });
    preview(src, dir, 'preview.jpg');
    fs.rmSync(src, { force: true });
    const prev = fs.readFileSync(path.join(dir, 'preview.jpg'));
    c.previewBytes = prev.length; c.previewSha256 = crypto.createHash('sha256').update(prev).digest('hex');
    process.stdout.write('.');
    await sleep(400);
  }
  fs.writeFileSync(CANDIDATES, JSON.stringify(list, null, 1));
  console.log('\nposters remade');
}

async function sheets() {
  const puppeteer = createRequire(path.join(repo, 'package.json'))('puppeteer');
  const rejected = fs.existsSync(REVIEW) ? new Set(JSON.parse(fs.readFileSync(REVIEW, 'utf8')).rejected.map((r) => r.id)) : new Set();
  const list = JSON.parse(fs.readFileSync(CANDIDATES, 'utf8')).filter((c) => !rejected.has(c.id));
  fs.rmSync(SHEETS, { recursive: true, force: true }); fs.mkdirSync(SHEETS, { recursive: true });
  const b = await puppeteer.launch({ headless: true });
  try {
    const p = await b.newPage(); await p.setViewport({ width: 1500, height: 1100 });
    const SIZE = 40;
    for (let s = 0; s * SIZE < list.length; s++) {
      const items = list.slice(s * SIZE, (s + 1) * SIZE);
      const html = `<!doctype html><body style="margin:0;background:#222;color:#fff;font:11px sans-serif;display:grid;grid-template-columns:repeat(8,1fr);gap:4px;padding:4px">${items.map((c, i) => `<div><img src="${pathToFileURL(path.join(STAGE, c.id, `v${VERSION}`, 'preview.jpg'))}" style="width:100%;height:160px;object-fit:contain;background:#000"><div>${s * SIZE + i} ${c.id} ${c.kind === 'video' ? '▶' : ''}</div></div>`).join('')}</body>`;
      const f = path.join(SHEETS, `sheet-${s}.html`); fs.writeFileSync(f, html);
      await p.goto(pathToFileURL(f).href, { waitUntil: 'networkidle0' });
      await p.screenshot({ path: path.join(SHEETS, `sheet-${s}.png`) });
    }
    console.log(`${Math.ceil(list.length / SIZE)} sheets in ${path.relative(repo, SHEETS)}`);
  } finally { await b.close(); }
}

function build() {
  const list = JSON.parse(fs.readFileSync(CANDIDATES, 'utf8'));
  const review = JSON.parse(fs.readFileSync(REVIEW, 'utf8'));
  const rejected = new Set(review.rejected.map((r) => r.id));
  const items = list.filter((c) => !rejected.has(c.id)).map((c) => {
    const allowed = c.source.license === 'CC0-1.0' && ['institution', 'uploader'].includes(c.source.statedBy);
    if (!allowed) throw new Error(`${c.id}: not an allowed licence record`);
    return { id: c.id, kind: c.kind, collection: c.collection, title: c.title.slice(0, 200), creator: c.creator.slice(0, 200), tag: c.tag, width: c.width, height: c.height, ...(c.duration ? { duration: c.duration } : {}), version: VERSION, ext: c.ext, bytes: c.bytes, sha256: c.sha256, previewBytes: c.previewBytes, previewSha256: c.previewSha256, source: c.source, checkedAt: c.checkedAt };
  });
  fs.writeFileSync(OUT, JSON.stringify({ base: BASE, reviewedAt: review.reviewedAt, items }, null, 1) + '\n');
  const by = (k) => items.reduce((m, c) => ({ ...m, [c[k]]: (m[c[k]] || 0) + 1 }), {});
  console.log(`${items.length} items (${list.length - items.length} rejected)`, by('collection'), `${(items.reduce((n, c) => n + c.bytes + c.previewBytes, 0) / 1e6).toFixed(0)} MB → ${path.relative(repo, OUT)}`);
}

async function publish() {
  const confirm = process.argv.includes('--confirm');
  const { R2Publisher } = await import(pathToFileURL(path.join(repo, 'scripts/lib/r2-upload.mjs')).href);
  const { items } = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const pub = new R2Publisher({ remote: 'r2:xeno-hub-releases', dryRun: !confirm });
  for (const c of items) {
    const dir = path.join(STAGE, c.id, `v${c.version}`);
    for (const [f, sha] of [[`full.${c.ext}`, c.sha256], ['preview.jpg', c.previewSha256]]) {
      const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
      if (got !== sha) throw new Error(`${c.id}/${f}: the stage doesn't match the catalogue`);
    }
    await pub.putDirectory(dir, `stock/${c.id}/v${c.version}/`, { requireStructural: false });
  }
  console.log(confirm ? `Published ${items.length}.` : 'Dry run. Nothing was uploaded. Add --confirm to publish.');
}

// importable by its test without running anything
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  await ({ gather, previews, posters, sheets, build, publish }[cmd] || (() => { console.log('gather | previews | posters | sheets | build | publish'); process.exit(2); }))();
  process.exit(0);
}
