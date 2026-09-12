import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Document, Packer, Paragraph, TextRun } from 'docx';

import { CHAT_PROJECT_CONTRACTS } from '../src/server/config/chatProjectContracts.js';
import { extractAsset, UnsupportedAssetError } from '../src/server/services/library/assetExtractors.js';
import { scanFile } from '../src/server/services/library/assetIngestionService.js';

const roots = [];

async function fixture(name, body = 'fixture') {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xeno-ingestion-contract-'));
  roots.push(root);
  const file = path.join(root, name);
  await fs.promises.writeFile(file, body);
  return file;
}

test.after(async () => {
  await Promise.all(roots.map((root) => fs.promises.rm(root, { recursive: true, force: true })));
});

test('bounded text launch formats preserve deterministic content and format locators', async () => {
  const cases = [
    ['notes.md', 'text/markdown', '# Project fact\nThe launch word is ORCHID.'],
    ['agent.ts', 'application/javascript', 'export const launchWord = "ORCHID";'],
    ['facts.csv', 'text/csv', 'key,value\nlaunch_word,ORCHID'],
    ['readme.txt', 'text/plain', 'The launch word is ORCHID.'],
  ];
  for (const [name, mimeType, content] of cases) {
    const result = await extractAsset({ storagePath: await fixture(name, content), mimeType });
    assert.equal(result.text, content);
    assert.equal(result.sections.length, 1);
    assert.equal(result.sections[0].locator.format, mimeType);
    assert.equal(result.extractorId, 'bounded-text');
  }
});

test('DOCX extraction uses bounded OOXML bytes and returns the document text', async () => {
  const document = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun('The DOCX fact is CERULEAN-47.')] })] }],
  });
  const storagePath = await fixture('fact.docx', await Packer.toBuffer(document));
  const result = await extractAsset({
    storagePath,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  assert.match(result.text, /CERULEAN-47/);
  assert.deepEqual(result.sections[0].locator, { format: 'docx' });
  assert.equal(result.extractorId, 'mammoth');
});

test('textual PDF preserves page locators without invoking OCR', async () => {
  const calls = [];
  const runTool = async (executable) => {
    calls.push(String(executable));
    if (String(executable).includes('pdfinfo')) return 'Pages: 2\n';
    if (String(executable).includes('pdftotext')) return 'First page fact\fSecond page fact\f';
    throw new Error(`unexpected tool ${executable}`);
  };
  const result = await extractAsset({
    storagePath: await fixture('text.pdf', '%PDF fixture'),
    mimeType: 'application/pdf',
    runTool,
  });
  assert.deepEqual(result.sections.map((section) => section.locator), [
    { format: 'pdf', page: 1, method: 'text' },
    { format: 'pdf', page: 2, method: 'text' },
  ]);
  assert.equal(calls.some((call) => call.includes('tesseract')), false);
});

test('image-only PDF takes the bounded render and OCR fallback path', async () => {
  const calls = [];
  const runTool = async (executable, args) => {
    const tool = String(executable);
    calls.push(tool);
    if (tool.includes('pdfinfo')) return 'Pages: 1\n';
    if (tool.includes('pdftotext')) return '\f';
    if (tool.includes('pdftoppm')) {
      await fs.promises.writeFile(`${args.at(-1)}.png`, 'rendered page');
      return '';
    }
    if (tool.includes('identify')) return '1200 800';
    if (tool.includes('tesseract')) return 'OCR-only fact MAGENTA-92\n';
    throw new Error(`unexpected tool ${tool}`);
  };
  const result = await extractAsset({
    storagePath: await fixture('scan.pdf', '%PDF image-only fixture'),
    mimeType: 'application/pdf',
    runTool,
  });
  assert.match(result.text, /MAGENTA-92/);
  assert.deepEqual(result.sections[0].locator, { format: 'pdf', page: 1, method: 'ocr' });
  assert.equal(calls.some((call) => call.includes('pdftoppm')), true);
  assert.equal(calls.some((call) => call.includes('tesseract')), true);
});

test('standalone images use bounded dimensions before OCR', async () => {
  const calls = [];
  const result = await extractAsset({
    storagePath: await fixture('scan.png', 'PNG fixture'),
    mimeType: 'image/png',
    runTool: async (executable) => {
      calls.push(String(executable));
      if (String(executable).includes('identify')) return '640 480';
      if (String(executable).includes('tesseract')) return 'Image fact AMBER-31';
      throw new Error(`unexpected tool ${executable}`);
    },
  });
  assert.match(result.text, /AMBER-31/);
  assert.deepEqual(result.sections[0].locator, { format: 'image', method: 'ocr' });
  assert.equal(calls.length, 2);
});

test('corrupt and unsupported assets fail with stable durable error classes', async () => {
  await assert.rejects(
    extractAsset({
      storagePath: await fixture('broken.docx', 'not a ZIP'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    (error) => error instanceof UnsupportedAssetError && error.code === 'extractor_failed',
  );
  await assert.rejects(
    extractAsset({ storagePath: await fixture('archive.bin'), mimeType: 'application/octet-stream' }),
    (error) => error instanceof UnsupportedAssetError && error.code === 'unsupported_type',
  );
});

test('mandatory scanner fails closed for absence, outage, and malware', async () => {
  assert.equal(CHAT_PROJECT_CONTRACTS.ingestion.scannerRequired, true);
  await assert.rejects(
    scanFile('fixture', { execFileFn: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } }),
    (error) => error.code === 'scanner_unavailable',
  );
  await assert.rejects(
    scanFile('fixture', { execFileFn: async () => { throw Object.assign(new Error('down'), { code: 2 }); } }),
    (error) => error.code === 'scanner_failed',
  );
  await assert.rejects(
    scanFile('fixture', { execFileFn: async () => { throw Object.assign(new Error('infected'), { code: 1 }); } }),
    (error) => error.code === 'malware_detected',
  );
  let invocation = null;
  await scanFile('fixture', { execFileFn: async (...args) => { invocation = args; } });
  assert.deepEqual(invocation[1], ['--no-summary', '--infected', 'fixture']);
});
