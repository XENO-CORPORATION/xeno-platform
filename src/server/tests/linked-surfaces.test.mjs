import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLinkedSurfaces } from '../utils/linkedSurfaces.js';

test('normalizes historical kebab-case product links to canonical surface ids', () => {
  assert.deepEqual(
    normalizeLinkedSurfaces([
      { source_system: 'xeno-canvas' },
      { source_system: 'xeno-mail' },
      { source_system: 'xeno_api_portal' },
      { source_system: 'xeno_post' },
    ]),
    ['xeno_canvas', 'xeno_mail', 'xeno_api_portal', 'xeno_post'],
  );
});

test('excludes identity providers, invalid values, and duplicate surfaces', () => {
  assert.deepEqual(
    normalizeLinkedSurfaces([
      { source_system: 'google' },
      { source_system: 'email_password' },
      { source_system: ' XENO-MAIL ' },
      { source_system: 'xeno_mail' },
      { source_system: null },
      {},
    ]),
    ['xeno_mail'],
  );
});
