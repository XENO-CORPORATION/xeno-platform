import crypto from 'node:crypto';
import { listObjectTuples, writeTuples, ROLE_RANK } from '../utils/authzReBAC.js';
import { workspaceSeatInfo } from '../utils/workspaceContext.js';
import { authorityTransaction, lockWorkspaceAuthority, operationError, operationHash } from './workspaceOperationReceipts.js';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const slug = name => `${name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100)||'workspace'}-${crypto.randomBytes(12).toString('hex')}`;
export const inviteForAccount = (invite, user) => invite.invited_user_id
  ? invite.invited_user_id === user.id
  : !!user.email && String(invite.invited_email).toLowerCase() === user.email.toLowerCase();
async function audit(db, workspaceId, actor, action, target, metadata={}) {
  await db.query('INSERT INTO workspace_audit(workspace_id,actor_user_id,action,target,metadata) VALUES($1,$2,$3,$4,$5)',[workspaceId,actor,action,target,JSON.stringify(metadata)]);
}
async function activeAccount(db, actor) {
  const user=(await db.query('SELECT * FROM users WHERE id=$1 AND is_active=true',[actor])).rows[0];
  if(!user)throw operationError(403,'account_identity_unavailable');
  return user;
}
/** Called within a transaction. Account serialization also protects lazy personal
 * provisioning. No random workspace is used as an account operation namespace. */
export async function createAccountWorkspace(db, actor, name, type='team') {
  if(!uuid.test(actor)||!['personal','team'].includes(type)||typeof name!=='string'||!name.trim()||name.trim().length>200)throw operationError(400,'invalid_workspace_request');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`account-workspace-creation:${actor}`]);
  await activeAccount(db,actor);
  let workspace;
  if(type==='personal') {
    const existing=(await db.query("SELECT id FROM workspaces WHERE owner_user_id=$1 AND workspace_type='personal'",[actor])).rows[0];
    if(existing){
      await lockWorkspaceAuthority(db,existing.id);
      workspace=(await db.query('SELECT * FROM workspaces WHERE id=$1 FOR UPDATE',[existing.id])).rows[0];
      if(!workspace||workspace.owner_user_id!==actor||workspace.workspace_type!=='personal'||workspace.status!=='active')throw operationError(409,'workspace_identity_changed');
    }
  }
  const created=!workspace;
  if(created)workspace=(await db.query('INSERT INTO workspaces(owner_user_id,workspace_type,name,slug) VALUES($1,$2,$3,$4) RETURNING *',[actor,type,name.trim(),slug(name)])).rows[0];
  await writeTuples(db,{writes:[{object:`workspace:${workspace.id}`,subject:`user:${actor}`,relation:'owner'}]});
  if(created)await audit(db,workspace.id,actor,'workspace.create',workspace.id,{type});
  return workspace;
}
export async function provisionPersonalWorkspace(pool, user) {
  const label=String(user.display_name||user.username||'Personal').trim();
  return authorityTransaction(pool,db=>createAccountWorkspace(db,user.id,(/workspace/i.test(label)?label:`${label}'s Workspace`).slice(0,200),'personal'));
}
/** Workspace gate -> workspace row -> invitation row, identical to administrator
 * operations. The initial locator is NOT authority: every field is re-read locked. */
export async function lockAccountInvite(db, actor, inviteId) {
  if(!uuid.test(inviteId))throw operationError(400,'invalid_invite_request');
  const locator=(await db.query('SELECT workspace_id FROM workspace_invites WHERE id=$1',[inviteId])).rows[0];
  if(!locator)throw operationError(404,'invite_not_found');
  await lockWorkspaceAuthority(db,locator.workspace_id);
  const workspace=(await db.query('SELECT *,extract(epoch FROM created_at)::text AS incarnation FROM workspaces WHERE id=$1 FOR UPDATE',[locator.workspace_id])).rows[0];
  if(!workspace||workspace.status!=='active')throw operationError(403,'workspace_identity_unavailable');
  const invite=(await db.query('SELECT *,extract(epoch FROM created_at)::text AS incarnation,extract(epoch FROM expires_at)::text AS expiry_revision,expires_at<=now() AS expired FROM workspace_invites WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[inviteId,workspace.id])).rows[0];
  const user=await activeAccount(db,actor);
  if(!invite||!inviteForAccount(invite,user))throw operationError(404,'invite_not_found');
  const targetHash=operationHash([workspace.id,workspace.incarnation,invite.id,invite.incarnation,invite.invited_user_id,invite.invited_email,invite.role,invite.expiry_revision]);
  return {workspace,invite,targetHash};
}
export async function decideWorkspaceInvite(db, actor, inviteId, action, expectedTargetHash) {
  if(!['accept','decline'].includes(action))throw operationError(400,'invalid_invite_request');
  const {workspace,invite,targetHash}=await lockAccountInvite(db,actor,inviteId);
  if(expectedTargetHash!==undefined&&expectedTargetHash!==targetHash)throw operationError(409,'invite_identity_changed');
  if(invite.status!=='pending')throw operationError(409,'invite_not_pending');
  if(invite.expired) {
    await db.query("UPDATE workspace_invites SET status='expired' WHERE id=$1",[invite.id]);
    await audit(db,workspace.id,actor,'invite.expire',invite.id);
    // A terminal expiry transition must commit even though acceptance is refused.
    return {rejection:'invite_expired'};
  }
  if(action==='accept') {
    if(!['admin','editor','viewer'].includes(invite.role))throw operationError(403,'invalid_invite_role');
    const members=new Map();
    for(const tuple of await listObjectTuples(db,`workspace:${workspace.id}`))if(tuple.subject.startsWith('user:')) {
      const id=tuple.subject.slice(5),prior=members.get(id);
      if(!prior||(ROLE_RANK[tuple.relation]??0)>(ROLE_RANK[prior]??0))members.set(id,tuple.relation);
    }
    const seats=await workspaceSeatInfo(db,workspace.id,members.size);
    if(!members.has(actor)&&members.size>=seats.limit)throw operationError(402,'seat_limit');
    // Preserve the existing highest-role membership semantics for an already
    // present invitee. Changing that product policy is outside this transaction fix.
    await writeTuples(db,{writes:[{object:`workspace:${workspace.id}`,subject:`user:${actor}`,relation:invite.role}]});
  }
  const updated=(await db.query(action==='accept'
    ? "UPDATE workspace_invites SET status='accepted',accepted_at=now(),invited_user_id=$2 WHERE id=$1 RETURNING *"
    : "UPDATE workspace_invites SET status='declined',invited_user_id=$2 WHERE id=$1 RETURNING *",[invite.id,actor])).rows[0];
  await audit(db,workspace.id,actor,`invite.${action}`,invite.id,{role:invite.role});
  return {invite:{id:updated.id,workspace_id:workspace.id,status:updated.status},workspace_id:workspace.id};
}
