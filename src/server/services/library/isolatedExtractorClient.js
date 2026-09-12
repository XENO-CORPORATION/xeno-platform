import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function extractAssetInIsolatedRuntime({ storagePath, mimeType }) {
  const root = path.resolve(process.env.CHAT_EXTRACTOR_QUEUE_DIR || '/app/extractor-jobs');
  const requests = path.join(root, 'requests');
  const responses = path.join(root, 'responses');
  await Promise.all([
    fs.promises.mkdir(requests, { recursive: true }),
    fs.promises.mkdir(responses, { recursive: true }),
  ]);
  const heartbeat = path.join(root, 'heartbeat');
  const heartbeatStat = await fs.promises.stat(heartbeat).catch(() => null);
  if (!heartbeatStat || Date.now() - heartbeatStat.mtimeMs > 30_000) {
    throw Object.assign(new Error('Network-isolated extractor is unavailable'), { code: 'extractor_runtime_unavailable' });
  }
  const id = crypto.randomUUID();
  const requestPath = path.join(requests, `${id}.json`);
  const requestTemp = `${requestPath}.${process.pid}.tmp`;
  const responsePath = path.join(responses, `${id}.json`);
  await fs.promises.writeFile(requestTemp, JSON.stringify({ id, storagePath, mimeType }), { encoding: 'utf8', flag: 'wx' });
  await fs.promises.rename(requestTemp, requestPath);
  const deadline = Date.now() + Number(process.env.CHAT_EXTRACTOR_TIMEOUT_MS || 180_000);
  try {
    while (Date.now() < deadline) {
      const body = await fs.promises.readFile(responsePath, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (body) {
        const response = JSON.parse(body);
        if (!response.ok) {
          const error = new Error(response.error?.message || 'Isolated extraction failed');
          error.code = response.error?.code || 'extractor_failed';
          throw error;
        }
        return response.result;
      }
      await sleep(100);
    }
    throw Object.assign(new Error('Network-isolated extractor timed out'), { code: 'extractor_timeout' });
  } finally {
    await Promise.allSettled([
      fs.promises.rm(requestPath, { force: true }),
      fs.promises.rm(responsePath, { force: true }),
    ]);
  }
}
