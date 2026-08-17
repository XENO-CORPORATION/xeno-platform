import React, { useEffect, useRef } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
 * DOT MATRIX — the texture behind the "full XENO experience" bar.
 *
 * A field of cells that breathe, a sweep that travels across them, and a glow
 * that follows the pointer. It fades up when the bar is hovered, so choosing
 * everything feels like waking something rather than ticking a box.
 *
 * ── WHAT CHANGED FROM THE REFERENCE IMPLEMENTATION ─────────────────────────
 *
 * The original runs `requestAnimationFrame` unconditionally, forever. On a
 * screen that mostly sits idle that is a permanent CPU draw — and on a laptop
 * it is a permanent FAN. The loop here starts when `active` goes true and
 * STOPS when it goes false, so the cost exists only while somebody is looking
 * at it.
 *
 * It also cancels on unmount. A leaked rAF loop holding a canvas ref survives
 * the component, keeps painting into a detached context, and is invisible
 * until the tab is slow — this flow mounts and unmounts on every step change,
 * so that would compound five times per run.
 *
 * ── WHY CANVAS AND NOT CSS ─────────────────────────────────────────────────
 *
 * ~500 independently-animated cells with a pointer-tracking falloff is not
 * something CSS can express without ~500 DOM nodes, and 500 nodes with
 * per-frame opacity is far more expensive than one canvas. This is the case
 * canvas is actually for.
 *
 * `aria-hidden` and pointer-events-none throughout: it is texture, it carries
 * no meaning, and it must never intercept a click meant for the bar.
 * ═══════════════════════════════════════════════════════════════════════════ */

type Cell = { x: number; y: number; phase: number; speed: number; base: number };

const CFG = {
  pitch: 22,
  cellSize: 8,
  cornerRadius: 1.5,
  cellColor: '#8f8fa0',
  glowRadius: 150,
  sweepSpeed: 0.35,
  sweepWidth: 0.45,
  /** Cells fade toward the top edge, so the texture sits in the bar's floor
   *  rather than competing with the label. */
  fadeDir: 'tb' as const,
  axis: 'x' as const,
  dir: -1,
};

export const DotMatrix: React.FC<{ active: boolean; className?: string }> = ({
  active, className = '',
}) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const raf = useRef<number | undefined>(undefined);
  const mouse = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    // Motion is the entire content here, so reduced-motion gets nothing rather
    // than a frozen grid — a static dot field is visual noise with no purpose.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let cells: Cell[] = [];
    let w = 0;
    let h = 0;

    const build = () => {
      // Capped at 2: beyond that the pixel count quadruples for a texture
      // nobody is inspecting, and this runs behind a hover.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = c.clientWidth;
      h = c.clientHeight;
      if (!w || !h) return;
      c.width = w * dpr;
      c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cells = [];
      for (let y = CFG.pitch / 2; y < h; y += CFG.pitch) {
        for (let x = CFG.pitch / 2; x < w; x += CFG.pitch) {
          cells.push({
            x: Math.round(x),
            y: Math.round(y),
            // Random phase and speed so the field breathes rather than
            // pulsing in unison, which would read as a strobe.
            phase: Math.random() * Math.PI * 2,
            speed: 0.4 + Math.random() * 1.6,
            base: Math.random(),
          });
        }
      }
    };

    const falloff = (x: number, y: number) => {
      const ramp = (u: number) => Math.max(0, Math.min(1, (u - 0.28) / 0.62));
      if (CFG.fadeDir === 'tb') return ramp(1 - y / h);
      return ramp(y / h);
    };

    const onMove = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onLeave = () => { mouse.current = { x: -9999, y: -9999 }; };

    const ro = new ResizeObserver(build);
    ro.observe(c);
    build();

    // The pointer listener is on the PARENT, not the canvas: the canvas is
    // pointer-events-none so it can never swallow a click on the bar, which
    // also means it receives no pointer events of its own.
    const host = c.parentElement;
    host?.addEventListener('pointermove', onMove);
    host?.addEventListener('pointerleave', onLeave);

    /* `roundRect` is Chrome 99+ / Safari 16.4+. On anything older it is
     * undefined and calling it throws — INSIDE the rAF loop, so it would throw
     * on every frame rather than once, and the console would fill while the
     * bar sat there blank. Resolved once here rather than branching per cell
     * (~500 checks a frame for a fact that cannot change mid-session). */
    const hasRoundRect = typeof ctx.roundRect === 'function';

    const t0 = performance.now();
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      const cycle = 1 + CFG.sweepWidth;
      const prog = (t * CFG.sweepSpeed) % cycle;
      const head = CFG.dir === 1 ? prog - CFG.sweepWidth : 1 - prog;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = CFG.cellColor;

      for (const cell of cells) {
        const f = falloff(cell.x, cell.y);
        if (f <= 0.001) continue;

        const u = CFG.axis === 'x' ? cell.x / w : cell.y / h;
        const rel = (u - head) / CFG.sweepWidth;
        const sweep = rel > 0 && rel < 1 ? Math.sin(rel * Math.PI) : 0;

        let a = f * (
          0.16
          + 0.34 * cell.base
          + 0.30 * (0.5 + 0.5 * Math.sin(t * cell.speed + cell.phase))
          + 0.55 * sweep * (0.4 + 0.6 * cell.base)
        );

        const dx = cell.x - mouse.current.x;
        const dy = cell.y - mouse.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CFG.glowRadius) a += (1 - dist / CFG.glowRadius) * 0.75;

        ctx.globalAlpha = Math.min(a, 1);
        const px = cell.x - (CFG.cellSize >> 1);
        const py = cell.y - (CFG.cellSize >> 1);
        if (hasRoundRect) {
          ctx.beginPath();
          ctx.roundRect(px, py, CFG.cellSize, CFG.cellSize, CFG.cornerRadius);
          ctx.fill();
        } else {
          // Square corners at 8px are a rounding detail nobody will miss —
          // far better than a blank bar and a flooded console.
          ctx.fillRect(px, py, CFG.cellSize, CFG.cellSize);
        }
      }

      ctx.globalAlpha = 1;
      raf.current = requestAnimationFrame(frame);
    };

    if (active && !reduced) {
      raf.current = requestAnimationFrame(frame);
    } else {
      // Leaving the bar clears the field rather than freezing it mid-sweep,
      // so the fade-out has nothing stale underneath it.
      ctx.clearRect(0, 0, w, h);
    }

    return () => {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
      ro.disconnect();
      host?.removeEventListener('pointermove', onMove);
      host?.removeEventListener('pointerleave', onLeave);
    };
  }, [active]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-500 ease-out ${
        active ? 'opacity-100' : 'opacity-0'
      } ${className}`}
    />
  );
};

export default DotMatrix;
