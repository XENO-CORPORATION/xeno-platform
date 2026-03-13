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

const browserCopy: Record<BrowserId, { title: string; description: string }> = {
  chrome: {
    title: 'Chrome',
    description: 'Primary Chromium target with full side panel support.',
  },
  edge: {
    title: 'Edge',
    description: 'Chromium-compatible path with separate Add-ons store distribution.',
  },
  safari: {
    title: 'Safari',
    description: 'Requires the Safari wrapper/TestFlight/App Store distribution path.',
  },
};

export default function ExtensionDownloadPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<ReleasePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const browser = useMemo(() => detectBrowser(), []);

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

  return (
    <div className="min-h-screen bg-[#08080a] text-white font-['Inter',sans-serif] overflow-x-hidden antialiased">
      <Header onGetStarted={handleGetStarted} visible={true} />

      <main className="pt-[46px]">
        <section className="px-6 pt-20 pb-10">
          <div className="max-w-[1120px] mx-auto">
            <div className="max-w-[760px]">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] text-[11px] tracking-[0.24em] uppercase text-white/45">
                Xeno Extension
              </div>
              <h1 className="mt-6 text-[42px] md:text-[56px] leading-[0.95] font-semibold tracking-[-0.04em] text-white/92">
                Install the Xeno browser agent without guessing the right build.
              </h1>
              <p className="mt-5 max-w-[680px] text-[16px] leading-7 text-white/55">
                Stable is for normal users. Beta is for opt-in testers. Preview is for internal and experimental builds.
                This page reads the latest extension releases directly from the Xeno extension repository.
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {(Object.keys(browserCopy) as BrowserId[]).map((browserId) => {
                const browserInfo = browserCopy[browserId];
                const stableLink = data?.browserInstall?.[browserId]?.stable || data?.channels?.stable?.primaryAsset?.url || null;
                const betaLink = data?.browserInstall?.[browserId]?.beta || data?.channels?.beta?.primaryAsset?.url || null;
                const isDetected = browser === browserId;

                return (
                  <div
                    key={browserId}
                    className={`rounded-2xl border px-5 py-5 bg-white/[0.02] ${isDetected ? 'border-white/[0.16]' : 'border-white/[0.06]'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-[20px] font-semibold text-white/88">{browserInfo.title}</h2>
                        <p className="mt-2 text-[13px] leading-6 text-white/42">{browserInfo.description}</p>
                      </div>
                      {isDetected ? (
                        <span className="shrink-0 rounded-full border border-white/[0.12] px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-white/55">
                          Detected
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      {stableLink ? (
                        <a
                          href={stableLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-xl bg-white text-[#08080a] px-4 py-2.5 text-[13px] font-medium"
                        >
                          Install Stable
                          <ArrowRight className="w-4 h-4" />
                        </a>
                      ) : (
                        <span className="inline-flex items-center rounded-xl border border-white/[0.08] px-4 py-2.5 text-[13px] text-white/40">
                          Store link coming soon
                        </span>
                      )}

                      {betaLink ? (
                        <a
                          href={betaLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] px-4 py-2.5 text-[13px] text-white/72"
                        >
                          Beta
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
          <div className="max-w-[1120px] mx-auto grid gap-4 lg:grid-cols-3">
            {(Object.keys(channelCopy) as ChannelId[]).map((channel) => {
              const release = data?.channels?.[channel] || null;
              const installLink = data?.browserInstall?.[browser]?.[channel] || release?.primaryAsset?.url || null;
              const installLabel = data?.browserInstall?.[browser]?.[channel]
                ? `Install on ${browserCopy[browser].title}`
                : release?.primaryAsset
                  ? 'Download ZIP package'
                  : 'Release pending';

              return (
                <div key={channel} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.24em] text-white/38">{channelCopy[channel].title}</p>
                      <h3 className="mt-2 text-[26px] font-semibold text-white/92">
                        {release?.version || 'Not published'}
                      </h3>
                    </div>
                    <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-white/45">
                      {channel}
                    </span>
                  </div>

                  <p className="mt-4 text-[14px] leading-7 text-white/48">{channelCopy[channel].description}</p>

                  <div className="mt-4 rounded-xl border border-white/[0.05] bg-black/20 px-4 py-3">
                    <div className="flex items-center justify-between gap-3 text-[12px] text-white/42">
                      <span>Published</span>
                      <span>{formatDate(release?.publishedAt)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-white/42">
                      <span>Package</span>
                      <span>{release?.primaryAsset ? formatSize(release.primaryAsset.size) : 'Unavailable'}</span>
                    </div>
                    <p className="mt-3 text-[13px] leading-6 text-white/50">
                      {release?.notesSummary || 'This channel does not have a published GitHub release yet.'}
                    </p>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    {installLink ? (
                      <a
                        href={installLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl bg-white text-[#08080a] px-4 py-2.5 text-[13px] font-medium"
                      >
                        <Download className="w-4 h-4" />
                        {installLabel}
                      </a>
                    ) : (
                      <span className="inline-flex items-center rounded-xl border border-white/[0.08] px-4 py-2.5 text-[13px] text-white/40">
                        Release pending
                      </span>
                    )}

                    {release?.htmlUrl ? (
                      <a
                        href={release.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] px-4 py-2.5 text-[13px] text-white/72"
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
        </section>

        <section className="px-6 pb-10">
          <div className="max-w-[1120px] mx-auto rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-white/38">Recent releases</p>
                <h2 className="mt-2 text-[28px] font-semibold text-white/92">Track what actually shipped</h2>
              </div>
              <p className="text-[12px] text-white/35">
                Source: GitHub releases for {data?.repo || 'XENO-CORPORATION/xeno-extension'}
              </p>
            </div>

            <div className="mt-6 space-y-3">
              {loading ? (
                <div className="rounded-xl border border-white/[0.06] px-4 py-4 text-[13px] text-white/45">
                  Loading extension releases...
                </div>
              ) : error ? (
                <div className="rounded-xl border border-[#5a2020] bg-[#241212] px-4 py-4 text-[13px] text-[#ffb6b6]">
                  {error}
                </div>
              ) : (
                data?.recentReleases.map((release) => (
                  <div
                    key={`${release.channel}-${release.tag}`}
                    className="rounded-xl border border-white/[0.06] bg-black/20 px-4 py-4"
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
                            className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-white/72"
                          >
                            Download
                            <Download className="w-4 h-4" />
                          </a>
                        ) : null}
                        <a
                          href={release.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-white/72"
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
          <div className="max-w-[1120px] mx-auto grid gap-4 md:grid-cols-3">
            {[
              'Install Stable from the browser store once those URLs are configured. Use direct ZIP downloads only for manual testing.',
              'Beta should be the default internal and trusted-tester channel. Preview should stay reserved for risky or incomplete behavior.',
              'If you need a custom API key, add it from the extension settings. If not, the extension can still use the configured fallback key.',
            ].map((line) => (
              <div key={line} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
                <p className="text-[14px] leading-7 text-white/50">{line}</p>
              </div>
            ))}
          </div>

          <div className="max-w-[1120px] mx-auto mt-8">
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
