import { sendEmail } from './emailService.js';
import { siteOrigin } from '../config/hosts.js';

/** Durable claim precedes external dispatch. A crash/unknown ACK is never
 * retried automatically. A separately confirmed resend creates a new delivery. */
export async function deliverWorkspaceInviteBatch(pool,{send=sendEmail,limit=10,signal}={}) {
  if (!Number.isSafeInteger(limit) || limit<1 || limit>20) throw new Error('Invalid invite delivery batch');
  let attempted=0;
  for (;attempted<limit && !signal?.aborted;attempted++) {
    const db=await pool.connect();let row;
    try {
      await db.query('BEGIN');
      row=(await db.query("SELECT * FROM workspace_invite_deliveries WHERE state='pending' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
      if (!row) {await db.query('COMMIT');break;}
      await db.query("UPDATE workspace_invite_deliveries SET state='dispatching',updated_at=now() WHERE id=$1",[row.id]);
      await db.query('COMMIT');
    } catch(error) {await db.query('ROLLBACK');throw error;} finally {db.release();}
    let state='unknown';
    const timeout=AbortSignal.timeout(15000), combined=signal ? AbortSignal.any([signal,timeout]) : timeout;
    try {
      const invite=(await pool.query(`SELECT i.*,w.name AS workspace_name,u.display_name AS inviter_name FROM workspace_invites i
        JOIN workspaces w ON w.id=i.workspace_id JOIN workspace_invite_deliveries d ON d.id=$3 LEFT JOIN users u ON u.id=i.invited_by_user_id
        WHERE i.id=$1 AND i.workspace_id=$2 AND w.status='active' AND i.status='pending' AND i.expires_at>now()
        AND i.expires_at=d.invite_expires_at`,[row.invite_id,row.workspace_id,row.id])).rows[0];
      if (!invite || combined.aborted) state='skipped';
      else {
        const base=new URL(process.env.PUBLIC_APP_URL || process.env.APP_URL || siteOrigin());
        const result=await send(pool,'workspace_invite',invite.invited_email,{workspace_name:invite.workspace_name,inviter_name:invite.inviter_name ?? '',
          role:invite.role === 'editor' ? 'member' : invite.role,accept_url:new URL(`/invite/${invite.token}`,base).href,expires_at:invite.expires_at},invite.invited_user_id,{signal:combined});
        state=result?.success === true ? 'accepted' : result?.skipped || result?.suppressed ? 'skipped' : 'unknown';
      }
    } catch {state='unknown';}
    await pool.query("UPDATE workspace_invite_deliveries SET state=$2,updated_at=now() WHERE id=$1 AND state='dispatching'",[row.id,state]);
  }
  return attempted;
}
export function startWorkspaceInviteDeliveryWorker(pool,{intervalMs=5000,send=sendEmail}={}) {
  let stopping=false,flight=Promise.resolve();const controller=new AbortController();
  const run=()=>{if(stopping)return;flight=deliverWorkspaceInviteBatch(pool,{send,signal:controller.signal}).catch(()=>{}).finally(()=>{if(!stopping)timer=setTimeout(run,intervalMs);});};
  let timer=setTimeout(run,0);timer.unref?.();
  return {async stop(){stopping=true;clearTimeout(timer);controller.abort();await flight;}};
}
