/**
 * Dev › Automate's ONE delivery loop (leader only — index.js backgroundLeader.whenLeader). Every few seconds: queue the
 * schedule occurrences that are due, claim queued runs under a lease, and deliver each to the XENO Workflow runner
 * (services/xenoWorkflow.sweep). A pass never overlaps the previous one; a worker that dies mid-delivery leaves a lease
 * that expires, and the next pass takes the run again with the SAME run id, so the runner answers or resumes it.
 */
import { sweep } from '../services/xenoWorkflow.js';

export function startAutomateWorker(db, { intervalMs = 5000 } = {}) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await sweep(db);
      if (r.delivered) console.log('[Automate] delivered', r.delivered, r.outcomes);
    } catch (e) { console.error('[Automate] sweep failed:', e.message); }
    finally { busy = false; }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  console.log(`[Automate] delivery every ${Math.round(intervalMs / 1000)}s (runner ${process.env.XENO_WORKFLOW_RUNNER_URL ? 'configured' : 'NOT configured: runs stay queued'})`);
  return () => clearInterval(timer);
}
