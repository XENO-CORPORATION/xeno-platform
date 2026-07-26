/**
 * Bottom-to-top pixel disintegration for a DOM node. No extra deps.
 *
 * The element is snapshotted onto a "plate" canvas drawn 1:1, then hidden. Each cell of
 * the plate is punched out exactly once, in a randomised order inside a wide travelling
 * band — so there is never a straight boundary, only a ragged, thinning edge. Each punched
 * cell becomes a dust particle on a fixed overlay canvas, which is why overflow:hidden
 * parents cannot clip the dust.
 *
 * Cost is bounded: every cell is punched once for the whole animation, and only cells still
 * in flight are drawn per frame.
 */

type DissolveCell = {
  /** Snapshot-space origin, device px — where the hole gets punched. */
  deviceX: number;
  deviceY: number;
  /** Overlay-space origin, CSS px — where the dust starts. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Precomputed `rgb(...)`; building this per frame is the hot path. */
  color: string;
  alpha: number;
  /** Normalised time (0..1) at which this cell leaves the plate. */
  departAt: number;
  size: number;
};

export type PixelDissolveOptions = {
  /** Total animation time in ms. */
  durationMs?: number;
  /** Sample every N CSS pixels (higher = coarser dust, cheaper). */
  sampleStep?: number;
  /** Extra canvas padding so dust can drift outside the card. */
  padPx?: number;
  /**
   * When true (default for dismiss), the element stays opacity:0 after the
   * animation so React can unmount it without a one-frame flash.
   */
  leaveHidden?: boolean;
  /**
   * Fired once the overlay owns the pixels. Safe to unmount / replace `element`
   * from here — the rest of the animation does not need the live DOM node.
   */
  onCaptured?: () => void;
  signal?: AbortSignal;
};

/** Fraction of the duration the band's leading edge takes to cross the card (bottom → top). */
const SWEEP_SPAN = 0.58;
/** Randomised delay window per cell — this is what makes the edge ragged, not a line. */
const BAND_SPAN = 0.26;
/**
 * How long one cell's dust stays alive. Kept short on purpose: the first pixels must be
 * gone before the next ones leave, otherwise the dust piles up into a solid noise block
 * instead of thinning out. SWEEP + BAND + FLIGHT must stay <= 1.
 */
const FLIGHT_SPAN = 0.15;

const STYLE_PROPS = [
  'background-color',
  'background-image',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-radius',
  'box-shadow',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'line-height',
  'text-align',
  'text-transform',
  'opacity',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'display',
  'flex-direction',
  'flex-wrap',
  'align-items',
  'justify-content',
  'gap',
  'row-gap',
  'column-gap',
  'grid-template-columns',
  'grid-template-rows',
  'overflow',
  'white-space',
  'text-overflow',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'position',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'transform',
  'filter',
] as const;

const copyComputedTree = (source: Element, target: Element) => {
  if (source instanceof HTMLElement && target instanceof HTMLElement) {
    const computed = getComputedStyle(source);
    let cssText = '';
    for (const prop of STYLE_PROPS) {
      cssText += `${prop}:${computed.getPropertyValue(prop)};`;
    }
    // Keep layout box stable inside the SVG foreignObject.
    cssText += 'box-sizing:border-box;margin:0;';
    target.style.cssText = cssText;
  }

  const sourceChildren = source.children;
  const targetChildren = target.children;
  const count = Math.min(sourceChildren.length, targetChildren.length);
  for (let i = 0; i < count; i += 1) {
    copyComputedTree(sourceChildren[i], targetChildren[i]);
  }
};

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('pixelDissolve: snapshot image failed to load'));
    image.src = url;
  });

const createPlateCanvas = (cssWidth: number, cssHeight: number, scale: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(cssWidth * scale));
  canvas.height = Math.max(1, Math.floor(cssHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('pixelDissolve: 2d context unavailable');
  return { canvas, ctx };
};

/**
 * Render `element` into a canvas at device resolution.
 * Uses SVG foreignObject + inlined computed styles — good enough for this self-contained card.
 */
const snapshotElement = async (
  element: HTMLElement,
  cssWidth: number,
  cssHeight: number,
  scale: number,
): Promise<HTMLCanvasElement> => {
  const clone = element.cloneNode(true) as HTMLElement;
  copyComputedTree(element, clone);
  clone.style.width = `${cssWidth}px`;
  clone.style.height = `${cssHeight}px`;
  clone.style.maxWidth = `${cssWidth}px`;
  clone.style.maxHeight = `${cssHeight}px`;
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cssWidth}" height="${cssHeight}">
  <foreignObject width="100%" height="100%">${serialized}</foreignObject>
</svg>`;

  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = await loadImage(url);

  const { canvas, ctx } = createPlateCanvas(cssWidth, cssHeight, scale);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
};

/**
 * Fallback when the SVG snapshot fails: a flat monochrome card silhouette.
 * Still disintegrates bottom → top so dismiss never looks broken.
 */
const silhouetteCanvas = (
  cssWidth: number,
  cssHeight: number,
  scale: number,
): HTMLCanvasElement => {
  const { canvas, ctx } = createPlateCanvas(cssWidth, cssHeight, scale);
  const w = canvas.width;
  const h = canvas.height;
  const radius = 16 * scale;

  ctx.fillStyle = '#111113';
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.arcTo(w, 0, w, h, radius);
  ctx.arcTo(w, h, 0, h, radius);
  ctx.arcTo(0, h, 0, 0, radius);
  ctx.arcTo(0, 0, w, 0, radius);
  ctx.closePath();
  ctx.fill();

  // Lighter band on the left (title zone) so the dust is not one flat gray.
  const gradient = ctx.createLinearGradient(0, 0, w * 0.55, 0);
  gradient.addColorStop(0, 'rgba(228,228,231,0.22)');
  gradient.addColorStop(1, 'rgba(228,228,231,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w * 0.55, h);

  return canvas;
};

/** Below this the cell is treated as empty: punched out, but it produces no dust. */
const DUST_ALPHA_FLOOR = 18;

/**
 * One cell per sampled block, sorted by departure time so each frame only has to walk
 * the cells that just left instead of the whole grid.
 *
 * Every cell is scheduled, including transparent ones. Skipping them would leave the
 * anti-aliased pixels inside them — the rounded corners — painted on the plate forever.
 */
const buildCells = (
  plate: HTMLCanvasElement,
  sampleStep: number,
  scale: number,
): { cells: DissolveCell[]; stepDevice: number } => {
  const ctx = plate.getContext('2d');
  const stepDevice = Math.max(1, Math.floor(sampleStep * scale));
  if (!ctx) return { cells: [], stepDevice };

  const { data, width, height } = ctx.getImageData(0, 0, plate.width, plate.height);
  const cells: DissolveCell[] = [];

  for (let y = 0; y < height; y += stepDevice) {
    for (let x = 0; x < width; x += stepDevice) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3];
      // Canvas Y grows downward — bottom edge is normalizedY ≈ 1 and leaves first.
      const normalizedY = height <= 1 ? 1 : y / (height - 1);
      // Leading edge sweeps bottom → top; the random term spreads each row's departure over
      // BAND_SPAN, so neighbours leave at different times and the edge never reads as a line.
      const departAt = Math.min(
        1 - FLIGHT_SPAN,
        (1 - normalizedY) * SWEEP_SPAN + Math.random() ** 1.5 * BAND_SPAN,
      );

      cells.push({
        deviceX: x,
        deviceY: y,
        x: x / scale,
        y: y / scale,
        // Drift upward (negative Y) with a little sideways scatter — matches B→T dissolve.
        vx: (Math.random() - 0.5) * 1.15,
        vy: -(0.45 + Math.random() * 1.4 + normalizedY * 0.55),
        color: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`,
        alpha: alpha < DUST_ALPHA_FLOOR ? 0 : alpha / 255,
        departAt,
        size: Math.max(1, stepDevice / scale) * (0.7 + Math.random() * 0.6),
      });
    }
  }

  cells.sort((a, b) => a.departAt - b.departAt);
  return { cells, stepDevice };
};

/**
 * Disintegrates `element` into pixels from bottom to top. Resolves when the dust has settled.
 * The element is temporarily opacity:0; callers decide when to unmount / replace it.
 */
export const runPixelDissolve = async (
  element: HTMLElement,
  options: PixelDissolveOptions = {},
): Promise<void> => {
  if (typeof window === 'undefined') return;
  if (options.signal?.aborted) return;

  const durationMs = options.durationMs ?? 920;
  const sampleStep = options.sampleStep ?? 3;
  const padPx = options.padPx ?? 64;
  const leaveHidden = options.leaveHidden !== false;

  const rect = element.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  const scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));

  let plate: HTMLCanvasElement;
  try {
    plate = await snapshotElement(element, cssWidth, cssHeight, scale);
  } catch {
    plate = silhouetteCanvas(cssWidth, cssHeight, scale);
  }

  if (options.signal?.aborted) return;

  const { cells, stepDevice } = buildCells(plate, sampleStep, scale);
  const plateCtx = plate.getContext('2d');
  if (cells.length === 0 || !plateCtx) return;
  // Every later plate draw removes pixels instead of adding them.
  plateCtx.globalCompositeOperation = 'destination-out';

  const overlay = document.createElement('canvas');
  const overlayWidth = cssWidth + padPx * 2;
  const overlayHeight = cssHeight + padPx * 2;
  overlay.width = Math.floor(overlayWidth * scale);
  overlay.height = Math.floor(overlayHeight * scale);
  overlay.style.cssText = [
    'position:fixed',
    `left:${rect.left - padPx}px`,
    `top:${rect.top - padPx}px`,
    `width:${overlayWidth}px`,
    `height:${overlayHeight}px`,
    'pointer-events:none',
    'z-index:9999',
  ].join(';');

  const ctx = overlay.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  // The plate is already at device resolution — resampling it would blur the card.
  ctx.imageSmoothingEnabled = false;

  const host =
    element.closest('.chat-themed') instanceof HTMLElement
      ? (element.closest('.chat-themed') as HTMLElement)
      : document.body;
  host.appendChild(overlay);

  const previousOpacity = element.style.opacity;
  const previousPointerEvents = element.style.pointerEvents;
  element.style.opacity = '0';
  element.style.pointerEvents = 'none';

  // Overlay has the snapshot — caller may remove the live node now.
  options.onCaptured?.();

  const start = performance.now();

  await new Promise<void>((resolve) => {
    let frameId = 0;
    let nextCell = 0;
    /** Cells punched out of the plate and still visible as dust. */
    const inFlight: DissolveCell[] = [];

    const cleanup = () => {
      cancelAnimationFrame(frameId);
      overlay.remove();
      // Element may already be unmounted via onCaptured — only restore if it survived.
      if (!leaveHidden && element.isConnected) {
        element.style.opacity = previousOpacity;
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

      const t = Math.min(1, (now - start) / durationMs);

      // Punch the cells whose turn came since the last frame — each cell, exactly once.
      while (nextCell < cells.length && cells[nextCell].departAt <= t) {
        const cell = cells[nextCell];
        nextCell += 1;
        plateCtx.fillRect(cell.deviceX, cell.deviceY, stepDevice, stepDevice);
        if (cell.alpha > 0) inFlight.push(cell);
      }

      ctx.clearRect(0, 0, overlayWidth, overlayHeight);
      // What is left of the card: real snapshot pixels, holes and all.
      ctx.drawImage(plate, padPx, padPx, cssWidth, cssHeight);

      for (let i = inFlight.length - 1; i >= 0; i -= 1) {
        const cell = inFlight[i];
        const local = (t - cell.departAt) / FLIGHT_SPAN;

        if (local >= 1) {
          inFlight[i] = inFlight[inFlight.length - 1];
          inFlight.pop();
          continue;
        }

        const ease = 1 - (1 - local) ** 2;
        // Steep falloff — a particle is more than half gone a third of the way through.
        ctx.globalAlpha = cell.alpha * (1 - local) ** 2.6;
        ctx.fillStyle = cell.color;
        const size = cell.size * (1 - local * 0.55);
        ctx.fillRect(
          padPx + cell.x + cell.vx * ease * 36,
          padPx + cell.y + cell.vy * ease * 62,
          size,
          size,
        );
      }

      ctx.globalAlpha = 1;

      if (t < 1) {
        frameId = requestAnimationFrame(tick);
      } else {
        options.signal?.removeEventListener('abort', onAbort);
        cleanup();
      }
    };

    frameId = requestAnimationFrame(tick);
  });
};
