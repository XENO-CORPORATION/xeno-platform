import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [emptyStateSource, globalStyles, tailwindConfig] = await Promise.all([
  readFile(new URL('../src/components/playground/Chat/ChatEmptyState.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
  readFile(new URL('../tailwind.config.js', import.meta.url), 'utf8'),
]);

assert.match(globalStyles, /api\.fontshare\.com\/v2\/css\?f\[\]=clash-display@400,500,600,700/, 'Clash Display should be loaded for display typography');
assert.doesNotMatch(globalStyles, /family=Instrument\+Sans/, 'Instrument Sans should no longer be loaded');
assert.match(tailwindConfig, /display: \['"Clash Display"', 'Inter', 'sans-serif'\]/, 'Tailwind should expose the Clash Display token');
assert.match(emptyStateSource, /font-display/, 'Empty-chat headline should use XENO display typography');
assert.match(emptyStateSource, /-translate-y-6/, 'Empty-chat headline should move 24px upward without moving the composer');
assert.match(emptyStateSource, /text-3xl/, 'Empty-chat headline should be larger on small screens');
assert.match(emptyStateSource, /sm:text-\[2\.5rem\]/, 'Empty-chat headline should use the approved 40px desktop size');
assert.match(emptyStateSource, /tracking-\[-0\.01em\]/, 'Empty-chat headline should keep readable display tracking');

console.log('Chat empty headline typography checks passed.');
