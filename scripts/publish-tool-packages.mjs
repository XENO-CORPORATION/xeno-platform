#!/usr/bin/env node
/**
 * publish-tool-packages — put SIGNED tool packages on R2 so Hub can load them at runtime.
 *
 * This is the distribution half of Phase 4. Everything it uploads is executed inside Hub, so it
 * differs from the installer publishers in one way that matters: it re-verifies the signature
 * chain LOCALLY before a single byte is uploaded. A publisher that will happily ship an unsigned
 * or tampered bundle makes the verifier in Hub the only thing standing between a compromised
 * bucket and every install; two independent checks is the point.
 *
 * Uploads go through R2Publisher, the one gated choke point (secret scan + immutability), for the
 * same reason every other artifact does — see xeno-platform/scripts/lib/r2-upload.mjs.
 *
 * Layout:
 *   apps/tools/<id>/<version>/{tool.json,signature.json,index.js,index.css}   immutable
 *   apps/tools/registry.json                                                  moving pointer
 *
 * Usage:
 *   node scripts/publish-tool-packages.mjs --packages ../xeno-tools/dist-packages [--dry-run]
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { R2Publisher } from './lib/r2-upload.mjs'

const R2_REMOTE = 'r2:xeno-hub-releases'

const USAGE = `Usage: node scripts/publish-tool-packages.mjs [options]

Publish signed XENO runtime packages to the Hub tools registry.

Options:
  --packages <directory>   Package directory (default: ../xeno-tools/dist-packages)
  --dry-run                Verify and preview without uploading
  --allow-new-registry     Permit creating a registry when none exists
  --allow-downgrade        Permit replacing a newer live package entry
  -h, --help               Show this help without reading packages or contacting R2`

const BOOLEAN_OPTIONS = new Set(['--dry-run', '--allow-new-registry', '--allow-downgrade'])

function validateCliArgs(argv) {
  let help = false
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--help' || token === '-h') {
      help = true
      continue
    }
    if (BOOLEAN_OPTIONS.has(token)) continue
    if (token === '--packages') {
      const value = argv[i + 1]
      if (!value || value.startsWith('-')) {
        throw new Error('--packages requires a directory value')
      }
      i += 1
      continue
    }
    throw new Error(`unknown argument: ${token}`)
  }
  return { help }
}

/**
 * The trust list MUST match xeno-hub/src/main/services/tools/toolPackageVerifier.ts. If these
 * drift, the failure is asymmetric and nasty: publish succeeds and every client refuses the
 * package. Keep them in step, and prefer appending on rotation rather than replacing.
 */
const TRUSTED_PUBLIC_KEYS = [
  'MCowBQYDK2VwAyEA79hsL6UIIV2hsss89aeQ3f8vIwFPUbP8fUWIiCCIdMY=',
]

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const next = process.argv[i + 1]
  return !next || next.startsWith('--') ? true : next
}

function fail(message) {
  console.error(`publish-tool-packages: ${message}`)
  process.exit(1)
}

/** Canonical JSON — identical to the packer and the Hub verifier. Signing is over bytes. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Re-verify the whole chain before upload. Same logic as Hub, deliberately duplicated. */
function verifyPackageDir(dir) {
  const manifestPath = join(dir, 'tool.json')
  const signaturePath = join(dir, 'signature.json')
  if (!existsSync(manifestPath)) return { ok: false, reason: 'no tool.json' }
  if (!existsSync(signaturePath)) return { ok: false, reason: 'UNSIGNED — no signature.json' }

  let manifest
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch { return { ok: false, reason: 'tool.json is not valid JSON' } }
  let signature
  try { signature = JSON.parse(readFileSync(signaturePath, 'utf8')) } catch { return { ok: false, reason: 'signature.json is not valid JSON' } }
  if (signature.algorithm !== 'ed25519') return { ok: false, reason: `unsupported algorithm: ${signature.algorithm}` }

  const message = Buffer.from(canonical(manifest), 'utf8')
  const sig = Buffer.from(String(signature.signature || ''), 'base64')
  const trusted = TRUSTED_PUBLIC_KEYS.some((k) => {
    try {
      return cryptoVerify(null, message, createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' }), sig)
    } catch { return false }
  })
  if (!trusted) return { ok: false, reason: 'signature does not verify against a trusted key' }

  const present = readdirSync(dir).filter((f) => f !== 'tool.json' && f !== 'signature.json')
  for (const entry of manifest.files || []) {
    if (!present.includes(entry.name)) return { ok: false, reason: `missing declared file: ${entry.name}` }
    const digest = createHash('sha256').update(readFileSync(join(dir, entry.name))).digest('hex')
    if (digest !== entry.sha256) return { ok: false, reason: `content mismatch: ${entry.name}` }
  }
  for (const name of present) {
    if (!(manifest.files || []).some((f) => f.name === name)) {
      return { ok: false, reason: `undeclared file in package: ${name}` }
    }
  }
  return { ok: true, manifest }
}

const REGISTRY_URL = 'https://updates.xenostudio.ai/apps/tools/registry.json'

/** Numeric semver compare: -1 / 0 / 1. Pre-release tags are compared lexically after the core. */
function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre = ''] = String(v).split('-')
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre }
  }
  const A = parse(a)
  const B = parse(b)
  for (let i = 0; i < 3; i += 1) {
    const d = (A.nums[i] ?? 0) - (B.nums[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  // A release outranks any pre-release of the same core version.
  if (!A.pre && B.pre) return 1
  if (A.pre && !B.pre) return -1
  return A.pre === B.pre ? 0 : A.pre < B.pre ? -1 : 1
}

/**
 * Read the live registry so the new pointer can be MERGED into it.
 *
 * 🔴 Fails CLOSED. If the feed cannot be read we do not know what is out there, and writing a
 * pointer built only from local packages would delete every tool we failed to see. An
 * unreachable registry is a reason to stop, not a reason to overwrite — R2 has no object
 * versioning, and `putPointer`'s pre-overwrite snapshot is a recovery path, not a licence.
 *
 * `--allow-new-registry` is the deliberate escape hatch for a genuinely empty feed.
 */
async function fetchLiveRegistry({ allowMissing = false } = {}) {
  let res
  try {
    res = await fetch(REGISTRY_URL, { cache: 'no-store' })
  } catch (error) {
    if (allowMissing) return null
    fail(
      `Could not read the live registry (${error?.message || error}).\n` +
      `  Refusing to publish: the pointer would be rebuilt from local packages only and would\n` +
      `  DELETE every tool currently in the feed. Pass --allow-new-registry only if the feed is\n` +
      `  genuinely empty.`,
    )
  }
  if (res.status === 404) {
    if (allowMissing) return null
    fail(
      `The live registry returned 404.\n` +
      `  If this is the very first publish, pass --allow-new-registry. Otherwise something is\n` +
      `  wrong with the feed and publishing now would replace it with a partial one.`,
    )
  }
  if (!res.ok) {
    if (allowMissing) return null
    fail(`The live registry returned HTTP ${res.status}. Refusing to replace a feed we cannot read.`)
  }
  try {
    const json = await res.json()
    console.log(`  Live registry: ${(json.tools || []).length} tool(s) currently published.`)
    return json
  } catch (error) {
    if (allowMissing) return null
    fail(`The live registry is not valid JSON (${error?.message || error}). Refusing to overwrite it.`)
  }
  return null
}

async function main() {
  let cli
  try {
    cli = validateCliArgs(process.argv.slice(2))
  } catch (error) {
    fail(`${error.message}\n\n${USAGE}`)
  }
  if (cli.help) {
    console.log(USAGE)
    return
  }

  const dryRun = Boolean(arg('dry-run', false))
  // Both default OFF: the safe behaviour must be the one you get by typing nothing.
  const allowNewRegistry = Boolean(arg('allow-new-registry', false))
  const allowDowngrade = Boolean(arg('allow-downgrade', false))
  const packagesDir = resolve(String(arg('packages', '../xeno-tools/dist-packages')))
  if (!existsSync(packagesDir)) fail(`no packages directory at ${packagesDir}`)

  const dirs = readdirSync(packagesDir)
    .map((d) => join(packagesDir, d))
    .filter((d) => statSync(d).isDirectory())
  if (dirs.length === 0) fail(`no packages found in ${packagesDir}`)

  console.log(`\npublish-tool-packages: ${dirs.length} package(s)${dryRun ? ' [DRY RUN]' : ''}`)
  console.log('  gates: signature chain -> secret scan -> immutability -> registry\n')

  // PHASE A — verify everything locally. Nothing is uploaded until all of it passes, so a bad
  // package in the set cannot leave a half-published registry behind.
  const verified = []
  for (const dir of dirs) {
    const result = verifyPackageDir(dir)
    if (!result.ok) fail(`REFUSED ${dir}: ${result.reason}\n  Nothing was uploaded.`)
    console.log(`  ✓ ${result.manifest.id} v${result.manifest.version} — signature chain verified`)
    verified.push({ dir, manifest: result.manifest })
  }

  const publisher = new R2Publisher({ remote: R2_REMOTE, dryRun })

  // PHASE B — upload immutable package files.
  for (const { dir, manifest } of verified) {
    const base = `apps/tools/${manifest.id}/${manifest.version}`
    for (const name of ['tool.json', 'signature.json', ...manifest.files.map((f) => f.name)]) {
      await publisher.putArtifact(join(dir, name), `${base}/${name}`, {
        // These are small text/JS assets, fully readable — a structural scan is meaningful.
        requireStructural: false,
        label: `${manifest.id}/${name}`,
      })
    }
  }

  // PHASE C — the moving pointer Hub polls.
  //
  // 🔴 MERGE, NEVER REPLACE. This pointer used to be rebuilt from `verified` alone — i.e. from
  // whatever happened to be sitting in the local dist-packages directory — so publishing ONE
  // tool silently deleted every other tool from the feed. That is not hypothetical: publishing
  // `xeno-image` on 2026-08-15 dropped `image-resize`, whose artifacts were still on R2 and
  // whose commit message recorded it as live. Hub reads the registry, so the tool simply
  // stopped existing for every user.
  //
  // Same shape as the seed-releases.mjs incident, and the same rule applies (root CLAUDE.md
  // §2b): "Merge or refuse — never silently replace."
  const publishedEntries = verified.map(({ manifest }) => ({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      icon: manifest.icon,
      version: manifest.version,
      capabilities: manifest.capabilities,
      needsRuntime: manifest.needsRuntime || [],
      // Carry the host contract and isolation into the FEED, not just the package. Hub reads the
      // feed to decide what to sync and what to show; without these a PRODUCT is indistinguishable
      // from a tool until it is already installed, so it would be offered as a tool card in the
      // Tools grid. The runtime path is unaffected (it reads the verified tool.json), which is
      // exactly why this would have been easy to miss.
      ...(manifest.contract ? { contract: manifest.contract } : {}),
      ...(manifest.isolation ? { isolation: manifest.isolation } : {}),
      path: `apps/tools/${manifest.id}/${manifest.version}`,
      files: manifest.files.map((f) => f.name),
    }))

  const existing = await fetchLiveRegistry({ allowMissing: allowNewRegistry })
  const byId = new Map((existing?.tools || []).map((t) => [t.id, t]))

  for (const entry of publishedEntries) {
    const live = byId.get(entry.id)
    // A signature proves ORIGIN, never FRESHNESS. Hub resolves highest-version-wins, so
    // republishing an older build would be fetched and correctly ignored — a silent no-op that
    // reads as "the publish did nothing". Refuse instead of shipping a confusing pointer.
    if (live && !allowDowngrade && compareVersions(entry.version, live.version) < 0) {
      fail(
        `${entry.id} ${entry.version} is OLDER than the live ${live.version}.\n` +
        `  Publishing it would be a silent no-op (Hub takes the highest version).\n` +
        `  Bump the version, or pass --allow-downgrade if you truly mean to roll back.`,
      )
    }
    byId.set(entry.id, entry)
  }

  const preserved = (existing?.tools || []).filter(
    (t) => !publishedEntries.some((e) => e.id === t.id),
  )
  if (preserved.length) {
    console.log(`\n  Preserving ${preserved.length} tool(s) already in the feed:`)
    for (const t of preserved) console.log(`    · ${t.id}@${t.version}`)
  }

  const registry = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    // Stable order so a diff of the pointer shows real changes, not reshuffling.
    tools: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  }
  await publisher.putPointer(JSON.stringify(registry, null, 2), 'apps/tools/registry.json', { label: 'tools registry' })

  console.log(`\n✓ ${dryRun ? 'DRY RUN OK' : 'Published'} ${verified.length} tool package(s).`)
  console.log('  Registry: https://updates.xenostudio.ai/apps/tools/registry.json')
  if (dryRun) console.log('  (dry-run — nothing uploaded)')
}

main().catch((error) => fail(error?.message || String(error)))
