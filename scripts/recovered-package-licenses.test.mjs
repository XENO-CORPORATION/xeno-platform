import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recoveredLicense} from './lib/recovered-package-licenses.mjs';
const evidence=JSON.parse(readFileSync(new URL('../compliance/recovered-package-licenses.json',import.meta.url),'utf8'));
const record=evidence.packages.find(p=>p.name==='boolbase');
const manifest={name:record.name,version:record.version,license:record.license};
test('complete pinned recovery retains the real publisher text',()=>{
 assert.match(recoveredLicense(record.name,record,manifest).files[0].text,/Felix Boehm/);
});
test('changed version identity or text cannot reuse recovered evidence',()=>{
 assert.throws(()=>recoveredLicense(record.name,{...record,integrity:'other'},manifest),/mismatch/);
 const changed=structuredClone(evidence); changed.packages[0].files[0].text+='modified';
 assert.throws(()=>recoveredLicense(record.name,record,manifest,changed),/hash mismatch/);
});
test('generated data with no upstream match is not silently cleared',()=>{
 const p=evidence.packages.find(p=>p.name==='tr46');
 assert.equal(recoveredLicense(p.name,p,{name:p.name,version:p.version,license:p.license}),undefined);
});
