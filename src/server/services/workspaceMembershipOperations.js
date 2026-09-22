import crypto from 'node:crypto';
import { check, listObjectTuples, writeTuples, ROLE_RANK } from '../utils/authzReBAC.js';
import { workspaceSeatInfo } from '../utils/workspaceContext.js';
import { authorityTransaction, lockWorkspaceAuthority, operationError as error, operationHash, operationIdentity, readWorkspaceOperation, transactWorkspaceOperation, workspaceOperationIncarnation as identityIncarnation } from './workspaceOperationReceipts.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fields = Object.freeze({ 'invite.create':['email','role'], 'invite.revoke':['inviteId'], 'invite.resend':['inviteId'], 'member.role':['memberId','role'], 'member.remove':['memberId'], 'owner.transfer':['newOwnerId'] });
const rejectionCodes = ['invalid_membership_request','member_not_found','owner_transfer_required','owner_target_not_member','invite_not_found','invite_already_pending','already_member','seat_limit'];
const relation = role => role === 'member' ? 'editor' : role;
const inviteProjection = row => ({ id:row.id,workspace_id:row.workspace_id,invited_email:row.invited_email,role:row.role === 'editor' ? 'member' : row.role,status:row.status,expires_at:row.expires_at });
async function roles(db, workspaceId) {
  const tuples = await listObjectTuples(db,`workspace:${workspaceId}`), members = new Map();
  for (const tuple of tuples) if (tuple.subject.startsWith('user:')) {
    const id=tuple.subject.slice(5), old=members.get(id);
    if (!old || (ROLE_RANK[tuple.relation] ?? 0) > (ROLE_RANK[old] ?? 0)) members.set(id,tuple.relation);
  }
  return {tuples,members};
}
async function authority(db, workspaceId, actor, action, input) {
  // Lock the real workspace record as well as the shared receipt gate. Existing
  // legacy callers retain their old contract; they cannot create this receipt.
  const ws=(await db.query('SELECT * FROM workspaces WHERE id=$1 FOR UPDATE',[workspaceId])).rows[0];
  if (!ws || ws.status !== 'active') throw error(403,'workspace_identity_unavailable');
  if (action === 'owner.transfer') {
    if (ws.owner_user_id !== actor) throw error(403,'workspace_owner_required');
  } else {
    const self = action === 'member.remove' && input.memberId === actor;
    if (!(await check(db,{object:`workspace:${workspaceId}`,subject:`user:${actor}`,relation:self ? 'viewer' : 'admin'})).allowed) throw error(403,'workspace_admin_required');
  }
  return ws;
}
export async function readWorkspaceMembershipOperation(db,workspaceId,actor,clientId,operationId) {
  // The exact initiating authenticated actor/client may recover its own receipt
  // after self-leave/transfer. This exposes no fresh membership data or authority.
  const result=await readWorkspaceOperation(db,operationIdentity('membership',workspaceId,actor,clientId,operationId),db=>identityIncarnation(db,workspaceId,actor));
  const deliveryId=result.operation?.result?.delivery?.id;
  if(!deliveryId)return result;
  const delivery=(await db.query('SELECT state FROM workspace_invite_deliveries WHERE id=$1 AND workspace_id=$2',[deliveryId,workspaceId])).rows[0];
  return {...result,delivery:{id:deliveryId,state:delivery?.state==='pending'?'queued':['accepted','skipped'].includes(delivery?.state)?delivery.state:'unknown'}};
}
export async function mutateWorkspaceMembership(pool,workspaceId,actor,clientId,operationId,action,input,options={}) {
  const names=fields[action];
  if (!names || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key=>!names.includes(key))) throw error(400,'invalid_membership_request');
  // Legacy routes share the business transaction, never manufacture an operation
  // identity or imply that an old request can be safely replayed.
  const identity=options.legacy===true ? null : operationIdentity('membership',workspaceId,actor,clientId,operationId);
  const fingerprint=operationHash([action,names.map(key=>[key,Object.hasOwn(input,key) ? input[key] : {absent:true}])]);
  if(options.abandon===true){
    const target=action==='owner.transfer'?input.newOwnerId:action.startsWith('member.')?input.memberId:input.inviteId;
    if(action==='invite.create'?typeof input.email!=='string'||input.email.length>320||/[\x00-\x20\x7f]/.test(input.email)||!/^[^@]+@[^@]+\.[^@]+$/.test(input.email)||!['admin','member','viewer'].includes(input.role)
      :typeof target!=='string'||!UUID.test(target)||(action==='member.role'&&!['admin','member','viewer'].includes(input.role)))throw error(400,'invalid_membership_request');
  }
  let workspace;
  const transaction={
    identity,requestHash:fingerprint,authorizeIdentity:db=>identityIncarnation(db,workspaceId,actor),
    ...(options.abandon===true?{abandonment:()=>({operation_id:identity[3],workspace_id:identity[0],actor_user_id:identity[1],client_id:clientId,action,abandoned:true,request:{action,...input},committed_at:new Date().toISOString()})}:{}),
    authorizeMutation:async db=>{workspace=await authority(db,workspaceId,actor,action,input);},
    rejectedCodes:rejectionCodes,
    receipt:(result,rejection)=>({operation_id:identity[3],workspace_id:identity[0],actor_user_id:identity[1],client_id:clientId,action,
      ...(rejection ? {rejection} : {result}),committed_at:new Date().toISOString()}),
    apply:async db=>{
      const {tuples,members}=await roles(db,workspaceId);
      let result,target,metadata={};
      if (action.startsWith('member.') || action === 'owner.transfer') {
        const memberId=action === 'owner.transfer' ? input.newOwnerId : input.memberId;
        if (typeof memberId !== 'string' || !UUID.test(memberId)) throw error(400,'invalid_membership_request');
        if (action !== 'owner.transfer' && memberId === workspace.owner_user_id) throw error(400,'owner_transfer_required');
        if (!members.has(memberId)) throw error(404,action === 'owner.transfer' ? 'owner_target_not_member' : 'member_not_found');
        if (action === 'member.role' && !['admin','member','viewer'].includes(input.role)) throw error(400,'invalid_membership_request');
        if (action === 'owner.transfer' && memberId === actor) throw error(400,'invalid_membership_request');
        const subjects=new Set([`user:${memberId}`,...(action === 'owner.transfer' ? [`user:${actor}`] : [])]);
        const deletes=tuples.filter(t=>subjects.has(t.subject)).map(t=>({object:`workspace:${workspaceId}`,relation:t.relation,subject:t.subject}));
        // Existing writeTuples writes before deletes: split within our transaction
        // so a no-op role update cannot accidentally delete the newly written role.
        await writeTuples(db,{deletes});
        const writes=action === 'member.remove' ? [] : action === 'owner.transfer'
          ? [{object:`workspace:${workspaceId}`,subject:`user:${memberId}`,relation:'owner'},{object:`workspace:${workspaceId}`,subject:`user:${actor}`,relation:'admin'}]
          : [{object:`workspace:${workspaceId}`,subject:`user:${memberId}`,relation:relation(input.role)}];
        await writeTuples(db,{writes});
        if (action === 'owner.transfer') await db.query('UPDATE workspaces SET owner_user_id=$2,updated_at=now() WHERE id=$1',[workspaceId,memberId]);
        result={memberId,...(action === 'member.role' ? {role:input.role} : action === 'owner.transfer' ? {previousOwnerId:actor} : {})};
        target=memberId;metadata={from:members.get(memberId),...(action === 'member.role' ? {to:relation(input.role)} : {})};
      } else {
        let invite;
        if (action === 'invite.create') {
          if (typeof input.email !== 'string' || input.email.length>320 || /[\x00-\x20\x7f]/.test(input.email) || !/^[^@]+@[^@]+\.[^@]+$/.test(input.email) || !['admin','member','viewer'].includes(input.role)) throw error(400,'invalid_membership_request');
          const email=input.email.toLowerCase();
          const user=(await db.query('SELECT id FROM users WHERE lower(email)=$1 LIMIT 1',[email])).rows[0];
          if (user && members.has(user.id)) throw error(409,'already_member');
          await db.query("UPDATE workspace_invites SET status='expired' WHERE workspace_id=$1 AND status='pending' AND expires_at<=now()",[workspaceId]);
          const seats=await workspaceSeatInfo(db,workspaceId,members.size);
          if (seats.used>=seats.limit) throw error(402,'seat_limit');
          if ((await db.query("SELECT id FROM workspace_invites WHERE workspace_id=$1 AND lower(invited_email)=$2 AND status='pending'",[workspaceId,email])).rowCount) throw error(409,'invite_already_pending');
          invite=(await db.query(`INSERT INTO workspace_invites(workspace_id,invited_by_user_id,invited_user_id,invited_email,role,token,expires_at)
            VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days') RETURNING *`,[workspaceId,actor,user?.id ?? null,email,relation(input.role),crypto.randomBytes(24).toString('hex')])).rows[0];
        } else {
          if (typeof input.inviteId !== 'string' || !UUID.test(input.inviteId)) throw error(400,'invalid_membership_request');
          invite=(await db.query("SELECT * FROM workspace_invites WHERE id=$1 AND workspace_id=$2 AND status='pending' FOR UPDATE",[input.inviteId,workspaceId])).rows[0];
          if (!invite) throw error(404,'invite_not_found');
          // Resending an expired reservation must reacquire capacity. Active
          // reservations already occupy a seat and must not be counted twice.
          if(action==='invite.resend' && invite.expires_at && new Date(invite.expires_at)<=new Date()) {
            const seats=await workspaceSeatInfo(db,workspaceId,members.size);
            if(seats.used>=seats.limit)throw error(402,'seat_limit');
          }
          invite=(await db.query(action === 'invite.revoke'
            ? "UPDATE workspace_invites SET status='revoked' WHERE id=$1 RETURNING *"
            : "UPDATE workspace_invites SET expires_at=now()+interval '7 days' WHERE id=$1 RETURNING *",[invite.id])).rows[0];
        }
        result={invite:options.legacy===true ? {...invite,token:undefined} : inviteProjection(invite)};target=invite.id;
        if (action !== 'invite.revoke') {
          const deliveryId=crypto.randomUUID();
          await db.query('INSERT INTO workspace_invite_deliveries(id,workspace_id,invite_id,invite_expires_at) SELECT $1,workspace_id,id,expires_at FROM workspace_invites WHERE id=$2',[deliveryId,invite.id]);
          result.delivery={id:deliveryId,state:'queued'};
        }
      }
      await db.query('INSERT INTO workspace_audit(workspace_id,actor_user_id,action,target,metadata) VALUES($1,$2,$3,$4,$5)',[workspaceId,actor,action,target,JSON.stringify(metadata)]);
      return result;
    },
  };
  if(options.legacy===true) return authorityTransaction(pool,async db=>{
    await lockWorkspaceAuthority(db,workspaceId);
    await transaction.authorizeMutation(db);
    return {result:await transaction.apply(db)};
  });
  return transactWorkspaceOperation(pool,transaction);
}
