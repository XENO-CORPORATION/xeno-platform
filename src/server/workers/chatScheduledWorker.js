import { xenoChatCompletion, xenoApiConfigured } from '../utils/xenoChat.js';

/**
 * Computes the next execution timestamp based on cadence.
 */
export function computeNextRun(cadence, fromDate = new Date()) {
  const fromTime = fromDate.getTime();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  
  switch (cadence) {
    case 'daily':
      return new Date(fromTime + ONE_DAY);
    case 'weekly':
      return new Date(fromTime + 7 * ONE_DAY);
    case 'monthly':
      return new Date(fromTime + 30 * ONE_DAY);
    case 'once':
    default:
      return new Date(fromTime);
  }
}

/**
 * Executes a single scheduled task immediately.
 */
export async function executeScheduledTask(db, task) {
  const now = new Date();
  let conversationId = task.conversation_id;

  // 1. Ensure a target conversation exists
  if (!conversationId) {
    const convRes = await db.query(
      `INSERT INTO chat_conversations (user_id, title, model_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [task.user_id, `[Automated] ${task.title}`, task.model_id]
    );
    conversationId = convRes.rows[0].id;
    // Update task's conversation_id so subsequent runs append to the same thread
    await db.query(
      `UPDATE chat_scheduled_tasks SET conversation_id = $1 WHERE id = $2`,
      [conversationId, task.id]
    );
  }

  // 2. Insert user prompt message
  const indexRes = await db.query(
    `SELECT COALESCE(MAX(message_index), -1) + 1 AS next_index 
     FROM chat_messages WHERE conversation_id = $1`,
    [conversationId]
  );
  const userMsgIndex = indexRes.rows[0].next_index;

  await db.query(
    `INSERT INTO chat_messages (
      conversation_id, user_id, role, content, model_id, message_index
    ) VALUES ($1, $2, 'user', $3, $4, $5)`,
    [conversationId, task.user_id, task.prompt, task.model_id, userMsgIndex]
  );

  // 3. Execute inference if configured
  let aiText = '';
  if (xenoApiConfigured()) {
    const response = await xenoChatCompletion({
      model: task.model_id || 'google/gemini-2.5-flash-preview-05-20',
      messages: [{ role: 'user', content: task.prompt }],
    });
    aiText = response?.choices?.[0]?.message?.content || response?.text || '';
  } else {
    aiText = `[Automated Response for task "${task.title}"] Scheduled run executed at ${now.toISOString()}.`;
  }

  // 4. Save AI response
  await db.query(
    `INSERT INTO chat_messages (
      conversation_id, user_id, role, content, model_id, message_index
    ) VALUES ($1, $2, 'assistant', $3, $4, $5)`,
    [conversationId, task.user_id, aiText, task.model_id, userMsgIndex + 1]
  );

  // 5. Update conversation timestamp
  await db.query(
    `UPDATE chat_conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [conversationId]
  );

  // 6. Roll cadence or pause
  const nextRun = computeNextRun(task.cadence, now);
  const nextStatus = task.cadence === 'once' ? 'paused' : 'active';

  await db.query(
    `UPDATE chat_scheduled_tasks 
     SET last_run_at = $1, last_run_status = 'success', last_run_error = NULL,
         next_run_at = $2, status = $3, updated_at = NOW()
     WHERE id = $4`,
    [now, nextRun, nextStatus, task.id]
  );

  return { success: true, conversationId, nextRun };
}

/**
 * Sweeps for all due tasks across the platform and executes them.
 */
export async function processDueScheduledTasks(db) {
  if (!db) return;
  const now = new Date();

  try {
    const { rows: dueTasks } = await db.query(
      `SELECT * FROM chat_scheduled_tasks 
       WHERE status = 'active' AND next_run_at <= $1
       ORDER BY next_run_at ASC
       LIMIT 20`,
      [now]
    );

    for (const task of dueTasks) {
      try {
        console.log(`[ScheduledTaskWorker] Running task ${task.id} ("${task.title}")...`);
        await executeScheduledTask(db, task);
      } catch (err) {
        console.error(`[ScheduledTaskWorker] Failed task ${task.id}:`, err);
        await db.query(
          `UPDATE chat_scheduled_tasks 
           SET last_run_at = NOW(), last_run_status = 'failed', last_run_error = $1, updated_at = NOW()
           WHERE id = $2`,
          [err.message || 'Execution error', task.id]
        );
      }
    }
  } catch (error) {
    // Non-fatal if table not yet migrated
    if (error.code !== '42P01') {
      console.error('[ScheduledTaskWorker] Error polling due tasks:', error);
    }
  }
}

/**
 * Starts the worker interval daemon.
 */
export function startScheduledTasksWorker(db, intervalMs = 60000) {
  console.log('⏰ Chat scheduled tasks worker started (interval: 60s)');
  
  // Initial check
  processDueScheduledTasks(db).catch(() => {});

  const intervalId = setInterval(() => {
    processDueScheduledTasks(db).catch((err) => {
      console.error('[ScheduledTaskWorker] Unhandled error in tick:', err);
    });
  }, intervalMs);

  return () => clearInterval(intervalId);
}
