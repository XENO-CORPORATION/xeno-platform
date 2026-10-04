// FORGE-02 against real PostgreSQL: a project binds several
// repositories and non-code stores, each carrying provider, stable
// repository ID, installation reference, authoritative refs and access
// policy; rename/transfer reconciles through the stable identity, and
// a matching name or URL authorizes nothing.
//
// PROVEN: two repositories and a resource store bind to one project
// with full identity tuples while a sibling project binds apart;
// providers register dynamically with declared capabilities; transfer
// by display name or URL resolves nothing, by stranger refuses, and
// by stable identity with authority reconciles installation and
// label through a journaled move; the stable anchor never moves and
// operations on it keep working across renames.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {describeCapabilities,registerForgeProvider,bindRepository,listProjectBindings,
 reconcileRepositoryTransfer,readBindingTransfers,createBranch,readRevision}=await import('../src/server/services/forgeAdapter.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('FORGE-02: multi-binding identity with stable-id transfer reconciliation',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`f2-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query(
  `INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id`,
  [x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),stranger=await user('stranger');
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 const sibling=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Sibling'])).rows[0].id;
 const vault=registerForgeProvider(`vault-${marker}`,['discover','readRevision']);
 assert.deepEqual(Object.keys(vault.capabilities).filter(k=>vault.capabilities[k]).sort(),
  ['discover','readRevision'],'a provider registers with declared capabilities');
 assert.throws(()=>registerForgeProvider('local',['discover']),e=>/provider_exists/.test(e.message),
  're-registering refuses');
 assert.ok(describeCapabilities('store').unavailable.includes('submitCR'),
  'the resource store declares writes unavailable');
 const repo1=await bindRepository(pool,{projectId:project,actorUserId:owner,provider:'local',
  remoteId:`local:repo-1-${marker}`,displayName:'atlas',installationRef:'inst-1',
  refs:{default:'main',protected:['main']},accessPolicy:{visibility:'private'}});
 await bindRepository(pool,{projectId:project,actorUserId:owner,provider:'local',
  remoteId:`local:repo-2-${marker}`,displayName:'charts'});
 await bindRepository(pool,{projectId:project,actorUserId:owner,provider:'store',
  remoteId:`store:assets-9-${marker}`,displayName:'assets',
  refs:{bucket:'assets'},accessPolicy:{visibility:'team'}});
 await bindRepository(pool,{projectId:sibling,actorUserId:owner,provider:'local',
  remoteId:`local:other-${marker}`});
 const bindings=await listProjectBindings(pool,project);
 assert.equal(bindings.length,3,'the project lists exactly its own three bindings');
 const first=bindings.find(b=>b.remoteId===`local:repo-1-${marker}`);
 assert.equal(first.provider,'local','the tuple names the provider');
 assert.equal(first.displayName,'atlas','the tuple carries the display label');
 assert.equal(first.installationRef,'inst-1','the tuple carries the installation reference');
 assert.deepEqual(first.refs,{default:'main',protected:['main']},'the tuple carries authoritative refs');
 assert.deepEqual(first.accessPolicy,{visibility:'private'},'the tuple carries the access policy');
 const store=bindings.find(b=>b.provider==='store');
 assert.equal(store.remoteId,`store:assets-9-${marker}`,'the non-code store binds alongside');
 // Names and URLs authorize nothing; the stable identity does.
 await assert.rejects(reconcileRepositoryTransfer(pool,{provider:'local',remoteId:'atlas',
  actorUserId:owner,newDisplayName:'spoofed'}),e=>/binding_not_found/.test(e.message),
  'a matching display name resolves nothing');
 await assert.rejects(reconcileRepositoryTransfer(pool,{provider:'local',
  remoteId:'https://forge.test/atlas',actorUserId:owner,newDisplayName:'spoofed'}),
  e=>/binding_not_found/.test(e.message),'a matching URL resolves nothing');
 await assert.rejects(reconcileRepositoryTransfer(pool,{provider:'local',
  remoteId:`local:repo-1-${marker}`,actorUserId:stranger,newDisplayName:'spoofed'}),
  e=>/transfer_not_authorized/.test(e.message),'a stranger reconciles nothing');
 const moved=await reconcileRepositoryTransfer(pool,{provider:'local',
  remoteId:`local:repo-1-${marker}`,actorUserId:owner,newInstallationRef:'inst-2',newDisplayName:'atlas-moved'});
 assert.equal(moved.stableRemoteId,`local:repo-1-${marker}`,'the move reports the stable anchor');
 const history=await readBindingTransfers(pool,repo1.id);
 assert.equal(history.length,1,'the move journals exactly once');
 assert.equal(history[0].previousInstallation,'inst-1','the journal keeps the old installation');
 assert.equal(history[0].newInstallation,'inst-2','the journal records the new installation');
 assert.equal(history[0].previousDisplay,'atlas','the journal keeps the old label');
 const relabeled=await reconcileRepositoryTransfer(pool,{provider:'local',
  remoteId:`local:repo-1-${marker}`,actorUserId:owner,newDisplayName:'atlas-renamed'});
 assert.equal((await listProjectBindings(pool,project)).find(b=>String(b.id)===String(repo1.id)).installationRef,
  'inst-2','a rename keeps the reconciled installation');
 assert.equal((await readBindingTransfers(pool,repo1.id)).length,2,'the rename journals too');
 const after=(await pool.query(`SELECT remote_id, display_name FROM forge_bindings WHERE id=$1`,[repo1.id])).rows[0];
 assert.equal(after.remote_id,`local:repo-1-${marker}`,'the stable anchor never moves');
 assert.equal(after.display_name,'atlas-renamed','only the decoration moves');
 await createBranch(pool,{bindingId:repo1.id,actorUserId:owner,name:'main',fromRev:'r0'});
 assert.deepEqual((await readRevision(pool,{bindingId:repo1.id,rev:'r0'})).branches,['main'],
  'operations on the stable anchor keep working across renames');
});
