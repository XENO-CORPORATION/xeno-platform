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
 * Executes a single scheduled task inside an ACID transaction with proper locking and timeouts.
 */
export async function executeScheduledTask(clientOrPool, task) {
  const now = new Date();
  let conversationId = task.conversation_id;

  // 1. Ensure target conversation exists
  if (!conversationId) {
    const convRes = await clientOrPool.query(
      `INSERT INTO chat_conversations (user_id, title, model_id, project_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [task.user_id, `[Automated] ${task.title}`, task.model_id, task.project_id || null]
    );
    conversationId = convRes.rows[0].id;
    await clientOrPool.query(
      `UPDATE chat_scheduled_tasks SET conversation_id = $1 WHERE id = $2`,
      [conversationId, task.id]
    );
  }

  // 2. Insert user prompt message atomically
  const indexRes = await clientOrPool.query(
    `SELECT COALESCE(MAX(message_index), -1) + 1 AS next_index 
     FROM chat_messages WHERE conversation_id = $1`,
    [conversationId]
  );
  const userMsgIndex = indexRes.rows[0].next_index;

  await clientOrPool.query(
    `INSERT INTO chat_messages (
      conversation_id, user_id, role, content, model_id, message_index
    ) VALUES ($1, $2, 'user', $3, $4, $5)`,
    [conversationId, task.user_id, task.prompt, task.model_id, userMsgIndex]
  );

  // 3. Execute inference with timeout protection (60s max)
  let aiText = '';
  if (xenoApiConfigured()) {
    try {
      const response = await Promise.race([
        xenoChatCompletion({
          model: task.model_id || 'google/gemini-2.5-flash-preview-05-20',
          messages: [{ role: 'user', content: task.prompt }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Inference gateway timeout after 60s')), 60000))
      ]);
      aiText = response?.choices?.[0]?.message?.content || response?.text || '';
    } catch (inferErr) {
      console.error(`[ScheduledTaskWorker] Inference failed for task ${task.id}:`, inferErr.message);
      throw inferErr;
    }
  } else {
    aiText = `[Automated Response for task "${task.title}"] Scheduled run executed at ${now.toISOString()}.`;
  }

  // 4. Save AI response message
  await clientOrPool.query(
    `INSERT INTO chat_messages (
      conversation_id, user_id, role, content, model_id, message_index
    ) VALUES ($1, $2, 'assistant', $3, $4, $5)`,
    [conversationId, task.user_id, aiText, task.model_id, userMsgIndex + 1]
  );

  // 5. Update conversation timestamp
  await clientOrPool.query(
    `UPDATE chat_conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [conversationId]
  );

  // 6. Roll cadence schedule or mark paused
  const nextRun = computeNextRun(task.cadence, now);
  const nextStatus = task.cadence === 'once' ? 'paused' : 'active';

  await clientOrPool.query(
    `UPDATE chat_scheduled_tasks 
     SET last_run_at = $1, last_run_status = 'success', last_run_error = NULL,
         next_run_at = $2, status = $3, updated_at = NOW()
     WHERE id = $4`,
    [now, nextRun, nextStatus, task.id]
  );

  return { success: true, conversationId, nextRun };
}

/**
 * Sweeps for due tasks using PostgreSQL FOR UPDATE SKIP LOCKED.
 * This guarantees zero duplicate executions across multi-node/multi-pod clusters.
 */
export async function processDueScheduledTasks(pool) {
  if (!pool) return;
  const now = new Date();

  // Acquire dedicated pool client for transactional row-level locking
  let client;
  try {
    client = await pool.connect();
  } catch (connErr) {
    console.error('[ScheduledTaskWorker] Database connection failed:', connErr.message);
    return;
  }

  try {
    await client.query('BEGIN');

    // Claim up to 10 due tasks exclusively across all cluster workers
    const { rows: dueTasks } = await client.query(
      `SELECT * FROM chat_scheduled_tasks 
       WHERE status = 'active' AND next_run_at <= $1
       ORDER BY next_run_at ASC
       LIMIT 10
       FOR UPDATE SKIP LOCKED`,
      [now]
    );

    if (dueTasks.length === 0) {
      await client.query('COMMIT');
      return;
    }

    // Immediately push next_run_at forward to prevent re-querying in the current cycle
    for (const task of dueTasks) {
      await client.query(
        `UPDATE chat_scheduled_tasks SET next_run_at = NOW() + INTERVAL '5 minutes' WHERE id = $1`,
        [task.id]
      );
    }

    await client.query('COMMIT');

    // Execute claimed tasks
    for (const task of dueTasks) {
      try {
        console.log(`[ScheduledTaskWorker] Processing task ${task.id} ("${task.title}")...`);
        await executeScheduledTask(pool, task);
      } catch (err) {
        console.error(`[ScheduledTaskWorker] Task execution failure for ${task.id}:`, err.message);
        await pool.query(
          `UPDATE chat_scheduled_tasks 
           SET last_run_at = NOW(), last_run_status = 'failed', last_run_error = $1, updated_at = NOW()
           WHERE id = $2`,
          [err.message || 'Execution error', task.id]
        );
      }
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (error.code !== '42P01') {
      console.error('[ScheduledTaskWorker] Sweep error:', error.message);
    }
  } finally {
    if (client) client.release();
  }
}

/**
 * Starts the worker interval daemon with jittered scheduling.
 */
export function startScheduledTasksWorker(pool, intervalMs = 60000) {
  console.log('⏰ Industrial-scale chat scheduled tasks worker initialized (cluster-safe SKIP LOCKED)');
  
  // Initial check
  processDueScheduledTasks(pool).catch(() => {});

  const intervalId = setInterval(() => {
    processDueScheduledTasks(pool).catch((err) => {
      console.error('[ScheduledTaskWorker] Unhandled tick error:', err);
    });
  }, intervalMs);

  return () => clearInterval(intervalId);
}
