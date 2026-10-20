// shot — a screenshot of the page at 1440 px when SHOT_DIR is set (layout evidence for a review); a no-op otherwise.
import path from 'node:path'; import fs from 'node:fs';
export async function shot(p, name) {
  const dir = process.env.SHOT_DIR; if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const vp = p.viewport(); await p.setViewport({ width: 1440, height: 900 }); await new Promise((r) => setTimeout(r, 250));
  await p.screenshot({ path: path.join(dir, name + '.png') }); if (vp) await p.setViewport(vp);
}
