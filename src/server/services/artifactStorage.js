/**
 * Where artifact bytes live.
 *
 * Two backends behind one interface — `put(key, bytes, contentType)`,
 * `get(key)`, `head(key)` — chosen once at boot from the environment:
 *
 *   r2   when ARTIFACTS_R2_BUCKET is set together with the R2 credentials the
 *        platform already holds for signed download links. Requests are signed
 *        with AWS SigV4 by hand (about eighty lines below) rather than by
 *        pulling in an SDK: the SDK rules of this workspace say a small audited
 *        implementation beats a dependency, and R2's S3 surface is exactly
 *        PUT/GET/HEAD here. Keys are content-addressed and never overwritten,
 *        which is the immutability convention R2 lacks natively.
 *   fs   otherwise, under ARTIFACTS_DIR (default <server>/data/artifacts).
 *        This is the CI and local-development backend, and the honest fallback
 *        on a box with no bucket configured — never a silent production default:
 *        the boot line prints which one is active.
 */
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KEY_PATTERN = /^artifacts\/[A-Za-z0-9_-]+\/r\d+\/[A-Za-z0-9._\-/]+$/;
// Per-chat sandbox files (CHAT-CODE-EXECUTION-SPEC.md) share this store's R2/fs backend and its
// hand-rolled SigV4 client rather than a second copy. Confined to one namespace under one UUID dir;
// `..` and empty segments are still refused below, so a sandbox can address neither another sandbox
// nor the artifacts namespace. Named `chat-sandboxes` because `workspace` is the tenancy scope here.
const SANDBOX_KEY_PATTERN = /^chat-sandboxes\/[0-9a-fA-F-]{36}\/[A-Za-z0-9._\- /]+$/;

// XENO Storage: an account file's bytes, content-addressed (services/storageObjects.js).
const FILE_KEY_PATTERN = /^files\/[0-9a-f]{2}\/[0-9a-f]{64}$/;
// The ledger's outside anchor (services/ledgerChainAnchor.js), in its own bucket.
const ANCHOR_KEY_PATTERN = /^(checkpoints\/\d{12}\.json|keys\/[0-9a-f]{16}\.json)$/;

function assertKey(key) {
  const inNamespace = typeof key === 'string' && (KEY_PATTERN.test(key) || SANDBOX_KEY_PATTERN.test(key) || FILE_KEY_PATTERN.test(key) || ANCHOR_KEY_PATTERN.test(key));
  if (!inNamespace || key.includes('..') || key.includes('//')) {
    throw new Error(`Refusing storage key outside the allowed namespaces: ${key}`);
  }
}

// ── filesystem ──────────────────────────────────────────────────────────────

function fsBackend(root) {
  const resolvedRoot = path.resolve(root);
  const target = (key) => {
    assertKey(key);
    const absolute = path.resolve(resolvedRoot, ...key.split('/'));
    if (!absolute.startsWith(resolvedRoot + path.sep)) throw new Error('Storage key escaped its root');
    return absolute;
  };
  return {
    kind: 'fs',
    describe: () => `fs ${resolvedRoot}`,
    async put(key, bytes) {
      const file = target(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fs.writeFile(tmp, bytes);
      await fs.rename(tmp, file);
    },
    async get(key) {
      try {
        return await fs.readFile(target(key));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async head(key) {
      try {
        const stat = await fs.stat(target(key));
        return { sizeBytes: stat.size };
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    /** Remove an object. Used only for account files (services/storageObjects.js); artifacts are never deleted here. */
    async delete(key) {
      try { await fs.unlink(target(key)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    },
  };
}

// ── R2 (S3 API, SigV4) ──────────────────────────────────────────────────────

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** RFC 3986 encoding of one key segment the way S3 expects it. */
function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function amzDateOf(now) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

export function signV4({ method, host, canonicalUri, headers, payloadHash, accessKeyId, secretAccessKey, region = 'auto', service = 's3', now = new Date() }) {
  const amzDate = amzDateOf(now);
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaderNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${String(headers[Object.keys(headers).find((h) => h.toLowerCase() === name)]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    host,
  };
}

function r2Backend({ accountId, accessKeyId, secretAccessKey, bucket, fetchImpl = globalThis.fetch }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const request = async (method, key, body, extraHeaders = {}) => {
    assertKey(key);
    const canonicalUri = `/${encodeSegment(bucket)}/${key.split('/').map(encodeSegment).join('/')}`;
    const payloadHash = sha256Hex(body ?? '');
    const now = new Date();
    const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDateOf(now), ...extraHeaders };
    const { authorization } = signV4({ method, host, canonicalUri, headers, payloadHash, accessKeyId, secretAccessKey, now });
    return fetchImpl(`https://${host}${canonicalUri}`, {
      method,
      headers: { ...headers, authorization, ...(body ? { 'content-length': String(body.length) } : {}) },
      ...(body ? { body } : {}),
    });
  };
  return {
    kind: 'r2',
    describe: () => `r2 ${bucket}`,
    async put(key, bytes) {
      const response = await request('PUT', key, bytes);
      if (!response.ok) throw new Error(`R2 PUT ${key} failed: ${response.status} ${await response.text().catch(() => '')}`);
    },
    /** Write only if the key is empty. Returns false when something is already there; never replaces it. */
    async putNew(key, bytes) {
      const response = await request('PUT', key, bytes, { 'if-none-match': '*' });
      if (response.status === 412) return false;
      if (!response.ok) throw new Error(`R2 PUT ${key} failed: ${response.status} ${await response.text().catch(() => '')}`);
      return true;
    },
    async get(key) {
      const response = await request('GET', key);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`R2 GET ${key} failed: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
    async head(key) {
      const response = await request('HEAD', key);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`R2 HEAD ${key} failed: ${response.status}`);
      return { sizeBytes: Number(response.headers.get('content-length') ?? 0) };
    },
    /** Remove an object. Used only for account files (services/storageObjects.js); artifacts are never deleted here. */
    async delete(key) {
      const response = await request('DELETE', key);
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`R2 DELETE ${key} failed: ${response.status}`);
      return true;
    },
  };
}

let active;

/** The backend for this process, chosen from the environment once. */
export function artifactStorage(env = process.env) {
  if (active) return active;
  const bucket = env.ARTIFACTS_R2_BUCKET?.trim();
  if (bucket && env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    active = r2Backend({ accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket });
  } else {
    active = fsBackend(env.ARTIFACTS_DIR?.trim() || path.join(__dirname, '..', 'data', 'artifacts'));
  }
  return active;
}

let files;
/** The object store for account files (XENO Storage). Its own bucket when STORAGE_R2_BUCKET is set, else the
    artifacts bucket under the `files/` namespace; the filesystem backend where no bucket is configured. */
export function fileStorage(env = process.env) {
  if (files) return files;
  const bucket = (env.STORAGE_R2_BUCKET || env.ARTIFACTS_R2_BUCKET || '').trim();
  if (bucket && env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    files = r2Backend({ accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket });
  } else {
    files = fsBackend(env.STORAGE_DIR?.trim() || env.ARTIFACTS_DIR?.trim() || path.join(__dirname, '..', 'data', 'artifacts'));
  }
  return files;
}
export function setFileStorageForTests(backend) { files = backend; }

/** Tests inject a backend; production never calls this. */
export function setArtifactStorageForTests(backend) {
  active = backend;
}

export const _internal = { fsBackend, r2Backend, assertKey };
