import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FlaskConical,
  Package,
  PanelRightOpen,
  ServerCog,
  ShieldCheck,
  Sparkles,
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
    accent: string;
    button: string;
    icon: typeof ShieldCheck;
  }
> = {
  stable: {
    title: 'Stable',
    eyebrow: 'Production',
    description: 'Use this for the main install path. Lowest-risk updates, slower promotion, and the cleanest support surface.',
    accent: 'from-[#f5f1e8]/18 via-[#f5f1e8]/6 to-transparent',
    button: 'Install Stable',
    icon: ShieldCheck,
  },
  beta: {
    title: 'Beta',
    eyebrow: 'Opt-in',
    description: 'Near-production builds for testers who want faster updates before they are promoted to Stable.',
    accent: 'from-[#d79b55]/18 via-[#d79b55]/6 to-transparent',
    button: 'Install Beta',
    icon: Sparkles,
  },
  preview: {
    title: 'Preview',
    eyebrow: 'Experimental',
    description: 'Internal experiments, newest agent logic, and the highest chance of breakage while features settle.',
    accent: 'from-[#89a0ff]/18 via-[#89a0ff]/6 to-transparent',
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
    tint: string;
  }
> = {
  chrome: {
    title: 'Chrome',
    description: 'Best default for the full browser agent workflow, side panel UI, and Chromium extension runtime.',
    system: 'Chrome Web Store or manual Chromium package',
    badge: 'Chromium',
    tint: 'from-[#8ad6ff]/15 via-[#8ad6ff]/5 to-transparent',
  },
  edge: {
    title: 'Edge',
    description: 'Same agent flow, tuned for Microsoft Edge installs and the Chromium runtime that the extension expects.',
    system: 'Edge Add-ons or manual Chromium package',
    badge: 'Recommended',
    tint: 'from-[#8ec5ff]/18 via-[#8ec5ff]/6 to-transparent',
  },
  safari: {
    title: 'Safari',
    description: 'Uses the Safari wrapper route rather than the Chromium side panel flow. Best once App Store/TestFlight links are live.',
    system: 'App Store or TestFlight once published',
    badge: 'Wrapper app',
    tint: 'from-[#f7b3ff]/18 via-[#f7b3ff]/6 to-transparent',
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
      className={`group relative overflow-hidden rounded-2xl border px-4 py-4 text-left transition-all duration-300 ${
        active
          ? 'border-white/18 bg-white/[0.08] shadow-[0_18px_70px_rgba(0,0,0,0.45)]'
          : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.16] hover:bg-white/[0.05]'
      }`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${browser.tint} opacity-100`} />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-white/35">{browser.badge}</p>
            <p className="mt-1 text-[17px] font-medium text-white/92">{browser.title}</p>
          </div>
          {detected ? (
            <span className="rounded-full border border-white/[0.12] bg-white/[0.06] px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-white/55">
              Detected
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-[12px] leading-6 text-white/48">{browser.description}</p>
      </div>
    </button>
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
    <article className="group relative overflow-hidden rounded-[26px] border border-white/[0.08] bg-[#0d0f12] p-5">
      <div className={`absolute inset-0 bg-gradient-to-br ${meta.accent}`} />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-white/38">{meta.eyebrow}</p>
            <h3 className="mt-2 text-[22px] font-semibold tracking-tight text-white/92">{meta.title}</h3>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-2.5 text-white/60">
            <Icon className="h-4 w-4" />
          </div>
        </div>

        <p className="mt-4 text-[13px] leading-6 text-white/52">{meta.description}</p>

        <div className="mt-5 rounded-[20px] border border-white/[0.08] bg-black/25 p-4">
          <div className="flex items-center justify-between gap-3 text-[12px] text-white/45">
            <span>{browserCopy[browser].title}</span>
            <span>{loading ? 'Loading...' : target.release?.version || 'Pending'}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-white/42">
            <span>Published</span>
            <span>{loading ? '...' : formatDate(target.release?.publishedAt)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-white/42">
            <span>Install path</span>
            <span className="text-right">{loading ? '...' : target.pathLabel}</span>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2.5">
          {target.url ? (
            <a
              href={target.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[12px] font-semibold text-[#08080a] transition-opacity duration-200 hover:opacity-85"
            >
              <Download className="h-4 w-4" />
              {meta.button}
            </a>
          ) : (
            <span className="inline-flex items-center rounded-full border border-white/[0.08] px-4 py-2.5 text-[12px] text-white/35">
              Release pending
            </span>
          )}

          {target.release?.htmlUrl ? (
            <a
              href={target.release.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] px-4 py-2.5 text-[12px] text-white/68 transition-colors duration-200 hover:border-white/[0.16] hover:text-white"
            >
              Notes
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function SurfaceStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[20px] border border-white/[0.08] bg-black/25 p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-2.5 text-white/70">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-white/34">{label}</p>
          <p className="mt-1 text-[14px] font-medium text-white/85">{value}</p>
        </div>
      </div>
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
  const selectedStableRelease = data?.channels?.stable || null;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#08080a] font-['Inter',sans-serif] text-white antialiased">
      <Header onGetStarted={handleGetStarted} visible={true} />
      <main className="relative pt-[46px]">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-[-10%] top-24 h-[420px] w-[420px] rounded-full bg-[#2f4f78]/18 blur-[120px]" />
          <div className="absolute right-[-8%] top-[18rem] h-[360px] w-[360px] rounded-full bg-[#8f6b3d]/16 blur-[120px]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:32px_32px] opacity-[0.04]" />
        </div>

        <section className="relative px-6 pb-14 pt-16 md:pb-20 md:pt-20">
          <div className="mx-auto max-w-[1260px]">
            <div className="mb-8 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-white/45">
                Browser agent
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-black/20 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-white/32">
                Release pipeline synced
              </span>
            </div>

            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.2fr)_340px]">
              <div className="relative overflow-hidden rounded-[34px] border border-white/[0.08] bg-[#0d0f12] shadow-[0_30px_140px_rgba(0,0,0,0.45)]">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(111,168,255,0.12),transparent_30%)]" />
                <div className="relative grid gap-10 p-6 md:p-8 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-8">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-white/40">
                      Detected {browserCopy[detectedBrowser].title}
                    </div>

                    <h1 className="mt-6 max-w-[740px] text-[34px] font-semibold tracking-[-0.03em] text-white/94 md:text-[52px] md:leading-[1.02]">
                      Download the Xeno browser agent for {browserCopy[selectedBrowser].title}
                    </h1>

                    <p className="mt-5 max-w-[700px] text-[15px] leading-8 text-white/55 md:text-[16px]">
                      Stable is for production installs, Beta is for opt-in testers, and Preview is for internal experiments.
                      This page reads directly from the Xeno extension release pipeline so the website stays in sync with the repo.
                    </p>

                    <div className="mt-8 grid gap-3 md:grid-cols-3">
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

                    <div className="mt-8 flex flex-wrap items-center gap-3">
                      {stableTarget.url ? (
                        <a
                          href={stableTarget.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[13px] font-semibold text-[#08080a] transition-opacity duration-200 hover:opacity-85"
                        >
                          <Download className="h-4 w-4" />
                          {stableTarget.storeUrl ? 'Install Stable' : 'Download Stable'}
                        </a>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-white/[0.08] px-6 py-3 text-[13px] text-white/38">
                          Stable release pending
                        </span>
                      )}

                      {selectedStableRelease?.htmlUrl ? (
                        <a
                          href={selectedStableRelease.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] px-6 py-3 text-[13px] text-white/70 transition-colors duration-200 hover:border-white/[0.16] hover:text-white"
                        >
                          View release notes
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      ) : null}

                      <button
                        onClick={() => document.getElementById('release-surface')?.scrollIntoView({ behavior: 'smooth' })}
                        className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] px-6 py-3 text-[13px] text-white/52 transition-colors duration-200 hover:border-white/[0.16] hover:text-white"
                      >
                        See all tracks
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>

                    {error ? (
                      <div className="mt-6 rounded-[22px] border border-[#5a2020] bg-[#241212] px-5 py-4 text-[13px] leading-6 text-[#ffb6b6]">
                        {error}
                      </div>
                    ) : null}
                  </div>

                  <div className="relative">
                    <div className="rounded-[28px] border border-white/[0.08] bg-[#12151a] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.22em] text-white/36">Install surface</p>
                          <h2 className="mt-2 text-[24px] font-semibold tracking-tight text-white/92">
                            {browserCopy[selectedBrowser].title} release channel
                          </h2>
                        </div>
                        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3 text-white/68">
                          <PanelRightOpen className="h-5 w-5" />
                        </div>
                      </div>

                      <p className="mt-4 text-[14px] leading-7 text-white/52">
                        Extension installs and ZIP fallbacks resolve from the release pipeline. If store URLs are configured,
                        this page prefers them automatically for the selected browser.
                      </p>

                      <div className="mt-6 grid gap-3">
                        <SurfaceStat
                          icon={CheckCircle2}
                          label="Latest stable"
                          value={loading ? 'Loading...' : selectedStableRelease?.version || 'Not published'}
                        />
                        <SurfaceStat
                          icon={Package}
                          label="Package size"
                          value={selectedStableRelease?.primaryAsset ? formatSize(selectedStableRelease.primaryAsset.size) : 'Unavailable'}
                        />
                        <SurfaceStat
                          icon={Clock3}
                          label="Published"
                          value={selectedStableRelease?.publishedAt ? formatDate(selectedStableRelease.publishedAt) : 'Unavailable'}
                        />
                      </div>

                      <div className="mt-6 rounded-[22px] border border-white/[0.08] bg-black/25 p-4">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-white/34">Install path</p>
                        <p className="mt-2 text-[15px] font-medium text-white/84">{stableTarget.pathLabel}</p>
                        <p className="mt-2 text-[13px] leading-6 text-white/45">{browserCopy[selectedBrowser].system}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <aside className="space-y-4">
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
          </div>
        </section>

        <section id="release-surface" className="relative border-t border-white/[0.05] px-6 py-20">
          <div className="mx-auto max-w-[1260px]">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="rounded-[30px] border border-white/[0.08] bg-[#0c0e12] p-6 md:p-8">
                <p className="text-[11px] uppercase tracking-[0.24em] text-white/36">Release surface</p>
                <h2 className="mt-4 max-w-[460px] text-[30px] font-semibold tracking-[-0.03em] text-white/94">
                  One extension product. Three release lanes. One source of truth.
                </h2>
                <p className="mt-4 max-w-[520px] text-[14px] leading-7 text-white/52">
                  The hero above is the install decision. This section is the audit trail: what shipped, when it shipped, and which
                  browser already has a direct install path.
                </p>

                <div className="mt-8 space-y-3">
                  {[
                    {
                      icon: ShieldCheck,
                      title: 'Stable for real installs',
                      body: 'Use Stable for public installs, support docs, and the lowest-risk path.',
                    },
                    {
                      icon: FlaskConical,
                      title: 'Beta and Preview stay visible',
                      body: 'Opt-in testers and internal teams can pull newer builds without confusing the main install path.',
                    },
                    {
                      icon: ServerCog,
                      title: 'Synced from the repo',
                      body: `Release source: ${data?.repo || 'XENO-CORPORATION/xeno-extension'}`,
                    },
                  ].map(({ icon: Icon, title, body }) => (
                    <div key={title} className="rounded-[22px] border border-white/[0.08] bg-white/[0.03] p-4">
                      <div className="flex items-start gap-3">
                        <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-2.5 text-white/68">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-[14px] font-medium text-white/88">{title}</p>
                          <p className="mt-1 text-[13px] leading-6 text-white/48">{body}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                {(Object.keys(channelCopy) as ChannelId[]).map((channel) => {
                  const meta = channelCopy[channel];
                  const release = data?.channels?.[channel] || null;
                  const installUrl = data?.browserInstall?.[selectedBrowser]?.[channel] || release?.primaryAsset?.url || null;
                  const Icon = meta.icon;

                  return (
                    <article key={channel} className="rounded-[28px] border border-white/[0.08] bg-[#101318] p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.22em] text-white/34">{meta.eyebrow}</p>
                          <h3 className="mt-2 text-[24px] font-semibold tracking-tight text-white/92">{meta.title}</h3>
                        </div>
                        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-2.5 text-white/65">
                          <Icon className="h-4 w-4" />
                        </div>
                      </div>

                      <p className="mt-4 text-[13px] leading-6 text-white/50">{meta.description}</p>

                      <div className="mt-5 rounded-[22px] border border-white/[0.08] bg-black/25 p-4">
                        <div className="flex items-center justify-between gap-3 text-[12px] text-white/45">
                          <span>Version</span>
                          <span>{release?.version || 'Pending'}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-white/42">
                          <span>Published</span>
                          <span>{formatDate(release?.publishedAt)}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-white/42">
                          <span>Package</span>
                          <span>{release?.primaryAsset ? formatSize(release.primaryAsset.size) : 'Unavailable'}</span>
                        </div>
                        <p className="mt-3 text-[12px] leading-6 text-white/46">
                          {release?.notesSummary || 'This channel does not have a published release yet.'}
                        </p>
                      </div>

                      <div className="mt-5 flex flex-wrap gap-2.5">
                        {installUrl ? (
                          <a
                            href={installUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[12px] font-semibold text-[#08080a]"
                          >
                            <Download className="h-4 w-4" />
                            {data?.browserInstall?.[selectedBrowser]?.[channel] ? 'Install' : 'Download'}
                          </a>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-white/[0.08] px-4 py-2.5 text-[12px] text-white/35">
                            Pending
                          </span>
                        )}

                        {release?.htmlUrl ? (
                          <a
                            href={release.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] px-4 py-2.5 text-[12px] text-white/70"
                          >
                            Notes
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="px-6 pb-10">
          <div className="mx-auto max-w-[1260px] rounded-[32px] border border-white/[0.08] bg-[#0d1015] p-6 md:p-8">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-white/36">Release history</p>
                <h2 className="mt-3 text-[30px] font-semibold tracking-[-0.03em] text-white/94">
                  What actually shipped
                </h2>
              </div>
              <p className="text-[12px] text-white/34">Generated {formatDate(data?.generatedAt)}</p>
            </div>

            <div className="mt-6 space-y-3">
              {loading ? (
                <div className="rounded-[24px] border border-white/[0.06] px-5 py-4 text-[13px] text-white/45">
                  Loading extension releases...
                </div>
              ) : error ? (
                <div className="rounded-[24px] border border-[#5a2020] bg-[#241212] px-5 py-4 text-[13px] text-[#ffb6b6]">
                  {error}
                </div>
              ) : (
                data?.recentReleases.map((release) => (
                  <div
                    key={`${release.channel}-${release.tag}`}
                    className="rounded-[24px] border border-white/[0.07] bg-black/20 px-5 py-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[17px] font-medium text-white/88">{release.name}</span>
                          <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-white/42">
                            {release.channel}
                          </span>
                        </div>
                        <p className="mt-2 max-w-[760px] text-[13px] leading-6 text-white/46">
                          {release.notesSummary || 'No release notes provided.'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 text-[12px] text-white/42">
                        <span>{formatDate(release.publishedAt)}</span>
                        {release.primaryAsset ? <span>{formatSize(release.primaryAsset.size)}</span> : null}
                        {release.primaryAsset ? (
                          <a
                            href={release.primaryAsset.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] px-4 py-2.5 text-white/70"
                          >
                            Download
                            <Download className="h-4 w-4" />
                          </a>
                        ) : null}
                        <a
                          href={release.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] px-4 py-2.5 text-white/70"
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
        </section>

        <section className="px-6 pb-20">
          <div className="mx-auto max-w-[1260px] grid gap-4 lg:grid-cols-3">
            {[
              'Store URLs override ZIP downloads automatically when they exist. Until then, the page falls back to the latest GitHub release package.',
              'Safari should ultimately point to App Store or TestFlight. The wrapper path is the right install surface there, not a Chromium-style panel.',
              'If you want a custom API key, add it in the extension settings after install. Otherwise the channel fallback can be used by default.',
            ].map((line) => (
              <div key={line} className="rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-5">
                <p className="text-[14px] leading-7 text-white/50">{line}</p>
              </div>
            ))}
          </div>

          <div className="mx-auto mt-8 max-w-[1260px]">
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
