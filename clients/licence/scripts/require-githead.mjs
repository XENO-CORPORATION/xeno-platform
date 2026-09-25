#!/usr/bin/env node
/**
 * Refuse to publish @xenosystem/licence WITHOUT its source commit (`gitHead`).
 *
 * Runs first in `prepublishOnly`, so it runs on a real `npm publish` from this directory. Copied
 * from xeno-elements' `scripts/require-githead.mjs`, where the same defect was found first.
 *
 * WHY. `gitHead` is how anyone gets from an installed package back to the code that built it.
 * `@xenosystem/licence` 0.1.0 was published WITHOUT one — from a git worktree of xeno-platform —
 * and its commit is recorded only by the `licence-v0.1.0` tag. The cause, in npm's own
 * `@npmcli/package-json/lib/normalize.js`: it finds the git root, then READS `.git/HEAD` AS A FILE.
 * In a `git worktree`, `.git` is a small FILE pointing at the real git dir, so that read throws,
 * the `catch` does nothing, and the field is silently left out.
 *
 * HOW. It does not re-implement npm's lookup — a copy would drift from what npm actually does. It
 * asks npm's OWN `PackageJson.prepare()` (the call `npm publish` makes for a directory) what gitHead
 * it will publish, and compares it with `git rev-parse HEAD`. It also refuses a dirty package
 * directory: a gitHead naming a commit is only true if the published files ARE that commit.
 *
 * Override for a deliberate, recorded exception only: XENO_ALLOW_PUBLISH_WITHOUT_GITHEAD=1.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** npm's own package-json module, from the npm that is running this lifecycle script. */
export function loadNpmPackageJson(env = process.env) {
  const candidates = []
  // `npm_execpath` is set by npm for lifecycle scripts: .../npm/bin/npm-cli.js
  if (env.npm_execpath) candidates.push(join(dirname(dirname(env.npm_execpath)), 'package.json'))
  // Fallback: the npm bundled next to the running node.
  candidates.push(join(dirname(process.execPath), 'node_modules', 'npm', 'package.json'))
  for (const base of candidates) {
    try {
      return createRequire(base)('@npmcli/package-json')
    } catch {
      /* try the next */
    }
  }
  throw new Error(`could not load npm's @npmcli/package-json (looked beside: ${candidates.join(', ')})`)
}

/** Returns a list of problems; empty means npm will publish this directory with the right gitHead. */
export async function githeadProblems(pkgDir, { git = gitCli, PackageJson = loadNpmPackageJson() } = {}) {
  const problems = []
  const head = git(pkgDir, ['rev-parse', 'HEAD'])
  const dirty = git(pkgDir, ['status', '--porcelain', '--', '.'])
  if (dirty) problems.push(`the package directory has uncommitted changes, so no commit describes what would be published:\n${dirty}`)
  const { content } = await PackageJson.prepare(pkgDir)
  if (!content.gitHead) {
    problems.push(
      'npm would publish this WITHOUT a gitHead. The usual cause is publishing from a `git worktree` ' +
        '(its `.git` is a file, and npm reads `.git/HEAD` as one). Publish from a full clone.',
    )
  } else if (content.gitHead !== head) {
    problems.push(`npm would record gitHead ${content.gitHead}, but HEAD is ${head}`)
  }
  return problems
}

function gitCli(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

async function main() {
  const pkgDir = process.cwd()
  if (process.env.XENO_ALLOW_PUBLISH_WITHOUT_GITHEAD === '1') {
    console.warn('require-githead: SKIPPED by XENO_ALLOW_PUBLISH_WITHOUT_GITHEAD=1 — record why in the release notes.')
    return
  }
  const problems = await githeadProblems(pkgDir)
  if (problems.length > 0) {
    console.error(`require-githead: refusing to publish ${pkgDir}\n- ${problems.join('\n- ')}`)
    process.exit(1)
  }
  console.log(`require-githead: ok — npm will record gitHead ${gitCli(pkgDir, ['rev-parse', 'HEAD'])}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
