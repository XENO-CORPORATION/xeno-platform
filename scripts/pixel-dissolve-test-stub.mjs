/** Sync no-op dissolve for carousel unit tests — skips canvas / html-to-image. */

export const captureDissolvePlate = async (element) => {
  const rect =
    typeof element.getBoundingClientRect === 'function'
      ? element.getBoundingClientRect()
      : { left: 0, top: 0, width: 1, height: 1 };
  const plate = {
    width: 1,
    height: 1,
    getContext: () => null,
  };
  return {
    plate,
    cssWidth: Math.max(1, Math.round(rect.width || 1)),
    cssHeight: Math.max(1, Math.round(rect.height || 1)),
    rect,
  };
};

export const placeCoverClone = (element) => {
  const cover = element.ownerDocument.createElement('div');
  cover.setAttribute('data-dissolve-cover', 'true');
  element.ownerDocument.body.appendChild(cover);
  return cover;
};

export const runPixelDissolve = async (_element, options = {}) => {
  options.onCaptured?.();
};
