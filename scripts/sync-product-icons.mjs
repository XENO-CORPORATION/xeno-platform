#!/usr/bin/env node
// The product icons the workspace shows, vendored into public/product-icons/ so the site can serve them.
// Source of truth: the workspace-root folder xeno-product-icons/ (svg/ and file-icons/svg/). It is not in this
// repository, and the image build has no access to it, so a copy ships here.
//   node scripts/sync-product-icons.mjs            compare, and list what differs (exit 1 on a difference)
//   node scripts/sync-product-icons.mjs --confirm  copy new and changed icons in; removes nothing
// XENO_PRODUCT_ICONS names the source folder when this checkout is not beside it (a worktree).
// Without the source folder present it reports that and exits 0: the vendored copy is then what ships.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.resolve(process.env.XENO_PRODUCT_ICONS || path.join(repo, '..', 'xeno-product-icons')), dest = path.join(repo, 'public', 'product-icons');
const SETS = [['svg', 'svg'], [path.join('file-icons', 'svg'), path.join('file-icons', 'svg')]];
const confirm = process.argv.includes('--confirm');
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
if (!fs.existsSync(path.join(src, 'svg'))) { console.log('source folder not found (' + src + '); the vendored copy is unchanged'); process.exit(0); }
let differ = 0, copied = 0;
for (const [from, to] of SETS) {
  const a = path.join(src, from), b = path.join(dest, to);
  for (const name of fs.readdirSync(a).filter((n) => n.endsWith('.svg')).sort()) {
    const s = path.join(a, name), d = path.join(b, name);
    if (fs.existsSync(d) && hash(s) === hash(d)) continue;
    differ++; console.log((fs.existsSync(d) ? 'changed  ' : 'missing  ') + path.join(to, name));
    if (confirm) { fs.mkdirSync(b, { recursive: true }); fs.copyFileSync(s, d + '.tmp'); if (fs.statSync(d + '.tmp').size === 0) throw new Error('empty copy: ' + name); fs.renameSync(d + '.tmp', d); copied++; }
  }
}
console.log(confirm ? `copied ${copied} icon(s)` : differ ? `${differ} icon(s) differ; run with --confirm to copy them in` : 'vendored icons match the source');
process.exit(!confirm && differ ? 1 : 0);
