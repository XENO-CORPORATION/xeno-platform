import crypto from 'crypto';
import { xenoChatCompletion, xenoApiConfigured } from '../utils/xenoChat.js';
import { calculateNextScheduleOccurrence } from '../services/chatScheduleRecurrence.js';
import { assembleProjectContext } from '../services/chatProjectContext.js';
import { buildUntrustedProjectDataMessage, inertProviderMessageText } from '../services/chatProjectPrompt.js';
import { requireResourceRelation, userPrincipal, withTransaction } from '../services/chatProjectAuthority.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { meterPremiumChat } from '../utils/inferenceMeter.js';

export function computeNextRun(cadence, fromDate = new Date()) {
  if (cadence === 'once') return new Date(fromDate);
  const rule = cadence === 'weekly' ? 'FREQ=WEEKLY' : cadence === 'monthly' ? 'FREQ=MONTHLY' : 'FREQ=DAILY';
  return calculateNextScheduleOccurrence({
    scheduleKind: 'recurring', dtstartLocal: fromDate.toISOString().slice(0, 19),
    timeZone: 'UTC', rrule: rule, after: fromDate,
  });
}

const SAFE_SCHEDULE_ERRORS = new Map([
  ['principal_missing', 'The run identity no longer exists.'],
  ['principal_inactive', 'The run identity is inactive.'],
  ['account_not_activated', 'The run identity is not activated.'],
  ['resource_not_found', 'Project access is no longer available.'],
  ['INSUFFICIENT_CREDITS', 'The account has insufficient credits.'],
  ['ACCOUNT_FROZEN', 'The account is currently unavailable.'],
  ['gateway_unavailable', 'The inference service is unavailable.'],
  ['ambiguous_gateway_outcome', 'The provider outcome is unknown and requires reconciliation.'],
  ['empty_gateway_result', 'The inference service returned an empty response.'],
]);

export function sanitizeScheduledRunError(code) {
  return SAFE_SCHEDULE_ERRORS.get(String(code || '')) || 'Scheduled execution failed.';
}

function recurrenceInput(task) {
  const raw = task.dtstart_local instanceof Date ? task.dtstart_local.toISOString() : String(task.dtstart_local).replace(' ', 'T');
  return {
    scheduleKind: task.schedule_kind,
    dtstartLocal: raw.replace(/Z$/, '').slice(0, 19),
    timeZone: task.timezone,
    rrule: task.rrule,
  };
}

const ACTIVE_RUN_STATES = ['pending', 'leased', 'running', 'reconciliation_required'];

export function planDueOccurrences(task, now = new Date()) {
  const nowDate = new Date(now);
  const first = new Date(task.next_run_at);
  if (!Number.isFinite(first.getTime()) || first > nowDate) return { runs: [], next: first };

  const occurrences = [];
  let cursor = first;
  const hardLimit = 10_000;
  while (cursor && cursor <= nowDate && occurrences.length < hardLimit) {
    occurrences.push(cursor);
    if (task.schedule_kind === 'once') {
      cursor = null;
      break;
    }
    cursor = calculateNextScheduleOccurrence({ ...recurrenceInput(task), after: cursor });
  }

  const windowStart = new Date(nowDate.getTime() - Math.max(Number(task.catch_up_window_seconds) || 60, 60) * 1000);
  const eligible = occurrences.filter((date) => date >= windowStart);
  if (cursor && cursor <= nowDate) {
    throw Object.assign(new Error('Schedule expansion exceeded downtime safety bound'), { code: 'schedule_expansion_limit' });
  }
  const boundedSkipped = (values) => values.slice(-Math.max(Number(task.max_catch_up_runs) || 1, 1));
  if (task.misfire_policy === 'skip') return { runs: [], skipped: boundedSkipped(occurrences), next: cursor };
  if (task.misfire_policy === 'catch_up') {
    return {
      runs: eligible.slice(0, Math.max(Number(task.max_catch_up_runs) || 1, 1)),
      skipped: boundedSkipped(occurrences.filter((date) => !eligible.includes(date))),
      next: cursor,
    };
  }
  return {
    runs: eligible.length ? [eligible[eligible.length - 1]] : [],
    skipped: boundedSkipped(occurrences.slice(0, -1)),
    next: cursor,
  };
}

export async function dispatchDueScheduledRuns(pool, limit = 20) {
  return withTransaction(pool, async (tx) => {
    const { rows: tasks } = await tx.query(
      `SELECT * FROM chat_scheduled_tasks WHERE status = 'active' AND next_run_at <= NOW()
       ORDER BY next_run_at, id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [Math.min(Math.max(limit, 1), 100)],
    );
    const dispatched = [];
    for (const task of tasks) {
      const plan = planDueOccurrences(task, new Date());
      const active = (await tx.query(
        `SELECT count(*)::integer AS count FROM chat_scheduled_runs
         WHERE task_id=$1 AND status = ANY($2::text[])`,
        [task.id, ACTIVE_RUN_STATES],
      )).rows[0].count;
      let queued = active > 0;
      let overlapQueueUsed = false;
      for (const scheduledFor of [...(plan.skipped || [])]) {
        await tx.query(
          `INSERT INTO chat_scheduled_runs(task_id, occurrence_key, scheduled_for, status, completed_at,
             error_code, error_message)
           VALUES ($1,$2,$3,'skipped',NOW(),'schedule_misfire_skipped','Occurrence skipped by its misfire policy')
           ON CONFLICT(task_id, occurrence_key) DO NOTHING`,
          [task.id, `scheduled:${scheduledFor.toISOString()}`, scheduledFor],
        );
      }
      for (const scheduledFor of plan.runs) {
        const canQueue = !queued || (task.overlap_policy === 'queue_one' && !overlapQueueUsed);
        const status = canQueue ? 'pending' : 'skipped';
        const inserted = await tx.query(
          `INSERT INTO chat_scheduled_runs(task_id, occurrence_key, scheduled_for, status, completed_at,
             error_code, error_message)
           VALUES ($1,$2,$3,$4,CASE WHEN $4='skipped' THEN NOW() ELSE NULL END,
             CASE WHEN $4='skipped' THEN 'schedule_overlap' ELSE NULL END,
             CASE WHEN $4='skipped' THEN 'Occurrence skipped because an earlier run is active' ELSE NULL END)
           ON CONFLICT(task_id, occurrence_key) DO NOTHING RETURNING *`,
          [task.id, `scheduled:${scheduledFor.toISOString()}`, scheduledFor, status],
        );
        if (inserted.rows[0]?.status === 'pending') {
          dispatched.push(inserted.rows[0]);
          if (queued) overlapQueueUsed = true;
          queued = true;
        }
      }
      const next = plan.next;
      await tx.query(
        `UPDATE chat_scheduled_tasks SET next_run_at = COALESCE($2, next_run_at),
           status = CASE WHEN $2::timestamptz IS NULL THEN 'paused' ELSE status END,
           paused_reason = CASE WHEN $2::timestamptz IS NULL THEN 'completed_once' ELSE NULL END,
           updated_at = NOW() WHERE id = $1`,
        [task.id, next],
      );
    }
    return dispatched;
  });
}

export function startRunLeaseHeartbeat(pool, run, workerId, leaseSeconds = 120) {
  const cadenceMs = Math.max(Math.floor(leaseSeconds * 1000 / 3), 1000);
  let stopped = false;
  const beat = async () => {
    if (stopped) return;
    try {
      await pool.query(
        `UPDATE chat_scheduled_runs SET lease_expires_at=NOW() + ($3 * INTERVAL '1 second'),updated_at=NOW()
         WHERE id=$1 AND lease_owner=$2 AND status IN ('leased','running')`,
        [run.id, workerId, leaseSeconds],
      );
    } catch (error) {
      console.error(`[ScheduledTaskWorker] lease heartbeat ${run.id}:`, error.message);
    }
  };
  const timer = setInterval(beat, cadenceMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export async function claimScheduledRun(pool, workerId, leaseSeconds = 120) {
  return withTransaction(pool, async (tx) => {
    await tx.query(
      `UPDATE chat_scheduled_runs r
       SET status='reconciliation_required', error_code='ambiguous_worker_loss',
           error_message='Worker lease expired after provider execution began without a staged result',
           lease_owner=NULL, lease_expires_at=NULL, updated_at=NOW()
       FROM chat_scheduled_tasks t
       WHERE r.task_id=t.id AND r.status='running' AND r.lease_expires_at < NOW() AND r.result_staging IS NULL`,
    );
    await tx.query(
      `UPDATE chat_scheduled_runs r
       SET status='failed', error_code='max_attempts_exhausted', error_message='Maximum run attempts exhausted',
           completed_at=NOW(), lease_owner=NULL, lease_expires_at=NULL, updated_at=NOW()
       FROM chat_scheduled_tasks t
       WHERE r.task_id=t.id AND r.attempt_count >= t.max_attempts
         AND (r.status='pending' OR (r.status='leased' AND r.lease_expires_at < NOW()))`,
    );
    const { rows } = await tx.query(
      `SELECT r.id FROM chat_scheduled_runs r
       JOIN chat_scheduled_tasks t ON t.id=r.task_id
       WHERE r.attempt_count < t.max_attempts AND (
         r.status = 'pending'
         OR (r.status = 'leased' AND r.lease_expires_at < NOW())
         OR (r.status = 'running' AND r.lease_expires_at < NOW() AND r.result_staging IS NOT NULL)
       )
       ORDER BY r.scheduled_for, r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
    );
    if (!rows[0]) return null;
    return (await tx.query(
      `UPDATE chat_scheduled_runs SET status = 'leased', lease_owner = $2,
         lease_expires_at = NOW() + ($3 * INTERVAL '1 second'), attempt_count = attempt_count + 1,
         updated_at = NOW() WHERE id = $1 RETURNING *`,
      [rows[0].id, workerId, leaseSeconds],
    )).rows[0];
  });
}

async function ensureConversation(pool, task, run) {
  if (task.conversation_id) return task.conversation_id;
  return withTransaction(pool, async (tx) => {
    const locked = (await tx.query('SELECT conversation_id FROM chat_scheduled_tasks WHERE id = $1 FOR UPDATE', [task.id])).rows[0];
    if (locked.conversation_id) return locked.conversation_id;
    const { rows } = await tx.query(
      `INSERT INTO chat_conversations(
         user_id, owner_user_id, created_by_user_id, title, model_id, project_id, workspace_id
       ) VALUES ($1, CASE WHEN $4::uuid IS NULL THEN $1 ELSE NULL END, $1, $2, $3, $4, NULL)
       RETURNING id`,
      [task.run_as_user_id, `[Automated] ${task.title}`, task.model_id, task.project_id],
    );
    await writeTuples(tx, { writes: [{
      object: `conversation:${rows[0].id}`, relation: task.project_id ? 'parent' : 'owner',
      subject: task.project_id ? `project:${task.project_id}` : `user:${task.run_as_user_id}`,
    }] });
    await tx.query('UPDATE chat_scheduled_tasks SET conversation_id = $2 WHERE id = $1', [task.id, rows[0].id]);
    await tx.query('UPDATE chat_scheduled_runs SET conversation_id = $2 WHERE id = $1', [run.id, rows[0].id]);
    return rows[0].id;
  });
}

export async function publishMessages(pool, { run, task, conversationId, assistantText, contextManifest = null }) {
  return withTransaction(pool, async (tx) => {
    await tx.query('SELECT id FROM chat_conversations WHERE id = $1 FOR UPDATE', [conversationId]);
    const already = await tx.query(
      "SELECT role,message_index FROM chat_messages WHERE scheduled_run_id = $1 AND role IN ('user','assistant')",
      [run.id],
    );
    if (already.rows.length === 2) {
      if (task.project_id && contextManifest) {
        const assistantId = (await tx.query(
          "SELECT id FROM chat_messages WHERE scheduled_run_id=$1 AND role='assistant'",
          [run.id],
        )).rows[0]?.id;
        if (assistantId) await tx.query(
          `INSERT INTO chat_message_context_manifests(message_id,project_id,context_manifest)
           VALUES($1,$2,$3::jsonb) ON CONFLICT(message_id) DO NOTHING`,
          [assistantId, task.project_id, JSON.stringify(contextManifest)],
        );
      }
      await tx.query("UPDATE chat_scheduled_runs SET status='succeeded',result_staging=NULL,completed_at=NOW(),updated_at=NOW() WHERE id=$1", [run.id]);
      return;
    }
    const existingUser = already.rows.find((row) => row.role === 'user');
    const existingAssistant = already.rows.find((row) => row.role === 'assistant');
    const nextIndex = existingUser
      ? Number(existingUser.message_index)
      : existingAssistant
        ? Number(existingAssistant.message_index) - 1
        : Number((await tx.query(
          'SELECT COALESCE(MAX(message_index), -1) + 1 AS next_index FROM chat_messages WHERE conversation_id = $1', [conversationId],
        )).rows[0].next_index);
    await tx.query(
      `INSERT INTO chat_messages(
         conversation_id,user_id,created_by_user_id,role,content,model_id,message_index,scheduled_run_id
       ) VALUES($1,$2,$2,'user',$3,$4,$5,$6)
       ON CONFLICT(scheduled_run_id,role) WHERE scheduled_run_id IS NOT NULL AND role IN ('user','assistant') DO NOTHING`,
      [conversationId, task.run_as_user_id, task.prompt, task.model_id, nextIndex, run.id],
    );
    const assistantInsert = await tx.query(
      `INSERT INTO chat_messages(
         conversation_id,user_id,created_by_user_id,role,content,model_id,message_index,scheduled_run_id
       ) VALUES($1,$2,$2,'assistant',$3,$4,$5,$6)
       ON CONFLICT(scheduled_run_id,role) WHERE scheduled_run_id IS NOT NULL AND role IN ('user','assistant') DO NOTHING
       RETURNING id`,
      [conversationId, task.run_as_user_id, assistantText, task.model_id, nextIndex + 1, run.id],
    );
    if (task.project_id && contextManifest) {
      const assistantId = assistantInsert.rows[0]?.id || (await tx.query(
        "SELECT id FROM chat_messages WHERE scheduled_run_id=$1 AND role='assistant'",
        [run.id],
      )).rows[0]?.id;
      if (assistantId) await tx.query(
        `INSERT INTO chat_message_context_manifests(message_id,project_id,context_manifest)
         VALUES($1,$2,$3::jsonb) ON CONFLICT(message_id) DO NOTHING`,
        [assistantId, task.project_id, JSON.stringify(contextManifest)],
      );
    }
    await tx.query('UPDATE chat_conversations SET last_message_at=NOW(),updated_at=NOW() WHERE id=$1', [conversationId]);
    await tx.query(
      `UPDATE chat_scheduled_runs SET status='succeeded',result_staging=NULL,completed_at=NOW(),
       lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW() WHERE id=$1`, [run.id],
    );
    await tx.query(
      `UPDATE chat_scheduled_tasks SET last_run_at=NOW(),last_run_status='success',last_run_error=NULL,updated_at=NOW() WHERE id=$1`,
      [task.id],
    );
  });
}

export async function executeScheduledRun(pool, run) {
  const task = (await pool.query('SELECT * FROM chat_scheduled_tasks WHERE id=$1', [run.task_id])).rows[0];
  if (!task || !task.run_as_user_id) throw Object.assign(new Error('Scheduled principal is unavailable'), { code: 'principal_missing' });
  const principalState = (await pool.query(
    `SELECT u.is_active,u.status,u.deleted_at,EXISTS(SELECT 1 FROM account_activations a WHERE a.user_id=u.id) AS activated
     FROM users u WHERE u.id=$1`,
    [task.run_as_user_id],
  )).rows[0];
  if (!principalState || principalState.deleted_at || !principalState.is_active || principalState.status !== 'active') {
    throw Object.assign(new Error('Scheduled principal is inactive'), { code: 'principal_inactive' });
  }
  if (!principalState.activated) throw Object.assign(new Error('Scheduled principal is not activated'), { code: 'account_not_activated' });
  const principal = userPrincipal(task.run_as_user_id);
  if (task.project_id) await requireResourceRelation(pool, principal, 'project', task.project_id, 'reviewer');
  const conversationId = await ensureConversation(pool, task, run);
  await requireResourceRelation(pool, principal, 'conversation', conversationId, 'reviewer');
  const context = task.project_id ? await assembleProjectContext({
    db: pool, principal, projectId: task.project_id, conversationId, query: task.prompt,
    modelId: task.model_id, maxInputTokens: 16_000, requiredRelation: 'reviewer',
  }) : null;
  await pool.query(
    `UPDATE chat_scheduled_runs SET status='running',conversation_id=$2,context_manifest=$3::jsonb,
     model_id=$4,started_at=COALESCE(started_at,NOW()),updated_at=NOW() WHERE id=$1`,
    [run.id, conversationId, JSON.stringify(context?.manifest || {}), task.model_id],
  );
  let staging = run.result_staging;
  if (!staging) {
    if (!xenoApiConfigured()) throw Object.assign(new Error('XENO inference gateway is not configured'), { code: 'gateway_unavailable' });
    const messages = [];
    if (context?.instructions) messages.push({ role: 'system', content: context.instructions });
    if (context?.contentBlocks?.length) messages.push(buildUntrustedProjectDataMessage(context.contentBlocks));
    messages.push({ role: 'user', content: task.prompt });
    try {
      const metered = await meterPremiumChat(pool, task.run_as_user_id, {
        model: task.model_id,
        provider: 'xeno',
        requestId: run.id,
        estInputTokens: Math.ceil(messages.reduce((sum, message) => sum + String(message.content || '').length, 0) / 4),
        maxTokens: 4096,
        surface: 'scheduled_chat',
        run: () => Promise.race([
          xenoChatCompletion({
            model: task.model_id,
            messages,
            max_tokens: 4096,
            headers: {
              'x-xeno-run-key': run.id,
              ...(run.gateway_retry_authorized ? { 'x-xeno-run-retry': 'acknowledged' } : {}),
            },
          }),
          new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Inference gateway timeout'), { code: 'ambiguous_gateway_outcome' })), 60_000)),
        ]),
      });
      const response = metered.result;
      const content = inertProviderMessageText(response?.choices?.[0]?.message) || response?.text || '';
      if (!String(content).trim()) throw Object.assign(new Error('Inference gateway returned an empty response'), { code: 'empty_gateway_result' });
      staging = { content, provider_request_id: response.id || null };
      await pool.query(
        'UPDATE chat_scheduled_runs SET result_staging=$2::jsonb,provider_request_id=$3,gateway_retry_authorized=FALSE,updated_at=NOW() WHERE id=$1',
        [run.id, JSON.stringify(staging), staging.provider_request_id],
      );
    } catch (error) {
      if (error.code === 'ambiguous_gateway_outcome') await pool.query(
        `UPDATE chat_scheduled_runs SET status='reconciliation_required',error_code=$2,error_message=$3,
         lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW() WHERE id=$1`, [run.id, error.code, error.message],
      );
      throw error;
    }
  }
  await publishMessages(pool, {
    run,
    task,
    conversationId,
    assistantText: staging.content,
    contextManifest: context?.manifest || run.context_manifest || null,
  });
  return { success: true, runId: run.id, conversationId };
}

export async function executeScheduledTask(pool, task) {
  const run = (await pool.query(
    `INSERT INTO chat_scheduled_runs(task_id,occurrence_key,scheduled_for,status,attempt_count)
     VALUES($1,$2,NOW(),'leased',1) RETURNING *`, [task.id, `manual:${crypto.randomUUID()}`],
  )).rows[0];
  return executeScheduledRun(pool, run);
}

async function failRun(pool, run, error) {
  if (error.code === 'ambiguous_gateway_outcome') return;
  const terminalAuth = [
    'principal_missing', 'principal_inactive', 'account_not_activated', 'resource_not_found',
    'INSUFFICIENT_CREDITS', 'ACCOUNT_FROZEN',
  ].includes(error.code);
  await pool.query(
    `UPDATE chat_scheduled_runs SET status='failed',error_code=$2,error_message=$3,completed_at=NOW(),
     lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW() WHERE id=$1`,
    [run.id, error.code || 'execution_failed', sanitizeScheduledRunError(error.code)],
  );
  if (terminalAuth) await pool.query(
    `UPDATE chat_scheduled_tasks SET status='paused',paused_reason=$2,last_run_status='failed',last_run_error=$3,updated_at=NOW() WHERE id=$1`,
    [run.task_id, error.code, sanitizeScheduledRunError(error.code)],
  );
}

export async function executeScheduledRunWithFailureRecording(pool, run) {
  try {
    return await executeScheduledRun(pool, run);
  } catch (error) {
    await failRun(pool, run, error);
    throw error;
  }
}

export async function processDueScheduledTasks(pool) {
  if (!pool) return;
  await dispatchDueScheduledRuns(pool);
  const workerId = `${process.pid}:${crypto.randomUUID()}`;
  for (let count = 0; count < 20; count += 1) {
    const run = await claimScheduledRun(pool, workerId);
    if (!run) break;
    const stopHeartbeat = startRunLeaseHeartbeat(pool, run, workerId);
    try { await executeScheduledRunWithFailureRecording(pool, run); }
    catch (error) {
      console.error(`[ScheduledTaskWorker] run ${run.id} failed:`, error.message);
    } finally {
      stopHeartbeat();
    }
  }
}

export function startScheduledTasksWorker(pool, intervalMs = 60_000) {
  console.log('Scheduled Chat dispatcher and durable run worker initialized');
  processDueScheduledTasks(pool).catch((error) => console.error('[ScheduledTaskWorker] initial sweep:', error.message));
  const intervalId = setInterval(() => {
    processDueScheduledTasks(pool).catch((error) => console.error('[ScheduledTaskWorker] sweep:', error.message));
  }, intervalMs);
  intervalId.unref?.();
  return () => clearInterval(intervalId);
}
