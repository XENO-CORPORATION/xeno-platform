import { createHash, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { copyrightLicenseHeaders } from './package-license-headers.mjs';

// Use the backend's declared dependency; never extract registry archives to disk.
const require = createRequire(new URL('../../src/server/package.json', import.meta.url));
const { extract } = require('tar-stream');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function declaredManifestLicense(manifest) {
  let value = typeof manifest.license === 'string' ? manifest.license : manifest.license?.type;
  if (!value && Array.isArray(manifest.licenses) && manifest.licenses.length === 1) {
    const [entry] = manifest.licenses;
    value = typeof entry === 'string' ? entry : entry?.type;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function verifyIntegrity(bytes, integrity) {
  const matches = String(integrity ?? '').split(/\s+/).map((part) => /^(sha512|sha384|sha256)-([A-Za-z0-9+/=]+)$/.exec(part)).filter(Boolean);
  if (!matches.length) throw new Error('Missing supported package integrity');
  // The strongest declared algorithm is authoritative.
  const rank = { sha512: 3, sha384: 2, sha256: 1 };
  matches.sort((a, b) => rank[b[1]] - rank[a[1]]);
  const strongest = matches[0][1];
  const actual = createHash(strongest).update(bytes).digest();
  if (!matches.filter((match) => match[1] === strongest).some((match) => {
    const expected = Buffer.from(match[2], 'base64');
    return expected.length === actual.length && timingSafeEqual(actual, expected);
  })) throw new Error('Registry archive integrity mismatch');
}

export async function readPackageArchive(bytes, { includeLicenseHeaders = false } = {}) {
  const unpacked = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 });
  const parser = extract();
  const files = [];
  const licenseHeaders = [];
  await new Promise((resolve, reject) => {
    parser.on('error', reject);
    parser.on('finish', resolve);
    parser.on('entry', (header, stream, next) => {
      const name = header.name.replaceAll('\\', '/');
      const parts = name.split('/');
      const basename = parts.at(-1);
      // Notices can be nested under dist/ or a vendored component. Keep all
      // named license texts, but only the package-root manifest/README: nested
      // package.json files must never replace the artifact's identity.
      const safePath = parts.length >= 2 && parts.every((part) => part && part !== '..' && part !== '.') && !name.includes(':');
      const selected = header.type === 'file' && safePath &&
        (/^(?:licen[cs]e|copying|notice|copyright)(?:[._-].*)?$/i.test(basename) ||
          (parts.length === 2 && /^(?:package\.json|readme(?:\.[^/]+)?)$/i.test(basename)));
      const sourceSelected = includeLicenseHeaders && header.type === 'file' && safePath && /\.(?:[cm]?js|ts)$/.test(basename);
      if (sourceSelected && header.size > 16 * 1024 * 1024) {
        parser.destroy(new Error(`Oversized source header input: ${name}`));
        return;
      }
      if (selected && header.size > 4 * 1024 * 1024) {
        parser.destroy(new Error(`Oversized package evidence: ${name}`));
        return;
      }
      const chunks = [];
      stream.on('data', (chunk) => { if (selected || sourceSelected) chunks.push(chunk); });
      stream.on('error', reject);
      stream.on('end', () => {
        if (sourceSelected) {
          try {
            const body = Buffer.concat(chunks);
            const sourceSha256 = sha256(body);
            for (const [index, text] of copyrightLicenseHeaders(body.toString('utf8')).entries()) {
              licenseHeaders.push({ path: `${name}#license-header-${index + 1}`, sourcePath: name, sourceSha256,
                sha256: sha256(text), text });
            }
          } catch (error) { parser.destroy(error); return; }
        }
        if (selected) {
          const body = Buffer.concat(chunks);
          files.push({ path: name, sha256: sha256(body), text: body.toString('utf8') });
        }
        next();
      });
      stream.resume();
    });
    parser.end(unpacked);
  });
  const manifests = files.filter((file) => file.path.endsWith('/package.json'));
  if (manifests.length !== 1) throw new Error('Expected one package-root manifest');
  return { manifest: JSON.parse(manifests[0].text), files, licenseHeaders };
}

export async function lockedPackageEvidence(item, expectedName, cacheDirectory, options) {
  const url = new URL(item.resolved);
  if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password) {
    throw new Error(`Unapproved registry origin for ${expectedName}`);
  }
  await mkdir(cacheDirectory, { recursive: true });
  const cachePath = path.join(cacheDirectory, `${sha256(item.integrity ?? '')}.tgz`);
  let bytes;
  try { bytes = await readFile(cachePath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`${expectedName}: registry HTTP ${response.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 64 * 1024 * 1024) throw new Error(`${expectedName}: oversized archive`);
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
    verifyIntegrity(bytes, item.integrity);
    await writeFile(cachePath, bytes);
  }
  verifyIntegrity(bytes, item.integrity);
  const evidence = await readPackageArchive(bytes, options);
  if (evidence.manifest.name !== expectedName || evidence.manifest.version !== item.version) {
    throw new Error(`${expectedName}: package identity does not match lockfile`);
  }
  return evidence;
}
