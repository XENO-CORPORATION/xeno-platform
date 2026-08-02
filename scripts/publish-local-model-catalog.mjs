import { createHash } from 'crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { updatesOrigin } from '../src/server/config/hosts.js';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const catalogPath = path.join(repoRoot, 'src', 'server', 'data', 'localModelCatalog.json');
const bucket = process.env.R2_BUCKET || 'xeno-hub-releases';
const remotePrefix = `r2:${bucket}`;
const publicBase = process.env.R2_PUBLIC_URL || updatesOrigin();
const defaultRoots = [
  path.join(os.homedir(), '.cache', 'xrt', 'models'),
  path.join(os.homedir(), '.xeno', 'models'),
];

function readCatalog() {
  return JSON.parse(readFileSync(catalogPath, 'utf-8'));
}

function writeCatalog(catalog) {
  catalog.updatedAt = new Date().toISOString();
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf-8');
}

function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findLocalFile(filename, expectedLocalIds) {
  const expected = expectedLocalIds.map((value) => normalize(value));
  for (const root of defaultRoots) {
    if (!existsSync(root)) continue;
    const found = spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      `Get-ChildItem -Path '${root.replace(/'/g, "''")}' -Recurse -Filter '${filename.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName`
    ], { encoding: 'utf-8' });
    const exact = found.stdout.trim();
    if (exact) return exact;

    const loose = spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      `Get-ChildItem -Path '${root.replace(/'/g, "''")}' -Recurse -Filter *.gguf -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName`
    ], { encoding: 'utf-8' });
    for (const candidate of loose.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
      const stem = path.basename(candidate, path.extname(candidate));
      const key = normalize(stem);
      if (expected.some((entry) => entry === key || entry.includes(key) || key.includes(entry))) {
        return candidate;
      }
    }
  }
  return null;
}

async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Deliberately refuses. Kept as a throwing stub rather than deleted.
 *
 * This script used to invoke rclone itself, straight past the gated choke point in
 * `scripts/lib/r2-upload.mjs` — whose entire purpose is that no code path uploads
 * unscanned. It wrote `models/local-model-catalog.json` with `rclone copyto`: a MOVING
 * POINTER, replaced wholesale, with no secret scan, no snapshot of what it destroyed and
 * no clobber check. R2 has no object versioning, so that write had no undo. It is the
 * shape of the 2026-07-26 incident (CLAUDE.md rule 2b) re-armed on a different file.
 *
 * A deletion would invite the next author to write a fresh invoker. This names the rule
 * at the exact spot someone reaches for one.
 */
function runRclone() {
  throw new Error(
    'publish-local-model-catalog: direct rclone is refused. Every write to R2 goes through ' +
      'R2Publisher (scripts/lib/r2-upload.mjs), which scans the payload, snapshots the pointer ' +
      'it is about to replace, and refuses to clobber. See CLAUDE.md rule 2b.',
  );
}

async function main() {
  const upload = process.argv.includes('--upload');
  // Dry-run by DEFAULT, matching every other publisher here: `--upload` says where,
  // `--confirm` says do it. A publish script whose default is to publish is exactly the
  // loaded gun rule 2b describes.
  const dryRun = !process.argv.includes('--confirm');
  const r2 = new R2Publisher({ remote: remotePrefix, dryRun });
  const modelIds = process.argv.filter((arg) => arg.startsWith('--model=')).map((arg) => arg.slice('--model='.length));
  const catalog = readCatalog();
  const selected = catalog.models.filter((model) => {
    if (!model.installable || !model.installSpec?.artifactKey || !model.installSpec?.filename) return false;
    return modelIds.length === 0 || modelIds.includes(model.id);
  });

  if (selected.length === 0) {
    console.log('No installable models selected.');
    return;
  }

  for (const model of selected) {
    const localFile = findLocalFile(model.installSpec.filename, model.installSpec.expectedLocalIds || []);
    if (!localFile) {
      console.warn(`Skipping ${model.id}: local file not found for ${model.installSpec.filename}`);
      continue;
    }

    const sizeBytes = Number(spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      `(Get-Item '${localFile.replace(/'/g, "''")}').Length`
    ], { encoding: 'utf-8' }).stdout.trim());

    const sha256 = await sha256File(localFile);
    model.sizeBytes = sizeBytes;
    model.installSpec.sizeBytes = sizeBytes;
    model.installSpec.sha256 = sha256;

    if (upload) {
      // Scanned, clobber-checked and dry-run-aware, because it goes through the gate.
      await r2.putArtifact(localFile, model.installSpec.artifactKey, { label: model.id });
    } else {
      console.log(`Prepared ${model.id}: ${localFile}`);
    }
  }

  writeCatalog(catalog);

  const manifestRemote = `${publicBase}/models/local-model-catalog.json`;
  if (upload) {
    // A POINTER: one fixed key, replaced wholesale on every publish, on a store with no
    // object versioning. `putPointer` snapshots the object it is about to overwrite —
    // which is the only reason this write has an undo.
    await r2.putPointer(readFileSync(catalogPath, 'utf-8'), 'models/local-model-catalog.json', {
      label: 'local-model-catalog.json',
    });
  }

  const summary = {
    catalogVersion: catalog.catalogVersion,
    updatedAt: catalog.updatedAt,
    publicCatalogUrl: `${publicBase}/models/local-model-catalog.json`,
    uploadedModels: selected.map((model) => ({
      id: model.id,
      artifactKey: model.installSpec?.artifactKey ?? null,
      sha256: model.installSpec?.sha256 ?? null,
      sizeBytes: model.installSpec?.sizeBytes ?? null,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

await main();
