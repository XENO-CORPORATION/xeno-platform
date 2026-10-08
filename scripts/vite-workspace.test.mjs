// The workspace build step: which files ship, and how the page's script and stylesheet addresses are stamped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stampAssets, shipped } from './vite-workspace.mjs';

test('each local script and stylesheet address gets the hash of its file', () => {
  const html = '<link href="pages.css" rel="stylesheet">\n<script src="keys.js"></script>\n<script src="app.js"></script>';
  const r = stampAssets(html, (n) => ({ 'pages.css': 'aaa', 'keys.js': 'bbb', 'app.js': 'ccc' }[n] || null));
  assert.equal(r.count, 3);
  assert.equal(r.html, '<link href="pages.css?v=aaa" rel="stylesheet">\n<script src="keys.js?v=bbb"></script>\n<script src="app.js?v=ccc"></script>');
});

test('addresses on another host, and ones already carrying a query, are left alone', () => {
  const html = '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"><script src="https://cdn.example/x.js"></script><script src="a.js?v=1"></script><a href="#/library">x</a>';
  const r = stampAssets(html, () => 'zzz');
  assert.equal(r.count, 0);
  assert.equal(r.html, html);
});

test('a reference to a file that is not shipped fails the build', () => {
  assert.throws(() => stampAssets('<script src="gone.js"></script>', () => null), /gone\.js, which is not shipped/);
});

test('a changed file gets a new address and an unchanged one keeps its address', () => {
  const html = '<script src="a.js"></script><script src="b.js"></script>';
  const one = stampAssets(html, (n) => ({ 'a.js': '111', 'b.js': '222' }[n])).html, two = stampAssets(html, (n) => ({ 'a.js': '111', 'b.js': '333' }[n])).html;
  assert.ok(one.includes('a.js?v=111') && two.includes('a.js?v=111'));
  assert.ok(one.includes('b.js?v=222') && two.includes('b.js?v=333'));
});

test('tests, notes, package files and dot files are never shipped', () => {
  for (const no of ['tests/hist-test.mjs', 'tests/unit/purity.test.mjs', 'README.md', 'package.json', 'package-lock.json', '.env', 'node_modules/x/index.js']) assert.equal(shipped(no), false, no);
  for (const yes of ['index.html', 'app.js', 'pages.css', 'platform.js']) assert.equal(shipped(yes), true, yes);
});
