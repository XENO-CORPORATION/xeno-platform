import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FlaskConical,
  Package,
  ShieldCheck,
} from 'lucide-react';
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

const channelCopy: Record<
  ChannelId,
  {
    title: string;
    eyebrow: string;
    description: string;
    button: string;
    icon: typeof ShieldCheck;
  }
> = {
  stable: {
    title: 'Stable',
    eyebrow: 'Production',
    description: 'Default install track for customer-facing use, documentation, and the cleanest support path.',
    button: 'Install Stable',
    icon: ShieldCheck,
  },
  beta: {
    title: 'Beta',
    eyebrow: 'Opt-in',
    description: 'For testers who want faster updates before changes are promoted into the production track.',
    button: 'Install Beta',
    icon: CheckCircle2,
  },
  preview: {
    title: 'Preview',
    eyebrow: 'Internal',
    description: 'For experiments, newest agent logic, and internal validation before anything graduates further.',
    button: 'Get Preview',
    icon: FlaskConical,
  },
};

const browserCopy: Record<
  BrowserId,
  {
    title: string;
    description: string;
    system: string;
    badge: string;
  }
> = {
  chrome: {
    title: 'Chrome',
    description: 'Best default for the full extension runtime and side panel workflow.',
    system: 'Chrome Web Store or Chromium package',
    badge: 'Chromium',
  },
  edge: {
    title: 'Edge',
    description: 'Same Chromium package with a cleaner Microsoft Edge install path.',
    system: 'Edge Add-ons or Chromium package',
    badge: 'Recommended',
  },
  safari: {
    title: 'Safari',
    description: 'Wrapper-app path for Apple devices and TestFlight or App Store rollout.',
    system: 'App Store or TestFlight',
    badge: 'Wrapper',
  },
};

function getInstallTarget(data: ReleasePayload | null, browser: BrowserId, channel: ChannelId) {
  const release = data?.channels?.[channel] || null;
  const storeUrl = data?.browserInstall?.[browser]?.[channel] || null;
  const releaseUrl = release?.primaryAsset?.url || null;
  const url = storeUrl || releaseUrl || null;
  const pathLabel = storeUrl ? browserCopy[browser].system : releaseUrl ? 'GitHub release package' : 'Pending';
  return { release, storeUrl, releaseUrl, url, pathLabel };
}

function BrowserButton({
  browserId,
  active,
  detected,
  onClick,
}: {
  browserId: BrowserId;
  active: boolean;
  detected: boolean;
  onClick: () => void;
}) {
  const browser = browserCopy[browserId];

  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-4 py-4 text-left transition-colors duration-200 ${
        active
          ? 'border-white/20 bg-white/[0.06]'
          : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">{browser.badge}</p>
          <p className="mt-1 text-[17px] font-medium text-white/92">{browser.title}</p>
        </div>
        {detected ? (
          <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-white/48">
            Detected
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-[13px] leading-6 text-white/48">{browser.description}</p>
    </button>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-white/[0.06] py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span className="text-[12px] uppercase tracking-[0.14em] text-white/36">{label}</span>
      <span className="text-right text-[13px] text-white/72">{value}</span>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md border border-white/[0.08] bg-white/[0.03] p-2 text-white/62">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">{label}</p>
          <p className="mt-1 text-[14px] font-medium text-white/86">{value}</p>
        </div>
      </div>
    </div>
  );
}

function TrackRailCard({
  browser,
  channel,
  target,
  loading,
}: {
  browser: BrowserId;
  channel: ChannelId;
  target: ReturnType<typeof getInstallTarget>;
  loading: boolean;
}) {
  const meta = channelCopy[channel];
  const Icon = meta.icon;

  return (
    <article className="rounded-md border border-white/[0.08] bg-[#0b0c0f] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">{meta.eyebrow}</p>
          <h3 className="mt-1 text-[22px] font-semibold text-white/92">{meta.title}</h3>
        </div>
        <div className="rounded-md border border-white/[0.08] bg-white/[0.03] p-2 text-white/60">
          <Icon className="h-4 w-4" />
        </div>
      </div>

      <p className="mt-4 text-[13px] leading-6 text-white/48">{meta.description}</p>

      <div className="mt-5 rounded-md border border-white/[0.08] bg-white/[0.02] p-4">
        <DetailRow label="Browser" value={browserCopy[browser].title} />
        <DetailRow label="Version" value={loading ? 'Loading...' : target.release?.version || 'Pending'} />
        <DetailRow label="Published" value={loading ? '...' : formatDate(target.release?.publishedAt)} />
        <DetailRow label="Path" value={loading ? '...' : target.pathLabel} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {target.url ? (
          <a
            href={target.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2.5 text-[12px] font-semibold text-[#08080a] transition-opacity duration-200 hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            {meta.button}
          </a>
        ) : (
          <span className="inline-flex items-center rounded-md border border-white/[0.08] px-4 py-2.5 text-[12px] text-white/34">
            Release pending
          </span>
        )}

        {target.release?.htmlUrl ? (
          <a
            href={target.release.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] px-4 py-2.5 text-[12px] text-white/68 transition-colors duration-200 hover:border-white/[0.16] hover:text-white"
          >
            Notes
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : null}
      </div>
    </article>
  );
}

function SupportCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-white/[0.08] bg-white/[0.02] p-5">
      <p className="text-[14px] font-medium text-white/86">{title}</p>
      <p className="mt-2 text-[13px] leading-6 text-white/48">{body}</p>
    </div>
  );
}

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
  const stableTarget = getInstallTarget(data, selectedBrowser, 'stable');
  const stableRelease = data?.channels?.stable || null;

  return (
    <div className="min-h-screen bg-[#08080a] font-['Inter',sans-serif] text-white antialiased">
      <Header onGetStarted={handleGetStarted} visible={true} />
      <main className="pt-[46px]">
        <section className="px-6 py-14 md:py-18">
          <div className="mx-auto max-w-[1260px] space-y-5">
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-white/40">
                Browser agent
              </span>
              <span className="rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-white/34">
                Release pipeline synced
              </span>
            </div>

            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 space-y-5">
                <div className="overflow-hidden rounded-md border border-white/[0.08] bg-[#0b0c0f]">
                  <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_340px] xl:aspect-[16/9]">
                    <div className="flex min-w-0 flex-col justify-between gap-8 p-6 md:p-8 lg:p-10">
                      <div className="space-y-6">
                        <div className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-white/40">
                          Detected {browserCopy[detectedBrowser].title}
                        </div>

                        <div className="max-w-[760px] space-y-4">
                          <h1 className="text-[32px] font-semibold tracking-[-0.03em] text-white/94 md:text-[42px] md:leading-[1.04] xl:text-[46px]">
                            Download the Xeno browser agent for {browserCopy[selectedBrowser].title}
                          </h1>

                          <p className="max-w-[700px] text-[14px] leading-7 text-white/54 md:text-[15px]">
                            Stable is for production installs, Beta is for opt-in testers, and Preview is for internal
                            experiments. This page reads directly from the Xeno extension release pipeline so the website
                            stays in sync with the repo.
                          </p>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          {(Object.keys(browserCopy) as BrowserId[]).map((browserId) => (
                            <BrowserButton
                              key={browserId}
                              browserId={browserId}
                              active={browserId === selectedBrowser}
                              detected={browserId === detectedBrowser}
                              onClick={() => setSelectedBrowser(browserId)}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-3">
                          {stableTarget.url ? (
                            <a
                              href={stableTarget.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-md bg-white px-5 py-3 text-[13px] font-semibold text-[#08080a] transition-opacity duration-200 hover:opacity-90"
                            >
                              <Download className="h-4 w-4" />
                              {stableTarget.storeUrl ? 'Install Stable' : 'Download Stable'}
                            </a>
                          ) : (
                            <span className="inline-flex items-center rounded-md border border-white/[0.08] px-5 py-3 text-[13px] text-white/34">
                              Stable release pending
                            </span>
                          )}

                          {stableRelease?.htmlUrl ? (
                            <a
                              href={stableRelease.htmlUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] px-5 py-3 text-[13px] text-white/68 transition-colors duration-200 hover:border-white/[0.16] hover:text-white"
                            >
                              View release notes
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : null}

                          <button
                            onClick={() => document.getElementById('extension-release-history')?.scrollIntoView({ behavior: 'smooth' })}
                            className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] px-5 py-3 text-[13px] text-white/52 transition-colors duration-200 hover:border-white/[0.16] hover:text-white"
                          >
                            Release history
                            <ArrowRight className="h-4 w-4" />
                          </button>
                        </div>

                        {error ? (
                          <div className="rounded-md border border-[#5a2020] bg-[#241212] px-4 py-3 text-[13px] leading-6 text-[#ffb6b6]">
                            {error}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="min-w-0 border-t border-white/[0.06] bg-white/[0.01] p-6 md:p-8 xl:border-l xl:border-t-0">
                      <div className="space-y-4">
                        <div className="space-y-3">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">Install surface</p>
                          <h2 className="text-[22px] font-semibold text-white/92 md:text-[24px]">
                            {browserCopy[selectedBrowser].title} install details
                          </h2>
                          <p className="text-[13px] leading-6 text-white/50">
                            Store URLs take precedence automatically. If a store link is not configured yet, the page falls
                            back to the latest release package.
                          </p>
                        </div>

                        <div className="grid gap-3">
                          <MetricCard
                            icon={CheckCircle2}
                            label="Latest stable"
                            value={loading ? 'Loading...' : stableRelease?.version || 'Not published'}
                          />
                          <MetricCard
                            icon={Package}
                            label="Package size"
                            value={stableRelease?.primaryAsset ? formatSize(stableRelease.primaryAsset.size) : 'Unavailable'}
                          />
                          <MetricCard
                            icon={Clock3}
                            label="Published"
                            value={stableRelease?.publishedAt ? formatDate(stableRelease.publishedAt) : 'Unavailable'}
                          />
                        </div>

                        <div className="rounded-md border border-white/[0.08] bg-white/[0.02] p-4">
                          <DetailRow label="Install path" value={stableTarget.pathLabel} />
                          <DetailRow label="Browser route" value={browserCopy[selectedBrowser].system} />
                          <DetailRow label="Release source" value={data?.repo || 'XENO-CORPORATION/xeno-extension'} />
                          <DetailRow label="Generated" value={formatDate(data?.generatedAt)} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <SupportCard
                    title="Stable is the default path"
                    body="Use Stable for production installs, support docs, and the cleanest public rollout."
                  />
                  <SupportCard
                    title="Beta and Preview stay separate"
                    body="Keep testers and internal users on faster tracks without muddying the production install path."
                  />
                  <SupportCard
                    title="User key support stays available"
                    body="Install first, then add a custom API key in extension settings if you want to override the fallback."
                  />
                </div>
              </div>

              <aside className="grid gap-3 xl:sticky xl:top-24">
                {(Object.keys(channelCopy) as ChannelId[]).map((channel) => (
                  <TrackRailCard
                    key={channel}
                    browser={selectedBrowser}
                    channel={channel}
                    target={getInstallTarget(data, selectedBrowser, channel)}
                    loading={loading}
                  />
                ))}
              </aside>
            </div>

            <div id="extension-release-history" className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="rounded-md border border-white/[0.08] bg-[#0b0c0f] p-5">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">Tracks</p>
                <div className="mt-4 space-y-3">
                  {(Object.keys(channelCopy) as ChannelId[]).map((channel) => (
                    <div key={channel} className="rounded-md border border-white/[0.08] bg-white/[0.02] p-4">
                      <p className="text-[13px] font-medium text-white/84">{channelCopy[channel].title}</p>
                      <p className="mt-1 text-[12px] leading-6 text-white/46">{channelCopy[channel].description}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-white/[0.08] bg-[#0b0c0f] p-5">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">Notes</p>
                <div className="mt-4 space-y-3 text-[13px] leading-6 text-white/48">
                  <p>Store URLs override ZIP downloads automatically when they exist.</p>
                  <p>Safari should point to App Store or TestFlight rather than a Chromium-style panel install path.</p>
                  <p>GitHub release packages remain the fallback until store listings are wired.</p>
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-md border border-white/[0.08] bg-[#0b0c0f] p-5 md:p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/36">Release history</p>
                  <h2 className="mt-2 text-[28px] font-semibold text-white/92">What actually shipped</h2>
                </div>
                <p className="text-[12px] text-white/34">Generated {formatDate(data?.generatedAt)}</p>
              </div>

              <div className="mt-6 space-y-3">
                {loading ? (
                  <div className="rounded-md border border-white/[0.08] bg-white/[0.02] px-4 py-4 text-[13px] text-white/44">
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
                      className="rounded-md border border-white/[0.08] bg-white/[0.02] px-4 py-4"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[17px] font-medium text-white/88">{release.name}</span>
                            <span className="rounded-md border border-white/[0.08] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-white/42">
                              {release.channel}
                            </span>
                          </div>
                          <p className="mt-2 max-w-[780px] text-[13px] leading-6 text-white/46">
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
                              className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] px-4 py-2.5 text-white/70 transition-colors duration-200 hover:border-white/[0.16] hover:text-white"
                            >
                              Download
                              <Download className="h-4 w-4" />
                            </a>
                          ) : null}
                          <a
                            href={release.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-md border border-white/[0.08] px-4 py-2.5 text-white/70 transition-colors duration-200 hover:border-white/[0.16] hover:text-white"
                          >
                            GitHub
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            </div>

            <Link
              to="/download"
              className="inline-flex items-center gap-2 text-[13px] text-white/35 transition-colors duration-200 hover:text-white/70"
            >
              Back to the main download page
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
