/**
 * watermark — composites a subtle "XENO" mark onto Free-tier image outputs (sharp).
 * Free generations are returned watermarked; Pro/Team get clean images. To prevent
 * bypass, watermarked images are returned as self-contained base64 (the original,
 * un-watermarked URL is NOT exposed to the client).
 */
import sharp from 'sharp';

/** Resolve an OpenAI-style image item ({ url } | { b64_json } | { base64 }) to a Buffer. */
async function itemToBuffer(item) {
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item?.base64) return Buffer.from(item.base64, 'base64');
  if (typeof item?.url === 'string' && item.url.startsWith('data:')) {
    return Buffer.from(item.url.split(',')[1] || '', 'base64');
  }
  if (typeof item?.url === 'string') {
    const r = await fetch(item.url);
    if (!r.ok) throw new Error(`fetch image failed (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new Error('no image data on item');
}

/** Composite a bottom-right "XENO" watermark onto an image buffer → PNG Buffer. */
export async function watermarkBuffer(buffer) {
  const img = sharp(buffer);
  const meta = await img.metadata();
  const w = meta.width || 1024;
  const h = meta.height || 1024;
  const fs = Math.max(18, Math.round(w / 22));
  const pad = Math.round(fs * 0.6);
  const stroke = Math.max(1, Math.round(fs / 16));
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}"><text x="${w - pad}" y="${h - pad}" ` +
    `font-family="Arial, Helvetica, sans-serif" font-size="${fs}" font-weight="700" ` +
    `fill="#ffffff" fill-opacity="0.62" text-anchor="end" ` +
    `style="paint-order:stroke;stroke:#000000;stroke-opacity:0.28;stroke-width:${stroke}px">XENO</text></svg>`
  );
  return img.composite([{ input: svg, blend: 'over' }]).png().toBuffer();
}

/**
 * Watermark each image in an OpenAI-style `data` array. Returns items as
 * { b64_json } (self-contained). On a per-image failure it keeps the original item
 * so a watermarking hiccup never fails the user's generation.
 */
export async function watermarkResultData(data) {
  if (!Array.isArray(data)) return data;
  return Promise.all(data.map(async (item) => {
    try {
      const wm = await watermarkBuffer(await itemToBuffer(item));
      return { b64_json: wm.toString('base64') };
    } catch (e) {
      console.warn('[watermark] failed, returning original image:', e.message);
      return item;
    }
  }));
}
