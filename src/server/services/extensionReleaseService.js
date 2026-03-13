import fetch from 'node-fetch';

const DEFAULT_REPO = process.env.EXTENSION_RELEASES_REPO || 'XENO-CORPORATION/xeno-extension';
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = {
  expiresAt: 0,
  data: null,
};

function githubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'XenoPlatformExtensionDownloads/1.0',
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

function classifyChannel(release) {
  const haystack = `${release.tag_name || ''} ${release.name || ''}`.toLowerCase();
  if (haystack.includes('preview')) return 'preview';
  if (haystack.includes('beta')) return 'beta';
  return release.prerelease ? 'beta' : 'stable';
}

function extractVersion(release) {
  const haystack = `${release.name || ''} ${release.tag_name || ''}`;
  const match = haystack.match(/\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)*/);
  return match ? match[0] : release.tag_name;
}

function summarizeNotes(body = '') {
  return body
    .replace(/`/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, 320);
}

function mapAsset(asset) {
  return {
    id: asset.id,
    name: asset.name,
    size: asset.size,
    downloadCount: asset.download_count,
    updatedAt: asset.updated_at,
    url: asset.browser_download_url,
  };
}

function storeLinks() {
  return {
    chrome: {
      stable: process.env.EXTENSION_CHROME_STABLE_URL || null,
      beta: process.env.EXTENSION_CHROME_BETA_URL || null,
      preview: process.env.EXTENSION_CHROME_PREVIEW_URL || null,
    },
    edge: {
      stable: process.env.EXTENSION_EDGE_STABLE_URL || null,
      beta: process.env.EXTENSION_EDGE_BETA_URL || null,
      preview: process.env.EXTENSION_EDGE_PREVIEW_URL || null,
    },
    safari: {
      stable: process.env.EXTENSION_SAFARI_STABLE_URL || null,
      beta: process.env.EXTENSION_SAFARI_BETA_URL || null,
      preview: process.env.EXTENSION_SAFARI_PREVIEW_URL || null,
    },
  };
}

function mapRelease(release) {
  const channel = classifyChannel(release);
  const assets = (release.assets || [])
    .filter((asset) => asset.name.endsWith('.zip') || asset.name.endsWith('.json'))
    .map(mapAsset);
  const primaryAsset = assets.find((asset) => asset.name.endsWith('.zip')) || null;

  return {
    id: release.id,
    channel,
    tag: release.tag_name,
    name: release.name,
    version: extractVersion(release),
    prerelease: release.prerelease,
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
    notes: release.body || '',
    notesSummary: summarizeNotes(release.body || ''),
    assets,
    primaryAsset,
  };
}

export async function getExtensionReleaseData(forceRefresh = false) {
  if (!forceRefresh && cache.data && cache.expiresAt > Date.now()) {
    return cache.data;
  }

  const repo = process.env.EXTENSION_RELEASES_REPO || DEFAULT_REPO;
  const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=20`, {
    headers: githubHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub releases fetch failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const releases = await response.json();
  const mapped = releases
    .filter((release) => !release.draft)
    .map(mapRelease)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  const data = {
    repo,
    generatedAt: new Date().toISOString(),
    browserInstall: storeLinks(),
    channels: {
      stable: mapped.find((release) => release.channel === 'stable') || null,
      beta: mapped.find((release) => release.channel === 'beta') || null,
      preview: mapped.find((release) => release.channel === 'preview') || null,
    },
    recentReleases: mapped.slice(0, 12),
  };

  cache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    data,
  };

  return data;
}
