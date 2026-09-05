import { readFileSync } from 'node:fs';
import { sha256, declaredManifestLicense } from './npm-package-evidence.mjs';

const registry = JSON.parse(readFileSync(new URL('../../compliance/referenced-package-licenses.json', import.meta.url), 'utf8'));
export const hasReferencedLicense = name => registry.packages.some(record => record.name === name);

export function referencedPackageLicense(name, item, manifest, headers, evidence = registry) {
  const matches = evidence.packages.filter(record => record.name === name);
  if (matches.length > 1) throw new Error('Ambiguous referenced package identity');
  const record = matches[0];
  if (!record) return undefined;
  if (record.version !== item.version || record.resolved !== item.resolved || record.integrity !== item.integrity ||
      manifest.name !== name || manifest.version !== item.version || declaredManifestLicense(manifest) !== record.license) {
    throw new Error(`Referenced license evidence does not match archive: ${name}`);
  }
  if (!headers.length) throw new Error(`No original copyright/license headers found: ${name}`);
  const expectedLicenses = record.observedSourceLicenses ?? [record.license];
  const observed = new Set();
  const unique = new Map();
  for (const header of headers) {
    if (!/^[a-f0-9]{64}$/.test(header.sourceSha256) || sha256(header.text) !== header.sha256 || !/copyright/i.test(header.text)) {
      throw new Error('Invalid source-header evidence');
    }
    const apache = /Licensed under the Apache License,\s*Version 2\.0/i.test(header.text) && /https?:\/\/www\.apache\.org\/licenses\/LICENSE-2\.0\b/.test(header.text);
    const linkedFormat = name === 'format' && record.sourceLicenseReference === 'http://sjs.mit-license.org' &&
      /\/\/ MIT License\s*\r?\n\/\/ http:\/\/sjs\.mit-license\.org\b/.test(header.text) && /Sami Samhuri/.test(header.text);
    const mit = /Licensed under the MIT License\b/i.test(header.text) || linkedFormat;
    const license = apache && !mit ? 'Apache-2.0' : mit && !apache ? 'MIT' : undefined;
    if (!license || !expectedLicenses.includes(license)) throw new Error(`Conflicting or unrecognized source license header: ${header.sourcePath}`);
    observed.add(license);
    if (!unique.has(header.sha256)) unique.set(header.sha256, { ...header, sourceLocations: [] });
    unique.get(header.sha256).sourceLocations.push({ path: header.sourcePath, sha256: header.sourceSha256 });
  }
  if (!observed.has(record.license)) throw new Error('Declared license has no matching original source header');
  if (expectedLicenses.some(license => !observed.has(license))) throw new Error('Known source license headers are missing from evidence');
  const fullTexts = [...observed].sort().map(license => {
    const key = name === 'format' && license === 'MIT' ? 'format' : license === 'Apache-2.0' ? 'apache' : 'onnx';
    const full = evidence.texts[key];
    if (sha256(full.text) !== full.sha256) throw new Error('Referenced license text hash mismatch');
    const expectedUrl = key === 'format' ? 'https://sjs.mit-license.org/' : license === 'Apache-2.0' ? 'https://www.apache.org/licenses/LICENSE-2.0.txt'
      : 'https://raw.githubusercontent.com/microsoft/onnxruntime/f217402897f40ebba457e2421bc0a4702771968e/LICENSE';
    if (full.url !== expectedUrl) throw new Error('Unexpected referenced license source');
    if (key === 'format' && (sha256(full.rawSourceHtml) !== full.rawSourceSha256 || !full.text.includes('Sami Samhuri'))) throw new Error('Publisher license snapshot mismatch');
    return { path: `referenced/${license}.txt`, ...full };
  });
  return { files: [...unique.values(), ...fullTexts],
    provenance: { type: 'published-source-headers-and-referenced-license-text', record,
      observedSourceLicenses: [...observed].sort(),
      licenseSources: fullTexts.map(({ url, sha256 }) => ({ url, sha256 })),
      scope: 'Declared license text and observed source headers only; not legal clearance or binary dependency inventory.' } };
}
