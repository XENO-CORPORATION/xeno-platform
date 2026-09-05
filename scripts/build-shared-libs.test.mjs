import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('platform delegates shared-library builds to the canonical sibling repository', () => {
  const source = readFileSync(new URL('./build-shared-libs.mjs', import.meta.url), 'utf8');
  assert.match(source, /'xeno-lib', 'Cargo\.toml'/);
  assert.match(source, /'xeno-lib', 'xeno-edit', 'Cargo\.toml'/);
  assert.match(source, /build\(libraryManifest\)/);
  assert.match(source, /build\(editManifest\)/);
  assert.match(source, /'--manifest-path', manifest/);
  assert.doesNotMatch(source, /shell:\s*true|exec\(|process\.env/);
});
