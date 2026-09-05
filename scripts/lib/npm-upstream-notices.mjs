import { sha256 } from './npm-package-evidence.mjs';

const repositoryFiles = new Map();
const filenames = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'license.txt', 'License', 'License.md', 'LICENSE-MIT', 'LICENSE-APACHE', 'COPYING', 'COPYING.LESSER', 'NOTICE', 'NOTICE.txt'];
export function githubRepository(repository) {
  let source = typeof repository === 'string' ? repository : repository?.url;
  if (typeof source !== 'string') return undefined;
  source = source.replace(/^git\+/, '').replace(/^github:/, '');
  if (/^[\w.-]+\/[\w.-]+$/.test(source)) source = `https://github.com/${source}`;
  source = source.replace(/^git@github\.com:/, 'https://github.com/');
  try {
    const url = new URL(source);
    if (!['http:', 'https:', 'git:', 'ssh:'].includes(url.protocol) || url.hostname !== 'github.com' ||
        url.port || url.password || (url.username && url.username !== 'git')) return undefined;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2 || (parts.length > 2 && parts[2] !== 'tree')) return undefined;
    const repo = parts[1].replace(/\.git$/, '');
    if (![parts[0], repo].every((part) => /^[\w-][\w.-]*$/.test(part))) return undefined;
    // Only identity is normalized here. Any branch in the URL is discarded;
    // retrieval still requires the version metadata's immutable gitHead below.
    return `${parts[0]}/${repo}`.toLowerCase();
  } catch { return undefined; }
}
async function boundedText(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new Error('Oversized upstream evidence');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Only the published version's gitHead is allowed, never a moving default branch.
// This collects evidence for review; it does not decide licensing applicability.
export async function upstreamNotices(item, manifest, { readText = boundedText, cache = repositoryFiles } = {}) {
  const metadataUrl = `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${encodeURIComponent(manifest.version)}`;
  const metadataText = await readText(metadataUrl);
  if (!metadataText) throw new Error('Published version metadata unavailable');
  const metadata = JSON.parse(metadataText);
  if (metadata.name !== manifest.name || metadata.version !== manifest.version ||
      metadata.dist?.integrity !== item.integrity || metadata.dist?.tarball !== item.resolved) {
    throw new Error('Published metadata does not match locked artifact');
  }
  const repository = githubRepository(manifest.repository);
  if (!repository || repository !== githubRepository(metadata.repository) || !/^[a-f0-9]{40}$/i.test(metadata.gitHead ?? '')) {
    throw new Error('No immutable published GitHub source reference');
  }
  const directory = manifest.repository?.directory ?? '';
  if (directory && !/^[\w./-]+$/.test(directory)) throw new Error('Unsafe package source directory');
  if (directory.split('/').some((part) => part === '..' || part === '.')) throw new Error('Unsafe package source directory');
  const key = `${repository}:${metadata.gitHead}:${directory}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    const paths = [...new Set([directory, ''])].flatMap((base) => filenames.map((name) => base ? `${base}/${name}` : name));
    const files = [];
    for (let offset = 0; offset < paths.length; offset += 4) {
      await Promise.all(paths.slice(offset, offset + 4).map(async (filePath) => {
        const url = `https://raw.githubusercontent.com/${repository}/${metadata.gitHead}/${filePath}`;
        const text = await readText(url);
        if (text?.trim()) files.push({ path: filePath, url, sha256: sha256(text), text });
      }));
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  })());
  const files = await cache.get(key);
  return { files, provenance: { metadataUrl, metadataSha256: sha256(metadataText),
    packageIntegrity: metadata.dist.integrity, repository, gitHead: metadata.gitHead } };
}
