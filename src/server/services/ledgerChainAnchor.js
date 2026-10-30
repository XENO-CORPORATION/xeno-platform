/**
 * The ledger chain's anchor OUTSIDE the database (docs/decisions/2026-10-30-ledger-chain-v2.md).
 *
 * A chain inside the database proves nothing to someone who can rewrite the database: they recompute every hash and it
 * verifies. So every hour the head of every account's chain goes into a checkpoint that binds the previous checkpoint,
 * is signed (Ed25519), and is written once to a separate R2 bucket under a retention lock, where neither this process
 * nor anyone holding its credentials can replace it. CloudTrail's digest files and Certificate Transparency's signed
 * tree heads are the same shape.
 *
 * Verification reads the object from R2, never the database's copy: every anchored head must still be in the chain.
 * Rewriting any entry at or before an anchored head changes that head, so checking the latest checkpoint is enough.
 *
 * Fails closed in the honest direction: with no bucket or key configured it reports `not-configured` and anchors
 * nothing, rather than pretending. Account ids are opaque; no personal data leaves the database.
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { _internal as storageInternal } from './artifactStorage.js';

const CHECKPOINT_VERSION = 1;
const pad = (no) => String(no).padStart(12, '0');
export const checkpointKey = (no) => `checkpoints/${pad(no)}.json`;
export const keyObjectKey = (keyId) => `keys/${keyId}.json`;
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

export function keyIdOf(publicKeyB64) {
  return sha256(publicKeyB64).slice(0, 16);
}

/** Public keys trusted to sign checkpoints. Old keys stay, so history keeps verifying after a rotation. */
export function loadTrustedKeys() {
  const file = new URL('../data/ledger-anchor-keys.json', import.meta.url);
  return JSON.parse(readFileSync(file, 'utf8')).keys;
}

export function signerFromPrivateKey(privateKeyB64) {
  const key = crypto.createPrivateKey({ key: Buffer.from(privateKeyB64, 'base64'), format: 'der', type: 'pkcs8' });
  const publicKey = crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64');
  const keyId = keyIdOf(publicKey);
  return { keyId, publicKey, sign: (text) => crypto.sign(null, Buffer.from(text, 'utf8'), key).toString('base64') };
}

function verifySignature(checkpoint, trustedKeys) {
  const publicKey = trustedKeys[checkpoint.keyId];
  if (!publicKey) return false;
  const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  return crypto.verify(null, Buffer.from(checkpoint.bodyHash, 'utf8'), key, Buffer.from(checkpoint.signature, 'base64'));
}

/** Parse and check one stored checkpoint. Returns a reason string when it cannot be trusted. */
export function checkCheckpoint(checkpoint, trustedKeys, expectedNo) {
  if (!checkpoint?.body || checkpoint.body.no !== expectedNo) return 'wrong-number';
  if (sha256(JSON.stringify(checkpoint.body)) !== checkpoint.bodyHash) return 'body-hash';
  if (!verifySignature(checkpoint, trustedKeys)) return 'signature';
  return null;
}

/** The store and signer from the environment, or null when anchoring is not configured. */
export function anchorFromEnv(env = process.env) {
  const bucket = env.LEDGER_ANCHOR_R2_BUCKET?.trim();
  const privateKey = env.LEDGER_ANCHOR_PRIVATE_KEY?.trim();
  const accessKeyId = env.LEDGER_ANCHOR_R2_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.LEDGER_ANCHOR_R2_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY;
  if (!bucket || !privateKey || !env.R2_ACCOUNT_ID || !accessKeyId || !secretAccessKey) return null;
  return {
    store: storageInternal.r2Backend({ accountId: env.R2_ACCOUNT_ID, accessKeyId, secretAccessKey, bucket }),
    signer: signerFromPrivateKey(privateKey),
    trustedKeys: loadTrustedKeys(),
  };
}

async function readCheckpoint(store, no) {
  const bytes = await store.get(checkpointKey(no));
  return bytes ? JSON.parse(bytes.toString('utf8')) : null;
}

async function recordCheckpoint(db, checkpoint) {
  await db.query(
    `INSERT INTO ledger_chain_checkpoints (no, prev_hash, body_hash, key_id, object_key, accounts)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (no) DO NOTHING`,
    [checkpoint.body.no, checkpoint.body.prev, checkpoint.bodyHash, checkpoint.keyId, checkpointKey(checkpoint.body.no), checkpoint.body.heads.length],
  );
}

/**
 * Find the newest checkpoint in R2, walking up from the database's last known number, so a crash between the upload and
 * the row, or a database restored to an older copy, is noticed. The bucket is the authority, not the table.
 */
async function latestAnchored(db, { store, trustedKeys }) {
  const known = (await db.query('SELECT max(no) AS no FROM ledger_chain_checkpoints')).rows[0]?.no;
  let no = known ? Number(known) : 0;
  let latest = null;
  if (no > 0) {
    latest = await readCheckpoint(store, no);
    if (!latest) return { error: 'checkpoint-missing-from-bucket', no };
    const bad = checkCheckpoint(latest, trustedKeys, no);
    if (bad) return { error: `checkpoint-${bad}`, no };
  }
  for (;;) {
    const next = await readCheckpoint(store, no + 1);
    if (!next) break;
    const bad = checkCheckpoint(next, trustedKeys, no + 1);
    if (bad) return { error: `checkpoint-${bad}`, no: no + 1 };
    if (next.body.prev !== (latest?.bodyHash ?? null)) return { error: 'checkpoint-chain', no: no + 1 };
    await recordCheckpoint(db, next);
    latest = next; no += 1;
  }
  return { latest, no };
}

/** Every head in the checkpoint must still be in the chain. Returns the accounts that differ. */
async function compareToChain(db, checkpoint) {
  const mismatches = [];
  for (const [accountId, epoch, seq, hash] of checkpoint.body.heads) {
    const found = seq === 0
      ? (await db.query('SELECT epoch_hash AS hash FROM ledger_chain_epochs WHERE account_id=$1 AND epoch=$2', [accountId, epoch])).rows[0]?.hash
      : (await db.query('SELECT entry_hash AS hash FROM credit_transactions WHERE account_id=$1 AND chain_epoch=$2 AND chain_seq=$3', [accountId, epoch, seq])).rows[0]?.hash;
    if (found !== hash) mismatches.push({ accountId, epoch, seq, checkpoint: checkpoint.body.no });
  }
  return mismatches;
}

/**
 * One anchoring pass: check the chain against the last anchored checkpoint, then write a new one if any head moved.
 * Returns what it found; the audit (services/ledgerChainAudit.js) records mismatches as broken verdicts.
 */
export async function runAnchorPass(db, anchor) {
  if (!anchor) return { configured: false, mismatches: [] };
  const { store, signer, trustedKeys } = anchor;
  const found = await latestAnchored(db, { store, trustedKeys });
  if (found.error) return { configured: true, error: found.error, no: found.no, mismatches: [] };
  const mismatches = found.latest ? await compareToChain(db, found.latest) : [];
  // Never anchor over a disagreement: a new checkpoint would carry the rewritten head and launder it. The alarm stays
  // up, every pass, until a person looks (acknowledgeAnchors below).
  if (mismatches.length) return { configured: true, mismatches, no: found.no, wrote: false, blocked: true };

  const heads = await currentHeads(db);
  if (JSON.stringify(heads) === JSON.stringify(found.latest?.body.heads ?? [])) {
    return { configured: true, mismatches, no: found.no, wrote: false };
  }
  const checkpoint = await writeCheckpoint(db, anchor, found, heads);
  if (!checkpoint) return { configured: true, mismatches, no: found.no, wrote: false, raced: true }; // the next pass adopts it
  return { configured: true, mismatches, no: checkpoint.body.no, wrote: true };
}

async function currentHeads(db) {
  return (await db.query('SELECT account_id::text AS account_id, epoch, seq, head_hash FROM ledger_chain_heads ORDER BY account_id')).rows
    .map((h) => [h.account_id, h.epoch, Number(h.seq), h.head_hash]);
}

async function writeCheckpoint(db, { store, signer }, found, heads, ack) {
  const body = { v: CHECKPOINT_VERSION, no: found.no + 1, prev: found.latest?.bodyHash ?? null, at: new Date().toISOString(), heads, ...(ack ? { ack } : {}) };
  const bodyHash = sha256(JSON.stringify(body));
  const checkpoint = { body, bodyHash, keyId: signer.keyId, signature: signer.sign(bodyHash) };
  await store.putNew(keyObjectKey(signer.keyId), Buffer.from(JSON.stringify({ keyId: signer.keyId, publicKey: signer.publicKey, algorithm: 'ed25519' })));
  if (!(await store.putNew(checkpointKey(body.no), Buffer.from(JSON.stringify(checkpoint))))) return null;
  await recordCheckpoint(db, checkpoint);
  return checkpoint;
}

/**
 * A person accepts that anchored heads are gone (a database restored from backup after a disaster). Writes a checkpoint
 * carrying who, why and what differed; older checkpoints stop being compared. It cannot erase anything: the old
 * checkpoints stay in the bucket, and every outside check prints every acknowledgement. Run through
 * scripts/ledger-anchor-acknowledge.mjs (docs/LEDGER-OPERATIONS.md).
 */
export async function acknowledgeAnchors(db, anchor, { actor, reason }) {
  if (!actor?.trim() || !reason?.trim()) throw new Error('an acknowledgement names who and why');
  const found = await latestAnchored(db, anchor);
  if (found.error) throw new Error(`cannot acknowledge: ${found.error}`);
  const mismatches = found.latest ? await compareToChain(db, found.latest) : [];
  if (!mismatches.length) throw new Error('nothing to acknowledge: the chain agrees with the anchor');
  const ack = { actor, reason, at: new Date().toISOString(), differed: mismatches };
  const checkpoint = await writeCheckpoint(db, anchor, found, await currentHeads(db), ack);
  if (!checkpoint) throw new Error('another checkpoint was written at the same moment; run it again');
  return { no: checkpoint.body.no, accounts: mismatches.length };
}

/**
 * Walk every checkpoint in the bucket from the first: signatures, the chain between them, and the database against
 * EVERY checkpoint since the last acknowledgement, not just the newest: a rewriter holding the signing key can add a
 * forged checkpoint but cannot remove an honest one. Used by scripts/verify-ledger-anchors.mjs and, daily, by the audit.
 */
export async function verifyAllCheckpoints(db, { store, trustedKeys }) {
  let no = 0; let prev = null; const acks = []; let compare = new Map();
  for (;;) {
    const checkpoint = await readCheckpoint(store, no + 1);
    if (!checkpoint) break;
    const bad = checkCheckpoint(checkpoint, trustedKeys, no + 1);
    if (bad) return { ok: false, reason: `checkpoint-${bad}`, no: no + 1 };
    if (checkpoint.body.prev !== prev) return { ok: false, reason: 'checkpoint-chain', no: no + 1 };
    if (checkpoint.body.ack) { acks.push({ no: no + 1, ...checkpoint.body.ack }); compare = new Map(); }
    for (const head of checkpoint.body.heads) compare.set(head.join('|'), { head, no: no + 1 });
    prev = checkpoint.bodyHash; no += 1;
  }
  const mismatches = [];
  for (const { head, no: at } of compare.values()) {
    mismatches.push(...await compareToChain(db, { body: { no: at, heads: [head] } }));
  }
  return { ok: mismatches.length === 0, checkpoints: no, compared: compare.size, acks, mismatches, reason: mismatches.length ? 'anchor-mismatch' : undefined };
}
