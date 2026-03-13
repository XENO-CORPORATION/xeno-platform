import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Download, ExternalLink } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../components/landing/Header';
import Footer from '../components/landing/Footer';

type BrowserId = 'chrome' | 'edge' | 'safari';
type ChannelId = 'stable' | 'beta' | 'preview';

interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  downloadCount: number;
  updatedAt: string;
  url: string;
}

interface ChannelRelease {
  id: number;
  channel: ChannelId;
  tag: string;
  name: string;
  version: string;
  prerelease: boolean;
  publishedAt: string;
  htmlUrl: string;
  notes: string;
  notesSummary: string;
  assets: ReleaseAsset[];
  primaryAsset: ReleaseAsset | null;
}

interface ReleasePayload {
  repo: string;
  generatedAt: string;
  browserInstall: Record<BrowserId, Record<ChannelId, string | null>>;
  channels: Record<ChannelId, ChannelRelease | null>;
  recentReleases: ChannelRelease[];
}

function detectBrowser(): BrowserId {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('safari') && !ua.includes('chrome') && !ua.includes('crios')) return 'safari';
  return 'chrome';
}

function formatDate(value?: string) {
  if (!value) return 'Unavailable';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatSize(bytes = 0) {
  if (!bytes) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

const channelCopy: Record<ChannelId, { title: string; description: string }> = {
  stable: {
    title: 'Stable',
    description: 'Public release track for real users. Use this for production installs and the least risky updates.',
  },
  beta: {
    title: 'Beta',
    description: 'Opt-in testing track. Near-production builds with newer logic before they are promoted to Stable.',
  },
  preview: {
    title: 'Preview',
    description: 'Internal and experimental builds. Use this when you want the newest behavior and accept breakage.',
  },
};

const browserCopy: Record<BrowserId, { title: string; description: string; system: string }> = {
  chrome: {
    title: 'Chrome',
    description: 'Primary Chromium target with full side panel support.',
    system: 'Chrome Web Store or manual Chromium package',
  },
  edge: {
    title: 'Edge',
    description: 'Chromium-compatible path with separate Add-ons store distribution.',
    system: 'Edge Add-ons or manual Chromium package',
  },
  safari: {
    title: 'Safari',
    description: 'Requires the Safari wrapper/TestFlight/App Store distribution path.',
    system: 'App Store / TestFlight once published',
  },
};

export default function ExtensionDownloadPage() {
  const navigate = useNavigate();
  const detectedBrowser = useMemo(() => detectBrowser(), []);
  const [selectedBrowser, setSelectedBrowser] = useState<BrowserId>(detectedBrowser);
  const [data, setData] = useState<ReleasePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/download/extension/releases')
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Failed to load extension releases');
        }
        return payload.data as ReleasePayload;
      })
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load extension releases');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleGetStarted = () => navigate('/auth');
  const activeBrowser = browserCopy[selectedBrowser];
  const currentStable = data?.channels?.stable || null;

  return (
    <div className="min-h-screen bg-[#08080a] text-white font-['Inter',sans-serif] overflow-x-hidden antialiased">
      <Header onGetStarted={handleGetStarted} visible={true} />

      <main className="pt-[46px]">
        <section className="flex items-center justify-center min-h-[calc(100vh-46px)] px-6">
          <div className="w-full max-w-[1100px] mx-auto">
            <div
              className="relative border border-white/[0.06] rounded-md overflow-hidden bg-[#0b0b0d]"
              style={{ aspectRatio: '2.35/1' }}
            >
              <div className="absolute inset-0 flex flex-col justify-center px-8 md:px-10">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] text-[11px] tracking-[0.24em] uppercase text-white/45">
                    Xeno Extension
                  </span>
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/[0.06] text-[11px] uppercase tracking-[0.22em] text-white/32">
                    Detected {browserCopy[detectedBrowser].title}
                  </span>
                </div>

                <div className="mt-6 max-w-[760px]">
                  <h1 className="text-[24px] md:text-[34px] font-semibold tracking-tight text-white/90 leading-tight">
                    Download the Xeno browser agent for {activeBrowser.title}
                  </h1>
                  <p className="mt-4 max-w-[640px] text-[14px] md:text-[15px] leading-7 text-white/48">
                    Stable is for production installs, Beta is for opt-in testers, and Preview is for internal experiments.
                    This page reads directly from the Xeno extension release pipeline so the website stays in sync with the repo.
                  </p>
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  {(Object.keys(browserCopy) as BrowserId[]).map((browserId) => (
                    <button
                      key={browserId}
                      onClick={() => setSelectedBrowser(browserId)}
                      className={`group flex items-center gap-2.5 px-5 py-3 border rounded-md text-[13px] font-medium transition-all duration-300 ${
                        browserId === selectedBrowser
                          ? 'border-white/[0.18] bg-white/[0.06] text-white'
                          : 'border-white/[0.08] text-white/45 hover:text-white hover:bg-white/[0.04] hover:border-white/[0.18]'
                      }`}
                    >
                      {browserCopy[browserId].title}
                      {browserId === detectedBrowser ? (
                        <span className="text-[10px] uppercase tracking-[0.22em] text-white/35 group-hover:text-white/55">
                          Current
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>

                <div className="mt-8 grid gap-3 md:grid-cols-3 max-w-[920px]">
                  {(Object.keys(channelCopy) as ChannelId[]).map((channel) => {
                    const release = data?.channels?.[channel] || null;
                    const installUrl = data?.browserInstall?.[selectedBrowser]?.[channel] || release?.primaryAsset?.url || null;
                    const installKind = data?.browserInstall?.[selectedBrowser]?.[channel]
                      ? activeBrowser.system
                      : release?.primaryAsset
                        ? 'Manual ZIP package'
                        : 'Not published yet';

                    return (
                      <div key={channel} className="rounded-md border border-white/[0.08] bg-white/[0.02] px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] uppercase tracking-[0.24em] text-white/38">
                            {channelCopy[channel].title}
                          </span>
                          <span className="text-[11px] text-white/28">{release?.version || 'Pending'}</span>
                        </div>

                        <p className="mt-3 text-[12px] leading-6 text-white/42 min-h-[72px]">
                          {channelCopy[channel].description}
                        </p>

                        <p className="mt-2 text-[11px] text-white/24">
                          {installKind}
                        </p>

                        <div className="mt-4 flex flex-wrap gap-2">
                          {installUrl ? (
                            <a
                              href={installUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-[#08080a] text-[12px] font-semibold rounded-md hover:bg-white/85 transition-all duration-300"
                            >
                              <Download className="w-4 h-4" />
                              {data?.browserInstall?.[selectedBrowser]?.[channel] ? 'Install' : 'Download'}
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-2 px-4 py-2.5 border border-white/[0.08] text-[12px] text-white/25 rounded-md">
                              Pending
                            </span>
                          )}

                          {release?.htmlUrl ? (
                            <a
                              href={release.htmlUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 px-4 py-2.5 border border-white/[0.08] text-[12px] text-white/60 rounded-md hover:text-white hover:border-white/[0.16] transition-colors duration-300"
                            >
                              Notes
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-3 px-0.5">
              <p className="text-[11px] text-white/15">
                {currentStable ? `Latest Stable: v${currentStable.version}` : 'Waiting for first Stable release'}
              </p>
              <button
                onClick={() => document.getElementById('release-tracks')?.scrollIntoView({ behavior: 'smooth' })}
                className="text-[11px] text-white/20 hover:text-white/40 transition-colors duration-300"
              >
                View release tracks &darr;
              </button>
            </div>
          </div>
        </section>

        <section id="release-tracks" className="px-6 py-20 border-t border-white/[0.05]">
          <div className="max-w-[1100px] mx-auto">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-[13px] font-semibold text-white/30 tracking-widest uppercase">
                  Release Tracks
                </h2>
                <p className="mt-3 max-w-[760px] text-[14px] leading-7 text-white/46">
                  The browser cards above are for quick install. The release tracks below are the audit surface: what shipped,
                  when it shipped, how large the package is, and whether the selected browser has a direct store path yet.
                </p>
              </div>
              <p className="text-[11px] text-white/25">
                Source: {data?.repo || 'XENO-CORPORATION/xeno-extension'}
              </p>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {(Object.keys(channelCopy) as ChannelId[]).map((channel) => {
                const release = data?.channels?.[channel] || null;
                const installUrl = data?.browserInstall?.[selectedBrowser]?.[channel] || release?.primaryAsset?.url || null;
                const hasStoreInstall = !!data?.browserInstall?.[selectedBrowser]?.[channel];

                return (
                  <div key={channel} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.24em] text-white/38">
                          {channelCopy[channel].title}
                        </p>
                        <h3 className="mt-2 text-[26px] font-semibold text-white/92">
                          {release?.version || 'Not published'}
                        </h3>
                      </div>
                      <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-white/45">
                        {selectedBrowser}
                      </span>
                    </div>

                    <p className="mt-4 text-[14px] leading-7 text-white/48">
                      {channelCopy[channel].description}
                    </p>

                    <div className="mt-4 rounded-md border border-white/[0.05] bg-black/20 px-4 py-3">
                      <div className="flex items-center justify-between gap-3 text-[12px] text-white/42">
                        <span>Published</span>
                        <span>{formatDate(release?.publishedAt)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-white/42">
                        <span>Package</span>
                        <span>{release?.primaryAsset ? formatSize(release.primaryAsset.size) : 'Unavailable'}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-white/42">
                        <span>Install path</span>
                        <span>{hasStoreInstall ? activeBrowser.system : release?.primaryAsset ? 'Manual ZIP package' : 'Unavailable'}</span>
                      </div>
                      <p className="mt-3 text-[13px] leading-6 text-white/50">
                        {release?.notesSummary || 'This channel does not have a published GitHub release yet.'}
                      </p>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      {installUrl ? (
                        <a
                          href={installUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-md bg-white text-[#08080a] px-4 py-2.5 text-[13px] font-medium"
                        >
                          <Download className="w-4 h-4" />
                          {hasStoreInstall ? `Install for ${activeBrowser.title}` : 'Download ZIP package'}
                        </a>
                      ) : (
                        <span className="inline-flex items-center rounded-md border border-white/[0.08] px-4 py-2.5 text-[13px] text-white/40">
                          Release pending
                        </span>
                      )}

                      {release?.htmlUrl ? (
                        <a
                          href={release.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] px-4 py-2.5 text-[13px] text-white/72"
                        >
                          Release notes
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="px-6 pb-10">
          <div className="max-w-[1100px] mx-auto rounded-md border border-white/[0.06] bg-white/[0.02] p-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-white/38">Recent releases</p>
                <h2 className="mt-2 text-[28px] font-semibold text-white/92">Track what actually shipped</h2>
              </div>
              <p className="text-[12px] text-white/35">
                Generated {formatDate(data?.generatedAt)}
              </p>
            </div>

            <div className="mt-6 space-y-3">
              {loading ? (
                <div className="rounded-md border border-white/[0.06] px-4 py-4 text-[13px] text-white/45">
                  Loading extension releases...
                </div>
              ) : error ? (
                <div className="rounded-md border border-[#5a2020] bg-[#241212] px-4 py-4 text-[13px] text-[#ffb6b6]">
                  {error}
                </div>
              ) : (
                data?.recentReleases.map((release) => (
                  <div
                    key={`${release.channel}-${release.tag}`}
                    className="rounded-md border border-white/[0.06] bg-black/20 px-4 py-4"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[16px] font-medium text-white/88">{release.name}</span>
                          <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-white/42">
                            {release.channel}
                          </span>
                        </div>
                        <p className="mt-2 text-[13px] leading-6 text-white/45">
                          {release.notesSummary || 'No release notes provided.'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/42">
                        <span>{formatDate(release.publishedAt)}</span>
                        {release.primaryAsset ? <span>{formatSize(release.primaryAsset.size)}</span> : null}
                        {release.primaryAsset ? (
                          <a
                            href={release.primaryAsset.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] px-3 py-2 text-white/72"
                          >
                            Download
                            <Download className="w-4 h-4" />
                          </a>
                        ) : null}
                        <a
                          href={release.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] px-3 py-2 text-white/72"
                        >
                          GitHub
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="px-6 pb-20">
          <div className="max-w-[1100px] mx-auto grid gap-4 md:grid-cols-3">
            {[
              'Chrome and Edge can use store installs once those URLs are configured. Until then, the page falls back to the latest ZIP package from GitHub Releases.',
              'Safari should prefer App Store or TestFlight distribution. Manual ZIP artifacts are useful for release bookkeeping, not as the normal Safari install path.',
              'If you need a custom API key, add it in the extension settings. If you do nothing, the extension can still use the configured fallback key for its channel.',
            ].map((line) => (
              <div key={line} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-5">
                <p className="text-[14px] leading-7 text-white/50">{line}</p>
              </div>
            ))}
          </div>

          <div className="max-w-[1100px] mx-auto mt-8">
            <Link
              to="/download"
              className="inline-flex items-center gap-2 text-[13px] text-white/35 hover:text-white/70 transition-colors duration-200"
            >
              Back to the main download page
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
