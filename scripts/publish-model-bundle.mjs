#!/usr/bin/env node
/** Multi-file bundle publishing through the existing R2Publisher authority.
 * Dry-run default. Artifacts are content-addressed; manifest published LAST.
 * Does not modify any catalog pointer or make unsupported model claims.
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync, lstatSync, realpathSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, relative, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { R2Publisher, GateError } from './lib/r2-upload.mjs';
import { sha256Hex } from './lib/feed-integrity.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export function manifestBytes(manifest) {
  const copy = structuredClone(manifest);
  copy.files.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  copy.dependencies.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const key of ['tasks','platforms','backends']) copy[key].sort();
  copy.license.files.sort();
  return Buffer.from(JSON.stringify(canonical(copy)));
}
export function makePublication(manifest, root, origin = 'https://updates.xenostudio.ai') {
  if (manifest.schema_version !== 2 || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(manifest.id)
      || manifest.kind !== 'model' || !Array.isArray(manifest.files) || !manifest.files.length) {
    throw new GateError('only validated schema-2 MODEL bundles can be published here; native code uses the release pipeline');
  }
  const base = realpathSync(root);
  const seen = new Set();
  const copy = structuredClone(manifest);
  const artifacts = [];
  for (const file of copy.files) {
    if (typeof file.path !== 'string' || file.path.includes('\\') || file.path.includes(':')
        || file.path.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p))
        || seen.has(file.path.toLowerCase()) || file.path === 'xrt.bundle.json'
        || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size_bytes) || file.size_bytes <= 0) {
      throw new GateError('invalid, duplicate or unverifiable bundle path');
    }
    seen.add(file.path.toLowerCase());
    const path = resolve(base, ...file.path.split('/'));
    let cursor = base;
    for (const part of file.path.split('/')) {
      cursor = join(cursor, part);
      if (lstatSync(cursor).isSymbolicLink()) throw new GateError('linked artifact refused');
    }
    const real = realpathSync(path);
    const rel = relative(base, real);
    if (rel.startsWith('..') || resolve(base, rel) !== real || !statSync(real).isFile()) throw new GateError('artifact escapes bundle root');
    if (statSync(real).size !== file.size_bytes || sha256Hex(real) !== file.sha256) throw new GateError(`artifact differs from manifest: ${file.path}`);
    const key = `models/artifacts/${file.sha256}/${basename(file.path)}`;
    file.source = `${origin}/${key}`;
    artifacts.push({ path: real, key, sha256: file.sha256, size: file.size_bytes });
  }
  if (!copy.license?.spdx || !Array.isArray(copy.license.files) || !copy.license.files.length
      || copy.license.files.some(p => !copy.files.some(f => f.path === p))) throw new GateError('license files must be declared artifacts');
  for (const path of Object.values(copy.entrypoints ?? {})) {
    if (!copy.files.some(f => f.path === path)) throw new GateError('undeclared model entrypoint');
  }
  const bytes = manifestBytes(copy);
  const digest = createHash('sha256').update(bytes).digest('hex');
  return { manifest: copy, bytes, digest, manifestKey: `models/bundles/${copy.id}/${digest}/xrt.bundle.json`, artifacts };
}
async function verifyPublished(origin, artifact) {
  const response = await fetch(`${origin}/${artifact.key}`, { signal: AbortSignal.timeout(60 * 60 * 1000), redirect: 'error' });
  if (!response.ok || !response.body) throw new GateError(`published read-back failed: ${artifact.key} HTTP ${response.status}`);
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > artifact.size) throw new GateError('published artifact exceeds declared size');
    hash.update(chunk);
  }
  if (size !== artifact.size || hash.digest('hex') !== artifact.sha256) throw new GateError(`published bytes differ: ${artifact.key}`);
}
export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i=0;i<argv.length;i++) {
    if (argv[i] === '--confirm') options.confirm = true;
    else if (['--manifest','--dir'].includes(argv[i]) && argv[i+1]) options[argv[i].slice(2)] = argv[++i];
    else throw new GateError(`unknown or incomplete argument: ${argv[i]}`);
  }
  if (!options.manifest || !options.dir) throw new GateError('usage: --manifest <schema2.json> --dir <verified-installed-bundle> [--confirm]');
  const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'));
  const origin = 'https://updates.xenostudio.ai';
  const publication = makePublication(manifest, options.dir, origin);
  const publisher = new R2Publisher({ remote:'r2:xeno-hub-releases', dryRun:!options.confirm });
  console.log(JSON.stringify({ action:options.confirm?'publish':'dry-run', id:manifest.id, digest:publication.digest,
    manifestKey:publication.manifestKey, bytes:publication.artifacts.reduce((n,f)=>n+f.size,0), files:publication.artifacts.length },null,2));
  // ONNX graphs/external tensor data are raw model files, not compressed code
  // containers. Scan their full raw bytes; JSON/text notices are scanned too.
  for (const artifact of publication.artifacts) await publisher.gate(artifact.path,{requireStructural:false});
  const temp=mkdtempSync(join(tmpdir(),'xrt-bundle-publish-')); const manifestFile=join(temp,'xrt.bundle.json');
  writeFileSync(manifestFile,publication.bytes,{flag:'wx'});
  await publisher.gate(manifestFile,{requireStructural:false});
  for (const artifact of publication.artifacts) {
    await publisher.putArtifact(artifact.path,artifact.key,{requireStructural:false});
    if (options.confirm) await verifyPublished(origin,artifact);
  }
  await publisher.putArtifact(manifestFile,publication.manifestKey,{requireStructural:false});
  if (options.confirm) await verifyPublished(origin,{key:publication.manifestKey,size:publication.bytes.length,sha256:createHash('sha256').update(publication.bytes).digest('hex')});
  console.log(JSON.stringify({published:Boolean(options.confirm),bundleSpec:{kind:'bundle-v1',bundleId:manifest.id,digest:publication.digest,
    minimumRuntime:manifest.minimum_runtime,manifestKey:publication.manifestKey,sizeBytes:publication.artifacts.reduce((n,f)=>n+f.size,0),platforms:manifest.platforms}}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode=1; });
}
