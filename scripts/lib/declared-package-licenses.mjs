import { readFileSync } from 'node:fs';
import { sha256, declaredManifestLicense } from './npm-package-evidence.mjs';

/**
 * The FOURTH and weakest route to a notice: the publisher named a licence and
 * never wrote the text down — not in the archive, not in a source header, not at
 * any upstream commit. `scripts/record-declared-license.mjs` establishes that
 * absence and writes the record; this reads it back under the same suspicion the
 * other three routes are read under.
 *
 * 🔴 The canonical text is returned VERBATIM with its `<year> <copyright
 * holders>` placeholders intact, and this module will refuse a record whose text
 * has been interpolated. Filling those in would produce a notice that reads
 * exactly like one the publisher wrote, which is the single thing this whole
 * evidence store exists to make impossible. The declared holder travels beside
 * the text as its own field, with its own stated source.
 *
 * Anything stronger wins: `collectNotices` reaches here only after the archive,
 * the recovered upstream commit and the referenced-source-header routes have all
 * produced nothing.
 */
const registry = JSON.parse(readFileSync(new URL('../../compliance/declared-package-licenses.json', import.meta.url), 'utf8'));

export const hasDeclaredLicense = (name) => registry.packages.some((record) => record.name === name);

export function declaredOnlyLicense(name, item, manifest, archiveFiles, evidence = registry) {
  const matches = evidence.packages.filter((record) => record.name === name && record.version === item.version);
  if (matches.length > 1) throw new Error(`Ambiguous declaration-only record: ${name}`);
  const record = matches[0];
  if (!record) return undefined;

  // Identity, bound to the exact bytes. A record that has drifted from the
  // lockfile describes a package we no longer install.
  if (record.integrity !== item.integrity || record.resolved !== item.resolved
    || manifest.name !== name || manifest.version !== item.version) {
    throw new Error(`Declaration-only record does not match the installed archive: ${name}`);
  }
  if (declaredManifestLicense(manifest) !== record.license) {
    throw new Error(`Declaration-only record claims ${record.license}; the archive declares `
      + `${declaredManifestLicense(manifest)}: ${name}`);
  }
  if (record.textSource !== 'spdx-canonical') {
    throw new Error(`Declaration-only text must be labelled spdx-canonical, not "${record.textSource}": ${name}`);
  }

  // If a notice turns up in the archive, this route is no longer the weakest
  // available and using it would suppress a real publisher text.
  const notice = archiveFiles.find((file) => /\/(?:licen[cs]e|copying|notice|copyright)(?:[._-].*)?$/i.test(file.path));
  if (notice) {
    throw new Error(`Declaration-only record is stale: ${name} now ships ${notice.path}`);
  }

  const text = evidence.texts[record.license];
  if (!text) throw new Error(`No canonical text pinned for ${record.license}`);
  if (sha256(text.text) !== text.sha256) throw new Error(`Canonical ${record.license} text hash mismatch`);
  /* Only a TEMPLATE can lose its placeholders. MIT, ISC and BSD-2-Clause carry
   * `<year>`/`<owner>`; CC0-1.0 is a dedication and carries none, so demanding
   * placeholders of every text rejected a perfectly good pin. Whether a text is
   * a template is measured when it is pinned, not assumed here. */
  if (text.template && !/<(?:year|owner|copyright holders|name of author)>/i.test(text.text)) {
    throw new Error(`The pinned ${record.license} template has lost its placeholders — an interpolated `
      + 'canonical text is a manufactured notice, not a reproduction');
  }
  if (text.text.includes(record.declaredCopyrightHolder)) {
    throw new Error(`The pinned ${record.license} text names ${name}'s declared holder. The canonical text `
      + 'must be publisher-independent; a holder inside it means it was interpolated.');
  }
  if (!record.declaredCopyrightHolder) throw new Error(`No declared copyright holder recorded for ${name}`);
  if (!record.absenceEvidence?.archiveContents?.length) {
    throw new Error(`No absence evidence recorded for ${name} — the claim "there is no text" needs to be checkable`);
  }

  return {
    files: [{
      path: `declared/${record.license}.txt`,
      url: text.url,
      sha256: text.sha256,
      text: text.text,
      declarationOnly: true,
    }],
    provenance: {
      type: 'publisher-declaration-with-canonical-license-text',
      record,
      textSource: { repository: evidence.textSourceRepository, commit: evidence.textSourceCommit, url: text.url },
      scope: 'The publisher declared this licence and published no text. The text below is the canonical '
        + 'SPDX text, reproduced with its placeholders intact; it is NOT publisher-supplied. Not legal '
        + 'clearance and not a determination that this attribution satisfies the licence.',
    },
  };
}
