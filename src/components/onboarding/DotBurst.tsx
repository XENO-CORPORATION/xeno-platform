import React, { useEffect, useRef } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
 * DOT BURST — a full-viewport field that erupts from the bar's edges.
 *
 * Hovering the "full XENO experience" bar darkens the ENTIRE viewport and
 * throws a dot-matrix outward from the bar's own edges, so the bar reads as
 * the source of it rather than as a panel with a texture inside.
 *
 * ── ORIGIN IS THE BAR'S RECT, NOT ITS CENTRE ───────────────────────────────
 *
 * The wavefront is measured from the nearest point on the bar's RECTANGLE, not
 * from a centre point. A radial burst from a centre reads as a circle over a
 * wide element — the light would appear to come from the middle of the bar and
 * leave its ends dark. Distance-to-rect makes the whole edge the source, which
 * is what "bursting from its edges" actually looks like.
 *
 * ── COST ───────────────────────────────────────────────────────────────────
 *
 * A viewport-sized field is many more cells than a bar-sized one, so:
 *   - the loop runs ONLY while active, and stops on leave
 *   - cells beyond the wavefront are skipped before any trig runs
 *   - dpr is capped at 2
 *   - it cancels on unmount, because this flow remounts on every step change
 *     and a leaked rAF painting into a detached canvas is invisible until the
 *     whole tab is slow
 *
 * `aria-hidden` + pointer-events-none: it is atmosphere. It must never
 * intercept the click it exists to advertise.
 * ═══════════════════════════════════════════════════════════════════════════ */

type Cell = { x: number; y: number; phase: number; speed: number; base: number; d: number };

const CFG = {
  pitch: 26,
  cellSize: 7,
  cornerRadius: 1.5,
  cellColor: '#a8a8bb',
  /** How far past the wavefront a cell still lights, in px. */
  featherPx: 220,
  /** Wavefront travel, px per second. */
  waveSpeed: 1500,
  glowRadius: 190,
};

export const DotBurst: React.FC<{
  active: boolean;
  /** The element the burst originates from. */
  originRef: React.RefObject<HTMLElement | null>;
}> = ({ active, originRef }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const raf = useRef<number | undefined>(undefined);
  const mouse = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    // Motion IS the content here — a frozen field is noise with no purpose.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!active || reduced) {
      ctx.clearRect(0, 0, c.width, c.height);
      return;
    }

    let cells: Cell[] = [];
    let w = 0;
    let h = 0;

    /** Shortest distance from a point to the origin rect — 0 anywhere inside. */
    const distToRect = (x: number, y: number, r: DOMRect) => {
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      return Math.sqrt(dx * dx + dy * dy);
    };

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // The rect is captured ONCE per build rather than read per frame:
      // getBoundingClientRect forces layout, and doing that 60x a second while
      // a full-viewport canvas paints is the classic way to make an effect
      // like this stutter.
      const r = originRef.current?.getBoundingClientRect()
        ?? new DOMRect(w / 2, h - 80, 0, 0);

      cells = [];
      for (let y = CFG.pitch / 2; y < h; y += CFG.pitch) {
        for (let x = CFG.pitch / 2; x < w; x += CFG.pitch) {
          // Cells INSIDE the bar are skipped — the burst comes out of it, so
          // painting dots over the label would contradict the whole idea.
          const d = distToRect(x, y, r);
          if (d < 6) continue;
          cells.push({
            x: Math.round(x),
            y: Math.round(y),
            phase: Math.random() * Math.PI * 2,
            speed: 0.4 + Math.random() * 1.6,
            base: Math.random(),
            d,
          });
        }
      }
    };

    const onMove = (e: PointerEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; };
    const onLeave = () => { mouse.current = { x: -9999, y: -9999 }; };

    build();
    window.addEventListener('resize', build);
    window.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onLeave);

    // roundRect is Chrome 99+ / Safari 16.4+. Older engines throw, and inside
    // the loop that means every frame — a blank screen and a flooded console.
    // Resolved once, not per cell.
    const hasRoundRect = typeof ctx.roundRect === 'function';

    const t0 = performance.now();
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      const wave = t * CFG.waveSpeed;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = CFG.cellColor;

      for (const cell of cells) {
        // Ahead of the wavefront: nothing. Cheapest possible rejection, before
        // any trig — most cells fail this for the first half-second.
        const lead = wave - cell.d;
        if (lead <= 0) continue;

        // Fades with distance from the bar, so the burst thins as it travels
        // instead of ending in a hard ring at the viewport edge.
        const reach = Math.max(0, 1 - cell.d / (Math.max(w, h) * 0.85));
        // The wavefront itself is brightest, then settles to an ambient level.
        const front = lead < CFG.featherPx ? Math.sin((lead / CFG.featherPx) * Math.PI) : 0;

        let a = reach * (
          0.10
          + 0.18 * cell.base
          + 0.14 * (0.5 + 0.5 * Math.sin(t * cell.speed + cell.phase))
          + 0.75 * front * (0.4 + 0.6 * cell.base)
        );

        const dx = cell.x - mouse.current.x;
        const dy = cell.y - mouse.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CFG.glowRadius) a += (1 - dist / CFG.glowRadius) * 0.55;

        if (a <= 0.004) continue;
        ctx.globalAlpha = Math.min(a, 1);

        const px = cell.x - (CFG.cellSize >> 1);
        const py = cell.y - (CFG.cellSize >> 1);
        if (hasRoundRect) {
          ctx.beginPath();
          ctx.roundRect(px, py, CFG.cellSize, CFG.cellSize, CFG.cornerRadius);
          ctx.fill();
        } else {
          ctx.fillRect(px, py, CFG.cellSize, CFG.cellSize);
        }
      }

      ctx.globalAlpha = 1;
      raf.current = requestAnimationFrame(frame);
    };

    raf.current = requestAnimationFrame(frame);

    return () => {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
      window.removeEventListener('resize', build);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [active, originRef]);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 h-full w-full" />;
};

export default DotBurst;
