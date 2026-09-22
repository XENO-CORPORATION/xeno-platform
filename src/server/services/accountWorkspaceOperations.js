import { authorityTransaction, operationError as fail, operationHash } from './workspaceOperationReceipts.js';
import { createAccountWorkspace, decideWorkspaceInvite, lockAccountInvite } from './workspaceLifecycle.js';
import { isActivated } from './accountActivation.js';

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const terminal=new Set(['committed','rejected','abandoned']);
const rejections=new Set(['invite_not_found','invite_not_pending','invite_expired','invite_identity_changed','invalid_invite_role','seat_limit','workspace_identity_unavailable','workspace_identity_changed','account_not_activated']);
export function accountWorkspaceRequest(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail(400,'invalid_account_workspace_request');
  if(value.action==='workspace.create'){
    if(Object.keys(value).some(k=>!['action','name','workspace_type'].includes(k))||typeof value.name!=='string'||!value.name.trim()||value.name.length>128||value.workspace_type!=='team')throw fail(400,'invalid_account_workspace_request');
    return {action:value.action,name:value.name,workspace_type:'team'};
  }
  if(!['invite.accept','invite.decline'].includes(value.action)||Object.keys(value).some(k=>!['action','inviteId'].includes(k))||!UUID.test(value.inviteId))throw fail(400,'invalid_account_workspace_request');
  return {action:value.action,inviteId:value.inviteId.toLowerCase()};
}
function identity(actor,client,operationId) {
  if(!UUID.test(actor)||!UUID.test(operationId)||typeof client!=='string'||!/^[a-zA-Z0-9._-]{1,128}$/.test(client))throw fail(400,'invalid_account_workspace_operation');
  return [actor.toLowerCase(),client,operationId.toLowerCase()];
}
async function incarnation(db,actor) {
  const row=(await db.query('SELECT extract(epoch FROM created_at)::text AS created_at FROM users WHERE id=$1 AND is_active=true',[actor])).rows[0];
  if(!row)throw fail(403,'account_identity_unavailable');
  return operationHash(row);
}
const where='actor_user_id=$1 AND client_id=$2 AND operation_id=$3';
function checkRow(row,scope,ids) {
  if(row.account_incarnation!==scope)throw fail(409,'account_workspace_incarnation_conflict');
  let request;try{request=accountWorkspaceRequest(row.request);}catch{throw fail(409,'invalid_account_workspace_record');}
  if(operationHash(request)!==row.request_hash||row.receipt?.operation_id!==ids[2]||row.receipt?.actor_user_id!==ids[0]||row.receipt?.client_id!==ids[1]
    ||row.receipt?.state!==row.state||!['prepared',...terminal].includes(row.state)||operationHash(row.receipt.request)!==row.request_hash
    ||row.state==='prepared'&&request.action!=='workspace.create'&&!/^[a-f0-9]{64}$/.test(row.target_hash))throw fail(409,'invalid_account_workspace_record');
}
export async function readAccountWorkspaceOperation(db,actor,client,operationId) {
  const ids=identity(actor,client,operationId),scope=await incarnation(db,ids[0]);
  const row=(await db.query(`SELECT * FROM account_workspace_operations WHERE ${where}`,ids)).rows[0];
  if(!row)return {state:'not-observed',operation:null};
  checkRow(row,scope,ids);return {state:row.state,operation:row.receipt};
}
/** prepare never dispatches; execute requires an existing prepared row. Restart
 * has no worker. Abandonment may beat a delayed prepare/execute under the same ID.
 * Every terminal result is committed with the business write in one DB transaction. */
export async function changeAccountWorkspaceOperation(pool,actor,client,operationId,phase,rawRequest) {
  const ids=identity(actor,client,operationId),request=accountWorkspaceRequest(rawRequest),hash=operationHash(request);
  if(!['prepare','execute','abandon'].includes(phase))throw fail(400,'invalid_account_workspace_phase');
  return authorityTransaction(pool,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`account-workspace-operations:${ids[0]}:${ids[1]}`]);
    const scope=await incarnation(db,ids[0]);
    const row=(await db.query(`SELECT * FROM account_workspace_operations WHERE ${where}`,ids)).rows[0];
    if(row){
      checkRow(row,scope,ids);if(row.request_hash!==hash)throw fail(409,'account_workspace_operation_conflict');
      if(terminal.has(row.state)||phase==='prepare')return {operation:row.receipt,replayed:true};
    }else if(phase==='execute')throw fail(409,'account_workspace_intent_not_prepared');
    const base=row?.receipt??{operation_id:ids[2],actor_user_id:ids[0],client_id:ids[1],request,prepared_at:new Date().toISOString()};
    let operation,targetHash=row?.target_hash??null;
    if(phase==='abandon')operation={...base,state:'abandoned',completed_at:new Date().toISOString()};
    else if(phase==='prepare'){
      if(request.action!=='workspace.create')targetHash=(await lockAccountInvite(db,ids[0],request.inviteId)).targetHash;
      operation={...base,state:'prepared'};
    }else{
      await db.query('SAVEPOINT account_workspace_mutation');
      try{
        let result;
        if(request.action==='workspace.create'){
          if(!await isActivated(db,ids[0]))throw fail(403,'account_not_activated');
          const ws=await createAccountWorkspace(db,ids[0],request.name,'team');
          result={workspace:{id:ws.id,owner_user_id:ws.owner_user_id,workspace_type:ws.workspace_type,name:ws.name,slug:ws.slug,status:ws.status,created_at:ws.created_at,updated_at:ws.updated_at,metadata:ws.metadata??{},member_role:'owner',member_count:1}};
        }else result=await decideWorkspaceInvite(db,ids[0],request.inviteId,request.action==='invite.accept'?'accept':'decline',targetHash);
        operation={...base,state:result.rejection?'rejected':'committed',...(result.rejection?{rejection:result.rejection}:{result}),completed_at:new Date().toISOString()};
      }catch(error){
        if(!rejections.has(error.code))throw error;
        await db.query('ROLLBACK TO SAVEPOINT account_workspace_mutation');
        operation={...base,state:'rejected',rejection:error.code,completed_at:new Date().toISOString()};
      }
    }
    if(row)await db.query(`UPDATE account_workspace_operations SET state=$4,receipt=$5 WHERE ${where}`,[...ids,operation.state,JSON.stringify(operation)]);
    else{
      const count=Number((await db.query('SELECT count(*) FROM account_workspace_operations WHERE actor_user_id=$1 AND client_id=$2',ids.slice(0,2))).rows[0].count);
      if(count>=10000)throw fail(429,'account_workspace_operation_capacity');
      await db.query('INSERT INTO account_workspace_operations(actor_user_id,client_id,operation_id,account_incarnation,request_hash,request,target_hash,state,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[...ids,scope,hash,JSON.stringify(request),targetHash,operation.state,JSON.stringify(operation)]);
    }
    return {operation,replayed:false};
  });
}
