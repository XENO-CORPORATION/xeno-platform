import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lockedPackageEvidence, sha256, declaredManifestLicense } from './lib/npm-package-evidence.mjs';

// Exact license texts inspected in integrity-verified registry artifacts.
// Unknown or changed BSD variants must remain unresolved.
const reviewedTexts = new Map([
  ['6663bbd049205d38a496ccacb412a151980b444627d38de218b3b809aef330f1', 'BSD-2-Clause'],
  ['70723b90e3f26aa2808616e846cd8cd349fe33864fd328a91a5bb9d33e58e9d9', 'BSD-3-Clause'],
  ['66b333b0f66759a0b710459e03f7029abe17f4358114a128d2c972e642961b49', 'MIT'],
]);

export function resolveManifestLicense(manifest, files) {
  for (const file of files) {
    if (sha256(file.text) !== file.sha256) throw new Error(`Evidence text hash mismatch: ${file.path}`);
  }
  const expression = declaredManifestLicense(manifest);
  if (!expression || expression === 'BSD') {
    const text = files.find((file) => reviewedTexts.has(file.sha256));
    if (!text) throw new Error(`${manifest.name}@${manifest.version}: missing or ambiguous metadata has no reviewed exact license text`);
    return { expression: reviewedTexts.get(text.sha256), source: text.path, resolution: 'reviewed-exact-text' };
  }
  if (/^(?:NOASSERTION|NONE|UNLICENSED|UNKNOWN)$/i.test(expression)) {
    throw new Error(`${manifest.name}@${manifest.version}: no informative license declaration`);
  }
  return { expression, source: files.find((file) => file.path.endsWith('/package.json')).path, resolution: 'package-manifest' };
}

export async function refresh(root) {
  const evidencePath = path.join(root, 'compliance/npm-license-evidence.json');
  let previous = [];
  try { previous = JSON.parse(await readFile(evidencePath, 'utf8')).entries ?? []; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const previousPaths = new Set(previous.map((item) => `${item.lockfile ?? 'package-lock.json'}:${item.path}`));
  const locks = await Promise.all(['package-lock.json', 'src/server/package-lock.json'].map(async (file) => ({
    file, data: JSON.parse(await readFile(path.join(root, file), 'utf8')),
  })));
  const tasks = locks.flatMap((lock) => Object.entries(lock.data.packages).filter(([packagePath, item]) =>
    packagePath && (!item.license || item.license === 'BSD' || previousPaths.has(`${lock.file}:${packagePath}`))
  ).map(([packagePath, item]) => ({ lock, packagePath, item })));
  const entries = [];
  const failures = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < tasks.length) {
      const { lock, packagePath, item } = tasks[cursor++];
      const name = item.name ?? packagePath.split('node_modules/').at(-1);
      try {
        const pack = await lockedPackageEvidence(item, name, path.join(root, '.compliance/npm-tarballs'));
        const license = resolveManifestLicense(pack.manifest, pack.files);
        item.license = license.expression;
        entries.push({ lockfile: lock.file, path: packagePath, name, version: item.version,
          license: license.expression, source: license.source, resolution: license.resolution,
          resolved: item.resolved, integrity: item.integrity,
          // Retain the actual declaration and manifest, not unrelated package
          // tutorials. Complete notice texts are collected separately.
          files: pack.files.filter((file) => file.path === license.source || file.path.endsWith('/package.json')) });
      } catch (error) { failures.push(`${lock.file}:${packagePath}: ${error.message}`); }
    }
  }));
  if (failures.length) throw new Error(`License evidence unresolved; no lockfile written:\n${failures.join('\n')}`);
  entries.sort((a, b) => `${a.lockfile}:${a.path}`.localeCompare(`${b.lockfile}:${b.path}`));
  await mkdir(path.dirname(evidencePath), { recursive: true });
  for (const lock of locks) await writeFile(path.join(root, lock.file), `${JSON.stringify(lock.data, null, 2)}\n`);
  await writeFile(evidencePath, `${JSON.stringify({ schemaVersion: 2,
    purpose: 'License declarations read from registry archives verified against the lockfile integrity, with source text retained.', entries }, null, 2)}\n`);
  console.log(`Verified and recorded ${entries.length} registry package license records across ${locks.length} lockfiles.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await refresh(process.cwd());
}
