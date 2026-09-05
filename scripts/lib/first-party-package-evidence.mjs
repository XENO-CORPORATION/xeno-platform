import { readFileSync } from 'node:fs';
import { githubRepository } from './npm-upstream-notices.mjs';

const registry = JSON.parse(readFileSync(new URL('../../compliance/first-party-packages.json', import.meta.url), 'utf8'));

// A familiar name alone cannot classify an arbitrary new archive as first-party.
// The caller must already have verified the archive's SRI and package identity.
export function recordedFirstPartyPackage(name, item, manifest, entries = registry.entries) {
  const matches = entries.filter(record => record.name === name);
  if (matches.length > 1) throw new Error(`Ambiguous first-party evidence: ${name}`);
  const entry = matches[0];
  if (!entry) return undefined;
  if (entry.version !== item.version || entry.resolved !== item.resolved || entry.integrity !== item.integrity ||
      manifest.name !== name || manifest.version !== item.version ||
      githubRepository(manifest.repository) !== entry.repository || manifest.license !== entry.declaredLicense ||
      !/^[a-f0-9]{40}$/.test(entry.sourceCommit) || !/^[a-f0-9]{40}$/.test(entry.sourceManifestGitBlob) ||
      !/^[a-f0-9]{64}$/.test(entry.sourceManifestSha256)) {
    throw new Error(`First-party evidence no longer matches the locked artifact: ${name}`);
  }
  return entry;
}
