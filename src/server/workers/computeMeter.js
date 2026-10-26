/**
 * XENO Compute's billing meter (leader only — index.js backgroundLeader.whenLeader). Every minute: settle each running
 * machine's finished hour and reserve the next, flag a machine whose next hour cannot be funded, and stop one that has
 * stayed unfunded past the grace — with the reason on its timeline (services/compute.meterRunningMachines).
 * A pass never overlaps the previous one.
 */
import { meterRunningMachines } from '../services/compute.js';

export function startComputeMeter(db, { intervalMs = 60_000 } = {}) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await meterRunningMachines(db);
      if (r.rolled || r.unfunded || r.stopped) console.log('[Compute] meter', JSON.stringify(r));
    } catch (e) { console.error('[Compute] meter failed:', e.message); }
    finally { busy = false; }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  console.log(`[Compute] meter every ${Math.round(intervalMs / 1000)}s (backend ${process.env.XENO_COMPUTE_API_URL ? 'configured' : 'NOT configured: machines cannot be created'})`);
  return () => clearInterval(timer);
}
