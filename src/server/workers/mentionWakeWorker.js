/**
 * Starts agents named in channels (services/mentionWake.js). Leader only: a wake's daily count relies on one worker.
 * A pass never overlaps the previous one.
 */
import { drain } from '../services/mentionWake.js';

export function startMentionWakeWorker(db, { intervalMs = 5000 } = {}) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const n = await drain(db);
      if (n) console.log(`[MentionWake] started ${n}`);
    } catch (e) { console.error('[MentionWake] sweep failed:', e.message); }
    finally { busy = false; }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
