import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { R2Publisher } from './lib/r2-upload.mjs';

test('publisher refuses blind/equal-size writes and skips only hash-equal objects', async t => {
 const dir=mkdtempSync(join(tmpdir(),'r2-identity-'));const file=join(dir,'model.bin');writeFileSync(file,'abcd');
 const hash=createHash('sha256').update('abcd').digest('hex');
 let probe='unknown';let remoteHash=hash;let failCopy=false;const calls=[];
 t.mock.method(childProcess,'execFileSync',(exe,args) => {
  assert.equal(exe,'rclone');calls.push(args);
  if(args[0]==='lsjson') {
   if(probe==='unknown')throw new Error('credentials unavailable');
   return JSON.stringify(probe==='found'?[{Size:4}]:[]);
  }
  if(args[0]==='hashsum')return `${remoteHash}  model.bin\n`;
  if(args[0]==='copyto' && failCopy)throw new Error('snapshot failed');
  if(args[0]==='copyto')return '';
  throw new Error('unexpected external command');
 });syncBuiltinESMExports();
 try {
  const publisher=new R2Publisher({remote:'r2:test',dryRun:false});
  // This test targets immutability; independent release-guard tests exercise
  // the real secret scanner. No external process can run under this mock.
  publisher.gate=async()=>({coverage:'raw',findings:[]});
  assert.throws(()=>publisher.assertNotClobbering(file,'models/test/file'),/cannot prove/);
  probe='found';remoteHash='b'.repeat(64);
  assert.throws(()=>publisher.assertNotClobbering(file,'models/test/file'),/already exists/);
  await assert.rejects(publisher.putArtifact(file,'models/test/file'),/already exists/);
  assert.equal(calls.filter(c=>c[0]==='copyto').length,0);
  remoteHash=hash;
  await publisher.putArtifact(file,'models/test/file');
  assert.equal(publisher.uploads[0].skipped,true);
  assert.equal(calls.filter(c=>c[0]==='copyto').length,0);
  probe='absent';await publisher.putArtifact(file,'models/test/new');
  assert.ok(calls.find(c=>c[0]==='copyto').includes('--immutable'));
  probe='unknown';await assert.rejects(publisher.snapshotPointer('models/catalog.json'),/refusing pointer write/);
  probe='found';failCopy=true;await assert.rejects(publisher.snapshotPointer('models/catalog.json'),/refusing irreversible/);
 } finally {t.mock.restoreAll();syncBuiltinESMExports();unlinkSync(file);rmdirSync(dir);}
});
