import {readFileSync} from 'node:fs';
import {declaredManifestLicense,sha256} from './npm-package-evidence.mjs';
const records=JSON.parse(readFileSync(new URL('../../compliance/recovered-package-licenses.json',import.meta.url),'utf8'));
export function recoveredLicense(name,item,manifest,evidence=records) {
  const matches=evidence.packages.filter(p=>p.name===name && p.version===item.version);
  if(!matches.length)return undefined;
  if(matches.length!==1)throw Error('Ambiguous recovered license');
  const record=matches[0];
  if(record.integrity!==item.integrity || record.resolved!==item.resolved || manifest.name!==name || manifest.version!==item.version || declaredManifestLicense(manifest)!==record.license)throw Error('Recovered license archive mismatch');
  // Only complete runtime-source comparisons are admitted. In particular the
  // tr46 generated Unicode table remains unresolved; its license is research.
  if(!record.runtimeProofs.length || record.runtimeProofs.some(p=>p.status || !/^[a-f0-9]{64}$/.test(p.sha256)))return undefined;
  if(!/^[a-f0-9]{40}$/.test(record.commit))throw Error('Unpinned recovered source');
  const prefix=`https://raw.githubusercontent.com/${record.repository}/${record.commit}/`;
  for(const file of [...record.files,...record.runtimeProofs]) {
    if(file.url!==prefix+file.path)throw Error('Recovered source URL mismatch');
  }
  if(!record.files.length || record.files.some(f=>sha256(f.text)!==f.sha256))throw Error('Recovered text hash mismatch');
  return {files:record.files,provenance:record};
}
