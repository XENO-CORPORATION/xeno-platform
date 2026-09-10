import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lockedPackageEvidence, sha256 } from './lib/npm-package-evidence.mjs';
import { upstreamNotices } from './lib/npm-upstream-notices.mjs';
import { recordedFirstPartyPackage } from './lib/first-party-package-evidence.mjs';
import { hasReferencedLicense, referencedPackageLicense } from './lib/referenced-package-licenses.mjs';
import { recoveredLicense } from './lib/recovered-package-licenses.mjs';
import { declaredOnlyLicense } from './lib/declared-package-licenses.mjs';

export function bundledNoticeTexts(files) {
  const named = files.filter((file) => /\/(?:licen[cs]e|copying|notice|copyright)(?:[._-].*)?$/i.test(file.path));
  // Some older packages ship the complete grant only inside their README.
  // Preserve the whole file unchanged; do not synthesize a copyright holder or
  // treat a badge/link saying "MIT" as the actual notice.
  const embedded = files.filter((file) => /\/readme(?:\.[^/]+)?$/i.test(file.path) &&
    /copyright/i.test(file.text) && /permission is hereby granted/i.test(file.text) &&
    /copyright notice and this permission notice/i.test(file.text) && /software is provided/i.test(file.text));
  // NOTICE can contain attribution without the grant, and LICENSE may cover a
  // different bundled component. Neither makes an embedded grant redundant.
  return [...named, ...embedded];
}

// This is a conservative inventory, not a legal clearance: include all locked
// non-dev packages, including optional platforms, across web and backend.
export async function collectNotices(root) {
  const packages = new Map();
  const lockfiles = [];
  for (const lockfile of ['package-lock.json', 'src/server/package-lock.json']) {
    const source = await readFile(path.join(root, lockfile), 'utf8');
    lockfiles.push({ path: lockfile, sha256: sha256(source) });
    for (const [packagePath, item] of Object.entries(JSON.parse(source).packages)) {
      if (!packagePath || item.dev) continue;
      const name = item.name ?? packagePath.split('node_modules/').at(-1);
      const key = `${name}@${item.version}:${item.integrity}`;
      if (!packages.has(key)) packages.set(key, { name, item, locations: [] });
      packages.get(key).locations.push({ lockfile, path: packagePath });
    }
  }
  const tasks = [...packages.values()].sort((a, b) => `${a.name}@${a.item.version}`.localeCompare(`${b.name}@${b.item.version}`));
  const records = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < tasks.length) {
      const { name, item, locations } = tasks[cursor++];
      const record = { name, version: item.version, license: item.license, resolved: item.resolved,
        integrity: item.integrity, locations };
      if (name.startsWith('@xenosystem/')) {
        // First-party ownership is declared separately to the audit, not inferred
        // from UNLICENSED. Keep the omission visible in the report.
        records.push({ ...record, status: 'first-party-scope', files: [] });
        continue;
      }
      try {
        const pack = await lockedPackageEvidence(item, name, path.join(root, '.compliance/npm-tarballs'));
        const firstParty = recordedFirstPartyPackage(name, item, pack.manifest);
        if (firstParty) {
          records.push({ ...record, status: 'first-party-scope', files: [],
            identityEvidence: firstParty, ownershipReview: 'Separate contributor-rights confirmation remains required.' });
          continue;
        }
        let files = bundledNoticeTexts(pack.files);
        if (!files.length) {
          const recovered = recoveredLicense(name, item, pack.manifest);
          if (recovered) {
            files = recovered.files;
            record.recoveredSource = recovered.provenance;
            if (recovered.unresolvedComponents) record.unresolvedComponents = recovered.unresolvedComponents;
          }
        }
        if (!files.length && hasReferencedLicense(name)) {
          const detailed = await lockedPackageEvidence(item, name, path.join(root, '.compliance/npm-tarballs'), { includeLicenseHeaders: true });
          const referenced = referencedPackageLicense(name, item, detailed.manifest, detailed.licenseHeaders);
          files = referenced.files;
          files.push(...pack.files.filter(file => /\/readme(?:\.[^/]+)?$/i.test(file.path) && /copyright/i.test(file.text)));
          record.referencedLicense = referenced.provenance;
        }
        if (!files.length) {
          try {
            const upstream = await upstreamNotices(item, pack.manifest);
            files = upstream.files;
            record.upstream = upstream.provenance;
          } catch (error) { record.upstreamError = error.message; }
        }
        /* LAST, and deliberately so. Some publishers name a licence and never
         * write the text down, so no amount of searching finds a document that
         * was never authored. Recording that honestly beats leaving a hole,
         * which reads as an oversight rather than as a finding — but only ever
         * after the three stronger routes above have produced nothing. */
        if (!files.length) {
          const declared = declaredOnlyLicense(name, item, pack.manifest, pack.files);
          if (declared) { files = declared.files; record.declaredOnly = declared.provenance; }
        }
        records.push({ ...record, status: files.length ? 'text-collected' : 'missing-license-text', files,
          ...(files.length ? {} : { availableEvidence: pack.files.map(({ path, sha256 }) => ({ path, sha256 })) }) });
      } catch (error) {
        records.push({ ...record, status: 'unresolved', error: error.message, files: [] });
      }
      if (records.length % 50 === 0) console.log(`Collected ${records.length}/${tasks.length} package records`);
    }
  }));
  records.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  const missing = records.filter((record) => ['missing-license-text', 'unresolved'].includes(record.status));
  const output = path.join(root, '.compliance/notices');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'sources.json'), `${JSON.stringify({ schemaVersion: 1, lockfiles,
    coverage: 'All non-dev entries in both lockfiles; optional platforms included. Not an artifact reachability proof.',
    status: missing.length ? 'incomplete' : 'texts-collected-review-required', records }, null, 2)}\n`);
  const lines = ['# Third-party notices — review candidate', '',
    'Generated from integrity-verified npm archives. Not yet approved for distribution.',
    `Unresolved package texts: ${missing.length}. Copyleft and non-npm obligations require separate review.`, ''];
  for (const record of records.filter((record) => record.status !== 'first-party-scope')) {
    lines.push(`## ${record.name}@${record.version}`, '', `Declared license: ${record.license}`, '', `Source: ${record.resolved}`, '');
    /* A declaration-only entry looks identical to a publisher-supplied one once
     * its text is on the page, and that confusion is the single thing this
     * evidence store exists to prevent. Say so HERE, where a reader of the
     * notices file will see it — not only in the JSON nobody opens. */
    /* A component under other terms is the finding, not a footnote. It surfaces
     * here because the alternative — rejecting the whole record — hid a proven
     * grant AND the component both, which is how this one went unnoticed. */
    if (record.unresolvedComponents) {
      lines.push('> **This package embeds material that its own license does not cover.**', '>');
      for (const component of record.unresolvedComponents) {
        lines.push(`> - \`${component.path}\` — ${component.status}`, ...(component.note ? [`>   ${component.note}`] : []));
      }
      lines.push('>', '> The license below is established for the package\'s own code and makes no claim about', '> the above.', '');
    }
    if (record.declaredOnly) {
      const { declaredCopyrightHolder, holderSource } = record.declaredOnly.record;
      lines.push(
        `> The publisher declared **${record.license}** in package.json and published no license text —`,
        '> none in the archive, none in its published source headers, and none at any upstream commit',
        '> that could be bound to these bytes.',
        '>',
        `> Copyright holder, as declared by the publisher: **${declaredCopyrightHolder}**`,
        `> (source: ${holderSource})`,
        '>',
        '> The text below is the canonical SPDX text of that license, reproduced with its placeholders',
        '> left intact. **It was not supplied by the publisher** and is not represented as their words.',
        '');
    }
    for (const file of record.files) lines.push(`### ${file.path}`, '', ...(file.url ? [`Source text: ${file.url}`, ''] : []), ...file.text.trimEnd().split('\n').map((line) => `    ${line}`), '');
    if (!record.files.length) lines.push(`UNRESOLVED: ${record.error ?? 'No qualifying license text found in the archive or immutable upstream source.'}`, '');
  }
  await writeFile(path.join(output, 'THIRD_PARTY_NOTICES.candidate.md'), `${lines.join('\n')}\n`);
  console.log(JSON.stringify({ packages: records.length, collected: records.filter((record) => record.status === 'text-collected').length,
    firstParty: records.filter((record) => record.status === 'first-party-scope').length,
    unresolved: missing.map(({ name, version, status, error }) => ({ name, version, status, error })), output }, null, 2));
  return missing.length === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!await collectNotices(process.cwd())) process.exitCode = 1;
}
