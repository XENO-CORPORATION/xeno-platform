import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { makePublication, main } from './publish-model-bundle.mjs';

test('bundle publish binds all files and immutable manifest to verified bytes', () => {
 const root=mkdtempSync(join(tmpdir(),'bundle-publication-'));const file=join(root,'LICENSE');writeFileSync(file,'MIT');
 const sha256=createHash('sha256').update('MIT').digest('hex');
 const manifest={schema_version:2,id:'fixture',kind:'model',revision:'test',family:'fixture',tasks:['speech'],minimum_runtime:'0.4.0',platforms:['any'],backends:['cpu'],entrypoints:{license:'LICENSE'},dependencies:[],license:{spdx:'MIT',evidence:'fixture',files:['LICENSE']},files:[{path:'LICENSE',size_bytes:3,sha256,source:'https://example.com/fixed/LICENSE'}]};
 try {
  const publication=makePublication(manifest,root);
  assert.equal(publication.artifacts[0].key,`models/artifacts/${sha256}/LICENSE`);
  assert.equal(publication.manifestKey,`models/bundles/fixture/${publication.digest}/xrt.bundle.json`);
  assert.notEqual(publication.manifest.files[0].source,manifest.files[0].source);
  assert.equal(publication.digest,createHash('sha256').update(publication.bytes).digest('hex'));
  assert.throws(()=>makePublication({...manifest,kind:'native-runtime'},root),/native code/);
  const changed=structuredClone(manifest);changed.files[0].sha256='0'.repeat(64);
  assert.throws(()=>makePublication(changed,root),/differs/);
  const traversal=structuredClone(manifest);traversal.files[0].path='../LICENSE';
  assert.throws(()=>makePublication(traversal,root),/path/);
 } finally {unlinkSync(file);rmdirSync(root);}
});
test('importing publisher does not execute it and missing args refuse before network',async()=>{
 await assert.rejects(main([]),/usage/);
 await assert.rejects(main(['--unexpected']),/unknown/);
});
