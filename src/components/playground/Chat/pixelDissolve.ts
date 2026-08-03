/**
 * Bottom-to-top pixel disintegration for a DOM node.
 *
 * Capture while the live card stays visible, then in one synchronous handoff:
 * paint a fixed overlay on document.body → hide the live node → dissolve.
 * No cover-clone (cloning into body loses themed CSS and flashes empty).
 */

import { toCanvas } from 'html-to-image';

type DissolveCell = {
  deviceX: number;
  deviceY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  departAt: number;
  size: number;
};

export type PixelDissolveOptions = {
  durationMs?: number;
  sampleStep?: number;
  padPx?: number;
  leaveHidden?: boolean;
  /** Pre-captured plate — take this BEFORE any React state change. */
  plate?: HTMLCanvasElement;
  onCaptured?: () => void;
  signal?: AbortSignal;
};

/** Wave occupies most of the timeline; dust flight fills the rest. */
const SWEEP_SPAN = 0.68;
const BAND_SPAN = 0.06;
/** Short enough to stay snappy at ~450ms total; long enough to read upward dust. */
const FLIGHT_SPAN = 0.34;
const DUST_ALPHA_FLOOR = 20;
/** Only some cells become flying dust — denser plate punch, sparser trail (reference look). */
const DUST_SPAWN_CHANCE = 0.45;

/** Smoothstep — eases the whole wave so it doesn't feel linear / stepped. */
const smoothstep = (u: number) => u * u * (3 - 2 * u);

const createPlateCanvas = (cssWidth: number, cssHeight: number, scale: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(cssWidth * scale));
  canvas.height = Math.max(1, Math.floor(cssHeight * scale));
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('pixelDissolve: 2d context unavailable');
  return { canvas, ctx };
};

const solidCardCanvas = (
  element: HTMLElement,
  cssWidth: number,
  cssHeight: number,
  scale: number,
): HTMLCanvasElement => {
  const { canvas, ctx } = createPlateCanvas(cssWidth, cssHeight, scale);
  const w = canvas.width;
  const h = canvas.height;
  const radius = 16 * scale;
  ctx.fillStyle = getComputedStyle(element).backgroundColor || 'rgb(17, 17, 19)';
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.arcTo(w, 0, w, h, radius);
  ctx.arcTo(w, h, 0, h, radius);
  ctx.arcTo(0, h, 0, 0, radius);
  ctx.arcTo(0, 0, w, 0, radius);
  ctx.closePath();
  ctx.fill();
  return canvas;
};

/** Capture the live card. Call before any setState. Keep the card visible during this. */
export const captureDissolvePlate = async (
  element: HTMLElement,
  options: { signal?: AbortSignal } = {},
): Promise<{ plate: HTMLCanvasElement; cssWidth: number; cssHeight: number; rect: DOMRect }> => {
  const rect = element.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  // 1× is enough for soft dust and keeps the wave smooth on mid-range GPUs.
  const scale = 1;

  if (options.signal?.aborted) {
    throw new Error('pixelDissolve: aborted');
  }

  try {
    const painted = await toCanvas(element, {
      width: cssWidth,
      height: cssHeight,
      pixelRatio: scale,
      cacheBust: true,
      skipFonts: true,
    });
    if (painted.width < 2 || painted.height < 2) {
      throw new Error('pixelDissolve: empty snapshot');
    }
    return { plate: painted, cssWidth, cssHeight, rect };
  } catch {
    return {
      plate: solidCardCanvas(element, cssWidth, cssHeight, scale),
      cssWidth,
      cssHeight,
      rect,
    };
  }
};

/** @deprecated Cover clones lose themed CSS on document.body and flash empty — do not use. */
export const placeCoverClone = (element: HTMLElement): HTMLElement => {
  const rect = element.getBoundingClientRect();
  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.cssText = [
    'position:fixed',
    `left:${rect.left}px`,
    `top:${rect.top}px`,
    `width:${rect.width}px`,
    `height:${rect.height}px`,
    'margin:0',
    'z-index:9998',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(clone);
  return clone;
};

const buildCells = (
  plate: HTMLCanvasElement,
  sampleStep: number,
  plateScale: number,
): { cells: DissolveCell[]; stepDevice: number } => {
  const ctx = plate.getContext('2d');
  const stepDevice = Math.max(1, Math.floor(sampleStep * plateScale));
  if (!ctx) return { cells: [], stepDevice };

  const { data, width, height } = ctx.getImageData(0, 0, plate.width, plate.height);
  const cells: DissolveCell[] = [];

  for (let y = 0; y < height; y += stepDevice) {
    for (let x = 0; x < width; x += stepDevice) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3];
      if (alpha < DUST_ALPHA_FLOOR) continue;

      // Bottom (high y) → low departAt → leaves first. Pure vertical wave.
      const normalizedY = height <= 1 ? 1 : y / (height - 1);
      const departAt = Math.min(
        1 - FLIGHT_SPAN,
        (1 - normalizedY) * SWEEP_SPAN + Math.random() ** 2 * BAND_SPAN,
      );

      const cssStep = stepDevice / plateScale;
      const spawnDust = Math.random() < DUST_SPAWN_CHANCE;

      cells.push({
        deviceX: x,
        deviceY: y,
        x: x / plateScale,
        y: y / plateScale,
        // Almost no horizontal drift — vertical exit like the reference, rotated.
        vx: spawnDust ? (Math.random() - 0.5) * 0.28 : 0,
        vy: spawnDust ? -(1.2 + Math.random() * 1.6) : 0,
        color: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`,
        alpha: spawnDust ? Math.min(1, alpha / 255) : 0,
        departAt,
        size: Math.max(1.4, cssStep * (0.75 + Math.random() * 0.5)),
      });
    }
  }

  cells.sort((a, b) => a.departAt - b.departAt);
  return { cells, stepDevice };
};

/**
 * Disintegrates `element` into fine pixels from bottom to top (vertical).
 * Prefer: captureDissolvePlate (card still visible) → runPixelDissolve({ plate }).
 */
export const runPixelDissolve = async (
  element: HTMLElement,
  options: PixelDissolveOptions = {},
): Promise<void> => {
  if (typeof window === 'undefined') return;
  if (options.signal?.aborted) return;

  const durationMs = options.durationMs ?? 450;
  const sampleStep = options.sampleStep ?? 3;
  const padPx = options.padPx ?? 120;
  const leaveHidden = options.leaveHidden !== false;

  let plate = options.plate;
  let cssWidth: number;
  let cssHeight: number;
  let rect: DOMRect;

  if (plate) {
    // Re-measure at handoff so the overlay sits on the card even if the page scrolled.
    rect = element.getBoundingClientRect();
    cssWidth = Math.max(1, Math.round(rect.width));
    cssHeight = Math.max(1, Math.round(rect.height));
  } else {
    const captured = await captureDissolvePlate(element, { signal: options.signal });
    plate = captured.plate;
    cssWidth = captured.cssWidth;
    cssHeight = captured.cssHeight;
    rect = captured.rect;
  }

  if (options.signal?.aborted) return;

  const plateScale = plate.width / Math.max(1, cssWidth);
  const { cells, stepDevice } = buildCells(plate, sampleStep, plateScale);
  const plateCtx = plate.getContext('2d');
  if (cells.length === 0 || !plateCtx) return;
  plateCtx.globalCompositeOperation = 'destination-out';

  const overlay = document.createElement('canvas');
  const overlayWidth = cssWidth + padPx * 2;
  const overlayHeight = cssHeight + padPx * 2;
  overlay.width = Math.max(1, Math.floor(overlayWidth * plateScale));
  overlay.height = Math.max(1, Math.floor(overlayHeight * plateScale));
  overlay.setAttribute('data-dissolve-overlay', 'true');
  overlay.style.cssText = [
    'position:fixed',
    `left:${rect.left - padPx}px`,
    `top:${rect.top - padPx}px`,
    `width:${overlayWidth}px`,
    `height:${overlayHeight}px`,
    'pointer-events:none',
    'z-index:9999',
  ].join(';');

  const ctx = overlay.getContext('2d', { alpha: true });
  if (!ctx) return;
  ctx.setTransform(plateScale, 0, 0, plateScale, 0, 0);
  ctx.imageSmoothingEnabled = false;

  // --- Single synchronous handoff: overlay on → live off. No blank frame. ---
  document.body.appendChild(overlay);
  ctx.clearRect(0, 0, overlayWidth, overlayHeight);
  ctx.drawImage(plate, padPx, padPx, cssWidth, cssHeight);

  const previousOpacity = element.style.opacity;
  const previousVisibility = element.style.visibility;
  const previousPointerEvents = element.style.pointerEvents;
  element.style.opacity = '0';
  element.style.visibility = 'hidden';
  element.style.pointerEvents = 'none';

  options.onCaptured?.();

  const start = performance.now();

  await new Promise<void>((resolve) => {
    let frameId = 0;
    let nextCell = 0;
    const inFlight: DissolveCell[] = [];

    const cleanup = () => {
      cancelAnimationFrame(frameId);
      overlay.remove();
      if (!leaveHidden && element.isConnected) {
        element.style.opacity = previousOpacity;
        element.style.visibility = previousVisibility;
        element.style.pointerEvents = previousPointerEvents;
      }
      resolve();
    };

    const onAbort = () => {
      options.signal?.removeEventListener('abort', onAbort);
      cleanup();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const tick = (now: number) => {
      if (options.signal?.aborted) {
        cleanup();
        return;
      }

      const raw = Math.min(1, (now - start) / durationMs);
      // Ease the timeline so the wave + dust accelerate/settle instead of ticking linearly.
      const t = smoothstep(raw);

      // Punch every cell that is due this frame — no per-frame cap (that caused stair-steps).
      while (nextCell < cells.length && cells[nextCell].departAt <= t) {
        const cell = cells[nextCell];
        nextCell += 1;
        plateCtx.fillRect(cell.deviceX, cell.deviceY, stepDevice, stepDevice);
        if (cell.alpha > 0) inFlight.push(cell);
      }

      ctx.clearRect(0, 0, overlayWidth, overlayHeight);
      ctx.drawImage(plate, padPx, padPx, cssWidth, cssHeight);

      for (let i = inFlight.length - 1; i >= 0; i -= 1) {
        const cell = inFlight[i];
        const local = (t - cell.departAt) / FLIGHT_SPAN;

        if (local >= 1) {
          inFlight[i] = inFlight[inFlight.length - 1];
          inFlight.pop();
          continue;
        }

        // Softer ease-out on flight + alpha so dust fades instead of popping off.
        const ease = 1 - (1 - local) ** 3;
        ctx.globalAlpha = cell.alpha * (1 - smoothstep(local));
        ctx.fillStyle = cell.color;
        const size = cell.size * (1 - local * 0.28);
        ctx.fillRect(
          padPx + cell.x + cell.vx * ease * 22,
          padPx + cell.y + cell.vy * ease * 160,
          size,
          size,
        );
      }

      ctx.globalAlpha = 1;

      if (t < 1 || nextCell < cells.length || inFlight.length > 0) {
        frameId = requestAnimationFrame(tick);
      } else {
        options.signal?.removeEventListener('abort', onAbort);
        cleanup();
      }
    };

    frameId = requestAnimationFrame(tick);
  });
};
