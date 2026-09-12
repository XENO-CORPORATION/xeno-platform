import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { extractAsset } from '../services/library/assetExtractors.js';

const root = path.resolve(process.env.CHAT_EXTRACTOR_QUEUE_DIR || '/app/extractor-jobs');
const requests = path.join(root, 'requests');
const processing = path.join(root, 'processing');
const responses = path.join(root, 'responses');
const inputRoots = String(process.env.CHAT_EXTRACTOR_INPUT_ROOTS || '/app/uploads,/app/storage')
  .split(',').map((entry) => path.resolve(entry.trim())).filter(Boolean);
let stopping = false;

await Promise.all([requests, processing, responses].map((directory) => fs.promises.mkdir(directory, { recursive: true })));

function allowedInput(candidate) {
  const resolved = path.resolve(candidate);
  return inputRoots.some((rootPath) => resolved === rootPath || resolved.startsWith(`${rootPath}${path.sep}`));
}

async function writeResponse(id, payload) {
  const destination = path.join(responses, `${id}.json`);
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporary, JSON.stringify(payload), { encoding: 'utf8', flag: 'wx' });
  await fs.promises.rename(temporary, destination);
}

async function processOne(filename) {
  const source = path.join(requests, filename);
  const claimed = path.join(processing, `${process.pid}-${filename}`);
  try {
    await fs.promises.rename(source, claimed);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  let request;
  try {
    request = JSON.parse(await fs.promises.readFile(claimed, 'utf8'));
    if (!request?.id || `${request.id}.json` !== filename || !allowedInput(request.storagePath)) {
      throw Object.assign(new Error('Extractor request path is outside its read-only input roots'), { code: 'invalid_extractor_request' });
    }
    const result = await extractAsset({ storagePath: request.storagePath, mimeType: request.mimeType });
    await writeResponse(request.id, { ok: true, result });
  } catch (error) {
    if (request?.id) await writeResponse(request.id, {
      ok: false,
      error: { code: error.code || 'extractor_failed', message: String(error.message || 'Extraction failed').slice(0, 500) },
    });
  } finally {
    await fs.promises.rm(claimed, { force: true });
  }
}

async function sweep() {
  await fs.promises.writeFile(path.join(root, 'heartbeat'), new Date().toISOString(), 'utf8');
  const files = (await fs.promises.readdir(requests)).filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name)).slice(0, 8);
  for (const file of files) await processOne(file);
}

console.log(`[ChatAssetExtractor] networkless queue ready at ${root}`);
process.once('SIGTERM', () => { stopping = true; });
process.once('SIGINT', () => { stopping = true; });
while (!stopping) {
  await sweep().catch((error) => console.error('[ChatAssetExtractor] sweep failed:', error.message));
  await new Promise((resolve) => setTimeout(resolve, 100));
}
