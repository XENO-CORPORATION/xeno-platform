import {readFileSync} from 'node:fs';
import {declaredManifestLicense,sha256} from './npm-package-evidence.mjs';
const records=JSON.parse(readFileSync(new URL('../../compliance/recovered-package-licenses.json',import.meta.url),'utf8'));
export function recoveredLicense(name,item,manifest,evidence=records) {
  const matches=evidence.packages.filter(p=>p.name===name && p.version===item.version);
  if(!matches.length)return undefined;
  if(matches.length!==1)throw Error('Ambiguous recovered license');
  const record=matches[0];
  if(record.integrity!==item.integrity || record.resolved!==item.resolved || manifest.name!==name || manifest.version!==item.version || declaredManifestLicense(manifest)!==record.license)throw Error('Recovered license archive mismatch');
  /* 🔴 TWO QUESTIONS, NOT ONE — and this used to answer the first with the
   * second's evidence.
   *
   * It read: "Only complete runtime-source comparisons are admitted. In
   * particular the tr46 generated Unicode table remains unresolved; its license
   * is research." Both halves of that were right, and joining them was not. The
   * questions are:
   *
   *   1. Is the recovered licence TEXT bound to this artifact?
   *   2. Does the artifact contain third-party material under OTHER terms?
   *
   * For tr46@0.0.3 the answer to (1) is unambiguously yes — `index.js` and
   * `lib/.gitkeep` match the pinned commit byte-for-byte, so the MIT grant is
   * as well established as any record in this store. The answer to (2) is open,
   * because `lib/mappingTable.json` is generated: the repository's own
   * `scripts/generateMappingTable.js` downloads
   * http://www.unicode.org/Public/idna/latest/IdnaMappingTable.txt and reduces
   * it to code-point ranges.
   *
   * Discarding the whole record made (1) fail because (2) was open — so a
   * PROVEN MIT grant was thrown away, tr46 reported as "no licence text found",
   * and the genuinely interesting finding (embedded Unicode data) vanished into
   * a silence that looked like an ordinary gap. A rule that has become
   * impossible to satisfy is usually one rule doing two jobs.
   *
   * Now: at least one proof must match cleanly, EVERY non-matching proof must
   * carry an explanation, and the unexplained ones still reject the record. The
   * explained ones are returned as `unresolvedComponents` so the notice states
   * them where a reader will see them. Losing that surfacing would put us back
   * where we started, so it is asserted by the gate. */
  const clean=record.runtimeProofs.filter(p=>!p.status && /^[a-f0-9]{64}$/.test(p.sha256));
  const explained=record.runtimeProofs.filter(p=>p.status);
  const unexplained=record.runtimeProofs.filter(p=>!p.status && !/^[a-f0-9]{64}$/.test(p.sha256));
  if(!clean.length || unexplained.length)return undefined;
  if(!/^[a-f0-9]{40}$/.test(record.commit))throw Error('Unpinned recovered source');
  const prefix=`https://raw.githubusercontent.com/${record.repository}/${record.commit}/`;
  for(const file of [...record.files,...record.runtimeProofs]) {
    if(file.url!==prefix+file.path)throw Error('Recovered source URL mismatch');
  }
  if(!record.files.length || record.files.some(f=>sha256(f.text)!==f.sha256))throw Error('Recovered text hash mismatch');
  return {files:record.files,provenance:record,
    ...(explained.length?{unresolvedComponents:explained.map(p=>({path:p.path,status:p.status,
      archiveSha256:p.archiveSha256,note:record.componentNotes?.[p.path]}))}:{})};
}
