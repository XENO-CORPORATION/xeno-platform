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
import { promises as fs, createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';

/** Write a stream to `file` (through a temp name, renamed at the end) while hashing it: { size, sha256 }. */
async function writeStreamHashed(source, file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.part`;
  const hash = crypto.createHash('sha256');
  let size = 0;
  try {
    await pipeline(source, async function* (chunks) { for await (const c of chunks) { hash.update(c); size += c.length; yield c; } }, createWriteStream(tmp));
    await fs.rename(tmp, file);
  } catch (error) { await fs.unlink(tmp).catch(() => {}); throw error; }
  return { size, sha256: hash.digest('hex') };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KEY_PATTERN = /^artifacts\/[A-Za-z0-9_-]+\/r\d+\/[A-Za-z0-9._\-/]+$/;
// Per-chat sandbox files (CHAT-CODE-EXECUTION-SPEC.md) share this store's R2/fs backend and its
// hand-rolled SigV4 client rather than a second copy. Confined to one namespace under one UUID dir;
// `..` and empty segments are still refused below, so a sandbox can address neither another sandbox
// nor the artifacts namespace. Named `chat-sandboxes` because `workspace` is the tenancy scope here.
const SANDBOX_KEY_PATTERN = /^chat-sandboxes\/[0-9a-fA-F-]{36}\/[A-Za-z0-9._\- /]+$/;

// XENO Storage: an account file's bytes, content-addressed (services/storageObjects.js).
const FILE_KEY_PATTERN = /^files\/[0-9a-f]{2}\/[0-9a-f]{64}$/;
// The ledger's outside anchor (services/ledgerChainAnchor.js), under a retention-locked prefix.
const ANCHOR_KEY_PATTERN = /^ledger-anchors\/(checkpoints\/\d{12}\.json|keys\/[0-9a-f]{16}\.json)$/;
// XENO Depot's content-addressed objects, one namespace per workspace (services/storageDepotObjects.js).
const DEPOT_KEY_PATTERN = /^depot\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{2}\/[0-9a-f]{64}$/;
// XENO Storage upload sessions: the staging object a multipart upload is assembled into (services/storageUploads.js).
const UPLOAD_KEY_PATTERN = /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertKey(key) {
  const inNamespace = typeof key === 'string' && (KEY_PATTERN.test(key) || SANDBOX_KEY_PATTERN.test(key) || FILE_KEY_PATTERN.test(key) || ANCHOR_KEY_PATTERN.test(key) || DEPOT_KEY_PATTERN.test(key) || UPLOAD_KEY_PATTERN.test(key));
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
    /** Write only if the key is empty (a hard link refuses to replace). Returns false when something is there. */
    async putNew(key, bytes) {
      const file = target(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fs.writeFile(tmp, bytes);
      try { await fs.link(tmp, file); return true; }
      catch (error) { if (error.code === 'EEXIST') return false; throw error; }
      finally { await fs.unlink(tmp).catch(() => {}); }
    },
    /** Bytes `start`..`end` inclusive (clamped to the object), or null when the object is absent. */
    async getRange(key, start, end) {
      let handle;
      try { handle = await fs.open(target(key), 'r'); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      try {
        const size = (await handle.stat()).size;
        const last = Math.min(end, size - 1);
        if (start > last) return Buffer.alloc(0);
        const buffer = Buffer.alloc(last - start + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
        return buffer.subarray(0, bytesRead);
      } finally { await handle.close(); }
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

    // ── multipart, the same contract as R2's (parts numbered from 1, listed in order, assembled on complete) ──
    async createMultipart(key) {
      target(key);
      const id = crypto.randomUUID();
      await fs.mkdir(partsDir(id), { recursive: true });
      await fs.writeFile(path.join(partsDir(id), 'key'), key);
      return id;
    },
    async uploadPart(key, uploadId, partNumber, bytes) {
      await assertUpload(key, uploadId);
      const file = path.join(partsDir(uploadId), String(partNumber).padStart(5, '0'));
      const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fs.writeFile(tmp, bytes); await fs.rename(tmp, file);
      return { partNumber, etag: crypto.createHash('md5').update(bytes).digest('hex') };
    },
    async listParts(key, uploadId) {
      if (!(await uploadExists(key, uploadId))) return null;
      const names = (await fs.readdir(partsDir(uploadId))).filter((n) => /^\d{5}$/.test(n)).sort();
      return Promise.all(names.map(async (n) => {
        const bytes = await fs.readFile(path.join(partsDir(uploadId), n));
        return { partNumber: Number(n), etag: crypto.createHash('md5').update(bytes).digest('hex'), size: bytes.length };
      }));
    },
    async completeMultipart(key, uploadId, parts) {
      await assertUpload(key, uploadId);
      const file = target(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      const out = createWriteStream(tmp);
      try {
        for (const p of parts) {
          const part = path.join(partsDir(uploadId), String(p.partNumber).padStart(5, '0'));
          await pipeline(createReadStream(part), out, { end: false });
        }
        await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
        await fs.rename(tmp, file);
      } catch (error) { out.destroy(); await fs.unlink(tmp).catch(() => {}); throw error; }
      await fs.rm(partsDir(uploadId), { recursive: true, force: true });
    },
    async abortMultipart(key, uploadId) {
      if (await uploadExists(key, uploadId)) await fs.rm(partsDir(uploadId), { recursive: true, force: true });
    },
    async copy(fromKey, toKey) {
      const to = target(toKey);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(target(fromKey), to);
    },
    async getToFile(key, file) {
      try { await fs.access(target(key)); } catch { return null; }
      return writeStreamHashed(createReadStream(target(key)), file);
    },
  };
  function partsDir(uploadId) {
    if (!/^[0-9a-f-]{36}$/.test(String(uploadId))) throw new Error('bad upload id');
    return path.join(resolvedRoot, '.multipart', uploadId);
  }
  async function uploadExists(key, uploadId) {
    try { return (await fs.readFile(path.join(partsDir(uploadId), 'key'), 'utf8')) === key; } catch { return false; }
  }
  async function assertUpload(key, uploadId) {
    if (!(await uploadExists(key, uploadId))) throw Object.assign(new Error('no such multipart upload'), { code: 'NoSuchUpload' });
  }
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

/** The SigV4 canonical query string: names and values RFC 3986-encoded, sorted by name (a bare flag is `name=`). */
export function canonicalQuery(query = {}) {
  return Object.keys(query).sort().map((k) => `${encodeSegment(k)}=${encodeSegment(String(query[k] ?? ''))}`).join('&');
}

export function signV4({ method, host, canonicalUri, headers, payloadHash, accessKeyId, secretAccessKey, region = 'auto', service = 's3', now = new Date(), query = '' }) {
  const amzDate = amzDateOf(now);
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaderNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${String(headers[Object.keys(headers).find((h) => h.toLowerCase() === name)]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, canonicalUri, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
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
  const request = async (method, key, body, extraHeaders = {}, query = null) => {
    assertKey(key);
    const canonicalUri = `/${encodeSegment(bucket)}/${key.split('/').map(encodeSegment).join('/')}`;
    const payloadHash = sha256Hex(body ?? '');
    const now = new Date();
    const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDateOf(now), ...extraHeaders };
    const qs = query ? canonicalQuery(query) : '';
    const { authorization } = signV4({ method, host, canonicalUri, headers, payloadHash, accessKeyId, secretAccessKey, now, query: qs });
    return fetchImpl(`https://${host}${canonicalUri}${qs ? `?${qs}` : ''}`, {
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
      // 412: the key exists. 409: it exists and is retention-locked (R2 answers ObjectLockedByBucketPolicy before it
      // looks at the condition). Either way the object stays as it was. Measured on R2, 2026-10-30.
      if (response.status === 412 || response.status === 409) return false;
      if (!response.ok) throw new Error(`R2 PUT ${key} failed: ${response.status} ${await response.text().catch(() => '')}`);
      return true;
    },
    async get(key) {
      const response = await request('GET', key);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`R2 GET ${key} failed: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
    /** Bytes `start`..`end` inclusive, or null when the object is absent. A 200 (the store ignored the range) is sliced. */
    async getRange(key, start, end) {
      const response = await request('GET', key, undefined, { range: `bytes=${start}-${end}` });
      if (response.status === 404) return null;
      if (response.status === 416) return Buffer.alloc(0);
      if (!response.ok) throw new Error(`R2 GET ${key} (range) failed: ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      return response.status === 206 ? bytes : bytes.subarray(start, end + 1);
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

    // ── multipart, for XENO Storage upload sessions (services/storageUploads.js): parts are written by the objects
    // Worker (its R2 binding); this side opens, lists, completes and aborts through the S3 API. Same upload ids.
    async createMultipart(key) {
      const response = await request('POST', key, undefined, { 'content-type': 'application/octet-stream' }, { uploads: '' });
      const text = await response.text();
      if (!response.ok) throw new Error(`R2 create multipart ${key} failed: ${response.status} ${text.slice(0, 200)}`);
      const id = /<UploadId>([^<]+)<\/UploadId>/.exec(text)?.[1];
      if (!id) throw new Error('R2 create multipart returned no UploadId');
      return id;
    },
    async uploadPart(key, uploadId, partNumber, bytes) {
      const response = await request('PUT', key, bytes, {}, { partNumber: String(partNumber), uploadId });
      if (!response.ok) throw new Error(`R2 upload part ${partNumber} failed: ${response.status}`);
      return { partNumber, etag: (response.headers.get('etag') || '').replace(/"/g, '') };
    },
    /** The parts R2 holds for an upload: [{ partNumber, etag, size }], in order. */
    async listParts(key, uploadId) {
      const parts = [];
      let marker = '0';
      for (;;) {
        const response = await request('GET', key, undefined, {}, { uploadId, 'max-parts': '1000', 'part-number-marker': marker });
        const text = await response.text();
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`R2 list parts failed: ${response.status} ${text.slice(0, 200)}`);
        for (const m of text.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
          const field = (name) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(m[1])?.[1];
          parts.push({ partNumber: Number(field('PartNumber')), etag: String(field('ETag') || '').replace(/&quot;|"/g, ''), size: Number(field('Size')) });
        }
        if (!/<IsTruncated>true<\/IsTruncated>/.test(text)) break;
        marker = /<NextPartNumberMarker>(\d+)<\/NextPartNumberMarker>/.exec(text)?.[1] || String(parts.at(-1)?.partNumber || 0);
      }
      return parts.sort((a, b) => a.partNumber - b.partNumber);
    },
    async completeMultipart(key, uploadId, parts) {
      const body = Buffer.from(`<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>"${p.etag}"</ETag></Part>`).join('')}</CompleteMultipartUpload>`);
      const response = await request('POST', key, body, { 'content-type': 'application/xml' }, { uploadId });
      const text = await response.text();
      // S3 can answer 200 with an <Error> body for a complete that failed late
      if (!response.ok || /<Error>/.test(text)) throw new Error(`R2 complete multipart failed: ${response.status} ${text.slice(0, 200)}`);
    },
    async abortMultipart(key, uploadId) {
      const response = await request('DELETE', key, undefined, {}, { uploadId });
      if (!response.ok && response.status !== 404) throw new Error(`R2 abort multipart failed: ${response.status}`);
    },
    /** Server-side copy inside the bucket: no bytes cross this machine's network. */
    async copy(fromKey, toKey) {
      assertKey(fromKey);
      const response = await request('PUT', toKey, undefined, { 'x-amz-copy-source': `/${encodeSegment(bucket)}/${fromKey.split('/').map(encodeSegment).join('/')}` });
      const text = await response.text();
      if (!response.ok || /<Error>/.test(text)) throw new Error(`R2 copy ${fromKey} -> ${toKey} failed: ${response.status} ${text.slice(0, 200)}`);
    },
    /** Stream an object to a file, hashing as it goes: { size, sha256 }, or null when absent. Never held in memory. */
    async getToFile(key, file) {
      const response = await request('GET', key);
      if (response.status === 404) return null;
      if (!response.ok || !response.body) throw new Error(`R2 GET ${key} failed: ${response.status}`);
      return writeStreamHashed(Readable.fromWeb(response.body), file);
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
