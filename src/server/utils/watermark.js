/**
 * watermark — composites a subtle "XENO" mark onto Free-tier generated outputs.
 * Free generations are returned watermarked; Pro/Team get clean output. To prevent
 * bypass, watermarked assets are returned as SELF-CONTAINED data (base64 / data URL);
 * the original, un-watermarked provider URL is NEVER exposed to the client.
 *
 * Images use sharp (SVG text composite). Video reuses the SAME SVG text as a
 * transparent PNG overlaid onto every frame via ffmpeg (present in the backend
 * image — see Dockerfile.backend), so we do not depend on ffmpeg's drawtext/font
 * build. Audio has no visual mark (there is no audio watermark).
 */
import { execFile } from 'child_process';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import sharp from 'sharp';

const execFileP = promisify(execFile);

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

/** The "XENO" mark as an SVG sized to a w×h canvas (bottom-right, subtle). */
function watermarkSvg(w, h) {
  const fs = Math.max(18, Math.round(w / 22));
  const pad = Math.round(fs * 0.6);
  const stroke = Math.max(1, Math.round(fs / 16));
  return Buffer.from(
    `<svg width="${w}" height="${h}"><text x="${w - pad}" y="${h - pad}" ` +
    `font-family="Arial, Helvetica, sans-serif" font-size="${fs}" font-weight="700" ` +
    `fill="#ffffff" fill-opacity="0.62" text-anchor="end" ` +
    `style="paint-order:stroke;stroke:#000000;stroke-opacity:0.28;stroke-width:${stroke}px">XENO</text></svg>`
  );
}

/** Composite a bottom-right "XENO" watermark onto an image buffer → PNG Buffer. */
export async function watermarkBuffer(buffer) {
  const img = sharp(buffer);
  const meta = await img.metadata();
  const w = meta.width || 1024;
  const h = meta.height || 1024;
  return img.composite([{ input: watermarkSvg(w, h), blend: 'over' }]).png().toBuffer();
}

/**
 * Watermark each image in an OpenAI-style `data` array → self-contained { b64_json }.
 *
 * FAIL-CLOSED: if an item cannot be watermarked, this THROWS. Callers apply it inside the
 * metering run() closure, so a throw voids the credit hold — the Free user is not charged
 * and receives NO asset, rather than being handed a clean, un-watermarked image (returning
 * the original bytes on failure would still leak a clean commercial asset; returning an
 * empty image would charge for nothing). The image marker (sharp) is reliable, so this
 * path is effectively never hit in practice.
 */
export async function watermarkResultData(data) {
  if (!Array.isArray(data)) return data;
  return Promise.all(data.map(async (item) => {
    const wm = await watermarkBuffer(await itemToBuffer(item));
    return { b64_json: wm.toString('base64') };
  }));
}

// ── Video watermarking ───────────────────────────────────────────────────────

/** Resolve a video item ({ url } | { b64_json } | data: URL) to a Buffer. */
async function itemToVideoBuffer(item) {
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (typeof item?.url === 'string' && item.url.startsWith('data:')) {
    return Buffer.from(item.url.split(',')[1] || '', 'base64');
  }
  if (typeof item?.url === 'string') {
    const r = await fetch(item.url);
    if (!r.ok) throw new Error(`fetch video failed (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new Error('no video data on item');
}

/** Probe a video file's pixel dimensions via ffprobe. */
async function probeVideoDims(inPath) {
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'json', inPath,
    ], { maxBuffer: 1 << 20 });
    const stream = (JSON.parse(stdout).streams || [])[0] || {};
    return { w: Number(stream.width) || 1280, h: Number(stream.height) || 720 };
  } catch {
    return { w: 1280, h: 720 };
  }
}

/**
 * Watermark ONE video item: overlay the "XENO" mark (rendered by sharp as a
 * transparent PNG) onto every frame with ffmpeg, and return a SELF-CONTAINED
 * data URL. The raw provider URL is never exposed. The `thumbnail_url` (a clean
 * provider frame) is dropped so no un-watermarked still leaks either.
 *
 * Throws on any failure — the caller is expected to VOID the credit hold and
 * surface an error rather than deliver a clean, commercial-usable video to Free.
 */
export async function watermarkVideoItem(item) {
  const buf = await itemToVideoBuffer(item);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'xeno-vwm-'));
  const inPath = path.join(dir, 'in.mp4');
  const pngPath = path.join(dir, 'wm.png');
  const outPath = path.join(dir, 'out.mp4');
  try {
    await writeFile(inPath, buf);
    const { w, h } = await probeVideoDims(inPath);
    const overlay = await sharp(watermarkSvg(w, h)).png().toBuffer();
    await writeFile(pngPath, overlay);
    // scale2ref rescales the mark PNG to the ACTUAL decoded frame, so a wrong/failed probe
    // can't misplace or off-frame the watermark. Then overlay full-frame and map the overlaid
    // video + the ORIGINAL audio (0:a? = optional, so a silent clip does not error; without
    // explicit maps, -filter_complex suppresses audio selection and the clip loses its sound).
    await execFileP('ffmpeg', [
      '-y', '-i', inPath, '-i', pngPath,
      '-filter_complex', '[1:v][0:v]scale2ref[wm][vid];[vid][wm]overlay=0:0[v]',
      '-map', '[v]', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'copy', '-movflags', '+faststart',
      outPath,
    ], { maxBuffer: 1 << 26, timeout: 5 * 60 * 1000 });
    const out = await readFile(outPath);
    // ALLOWLIST the response: hand back ONLY the self-contained watermarked data URL plus
    // known-benign metadata (duration). Any other provider field — including unknown raw-URL
    // fields (video_url/download_url/signed_url/thumbnail_url) — is dropped so nothing lets a
    // Free client fetch the clean original.
    return { url: `data:video/mp4;base64,${out.toString('base64')}`, duration: item?.duration };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Watermark each video in a `data` array. FAIL-CLOSED: any watermarking failure
 * propagates (throws) so the caller voids the credit hold and returns an error
 * instead of leaking a clean video. (Contrast watermarkResultData for images,
 * which is best-effort because the image marker is proven-reliable in prod.)
 */
export async function watermarkVideoData(data) {
  if (!Array.isArray(data)) return data;
  return Promise.all(data.map((item) => watermarkVideoItem(item)));
}
