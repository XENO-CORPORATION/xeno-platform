/**
 * Read what a font file says about itself: its name, weight, italic, and whether its own licence bits allow it to be embedded.
 * Works on TrueType, OpenType, WOFF and WOFF2. Pure, with no dependency beyond node:zlib.
 *
 * Why not trust the upload: a file called inter.woff2 can be anything, and a font's OS/2 `fsType` is the foundry's own statement
 * of what may be done with it. A value of 2 means "Restricted License embedding": it must not be embedded. A person's word that
 * they have the rights can't override what the font itself says, so that's a refusal.
 */
import zlib from 'node:zlib';

export class FontFileError extends Error { constructor(message, code) { super(message); this.name = 'FontFileError'; this.code = code; } }

const MAX_TABLE = 16 * 1024 * 1024;
// WOFF2's "known tags" table, in the spec's order: a one-byte index stands for a tag
const WOFF2_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

const bad = (m = 'That file isn’t a font this can read.') => new FontFileError(m, 'not_a_font');
const u16 = (b, o) => { if (o + 2 > b.length) throw bad(); return b.readUInt16BE(o); };
const u32 = (b, o) => { if (o + 4 > b.length) throw bad(); return b.readUInt32BE(o); };

function sfntTables(buf) {
  const n = u16(buf, 4), out = {};
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16, tag = buf.toString('latin1', at, at + 4), off = u32(buf, at + 8), len = u32(buf, at + 12);
    if (tag === 'name' || tag === 'OS/2') { if (off + len > buf.length) throw bad(); out[tag] = buf.subarray(off, off + len); }
  }
  return out;
}
function woffTables(buf) {
  const n = u16(buf, 12), out = {};
  for (let i = 0; i < n; i++) {
    const at = 44 + i * 20, tag = buf.toString('latin1', at, at + 4), off = u32(buf, at + 4), comp = u32(buf, at + 8), orig = u32(buf, at + 12);
    if (tag !== 'name' && tag !== 'OS/2') continue;
    if (off + comp > buf.length || orig > MAX_TABLE) throw bad();
    const raw = buf.subarray(off, off + comp);
    try { out[tag] = comp === orig ? raw : zlib.inflateSync(raw, { maxOutputLength: MAX_TABLE }); } catch { throw bad(); }
  }
  return out;
}
function base128(buf, at) {
  let v = 0;
  for (let i = 0; i < 5; i++) { if (at.i >= buf.length) throw bad(); const b = buf[at.i++]; if (i === 0 && b === 0x80) throw bad(); v = (v * 128) + (b & 0x7f); if (!(b & 0x80)) return v; }
  throw bad();
}
function woff2Tables(buf) {
  const n = u16(buf, 12), compressed = u32(buf, 20), at = { i: 48 }, dir = [];
  for (let k = 0; k < n; k++) {
    if (at.i >= buf.length) throw bad();
    const flags = buf[at.i++], idx = flags & 0x3f, version = flags >> 6;
    let tag;
    if (idx === 63) { tag = buf.toString('latin1', at.i, at.i + 4); at.i += 4; } else { tag = WOFF2_TAGS[idx]; if (!tag) throw bad(); }
    const orig = base128(buf, at);
    // glyf and loca are transformed unless the version says otherwise; every other table is the reverse
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    const len = transformed ? base128(buf, at) : orig;
    dir.push({ tag, len });
  }
  let stream;
  try { stream = zlib.brotliDecompressSync(buf.subarray(at.i, at.i + compressed), { maxOutputLength: 64 * 1024 * 1024 }); } catch { throw bad(); }
  const out = {}; let off = 0;
  for (const d of dir) { if (d.tag === 'name' || d.tag === 'OS/2') { if (off + d.len > stream.length) throw bad(); out[d.tag] = stream.subarray(off, off + d.len); } off += d.len; }
  return out;
}
function readName(t) {
  if (!t) return {};
  const count = u16(t, 2), strings = u16(t, 4), found = {};
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12, platform = u16(t, at), nameId = u16(t, at + 6), len = u16(t, at + 8), off = u16(t, at + 10);
    if (![1, 2, 16, 17].includes(nameId) || strings + off + len > t.length) continue;
    const raw = t.subarray(strings + off, strings + off + len);
    let text;
    if (platform === 3 || platform === 0) { const b = Buffer.from(raw); if (b.length % 2) continue; b.swap16(); text = b.toString('utf16le'); }
    else if (platform === 1) text = raw.toString('latin1');
    else continue;
    if (platform === 3 || !found[nameId]) found[nameId] = text;
  }
  return found;
}

/** Everything a font says about itself, or a refusal. */
export function readFont(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) throw bad();
  const sig = buf.toString('latin1', 0, 4);
  let format, tables;
  if (sig === 'wOF2') { format = 'woff2'; tables = woff2Tables(buf); }
  else if (sig === 'wOFF') { format = 'woff'; tables = woffTables(buf); }
  else if (sig === 'OTTO') { format = 'otf'; tables = sfntTables(buf); }
  else if (buf.readUInt32BE(0) === 0x00010000 || sig === 'true') { format = 'ttf'; tables = sfntTables(buf); }
  else throw bad();
  const names = readName(tables.name), os2 = tables['OS/2'];
  const clean = (s) => String(s || '').replace(/[\u0000-\u001f<>{};\\"]/g, '').trim().slice(0, 120);
  const family = clean(names[16] || names[1]);
  if (!family) throw new FontFileError('That font doesn’t say what it’s called.', 'font_no_name');
  const fsType = os2 ? u16(os2, 8) : 0;
  return { format, family, style: clean(names[17] || names[2]) || 'Regular', weight: os2 ? (u16(os2, 4) || 400) : 400, italic: os2 && os2.length >= 64 ? (u16(os2, 62) & 1) === 1 : false, fsType };
}
/** fsType's low bits: 2 alone means the font's own licence forbids embedding it. */
export const restrictedEmbedding = (fsType) => (fsType & 0x000f) === 2;
export const FONT_MIME = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
