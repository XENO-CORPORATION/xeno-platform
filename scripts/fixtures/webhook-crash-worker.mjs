import pg from 'pg';
import { WebhookDeliveryWorker } from '../../src/server/services/webhookDelivery.js';
const target = new URL(process.env.NOTIFICATION_TEST_DATABASE_URL);
const receiver = new URL(process.env.NOTIFICATION_TEST_RECEIVER);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/notificationproof' || receiver.hostname !== '127.0.0.1' || !/^delivery_[a-f0-9]+$/.test(process.env.NOTIFICATION_TEST_SCHEMA)) throw new Error('Invalid isolated fixture target');
const pool = new pg.Pool({ connectionString: target.href, options: `-c search_path=${process.env.NOTIFICATION_TEST_SCHEMA}` });
const keepAlive = setInterval(() => {}, 1000);
const worker = new WebhookDeliveryWorker(pool, { transport: async (_url, options) => {
  await fetch(receiver, { method: 'POST', headers: options.headers, body: options.body });
  process.send?.({ accepted: true });
  return new Promise(() => {}); // Kill after receiver acceptance but before local settlement.
} });
await worker.tick();
clearInterval(keepAlive); await pool.end();

