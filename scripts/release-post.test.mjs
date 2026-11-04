// Release posts (owner, 2026-11-03: quick releases ship with notes, major ones with a filmed post).
// Run: node --test scripts/release-post.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReleasePost, withReleasePost, PostError } from './lib/release-post.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'xeno-release.mjs');
const run = (...args) => spawnSync(process.execPath, [SCRIPT, 'publish', ...args], { encoding: 'utf8', timeout: 60_000 });
const base = ['--app', 'post-test-no-such-app', '--version', '0.0.1', '--date', '2026-11-03', '--notes', 'x', '--dry-run', '--allow-no-artifacts'];

/** A folder holding a complete post: a header, a clip with its poster, a list. */
function goodPost() {
  const dir = mkdtempSync(join(tmpdir(), 'xeno-post-'));
  writeFileSync(join(dir, 'post.json'), JSON.stringify({
    title: 'Faster restores', say: 'Opening a big canvas no longer stalls.', art: 'hero.jpg',
    blocks: [{ p: 'What changed.' }, { h: 'Restore' }, { video: 'restore.mp4', poster: 'restore.jpg', caption: 'In the app, 0.2.0' },
      { list: [['New', 'Download link'], ['Fixed', 'Restore pause']] }, { note: 'Still rough: nothing.' }],
  }));
  for (const f of ['hero.jpg', 'restore.jpg']) writeFileSync(join(dir, f), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
  writeFileSync(join(dir, 'restore.mp4'), Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 1, 2, 3]));
  return dir;
}
const edit = (dir, fn) => { const p = join(dir, 'post.json'); const j = JSON.parse(String(spawnSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(p)},'utf8'))`], { encoding: 'utf8' }).stdout)); fn(j); writeFileSync(p, JSON.stringify(j)); };

test('a complete post is accepted, with post.json first and every file it names', () => {
  const dir = goodPost();
  try {
    const { files } = validateReleasePost(dir);
    assert.deepEqual(files.map((f) => f.name), ['post.json', 'hero.jpg', 'restore.mp4', 'restore.jpg']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('every way a post would show broken is refused, each named', () => {
  const cases = [
    ['a named file is missing', (d) => unlinkSync(join(d, 'restore.mp4')), /restore\.mp4 is named in the post but not in the folder/],
    ['a stray file would be published unseen', (d) => writeFileSync(join(d, 'notes.txt'), 'x'), /notes\.txt is in the folder but the post does not name it/],
    ['a clip without a poster', (d) => edit(d, (j) => { delete j.blocks[2].poster; }), /needs a poster/],
    ['no picture or clip at all', (d) => edit(d, (j) => { delete j.art; j.blocks = [{ p: 'text only' }]; unlinkSync(join(d, 'hero.jpg')); unlinkSync(join(d, 'restore.jpg')); unlinkSync(join(d, 'restore.mp4')); }), /at least one video, image or banner/],
    ['an unknown tag', (d) => edit(d, (j) => { j.blocks[3].list[0][0] = 'Improved'; }), /must be \["New"\|"Fixed"\|"Changed"/],
    ['a video given as an image', (d) => edit(d, (j) => { j.art = 'restore.mp4'; }), /art: restore\.mp4 is not an image/],
    ['a path instead of a file name', (d) => edit(d, (j) => { j.art = '../hero.jpg'; }), /not a plain file name/],
    ['no title', (d) => edit(d, (j) => { delete j.title; }), /title is required/],
  ];
  for (const [what, breakIt, message] of cases) {
    const dir = goodPost();
    try { breakIt(dir); assert.throws(() => validateReleasePost(dir), (e) => e instanceof PostError && message.test(e.message), what); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('the publisher: a major release needs a post, a quick one cannot carry one, and a broken post stops it before any upload', () => {
  const dir = goodPost();
  try {
    let r = run(...base, '--kind', 'major');
    assert.notEqual(r.status, 0); assert.match(r.stderr, /a major release carries its post/);
    r = run(...base, '--post', dir);
    assert.notEqual(r.status, 0); assert.match(r.stderr, /--post is for a major release/);
    r = run(...base, '--kind', 'big');
    assert.notEqual(r.status, 0); assert.match(r.stderr, /--kind is quick or major/);
    unlinkSync(join(dir, 'restore.jpg'));
    r = run(...base, '--kind', 'major', '--post', dir);
    assert.notEqual(r.status, 0); assert.match(r.stderr, /restore\.jpg is named in the post but not in the folder/);
    assert.doesNotMatch(r.stdout, /DRY RUN OK/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the publisher: a major release with a complete post passes every gate (dry run), and a quick one still works without a post', () => {
  const dir = goodPost();
  try {
    let r = run(...base, '--kind', 'major', '--post', dir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /post: "Faster restores" \(4 files/);
    assert.match(r.stdout, /DRY RUN OK/);
    r = run(...base);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const shipped = [{ version: '2.0.0', latest: true, kind: 'quick', channel: 'stable' }, { version: '1.0.0', kind: 'quick' }];

test('attaching a post changes only that release', () => {
  const next = withReleasePost(shipped, '1.0.0', 'stable', 'v1.0.0/post/post.json');
  assert.deepEqual(next[1], { version: '1.0.0', kind: 'major', post: 'v1.0.0/post/post.json' });
  assert.deepEqual(next[0], shipped[0]);
});

test('attaching refuses a missing release and never replaces a post', () => {
  assert.throws(() => withReleasePost(shipped, '3.0.0', 'stable', 'x'), /no stable release/);
  assert.throws(() => withReleasePost([{ version: '1.0.0', post: 'old' }], '1.0.0', 'stable', 'x'), /already has a post/);
});
