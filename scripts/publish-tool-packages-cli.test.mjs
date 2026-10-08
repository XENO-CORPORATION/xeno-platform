import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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

test('the publisher imports the one SemVer comparator and does not define its own', () => {
  /* A second copy is how the publisher came to rank 0.1.0-rc.10 below rc.9 and accept
   * rc.9 over a live rc.10. The downgrade guard must call the shared comparator, and
   * nothing in this file may redefine it. */
  const source = readFileSync(publisher, 'utf8')
  assert.doesNotMatch(source, /^function compareVersions\b/m, 'the publisher defines its own comparator again')
  assert.match(source, /^import \{ compareVersions \} from '\.\.\/src\/server\/utils\/semverPrecedence\.js'/m)
  assert.match(source, /compareVersions\(entry\.version, live\.version\) < 0/,
    'the downgrade guard no longer calls the comparator')
})

test('publishing 0.1.0-rc.9 over a live 0.1.0-rc.10 is refused as older', async () => {
  /* The guard refuses when compareVersions(candidate, live) < 0. The whole CLI path cannot
   * run in a test: every package must first verify against the shipped Ed25519 trust list,
   * and no test key may be added to that list to pass a gate. So the guard's predicate is
   * asserted here, and the source test above pins that the guard calls exactly it. */
  const { compareVersions } = await import('../src/server/utils/semverPrecedence.js')
  assert.ok(compareVersions('0.1.0-rc.9', '0.1.0-rc.10') < 0, 'rc.9 must read as OLDER than the live rc.10')
  assert.ok(compareVersions('0.1.0-rc.10', '0.1.0-rc.9') > 0, 'rc.10 must not read as older than rc.9')
})
