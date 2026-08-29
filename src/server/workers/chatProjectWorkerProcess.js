import http from 'http';

import { pool } from '../middleware/database.js';
import { startScheduledTasksWorker } from './chatScheduledWorker.js';
import { startLibraryIngestionWorker } from './libraryIngestionWorker.js';

const startedAt = new Date().toISOString();
let ready = false;
let lastDatabaseCheck = null;

await pool.query('SELECT 1 FROM chat_scheduled_runs LIMIT 0');
await pool.query('SELECT 1 FROM library_asset_ingestions LIMIT 0');
lastDatabaseCheck = new Date().toISOString();

const stopSchedule = startScheduledTasksWorker(pool);
const stopIngestion = startLibraryIngestionWorker(pool);
ready = true;

const healthPort = Number(process.env.CHAT_WORKER_HEALTH_PORT || 8081);
const server = http.createServer(async (req, res) => {
  if (req.url !== '/health' && req.url !== '/ready') {
    res.writeHead(404).end();
    return;
  }
  try {
    await pool.query('SELECT 1');
    lastDatabaseCheck = new Date().toISOString();
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready, startedAt, lastDatabaseCheck, workers: ['scheduled-chat', 'library-ingestion'] }));
  } catch (error) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready: false, error: 'database_unavailable' }));
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
