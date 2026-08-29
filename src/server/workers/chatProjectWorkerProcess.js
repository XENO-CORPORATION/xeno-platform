import http from 'http';

import { pool } from '../middleware/database.js';
import { startScheduledTasksWorker } from './chatScheduledWorker.js';
import { startLibraryIngestionWorker } from './libraryIngestionWorker.js';
import { activeChatWorkerNames, resolveChatWorkerActivation } from './chatWorkerActivation.js';
import {
  checkChatProjectWorkerDependencies,
  chatProjectWorkerProbeStatus,
} from './chatProjectWorkerReadiness.js';

const startedAt = new Date().toISOString();
let ready = false;
let lastDatabaseCheck = null;
let dependencies = null;

const checkDependencies = async () => {
  dependencies = await checkChatProjectWorkerDependencies(pool);
  lastDatabaseCheck = dependencies.checkedAt;
  return dependencies;
};

await pool.query('SELECT 1 FROM chat_scheduled_runs LIMIT 0');
await pool.query('SELECT 1 FROM library_asset_ingestions LIMIT 0');
await checkDependencies();

const activation = resolveChatWorkerActivation();
const workers = activeChatWorkerNames(activation);
const stopSchedule = activation.scheduler ? startScheduledTasksWorker(pool) : () => {};
const stopIngestion = activation.ingestion ? startLibraryIngestionWorker(pool) : () => {};
console.log(`[ChatProjectWorkers] activation scheduler=${activation.scheduler} ingestion=${activation.ingestion}`);
ready = true;

const healthPort = Number(process.env.CHAT_WORKER_HEALTH_PORT || 8081);
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (!['/health', '/ready', '/ready/semantic'].includes(pathname)) {
    res.writeHead(404).end();
    return;
  }
  try {
    await checkDependencies();
    const status = chatProjectWorkerProbeStatus(pathname, { processReady: ready, dependencies });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ready: status === 200,
      processReady: ready,
      startedAt,
      lastDatabaseCheck,
      components: dependencies.components,
      workers,
      activation,
    }));
  } catch (error) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ready: false,
      error: error?.code || 'worker_dependency_unavailable',
      lastDatabaseCheck,
      components: dependencies?.components || null,
    }));
  }
});
server.listen(healthPort, '0.0.0.0', () => console.log(`[ChatProjectWorkers] health listening on ${healthPort}`));

const shutdown = async () => {
  ready = false;
  stopSchedule();
  stopIngestion();
  server.close();
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
