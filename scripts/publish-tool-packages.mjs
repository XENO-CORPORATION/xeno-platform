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

async function main() {
  const dryRun = Boolean(arg('dry-run', false))
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
  const registry = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    tools: verified.map(({ manifest }) => ({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      category: manifest.category,
      icon: manifest.icon,
      version: manifest.version,
      capabilities: manifest.capabilities,
      needsRuntime: manifest.needsRuntime || [],
      path: `apps/tools/${manifest.id}/${manifest.version}`,
      files: manifest.files.map((f) => f.name),
    })),
  }
  await publisher.putPointer(JSON.stringify(registry, null, 2), 'apps/tools/registry.json', { label: 'tools registry' })

  console.log(`\n✓ ${dryRun ? 'DRY RUN OK' : 'Published'} ${verified.length} tool package(s).`)
  console.log('  Registry: https://updates.xenostudio.ai/apps/tools/registry.json')
  if (dryRun) console.log('  (dry-run — nothing uploaded)')
}

main().catch((error) => fail(error?.message || String(error)))
