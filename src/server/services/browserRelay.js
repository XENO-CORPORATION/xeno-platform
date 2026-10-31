/**
 * The browser relay: platform side of "a chat drives the person's own browser through XENO Extension".
 * Contract: docs/CHAT-TOOL-CALLING-PLAN.md → "Browser tools"; wire shapes in utils/browserRelayProtocol.js.
 *
 * ── WHAT THE PERSON OWNS, AND WHAT WE ONLY HOLD ─────────────────────────────────────────────
 *
 * An INSTALLATION is one browser the person connected, bound to the DPoP key it registered with. A CALL
 * is one tool step the chat asked that browser to perform. We never touch the person's pages: we hand a
 * named tool and its arguments to the extension and wait for what it reports. Approval happens there —
 * in the browser that acts, where the person can see the page — and the platform's only job is to keep
 * the caller waiting and to say so honestly in the transcript.
 *
 * ── 🔴 THE DELIVERY MODEL, AND WHY IT IS THE POSTGRES QUEUE RATHER THAN THE SOCKET ────────────
 *
 * The process that HOLDS the browser's socket and the process that RUNS a chat turn are not guaranteed
 * to be the same one: this backend runs as two replicas behind nginx, so a tool call can execute on the
 * replica that has no connection to that browser. Treating "they are the same process" as true would
 * make a call vanish whenever the load balancer chose the other one, and it would present as a browser
 * that is slow rather than as a bug — the worst possible failure shape.
 *
 * So `browser_calls` is the authority for "is this call finished": the row is the STATE, the socket is
 * only the fastest way to learn it changed. A replica that holds no socket still completes the call by
 * waiting on the row, and `LISTEN browser_calls` (the pattern `agentPresenceStream` already uses) turns
 * the wait from a poll into a push. Correctness comes from the row; latency comes from the notification.
 *
 *   insert row (queued) ──notify 'b'──▶ the replica holding the socket sends it to the browser
 *                                       │
 *   chat waits ──▶ row becomes done ◀───┘ the browser answers; THAT replica writes the row
 *
 * The notification is lossy by design — `NOTIFY` has no delivery guarantee — and that is safe precisely
 * because the waiter also polls. A dropped notification costs latency, never a lost call.
 *
 * ── 🔴 AN IRREVERSIBLE STEP IS NEVER RETRIED ────────────────────────────────────────────────
 *
 * §12.1 rule 11 + the 2026-08-25 addendum: a browser step may CLICK. By the time we could learn that a
 * delivery attempt failed, the click may already have happened, so this module never re-sends a call it
 * has already handed to a socket. A call whose socket dropped goes back to `queued` for the RECONNECTED
 * browser to pick up, and the extension drops (never re-runs) a callId whose earlier execution started.
 */
import { randomUUID } from 'node:crypto';
import { outbound, boundOutput, CLOSE } from '../utils/browserRelayProtocol.js';

/** How long a step may take before the caller gives up. Approvals extend this; see `awaitResult`. */
export const STEP_DEADLINE_MS = 120_000;
export const APPROVAL_DEADLINE_MS = 10 * 60_000;

/** The in-process view: which installation each live socket serves, and which sockets we hold. */
const connections = new Map();     // installationId -> { socket, installation, np, send, close }
let notifier = null, notifyConnecting = null;

const uuid = () => randomUUID();
const nowMs = () => Date.now();

/** One LISTEN connection per replica (pool-backed), shared by every waiter on it. */
async function listen(db, onCallReady) {
  if (notifier) return notifier;
  if (notifyConnecting) return notifyConnecting;
  if (!db || typeof db.connect !== 'function') throw new Error('no pool to listen on');
  notifyConnecting = (async () => {
    const client = await db.connect();
    client.on('notification', (msg) => { if (msg.channel === 'browser_calls' && msg.payload) onCallReady(msg.payload); });
    const drop = () => {
      if (notifier === client) notifier = null;
      try { client.release(true); } catch {}
      if (waiters.size || connections.size) setTimeout(() => listen(db, onCallReady).catch(() => {}), 2000);
    };
    client.on('error', drop); client.on('end', drop);
    await client.query('LISTEN browser_calls');
    notifier = client; notifyConnecting = null;
    return client;
  })().catch((e) => { notifyConnecting = null; throw e; });
  return notifyConnecting;
}

/** Wake-ups: callId -> Set<resolve>. A notification for a call nobody here waits on is not an error. */
const waiters = new Map();
function signal(callId) {
  const set = waiters.get(String(callId));
  if (set) for (const resolve of set) resolve();
}

/**
 * 🔴 What a notification MEANS on this replica. Before 2026-10-17 `listen()` existed and nothing ever called it, so
 * a call queued on replica A never reached a browser connected to replica B — it sat until that browser reconnected.
 *   { callId }               → wake a local waiter (its row changed)
 *   { installation }         → if that browser's socket is HERE, deliver every queued call for it
 *   { installation, close }  → if that browser's socket is HERE, close it (revoked or turned off elsewhere)
 */
function onNotification(db, payload) {
  let msg; try { msg = JSON.parse(payload); } catch { return; }
  if (msg.callId) signal(msg.callId);
  const key = msg.installation ? String(msg.installation) : null;
  if (!key || !connections.has(key)) return;
  if (msg.close) { closeConnection(key, CLOSE.FORBIDDEN, msg.reason || 'revoked'); return; }
  db.query(`SELECT * FROM browser_calls WHERE installation = $1 AND state = 'queued' AND deadline > now() ORDER BY created_at LIMIT 32`, [key])
    .then(({ rows }) => Promise.all(rows.map((call) => deliverHere(db, call))))
    .catch((e) => console.error('[browser-relay] delivery after notify failed', e && e.message));
}

/** Start this replica's listener. Idempotent; called by whoever first needs it (a socket or a waiting call). */
export function ensureListening(db) {
  return listen(db, (payload) => onNotification(db, payload)).catch((e) => console.error('[browser-relay] LISTEN failed', e && e.message));
}

/** Stop listening (tests, shutdown). */
export function stopListening() {
  const c = notifier; notifier = null;
  if (c) { c.removeAllListeners('end'); c.removeAllListeners('error'); try { c.release(true); } catch {} }
}

// ── installations ───────────────────────────────────────────────────────────────────────────

/** Write that the person changed their mind (enabled/label/revoke). Bumps `updated_at` so a stale reader
 *  cannot keep serving a value the person already replaced. Returns null when it is not theirs. */
export async function setEnabled(db, installationId, enabled) {
  const { rows } = await db.query(
    `UPDATE browser_installations SET enabled = $2, updated_at = now()
      WHERE id = $1 AND revoked_at IS NULL RETURNING id, enabled, label`, [installationId, Boolean(enabled)]);
  return rows[0] || null;
}

/** Revoke: sets `revoked_at` (nothing of the person's is deleted), then closes any live socket and fails
 *  every queued call for it — a revocation that leaves a socket open is not a revocation. */
export async function revoke(db, installationId) {
  const key = String(installationId);
  const { rows } = await db.query(
    `UPDATE browser_installations SET revoked_at = now(), enabled = false, updated_at = now()
      WHERE id = $1 AND revoked_at IS NULL RETURNING id`, [key]);
  if (!rows[0]) {
    // Already revoked (or never existed). The EFFECT below must not depend on which request flipped the column —
    // a route that revokes in two steps would otherwise leave a socket open and a call waiting forever.
    const exists = (await db.query('SELECT 1 FROM browser_installations WHERE id = $1', [key])).rows[0];
    if (!exists) return null;
  }
  await disconnect(db, key, 'revoked', 'This browser was disconnected from XENO.');
  return { id: key };
}

/**
 * Stop a browser being used NOW without touching its row: close its socket on whichever replica holds it, and fail
 * every call still waiting on it. Used by revoke and by the person turning chats OFF — 🔴 which must not revoke:
 * before 2026-10-17 "turn off" called revoke(), so pausing a browser permanently deleted the connection.
 */
export async function disconnect(db, installationId, code = 'revoked', message = 'XENO chats are not allowed to use this browser.', closeReason = null) {
  const key = String(installationId);
  closeConnection(key, CLOSE.FORBIDDEN, closeReason || (code === 'revoked' ? 'revoked' : 'XENO chats are not allowed to use this browser'));
  await notify(db, { installation: key, close: true, reason: closeReason || code });
  await failQueued(db, key, code, message);
}

/** Close the socket this installation is using, if it is on this replica. Removing the map entry alone
 *  would leave the socket OPEN — the browser would keep sending frames the relay no longer routes. */
function closeConnection(installationId, code, reason) {
  const entry = connections.get(String(installationId));
  if (!entry) return false;
  connections.delete(String(installationId));
  entry.close(code, reason);
  return true;
}

/** Every call still waiting for an answer on `installation` is failed with one reason. */
async function failQueued(db, installationId, code, message) {
  await db.query(
    `UPDATE browser_calls SET state = 'failed', ok = false, error_code = $2, result = $3::jsonb, updated_at = now()
      WHERE installation = $1 AND state IN ('queued','sent','acked','waiting_approval')`,
    [installationId, code, JSON.stringify({ message })]).catch(() => {});
  await notify(db, { installation: String(installationId) });
}

// ── the socket registry ─────────────────────────────────────────────────────────────────────

/** Register a live socket for an installation; the newest wins and the older one is closed as REPLACED.
 *  Chrome can hold two workers briefly during an update, and two sockets for one browser would deliver
 *  every call twice. */
export function attach({ db, installation, installationId, socket, np }) {
  const key = String(installationId);
  if (db) ensureListening(db);
  const previous = connections.get(key);
  if (previous && previous.socket !== socket) { try { previous.close(CLOSE.REPLACED, 'replaced'); } catch {} }
  const entry = { installation, installationId: key, socket, np, close: (code, reason) => { try { socket.close(code, reason); } catch {} } };
  connections.set(key, entry);
  return entry;
}

export function detach(socket) {
  let held = false;
  for (const [key, entry] of connections) if (entry.socket === socket) { connections.delete(key); held = true; }
  return held;
}

export const liveInstallationIds = () => [...connections.keys()];
export const isLive = (installationId) => connections.has(String(installationId));

/** Deliver a queued call on this replica, if the browser is here. False means another replica has it. */
async function deliverHere(db, call) {
  const entry = connections.get(String(call.installation));
  if (!entry) return false;
  try {
    await db.query(`UPDATE browser_calls SET state = 'sent', updated_at = now() WHERE call_id = $1 AND state = 'queued'`, [call.call_id]);
    entry.socket.send(JSON.stringify(outbound.call({
      callId: call.call_id, tool: call.tool, args: call.args,
      conversationId: call.conversation_id, tabGroup: call.tab_group,
    })));
    return true;
  } catch (e) {
    // The send failed, so the browser may or may not have received it. Back to `queued` — NOT failed, and
    // NOT retried from here: the extension decides, from its own execution ledger, whether it already ran
    // this callId (it reports `interrupted` if it started and never finished).
    await db.query(`UPDATE browser_calls SET state = 'queued', updated_at = now() WHERE call_id = $1 AND state = 'sent'`, [call.call_id]).catch(() => {});
    console.error('[browser-relay] send failed', e && e.message);
    return false;
  }
}

/** Tell every replica a call's state changed. Lossy on purpose — see the header. */
export async function notify(db, payload) {
  try { await db.query('SELECT pg_notify($1, $2)', ['browser_calls', JSON.stringify(payload)]); } catch {}
}

// ── calls ───────────────────────────────────────────────────────────────────────────────────

/** The one place a chat asks a browser to do something, and waits.
 *
 *  Resolves with `{ ok, output }` or `{ ok:false, error:{ code, message } }`. It NEVER throws for a
 *  refusal — a refused step is a RESULT the model must report truthfully, not an exception the turn
 *  dies on. The only throw is a database failure, which is genuinely our problem. */
export async function callTool(db, {
  callId: givenCallId = null, installationId, tool, args, conversationId = null, turnId = null, tabGroup = null,
  actorUserId, stepMs = STEP_DEADLINE_MS, approvalMs = APPROVAL_DEADLINE_MS, onEvent = null, signal: abort = null,
}) {
  ensureListening(db);
  const callId = givenCallId || uuid();
  const deadline = new Date(nowMs() + stepMs);
  // The row is inserted BEFORE anything is sent, so a call that crashes the replica mid-flight is still
  // recoverable and still idempotent: the extension's ledger and this row agree on one id.
  await db.query(
    `INSERT INTO browser_calls (call_id, installation, user_id, conversation_id, tool, args, tab_group, state, deadline)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'queued',$8)`,
    [callId, installationId, actorUserId, conversationId, tool, JSON.stringify(args ?? {}), tabGroup, deadline]);

  // Wake this replica's listener, and ask any replica holding the socket to send.
  await notify(db, { installation: String(installationId), callId });
  const queued = (await db.query(`SELECT * FROM browser_calls WHERE call_id = $1`, [callId])).rows[0];
  if (queued) {
    const sent = await deliverHere(db, queued);
    // Another replica holds the socket; it wakes on the notification and delivers from its side.
    if (!sent) { /* nothing to do here — the row is the contract */ }
  }

  return awaitResult(db, { callId, stepMs, approvalMs, onEvent, abort });
}

/** Wait on the ROW. Notification for latency; polling for correctness. */
async function awaitResult(db, { callId, stepMs, approvalMs, onEvent, abort }) {
  const started = nowMs();
  let deadline = started + stepMs;
  let lastState = null;

  const wait = () => new Promise((resolve) => {
    const set = waiters.get(callId) || new Set();
    set.add(resolve); waiters.set(callId, set);
    const t = setTimeout(() => { set.delete(resolve); resolve(); }, 2000);
    if (typeof t.unref === 'function') t.unref();
  });

  try {
    for (;;) {
      if (abort?.aborted) return { ok: false, error: { code: 'disconnected', message: 'The turn was stopped before the browser answered.' } };
      const { rows } = await db.query(
        `SELECT state, ok, result, error_code, deadline FROM browser_calls WHERE call_id = $1`, [callId]);
      const row = rows[0];
      if (!row) return { ok: false, error: { code: 'internal', message: 'The browser call record vanished.' } };

      if (row.state === 'done' || row.state === 'failed') {
        if (row.ok) return { ok: true, output: row.result ?? null };
        return { ok: false, error: { code: row.error_code || 'tool_error', message: describe(row.error_code, row.result) } };
      }

      // Approval extends the wait, and the caller is told WHICH state we are in so the transcript can say
      // "waiting for approval in <browser>" rather than showing a stalled step.
      if (row.state !== lastState) {
        lastState = row.state;
        try { onEvent?.({ state: row.state, callId }); } catch {}
        if (row.state === 'waiting_approval') deadline = Math.max(deadline, nowMs() + approvalMs);
      }

      if (nowMs() >= deadline) {
        await expire(db, callId);
        return { ok: false, error: { code: 'timeout', message: 'The browser did not finish that step in time.' } };
      }
      await wait();
    }
  } finally {
    waiters.delete(callId);
  }
}

/** A timeout is a RESULT, recorded as one, so a later reader sees why rather than an empty row. */
async function expire(db, callId) {
  await db.query(`UPDATE browser_calls SET state = 'failed', ok = false, error_code = 'timeout', updated_at = now()
                   WHERE call_id = $1 AND state NOT IN ('done','failed')`, [callId]);
  await notify(db, { callId });
}

const DESCRIPTIONS = {
  timeout: 'The browser did not finish that step in time.',
  revoked: 'This browser was disconnected from XENO.',
  not_connected: 'That browser is not connected right now.',
  busy: 'The browser is busy with another XENO step.',
  interrupted: 'That step started earlier and never finished. It was not run again.',
  no_tab: 'The chat has no tab open in that browser yet.',
  blocked: 'The extension refused that step.',
  denied: 'The person declined that step.',
  unknown_tool: 'That browser does not offer that tool.',
  invalid_args: 'The step’s arguments were not valid for that tool.',
};
const describe = (code, result) => {
  const own = result && typeof result === 'object' && typeof result.message === 'string' ? result.message : null;
  return own || DESCRIPTIONS[code] || 'That step could not be completed.';
};

// ── what the extension tells us ─────────────────────────────────────────────────────────────

/** `ack` — the browser has the call and is working on it. */
export async function markAcked(db, callId) {
  const { rows } = await db.query(
    `UPDATE browser_calls SET state = 'acked', updated_at = now()
      WHERE call_id = $1 AND state IN ('queued','sent') RETURNING call_id`, [callId]);
  if (rows[0]) await notify(db, { callId });
  return Boolean(rows[0]);
}

/** `approval` — the person is deciding, or has decided. */
export async function markApproval(db, callId, state) {
  const next = state === 'waiting' ? 'waiting_approval' : null;
  // A decision that is not waiting does not change the state: the RESULT carries the outcome, and
  // inventing an intermediate `denied` here would double-report one step.
  if (next) {
    const { rows } = await db.query(
      `UPDATE browser_calls SET state = $2, updated_at = now() WHERE call_id = $1 AND state IN ('queued','sent','acked') RETURNING call_id`,
      [callId, next]);
    if (rows[0]) await notify(db, { callId });
  }
  return true;
}

/** `result` — the outcome, recorded once. 🔴 IDEMPOTENT: a duplicate result for a finished call is
 *  ignored, never re-applied, because the second write could carry a different answer and the first one
 *  is what the turn already read. */
export async function recordResult(db, callId, ok, outputOrError, { recordCap, note } = {}) {
  if (ok) {
    const bounded = boundOutput(outputOrError, recordCap, note);
    const { rows } = await db.query(
      `UPDATE browser_calls SET state = 'done', ok = true, result = $2::jsonb, updated_at = now()
        WHERE call_id = $1 AND state NOT IN ('done','failed') RETURNING call_id`,
      [callId, JSON.stringify(bounded.output)]);
    await notify(db, { callId });
    return { applied: Boolean(rows[0]), truncated: bounded.truncated };
  }
  const { rows } = await db.query(
    `UPDATE browser_calls SET state = 'failed', ok = false, error_code = $2, result = $3::jsonb, updated_at = now()
      WHERE call_id = $1 AND state NOT IN ('done','failed') RETURNING call_id`,
    [callId, outputOrError.code, JSON.stringify({ message: outputOrError.message })]);
  await notify(db, { callId });
  return { applied: Boolean(rows[0]), truncated: false };
}

/** `hello` — the browser's tool set and version, kept on the row so the account page and the chat's tool
 *  offer both read ONE definition. */
export async function recordHello(db, installationId, { tools, extensionVersion = null }) {
  await db.query(
    `UPDATE browser_installations SET tools = $2::jsonb, extension_version = $3, last_seen_at = now(), updated_at = now()
      WHERE id = $1 AND revoked_at IS NULL`, [installationId, JSON.stringify(tools), extensionVersion]);
}

/** `hello` from a Corpus PC. `tools` stays empty on purpose: it is what offers a device to a chat as a browser. */
export async function recordCorpusHello(db, installationId, { tools, projects, appVersion = null }) {
  await db.query(
    `UPDATE browser_installations SET offered_tools = $2::jsonb, projects = $3::jsonb, extension_version = $4, last_seen_at = now(), updated_at = now()
      WHERE id = $1 AND surface = 'corpus' AND revoked_at IS NULL`, [installationId, JSON.stringify(tools), JSON.stringify(projects), appVersion]);
}

/**
 * A Corpus call is over, so its row stops holding the person's words: what was asked and what came back go, and its status and the size
 * remain. A call still open ends here too, so an answer arriving after the caller gave up can't be written back into the row.
 */
const FORGET = `result_bytes = COALESCE(octet_length(result::text), result_bytes), result = NULL, args = '{}'::jsonb,
    ok = COALESCE(ok, false), error_code = CASE WHEN state IN ('done', 'failed') THEN error_code ELSE 'abandoned' END,
    state = CASE WHEN state IN ('done', 'failed') THEN state ELSE 'failed' END, updated_at = now()`;
export async function forgetCall(db, callId) {
  await db.query(`UPDATE browser_calls SET ${FORGET} WHERE call_id = $1`, [callId]);
}
/** What forgetCall never reached, because the replica died holding it, and old status rows. Runs on the leader. */
export async function sweepForgottenCalls(db) {
  const surfaces = `installation IN (SELECT id FROM browser_installations WHERE surface <> 'browser')`;
  const forgot = await db.query(`UPDATE browser_calls SET ${FORGET} WHERE ${surfaces} AND deadline < now() - interval '2 minutes' AND (result IS NOT NULL OR args <> '{}'::jsonb)`);
  const gone = await db.query(`DELETE FROM browser_calls WHERE ${surfaces} AND created_at < now() - interval '30 days'`);
  return { forgot: forgot.rowCount, gone: gone.rowCount };
}

/** A Corpus PC's socket closed, so it stops counting as connected now: a call would otherwise wait out its deadline on a PC that isn't there. */
export async function markCorpusGone(db, installationId) {
  await db.query(`UPDATE browser_installations SET last_seen_at = now() - interval '61 seconds' WHERE id = $1 AND surface = 'corpus' AND revoked_at IS NULL`, [installationId]).catch(() => {});
}

export async function touch(db, installationId) {
  await db.query(`UPDATE browser_installations SET last_seen_at = now() WHERE id = $1 AND revoked_at IS NULL`, [installationId]).catch(() => {});
}

/** A browser that reconnects picks up whatever its conversation left waiting — the row survived the
 *  socket, which is the whole reason the row exists. */
export async function pendingFor(db, installationId) {
  return (await db.query(
    `SELECT * FROM browser_calls WHERE installation = $1 AND state IN ('queued','sent','acked','waiting_approval')
      AND deadline > now() ORDER BY created_at LIMIT 32`, [installationId])).rows;
}

/** Is this installation usable right now by this person? Returns the row, or a typed refusal. */
export async function usableInstallation(db, userId, installationId) {
  const { rows } = await db.query(
    `SELECT * FROM browser_installations WHERE id = $1 AND revoked_at IS NULL`, [installationId]);
  const row = rows[0];
  if (!row) return { error: { code: 'not_connected', message: 'That browser is not connected to your account.' } };
  // Another person's installation reads as ABSENT, never as forbidden — the same rule projectAgents uses.
  if (String(row.user_id) !== String(userId)) return { error: { code: 'not_connected', message: 'That browser is not connected to your account.' } };
  if (!row.enabled) return { error: { code: 'revoked', message: 'XENO chats are not allowed to use that browser.' } };
  return { row };
}

export const _internals = { connections, waiters, signal, deliverHere };
