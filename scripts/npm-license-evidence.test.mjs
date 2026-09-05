import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { resolveManifestLicense } from './refresh-npm-license-evidence.mjs';
import { sha256, verifyIntegrity, readPackageArchive, lockedPackageEvidence, declaredManifestLicense } from './lib/npm-package-evidence.mjs';
import { upstreamNotices, githubRepository } from './lib/npm-upstream-notices.mjs';
import { bundledNoticeTexts } from './collect-third-party-notices.mjs';
import { recordedFirstPartyPackage } from './lib/first-party-package-evidence.mjs';
import { copyrightLicenseHeaders } from './lib/package-license-headers.mjs';
import { referencedPackageLicense } from './lib/referenced-package-licenses.mjs';

const require = createRequire(new URL('../src/server/package.json', import.meta.url));
const { pack } = require('tar-stream');
const sri = (bytes, algorithm = 'sha512') => `${algorithm}-${createHash(algorithm).update(bytes).digest('base64')}`;
const file = (name, text) => ({ path: name, text, sha256: sha256(text) });

test('manifest license normalization supports historical shapes without choosing an ambiguous grant', () => {
  assert.equal(declaredManifestLicense({ license: ' MIT ' }), 'MIT');
  assert.equal(declaredManifestLicense({ license: { type: 'MIT' } }), 'MIT');
  assert.equal(declaredManifestLicense({ licenses: [{ type: 'MIT', url: 'https://example.test/license' }] }), 'MIT');
  assert.equal(declaredManifestLicense({ licenses: ['MIT', 'GPL-3.0-only'] }), undefined);
  assert.equal(declaredManifestLicense({ license: { type: {} } }), undefined);
});

test('source-header evidence is lexical, byte-bound and never copies executable bodies', async () => {
  const header = '// Copyright (c) Microsoft Corporation.\n// Licensed under the MIT License.\n';
  const source = header + 'const privateImplementation = 123;';
  assert.deepEqual(copyrightLicenseHeaders(source), [header]);
  assert.deepEqual(copyrightLicenseHeaders(`const example = ${JSON.stringify(header)};`), []);
  const bytes = await archive([
    [{ name: 'package/package.json' }, '{"name":"example","version":"1.0.0"}'],
    [{ name: 'package/lib/a.js' }, source],
    [{ name: 'package/lib/quoted.js' }, `const example = ${JSON.stringify(header)};`],
    [{ name: '../outside.js' }, source],
    [{ name: 'package/link.js', type: 'symlink', linkname: '/outside' }, ''],
  ]);
  assert.equal((await readPackageArchive(bytes)).licenseHeaders.length, 0);
  const result = await readPackageArchive(bytes, { includeLicenseHeaders: true });
  assert.equal(result.licenseHeaders.length, 1);
  assert.equal(result.licenseHeaders[0].sourceSha256, sha256(source));
  assert.equal(result.licenseHeaders[0].text, header);
  assert.doesNotMatch(JSON.stringify(result), /privateImplementation/);
});

test('referenced license texts require original headers, exact package pins and unchanged text', async () => {
  const evidence = JSON.parse(await readFile(new URL('../compliance/referenced-package-licenses.json', import.meta.url), 'utf8'));
  assert.equal(evidence.packages.length, 5);
  assert.equal(new Set(evidence.packages.map(p => p.name)).size, 5);
  for (const record of evidence.packages) {
    const text = record.name === 'format' ? '// Copyright 2010 - 2013 Sami Samhuri\n// MIT License\n// http://sjs.mit-license.org\n' : record.license === 'MIT'
      ? '// Copyright (c) Microsoft Corporation.\n// Licensed under the MIT License.\n'
      : '/** Copyright 2020 Google LLC.\nLicensed under the Apache License, Version 2.0\nhttp://www.apache.org/licenses/LICENSE-2.0\n*/';
    const header = { path: 'package/a.js#license-header-1', sourcePath: 'package/a.js', sourceSha256: 'a'.repeat(64), sha256: sha256(text), text };
    const manifest = { name: record.name, version: record.version, license: record.license };
    const headers = [header];
    if (record.observedSourceLicenses?.length === 2) {
      const apache = '/** Copyright 2021 Google LLC.\nLicensed under the Apache License, Version 2.0\nhttp://www.apache.org/licenses/LICENSE-2.0\n*/';
      headers.push({ ...header, path: 'package/vendor.js#license-header-1', sourcePath: 'package/vendor.js', text: apache, sha256: sha256(apache) });
      assert.throws(() => referencedPackageLicense(record.name, record, manifest, [header], evidence), /Known source license headers/);
    }
    const result = referencedPackageLicense(record.name, record, manifest, headers, evidence);
    assert.equal(result.files.length, headers.length * 2);
    assert.equal(result.files[0].text, text);
    assert.equal(result.files[1].sha256, sha256(result.files[1].text));
    assert.throws(() => referencedPackageLicense(record.name, record, manifest, [], evidence), /No original/);
    assert.throws(() => referencedPackageLicense(record.name, { ...record, integrity: 'changed' }, manifest, [header], evidence), /does not match/);
    assert.throws(() => referencedPackageLicense(record.name, record, manifest, [{ ...header, text: 'changed' }], evidence), /Invalid source/);
    const conflict = '/* Copyright owner. Licensed under the GPL License. */';
    assert.throws(() => referencedPackageLicense(record.name, record, manifest, [{ ...header, text: conflict, sha256: sha256(conflict) }], evidence), /Conflicting/);
    const changed = structuredClone(evidence);
    changed.texts[record.name === 'format' ? 'format' : record.license === 'MIT' ? 'onnx' : 'apache'].text += 'changed';
    assert.throws(() => referencedPackageLicense(record.name, record, manifest, headers, changed), /hash mismatch/);
  }
});

test('legacy XENO SDK identity is bound to the verified archive, not its familiar name', async () => {
  const registry = JSON.parse(await readFile(new URL('../compliance/first-party-packages.json', import.meta.url), 'utf8'));
  assert.equal(registry.entries.length, 1);
  const record = registry.entries[0];
  const item = { version: record.version, resolved: record.resolved, integrity: record.integrity };
  const manifest = { name: record.name, version: record.version, repository: 'https://github.com/XENO-CORPORATION/xeno-js', license: 'MIT' };
  assert.equal(recordedFirstPartyPackage(record.name, item, manifest).sourceCommit, record.sourceCommit);
  assert.equal(recordedFirstPartyPackage('unrelated', item, manifest), undefined);
  for (const field of ['version', 'resolved', 'integrity']) {
    assert.throws(() => recordedFirstPartyPackage(record.name, { ...item, [field]: 'changed' }, manifest), /no longer matches/);
  }
  for (const field of ['name', 'version', 'repository', 'license']) {
    assert.throws(() => recordedFirstPartyPackage(record.name, item, { ...manifest, [field]: 'changed' }), /no longer matches/);
  }
  assert.throws(() => recordedFirstPartyPackage(record.name, item, manifest, [record, record]), /Ambiguous/);
  for (const field of ['sourceCommit', 'sourceManifestGitBlob', 'sourceManifestSha256']) {
    assert.throws(() => recordedFirstPartyPackage(record.name, item, manifest, [{ ...record, [field]: 'main' }]), /no longer matches/);
  }
  assert.match(registry.scope, /not license exceptions or contributor-rights signoff/);
});
async function archive(entries) {
  const stream = pack();
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(gzipSync(Buffer.concat(chunks))));
    stream.on('error', reject);
  });
  for (const [header, body] of entries) stream.entry(header, body);
  stream.finalize();
  return done;
}

test('restored declarations are bound to both lockfiles and retained source text', async () => {
  const evidence = JSON.parse(await readFile(new URL('../compliance/npm-license-evidence.json', import.meta.url), 'utf8'));
  assert.equal(evidence.schemaVersion, 2);
  assert.ok(evidence.entries.length > 0);
  const locks = new Map();
  for (const name of ['package-lock.json', 'src/server/package-lock.json']) {
    const lock = JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
    locks.set(name, lock);
    const unresolved = Object.entries(lock.packages).filter(([packagePath, item]) =>
      packagePath && (!item.license || /^(?:BSD|NOASSERTION|NONE|UNKNOWN)$/i.test(item.license)));
    assert.deepEqual(unresolved, [], `${name}: unresolved metadata`);
    assert.ok(evidence.entries.some((entry) => entry.lockfile === name));
  }
  const keys = new Set();
  for (const entry of evidence.entries) {
    const key = `${entry.lockfile}:${entry.path}`;
    assert.ok(!keys.has(key), `duplicate evidence: ${key}`);
    keys.add(key);
    const item = locks.get(entry.lockfile)?.packages[entry.path];
    assert.ok(item, key);
    for (const field of ['version', 'license', 'resolved', 'integrity']) assert.equal(item[field], entry[field], `${key}: ${field} drift`);
    const manifest = JSON.parse(entry.files.find((source) => source.path.endsWith('/package.json')).text);
    assert.equal(manifest.name, entry.name);
    assert.equal(manifest.version, entry.version);
    assert.equal(item.name ?? entry.path.split('node_modules/').at(-1), entry.name);
    assert.deepEqual(resolveManifestLicense(manifest, entry.files), {
      expression: entry.license, source: entry.source, resolution: entry.resolution,
    });
  }
});

test('integrity rejects corruption and cannot downgrade to a weaker matching hash', () => {
  const bytes = Buffer.from('locked archive');
  verifyIntegrity(bytes, sri(bytes));
  assert.throws(() => verifyIntegrity(Buffer.from('changed'), sri(bytes)), /integrity mismatch/);
  assert.throws(() => verifyIntegrity(bytes, ''), /Missing supported/);
  assert.throws(() => verifyIntegrity(bytes, `${sri(Buffer.from('other'))} ${sri(bytes, 'sha256')}`), /integrity mismatch/);
});

test('license resolution refuses unknown metadata and forged source hashes', () => {
  const manifest = { name: 'example', version: '1', license: 'MIT' };
  const source = file('package/package.json', JSON.stringify(manifest));
  assert.equal(resolveManifestLicense(manifest, [source]).expression, 'MIT');
  assert.throws(() => resolveManifestLicense(manifest, [{ ...source, text: 'tampered' }]), /hash mismatch/);
  assert.throws(() => resolveManifestLicense({ ...manifest, license: 'BSD' }, [source]), /no reviewed exact/);
  assert.throws(() => resolveManifestLicense({ ...manifest, license: undefined }, [source]), /no reviewed exact/);
  assert.throws(() => resolveManifestLicense({ ...manifest, license: 'UNKNOWN' }, [source]), /no informative/);
});

test('archive reader ignores traversal and symlinks and rejects duplicate manifests', async () => {
  const manifest = JSON.stringify({ name: 'example', version: '1', license: 'MIT' });
  const bytes = await archive([
    [{ name: 'package/package.json' }, manifest], [{ name: 'package/LICENSE' }, 'actual text'],
    [{ name: '../LICENSE' }, 'unsafe'], [{ name: 'package/NOTICE', type: 'symlink', linkname: '/outside' }, ''],
  ]);
  assert.deepEqual((await readPackageArchive(bytes)).files.map((source) => source.path), ['package/package.json', 'package/LICENSE']);
  const duplicate = await archive([[{ name: 'package/package.json' }, manifest], [{ name: 'other/package.json' }, manifest]]);
  await assert.rejects(readPackageArchive(duplicate), /one package-root manifest/);
});

test('cached artifacts are reverified and identities and origins are pinned', async () => {
  const cache = await mkdtemp(path.join(tmpdir(), 'xeno-license-test-'));
  let cacheFile;
  try {
    const bytes = await archive([[{ name: 'package/package.json' }, JSON.stringify({ name: 'example', version: '1.0.0' })]]);
    const item = { version: '1.0.0', integrity: sri(bytes), resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz' };
    cacheFile = path.join(cache, `${sha256(item.integrity)}.tgz`);
    await writeFile(cacheFile, bytes);
    assert.equal((await lockedPackageEvidence(item, 'example', cache)).manifest.name, 'example');
    await assert.rejects(lockedPackageEvidence(item, 'other', cache), /identity/);
    await assert.rejects(lockedPackageEvidence({ ...item, resolved: 'https://example.org/package.tgz' }, 'example', cache), /Unapproved registry/);
    await writeFile(cacheFile, Buffer.from('corrupt'));
    await assert.rejects(lockedPackageEvidence(item, 'example', cache), /integrity mismatch/);
  } finally {
    if (cacheFile) await rm(cacheFile, { force: true });
    await rmdir(cache);
  }
});

test('nested distribution notices are retained without accepting nested identities or traversal', async () => {
  const manifest = JSON.stringify({ name: 'example', version: '1.0.0' });
  const bytes = await archive([
    [{ name: 'package/package.json' }, manifest],
    [{ name: 'package/dist/LICENSE.txt' }, 'Nested vendor license'],
    [{ name: 'package/vendor/NOTICE' }, 'Vendor attribution'],
    [{ name: 'package/vendor/package.json' }, '{"name":"not-the-root"}'],
    [{ name: 'package/../LICENSE' }, 'Traversal'],
    [{ name: '/outside/LICENSE' }, 'Absolute path'],
  ]);
  const result = await readPackageArchive(bytes);
  assert.equal(result.manifest.name, 'example');
  assert.deepEqual(result.files.map(f => f.path), ['package/package.json', 'package/dist/LICENSE.txt', 'package/vendor/NOTICE']);
});

test('upstream text must be bound to the same published artifact and immutable repository commit', async () => {
  const manifest = { name: 'example', version: '1.0.0', repository: { url: 'https://github.com/example/project' } };
  const item = { integrity: sri(Buffer.from('archive')), resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz' };
  const metadata = { ...manifest, gitHead: 'a'.repeat(40), dist: { integrity: item.integrity, tarball: item.resolved } };
  const requested = [];
  const readText = async (url) => {
    requested.push(url);
    if (url.startsWith('https://registry.npmjs.org/')) return JSON.stringify(metadata);
    return url.endsWith('/LICENSE') ? 'Exact upstream license text' : null;
  };
  const result = await upstreamNotices(item, manifest, { readText, cache: new Map() });
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].sha256, sha256('Exact upstream license text'));
  assert.ok(requested.filter((url) => url.includes('raw.githubusercontent.com')).every((url) => url.includes(`/${metadata.gitHead}/`)));
  metadata.gitHead = 'main';
  await assert.rejects(upstreamNotices(item, manifest, { readText, cache: new Map() }), /immutable/);
  metadata.gitHead = 'a'.repeat(40);
  metadata.dist.integrity = sri(Buffer.from('different'));
  await assert.rejects(upstreamNotices(item, manifest, { readText, cache: new Map() }), /locked artifact/);
});

test('notice collection preserves embedded grants but never accepts a license badge as text', () => {
  const badge = file('package/README.md', 'Licensed under [MIT](https://example.org/LICENSE)');
  assert.deepEqual(bundledNoticeTexts([badge]), []);
  const grant = file('package/README.md', 'Copyright owner\nPermission is hereby granted\nThe copyright notice and this permission notice\nTHE SOFTWARE IS PROVIDED');
  assert.deepEqual(bundledNoticeTexts([grant]), [grant]);
  const license = file('package/LICENSE.md', 'exact license');
  assert.deepEqual(bundledNoticeTexts([badge, license]), [license]);
  const notice = file('package/NOTICE', 'Additional third-party attribution');
  assert.deepEqual(bundledNoticeTexts([notice, grant, badge]), [notice, grant]);
  assert.deepEqual(bundledNoticeTexts([license, grant]), [license, grant]);
});

test('npm repository spellings normalize identity without changing the retrieval origin', () => {
  for (const value of ['Example/project', 'github:Example/project', 'git://github.com/Example/project.git',
    'git+ssh://git@github.com/Example/project.git', 'git@github.com:Example/project.git',
    'https://github.com/Example/project/tree/main/packages/part', 'git+https://github.com/Example/project.git#main']) {
    assert.equal(githubRepository(value), 'example/project');
  }
  for (const value of ['https://github.com.evil.test/example/project', 'https://evil.test/example/project',
    'https://user:secret@github.com/example/project', 'file:///example/project']) assert.equal(githubRepository(value), undefined);
});
