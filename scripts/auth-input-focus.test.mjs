// Gate: a field that paints its own focus must not ALSO get the site-wide
// :focus-visible outline — that pair is the doubled stroke around the auth
// inputs (owner screenshot, 2026-10-22). And the global ring itself must
// stay: plain inputs whose only focus affordance it is keep it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

test('elements fields opt out of the global ring; the ring itself stays', () => {
  assert.match(css, /\.xeno-input-field:focus-visible,\s*\.xeno-textarea:focus-visible \{\s*outline: none;/,
    'TextInput/Textarea focus is their border brightening, not the floating outline');
  assert.match(css, /:focus-visible \{\s*outline: 2px solid rgba\(255, 255, 255, 0.5\);/,
    'the global keyboard ring must stay for fields that paint nothing of their own');
  assert.match(css, /\.focus-self:focus-visible \{\s*outline: none;/, 'the documented opt-out class stays');
});
