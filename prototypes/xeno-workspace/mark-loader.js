/* The XENO mark as a loader: particles spiral in and fill the mark, the formed mark takes one quarter turn
   with a settle, then the particles scatter and the loop begins again.

   This is XENO Workshop's `MarkLoader` (xeno-workshop/app/src/shell/MarkLoader.tsx, "Swarm + Ratchet" from the
   mark motion studies), the same geometry and the same timing, written without React because this page is
   plain scripts. It is a second copy and is named as one: when the loader moves to a shared package, both
   take it from there. Do not let the two drift: change the motion in Workshop's file first.

   XENO_MARK_LOADER.mount(el, { size, label }) draws into `el` and returns a function that stops it.
   The colour is the element's own text colour, so it follows the theme. Reduced motion shows the still mark. */
(function () {
  'use strict';
  const ARM = 'M 475.75 222.25 L 302.75 49.25 L 80.75 49.25 A 59.5 59.5 0 0 0 21.25 108.75 L 21.25 332.25 L 352.75 663.75 L 475.75 540.75 L 231.25 296.25 C 195.641375 260.641375 209.722 254.75 221.25 254.75 L 443.25 254.75 Z';
  const C = 541, TILT = 2.29, P = 4.4, FIELD = 3;
  const cl = (x) => Math.max(0, Math.min(1, x));
  const oexp = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
  const ioBack = (x) => { const c = 1.70158 * 1.525; return x < 0.5 ? (Math.pow(2 * x, 2) * ((c + 1) * 2 * x - c)) / 2 : (Math.pow(2 * x - 2, 2) * ((c + 1) * (x * 2 - 2) + c) + 2) / 2; };

  function markPath() {
    const arm = new Path2D(ARM), mark = new Path2D();
    for (let i = 0; i < 4; i++) mark.addPath(arm, new DOMMatrix().translate(C, C).rotate(90 * i + TILT).translate(-C, -C));
    return mark;
  }
  // points on a grid inside the mark (drawn `size` px wide) at the centre of a `field`-px canvas
  function particles(size, field) {
    const mark = markPath(), probe = document.createElement('canvas').getContext('2d');
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const half = field / 2, s = (size * 0.66) / 1040, o = half - C * s, step = 1040 / Math.max(18, Math.round(size / 3.2)), pts = [];
    for (let gy = 10; gy < 1072; gy += step) for (let gx = 10; gx < 1072; gx += step) {
      const x = gx + (rnd() - 0.5) * step * 0.5, y = gy + (rnd() - 0.5) * step * 0.5;
      if (!probe.isPointInPath(mark, x, y)) continue;
      const tx = o + x * s, ty = o + y * s, a = rnd() * Math.PI * 2, r0 = half * (0.72 + rnd() * 0.28);
      const ang = (Math.atan2(ty - half, tx - half) + Math.PI) / (2 * Math.PI);
      pts.push({ tx, ty, sx: half + Math.cos(a) * r0, sy: half + Math.sin(a) * r0, d: rnd() * 0.35 + ang * 0.3, sd: rnd() * 6.28, sz: size / 140 + rnd() * size / 180 });
    }
    return pts;
  }

  function mount(el, opts) {
    const size = (opts && opts.size) || 88, label = (opts && opts.label) || 'Loading';
    const box = document.createElement('div');
    box.setAttribute('role', 'img'); box.setAttribute('aria-label', label); box.dataset.markLoader = '';
    box.style.cssText = `position:relative;width:${size}px;height:${size}px`;
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true');
    const field = size * FIELD, dpr = Math.min(2, window.devicePixelRatio || 1);
    // the mark sits at the centre of a field three times its size: particles arrive from outside it and leave beyond it
    canvas.style.cssText = `position:absolute;left:${(size - field) / 2}px;top:${(size - field) / 2}px;width:${field}px;height:${field}px;pointer-events:none`;
    canvas.width = field * dpr; canvas.height = field * dpr;
    box.appendChild(canvas); el.appendChild(box);
    const ctx = canvas.getContext('2d'); if (!ctx) return () => box.remove();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pts = particles(size, field), half = field / 2;
    // fully visible near the mark, gone by the field's edge: the swarm dissolves, never clips
    const fade = (x, y) => { const d = Math.hypot(x - half, y - half) / half; return d < 0.45 ? 1 : Math.max(0, 1 - (d - 0.45) / 0.5); };
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, start = performance.now(), frames = 0;
    const draw = (t) => {
      const f = t % P;
      ctx.clearRect(0, 0, field, field);
      ctx.fillStyle = getComputedStyle(canvas).color;
      // Ratchet: once formed, the whole mark steps a quarter turn with an overshoot and settle
      const turn = still ? 0 : (Math.PI / 2) * ioBack(cl((f - 1.95) / 0.85)), cos = Math.cos(turn), sin = Math.sin(turn);
      for (const p of pts) {
        let x, y, al = 1;
        if (still) { x = p.tx; y = p.ty; }
        else if (f < 3.1) {
          // Swarm in: spiral from outside onto the silhouette, then a faint shimmer while held
          const l = cl((f - p.d) / 1.1), e = oexp(l), sw = Math.sin(Math.PI * e) * size * 0.15;
          const dx = p.tx - p.sx, dy = p.ty - p.sy, len = Math.hypot(dx, dy) || 1;
          x = p.sx + dx * e - (dy / len) * sw; y = p.sy + dy * e + (dx / len) * sw;
          al = cl(l * 4);
          const hold = cl((f - 1.5) / 0.3) * (1 - cl((f - 1.95) / 0.2));
          x += Math.sin(t * 3 + p.sd) * 0.35 * hold; y += Math.cos(t * 2.6 + p.sd) * 0.35 * hold;
        } else {
          // Scatter: spin outward and fade, so the next loop starts from an empty field
          const l2 = cl((f - 3.1 - p.d * 0.5) / 1.0), e = l2 * l2;
          const vx = p.tx - half, vy = p.ty - half, a = Math.atan2(vy, vx) + 0.9 * e, r = Math.hypot(vx, vy) + e * half * 0.85;
          x = half + Math.cos(a) * r; y = half + Math.sin(a) * r; al = 1 - l2;
        }
        const rx = half + (x - half) * cos - (y - half) * sin, ry = half + (x - half) * sin + (y - half) * cos;
        al *= fade(rx, ry);
        if (al <= 0) continue;
        ctx.globalAlpha = al;
        ctx.fillRect(rx - p.sz / 2, ry - p.sz / 2, p.sz, p.sz);
      }
      ctx.globalAlpha = 1; frames++; box.dataset.frames = String(frames);
    };
    const loop = (now) => { draw((now - start) / 1000); raf = requestAnimationFrame(loop); };
    if (still) draw(0); else raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); box.remove(); };
  }
  window.XENO_MARK_LOADER = { mount, particles: (size) => particles(size, size * FIELD).length };
})();
