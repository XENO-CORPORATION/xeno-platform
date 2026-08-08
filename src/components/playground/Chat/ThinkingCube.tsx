import React, { useEffect, useRef } from 'react';

export type ThinkingPhase = 'thinking' | 'searching' | 'reading' | 'writing';

interface ThinkingCubeProps {
  /** Rendered size in CSS px. */
  size?: number;
  /** Animation speed multiplier. */
  speed?: number;
  /** 'dark' → light dots (for dark UI), 'light' → dark dots. */
  theme?: 'dark' | 'light';
  /** Current activity — changes how the cube moves. */
  phase?: ThinkingPhase;
  className?: string;
  style?: React.CSSProperties;
}

interface Dot {
  x: number;
  y: number;
  z: number;
  r: number;
  white: number;
  a: number;
}

interface PhaseParams {
  yaw: number; // rotation speed (rad/s)
  wSpeed: number; // wave travel speed
  wFreq: number; // wave frequency
  push: number; // outward "breathing" amplitude
  vertical: boolean; // wave sweeps vertically (reading) vs diagonally
  bright: number; // overall brightness multiplier
}

const PHASE: Record<ThinkingPhase, PhaseParams> = {
  thinking: { yaw: 0.45, wSpeed: 2.1, wFreq: 2.1, push: 0.05, vertical: false, bright: 1.0 },
  searching: { yaw: 1.0, wSpeed: 3.4, wFreq: 1.7, push: 0.16, vertical: false, bright: 1.05 },
  reading: { yaw: 0.28, wSpeed: 2.0, wFreq: 2.7, push: 0.05, vertical: true, bright: 1.0 },
  writing: { yaw: 0.6, wSpeed: 3.9, wFreq: 2.3, push: 0.06, vertical: false, bright: 1.16 },
};

/**
 * A dotted CUBE "thinking" indicator. The dots trace the cube's twelve edges
 * (so it reads clearly as a cube — a face grid looks spherical) and a diagonal
 * brightness wave sweeps the frame for a composing-style undulation. The `phase`
 * prop reshapes the motion (searching scatters/spins faster, reading sweeps a
 * vertical band, writing runs fast and bright).
 *
 * The animation loop runs continuously and reads the phase from a ref, and the
 * rotation angle + wave phase are ACCUMULATED with delta-time — so changing
 * phase (or the status text) never restarts or jumps the animation. Plain 2D
 * canvas, theme-aware, respects prefers-reduced-motion.
 */
const ThinkingCube: React.FC<ThinkingCubeProps> = ({
  size = 26,
  speed = 1,
  theme = 'dark',
  phase = 'thinking',
  className = '',
  style,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dark = theme !== 'light';

  // Current phase lives in a ref so a phase change does NOT re-run the render
  // effect (which would restart the animation).
  const phaseRef = useRef<ThinkingPhase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    const half = (size / 2) * 0.62;
    const rsMul = size / 26;
    const perEdge = Math.max(5, Math.round(size / 4));

    // Eight corners and the twelve edges of the unit cube.
    const corners: Array<[number, number, number]> = [];
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) corners.push([sx, sy, sz]);
    const edges: Array<[number, number]> = [];
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++) {
        let d = 0;
        if (corners[i][0] !== corners[j][0]) d++;
        if (corners[i][1] !== corners[j][1]) d++;
        if (corners[i][2] !== corners[j][2]) d++;
        if (d === 1) edges.push([i, j]);
      }

    const project = (yaw: number, pitch: number) => {
      const sp = Math.sin(pitch);
      const cp = Math.cos(pitch);
      const sy = Math.sin(yaw);
      const cyw = Math.cos(yaw);
      const cx = size / 2;
      const cy = size / 2;
      return (vx: number, vy: number, vz: number): [number, number, number] => {
        const g = vx * cyw + vz * sy;
        const u2 = -vx * sy + vz * cyw;
        const h = vy * cp - u2 * sp;
        const R = vy * sp + u2 * cp;
        return [cx + g * half, cy - h * half, R];
      };
    };

    // Accumulators — continuous across phase changes.
    let yawAngle = 0;
    let wavePhase = 0;

    const render = (now: number, P: PhaseParams) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const proj = project(yawAngle, 0.5 + 0.09 * Math.sin(now * 0.3));
      const dots: Dot[] = [];

      for (const [i, j] of edges) {
        const a = corners[i];
        const b = corners[j];
        for (let k = 0; k < perEdge; k++) {
          const f = k / (perEdge - 1);
          const lx = a[0] + (b[0] - a[0]) * f;
          const ly = a[1] + (b[1] - a[1]) * f;
          const lz = a[2] + (b[2] - a[2]) * f;
          const axis = P.vertical ? ly : lx + ly + lz;
          const wave = 0.5 + 0.5 * Math.sin(axis * P.wFreq - wavePhase);
          const push = 1 + P.push * wave;
          const [x, y, z] = proj(lx * push, ly * push, lz * push);
          const depth = (z + 1) / 2; // 0 far, 1 near
          dots.push({
            x,
            y,
            z,
            r: Math.max(0.35, (0.5 + 1.05 * depth) * rsMul * (0.55 + 0.6 * wave) * P.bright),
            white: 0.6 - 0.4 * depth - 0.22 * wave,
            a: Math.min(1, (0.3 + 0.6 * depth) * (0.4 + 0.6 * wave) * P.bright),
          });
        }
      }

      dots.sort((p, q) => p.z - q.z);
      for (const d of dots) {
        if (d.a < 0.02) continue;
        const c = Math.min(1, Math.max(0, d.white));
        const ink = Math.round((dark ? 1 - c : c) * 255);
        ctx.fillStyle = `rgba(${ink},${ink},${ink},${d.a})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (reduce) {
      yawAngle = 0.6;
      wavePhase = 0.6;
      render(0.6, PHASE[phaseRef.current]);
      return;
    }

    let raf = 0;
    let running = true;
    let last = performance.now() / 1000;
    const loop = () => {
      const now = performance.now() / 1000;
      let dt = now - last;
      last = now;
      if (dt > 0.05) dt = 0.05; // clamp big gaps (tab switch)
      const P = PHASE[phaseRef.current];
      yawAngle += dt * P.yaw * speed;
      wavePhase += dt * P.wSpeed * speed;
      render(now, P);
      if (running) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [size, speed, dark]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Thinking"
      className={className}
      style={{ width: size, height: size, display: 'block', ...style }}
    />
  );
};

export default ThinkingCube;
