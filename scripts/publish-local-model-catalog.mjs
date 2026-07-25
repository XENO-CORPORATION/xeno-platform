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

function runRclone(args) {
  const result = spawnSync('rclone', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `rclone exited with code ${result.status ?? 'unknown'}`);
  }
  return result.stdout.trim();
}

async function main() {
  const upload = process.argv.includes('--upload');
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
      const remoteTarget = `${remotePrefix}/${model.installSpec.artifactKey}`;
      console.log(`Uploading ${model.id} -> ${remoteTarget}`);
      runRclone(['copyto', localFile, remoteTarget, '--progress']);
    } else {
      console.log(`Prepared ${model.id}: ${localFile}`);
    }
  }

  writeCatalog(catalog);

  const manifestRemote = `${remotePrefix}/models/local-model-catalog.json`;
  if (upload) {
    console.log(`Uploading catalog -> ${manifestRemote}`);
    runRclone(['copyto', catalogPath, manifestRemote]);
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
