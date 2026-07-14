import fetch from 'node-fetch';

/**
 * Extension release data for the download page.
 *
 * Source: the PUBLIC R2 feed at updates.xenostudio.ai/apps/extension/releases.json,
 * published by `scripts/publish-extension-releases.mjs` (which mirrors the private
 * xeno-extension release assets to R2 using local `gh` auth). The backend therefore
 * needs NO GitHub credential — it previously hit the GitHub API with a stored
 * GITHUB_TOKEN, whose `browser_download_url`s did not even work for anonymous users
 * because the repo is private. The R2 mirror fixes both (no token; downloads work).
 *
 * The feed already contains the mapped shape ExtensionDownload.tsx consumes
 * (channels{stable,beta,preview} + recentReleases, each release with R2 asset URLs).
 * We only overlay the web-store install links (env-driven) at read time.
 */

const FEED_URL = process.env.EXTENSION_RELEASES_FEED_URL
  || 'https://updates.xenostudio.ai/apps/extension/releases.json';
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = {
  expiresAt: 0,
  data: null,
};

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

export async function getExtensionReleaseData(forceRefresh = false) {
  if (!forceRefresh && cache.data && cache.expiresAt > Date.now()) {
    return cache.data;
  }

  const response = await fetch(FEED_URL, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Extension release feed fetch failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const feed = await response.json();

  const data = {
    repo: feed.repo || null,
    generatedAt: feed.generatedAt || new Date().toISOString(),
    browserInstall: storeLinks(),
    channels: feed.channels || { stable: null, beta: null, preview: null },
    recentReleases: Array.isArray(feed.recentReleases) ? feed.recentReleases : [],
  };

  cache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    data,
  };

  return data;
}
