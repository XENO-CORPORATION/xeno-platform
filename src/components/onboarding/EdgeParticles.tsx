import React, { useEffect, useRef } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
 * EDGE PARTICLES — squares thrown off the bar's edges into the page.
 *
 * Hovering the "full XENO experience" bar darkens the viewport and the bar
 * starts SHEDDING particles: small squares born on its perimeter, each flying
 * outward along the normal of the edge it came from, decelerating and fading
 * as it goes.
 *
 * ── WHY A PARTICLE SYSTEM AND NOT THE GRID I BUILT FIRST ───────────────────
 *
 * The previous version was a fixed lattice of cells whose ALPHA rose as a
 * wavefront passed. Nothing ever moved. That reads as a surface lighting up —
 * which is a fine effect and completely unlike things being thrown off an
 * edge. Emission requires actual motion: a position that changes over time,
 * away from a source. There is no way to fake that with opacity.
 *
 * ── THE THINGS THAT MAKE IT LOOK RIGHT ─────────────────────────────────────
 *
 *  - Particles spawn ON the perimeter and travel along that edge's OUTWARD
 *    NORMAL. Spawning in a ring and moving radially would send top-edge
 *    particles sideways; per-edge normals are what make it read as the bar
 *    shedding rather than a blast centred behind it.
 *  - Speed and angular spread are randomised per particle. Uniform velocity
 *    reads as a curtain, not a spray.
 *  - Drag, so they decelerate into stillness instead of exiting at full speed.
 *  - Alpha follows a curve that rises fast and falls slowly, so a particle
 *    appears immediately and dissolves rather than blinking out.
 *
 * ── LIFECYCLE ──────────────────────────────────────────────────────────────
 *
 * Emission stops on pointer-leave, but the LOOP keeps running until the last
 * particle has died. Cutting it dead would snap several hundred squares out of
 * existence mid-flight; letting them finish is the difference between the
 * effect ending and the effect being switched off.
 *
 * dt-based, not per-frame constants: on a 144Hz display frame-count physics
 * runs 2.4x faster than on 60Hz, and the whole thing would feel like a
 * different animation on a gaming monitor.
 * ═══════════════════════════════════════════════════════════════════════════ */

type P = {
  x: number; y: number;
  vx: number; vy: number;
  life: number; ttl: number;
  size: number; spin: number;
};

const CFG = {
  /** Particles per second while hovering. */
  rate: 220,
  maxParticles: 900,
  speedMin: 90,
  speedMax: 420,
  /* Radians either side of the edge normal.
   *
   * 0.85 (~49 degrees, a ~98-degree cone) was too wide: particles leaving at
   * that angle travel almost PARALLEL to the border, so they read as drifting
   * along the bar rather than off it — and near the corners they cross into
   * the space beside the container instead of leaving from it. 0.32 (~18
   * degrees) keeps every particle visibly perpendicular to the edge it came
   * from, which is what makes the border look like the source. */
  spread: 0.32,
  ttlMin: 0.7,
  ttlMax: 1.9,
  sizeMin: 3,
  sizeMax: 8,
  cornerRadius: 1.5,
  /** Velocity retained per second — below 1 so they slow as they travel. */
  drag: 0.28,
  color: '#b4b4c8',
  glowRadius: 200,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * A rounded rectangle as a PATH, hand-built rather than via `ctx.roundRect`.
 *
 * roundRect is Chrome 99+ / Safari 16.4+, and this one is not decorative — it
 * cuts the hole the bar shows through. On an engine without it the whole
 * screen would go flat black over the bar, which is a far worse failure than
 * square particle corners. Arcs are universally supported.
 */
function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export const EdgeParticles: React.FC<{
  active: boolean;
  originRef: React.RefObject<HTMLElement | null>;
  /** Regions particles must never paint over — the suite cards. */
  excludeRefs?: React.RefObject<HTMLElement | null>[];
}> = ({ active, originRef, excludeRefs }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const raf = useRef<number | undefined>(undefined);
  const particles = useRef<P[]>([]);
  const emitting = useRef(false);
  const mouse = useRef({ x: -9999, y: -9999 });
  /** Set by the setup effect; called by the start effect below. */
  const start = useRef<() => void>(() => {});

  // Kept in a ref so toggling `active` never restarts the loop or clears the
  // particles already in flight.
  emitting.current = active;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    // Motion is the entire content; a frozen spray is meaningless.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    let w = 0;
    let h = 0;
    let rect: DOMRect | null = null;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onMove = (e: PointerEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove);

    // roundRect is Chrome 99+ / Safari 16.4+; older engines throw, and inside
    // the loop that means every frame. Resolved once.
    const hasRoundRect = typeof ctx.roundRect === 'function';

    /** Born on the perimeter, moving along that edge's outward normal. */
    const spawn = (r: DOMRect) => {
      // Weighted by edge length so a wide bar sheds mostly from top and bottom
      // rather than equally from four sides — otherwise the short left/right
      // edges emit as densely as the long ones and look like jets.
      const perim = 2 * (r.width + r.height);
      let pick = Math.random() * perim;
      let x: number;
      let y: number;
      let nx: number;
      let ny: number;

      if (pick < r.width) {                      // top
        x = r.left + pick; y = r.top; nx = 0; ny = -1;
      } else if ((pick -= r.width) < r.width) {  // bottom
        x = r.left + pick; y = r.bottom; nx = 0; ny = 1;
      } else if ((pick -= r.width) < r.height) { // left
        x = r.left; y = r.top + pick; nx = -1; ny = 0;
      } else {                                   // right
        pick -= r.height;
        x = r.right; y = r.top + pick; nx = 1; ny = 0;
      }

      const base = Math.atan2(ny, nx);
      const angle = base + rand(-CFG.spread, CFG.spread);
      const speed = rand(CFG.speedMin, CFG.speedMax);

      /* Inset the corners.
       *
       * A particle born exactly at a corner belongs to two edges at once, and
       * whichever one it is assigned to sends it out at 90 degrees to the
       * other — a visible spray leaking diagonally past the container. Pulling
       * spawns 6px in from each end means every particle leaves from a stretch
       * of border that has one unambiguous outward direction. */
      const CORNER_INSET = 6;
      if (nx === 0) x = Math.min(Math.max(x, r.left + CORNER_INSET), r.right - CORNER_INSET);
      else y = Math.min(Math.max(y, r.top + CORNER_INSET), r.bottom - CORNER_INSET);

      particles.current.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        ttl: rand(CFG.ttlMin, CFG.ttlMax),
        size: rand(CFG.sizeMin, CFG.sizeMax),
        spin: rand(-1.6, 1.6),
      });
    };

    let last = performance.now();
    let carry = 0; // fractional particles owed from the previous frame

    const frame = (now: number) => {
      // Clamped: a backgrounded tab resumes with a huge dt, which would
      // teleport every particle off-screen in one step.
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      if (emitting.current) {
        rect = originRef.current?.getBoundingClientRect() ?? rect;
        if (rect) {
          // Accumulate fractional emissions instead of rounding per frame —
          // rounding down at 60fps would silently drop most of the rate.
          carry += CFG.rate * dt;
          const n = Math.floor(carry);
          carry -= n;
          for (let i = 0; i < n && particles.current.length < CFG.maxParticles; i++) spawn(rect);
        }
      }

      ctx.clearRect(0, 0, w, h);

      /* ── The scrim is painted HERE, not by a sibling div ──────────────────
       *
       * 🔴 It used to be a `bg-black/72` div inside the same portal. The
       * portal is a child of <body>, so it paints over the ENTIRE app — the
       * bar included. The bar was being darkened along with everything it was
       * supposed to stand out from, and the particles were painting across its
       * border, which is the "breaches the border lines" symptom. Raising the
       * bar's z-index cannot fix that: it lives inside `main`, and no
       * z-index inside a stacking context can lift an element above a sibling
       * of that context's ROOT.
       *
       * Painting the scrim on this canvas makes the hole possible. Even-odd
       * with a full-viewport rect plus the bar's rect fills everything EXCEPT
       * the bar, so the bar keeps its own colours and its own border, untouched
       * by anything above it.
       * ─────────────────────────────────────────────────────────────────── */
      const barRect = originRef.current?.getBoundingClientRect() ?? null;

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      if (barRect) {
        // Radius-matched inset so the corners of the hole follow the bar's own
        // 12px rounding instead of leaving four dark right-angle nicks.
        roundedRectPath(ctx, barRect.left, barRect.top, barRect.width, barRect.height, 12);
      }
      ctx.clip('evenodd');
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      /* ── Particles: excluded from the cards AND from the bar ──────────────
       *
       * The cards, because the bar sits below them and its top edge fires
       * straight into them — particles crossed their strokes and the two
       * elements appeared joined by streaks. An emitter cannot fix that by
       * aiming: "up" is where the cards are, and not emitting upward would
       * leave the bar shedding from three sides.
       *
       * The bar, because a particle is BORN on its border and would otherwise
       * paint over the stroke it just left.
       *
       * Both re-measured every frame: the cards move during the entrance
       * animation, and a stale rect clips the wrong rectangle for a full
       * second. */
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      if (barRect) roundedRectPath(ctx, barRect.left, barRect.top, barRect.width, barRect.height, 12);
      for (const r of excludeRefs || []) {
        const b = r.current?.getBoundingClientRect();
        // 1px of bleed so a particle never lands exactly on a border and
        // leaves a half-pixel seam along the edge.
        if (b) ctx.rect(b.left - 1, b.top - 1, b.width + 2, b.height + 2);
      }
      ctx.clip('evenodd');

      ctx.fillStyle = CFG.color;

      const alive: P[] = [];
      for (const p of particles.current) {
        p.life += dt;
        if (p.life >= p.ttl) continue;

        // Exponential drag: frame-rate independent, unlike v *= 0.98.
        const k = Math.pow(CFG.drag, dt);
        p.vx *= k;
        p.vy *= k;
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // Rises fast, falls slow: appears at once, then dissolves.
        const u = p.life / p.ttl;
        let a = u < 0.12 ? u / 0.12 : Math.pow(1 - (u - 0.12) / 0.88, 1.6);

        const dx = p.x - mouse.current.x;
        const dy = p.y - mouse.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CFG.glowRadius) a += (1 - dist / CFG.glowRadius) * 0.4;

        if (a > 0.004) {
          ctx.globalAlpha = Math.min(a, 1);
          // Rotated about its own centre, so squares tumble as they fly.
          const s = p.size;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.life * p.spin);
          if (hasRoundRect) {
            ctx.beginPath();
            ctx.roundRect(-s / 2, -s / 2, s, s, CFG.cornerRadius);
            ctx.fill();
          } else {
            ctx.fillRect(-s / 2, -s / 2, s, s);
          }
          ctx.restore();
        }
        alive.push(p);
      }
      particles.current = alive;

      ctx.restore();
      ctx.globalAlpha = 1;

      // Keep going while anything is still in flight, so leaving the bar lets
      // the spray finish instead of snapping hundreds of squares out of
      // existence mid-air.
      if (emitting.current || particles.current.length > 0) {
        raf.current = requestAnimationFrame(frame);
      } else {
        raf.current = undefined;
        ctx.clearRect(0, 0, w, h);
      }
    };

    start.current = () => {
      if (raf.current !== undefined) return; // already running
      last = performance.now();
      raf.current = requestAnimationFrame(frame);
    };

    if (emitting.current) start.current();

    // Cleanup here is UNMOUNT ONLY, because this effect no longer depends on
    // `active`.
    //
    // 🔴 It used to. That meant hover-OUT re-ran the effect, fired this
    // cleanup, cancelled the loop and emptied the array — so the "let the
    // spray finish" behaviour the component was built around never actually
    // happened. Several hundred squares vanished on the same frame the pointer
    // left, which is precisely the hard cut it exists to avoid.
    //
    // The loop now self-terminates when emission stops AND the last particle
    // dies, and a separate effect restarts it.
    return () => {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
      raf.current = undefined;
      particles.current = [];
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
    };
  }, [originRef, excludeRefs]);

  /* Kick the loop when emission begins. Separate from setup so turning
   * emission OFF tears nothing down — the loop notices `emitting` is false and
   * winds itself up once the last particle has gone. */
  useEffect(() => {
    if (active) start.current();
  }, [active]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 h-full w-full" />;
};

export default EdgeParticles;
