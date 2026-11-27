import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import mammoth from 'mammoth';
import { CHAT_PROJECT_CONTRACTS } from '../../config/chatProjectContracts.js';

const execFileAsync = promisify(execFile);

const TEXT_MIMES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/html', 'application/json',
  'application/javascript', 'text/javascript', 'text/css', 'application/xml', 'text/xml',
]);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export class UnsupportedAssetError extends Error {
  constructor(message, code = 'unsupported_type') {
    super(message);
    this.code = code;
  }
}

// mammoth 1.11.0, split by heading. The version changes whenever the sections change shape, so an ingestion from before
// reads as stale and is indexed again (Corpus: ready from an older extractor version → stale).
export const DOCX_EXTRACTOR_VERSION = '1.11.0+headings.1';

const decodeEntities = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');

// mammoth's HTML → plain text: blocks end lines, table cells are tab-separated, every other tag goes
const htmlText = (html) => decodeEntities(String(html)
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
  .replace(/<\/t[dh]>/gi, '\t')
  .replace(/<[^>]+>/g, ''))
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/**
 * One section per heading (h1–h6), each with its heading's text, level and position as its locator; any text before
 * the first heading is a section with no heading. A section's text starts with its heading, so a passage cut from it
 * still says where it is. Empty sections (a heading with nothing under it before the next) are kept: the heading is text.
 */
export function docxSections(html) {
  const parts = String(html || '').split(/(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)/i);
  const out = [];
  let current = null, index = 0;
  const push = () => { if (current) { const t = current.text.trim(); if (t) out.push({ text: t, locator: current.locator }); } };
  for (const part of parts) {
    const h = part.match(/^<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>$/i);
    if (h) {
      push();
      const heading = htmlText(h[2]);
      current = { text: heading + '\n', locator: { format: 'docx', heading, level: Number(h[1]), section: index++ } };
    } else {
      const body = htmlText(part);
      if (!body) continue;
      if (!current) current = { text: '', locator: { format: 'docx', heading: null, level: 0, section: index++ } };
      current.text += body + '\n';
    }
  }
  push();
  return out;
}

function boundedText(buffer) {
  if (buffer.length > CHAT_PROJECT_CONTRACTS.ingestion.maxExtractedBytes) {
    throw new UnsupportedAssetError('Asset exceeds extraction byte limit', 'extract_limit');
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
}

function assertBoundedOutput(text, label) {
  if (Buffer.byteLength(text, 'utf8') > CHAT_PROJECT_CONTRACTS.ingestion.maxExtractedBytes) {
    throw new UnsupportedAssetError(`${label} extraction exceeds output limit`, 'extract_limit');
  }
  return text;
}

async function assertBoundedSource(storagePath) {
  const size = (await fs.promises.stat(storagePath)).size;
  if (size > CHAT_PROJECT_CONTRACTS.ingestion.maxSourceBytes) {
    throw new UnsupportedAssetError('Asset exceeds source byte limit', 'extract_limit');
  }
  return size;
}

async function assertBoundedZip(storagePath, sourceBytes) {
  const handle = await fs.promises.open(storagePath, 'r');
  try {
    const tailLength = Math.min(sourceBytes, 65_557);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, sourceBytes - tailLength);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
    }
    if (eocd < 0) throw new UnsupportedAssetError('DOCX ZIP directory is missing', 'extractor_failed');
    const entries = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      throw new UnsupportedAssetError('ZIP64 DOCX is outside the qualified extraction contract', 'extract_limit');
    }
    if (entries > CHAT_PROJECT_CONTRACTS.ingestion.maxArchiveEntries
        || directoryOffset + directorySize > sourceBytes) {
      throw new UnsupportedAssetError('DOCX archive entry limit exceeded', 'extract_limit');
    }
    const directory = Buffer.alloc(directorySize);
    await handle.read(directory, 0, directorySize, directoryOffset);
    let cursor = 0;
    let expandedBytes = 0;
    let compressedBytes = 0;
    for (let count = 0; count < entries; count += 1) {
      if (cursor + 46 > directory.length || directory.readUInt32LE(cursor) !== 0x02014b50) {
        throw new UnsupportedAssetError('DOCX ZIP directory is malformed', 'extractor_failed');
      }
      compressedBytes += directory.readUInt32LE(cursor + 20);
      expandedBytes += directory.readUInt32LE(cursor + 24);
      cursor += 46 + directory.readUInt16LE(cursor + 28)
        + directory.readUInt16LE(cursor + 30) + directory.readUInt16LE(cursor + 32);
    }
    if (expandedBytes > CHAT_PROJECT_CONTRACTS.ingestion.maxArchiveExpandedBytes
        || expandedBytes > Math.max(1, compressedBytes) * CHAT_PROJECT_CONTRACTS.ingestion.maxCompressionRatio) {
      throw new UnsupportedAssetError('DOCX decompression limit exceeded', 'extract_limit');
    }
  } finally {
    await handle.close();
  }
}

async function runTextTool(executable, args, { timeout = 120_000 } = {}) {
  try {
    const { stdout } = await execFileAsync(executable, args, {
      timeout,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: CHAT_PROJECT_CONTRACTS.ingestion.maxExtractedBytes + 1024 * 1024,
    });
    return stdout;
  } catch (cause) {
    const error = new Error(`${path.basename(executable)} extraction failed`);
    error.code = cause?.code === 'ENOENT' ? 'extractor_runtime_unavailable' : 'extractor_failed';
    error.cause = cause;
    throw error;
  }
}

async function ocrImage(imagePath, runTool = runTextTool) {
  const dimensions = (await runTool(process.env.CHAT_IMAGE_IDENTIFY_PATH || 'identify', [
    '-limit', 'memory', '256MiB', '-limit', 'map', '512MiB', '-format', '%w %h', `${imagePath}[0]`,
  ], { timeout: 30_000 })).trim().split(/\s+/).map(Number);
  if (dimensions.length !== 2 || !dimensions.every(Number.isFinite)
      || dimensions[0] * dimensions[1] > CHAT_PROJECT_CONTRACTS.ingestion.maxImagePixels) {
    throw new UnsupportedAssetError('Image pixel limit exceeded', 'extract_limit');
  }
  return assertBoundedOutput(
    await runTool(process.env.CHAT_OCR_PATH || 'tesseract', [imagePath, 'stdout', '-l', 'eng', '--psm', '3']),
    'OCR',
  );
}

async function extractPdf(storagePath, runTool = runTextTool) {
  const info = await runTool(process.env.CHAT_PDF_INFO_PATH || 'pdfinfo', [storagePath], { timeout: 30_000 });
  const pageCount = Number(info.match(/^Pages:\s+(\d+)$/mi)?.[1] || 0);
  if (!Number.isInteger(pageCount) || pageCount < 1
      || pageCount > CHAT_PROJECT_CONTRACTS.ingestion.maxPagesPerAsset) {
    throw new UnsupportedAssetError('PDF page limit exceeded', 'extract_limit');
  }
  const rawText = await runTool(process.env.CHAT_PDF_TEXT_PATH || 'pdftotext', ['-layout', storagePath, '-']);
  const textPages = rawText.split('\f');
  const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xeno-pdf-ocr-'));
  const sections = [];
  try {
    for (let index = 0; index < textPages.length; index += 1) {
      let text = textPages[index].trim();
      if (!text && index === textPages.length - 1) continue;
      let method = 'text';
      if (!text) {
        const prefix = path.join(tempDirectory, `page-${index + 1}`);
        await runTool(process.env.CHAT_PDF_RENDER_PATH || 'pdftoppm', [
          '-f', String(index + 1), '-l', String(index + 1), '-singlefile', '-png', '-r', '200', storagePath, prefix,
        ]);
        text = (await ocrImage(`${prefix}.png`, runTool)).trim();
        method = 'ocr';
      }
      if (text) sections.push({ text, locator: { format: 'pdf', page: index + 1, method } });
    }
  } finally {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
  }
  const combined = assertBoundedOutput(sections.map((section) => section.text).join('\n\n'), 'PDF');
  return { text: combined, sections, locator: { format: 'pdf' }, extractorId: 'poppler-tesseract', extractorVersion: '1' };
}

export async function extractAsset({ storagePath, mimeType, runTool = runTextTool }) {
  const sourceBytes = await assertBoundedSource(storagePath);
  if (TEXT_MIMES.has(mimeType)) {
    const text = boundedText(await fs.promises.readFile(storagePath));
    return { text, sections: [{ text, locator: { format: mimeType } }], locator: { format: mimeType }, extractorId: 'bounded-text', extractorVersion: '1' };
  }
  if (mimeType === DOCX) {
    await assertBoundedZip(storagePath, sourceBytes);
    // One section per heading, so a citation lands on the heading it came from (XENO Corpus notebooks, agreed contract
    // 2026-11-27). Raw text had made a long document one section, which nothing could cite precisely.
    const result = await mammoth.convertToHtml({ path: storagePath });
    const sections = docxSections(result.value);
    const text = sections.map((s) => s.text).join('\n\n');
    if (Buffer.byteLength(text, 'utf8') > CHAT_PROJECT_CONTRACTS.ingestion.maxExtractedBytes) {
      throw new UnsupportedAssetError('DOCX extraction exceeds output limit', 'extract_limit');
    }
    return { text, sections: sections.length ? sections : [{ text, locator: { format: 'docx' } }], locator: { format: 'docx' }, extractorId: 'mammoth', extractorVersion: DOCX_EXTRACTOR_VERSION };
  }
  if (mimeType === 'application/pdf') {
    return extractPdf(storagePath, runTool);
  }
  if (String(mimeType).startsWith('image/')) {
    const text = await ocrImage(storagePath, runTool);
    return { text, sections: [{ text, locator: { format: 'image', method: 'ocr' } }], locator: { format: 'image', method: 'ocr' }, extractorId: 'tesseract', extractorVersion: '5' };
  }
  if (String(mimeType).startsWith('audio/') || String(mimeType).startsWith('video/')) {
    throw new UnsupportedAssetError('Transcription adapter is not qualified', 'transcription_adapter_unavailable');
  }
  throw new UnsupportedAssetError(`Unsupported MIME type: ${mimeType}`);
}
