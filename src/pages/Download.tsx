import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, ChevronDown, ArrowRight, ArrowLeft } from 'lucide-react';
import Header from '../components/landing/Header';
import Footer from '../components/landing/Footer';

type Platform = 'windows' | 'mac' | 'linux';

interface Asset {
  label: string;
  file: string;
}

interface Release {
  version: string;
  date: string;
  latest?: boolean;
  notes: string;
  assets: {
    windows: Asset[];
    mac: Asset[];
    linux: Asset[];
  };
}

const R2_BASE = 'https://updates.xenostudio.ai';

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('linux')) return 'linux';
  return 'windows';
}

const platformDownloads: Record<Platform, { label: string; suffix: string }[]> = {
  windows: [{ label: 'Download for x64', suffix: 'x64' }],
  mac: [
    { label: 'Download for Apple Silicon', suffix: 'arm64' },
    { label: 'Download for Intel', suffix: 'x64' },
  ],
  linux: [
    { label: 'Download AppImage', suffix: 'AppImage' },
    { label: 'Download .deb', suffix: 'deb' },
  ],
};

const platformLabels: Record<Platform, { name: string; icon: React.ReactNode }> = {
  windows: {
    name: 'Windows',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 12V6.75l6-1.32v6.48L3 12zm6.98.01l.02 6.5 6-1.32V12H9.98zM10 5.07L22 3v9h-12V5.07zM22 12.01h-12v6.72L22 21V12.01z" />
      </svg>
    ),
  },
  mac: {
    name: 'macOS',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </svg>
    ),
  },
  linux: {
    name: 'Linux',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.581 19.049c-.55-.446-.336-1.431-.907-1.917.553-3.365-.997-6.331-2.845-8.232-1.551-1.595-1.051-3.147-1.051-4.49 0-2.146-.881-4.41-3.55-4.41-2.853 0-3.635 2.38-3.663 3.738-.034 1.654-.249 2.932-1.244 4.009C5.252 9.99 4.07 13.271 4.981 16.2c-.429.544-.247 1.453-.735 1.877-.648.563-.636 1.397.04 1.843.357.235.956.261 1.262.021.214-.168.338-.462.478-.694.163-.27.39-.46.674-.523.315-.07.632-.074.95-.073l.085.002c.314-.005.623-.003.93.063.3.065.539.268.703.551.128.226.24.505.441.674.299.262.883.279 1.28.036.71-.434.612-1.357-.024-1.878-.504-.413-.27-1.432-.829-1.885 1.31-.377 3.27-.377 4.578 0z" />
      </svg>
    ),
  },
};

const sysReq: Record<Platform, string> = {
  mac: 'macOS 12+ · Apple Silicon / Intel · 4GB RAM',
  windows: 'Windows 10+ (64-bit) · 4GB RAM · 500MB disk',
  linux: 'Ubuntu 20.04+ / Fedora 36+ · 4GB RAM · glibc 2.31+',
};

/* ── Version section ── */
function VersionSection({ release, defaultOpen }: { release: Release; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(defaultOpen ? undefined : 0);
  const platforms: Platform[] = ['mac', 'windows', 'linux'];

  useEffect(() => {
    if (!contentRef.current) return;
    if (open) setHeight(contentRef.current.scrollHeight);
    else setHeight(0);
  }, [open]);

  const handleTransitionEnd = () => {
    if (open) setHeight(undefined);
  };

  return (
    <div className="border-t border-white/[0.06]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-5 group"
      >
        <div className="flex items-center gap-3">
          <span className="text-[22px] font-semibold text-white/90 group-hover:text-white transition-colors duration-300">
            {release.version}
          </span>
          {release.latest && (
            <span className="px-2.5 py-0.5 text-[10px] font-medium tracking-wider border border-white/[0.10] text-white/40 rounded-full">
              Latest
            </span>
          )}
        </div>
        <div className="w-7 h-7 flex items-center justify-center rounded-md bg-white/[0.03] group-hover:bg-white/[0.06] transition-all duration-300">
          <ChevronDown
            className={`w-4 h-4 text-white/25 transition-transform duration-500 ease-[cubic-bezier(0.65,0,0.35,1)] ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      <div
        className="overflow-hidden transition-[height] duration-500 ease-[cubic-bezier(0.65,0,0.35,1)]"
        style={{ height: height !== undefined ? height : 'auto' }}
        onTransitionEnd={handleTransitionEnd}
      >
        <div ref={contentRef}>
          <div className="pb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 border border-white/[0.06] rounded-md overflow-hidden">
              {platforms.map((platform, i) => {
                const assets = release.assets[platform];
                const meta = platformLabels[platform];
                return (
                  <div
                    key={platform}
                    className={`flex flex-col ${i < 2 ? 'md:border-r md:border-white/[0.06]' : ''} ${i > 0 ? 'border-t md:border-t-0 border-white/[0.06]' : ''}`}
                  >
                    {/* Platform header */}
                    <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-white/[0.06] bg-white/[0.015]">
                      <span className="text-white/30">{meta.icon}</span>
                      <span className="text-[13px] font-semibold text-white/60">{meta.name}</span>
                    </div>

                    {/* Downloads */}
                    <div className="px-5 py-2 flex-1">
                      {assets.length === 0 ? (
                        <p className="py-3 text-[13px] text-white/15 italic">Coming soon</p>
                      ) : (
                        assets.map((asset, j) => (
                          <a
                            key={asset.file}
                            href={`${R2_BASE}/${encodeURIComponent(asset.file)}`}
                            className={`group flex items-center justify-between py-3 ${j < assets.length - 1 ? 'border-b border-white/[0.04]' : ''}`}
                          >
                            <span className="text-[13px] text-white/45 group-hover:text-white transition-colors duration-200">
                              {asset.label}
                            </span>
                            <Download className="w-3.5 h-3.5 text-white/15 group-hover:text-white transition-colors duration-200" />
                          </a>
                        ))
                      )}
                    </div>

                    {/* Sys requirements inline */}
                    <div className="px-5 py-2.5 border-t border-white/[0.04]">
                      <p className="text-[10px] text-white/15 leading-relaxed">{sysReq[platform]}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4">
              <Link
                to={`/releases/${release.version}`}
                className="group inline-flex items-center gap-1.5 text-[13px] text-white/30 hover:text-white/60 transition-colors duration-300"
              >
                View release notes
                <ArrowRight className="w-3 h-3 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Hero ── */
type Step = 'select' | 'download';

function DownloadPage() {
  const navigate = useNavigate();
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCard, setShowCard] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [showMeta, setShowMeta] = useState(false);

  const [transitioning, setTransitioning] = useState(false);
  const [displayStep, setDisplayStep] = useState<Step>('select');

  useEffect(() => {
    fetch(`${R2_BASE}/releases.json`)
      .then((r) => r.json())
      .then((data: Release[]) => { setReleases(data); setLoading(false); })
      .catch(() => setLoading(false));

    const t1 = setTimeout(() => setShowCard(true), 100);
    const t2 = setTimeout(() => setShowContent(true), 400);
    const t3 = setTimeout(() => setShowMeta(true), 700);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  const latest = releases.find((r) => r.latest) || releases[0];
  const handleGetStarted = () => navigate('/auth');

  const scrollToVersions = () => {
    document.getElementById('versions')?.scrollIntoView({ behavior: 'smooth' });
  };

  const getDownloadUrl = (platform: Platform): string | null => {
    if (!latest) return null;
    const assets = latest.assets[platform];
    if (assets.length === 0) return null;
    return `${R2_BASE}/${encodeURIComponent(assets[0].file)}`;
  };

  const selectPlatform = (platform: Platform) => {
    setTransitioning(true);
    setTimeout(() => {
      setSelectedPlatform(platform);
      setDisplayStep('download');
      setTimeout(() => setTransitioning(false), 50);
    }, 300);
  };

  const goBack = () => {
    setTransitioning(true);
    setTimeout(() => {
      setSelectedPlatform(null);
      setDisplayStep('select');
      setTimeout(() => setTransitioning(false), 50);
    }, 300);
  };

  return (
    <div className="min-h-screen bg-[#08080a] text-white font-['Inter',sans-serif] overflow-x-hidden antialiased">
      <Header onGetStarted={handleGetStarted} visible={true} />

      <main className="pt-[46px]">
        {/* ── Hero ── */}
        <section className="flex items-center justify-center min-h-[calc(100vh-46px)] px-6">
          <div className="w-full max-w-[1100px] mx-auto">
            <div
              className={`relative border border-white/[0.06] rounded-md overflow-hidden bg-[#0b0b0d] transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                showCard ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
              style={{ aspectRatio: '2.35/1' }}
            >
              <div
                className={`absolute inset-0 flex flex-col items-center justify-center px-10 transition-opacity duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
                  transitioning ? 'opacity-0' : showContent ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {displayStep === 'select' && (
                  <>
                    <h1 className="text-[22px] md:text-[28px] font-semibold tracking-tight text-center text-white/90 mb-10">
                      Select an option to download XENO DESKTOP
                    </h1>
                    <div className="flex items-center gap-3">
                      {(['windows', 'mac', 'linux'] as Platform[]).map((platform) => {
                        const meta = platformLabels[platform];
                        return (
                          <button
                            key={platform}
                            onClick={() => selectPlatform(platform)}
                            className="group flex items-center gap-2.5 px-7 py-3.5 border border-white/[0.08] rounded-md text-[14px] font-medium text-white/50 hover:text-white hover:bg-white/[0.04] hover:border-white/[0.18] transition-all duration-300"
                          >
                            <span className="text-white/25 group-hover:text-white/60 transition-colors duration-300">
                              {meta.icon}
                            </span>
                            {meta.name}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                {displayStep === 'download' && selectedPlatform && (
                  <>
                    <button
                      onClick={goBack}
                      className="absolute top-5 left-6 flex items-center gap-1.5 text-[11px] text-white/20 hover:text-white/50 transition-colors duration-300"
                    >
                      <ArrowLeft className="w-3 h-3" />
                      All platforms
                    </button>

                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-white/30">{platformLabels[selectedPlatform].icon}</span>
                      <span className="text-[11px] text-white/25 font-medium tracking-widest uppercase">
                        {platformLabels[selectedPlatform].name}
                      </span>
                    </div>

                    <h2 className="text-[22px] md:text-[28px] font-semibold tracking-tight text-center text-white/90 mb-10">
                      Download XENO DESKTOP for {platformLabels[selectedPlatform].name}
                    </h2>

                    <div className="flex items-center gap-3">
                      {platformDownloads[selectedPlatform].map((opt) => {
                        const url = getDownloadUrl(selectedPlatform);
                        return url ? (
                          <a
                            key={opt.suffix}
                            href={url}
                            className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-[#08080a] text-[14px] font-semibold rounded-md hover:bg-white/85 transition-all duration-300"
                          >
                            <Download className="w-4 h-4" />
                            {opt.label}
                          </a>
                        ) : (
                          <span
                            key={opt.suffix}
                            className="inline-flex items-center gap-2 px-7 py-3.5 border border-white/[0.06] text-white/20 text-[14px] font-medium rounded-md"
                          >
                            <Download className="w-4 h-4" />
                            {opt.label}
                            <span className="text-[10px] text-white/10 ml-0.5">soon</span>
                          </span>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div
              className={`flex items-center justify-between mt-3 px-0.5 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                showMeta ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
              }`}
            >
              <p className="text-[11px] text-white/15">v{latest?.version ?? '0.0.1'}</p>
              <button
                onClick={scrollToVersions}
                className="text-[11px] text-white/20 hover:text-white/40 transition-colors duration-300"
              >
                View all download options &darr;
              </button>
            </div>
          </div>
        </section>

        {/* ── Version History ── */}
        <section id="versions" className="py-20 border-t border-white/[0.05]">
          <div className="max-w-[1100px] mx-auto px-2 lg:px-3">
            <h2 className="text-[13px] font-semibold text-white/30 mb-8 tracking-widest uppercase">
              All Versions
            </h2>
            {loading ? (
              <div className="flex justify-center py-16">
                <div className="w-5 h-5 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
              </div>
            ) : (
              <div>
                {releases.map((release, i) => (
                  <VersionSection key={release.version} release={release} defaultOpen={i === 0} />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

export default DownloadPage;
