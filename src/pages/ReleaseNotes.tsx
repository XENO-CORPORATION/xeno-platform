import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Download, Monitor, Apple, Terminal } from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
import { UPDATES_ORIGIN } from '../config/hosts';

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

const R2_BASE = UPDATES_ORIGIN;

const platformMeta: Record<string, { label: string; icon: React.ReactNode }> = {
  windows: { label: 'Windows', icon: <Monitor className="w-3.5 h-3.5" /> },
  mac: { label: 'macOS', icon: <Apple className="w-3.5 h-3.5" /> },
  linux: { label: 'Linux', icon: <Terminal className="w-3.5 h-3.5" /> },
};

function ReleaseNotes() {
  const { version } = useParams<{ version: string }>();
  const navigate = useNavigate();
  const [release, setRelease] = useState<Release | null>(null);
  const [allReleases, setAllReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${R2_BASE}/releases.json`)
      .then((r) => r.json())
      .then((data: Release[]) => {
        setAllReleases(data);
        const found = data.find((r) => r.version === version);
        setRelease(found || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [version]);

  const handleGetStarted = () => navigate('/login');

  const allPlatforms = (['windows', 'mac', 'linux'] as const).filter(
    (p) => release && release.assets[p].length > 0
  );

  return (
    <div className="min-h-screen bg-[#08080a] text-white font-['Inter',sans-serif] overflow-x-hidden antialiased">
      <Header onGetStarted={handleGetStarted} visible={true} />

      <main className="pt-[46px]">
        <div className="max-w-[700px] mx-auto px-6 lg:px-8 py-16">
          {/* Back link */}
          <Link
            to="/download"
            className="group inline-flex items-center gap-2 text-[13px] text-white/40 hover:text-white/70 transition-colors mb-10"
          >
            <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
            All releases
          </Link>

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            </div>
          ) : !release ? (
            <div className="text-center py-20">
              <h1 className="text-2xl font-bold mb-3">Version not found</h1>
              <p className="text-white/40 text-[14px] mb-6">
                Release {version} doesn't exist.
              </p>
              <Link
                to="/download"
                className="text-[13px] text-white/50 hover:text-white underline underline-offset-2 transition-colors"
              >
                View all releases
              </Link>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="mb-10">
                <div className="flex items-center gap-3 mb-3">
                  <h1 className="text-3xl md:text-4xl font-bold">v{release.version}</h1>
                  {release.latest && (
                    <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-green-500/10 text-green-400 border border-green-500/20 rounded-full">
                      Latest
                    </span>
                  )}
                </div>
                <p className="text-[14px] text-white/35">{release.date}</p>
              </div>

              {/* Release notes content */}
              <div className="mb-12">
                <h2 className="text-[12px] font-semibold text-white/50 uppercase tracking-wider mb-4">
                  Release Notes
                </h2>
                <div className="prose prose-invert prose-sm max-w-none">
                  <div className="text-[14px] text-white/60 leading-relaxed whitespace-pre-wrap">
                    {release.notes}
                  </div>
                </div>
              </div>

              {/* Downloads for this version */}
              {allPlatforms.length > 0 && (
                <div>
                  <h2 className="text-[12px] font-semibold text-white/50 uppercase tracking-wider mb-4">
                    Downloads
                  </h2>
                  <div className="space-y-4">
                    {allPlatforms.map((platform) => {
                      const meta = platformMeta[platform];
                      const assets = release.assets[platform];
                      return (
                        <div key={platform}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-white/40">{meta.icon}</span>
                            <span className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">
                              {meta.label}
                            </span>
                          </div>
                          <div className="space-y-1.5">
                            {assets.map((asset) => (
                              <a
                                key={asset.file}
                                href={`${R2_BASE}/${encodeURIComponent(asset.file)}`}
                                className="group flex items-center justify-between px-4 py-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.10] transition-all"
                              >
                                <span className="text-[13px] text-white/70 group-hover:text-white transition-colors">
                                  {asset.label}
                                </span>
                                <Download className="w-3.5 h-3.5 text-white/30 group-hover:text-white/70 transition-colors" />
                              </a>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Navigation to other versions */}
              {allReleases.length > 1 && (
                <div className="mt-12 pt-8 border-t border-white/[0.06]">
                  <h3 className="text-[12px] font-semibold text-white/50 uppercase tracking-wider mb-3">
                    Other Versions
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {allReleases
                      .filter((r) => r.version !== release.version)
                      .map((r) => (
                        <Link
                          key={r.version}
                          to={`/releases/${r.version}`}
                          className="px-3 py-1.5 text-[12px] text-white/50 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-md transition-all"
                        >
                          {r.version}
                        </Link>
                      ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default ReleaseNotes;
