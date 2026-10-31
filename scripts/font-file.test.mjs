// utils/fontFile.js reads what a font says about itself, from fonts built here byte by byte in all four containers.
// Run on a real WOFF2 too, when a catalogue build has staged one (scratchpad/fonts-stage).
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { readFont, restrictedEmbedding, FontFileError } from '../src/server/utils/fontFile.js';

const utf16be = (s) => { const b = Buffer.from(s, 'utf16le'); b.swap16(); return b; };
function nameTable(records) {
  const head = Buffer.alloc(6 + records.length * 12); head.writeUInt16BE(0, 0); head.writeUInt16BE(records.length, 2); head.writeUInt16BE(head.length, 4);
  let off = 0; const strings = [];
  records.forEach(([id, text], i) => { const s = utf16be(text), at = 6 + i * 12; head.writeUInt16BE(3, at); head.writeUInt16BE(1, at + 2); head.writeUInt16BE(0x409, at + 4); head.writeUInt16BE(id, at + 6); head.writeUInt16BE(s.length, at + 8); head.writeUInt16BE(off, at + 10); strings.push(s); off += s.length; });
  return Buffer.concat([head, ...strings]);
}
function os2Table({ weight = 700, fsType = 0, italic = false } = {}) { const b = Buffer.alloc(78); b.writeUInt16BE(weight, 4); b.writeUInt16BE(fsType, 8); b.writeUInt16BE(italic ? 1 : 0, 62); return b; }
function sfnt(tables, flavor = 0x00010000) {
  const tags = Object.keys(tables), head = Buffer.alloc(12 + tags.length * 16); head.writeUInt32BE(flavor, 0); head.writeUInt16BE(tags.length, 4);
  let off = head.length; const bodies = [];
  tags.forEach((t, i) => { const at = 12 + i * 16; head.write(t, at, 'latin1'); head.writeUInt32BE(off, at + 8); head.writeUInt32BE(tables[t].length, at + 12); bodies.push(tables[t]); off += tables[t].length; });
  return Buffer.concat([head, ...bodies]);
}
function woff(tables) {
  const tags = Object.keys(tables), head = Buffer.alloc(44 + tags.length * 20); head.write('wOFF', 0, 'latin1'); head.writeUInt16BE(tags.length, 12);
  let off = head.length; const bodies = [];
  tags.forEach((t, i) => { const c = zlib.deflateSync(tables[t]), at = 44 + i * 20; head.write(t, at, 'latin1'); head.writeUInt32BE(off, at + 4); head.writeUInt32BE(c.length, at + 8); head.writeUInt32BE(tables[t].length, at + 12); bodies.push(c); off += c.length; });
  return Buffer.concat([head, ...bodies]);
}
const b128 = (n) => { const out = []; let v = n; out.unshift(v & 0x7f); v = Math.floor(v / 128); while (v > 0) { out.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); } return Buffer.from(out); };
function woff2(tables) {
  const known = { name: 5, 'OS/2': 6, head: 1, glyf: 10 }, tags = Object.keys(tables), parts = [];
  for (const t of tags) { const glyf = t === 'glyf'; parts.push(Buffer.from([known[t] | (glyf ? 0 : 0)]), b128(tables[t].length)); if (glyf) parts.push(b128(tables[t].length)); }
  const stream = zlib.brotliCompressSync(Buffer.concat(tags.map((t) => tables[t]))), head = Buffer.alloc(48);
  head.write('wOF2', 0, 'latin1'); head.writeUInt16BE(tags.length, 12); head.writeUInt32BE(stream.length, 20);
  return Buffer.concat([head, ...parts, stream]);
}
const T = (o2) => ({ name: nameTable([[1, 'Acme Sans'], [2, 'Bold'], [16, 'Acme'], [17, 'Heavy']]), 'OS/2': os2Table(o2) });

test('reads TrueType, OpenType, WOFF and WOFF2 the same way', () => {
  for (const [buf, format] of [[sfnt(T()), 'ttf'], [sfnt(T(), 0x4f54544f), 'otf'], [woff(T()), 'woff'], [woff2({ ...T(), glyf: Buffer.alloc(20, 7) }), 'woff2']]) {
    const f = readFont(buf);
    assert.equal(f.format, format); assert.equal(f.family, 'Acme'); assert.equal(f.style, 'Heavy'); assert.equal(f.weight, 700); assert.equal(f.italic, false); assert.equal(f.fsType, 0);
  }
});
test('reads a table placed after a transformed one in WOFF2', () => {
  const f = readFont(woff2({ glyf: Buffer.alloc(33, 1), name: nameTable([[1, 'After Glyf']]), 'OS/2': os2Table({ weight: 300 }) }));
  assert.equal(f.family, 'After Glyf'); assert.equal(f.weight, 300);
});
test('falls back to the family name, and reads italic', () => {
  const f = readFont(sfnt({ name: nameTable([[1, 'Plain'], [2, 'Italic']]), 'OS/2': os2Table({ italic: true }) }));
  assert.equal(f.family, 'Plain'); assert.equal(f.style, 'Italic'); assert.equal(f.italic, true);
});
test('a name can’t carry CSS or markup out of a file', () => {
  assert.equal(readFont(sfnt({ name: nameTable([[1, 'Evil"}</style><b;>']]), 'OS/2': os2Table() })).family, 'Evil/styleb');
});
test('restricted embedding is what the font says, and only that', () => {
  assert.equal(readFont(sfnt(T({ fsType: 2 }))).fsType, 2);
  assert.equal(restrictedEmbedding(2), true);
  for (const ok of [0, 4, 8, 0x0100, 0x0200]) assert.equal(restrictedEmbedding(ok), false, `fsType ${ok}`);
});
test('anything else is refused, and a font with no name is too', () => {
  for (const junk of [Buffer.from('not a font at all'), Buffer.alloc(4), Buffer.from('<svg xmlns="x"></svg>'), Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(60, 255)]), Buffer.concat([Buffer.from('wOFF'), Buffer.alloc(30, 255)])]) {
    assert.throws(() => readFont(junk), FontFileError);
  }
  assert.throws(() => readFont(sfnt({ 'OS/2': os2Table() })), (e) => e.code === 'font_no_name');
});
test('a brotli bomb in a WOFF2 is refused, not expanded', () => {
  const big = zlib.brotliCompressSync(Buffer.alloc(128 * 1024 * 1024)), head = Buffer.alloc(48);
  head.write('wOF2', 0, 'latin1'); head.writeUInt16BE(1, 12); head.writeUInt32BE(big.length, 20);
  assert.throws(() => readFont(Buffer.concat([head, Buffer.from([5]), b128(10), big])), FontFileError);
});
test('a real WOFF2 from the catalogue, when one is staged', { skip: !fs.existsSync('scratchpad/fonts-stage/inter') }, () => {
  const dir = path.join('scratchpad/fonts-stage/inter', fs.readdirSync('scratchpad/fonts-stage/inter')[0]);
  const f = readFont(fs.readFileSync(path.join(dir, 'inter-latin-700-normal.woff2')));
  assert.equal(f.format, 'woff2'); assert.match(f.family, /^Inter/); assert.equal(f.weight, 700);
});
