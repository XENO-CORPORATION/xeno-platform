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
 /* The NAME of this test is the requirement and it has not changed: a generated
  * file that could not be matched upstream must not disappear quietly.
  *
  * The ASSERTION changed on 2026-09-10, because it pinned a mechanism that was
  * achieving the opposite of the name. It required recoveredLicense() to return
  * `undefined` for tr46 — discarding the ENTIRE record — which meant a licence
  * grant proven byte-for-byte (index.js matches the pinned commit exactly) was
  * thrown away, tr46 was reported as "no licence text found", and the actually
  * interesting fact was buried in a silence that read like an ordinary gap.
  * Clearing everything is a way of clearing the generated data too.
  *
  * There are two questions here and the old assertion answered the first with
  * the second's evidence: is the licence text bound to this artifact (yes), and
  * does the artifact contain material under other terms (open). They are now
  * separated — the grant is returned, the component is surfaced with its
  * explanation, and the notice states it where a reader will see it.
  *
  * The strictness that mattered is kept and asserted below: a non-match with no
  * explanation still rejects the whole record. */
 const p=evidence.packages.find(p=>p.name==='tr46');
 const manifest={name:p.name,version:p.version,license:p.license};
 const result=recoveredLicense(p.name,p,manifest);

 assert.ok(result,'the proven MIT grant must be returned; discarding it hides the component too');
 assert.match(result.files[0].text,/Sebastian Mayr/,'and it must be the real publisher text');
 assert.ok(result.unresolvedComponents?.length,'the generated file must come back as a stated component');
 const table=result.unresolvedComponents.find(c=>c.path==='lib/mappingTable.json');
 assert.ok(table,'lib/mappingTable.json is the component and it is missing from the result');
 assert.equal(table.status,'not-present-in-upstream-source');
 assert.match(table.note,/Unicode/,'an unexplained component is a silence with extra steps');

 // The guard that must never relax: no explanation, no record.
 const unexplained=structuredClone(evidence);
 const target=unexplained.packages.find(x=>x.name==='tr46');
 target.runtimeProofs.push({path:'lib/other.json',sha256:'not-a-hash',
  url:`https://raw.githubusercontent.com/${target.repository}/${target.commit}/lib/other.json`});
 assert.equal(recoveredLicense(p.name,p,manifest,unexplained),undefined,
  'a runtime proof that neither matches nor explains itself must still reject the record');
});
