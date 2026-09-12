import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const publisher = join(scriptsDir, 'publish-tool-packages.mjs')

function run(...args) {
  return spawnSync(process.execPath, [publisher, ...args], {
    cwd: dirname(scriptsDir),
    encoding: 'utf8',
    timeout: 10_000,
  })
}

test('--help exits successfully before package or network work', () => {
  const result = run('--help')

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^Usage: node scripts\/publish-tool-packages\.mjs/m)
  assert.doesNotMatch(result.stdout + result.stderr, /Live registry|signature chain verified|Published/)
})

test('unknown arguments fail closed before package or network work', () => {
  const result = run('--definitely-not-a-real-option')

  assert.equal(result.status, 1)
  assert.match(result.stderr, /unknown argument: --definitely-not-a-real-option/)
  assert.doesNotMatch(result.stdout + result.stderr, /Live registry|signature chain verified|Published/)
})

test('--help does not mask an unknown argument', () => {
  const result = run('--help', '--definitely-not-a-real-option')

  assert.equal(result.status, 1)
  assert.match(result.stderr, /unknown argument: --definitely-not-a-real-option/)
  assert.doesNotMatch(result.stdout + result.stderr, /Live registry|signature chain verified|Published/)
})

test('--packages requires an explicit directory', () => {
  const result = run('--packages', '--dry-run')

  assert.equal(result.status, 1)
  assert.match(result.stderr, /--packages requires a directory value/)
  assert.doesNotMatch(result.stdout + result.stderr, /Live registry|signature chain verified|Published/)
})
