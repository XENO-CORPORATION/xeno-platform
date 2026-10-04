// SES-08 against real PostgreSQL: provider/model availability is discovered
// through the existing catalogs; selection and command execution require
// actual acknowledgements; unsupported native commands stay visibly
// native-only, never simulated as successful GUI operations.
//
// PROVEN: discovery reads the gateway catalog's enabled rows only (disabled
// and unlisted models are undiscoverable and unselectable); selection pends
// until the provider echoes provider+model+nonce exactly (any mismatch
// refuses); execution needs an acked selection plus a registered command,
// and GUI execution of a native-only command is refused while the command
// stays listed with guiSupported:false; command results read only after the
// provider's own acknowledgement, verbatim; strangers touch nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {discoverModels,selectModel,acknowledgeSelection,registerNativeCommand,listNativeCommands,executeCommand,acknowledgeCommand,readCommandResult}=await import('../src/server/services/providerSelection.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('SES-08: catalog discovery with acked selection and execution; native-only stays native',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`p8-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),mallory=await user('mallory');
 await pool.query(`INSERT INTO gateway_model_aliases(public_id,internal_id,enabled,provider,is_alias) VALUES
  ('acme-chat','acme-chat-internal',true,'acme',true),('acme-embed','acme-embed',false,'acme',false)`);
 // Discovery: the enabled catalog rows, nothing else.
 assert.deepEqual(await discoverModels(pool,{provider:'acme'}),
  [{publicId:'acme-chat',internalId:'acme-chat-internal',provider:'acme'}],
  'discovery returns the enabled catalog rows; disabled rows are undiscoverable');
 await assert.rejects(selectModel(pool,{actorUserId:alice,provider:'acme',publicId:'acme-embed'}),
  e=>e.message==='model_unavailable','a disabled catalog model cannot be selected');
 await assert.rejects(selectModel(pool,{actorUserId:alice,provider:'acme',publicId:'acme-ghost'}),
  e=>e.message==='model_unavailable','an unlisted model cannot be selected');
 // Selection pends until the provider echoes all three fields.
 const sel=await selectModel(pool,{actorUserId:alice,provider:'acme',publicId:'acme-chat'});
 assert.equal(sel.status,'pending','a fresh selection pends for acknowledgement');
 await assert.rejects(acknowledgeSelection(pool,{selectionId:sel.selectionId,provider:'acme',publicId:'acme-chat',nonce:'0'.repeat(32)}),
  e=>e.message==='ack_mismatch','an acknowledgement with the wrong nonce is refused');
 await assert.rejects(acknowledgeSelection(pool,{selectionId:sel.selectionId,provider:'rival',publicId:'acme-chat',nonce:sel.nonce}),
  e=>e.message==='ack_mismatch','an acknowledgement from the wrong provider is refused');
 await acknowledgeSelection(pool,{selectionId:sel.selectionId,provider:'acme',publicId:'acme-chat',nonce:sel.nonce});
 // Execution: acked selection, registered command, honest surfaces.
 await registerNativeCommand(pool,{provider:'acme',command:'shell.exec',guiSupported:false});
 await registerNativeCommand(pool,{provider:'acme',command:'chat.complete',guiSupported:true});
 assert.deepEqual(await listNativeCommands(pool,{provider:'acme'}),
  [{command:'chat.complete',guiSupported:true},{command:'shell.exec',guiSupported:false}],
  'native-only commands stay listed as native-only: visible, never simulated');
 await assert.rejects(executeCommand(pool,{actorUserId:alice,selectionId:sel.selectionId,command:'shell.exec',surface:'gui'}),
  e=>e.message==='native_only','a native-only command executed from the GUI is refused');
 await assert.rejects(executeCommand(pool,{actorUserId:alice,selectionId:sel.selectionId,command:'drop.table',surface:'native'}),
  e=>e.message==='command_unknown','an unregistered command cannot execute');
 await assert.rejects(executeCommand(pool,{actorUserId:mallory,selectionId:sel.selectionId,command:'chat.complete',surface:'native'}),
  e=>e.message==='execute_not_authorized','a stranger cannot execute on someone else\'s selection');
 const pending=await selectModel(pool,{actorUserId:alice,provider:'acme',publicId:'acme-chat'});
 await assert.rejects(executeCommand(pool,{actorUserId:alice,selectionId:pending.selectionId,command:'chat.complete',surface:'native'}),
  e=>e.message==='selection_not_acked','execution on a pending selection is refused');
 const run=await executeCommand(pool,{actorUserId:alice,selectionId:sel.selectionId,command:'chat.complete',surface:'gui'});
 assert.equal(run.status,'submitted','an acked GUI-supported command submits');
 await assert.rejects(readCommandResult(pool,{actorUserId:alice,commandId:run.commandId}),
  e=>e.message==='command_not_acked','results are unreadable before the provider acknowledgement');
 await assert.rejects(acknowledgeCommand(pool,{commandId:run.commandId,nonce:'f'.repeat(32),receipt:{}}),
  e=>e.message==='ack_mismatch','a command acknowledgement with the wrong nonce is refused');
 await acknowledgeCommand(pool,{commandId:run.commandId,nonce:run.nonce,receipt:{text:'hello',usage:{tokens:9}}});
 assert.deepEqual(await readCommandResult(pool,{actorUserId:alice,commandId:run.commandId}),
  {commandId:run.commandId,provider:'acme',command:'chat.complete',receipt:{text:'hello',usage:{tokens:9}}},
  'the acknowledged receipt reads back verbatim');
 await assert.rejects(readCommandResult(pool,{actorUserId:mallory,commandId:run.commandId}),
  e=>e.message==='result_not_authorized','a stranger cannot read someone else\'s command result');
});
