// SES-08: provider/model availability is discovered through the EXISTING
// gateway catalog -- this module keeps no parallel registry and invents no
// models. Selection completes only on an actual provider acknowledgement
// (provider + model + nonce must echo back exactly); command execution needs
// an acked selection plus its own acknowledgement before any result reads.
// Native commands carry honest GUI support: a native-only command executed
// from the GUI is refused as native_only -- and it stays LISTED as
// native-only, never hidden and never simulated as a successful GUI op.
import { randomBytes } from 'node:crypto';

const bad = (code, reason) => { throw Object.assign(new Error(reason), { code }); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, what = 'id') => {
  if (typeof value !== 'string' || !UUID.test(value)) bad('bad_input', `invalid_${what}`);
  return value;
};

async function withTx(poolOrClient, fn) {
  if (typeof poolOrClient.connect === 'function' && typeof poolOrClient.totalCount === 'number') {
    const client = await poolOrClient.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return fn(poolOrClient);
}

/** Availability comes from the gateway catalog: enabled rows, nothing else. */
export async function discoverModels(poolOrClient, { provider } = {}) {
  return withTx(poolOrClient, async (client) => {
    const rows = provider == null
      ? (await client.query(
        'SELECT public_id, internal_id, provider FROM gateway_model_aliases WHERE enabled ORDER BY provider, public_id')).rows
      : (await client.query(
        'SELECT public_id, internal_id, provider FROM gateway_model_aliases WHERE enabled AND provider=$1 ORDER BY public_id',
        [String(provider)],
      )).rows;
    return rows.map((r) => ({ publicId: r.public_id, internalId: r.internal_id, provider: r.provider }));
  });
}

/** Select a catalog model. The selection is pending until the provider acks it. */
export async function selectModel(poolOrClient, { actorUserId, provider, publicId }) {
  const actor = uuid(actorUserId, 'actor');
  if (typeof provider !== 'string' || !provider.trim()) bad('bad_input', 'invalid_provider');
  if (typeof publicId !== 'string' || !publicId.trim()) bad('bad_input', 'invalid_model');
  return withTx(poolOrClient, async (client) => {
    const listed = (await client.query(
      'SELECT public_id FROM gateway_model_aliases WHERE enabled AND provider=$1 AND public_id=$2',
      [provider.trim(), publicId.trim()],
    )).rows[0];
    if (!listed) bad('not_found', 'model_unavailable');
    const nonce = randomBytes(16).toString('hex');
    const row = (await client.query(
      `INSERT INTO provider_model_selections(user_id,provider,public_id,nonce) VALUES($1,$2,$3,$4)
       RETURNING id, status`,
      [actor, provider.trim(), publicId.trim(), nonce],
    )).rows[0];
    return { selectionId: row.id, status: row.status, nonce };
  });
}

/** The provider acknowledges: all three fields must echo back exactly. */
export async function acknowledgeSelection(poolOrClient, { selectionId, provider, publicId, nonce }) {
  const id = uuid(selectionId, 'selection');
  return withTx(poolOrClient, async (client) => {
    const selection = (await client.query(
      'SELECT provider, public_id, nonce, status FROM provider_model_selections WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!selection) bad('not_found', 'selection_not_found');
    if (selection.status === 'acked') bad('conflict', 'selection_already_acked');
    if (selection.provider !== provider || selection.public_id !== publicId || selection.nonce !== nonce) {
      bad('conflict', 'ack_mismatch');
    }
    await client.query("UPDATE provider_model_selections SET status='acked', acked_at=now() WHERE id=$1", [id]);
    return { selectionId: id, status: 'acked' };
  });
}

export async function registerNativeCommand(poolOrClient, { provider, command, guiSupported }) {
  if (typeof provider !== 'string' || !provider.trim()) bad('bad_input', 'invalid_provider');
  if (typeof command !== 'string' || !command.trim()) bad('bad_input', 'invalid_command');
  return withTx(poolOrClient, async (client) => {
    await client.query(
      `INSERT INTO provider_native_commands(provider,command,gui_supported) VALUES($1,$2,$3)
       ON CONFLICT (provider,command) DO UPDATE SET gui_supported=$3`,
      [provider.trim(), command.trim(), guiSupported === true],
    );
    return { provider: provider.trim(), command: command.trim(), guiSupported: guiSupported === true };
  });
}

/** The support matrix, native-only entries included: visible, never simulated. */
export async function listNativeCommands(poolOrClient, { provider }) {
  if (typeof provider !== 'string' || !provider.trim()) bad('bad_input', 'invalid_provider');
  return withTx(poolOrClient, async (client) => {
    return (await client.query(
      'SELECT command, gui_supported FROM provider_native_commands WHERE provider=$1 ORDER BY command',
      [provider.trim()],
    )).rows.map((r) => ({ command: r.command, guiSupported: r.gui_supported }));
  });
}

/**
 * Execute a command: acked selection, registered command, and GUI support
 * when executed from the GUI. The run is submitted -- results wait for
 * the provider's own acknowledgement.
 */
export async function executeCommand(poolOrClient, { actorUserId, selectionId, command, surface }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(selectionId, 'selection');
  if (typeof command !== 'string' || !command.trim()) bad('bad_input', 'invalid_command');
  if (surface !== 'gui' && surface !== 'native') bad('bad_input', 'invalid_surface');
  return withTx(poolOrClient, async (client) => {
    const selection = (await client.query(
      'SELECT user_id, provider, status FROM provider_model_selections WHERE id=$1', [id])).rows[0];
    if (!selection) bad('not_found', 'selection_not_found');
    if (selection.user_id !== actor) bad('denied', 'execute_not_authorized');
    if (selection.status !== 'acked') bad('conflict', 'selection_not_acked');
    const native = (await client.query(
      'SELECT gui_supported FROM provider_native_commands WHERE provider=$1 AND command=$2',
      [selection.provider, command.trim()],
    )).rows[0];
    if (!native) bad('not_found', 'command_unknown');
    if (surface === 'gui' && !native.gui_supported) bad('denied', 'native_only');
    const nonce = randomBytes(16).toString('hex');
    const row = (await client.query(
      `INSERT INTO provider_command_runs(selection_id,provider,command,surface,nonce) VALUES($1,$2,$3,$4,$5)
       RETURNING id, status`,
      [id, selection.provider, command.trim(), surface, nonce],
    )).rows[0];
    return { commandId: row.id, status: row.status, nonce };
  });
}

/** The provider acknowledges execution; the receipt is stored verbatim. */
export async function acknowledgeCommand(poolOrClient, { commandId, nonce, receipt }) {
  const id = uuid(commandId, 'command');
  if (receipt === undefined) bad('bad_input', 'receipt_required');
  return withTx(poolOrClient, async (client) => {
    const run = (await client.query(
      'SELECT nonce, status FROM provider_command_runs WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!run) bad('not_found', 'command_not_found');
    if (run.status === 'acked') bad('conflict', 'command_already_acked');
    if (run.nonce !== nonce) bad('conflict', 'ack_mismatch');
    await client.query('UPDATE provider_command_runs SET status=$2, receipt=$3 WHERE id=$1',
      [id, 'acked', JSON.stringify(receipt)]);
    return { commandId: id, status: 'acked' };
  });
}

/** Results read only after the provider's acknowledgement. */
export async function readCommandResult(poolOrClient, { actorUserId, commandId }) {
  const actor = uuid(actorUserId, 'actor');
  const id = uuid(commandId, 'command');
  return withTx(poolOrClient, async (client) => {
    const run = (await client.query(
      `SELECT r.status, r.receipt, r.provider, r.command, s.user_id FROM provider_command_runs r
       JOIN provider_model_selections s ON s.id=r.selection_id WHERE r.id=$1`, [id])).rows[0];
    if (!run) bad('not_found', 'command_not_found');
    if (run.user_id !== actor) bad('denied', 'result_not_authorized');
    if (run.status !== 'acked') bad('conflict', 'command_not_acked');
    return { commandId: id, provider: run.provider, command: run.command, receipt: run.receipt };
  });
}
