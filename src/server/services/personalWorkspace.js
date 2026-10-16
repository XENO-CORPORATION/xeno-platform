/**
 * The personal workspace: every person's tenancy root (migration 20261016180000). Its own module, with no billing,
 * seat or mail dependency, because everything that needs a root reaches it: signup, the workspace routes, divisions
 * and the workforce code. workspaceLifecycle.js re-exports it.
 */
import crypto from 'node:crypto';
import { writeTuples } from '../utils/authzReBAC.js';
import { operationError } from './workspaceOperationReceipts.js';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const slug = name => `${name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100)||'workspace'}-${crypto.randomBytes(12).toString('hex')}`;
async function audit(db, workspaceId, actor, action, target, metadata={}) {
  await db.query('INSERT INTO workspace_audit(workspace_id,actor_user_id,action,target,metadata) VALUES($1,$2,$3,$4,$5)',[workspaceId,actor,action,target,JSON.stringify(metadata)]);
}

/**
 * THE one way a person's personal workspace comes to exist (migration 20261016180000): every account-creation path
 * calls it, and every reader that needs the root asks it. Idempotent and race-safe: the unique index
 * uq_workspaces_personal holds one per owner, a lost race re-reads the winner, and the owner tuple is healed when
 * missing. Works inside a caller's transaction or on its own. An agent or a service principal is not a person and
 * is refused (it has no workspace of its own; it belongs to its owner's scope).
 */
export async function ensurePersonalWorkspace(db, userId) {
  if(!uuid.test(String(userId)))throw operationError(400,'invalid_workspace_request');
  const read=async(c)=>(await c.query("SELECT * FROM workspaces WHERE owner_user_id=$1 AND workspace_type='personal' LIMIT 1",[userId])).rows[0];
  const found=await read(db);
  if(found&&(await db.query(`SELECT 1 FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND relation='owner' AND subject_type='user' AND subject_id=$2`,[String(found.id),String(userId)])).rows.length)return found;
  // make (or heal) it under the account's lock, in one transaction: the row, its owner and its audit commit together,
  // and concurrent askers queue on the lock instead of racing the unique index
  const make=async(c)=>{
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`account-workspace-creation:${userId}`]);
    let workspace=await read(c);
    if(!workspace){
      const u=(await c.query(`SELECT u.username,u.display_name,u.role,EXISTS(SELECT 1 FROM agent_identities ai WHERE ai.user_id=u.id) AS is_agent FROM users u WHERE u.id=$1`,[userId])).rows[0];
      if(!u)throw operationError(404,'account_identity_unavailable');
      if(u.is_agent||u.role==='service')throw operationError(409,'not_a_person');
      const label=String(u.display_name||u.username||'Personal').trim()||'Personal';
      workspace=(await c.query(`INSERT INTO workspaces(owner_user_id,workspace_type,name,slug) VALUES($1,'personal',$2,$3) RETURNING *`,[userId,(/workspace/i.test(label)?label:`${label}'s Workspace`).slice(0,200),slug(label)])).rows[0];
      await audit(c,workspace.id,userId,'workspace.create',workspace.id,{type:'personal'});
    }
    await writeTuples(c,{writes:[{object:`workspace:${workspace.id}`,subject:`user:${userId}`,relation:'owner'}]});
    return workspace;
  };
  // inside a caller's transaction (a pooled client already in BEGIN, or a pool-less client) the work joins it;
  // given the pool, it runs in its own
  if(typeof db.connect!=='function'||typeof db.release==='function')return make(db);
  const c=await db.connect();
  try{await c.query('BEGIN');const w=await make(c);await c.query('COMMIT');return w;}
  catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
  finally{c.release();}
}
