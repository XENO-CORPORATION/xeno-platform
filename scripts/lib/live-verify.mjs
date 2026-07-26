/**
 * live-verify.mjs — after uploading, FETCH WHAT WE JUST PUBLISHED and prove the
 * chain resolves: feed → installer URL → ranged GET returning 206 with a matching size.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every static check in feed-integrity.mjs reasons about local files. None of it
 * proves the objects actually landed on R2 under the keys the feed names, with the
 * bytes we think. On 2026-07-25/26 the failures that reached production were all of
 * that kind: a feed served 200 while the installer it advertised 404'd. A publisher
 * that reports success without resolving its own feed is reporting a guess.
 *
 * This runs unconditionally after a real publish. If the chain does not resolve the
 * publisher exits non-zero and says THE RELEASE IS BROKEN — because a silently-dead
 * auto-update channel cannot be noticed by users; it can only be noticed here.
 *
 * `fetchImpl` is injectable so the tests are hermetic (no network).
 */

/** Resolve a feed ref exactly as electron-updater does: `new URL(ref, feedUrl)`. */
export function resolveRef(feedUrl, ref) {
  return new URL(ref, feedUrl).toString();
}

/**
 * @param {object} o
 * @param {string} o.feedUrl        absolute URL of the feed we just uploaded
 * @param {string} o.expectedVersion
 * @param {{name:string,size:number}[]} o.expectedFiles  keyed by the BARE filename
 * @param {string} [o.expectedBody] the exact bytes we uploaded, for an equality check
 * @param {Function} [o.fetchImpl]
 * @returns {Promise<{ok:boolean, steps:string[], problems:object[]}>}
 */
export async function verifyPublishedChain({
  feedUrl,
  expectedVersion,
  expectedFiles = [],
  expectedBody = null,
  fetchImpl = fetch,
  parseFeed,
}) {
  const problems = [];
  const steps = [];

  // --- 1. the feed itself -------------------------------------------------
  let body;
  try {
    const res = await fetchImpl(feedUrl, { cache: 'no-cache' });
    if (!res.ok) {
      problems.push({
        code: 'LIVE_FEED_UNREACHABLE',
        ref: feedUrl,
        message: `the feed we just uploaded returns HTTP ${res.status}`,
        fix: 'The upload did not land at this key. Check the --updater-url / layout, then re-publish. In-app auto-update is DEAD until this returns 200.',
      });
      return { ok: false, steps, problems };
    }
    body = await res.text();
    steps.push(`feed 200  ${feedUrl}`);
  } catch (e) {
    problems.push({
      code: 'LIVE_FEED_UNREACHABLE',
      ref: feedUrl,
      message: `fetching the feed failed: ${e.message}`,
      fix: 'Confirm the object exists on R2 and updates.xenostudio.ai is serving it.',
    });
    return { ok: false, steps, problems };
  }

  if (expectedBody != null && body.trim() !== expectedBody.trim()) {
    problems.push({
      code: 'LIVE_FEED_CONTENT_DRIFT',
      ref: feedUrl,
      message: 'the feed served from R2 is not byte-identical to what this run uploaded',
      fix: 'Usually a stale CDN copy: confirm the upload set `Cache-Control: no-cache`, then re-check. If it persists, another publish overwrote this key.',
    });
  }

  const feed = parseFeed(body);
  if (feed.version !== expectedVersion) {
    problems.push({
      code: 'LIVE_FEED_VERSION_MISMATCH',
      ref: feedUrl,
      message: `the live feed advertises version ${feed.version}, expected ${expectedVersion}`,
      fix: 'A stale feed is being served. Clients will not see this release.',
    });
  }

  // --- 2. every installer the feed advertises -----------------------------
  const sizeByName = new Map(expectedFiles.map((f) => [f.name, f.size]));
  const seen = new Set();
  for (const ref of feed.refs) {
    if (seen.has(ref.value)) continue;
    seen.add(ref.value);
    const url = resolveRef(feedUrl, ref.value);
    let res;
    try {
      res = await fetchImpl(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-cache' });
    } catch (e) {
      problems.push({
        code: 'LIVE_INSTALLER_UNREACHABLE',
        ref: url,
        message: `ranged GET failed: ${e.message}`,
        fix: 'The feed advertises an installer that cannot be fetched. Auto-update will fail for every client.',
      });
      continue;
    }
    if (res.status === 404) {
      problems.push({
        code: 'LIVE_INSTALLER_404',
        ref: url,
        message: `the feed's "${ref.kind}" resolves to a URL that 404s — this is the classic dead-updater signature`,
        fix: `Either the feed's filename is wrong (compare it with what was uploaded to v${expectedVersion}/) or the installer never uploaded. THE RELEASE IS BROKEN.`,
      });
      continue;
    }
    if (res.status !== 206 && res.status !== 200) {
      problems.push({
        code: 'LIVE_INSTALLER_BAD_STATUS',
        ref: url,
        message: `ranged GET returned HTTP ${res.status} (expected 206)`,
        fix: 'Investigate the object on R2 before announcing this release.',
      });
      continue;
    }

    const contentRange = res.headers?.get?.('content-range') ?? null;
    const total = contentRange ? Number(contentRange.split('/')[1]) : null;
    const bare = ref.value.split('/').pop();
    const expectedSize = sizeByName.get(bare);
    if (res.status === 206 && total != null && expectedSize != null && total !== expectedSize) {
      problems.push({
        code: 'LIVE_SIZE_MISMATCH',
        ref: url,
        message: `the object on R2 is ${total} bytes but this publish uploaded ${expectedSize} bytes for "${bare}"`,
        fix: 'A DIFFERENT build is serving under this key. Installers are immutable — do not overwrite; cut a new version.',
      });
      continue;
    }
    if (res.status === 200) {
      steps.push(`installer 200 (no range support) ${url}`);
    } else {
      steps.push(`installer 206 ${total ?? '?'} bytes  ${url}`);
    }
  }

  return { ok: problems.length === 0, steps, problems };
}

export function formatLiveResult(result) {
  const lines = [];
  for (const s of result.steps) lines.push(`    ✓ ${s}`);
  for (const p of result.problems) {
    lines.push(`    ✖ [${p.code}] ${p.ref}`);
    lines.push(`        ${p.message}`);
    lines.push(`        → ${p.fix}`);
  }
  return lines.join('\n');
}
